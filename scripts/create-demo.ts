// Offline synthetic data for documentation screenshots. No GitHub/Copilot requests.
// Run with: node --import tsx scripts/create-demo.ts
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/main/store";
import { newDraft } from "../src/main/domain";
import { fileSnapshot, git, gitText } from "../src/main/git";
async function main() {
  const root = path.join(os.tmpdir(), "ReviewForge-demo");
  const repository = path.join(root, "demo-shop");
  await mkdir(repository, { recursive: true });
  await git(repository, ["init", "-b", "feature/cart-summary"]);
  const before =
    "export function average(prices: number[]): number {\n  if (prices.length === 0) return 0;\n  const total = prices.reduce((sum, price) => sum + price, 0);\n  return total / prices.length;\n}\n";
  const after =
    "export function average(prices: number[]): number {\n  const total = prices.reduce((sum, price) => sum + price, 0);\n  return total / prices.length;\n}\n";
  await mkdir(path.join(repository, "src"), { recursive: true });
  await writeFile(path.join(repository, "src/cart.ts"), before);
  await git(repository, ["add", "."]);
  await git(repository, [
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Demo",
    "-c",
    "user.email=demo@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "Add cart average",
  ]);
  const base = await gitText(repository, ["rev-parse", "HEAD"]);
  await writeFile(path.join(repository, "src/cart.ts"), after);
  await git(repository, ["add", "."]);
  await git(repository, [
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Demo",
    "-c",
    "user.email=demo@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "Simplify cart summary",
  ]);
  const head = await gitText(repository, ["rev-parse", "HEAD"]);
  const files = [
    fileSnapshot("src/cart.ts", Buffer.from(before), Buffer.from(after)),
    fileSnapshot(
      "src/format.ts",
      Buffer.from('export const currency = "USD";\n'),
      Buffer.from('export const currencyCode = "USD";\n'),
    ),
  ];
  for (const f of files)
    f.reviews = {
      "0": "### Demonstration assessment\n\nChecked the changed code and its edge cases. This is **synthetic documentation data**, not a live Copilot result.\n\n- Inspect empty inputs.\n- Keep names consistent across callers.\n\nNo tests were run.",
    };
  const local = newDraft({
    kind: "local",
    capturedAt: new Date().toISOString(),
    title: "demo-shop · Latest commit",
    repository,
    branch: "feature/cart-summary",
    head,
    base,
    localScope: "latest",
    files,
  });
  local.id = "demo-local";
  local.analysisState = "complete";
  local.analysisScope = "detailed";
  local.summary =
    "## Demo review\n\nFound **one defect** and **one readability suggestion**.\n\n- Restore the empty-cart guard before merging.\n- Prefer a name that describes the returned amount.\n\n> Synthetic example for documentation. No tests were run.";
  local.findings = [
    {
      id: "demo-bug",
      path: "src/cart.ts",
      line: 3,
      side: "RIGHT",
      title: "Guard empty carts before dividing",
      body: "When `prices` is empty, this returns `0 / 0`, which is `NaN`. Restore the empty-array guard and add a regression test.",
      kind: "bug",
      severity: "medium",
      decision: "include",
      origin: "manual",
    },
    {
      id: "demo-nit",
      path: "src/cart.ts",
      line: 2,
      side: "RIGHT",
      title: "Use a more descriptive total name",
      body: "Consider `totalPrice` to make the unit clearer. This is a non-blocking readability suggestion.",
      kind: "nit",
      severity: "low",
      decision: "pending",
      origin: "manual",
    },
  ];
  const remote = structuredClone(local);
  remote.id = "demo-remote";
  remote.snapshot.kind = "remote";
  remote.snapshot.title = "Improve cart summary";
  remote.snapshot.pr = {
    owner: "demo",
    repo: "shop",
    number: 42,
    url: "https://github.com/demo/shop/pull/42",
    title: "Improve cart summary",
    body: "## Goal\nSimplify the cart summary while preserving behavior.\n\n## Acceptance criteria\n- Empty carts return zero.\n- Currency values stay consistent.\n- Add regression coverage for empty inputs.\n\nSynthetic documentation example; this is not a real pull request.",
    head,
    base,
    branch: "feature/cart-summary",
    headRepo: "demo/shop",
    baseBranch: "main",
    state: "open",
  };
  remote.feedback = [
    {
      id: "demo-thread",
      threadID: "synthetic-only",
      commentID: 1,
      path: "src/cart.ts",
      line: 3,
      side: "RIGHT",
      body: "Please restore the empty-cart guard so the average stays **0** for an empty cart. Add a regression test too.",
      author: "demo-reviewer",
      url: "",
      context: files[0].patch,
      resolved: false,
      outdated: false,
      selected: true,
      reply:
        "Restored the empty-cart guard in the local proposal. I will verify the regression test before publishing.\n\n*Local draft — code has not been pushed.*",
      resolve: true,
    },
    {
      id: "demo-resolved",
      body: "Thank you for clarifying the currency naming.",
      author: "demo-reviewer",
      url: "",
      resolved: true,
      outdated: false,
      selected: false,
      reply: "",
      resolve: false,
    },
  ];
  remote.workspace = {
    directory: repository,
    originalHead: base,
    head,
    expectedRemote: head,
  };
  remote.proposals = [
    {
      id: "demo-proposal",
      path: "src/cart.ts",
      original: after,
      content: before,
      reason: "Restore a zero result for empty carts.",
      selected: true,
      status: "pending",
    },
  ];
  const data = path.join(root, "profile", "data");
  const store = new Store(data);
  store.save(local);
  store.save(remote);
  store.close();
  await writeFile(
    path.join(root, "profile", "settings.json"),
    JSON.stringify({
      language: "en",
      dataDirectory: data,
      model: "",
      authorName: "",
      authorEmail: "",
    }),
  );
  console.log(path.join(root, "profile"));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
