import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { setupEnvironment } from "dugite/build/lib/git-environment";
import { createTwoFilesPatch, diffArrays } from "diff";
import type {
  Snapshot,
  FileSnapshot,
  LocalScope,
  RepoInfo,
  CodePreview,
} from "../shared/types";
import {
  cleanEnv,
  fail,
  decodeText,
  safeFile,
  relativePath,
  digest,
  now,
  redact,
} from "./util";
export async function git(
  root: string,
  args: string[],
  extra: NodeJS.ProcessEnv = {},
  input?: Buffer,
): Promise<Buffer> {
  const { gitLocation, env } = setupEnvironment(
    {
      ...cleanEnv(),
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      ...extra,
    },
    {},
  );
  return new Promise((resolve, reject) => {
    const proc = execFile(
      gitLocation,
      [
        "-c",
        "core.hooksPath=" + path.join(os.tmpdir(), "reviewforge-no-hooks"),
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.quotepath=false",
        "-c",
        "diff.external=",
        "-c",
        "core.fsmonitor=false",
        "-C",
        root,
        ...args,
      ],
      {
        env,
        encoding: "buffer",
        maxBuffer: 256 * 1024 * 1024,
        timeout: 180000,
        windowsHide: true,
      },
      (err, out, stderr) =>
        err
          ? reject(
              new Error(
                redact(stderr.toString()).slice(0, 4000) || err.message,
              ),
            )
          : resolve(out),
    );
    if (input) proc.stdin?.end(input);
    else proc.stdin?.end();
  });
}
export const gitText = async (
  root: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) => (await git(root, args, env)).toString().trim();
export async function repoInfo(directory: string): Promise<RepoInfo> {
  const root = await fs.realpath(
    await gitText(directory, ["rev-parse", "--show-toplevel"]),
  );
  const head = await gitText(root, ["rev-parse", "HEAD"]);
  const branch =
    (await gitText(root, ["branch", "--show-current"])) || "(detached HEAD)";
  return {
    directory: root,
    head,
    branch,
    subject: await gitText(root, ["show", "-s", "--format=%s", "HEAD"]),
    branches: (
      await gitText(root, [
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads",
        "refs/remotes",
      ])
    )
      .split("\n")
      .filter((v) => v && !v.endsWith("/HEAD")),
  };
}
const emptyTree = async (root: string) =>
  gitText(root, ["hash-object", "-t", "tree", "--stdin"]);
