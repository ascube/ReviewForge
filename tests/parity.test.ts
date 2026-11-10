import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Store } from "../src/main/store";
import { Service, type AI } from "../src/main/service";
import { GitHub } from "../src/main/github";
import { newDraft, reviewFingerprint } from "../src/main/domain";
import {
  git,
  gitText,
  captureLocal,
  fileSnapshot,
  workspaceDigest,
  workingTree,
} from "../src/main/git";
import { digest } from "../src/main/util";
import { readRecovery } from "../src/main/recovery";
import { reviewReport } from "../src/main/report";
import { githubCredential } from "../src/main/credentials";
import { copyStore } from "../src/main/storage";
import { copilotDiagnostic } from "../src/main/diagnostics";
import type { PR, Feedback } from "../src/shared/types";
const pr: PR = {
  owner: "example",
  repo: "fixture",
  number: 1,
  url: "https://github.com/example/fixture/pull/1",
  title: "Fixture",
  body: "Fixture requirements",
  head: "head",
  base: "base",
  branch: "feature",
  headRepo: "example/fixture",
  baseBranch: "main",
  state: "open",
  authorID: 2,
};
class Fake extends GitHub {
  current = { ...pr };
  userReads = 0;
  reviewReads = 0;
  posts = 0;
  replyPosts = 0;
  resolved = 0;
  remoteReviews: any[] = [];
  feedbackReads = 0;
  items: Feedback[] = [];
  constructor() {
    super("", async () => {
      throw Error("Network forbidden in tests");
    });
  }
  override async pr() {
    return this.current;
  }
  override async request() {
    this.userReads++;
    return { login: "fixture", id: 1 };
  }
  override async reviews() {
    this.reviewReads++;
    return this.remoteReviews;
  }
  override async createReview() {
    this.posts++;
    return {
      html_url: pr.url,
      state: "PENDING",
      commit_id: "wrong",
      user: { id: 99 },
    };
  }
  override async reply(_pr: PR, f: Feedback, body: string) {
    this.replyPosts++;
    return {
      body,
      html_url: pr.url + "#comment",
      user: { id: 1 },
      in_reply_to_id: f.commentID,
    };
  }
  override async resolve(id: string) {
    this.resolved++;
    return { resolveReviewThread: { thread: { id, isResolved: true } } };
  }
  override async feedback() {
    this.feedbackReads++;
    return this.items;
  }
  override async containsCommit(_repo: string, commit: string, head: string) {
    return commit === head;
  }
}
const noAI: AI = {
  run: async () => {
    throw Error("Unexpected model request");
  },
  cancel() {},
};
async function setup(ai: AI = noAI) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reviewforge-parity-"));
  const repo = path.join(root, "repo");
  await fs.mkdir(repo);
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.name", "Fixture"]);
  await git(repo, ["config", "user.email", "fixture@example.invalid"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  const store = new Store(path.join(root, "data"));
  const api = new Fake();
  const service = new Service(
    store,
    {
      language: "en",
      dataDirectory: store.directory,
      model: "",
      authorName: "Fixture",
      authorEmail: "fixture@example.invalid",
      githubConfigured: false,
      copilotConfigured: false,
    },
    ai,
    { read: async () => "" },
    () => {},
    () => api,
  );
  return {
    root,
    repo,
    store,
    api,
    service,
    async close() {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
async function initial(repo: string) {
  await fs.writeFile(path.join(repo, "a.ts"), "const a = 1;\n");
  await fs.writeFile(path.join(repo, "b.ts"), "const b = 1;\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "initial"]);
  return gitText(repo, ["rev-parse", "HEAD"]);
}
function remoteDraft() {
  const d = newDraft({
    kind: "remote",
    capturedAt: new Date().toISOString(),
    title: "Fixture",
    pr: { ...pr },
    head: pr.head,
    base: pr.base,
    branch: pr.branch,
    files: [fileSnapshot("a.ts", Buffer.from("one\n"), Buffer.from("two\n"))],
  });
  d.summary = "Reviewed";
  return d;
}
function feedback(id: string, reply = "Human-written reply"): Feedback {
  return {
    id,
    threadID: "thread-" + id,
    commentID: 1,
    path: "a.ts",
    body: "Please fix this",
    author: "fixture",
    url: pr.url,
    resolved: false,
    outdated: false,
    selected: true,
    reply,
    resolve: false,
  };
}
test("unborn repositories can capture and review working files, but latest requires a commit", async () => {
  const c = await setup();
  try {
    await fs.writeFile(path.join(c.repo, "a.ts"), "new\n");
    for (const scope of ["working", "repository"] as const) {
      const snap = await captureLocal(c.repo, scope, "", "", () => {});
      assert.equal(snap.head, "");
      assert.equal(snap.files[0].after, "new\n");
      assert.equal(snap.files[0].omission, undefined);
    }
    await assert.rejects(
      captureLocal(c.repo, "latest", "", "", () => {}),
      /no commits/,
    );
  } finally {
    await c.close();
  }
});
test("shallow latest commit requires parent history instead of inventing root additions", async () => {
  const c = await setup();
  try {
    await initial(c.repo);
    await fs.writeFile(path.join(c.repo, "a.ts"), "const a = 2;\n");
    await git(c.repo, ["commit", "-am", "change only a"]);
    const clone = path.join(c.root, "shallow");
    await git(c.root, [
      "clone",
      "--depth",
      "1",
      pathToFileURL(c.repo).toString(),
      clone,
    ]);
    await assert.rejects(
      captureLocal(clone, "latest", "", "", () => {}),
      /parent commit.*unavailable/,
    );
    await git(clone, ["fetch", "--unshallow"]);
    const snap = await captureLocal(clone, "latest", "", "", () => {});
    assert.deepEqual(
      snap.files.map((f) => f.path),
      ["a.ts"],
    );
  } finally {
    await c.close();
  }
});
test("fix generation rejects stale snapshot before invoking Copilot", async () => {
  const c = await setup();
  try {
    await initial(c.repo);
    const d = newDraft(
      await captureLocal(c.repo, "repository", "", "", () => {}),
    );
    d.findings = [
      {
        id: "f",
        path: "a.ts",
        line: 1,
        side: "RIGHT",
        title: "Old finding",
        body: "Based on snapshot",
        kind: "bug",
        severity: "P2",
        decision: "include",
        origin: "manual",
      },
    ];
    c.store.save(d);
    await fs.writeFile(
      path.join(c.repo, "a.ts"),
      "const externallyChanged = true;\n",
    );
    await assert.rejects(
      c.service.generateFix(d.id, ""),
      /changed after review/,
    );
    assert.equal(c.store.get(d.id).proposals.length, 0);
  } finally {
    await c.close();
  }
});
test("multi-file failure restores already written files and retains durable recovery copy", async () => {
  const c = await setup();
  const rename = fs.rename;
  try {
    await initial(c.repo);
    const d = newDraft(
      await captureLocal(c.repo, "repository", "", "", () => {}),
    );
    d.proposalContext = await workspaceDigest(c.repo);
    d.proposals = ["a", "b"].map((name) => ({
      id: name,
      path: name + ".ts",
      original: `const ${name} = 1;\n`,
      existed: true,
      content: `const ${name} = 2;\n`,
      reason: "Fixture",
      selected: true,
      status: "pending",
    }));
    c.store.save(d);
    fs.rename = async (a, b) => {
      if (String(b).endsWith("/b.ts")) throw Error("Synthetic write failure");
      return rename(a, b);
    };
    await assert.rejects(
      c.service.applyProposals(d.id, digest(d.proposals)),
      /Synthetic write failure/,
    );
    assert.equal(
      await fs.readFile(path.join(c.repo, "a.ts"), "utf8"),
      "const a = 1;\n",
    );
    assert.equal(
      await fs.readFile(path.join(c.repo, "b.ts"), "utf8"),
      "const b = 1;\n",
    );
    const saved = c.store.get(d.id);
    assert.equal(saved.proposals[0].status, "pending");
    assert.equal((await readRecovery(saved.fixBackup!)).state, "restored");
  } finally {
    fs.rename = rename;
    await c.close();
  }
});
test("review checks identity and pending state, and rejects a mismatched PENDING publication response", async () => {
  const c = await setup();
  try {
    const d = remoteDraft();
    d.event = "APPROVE";
    d.analysisState = "complete";
    d.snapshot.files[0].reviews = { "0": "Reviewed" };
    c.store.save(d);
    c.service.approveReview(d.id, reviewFingerprint(d));
    await assert.rejects(c.service.publishReview(d.id), /does not match/);
    assert.equal(c.api.userReads, 1);
    assert.equal(c.api.reviewReads, 1);
    assert.equal(c.api.posts, 1);
    assert.equal(c.store.get(d.id).publication?.state, "uncertain");
  } finally {
    await c.close();
  }
});
test("pending/self-authored reviews are blocked before a network write", async () => {
  const c = await setup();
  try {
    const d = remoteDraft();
    d.event = "APPROVE";
    d.analysisState = "complete";
    c.store.save(d);
    c.service.approveReview(d.id, reviewFingerprint(d));
    c.api.current.authorID = 1;
    await assert.rejects(c.service.publishReview(d.id), /own PR/);
    c.api.current.authorID = 2;
    c.api.remoteReviews = [{ state: "PENDING", user: { id: 1 } }];
    await assert.rejects(c.service.publishReview(d.id), /pending review/);
    assert.equal(c.api.posts, 0);
  } finally {
    await c.close();
  }
});
test("reconciliation rejects PENDING or wrong-author review and confirms correct published review", async () => {
  const c = await setup();
  try {
    const d = remoteDraft();
    d.publication = {
      state: "uncertain",
      marker: "audit-marker",
      body: "Review",
      authorID: 1,
    };
    c.store.save(d);
    for (const r of [
      { state: "PENDING", user: { id: 1 } },
      { state: "COMMENTED", user: { id: 99 } },
    ]) {
      c.api.remoteReviews = [
        { ...r, body: "audit-marker", commit_id: pr.head, html_url: pr.url },
      ];
      await assert.rejects(c.service.reconcileReview(d.id));
      assert.equal(c.store.get(d.id).publication?.state, "uncertain");
    }
    c.api.remoteReviews = [
      {
        state: "COMMENTED",
        user: { id: 1 },
        body: "audit-marker",
        commit_id: pr.head,
        html_url: pr.url,
      },
    ];
    await c.service.reconcileReview(d.id);
    assert.equal(c.store.get(d.id).publication?.state, "published");
  } finally {
    await c.close();
  }
});
test("failed model check clears previously returned models", async () => {
  let n = 0;
  const c = await setup({
    cancel() {},
    async run() {
      if (n++) throw Error("Synthetic auth failure");
      return {
        models: ["old-model"],
        identity: { login: "fixture", source: "GitHub CLI" },
      };
    },
  });
  try {
    await c.service.connection();
    assert.equal(c.service.settings.copilotIdentity?.login, "fixture");
    await assert.rejects(c.service.connection());
    assert.equal(c.service.settings.copilotIdentity, undefined);
    assert.deepEqual(c.service.models, []);
  } finally {
    await c.close();
  }
});
test("reply generation is transactional and preserves edited replies; suggestions require explicit adoption", async () => {
  let n = 0;
  const c = await setup({
    cancel() {},
    async run(m, tool) {
      if (n++ === 1) throw Error("Synthetic model failure");
      await tool("reply", {
        id: m.context.items[0].id,
        body: "New model reply",
        evidence: "a.ts changed; no tests run",
      });
      return "Drafted";
    },
  });
  try {
    const head = await initial(c.repo);
    await fs.writeFile(path.join(c.repo, "a.ts"), "const a = 2;\n");
    const d = remoteDraft();
    d.workspace = {
      directory: c.repo,
      head,
      originalHead: head,
      expectedRemote: head,
    };
    d.feedback = [feedback("one"), feedback("two")];
    c.api.current.head = head;
    c.store.save(d);
    await assert.rejects(
      c.service.generateReplies(d.id, ""),
      /Synthetic model failure/,
    );
    let saved = c.store.get(d.id);
    assert(
      saved.feedback.every(
        (f) => f.reply === "Human-written reply" && !f.copilotDraft,
      ),
    );
    await c.service.generateReplies(d.id, "", "one");
    saved = c.store.get(d.id);
    assert.equal(saved.feedback[0].reply, "Human-written reply");
    assert.equal(
      saved.feedback[0].copilotDraft?.evidence,
      "a.ts changed; no tests run",
    );
    await c.service.useReplyDraft(d.id, "one", true);
    assert.equal(c.store.get(d.id).feedback[0].reply, "New model reply");
    assert.equal(c.store.get(d.id).feedback[1].reply, "Human-written reply");
    assert.equal(c.api.replyPosts, 0);
  } finally {
    await c.close();
  }
});
test("confirmed pushed commit remains replyable with a newer remote descendant and later local edits", async () => {
  const c = await setup();
  try {
    const base = await initial(c.repo);
    await fs.writeFile(path.join(c.repo, "a.ts"), "const a = 2;\n");
    await git(c.repo, ["commit", "-am", "fixed"]);
    const fixed = await gitText(c.repo, ["rev-parse", "HEAD"]);
    await fs.writeFile(path.join(c.repo, "b.ts"), "const b = 2;\n");
    await git(c.repo, ["commit", "-am", "later remote change"]);
    const later = await gitText(c.repo, ["rev-parse", "HEAD"]);
    await git(c.repo, ["checkout", "--detach", fixed]);
    await fs.writeFile(path.join(c.repo, "b.ts"), "local work in progress\n");
    const d = remoteDraft();
    d.workspace = {
      directory: c.repo,
      head: fixed,
      originalHead: base,
      expectedRemote: later,
      pushedHead: fixed,
    };
    d.feedback = [feedback("one")];
    c.api.current.head = later;
    c.api.containsCommit = async (_r, commit, head) => {
      try {
        await git(c.repo, ["merge-base", "--is-ancestor", commit, head]);
        return true;
      } catch {
        return false;
      }
    };
    c.store.save(d);
    const preview = await c.service.previewReplies(d.id);
    assert.equal(preview.head, fixed);
    assert.match(preview.context!.diff, /const a = 2/);
    assert(!preview.context!.diff.includes("work in progress"));
    assert.equal(
      await fs.readFile(path.join(c.repo, "b.ts"), "utf8"),
      "local work in progress\n",
    );
  } finally {
    await c.close();
  }
});
test("reply publication revalidates target and validates resolution response", async () => {
  const c = await setup();
  try {
    const head = await initial(c.repo);
    const d = remoteDraft();
    d.workspace = {
      directory: c.repo,
      head,
      originalHead: head,
      expectedRemote: head,
      pushedHead: head,
    };
    d.feedback = [{ ...feedback("one"), resolve: true }];
    c.api.current.head = head;
    c.api.items = d.feedback.map((f) => ({ ...f, body: "Edited by reviewer" }));
    c.store.save(d);
    const p = await c.service.previewReplies(d.id);
    await c.service.approveReplies(d.id, p.fingerprint);
    await assert.rejects(
      c.service.publishReplies(d.id),
      /original comment changed/,
    );
    assert.equal(c.api.replyPosts, 0);
    assert.equal(c.api.resolved, 0);
    c.api.items = d.feedback;
    c.api.resolve = async () => ({
      resolveReviewThread: { thread: { id: "thread-one", isResolved: false } },
    });
    await assert.rejects(
      c.service.publishReplies(d.id),
      /resolution is not confirmed/,
    );
    assert.equal(c.api.replyPosts, 1);
    assert(!c.store.get(d.id).feedback[0].resolveDone);
    assert(c.api.feedbackReads >= 3);
  } finally {
    await c.close();
  }
});
test("workspace editor preserves EOL and guards external edits; discard and restore have previews", async () => {
  const c = await setup();
  try {
    const head = await initial(c.repo);
    await fs.writeFile(path.join(c.repo, "a.ts"), "edited\r\n");
    const d = remoteDraft();
    d.workspace = {
      directory: c.repo,
      head,
      originalHead: head,
      expectedRemote: head,
    };
    c.store.save(d);
    let file = await c.service.readWorkspaceFile(d.id, "a.ts");
    await c.service.writeWorkspaceFile(
      d.id,
      "a.ts",
      "manual\n",
      file.fingerprint,
    );
    assert.equal(
      await fs.readFile(path.join(c.repo, "a.ts"), "utf8"),
      "manual\r\n",
    );
    await assert.rejects(
      c.service.writeWorkspaceFile(d.id, "a.ts", "stale", file.fingerprint),
      /changed externally/,
    );
    const recovery = await c.service.previewRecovery(d.id);
    await c.service.restoreFix(d.id, recovery.fingerprint);
    assert.equal(
      await fs.readFile(path.join(c.repo, "a.ts"), "utf8"),
      "edited\r\n",
    );
    file = await c.service.readWorkspaceFile(d.id, "a.ts");
    await git(c.repo, ["add", "a.ts"]);
    await c.service.writeWorkspaceFile(
      d.id,
      "a.ts",
      "",
      file.fingerprint,
      true,
    );
    assert.equal(
      await fs.readFile(path.join(c.repo, "a.ts"), "utf8"),
      "const a = 1;\n",
    );
    assert.equal(await gitText(c.repo, ["status", "--porcelain"]), "");
  } finally {
    await c.close();
  }
});
test("recovery refuses to overwrite edits made after applying proposals", async () => {
  const c = await setup();
  try {
    const head = await initial(c.repo);
    const d = remoteDraft();
    d.workspace = {
      directory: c.repo,
      head,
      originalHead: head,
      expectedRemote: head,
    };
    c.store.save(d);
    const file = await c.service.readWorkspaceFile(d.id, "a.ts");
    await c.service.writeWorkspaceFile(
      d.id,
      "a.ts",
      "manual\n",
      file.fingerprint,
    );
    const recovery = await c.service.previewRecovery(d.id);
    await fs.writeFile(path.join(c.repo, "a.ts"), "later edit\n");
    await assert.rejects(
      c.service.restoreFix(d.id, recovery.fingerprint),
      /later edits/,
    );
    assert.equal(
      await fs.readFile(path.join(c.repo, "a.ts"), "utf8"),
      "later edit\n",
    );
  } finally {
    await c.close();
  }
});
test("report includes per-file assessments, omissions and finding decisions; original finding survives edit", async () => {
  const c = await setup();
  try {
    const d = remoteDraft();
    d.snapshot.files[0].reviews = { "0": "Read all changes" };
    d.snapshot.files.push({
      ...d.snapshot.files[0],
      path: "binary.dat",
      omission: "Binary or non-UTF-8 file",
    });
    d.findings = [
      {
        id: "f",
        title: "Issue",
        body: "Original model body",
        path: "a.ts",
        line: 1,
        side: "RIGHT",
        severity: "P2",
        kind: "bug",
        decision: "include",
        origin: "copilot",
        originalBody: "Original model body",
      },
    ];
    c.store.save(d);
    c.service.edit(d.id, {
      findings: [
        {
          ...d.findings[0],
          body: "Human correction",
          originalBody: "Tampered",
        },
      ],
    });
    const saved = c.store.get(d.id);
    assert.equal(saved.findings[0].originalBody, "Original model body");
    for (const language of ["en", "zh-Hans"] as const) {
      const report = reviewReport(saved, language);
      for (const text of [
        "Read all changes",
        "binary.dat",
        "Human correction",
        "include",
      ])
        assert(report.includes(text));
    }
  } finally {
    await c.close();
  }
});
test("credential precedence and diagnostic classification do not expose tokens", async () => {
  let calls = 0;
  const cli = async () => {
    calls++;
    return "cli-secret";
  };
  assert.deepEqual(await githubCredential("saved", { GH_TOKEN: "env" }, cli), {
    token: "saved",
    source: "Settings",
  });
  assert.deepEqual(await githubCredential("", { GH_TOKEN: "env" }, cli), {
    token: "env",
    source: "GH_TOKEN",
  });
  assert.equal(calls, 0);
  assert.deepEqual(await githubCredential("", {}, cli), {
    token: "cli-secret",
    source: "GitHub CLI",
  });
  assert.equal(calls, 1);
  for (const message of [
    "429 rate limit",
    "self signed certificate",
    "ECONNRESET",
    "503 service unavailable",
    "ENOENT runtime",
    "SSO",
    "IP allow list",
    "401 unauthorized",
  ]) {
    const result = copilotDiagnostic(Error(message + " token-secret"), [
      "token-secret",
    ]);
    assert(!result.en.includes("token-secret"));
    assert(!result.zh.includes("token-secret"));
    assert(/[\u4e00-\u9fff]/.test(result.zh));
  }
});

test("moving local data verifies the store and rewrites recovery/workspace paths without changing source", async () => {
  const c = await setup();
  let copy: Store | undefined;
  try {
    const head = await initial(c.repo),
      owned = path.join(c.store.directory, "workspaces", "fixture");
    await fs.mkdir(path.dirname(owned), { recursive: true });
    await fs.rename(c.repo, owned);
    const d = remoteDraft();
    d.workspace = {
      directory: owned,
      head,
      originalHead: head,
      expectedRemote: head,
    };
    c.store.save(d);
    const file = await c.service.readWorkspaceFile(d.id, "a.ts");
    await c.service.writeWorkspaceFile(
      d.id,
      "a.ts",
      "edited\n",
      file.fingerprint,
    );
    copy = await copyStore(c.store, path.join(c.root, "copied-data"));
    const copied = copy.get(d.id),
      original = c.store.get(d.id);
    assert.notEqual(copied.workspace!.directory, original.workspace!.directory);
    assert.equal(
      (await readRecovery(copied.fixBackup!)).root,
      await fs.realpath(copied.workspace!.directory),
    );
    assert.equal(
      (await readRecovery(original.fixBackup!)).root,
      await fs.realpath(original.workspace!.directory),
    );
    assert.equal(
      await fs.readFile(path.join(copied.workspace!.directory, "a.ts"), "utf8"),
      "edited\n",
    );
    await assert.rejects(
      copyStore(c.store, c.store.directory),
      /separate data/,
    );
  } finally {
    copy?.close();
    await c.close();
  }
});
test("offline demo opens without credentials and a discarded fix plan keeps its recovery record", async () => {
  const c = await setup();
  try {
    const d = await c.service.openDemo();
    assert.equal(d.snapshot.kind, "local");
    assert.equal(d.findings.length, 1);
    assert.equal(c.api.posts, 0);
    assert.equal(c.api.userReads, 0);
    d.proposals = [
      {
        id: "one",
        path: "average.ts",
        original: d.snapshot.files[0].after,
        content: "replacement\n",
        existed: true,
        reason: "demo",
        selected: true,
        status: "pending",
      },
    ];
    d.proposalContext = await workspaceDigest(d.snapshot.repository!);
    c.store.save(d);
    await c.service.applyProposals(d.id, digest(d.proposals));
    const saved = c.store.get(d.id),
      backup = saved.fixBackup;
    c.service.discardProposals(d.id, digest(saved.proposals));
    assert.equal(c.store.get(d.id).fixBackup, backup);
    assert.equal(c.store.get(d.id).proposals.length, 0);
  } finally {
    await c.close();
  }
});

test("capture distinguishes an empty text file from a deletion", async () => {
  const c = await setup();
  try {
    await initial(c.repo);
    await fs.writeFile(path.join(c.repo, "a.ts"), "");
    await fs.writeFile(path.join(c.repo, "empty.txt"), "");
    const snapshot = await captureLocal(c.repo, "working", "", "", () => {});
    assert.equal(
      snapshot.files.find((f) => f.path === "a.ts")?.status,
      "modified",
    );
    assert.equal(
      snapshot.files.find((f) => f.path === "empty.txt")?.status,
      "added",
    );
  } finally {
    await c.close();
  }
});

test("feedback refresh retains missing targets with uncertain publication records", async () => {
  const c = await setup();
  try {
    const d = remoteDraft();
    d.feedback = [
      {
        ...feedback("missing"),
        replyAttempt: {
          marker: "pending-marker",
          body: "Reply",
          authorID: 1,
          state: "uncertain",
        },
      },
    ];
    c.store.save(d);
    c.api.items = [];
    await c.service.loadFeedback(d.id);
    const saved = c.store.get(d.id);
    assert.equal(saved.feedback.length, 1);
    assert.equal(saved.feedback[0].unavailable, true);
    assert.equal(saved.feedback[0].replyAttempt?.state, "uncertain");
    assert.throws(() => c.store.delete(d.id));
  } finally {
    await c.close();
  }
});
