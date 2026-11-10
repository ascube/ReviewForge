// Opt-in live Copilot validation. Synthetic repository only; GitHub mutations are prohibited.
import { app } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import assert from "node:assert/strict";
import { Copilot } from "../src/main/copilot";
import { Service } from "../src/main/service";
import { Store } from "../src/main/store";
import { GitHub } from "../src/main/github";
import { git, gitText, captureLocal } from "../src/main/git";
import { newDraft } from "../src/main/domain";
app.whenReady().then(async () => {
  await fs.mkdir(".test-data", { recursive: true });
  const data = await fs.mkdtemp(path.resolve(".test-data/live-parity-"));
  const repository = path.join(data, "fixture-repo"),
    store = new Store(path.join(data, "data"));
  try {
    await fs.mkdir(repository);
    await git(repository, ["init", "-b", "feature/cart-average"]);
    const original =
      "export function average(values) {\r\n  return values.reduce((sum, value) => sum + value, 0) / values.length;\r\n}\r\n";
    await fs.writeFile(path.join(repository, "cart.mjs"), original);
    await git(repository, ["add", "."]);
    await git(repository, [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "Synthetic average function",
    ]);
    const head = await gitText(repository, ["rev-parse", "HEAD"]);
    const snapshot = await captureLocal(
      repository,
      "repository",
      "",
      "",
      () => {},
    );
    const local = newDraft(snapshot);
    store.save(local);
    const remoteSnapshot = {
      ...snapshot,
      kind: "remote" as const,
      pr: {
        owner: "fixture",
        repo: "shop",
        number: 1,
        url: "https://github.com/fixture/shop/pull/1",
        title: "Synthetic test only",
        body: "Return zero for empty carts.",
        head,
        base: head,
        branch: "feature/cart-average",
        baseBranch: "main",
        headRepo: "fixture/shop",
        state: "open",
      },
    };
    class FixtureGitHub extends GitHub {
      constructor() {
        super("", async () => {
          throw Error("GitHub transport prohibited in fixture");
        });
      }
      override async pr() {
        return remoteSnapshot.pr;
      }
      override async containsCommit(
        _repository: string,
        commit: string,
        remoteHead: string,
      ) {
        return commit === remoteHead;
      }
      override async reply(): Promise<any> {
        throw Error("Publication prohibited in fixture");
      }
      override async resolve(): Promise<any> {
        throw Error("Resolution prohibited in fixture");
      }
    }
    const service = new Service(
      store,
      {
        language: "en",
        dataDirectory: data,
        model: "",
        authorName: "",
        authorEmail: "",
        githubConfigured: false,
        copilotConfigured: false,
      },
      new Copilot(),
      { read: async () => "" },
      () => {},
      () => new FixtureGitHub(),
    );
    const models = await service.connection();
    assert(models.length > 0);
    console.log(`Copilot connected: ${models.length} models.`);
    const reviewed = await service.analyze(local.id, false);
    assert.equal(reviewed.analysisState, "complete");
    assert(Object.keys(reviewed.snapshot.files[0].reviews).length > 0);
    console.log(
      `Live review completed: ${reviewed.findings.length} findings saved locally.`,
    );
    await fs.writeFile(
      path.join(repository, "cart.mjs"),
      original.replace(
        "  return",
        "  if (values.length === 0) return 0;\r\n  return",
      ),
    );
    const draft = newDraft(remoteSnapshot);
    draft.workspace = {
      directory: repository,
      head,
      originalHead: head,
      expectedRemote: head,
    };
    draft.feedback = [
      {
        id: "fixture-thread",
        threadID: "fixture-thread",
        commentID: 1,
        path: "cart.mjs",
        body: "Please restore the empty-array guard so average([]) returns zero.",
        author: "fixture-reviewer",
        url: "",
        resolved: false,
        outdated: false,
        selected: true,
        reply: "Human reply stays unchanged until adoption.",
        resolve: true,
      },
    ];
    store.save(draft);
    const generated = await service.generateReplies(
      draft.id,
      "Be concise; mention the real code change and evidence. Do not claim tests were run.",
    );
    const suggestion = generated.feedback[0].copilotDraft;
    assert(suggestion?.body.trim());
    assert(suggestion.evidence.trim());
    assert.equal(generated.feedback[0].reply, draft.feedback[0].reply);
    await service.useReplyDraft(draft.id, "fixture-thread", true);
    await assert.rejects(
      service.previewReplies(draft.id),
      /not confirmed pushed/,
    );
    await fs.writeFile(
      path.join(data, "reply.md"),
      suggestion.body + "\n\n## Evidence\n\n" + suggestion.evidence + "\n",
    );
    await fs.writeFile(
      path.join(data, "validation.json"),
      JSON.stringify(
        {
          models: models.length,
          reviewedFiles: 1,
          findings: reviewed.findings.length,
          humanReplyPreserved: true,
          suggestionAdoptedLocally: true,
          prePushGateVerified: true,
          githubWrites: 0,
        },
        null,
        2,
      ),
    );
    console.log(
      "Live review and reply suggestion verified. Human text preserved; pre-push publication blocked. No GitHub API requests or writes. Results: " +
        data,
    );
    store.close();
    app.exit(0);
  } catch (error) {
    console.error(String(error));
    store.close();
    app.exit(1);
  }
});
