import { z } from "zod";
import type { Draft, Finding, FileSnapshot } from "../shared/types";
import { digest, fail, id, now } from "./util";
export const findingSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  side: z.enum(["LEFT", "RIGHT"]),
  title: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(20000),
  kind: z.enum(["bug", "maintainability", "nit"]),
  severity: z.enum(["P0", "P1", "P2", "P3"]),
});
export function anchors(file: FileSnapshot) {
  const result = new Map<string, number>();
  let old = 0,
    next = 0;
  for (const line of file.patch.split("\n")) {
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) {
      old = Number(h[1]);
      next = Number(h[2]);
      continue;
    }
    if (
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("\\")
    )
      continue;
    if (line.startsWith("-")) {
      result.set(`LEFT:${old++}`, 1);
    } else if (line.startsWith("+")) {
      result.set(`RIGHT:${next++}`, 1);
    } else if (line.startsWith(" ")) {
      result.set(`LEFT:${old++}`, 1);
      result.set(`RIGHT:${next++}`, 1);
    }
  }
  return result;
}
export function validateFinding(d: Draft, raw: unknown): Finding {
  const f = findingSchema.parse(raw);
  const file = d.snapshot.files.find((x) => x.path === f.path);
  if (!file || file.omission || !anchors(file).has(`${f.side}:${f.line}`))
    fail(
      "Finding must point to a valid line in the captured diff.",
      "问题必须定位到已捕获差异中的有效行。",
    );
  if (d.scope === "bugsOnly" && f.kind !== "bug")
    fail("This run checks defects only.", "此轮仅检查缺陷。");
  if (f.kind !== "bug" && f.severity !== "P3")
    fail(
      "Suggestions use a separate category with P3 storage priority.",
      "建议使用独立分类，并以 P3 存储。",
    );
  return { ...f, id: id(), origin: "copilot", decision: "pending" };
}
export function reviewPayload(d: Draft) {
  return {
    commit_id: d.snapshot.head,
    event: d.event,
    body: d.summary,
    comments: d.findings
      .filter((f) => f.decision === "include")
      .map((f) => ({
        path: f.path,
        line: f.line,
        side: f.side,
        body: `[${f.kind === "bug" ? f.severity : f.kind === "nit" ? "NIT" : "Maintainability"}] ${f.title}\n\n${f.body}`,
      })),
  };
}
export const reviewFingerprint = (d: Draft) =>
  digest({
    pr: d.snapshot.pr,
    scope: d.analysisScope,
    analysis: d.analysisState,
    findings: d.findings,
    payload: reviewPayload(d),
  });
export function reviewIssues(d: Draft) {
  const issues: string[] = [];
  if (d.findings.some((f) => f.decision === "pending"))
    issues.push("Decide Include or Exclude for every finding.");
  if (!d.summary.trim() && !d.findings.some((f) => f.decision === "include"))
    issues.push("Add a review summary or include a finding.");
  if (
    d.event === "APPROVE" &&
    (d.snapshot.files.some((f) => f.omission) || d.analysisState !== "complete")
  )
    issues.push("Cannot approve a PR with incomplete coverage.");
  if (d.findings.filter((f) => f.decision === "include").length > 50)
    issues.push("Publish no more than 50 inline findings in one review.");
  for (const f of d.findings.filter((f) => f.decision === "include")) {
    try {
      const file = d.snapshot.files.find((x) => x.path === f.path);
      findingSchema.parse(f);
      if (!file || !anchors(file).has(`${f.side}:${f.line}`)) throw Error();
    } catch {
      issues.push("Correct invalid finding locations before publishing.");
      break;
    }
  }
  return issues;
}
export function newDraft(snapshot: Draft["snapshot"]): Draft {
  return {
    id: id(),
    createdAt: now(),
    updatedAt: now(),
    archived: false,
    snapshot,
    scope: "detailed",
    analysisState: "idle",
    summary: "",
    findings: [],
    event: "COMMENT",
    feedback: [],
    proposals: [],
  };
}
export const replyFingerprint = (d: Draft) =>
  digest({
    head: d.workspace?.pushedHead,
    preview: d.workspace?.preview?.digest,
    items: d.feedback
      .filter((f) => f.selected)
      .map((f) => ({ id: f.id, reply: f.reply, resolve: f.resolve })),
  });
