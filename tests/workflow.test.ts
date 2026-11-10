import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Store } from "../src/main/store";
import { Service, type AI } from "../src/main/service";
import { GitHub } from "../src/main/github";
import {
  newDraft,
  reviewFingerprint,
  reviewIssues,
  replyFingerprint,
} from "../src/main/domain";
import {
  fileSnapshot,
  git,
  gitText,
  workspaceDigest,
  codePreview,
} from "../src/main/git";
import { digest } from "../src/main/util";
import type { Draft, PR, Settings } from "../src/shared/types";
const pr: PR = {
  owner: "owner",
  repo: "repo",
  number: 7,
  url: "https://github.com/owner/repo/pull/7",
  title: "Guard empty list",
  body: "Return zero for empty list.",
  head: "head",
  base: "base",
  branch: "feature",
  headRepo: "owner/repo",
  baseBranch: "main",
  state: "open",
};
function draft() {
  return newDraft({
    kind: "remote",
    capturedAt: new Date().toISOString(),
    title: pr.title,
    pr: { ...pr },
    head: pr.head,
    base: pr.base,
    branch: pr.branch,
    files: [
      fileSnapshot(
        "a.ts",
        Buffer.from("const a = 1;\n"),
        Buffer.from("const a = 0;\n"),
      ),
    ],
  });
}
class FakeGitHub extends GitHub {
  current = { ...pr };
  posts: any[] = [];
  replies: any[] = [];
  resolved: string[] = [];
  timeout = false;
  constructor() {
    super("");
  }
  override async pr() {
    return this.current;
  }
  override async createReview(_p: PR, payload: any) {
    this.posts.push({
      id: 1,
      body: payload.body,
      commit_id: payload.commit_id,
      html_url: "https://github.com/review/1",
    });
    if (this.timeout) throw Error("timeout");
    return this.posts[0];
  }
  override async reviews() {
    return this.posts;
  }
  override async reply(_p: PR, f: any, body: string) {
    const r = {
      body,
      html_url: "https://github.com/comment/" + this.replies.length,
      in_reply_to_id: f.commentID,
    };
    this.replies.push(r);
    if (this.timeout) throw Error("timeout");
    return r;
  }
  override async postedReply(_p: PR, f: any, marker: string) {
    return this.replies.find(
      (r) => r.body.includes(marker) && r.in_reply_to_id === f.commentID,
    );
  }
  override async resolve(id: string) {
    this.resolved.push(id);
    return {};
  }
}
async function setup(ai: AI) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "reviewforge-workflow-"),
  );
  const store = new Store(path.join(root, "data"));
  const settings: Settings = {
    language: "en",
    dataDirectory: store.directory,
    model: "",
    authorName: "Fixture",
    authorEmail: "fixture@example.test",
    githubConfigured: false,
    copilotConfigured: false,
  };
  const remote = new FakeGitHub();
  const service = new Service(
    store,
    settings,
    ai,
    { read: async () => "" },
    () => {},
    () => remote,
  );
  return {
    root,
    store,
    settings,
    remote,
    service,
    close: async () => {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
const noAI: AI = {
  run: async () => {
    throw Error("Unexpected AI");
  },
  cancel() {},
};
test("per-file review persists valid findings, description context and all-category approval gate", async () => {
  let captured: any;
  const ai: AI = {
    cancel() {},
    async run(m, tool) {
      captured = m;
      await tool("finding", {
        path: "a.ts",
        line: 1,
        side: "RIGHT",
        title: "Zero divisor",
        body: "Zero causes division failure.",
        kind: "bug",
        severity: "P1",
      });
      await assert.rejects(
        tool("finding", {
          path: "wrong.ts",
          line: 1,
          side: "RIGHT",
          title: "Invalid",
          body: "Invalid",
          kind: "bug",
          severity: "P1",
        }),
      );
      return "Description assessment: reviewed intended behavior; no tests run.";
    },
  };
  const f = await setup(ai);
  try {
    const d = f.store.save(draft());
    await f.service.analyze(d.id, false);
    let result = f.store.get(d.id);
    assert.equal(captured.context.pr.body, pr.body);
    assert.equal(result.analysisState, "complete");
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].decision, "pending");
    assert(reviewIssues(result).length);
    assert.throws(() =>
      f.service.approveReview(d.id, reviewFingerprint(result)),
    );
    result.findings[0].decision = "include";
    f.service.edit(d.id, { findings: result.findings });
    result = f.store.get(d.id);
    f.service.approveReview(d.id, reviewFingerprint(result));
    await f.service.publishReview(d.id);
    assert.equal(f.remote.posts.length, 1);
    assert.equal(f.store.get(d.id).publication?.state, "published");
    await assert.rejects(f.service.publishReview(d.id));
  } finally {
    await f.close();
  }
});
test("cancelled review resumes unfinished chunks and preserves human summary", async () => {
  let calls = 0;
  const ai: AI = {
    cancel() {},
    async run() {
      if (++calls === 2) throw Error("interrupted");
      return "Part checked";
    },
  };
  const f = await setup(ai);
  try {
    const d = draft();
    d.snapshot.files[0].patch = "+x\n".repeat(22000);
    d.summary = "Human summary";
    f.store.save(d);
    await assert.rejects(f.service.analyze(d.id, false));
    assert.equal(
      Object.keys(f.store.get(d.id).snapshot.files[0].reviews).length,
      1,
    );
    await f.service.analyze(d.id, true);
    assert.equal(calls, 4);
    assert.equal(f.store.get(d.id).summary, "Human summary");
    assert.equal(f.store.get(d.id).analysisState, "complete");
  } finally {
    await f.close();
  }
});
test("description changes and edited findings invalidate approved publication", async () => {
  const f = await setup(noAI);
  try {
    const d = draft();
    d.summary = "Reviewed";
    f.store.save(d);
    f.service.approveReview(d.id, reviewFingerprint(d));
    f.remote.current.body = "New requirements";
    await assert.rejects(f.service.publishReview(d.id));
    assert.equal(f.remote.posts.length, 0);
    f.service.edit(d.id, { summary: "Human edit" });
    assert.equal(f.store.get(d.id).approval, undefined);
  } finally {
    await f.close();
  }
});
test("uncertain review publication is reconciled without duplicate post", async () => {
  const f = await setup(noAI);
  try {
    const d = draft();
    d.summary = "Reviewed";
    f.store.save(d);
    f.service.approveReview(d.id, reviewFingerprint(d));
    f.remote.timeout = true;
    await assert.rejects(f.service.publishReview(d.id));
    assert.equal(f.store.get(d.id).publication?.state, "uncertain");
    assert.throws(() => f.store.delete(d.id));
    await f.service.reconcileReview(d.id);
    assert.equal(f.store.get(d.id).publication?.state, "published");
    assert.equal(f.remote.posts.length, 1);
  } finally {
    await f.close();
  }
});
test("persistent store recovers interrupted analysis and uncertain reply attempts", async () => {
  const f = await setup(noAI);
  try {
    const d = draft();
    d.analysisState = "running";
    d.feedback = [
      {
        id: "thread",
        threadID: "thread",
        body: "Fix",
        author: "author",
        url: "",
        selected: true,
        resolved: false,
        outdated: false,
        reply: "Fixed",
        resolve: true,
        replyAttempt: { marker: "marker", body: "Fixed", state: "sending" },
      },
    ];
    f.store.save(d);
    f.store.recover();
    const saved = f.store.get(d.id);
    assert.equal(saved.analysisState, "interrupted");
    assert.equal(saved.feedback[0].replyAttempt?.state, "uncertain");
  } finally {
    await f.close();
  }
});
async function repository(root: string) {
  const dir = path.join(root, "repo");
  await fs.mkdir(dir);
  await git(dir, ["init", "-b", "feature"]);
  await git(dir, ["config", "user.name", "Fixture"]);
  await git(dir, ["config", "user.email", "fixture@example.test"]);
  await git(dir, ["config", "commit.gpgsign", "false"]);
  await fs.writeFile(path.join(dir, "a.ts"), "const a = 1;\r\n");
  await git(dir, ["add", "."]);
  await git(dir, ["commit", "-m", "initial"]);
  return dir;
}
test("fix proposals preserve CRLF, require complete reads and reject external modifications", async () => {
  const ai: AI = {
    cancel() {},
    async run(m, tool) {
      await assert.rejects(
        tool("proposal", {
          path: "a.ts",
          content: "const a = 2;\n",
          reason: "Fix",
        }),
      );
      await tool("read", { path: "a.ts", offset: 0 });
      await tool("proposal", {
        path: "a.ts",
        content: "const a = 2;\n",
        reason: "Fix",
      });
      return "Proposed a fix; tests not run.";
    },
  };
  const f = await setup(ai);
  try {
    const root = await repository(f.root);
    const d = draft();
    d.workspace = {
      directory: root,
      head: await gitText(root, ["rev-parse", "HEAD"]),
      originalHead: await gitText(root, ["rev-parse", "HEAD"]),
      expectedRemote: "head",
    };
    d.feedback = [
      {
        id: "thread",
        body: "Fix",
        author: "author",
        url: "",
        selected: true,
        resolved: false,
        outdated: false,
        reply: "",
        resolve: false,
      },
    ];
    f.store.save(d);
    await f.service.generateFix(d.id, "");
    let saved = f.store.get(d.id);
    assert.equal(saved.proposals[0].content, "const a = 2;\r\n");
    assert.equal(
      await fs.readFile(path.join(root, "a.ts"), "utf8"),
      "const a = 1;\r\n",
    );
    await fs.writeFile(path.join(root, "other.txt"), "external");
    await assert.rejects(
      f.service.applyProposals(d.id, digest(saved.proposals)),
    );
    await fs.rm(path.join(root, "other.txt"));
    await f.service.applyProposals(d.id, digest(saved.proposals));
    assert.equal(
      await fs.readFile(path.join(root, "a.ts"), "utf8"),
      "const a = 2;\r\n",
    );
    assert.equal(f.store.get(d.id).proposals[0].status, "applied");
  } finally {
    await f.close();
  }
});
test("reply drafts before push stay local; externally pushed commit allows preview then reply/resolve", async () => {
  let publicationState = "";
  const ai: AI = {
    cancel() {},
    async run(m, tool) {
      publicationState = m.context.publicationState;
      await tool("reply", {
        id: "thread",
        body: "Changed the value in local code; tests not run.",
      });
      return "Drafted";
    },
  };
  const f = await setup(ai);
  try {
    const root = await repository(f.root),
      original = await gitText(root, ["rev-parse", "HEAD"]);
    const d = draft();
    d.workspace = {
      directory: root,
      head: original,
      originalHead: original,
      expectedRemote: original,
    };
    d.feedback = [
      {
        id: "thread",
        threadID: "thread",
        commentID: 8,
        body: "Fix",
        author: "author",
        url: "",
        selected: true,
        resolved: false,
        outdated: false,
        reply: "",
        resolve: true,
      },
    ];
    f.store.save(d);
    await fs.writeFile(path.join(root, "a.ts"), "const a = 2;\r\n");
    await f.service.generateReplies(d.id, "");
    assert.equal(publicationState, "local changes, NOT pushed");
    assert.equal(f.remote.replies.length, 0);
    await assert.rejects(f.service.previewReplies(d.id));
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "external commit"]);
    const head = await gitText(root, ["rev-parse", "HEAD"]);
    f.remote.current.head = head;
    const preview = await f.service.previewReplies(d.id);
    assert.equal(preview.head, head);
    await f.service.approveReplies(d.id, preview.fingerprint);
    await f.service.publishReplies(d.id);
    assert.equal(f.remote.replies.length, 1);
    assert.deepEqual(f.remote.resolved, ["thread"]);
    await f.service.publishReplies(d.id);
    assert.equal(f.remote.replies.length, 1);
    assert.equal(f.remote.resolved.length, 1);
  } finally {
    await f.close();
  }
});
test("code approval rejects external changes and commit leaves source history reviewable", async () => {
  const f = await setup(noAI);
  try {
    const root = await repository(f.root),
      head = await gitText(root, ["rev-parse", "HEAD"]);
    const d = draft();
    await fs.writeFile(path.join(root, "a.ts"), "const a = 3;\r\n");
    d.workspace = {
      directory: root,
      head,
      originalHead: head,
      expectedRemote: head,
      preview: await codePreview(root, head, head),
    };
    f.store.save(d);
    f.service.approveCode(d.id, digest(d.workspace.preview));
    await fs.writeFile(path.join(root, "a.ts"), "external");
    await assert.rejects(f.service.commit(d.id, "Fix"));
    assert.equal(await gitText(root, ["rev-parse", "HEAD"]), head);
    await fs.writeFile(path.join(root, "a.ts"), "const a = 3;\r\n");
    await f.service.commit(d.id, "Fix");
    assert.notEqual(await gitText(root, ["rev-parse", "HEAD"]), head);
    assert.equal(f.store.get(d.id).workspace?.approval, undefined);
    assert.equal(await gitText(root, ["status", "--porcelain"]), "");
  } finally {
    await f.close();
  }
});

