import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
export class ForgeError extends Error {
  constructor(
    public en: string,
    public zh: string = en,
  ) {
    super(en);
  }
}
export function fail(en: string, zh: string): never {
  throw new ForgeError(en, zh);
}
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const digest = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export const cleanEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/TOKEN|SECRET|PASSWORD|API_KEY|^GIT_|^ELECTRON_/i.test(key),
    ),
  );
export function relativePath(value: string) {
  if (
    !value ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    /^[A-Za-z]:/.test(value) ||
    value
      .split("/")
      .some(
        (p) =>
          p === "." ||
          p === ".." ||
          p === "" ||
          p.toLowerCase() === ".git" ||
          (process.platform === "win32" &&
            (/[<>:"|?*]/.test(p) ||
              /[. ]$/.test(p) ||
              /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p) ||
              /^git~[1-9]/i.test(p))),
      )
  )
    fail("Invalid repository path.", "仓库路径无效。");
  return value;
}
export async function safeFile(
  root: string,
  filename: string,
  allowMissing = false,
) {
  relativePath(filename);
  const real = await fs.realpath(root);
  let cursor = real;
  const parts = filename.split("/");
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]);
    try {
      const s = await fs.lstat(cursor);
      if (s.isSymbolicLink())
        fail("Symbolic links are not editable.", "不允许编辑符号链接。");
      if (i < parts.length - 1 && !s.isDirectory())
        fail("The parent path is not a directory.", "父路径不是目录。");
    } catch (e: any) {
      if (e.code === "ENOENT" && allowMissing) return path.join(real, ...parts);
      throw e;
    }
  }
  return cursor;
}
export function decodeText(data: Buffer): string | undefined {
  if (data.includes(0)) return;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      data,
    );
  } catch {
    return;
  }
}
export function redact(text: string, secrets: string[] = []) {
  let result = text.replace(
    /(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g,
    "[redacted]",
  );
  for (const secret of secrets)
    if (secret) result = result.split(secret).join("[redacted]");
  return result;
}
export function descriptionMissing(body: string) {
  return !body.replace(/<!--[\s\S]*?(?:-->|$)/g, "").trim();
}
export const missingDescription = {
  en: "PR description is missing. Intended behavior and acceptance criteria cannot be checked against the description.",
  zh: "PR 描述缺失，无法对照描述核实预期行为和验收条件。",
};
export function chunks(
  text: string,
  max = 32000,
): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let buf = "",
    line = 1,
    start = 1;
  for (const part of text.match(/[^\n]*\n|[^\n]+$/g) ?? [""]) {
    if (buf.length + part.length > max && buf) {
      out.push({ text: buf, line: start });
      buf = "";
      start = line;
    }
    if (part.length > max) {
      for (let i = 0; i < part.length; i += max)
        out.push({ text: part.slice(i, i + max), line });
      start = line + Number(part.endsWith("\n"));
    } else buf += part;
    line += Number(part.endsWith("\n"));
  }
  if (buf || !out.length) out.push({ text: buf, line: start });
  return out;
}