export function fileSnapshot(
  filename: string,
  before: Buffer,
  after: Buffer,
  status = "modified",
  omission?: string,
): FileSnapshot {
  const a = decodeText(before),
    b = decodeText(after);
  return {
    path: filename,
    status,
    before: a ?? "",
    after: b ?? "",
    patch:
      a !== undefined && b !== undefined
        ? createTwoFilesPatch(filename, filename, a, b, "", "", { context: 3 })
        : "",
    omission:
      omission ||
      (a === undefined || b === undefined ? "Binary or non-UTF-8 file" : "") ||
      undefined,
    reviews: {},
  };
}
export async function readBlob(
  root: string,
  ref: string,
  filename: string,
): Promise<Buffer> {
  relativePath(filename);
  return git(root, ["show", `${ref}:${filename}`]);
}
async function blobOrEmpty(root: string, ref: string, filename: string) {
  try {
    return await readBlob(root, ref, filename);
  } catch {
    const exists = await git(root, ["ls-tree", "-z", ref, "--", filename]);
    if (!exists.length) return Buffer.alloc(0);
    throw Error(`Cannot read ${filename}`);
  }
}
export async function captureLocal(
  directory: string,
  scope: LocalScope,
  baseRef: string,
  subfolder: string,
  progress: (detail: string, done: number, total: number) => void,
): Promise<Snapshot> {
  const info = await repoInfo(directory),
    root = info.directory;
  if (subfolder) {
    subfolder = subfolder.replace(/\/$/, "");
    relativePath(subfolder);
  }
  let base = info.head;
  if (scope === "latest") {
    try {
      base = await gitText(root, ["rev-parse", `${info.head}^`]);
    } catch {
      base = await emptyTree(root);
    }
  }
  if (scope === "branch") {
    if (!info.branches.includes(baseRef))
      fail("Select a comparison branch.", "请选择对比分支。");
    base = await gitText(root, ["merge-base", info.head, baseRef]);
  }
  if (scope === "repository") base = await emptyTree(root);
  const files: FileSnapshot[] = [];
  const names = (
    scope === "working" || scope === "repository"
      ? await git(root, [
          "ls-files",
          "-z",
          "--cached",
          "--others",
          "--exclude-standard",
        ])
      : await git(root, [
          "diff",
          "--name-only",
          "-z",
          "--no-renames",
          base,
          info.head,
        ])
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  const unique = [...new Set(names)].filter(
    (p) => !subfolder || p === subfolder || p.startsWith(subfolder + "/"),
  );
  let index = 0;
  for (const filename of unique) {
    progress(filename, index++, unique.length);
    // Respect ignore rules even for generated files that were accidentally tracked.
    try {
      await git(root, ["check-ignore", "--no-index", "-q", "--", filename]);
      continue;
    } catch {}
    const useDisk = scope === "working" || scope === "repository";
    let before = Buffer.alloc(0) as Buffer,
      after = Buffer.alloc(0) as Buffer;
    try {
      const entry = await gitText(root, [
        "ls-tree",
        useDisk ? info.head : info.head,
        "--",
        filename,
      ]);
      if (entry.startsWith("160000") || entry.startsWith("120000")) {
        files.push(
          fileSnapshot(
            filename,
            before,
            after,
            "modified",
            entry.startsWith("160000")
              ? "Submodule not followed"
              : "Symbolic link not followed",
          ),
        );
        continue;
      }
      if (scope !== "repository")
        before = await blobOrEmpty(root, base, filename);
      if (useDisk) {
        try {
          const p = await safeFile(root, filename);
          const s = await fs.lstat(p);
          if (!s.isFile()) continue;
          after = await fs.readFile(p);
        } catch (e: any) {
          if (e.code !== "ENOENT") throw e;
        }
      } else after = await blobOrEmpty(root, info.head, filename);
      if (scope !== "repository" && before.equals(after)) continue;
      files.push(
        fileSnapshot(
          filename,
          before,
          after,
          !before.length ? "added" : !after.length ? "removed" : "modified",
        ),
      );
    } catch (e) {
      files.push(
        fileSnapshot(
          filename,
          before,
          after,
          "modified",
          `Unreadable: ${redact(String(e)).slice(0, 300)}`,
        ),
      );
    }
  }
  if ((await repoInfo(root)).head !== info.head)
    fail(
      "The branch changed during capture. Capture again.",
      "捕获期间分支发生变化，请重新捕获。",
    );
  return {
    kind: "local",
    capturedAt: now(),
    title: path.basename(root),
    repository: root,
    branch: info.branch,
    head: info.head,
    base,
    localScope: scope,
    baseRef,
    subfolder,
    files,
  };
}
export function preserveEndings(original: string, proposed: string): string {
  const tokens = (s: string) =>
    s.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
  const old = tokens(original),
    incoming = tokens(proposed),
    content = (s: string) => s.replace(/(?:\r\n|\r|\n)$/, "");
  const eols = old.map((s) => s.slice(content(s).length)).filter(Boolean);
  const counts = new Map<string, number>();
  for (const e of eols) counts.set(e, (counts.get(e) ?? 0) + 1);
  const preferred = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "\n";
  let pos = 0;
  const out: string[] = [];
  for (const part of diffArrays(old.map(content), incoming.map(content))) {
    if (part.removed) {
      pos += part.count ?? 0;
      continue;
    }
    if (part.added) {
      for (const line of part.value) out.push(line + preferred);
    } else {
      out.push(...old.slice(pos, pos + part.value.length));
      pos += part.value.length;
    }
  }
  for (let i = 0; i < out.length - 1; i++)
    if (!/[\r\n]$/.test(out[i])) out[i] += preferred;
  if (out.length) {
    out[out.length - 1] =
      content(out.at(-1)!) +
      (/[\r\n]$/.test(original)
        ? out.at(-1)!.slice(content(out.at(-1)!).length) || preferred
        : "");
  }
  return out.join("");
}
export async function workspaceDigest(root: string): Promise<string> {
  const paths = (
    await git(root, [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ])
  )
    .toString()
    .split("\0")
    .filter(Boolean)
    .sort();
  const records = [];
  for (const p of [...new Set(paths)]) {
    try {
      records.push([p, digest(await fs.readFile(await safeFile(root, p)))]);
    } catch (e: any) {
      if (e.code === "ENOENT") records.push([p, "deleted"]);
      else fail(`Unsupported workspace file: ${p}`, `工作区文件不受支持：${p}`);
    }
  }
  return digest({
    head: await gitText(root, ["rev-parse", "HEAD"]),
    files: records,
  });
}
export async function workingDiff(root: string, base: string) {
  const tracked = await gitText(root, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--binary",
    base,
    "--",
  ]);
  const untracked = (
    await git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  let extra = "";
  for (const p of untracked) {
    const b = await fs.readFile(await safeFile(root, p));
    const t = decodeText(b);
    extra +=
      t === undefined
        ? `\nBinary untracked file: ${p}\n`
        : createTwoFilesPatch(p, p, "", t);
  }
  return tracked + "\n" + extra;
}
export async function codePreview(
  root: string,
  remote: string,
  original: string,
): Promise<CodePreview> {
  const head = await gitText(root, ["rev-parse", "HEAD"]);
  let rewrite = false;
  try {
    await git(root, ["merge-base", "--is-ancestor", remote, head]);
  } catch {
    rewrite = true;
  }
  const dirty = Boolean(await gitText(root, ["status", "--porcelain"]));
  return {
    head,
    remote,
    digest: await workspaceDigest(root),
    diff: await workingDiff(root, original),
    dirty,
    rewrite,
    capturedAt: now(),
  };
}
export async function createIsolated(
  source: string,
  destination: string,
  head: string,
) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await git(path.dirname(destination), [
    "clone",
    "--no-hardlinks",
    "--no-checkout",
    "--",
    source,
    destination,
  ]);
  await git(destination, ["checkout", "--detach", head]);
  return destination;
}
export async function runVerification(
  root: string,
  command: string,
  args: string[],
) {
  if (!command || command.startsWith("-"))
    fail(
      "Choose an executable for verification.",
      "请选择验证命令的可执行文件。",
    );
  return new Promise<{ output: string; passed: boolean }>((resolve) =>
    execFile(
      command,
      args,
      {
        cwd: root,
        env: cleanEnv(),
        timeout: 180000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
      (err, out, stderr) =>
        resolve({
          output: redact(out + "\n" + stderr).slice(-100000),
          passed: !err,
        }),
    ),
  );
}
export async function withTemporaryIndex<T>(
  root: string,
  operation: (env: NodeJS.ProcessEnv) => Promise<T>,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "reviewforge-index-"));
  try {
    const env = { GIT_INDEX_FILE: path.join(dir, "index") };
    await git(root, ["read-tree", "HEAD"], env);
    return await operation(env);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