test("file deletion and creation remain proposals until explicitly applied; new file keeps its final newline", async () => {
  const ai: AI = {
    cancel() {},
    async run(_m, tool) {
      await tool("read", { path: "a.ts" });
      await tool("proposal", {
        path: "a.ts",
        content: "",
        reason: "Remove unused implementation",
        delete: true,
      });
      await tool("proposal", {
        path: "replacement.ts",
        content: "export const value = 2;\n",
        reason: "Replacement",
      });
      return "Proposed replacement";
    },
  };
  const f = await setup(ai);
  try {
    const root = await repository(f.root),
      head = await gitText(root, ["rev-parse", "HEAD"]),
      d = draft();
    d.workspace = {
      directory: root,
      head,
      originalHead: head,
      expectedRemote: head,
    };
    d.feedback = [
      {
        id: "t",
        body: "Replace implementation",
        author: "a",
        url: "",
        selected: true,
        resolved: false,
        outdated: false,
        reply: "",
        resolve: false,
      },
    ];
    f.store.save(d);
    await f.service.generateFix(d.id, "");
    const proposals = f.store.get(d.id).proposals;
    assert.equal(proposals[0].delete, true);
    assert.equal(proposals[1].content, "export const value = 2;\n");
    assert.equal(
      await fs.readFile(path.join(root, "a.ts"), "utf8"),
      "const a = 1;\r\n",
    );
    await assert.rejects(fs.stat(path.join(root, "replacement.ts")));
    await f.service.applyProposals(d.id, digest(proposals));
    await assert.rejects(fs.stat(path.join(root, "a.ts")));
    assert.equal(
      await fs.readFile(path.join(root, "replacement.ts"), "utf8"),
      proposals[1].content,
    );
  } finally {
    await f.close();
  }
});

