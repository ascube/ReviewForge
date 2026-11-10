import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  git,
  gitText,
  captureLocal,
  repoInfo,
  preserveEndings,
  workspaceDigest,
  codePreview,
  createIsolated,
} from "../src/main/git";
import { chunks, safeFile, descriptionMissing } from "../src/main/util";
export async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reviewforge-test-"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Fixture"]);
  await git(root, ["config", "user.email", "fixture@example.test"]);
  await git(root, ["config", "commit.gpgsign", "false"]);
  await fs.writeFile(path.join(root, "a.ts"), "export const answer = 1;\r\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "initial"]);
  return root;
}
test("capture scopes preserve snapshots, exclude ignored tracked and untracked files, include binary omissions", async () => {
  const root = await fixture();
  try {
    await fs.writeFile(path.join(root, ".gitignore"), "build/\nignored.txt\n");
    await fs.writeFile(path.join(root, "ignored.txt"), "generated");
    await git(root, ["add", "-f", "ignored.txt"]);
    await git(root, ["add", ".gitignore"]);
    await git(root, ["commit", "-m", "ignore"]);
    await fs.mkdir(path.join(root, "build"));
    await fs.writeFile(path.join(root, "build", "junk"), "ignored");
    await fs.writeFile(path.join(root, "a.ts"), "export const answer = 2;\r\n");
    await fs.writeFile(path.join(root, "new.md"), "# Added\n");
    await fs.writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2]));
    const snapshot = await captureLocal(root, "working", "", "", () => {});
    assert.deepEqual(snapshot.files.map((f) => f.path).sort(), [
      "a.ts",
      "binary.bin",
      "new.md",
    ]);
    assert.match(
      snapshot.files.find((f) => f.path === "binary.bin")!.omission!,
      /Binary/,
    );
    assert.equal(
      snapshot.files.find((f) => f.path === "a.ts")!.after,
      "export const answer = 2;\r\n",
    );
    await fs.writeFile(path.join(root, "a.ts"), "external");
    assert.equal(
      snapshot.files.find((f) => f.path === "a.ts")!.after,
      "export const answer = 2;\r\n",
    );
    const latest = await captureLocal(root, "latest", "", "", () => {});
    assert(!latest.files.some((f) => f.path === "new.md"));
    const whole = await captureLocal(root, "repository", "", "", () => {});
    assert(!whole.files.some((f) => f.path === "ignored.txt"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("latest root commit, branch picker and merge-base capture work without checkout", async () => {
  const root = await fixture();
  try {
    const rootSnapshot = await captureLocal(root, "latest", "", "", () => {});
    assert.equal(rootSnapshot.files.length, 1);
    await git(root, ["checkout", "-b", "feature"]);
    await fs.writeFile(path.join(root, "a.ts"), "const changed = 3;\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "change"]);
    const info = await repoInfo(root);
    assert.equal(info.branch, "feature");
    assert(info.branches.includes("main"));
    const snapshot = await captureLocal(root, "branch", "main", "", () => {});
    assert.equal(snapshot.files.length, 1);
    assert.equal((await repoInfo(root)).branch, "feature");
    await assert.rejects(captureLocal(root, "branch", "--all", "", () => {}));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("line endings and EOF survive focused replacement including mixed files", () => {
  assert.equal(preserveEndings("a\r\nb\r\n", "a\nbb\n"), "a\r\nbb\r\n");
  assert.equal(preserveEndings("a\nb", "a\nbb\n"), "a\nbb");
  assert.equal(preserveEndings("a\rb\r", "a\nbb\n"), "a\rbb\r");
  assert.equal(
    preserveEndings("a\r\nb\nc\r\n", "a\nb\ncc\n"),
    "a\r\nb\ncc\r\n",
  );
  assert.equal(preserveEndings("", "new\n"), "new");
});
test("path guard rejects traversal and symlinks", async () => {
  const root = await fixture();
  try {
    await assert.rejects(safeFile(root, "../outside"));
    await assert.rejects(safeFile(root, ".git/config"));
    await assert.rejects(safeFile(root, "C:\\Windows\\file"));
    await fs.symlink(
      process.platform === "win32" ? root : path.join(root, "a.ts"),
      path.join(root, "link"),
      process.platform === "win32" ? "junction" : "file",
    );
    await assert.rejects(safeFile(root, "link"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("large file parts retain every character and line positions", () => {
  const text = "a\n".repeat(40000) + "x".repeat(65000);
  const parts = chunks(text);
  assert.equal(parts.map((p) => p.text).join(""), text);
  assert(parts.every((p) => p.text.length <= 32000));
  assert(parts.length > 3);
  assert(descriptionMissing(" <!-- template -->\n"));
  assert(!descriptionMissing("## Requirements\nKeep behavior"));
});
test("isolated clone keeps source untouched and detects external amend rewrite", async () => {
  const root = await fixture(),
    parent = await fs.mkdtemp(path.join(os.tmpdir(), "reviewforge-copy-"));
  try {
    const original = await gitText(root, ["rev-parse", "HEAD"]);
    const workspace = await createIsolated(
      root,
      path.join(parent, "workspace"),
      original,
    );
    await git(workspace, ["config", "user.name", "Fixture"]);
    await git(workspace, ["config", "user.email", "fixture@example.test"]);
    await git(workspace, ["config", "commit.gpgsign", "false"]);
    await fs.writeFile(path.join(workspace, "a.ts"), "changed\r\n");
    const before = await workspaceDigest(workspace);
    await git(workspace, ["add", "."]);
    await git(workspace, ["commit", "--amend", "-m", "amended"]);
    const preview = await codePreview(workspace, original, original);
    assert(preview.rewrite);
    assert(!preview.dirty);
    assert.notEqual(preview.digest, before);
    assert.equal(await gitText(root, ["rev-parse", "HEAD"]), original);
    assert.equal(
      await fs.readFile(path.join(root, "a.ts"), "utf8"),
      "export const answer = 1;\r\n",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(parent, { recursive: true, force: true });
  }
});
