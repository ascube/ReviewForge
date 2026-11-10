import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "./store";
import { digest, fail } from "./util";
import { workspaceDigest } from "./git";
import { relocateRecovery } from "./recovery";
// The caller holds the service operation lock. Keep the original store open until preferences commit.
export async function copyStore(source: Store, destination: string) {
  const old = await fs.realpath(source.directory);
  const target = path.join(
    await fs.realpath(path.dirname(destination)),
    path.basename(destination),
  );
  if (
    target === old ||
    target.startsWith(old + path.sep) ||
    old.startsWith(target + path.sep)
  )
    fail("Choose a separate data directory.", "请选择独立的数据目录。");
  try {
    await fs.access(target);
    fail(
      "Target folder already exists. Choose an empty location.",
      "目标文件夹已存在，请选择空位置。",
    );
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  source.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const expected = source.list(),
    staging = target + ".copy-" + randomUUID();
  let copied: Store | undefined,
    promoted = false;
  try {
    await fs.cp(old, staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    copied = new Store(staging);
    if (digest(copied.list()) !== digest(expected))
      fail(
        "Copied drafts could not be verified. Original data is preserved.",
        "无法验证草稿副本，原数据已保留。",
      );
    copied.close();
    copied = undefined;
    await fs.rename(staging, target);
    promoted = true;
    copied = new Store(target);
    for (const d of copied.list()) {
      if (d.fixBackup) {
        const original = await fs.realpath(d.fixBackup);
        if (original.startsWith(old + path.sep))
          d.fixBackup = path.join(target, path.relative(old, original));
      }
      for (const kind of ["workspace", "repository"] as const) {
        const directory =
          kind === "workspace" ? d.workspace?.directory : d.snapshot.repository;
        if (
          !directory ||
          !(
            path
              .resolve(directory)
              .startsWith(path.resolve(source.directory) + path.sep) ||
            path.resolve(directory).startsWith(old + path.sep)
          )
        )
          continue;
        const prior = await fs.realpath(directory);
        if (!prior.startsWith(old + path.sep)) continue;
        const next = path.join(target, path.relative(old, prior));
        if ((await workspaceDigest(prior)) !== (await workspaceDigest(next)))
          fail(
            "Workspace copy could not be verified. Original data is preserved.",
            "无法验证工作区副本，原数据已保留。",
          );
        if (d.fixBackup)
          await relocateRecovery(d.fixBackup, prior, await fs.realpath(next));
        if (kind === "workspace") {
          d.workspace!.directory = next;
          d.workspace!.approval = undefined;
          d.workspace!.preview = undefined;
        } else d.snapshot.repository = next;
        d.followUpApproval = undefined;
      }
      copied.save(d);
    }
    return copied;
  } catch (error) {
    copied?.close();
    await fs.rm(promoted ? target : staging, { recursive: true, force: true });
    throw error;
  }
}