test("an unreviewed PR cannot be approved as complete coverage", () => {
  const d = draft();
  d.event = "APPROVE";
  d.summary = "Manual summary";
  assert(
    reviewIssues(d).includes("Cannot approve a PR with incomplete coverage."),
  );
});

test("definitively rejected GitHub publication can be corrected and re-approved, unlike uncertain network results", async () => {
  const { GitHubRejected } = await import("../src/main/github");
  const f = await setup(noAI);
  try {
    const d = draft();
    d.summary = "Review summary";
    f.store.save(d);
    f.service.approveReview(d.id, reviewFingerprint(d));
    f.remote.createReview = async () => {
      throw new GitHubRejected(403, "Forbidden", "没有权限");
    };
    await assert.rejects(f.service.publishReview(d.id), /Forbidden/);
    const saved = f.store.get(d.id);
    assert.equal(saved.publication, undefined);
    assert.equal(saved.approval, undefined);
    f.service.edit(d.id, { summary: "Corrected review" });
    assert.equal(f.store.get(d.id).summary, "Corrected review");
  } finally {
    await f.close();
  }
});

test("real Git pushes use an explicit lease, preserve approved amend history, and reject a remote race", async () => {
  const f = await setup(noAI);
  try {
    const root = await repository(f.root),
      bare = path.join(f.root, "remote.git");
    const original = await gitText(root, ["rev-parse", "HEAD"]);
    await git(root, ["clone", "--bare", root, bare]);
    const remoteBranch = await gitText(root, ["branch", "--show-current"]);
    const remoteURL = pathToFileURL(bare).href;
    await git(root, [
      "config",
      `url.${remoteURL}.insteadOf`,
      "https://github.com/owner/repo.git",
    ]);
    const d = draft();
    d.snapshot.pr!.branch = remoteBranch;
    d.workspace = {
      directory: root,
      head: original,
      originalHead: original,
      expectedRemote: original,
    };
    f.store.save(d);
    const current = async () => ({
      ...pr,
      branch: remoteBranch,
      head: await gitText(bare, ["rev-parse", `refs/heads/${remoteBranch}`]),
    });
    f.remote.pr = current;
    await fs.writeFile(path.join(root, "a.ts"), "const a = 2;\r\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "Address feedback"]);
    await f.service.syncWorkspace(d.id);
    f.service.approveCode(d.id, digest(f.store.get(d.id).workspace!.preview));
    await f.service.push(d.id, false);
    assert.equal(
      (await current()).head,
      await gitText(root, ["rev-parse", "HEAD"]),
    );
    await git(root, ["commit", "--amend", "-m", "Address feedback (amended)"]);
    await f.service.syncWorkspace(d.id);
    assert.equal(f.store.get(d.id).workspace!.preview!.rewrite, true);
    f.service.approveCode(d.id, digest(f.store.get(d.id).workspace!.preview));
    await assert.rejects(f.service.push(d.id, false), /explicit approval/);
    await f.service.push(d.id, true);
    assert.equal(
      (await current()).head,
      await gitText(root, ["rev-parse", "HEAD"]),
    );
    await fs.writeFile(path.join(root, "a.ts"), "const a = 3;\r\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "Another fix"]);
    await f.service.syncWorkspace(d.id);
    f.service.approveCode(d.id, digest(f.store.get(d.id).workspace!.preview));
    f.remote.pr = async () => {
      const prior = await current();
      await git(bare, [
        "update-ref",
        `refs/heads/${remoteBranch}`,
        original,
        prior.head,
      ]);
      return prior;
    };
    await assert.rejects(f.service.push(d.id, false), /stale info|rejected/);
    assert.equal((await current()).head, original);
  } finally {
    await f.close();
  }
});
