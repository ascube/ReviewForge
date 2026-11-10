import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Draft } from "../shared/types";
import { now, fail } from "./util";
export class Store {
  db: DatabaseSync;
  constructor(public directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, "reviews.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY, data TEXT NOT NULL);",
    );
  }
  list(): Draft[] {
    return (
      this.db.prepare("SELECT data FROM drafts").all() as { data: string }[]
    )
      .map((r) => JSON.parse(r.data))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  get(id: string): Draft {
    const row = this.db
      .prepare("SELECT data FROM drafts WHERE id=?")
      .get(id) as { data: string } | undefined;
    if (!row) fail("Review not found.", "找不到审查记录。");
    return JSON.parse(row.data);
  }
  save(d: Draft) {
    d.updatedAt = now();
    this.db
      .prepare(
        "INSERT INTO drafts(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(d.id, JSON.stringify(d));
    return d;
  }
  delete(id: string) {
    const d = this.get(id);
    if (
      (d.publication && d.publication.state !== "published") ||
      d.feedback.some(
        (f) =>
          f.replyAttempt?.state === "uncertain" ||
          f.replyAttempt?.state === "sending",
      )
    )
      fail(
        "Verify pending publication before deleting.",
        "请先核实待确认的发布结果再删除。",
      );
    this.db.prepare("DELETE FROM drafts WHERE id=?").run(id);
  }
  recover() {
    for (const d of this.list()) {
      let changed = false;
      if (d.analysisState === "running") {
        d.analysisState = "interrupted";
        changed = true;
      }
      if (d.publication?.state === "sending") {
        d.publication.state = "uncertain";
        changed = true;
      }
      for (const f of d.feedback)
        if (f.replyAttempt?.state === "sending") {
          f.replyAttempt.state = "uncertain";
          changed = true;
        }
      if (changed) this.save(d);
    }
  }
  close() {
    this.db.close();
  }
}
