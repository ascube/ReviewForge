import { promises as fs } from "node:fs";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { randomUUID } from "node:crypto";
import type { Proposal } from "../shared/types";
import { safeFile, fail, decodeText, digest } from "./util";
export interface Recovery {
  root: string;
  state: "prepared" | "applying" | "applied" | "restored" | "needsRecovery";
  entries: { path: string; original?: string; next?: string; mode: number }[];
}
async function bytes(root: string, file: string) {
  try {
    return await fs.readFile(await safeFile(root, file));
  } catch (e: any) {
    if (e.code === "ENOENT") return undefined;
    throw e;
  }
}
const equal = (a: Buffer | undefined, b: string | undefined) =>
  a === undefined
    ? b === undefined
    : b !== undefined && a.toString("base64") === b;
export async function atomicFile(target: string, data: Buffer, mode = 0o644) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = target + ".reviewforge-" + randomUUID();
  try {
    await fs.writeFile(temporary, data, { flag: "wx", mode });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
async function save(file: string, record: Recovery) {
  await atomicFile(file, Buffer.from(JSON.stringify(record)), 0o600);
}
export async function prepareRecovery(
  root: string,
  proposals: Proposal[],
  directory: string,
) {
  const entries: Recovery["entries"] = [];
  for (const p of proposals) {
    const target = await safeFile(root, p.path, true),
      data = await bytes(root, p.path);
    if (
      (data === undefined ? "" : decodeText(data)) !== p.original ||
      (p.existed === false && data !== undefined) ||
      (p.existed !== false && data === undefined)
    )
      fail(
        "A file changed. Regenerate proposals.",
        "文件已变化，请重新生成建议。",
      );
    const mode = data ? (await fs.stat(target)).mode : 0o644;
    entries.push({
      path: p.path,
      original: data?.toString("base64"),
      next: p.delete ? undefined : Buffer.from(p.content).toString("base64"),
      mode,
    });
  }
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, randomUUID() + ".json");
  await save(file, {
    root: await fs.realpath(root),
    state: "prepared",
    entries,
  });
  return file;
}
export async function readRecovery(file: string): Promise<Recovery> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}
export async function recoveryPreview(file: string) {
  const record = await readRecovery(file);
  return {
    fingerprint: digest(record),
    record,
    diffs: record.entries.map((e) => ({
      path: e.path,
      diff: createTwoFilesPatch(
        e.path,
        e.path,
        e.next ? Buffer.from(e.next, "base64").toString("utf8") : "",
        e.original ? Buffer.from(e.original, "base64").toString("utf8") : "",
      ),
    })),
  };
}
export async function restoreRecovery(file: string, expected?: string) {
  const record = await readRecovery(file);
  if (expected && digest(record) !== expected)
    fail(
      "Recovery copy changed. Preview again.",
      "恢复副本已变化，请重新预览。",
    );
  // Check the whole batch before undoing anything. Never overwrite later external edits.
  for (const e of record.entries) {
    const current = await bytes(record.root, e.path);
    if (!equal(current, e.original) && !equal(current, e.next))
      fail(
        "A file has later edits. Recovery copy is preserved; restore it manually without overwriting those edits.",
        "文件存在后续修改。恢复副本已保留，请手动恢复并保留这些修改。",
      );
  }
  for (const e of [...record.entries].reverse()) {
    const current = await bytes(record.root, e.path);
    if (equal(current, e.original)) continue;
    if (!equal(current, e.next))
      fail("A file changed during recovery.", "恢复期间文件发生变化。");
    const target = await safeFile(record.root, e.path, true);
    if (e.original === undefined) await fs.rm(target, { force: true });
    else await atomicFile(target, Buffer.from(e.original, "base64"), e.mode);
  }
  record.state = "restored";
  await save(file, record);
}
export async function applyRecovery(file: string) {
  const record = await readRecovery(file);
  record.state = "applying";
  await save(file, record);
  try {
    for (const e of record.entries) {
      if (!equal(await bytes(record.root, e.path), e.original))
        fail(
          "A file changed. Regenerate proposals.",
          "文件已变化，请重新生成建议。",
        );
      const target = await safeFile(record.root, e.path, true);
      if (e.next === undefined) await fs.unlink(target);
      else await atomicFile(target, Buffer.from(e.next, "base64"), e.mode);
    }
    record.state = "applied";
    await save(file, record);
  } catch (error) {
    try {
      await restoreRecovery(file);
    } catch {
      record.state = "needsRecovery";
      await save(file, record);
      fail(
        "Applying changes failed and automatic recovery was incomplete. Open the recovery copy before continuing.",
        "应用修改失败，自动恢复未完成。请先查看恢复副本再继续。",
      );
    }
    throw error;
  }
}

export async function relocateRecovery(
  file: string,
  oldRoot: string,
  newRoot: string,
) {
  const record = await readRecovery(file);
  if (record.root === oldRoot) {
    record.root = newRoot;
    await save(file, record);
  }
}
