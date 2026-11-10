import type { Draft, Language } from "../shared/types";
export function reviewReport(d: Draft, language: Language = "en") {
  const tr = (en: string, zh: string) => (language === "en" ? en : zh);
  const out = [
    `# ${d.snapshot.title}`,
    "",
    `${tr("Captured", "捕获时间")}: ${d.snapshot.capturedAt}`,
    `${tr("Branch", "分支")}: ${d.snapshot.branch}`,
    `HEAD: ${d.snapshot.head || tr("No commits", "尚无提交")}`,
    "",
    `## ${tr("Summary", "总结")}`,
    "",
    d.summary || tr("No summary.", "没有总结。"),
  ];
  if (d.snapshot.pr)
    out.push(
      "",
      `## ${tr("PR description", "PR 描述")}`,
      "",
      d.snapshot.pr.body || tr("PR description is missing.", "PR 描述缺失。"),
    );
  out.push("", `## ${tr("File assessments", "逐文件审查")}`);
  for (const f of d.snapshot.files) {
    out.push("", `### ${f.path}`, "");
    if (f.omission) out.push(`${tr("Unreviewed", "未审查")}: ${f.omission}`);
    else
      out.push(
        ...Object.entries(f.reviews)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(
            ([n, body]) =>
              `#### ${tr("Part", "分段")} ${Number(n) + 1}\n\n${body}`,
          ),
      );
    if (!f.omission && !Object.keys(f.reviews).length)
      out.push(tr("Not reviewed.", "尚未审查。"));
    if (f.error)
      out.push(
        `${tr("Error", "错误")}: ${language === "zh-Hans" ? (f.errorZh ?? f.error) : f.error}`,
      );
    for (const finding of d.findings.filter((x) => x.path === f.path))
      out.push(
        "",
        `#### [${finding.kind === "bug" ? finding.severity : finding.kind === "nit" ? "NIT" : "Maintainability"}] ${finding.title}`,
        "",
        `${finding.side}:${finding.line} · ${tr("Decision", "决策")}: ${finding.decision}`,
        "",
        finding.body,
      );
  }
  return out.join("\n") + "\n";
}
