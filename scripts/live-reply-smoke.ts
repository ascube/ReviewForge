// Explicit, opt-in live Copilot check with synthetic feedback and fixture code only.
import { app } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import assert from "node:assert/strict";
import { Copilot } from "../src/main/copilot";
import { Service } from "../src/main/service";
import { Store } from "../src/main/store";
import { GitHub } from "../src/main/github";
import { gitText, captureLocal } from "../src/main/git";
import { newDraft } from "../src/main/domain";
const root = process.cwd(),
  repository = path.join(root, ".test-data/fixture-repo");
app.whenReady().then(async () => {
  const data = path.join(root, ".test-data/live-reply"),
    store = new Store(data);
  try {
    const head = await gitText(repository, ["rev-parse", "HEAD"]);
    const snapshot = await captureLocal(
      repository,
      "working",
      "",
      "",
      () => {},
    );
    snapshot.kind = "remote";
    snapshot.pr = {
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
    };
    const draft = newDraft(snapshot);
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
        path: "cart.js",
        body: "Please restore the empty-array guard so average([]) returns zero.",
        author: "fixture-reviewer",
        url: "",
        resolved: false,
        outdated: false,
        selected: true,
        reply: "",
        resolve: true,
      },
    ];
    store.save(draft);
    class FixtureGitHub extends GitHub {
      override async pr() {
        return snapshot.pr!;
      }
      override async reply() {
        throw Error("Publication prohibited in fixture");
      }
      override async resolve() {
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
      () => new FixtureGitHub(""),
    );
    const generated = await service.generateReplies(
      draft.id,
      "Be concise; mention the real code change, and do not claim tests were run.",
    );
    assert(generated.feedback[0].reply.trim());
    await assert.rejects(
      service.previewReplies(draft.id),
      /not confirmed pushed/,
    );
    await fs.writeFile(
      path.join(data, "reply.md"),
      generated.feedback[0].reply + "\n",
    );
    console.log(
      "Live Copilot reply generated and saved locally. Pre-push publication gate verified. No GitHub requests or writes.",
    );
    store.close();
    app.exit(0);
  } catch (e) {
    console.error(String(e));
    store.close();
    app.exit(1);
  }
});
