import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type {
  Draft,
  Settings,
  Progress,
  AppState,
  Snapshot,
  Feedback,
  Proposal,
} from "../shared/types";
import { Store } from "./store";
import { GitHub, GitHubRejected } from "./github";
import {
  git,
  gitText,
  repoInfo,
  captureLocal,
  readBlob,
  preserveEndings,
  workspaceDigest,
  workingDiff,
  codePreview,
  createIsolated,
  runVerification,
  withTemporaryIndex,
} from "./git";
import {
  newDraft,
  reviewFingerprint,
  reviewPayload,
  reviewIssues,
  validateFinding,
  replyFingerprint,
  findingSchema,
} from "./domain";
import {
  chunks,
  now,
  id,
  fail,
  digest,
  safeFile,
  decodeText,
  descriptionMissing,
  missingDescription,
  relativePath,
  ForgeError,
} from "./util";
export interface AI {
  run(
    message: any,
    onTool: (operation: string, args: any) => Promise<any>,
  ): Promise<any>;
  cancel(): void;
}
export interface Secrets {
  read(key: "github" | "copilot"): Promise<string>;
}
export class Service {
  progress: Progress = {
    busy: false,
    operation: "",
    detail: "",
    done: 0,
    total: 0,
  };
  models: string[] = [];
  cancelled = false;
  constructor(
    public store: Store,
    public settings: Settings,
    private ai: AI,
    private secrets: Secrets,
    private changed: () => void,
    private apiFactory: (token: string) => GitHub = (token) =>
      new GitHub(token),
  ) {}
  state(): AppState {
    return {
      settings: this.settings,
      drafts: this.store.list(),
      progress: this.progress,
      models: this.models,
    };
  }
  save(d: Draft) {
    this.store.save(d);
    this.changed();
    return d;
  }
  draft(id: string) {
    const d = this.store.get(id);
    if (d.archived)
      fail("Restore this archived review first.", "请先恢复此归档审查。");
    return d;
  }
  private editable(d: Draft) {
    if (d.publication)
      fail(
        "Published or uncertain reviews are locked. Create a new review to continue.",
        "已发布或结果未确定的审查已锁定，请创建新审查。",
      );
  }
  private async api() {
    return this.apiFactory(await this.secrets.read("github"));
  }
  async operation<T>(
    name: string,
    draftID: string | undefined,
    action: () => Promise<T>,
  ): Promise<T> {
    if (this.progress.busy)
      fail("An operation is already running.", "已有操作正在运行。");
    this.cancelled = false;
    this.progress = {
      busy: true,
      operation: name,
      detail: "",
      draftID,
      done: 0,
      total: 0,
    };
    this.changed();
    try {
      return await action();
    } finally {
      this.progress.busy = false;
      this.changed();
    }
  }
  private update(detail: string, done = 0, total = 0) {
    if (this.cancelled)
      fail(
        "Operation cancelled. Local results are preserved.",
        "操作已取消，已保留本地结果。",
      );
    this.progress = { ...this.progress, detail, done, total };
    this.changed();
  }
  cancel() {
    this.cancelled = true;
    this.ai.cancel();
  }
  async connection() {
    return this.operation("Connecting", undefined, async () => {
      this.models = await this.ai.run(
        await this.aiMessage("check", {}),
        async () => null,
      );
      return this.models;
    });
  }
  async githubConnection() {
    return (await this.api()).request("/user").then((u) => u.login);
  }
  private async aiMessage(mode: string, context: unknown, scope = "detailed") {
    return {
      mode,
      context,
      scope,
      language: this.settings.language,
      model: this.settings.model,
      token: await this.secrets.read("copilot"),
      directory: path.join(this.store.directory, "copilot"),
    };
  }
  async importPR(url: string) {
    return this.operation("Importing PR", undefined, async () =>
      this.save(
        newDraft(
          await (
            await this.api()
          ).snapshot(url, (p, n, t) => this.update(p, n, t)),
        ),
      ),
    );
  }
  async capture(args: {
    directory: string;
    scope: "working" | "branch" | "latest" | "repository";
    baseRef: string;
    subfolder: string;
  }) {
    return this.operation("Capturing snapshot", undefined, async () =>
      this.save(
        newDraft(
          await captureLocal(
            args.directory,
            args.scope,
            args.baseRef,
            args.subfolder,
            (p, n, t) => this.update(p, n, t),
          ),
        ),
      ),
    );
  }
  edit(id: string, patch: any) {
    if (this.progress.busy)
      fail("Wait for the current operation.", "请等待当前操作完成。");
    const d = this.draft(id);
    this.editable(d);
    const value = z
      .object({
        summary: z.string().max(2000000).optional(),
        scope: z.enum(["detailed", "bugsOnly"]).optional(),
        event: z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]).optional(),
        findings: z
          .array(
            findingSchema.extend({
              id: z.string(),
              origin: z.enum(["copilot", "manual"]),
              decision: z.enum(["pending", "include", "exclude"]),
            }),
          )
          .optional(),
      })
      .strict()
      .parse(patch);
    Object.assign(d, value);
    d.approval = undefined;
    return this.save(d);
  }
  archive(id: string, archived: boolean) {
    if (this.progress.busy)
      fail("Wait for the current operation.", "请等待当前操作完成。");
    const d = this.store.get(id);
    d.archived = archived;
    return this.save(d);
  }
  delete(id: string) {
    if (this.progress.busy)
      fail("Wait for the current operation.", "请等待当前操作完成。");
    this.store.delete(id);
    this.changed();
  }
  async analyze(id: string, resume: boolean) {
    return this.operation("Reviewing code", id, async () => {
      let d = this.draft(id);
      this.editable(d);
      if (!resume || d.analysisScope !== d.scope)
        for (const f of d.snapshot.files) {
          f.reviews = {};
          f.error = undefined;
        }
      d.analysisScope = d.scope;
      d.analysisState = "running";
      d.approval = undefined;
      this.save(d);
      const all = d.snapshot.files.filter((f) => !f.omission);
      const total = all.reduce(
        (n, f) => n + chunks(f.patch || f.after).length,
        0,
      );
      let done = all.reduce((n, f) => n + Object.keys(f.reviews).length, 0);
      const api = await this.api();
      let repositoryPaths: string[] | undefined;
      let currentPath = "";
      try {
        for (const file of all) {
          currentPath = file.path;
          const parts = chunks(file.patch || file.after);
          for (let n = 0; n < parts.length; n++) {
            if (file.reviews[String(n)]) continue;
            this.update(`${file.path} · ${n + 1}/${parts.length}`, done, total);
            const result = await this.ai.run(
              await this.aiMessage(
                "review",
                {
                  task: "Review this file part. All files are frozen at capture time.",
                  pr: d.snapshot.pr ?? null,
                  scope: d.snapshot.localScope ?? "PR diff",
                  file: file.path,
                  part: n + 1,
                  parts: parts.length,
                  patchPart: parts[n].text,
                  patchLineOffset: parts[n].line,
                  coverage: d.snapshot.files
                    .filter((f) => f.omission)
                    .map((f) => ({ path: f.path, reason: f.omission })),
                },
                d.scope,
              ),
              async (op, a) => {
                d = this.store.get(id);
                if (op === "finding") {
                  const finding = validateFinding(d, a);
                  if (finding.path !== file.path)
                    fail(
                      "Report only the active file.",
                      "只能报告当前文件的问题。",
                    );
                  if (
                    !d.findings.some(
                      (f) =>
                        f.path === finding.path &&
                        f.line === finding.line &&
                        f.kind === finding.kind &&
                        f.title === finding.title,
                    )
                  ) {
                    d.findings.push(finding);
                    this.save(d);
                  }
                  return "Saved locally; pending human review.";
                }
                if (op === "list") {
                  repositoryPaths ??= d.snapshot.pr
                    ? await api.paths(d.snapshot.pr.headRepo, d.snapshot.head)
                    : (
                        await git(d.snapshot.repository!, [
                          "ls-tree",
                          "-r",
                          "--name-only",
                          "-z",
                          d.snapshot.head,
                        ])
                      )
                        .toString()
                        .split("\0")
                        .filter(Boolean);
                  const files = [
                    ...new Set([
                      ...repositoryPaths,
                      ...d.snapshot.files.map((f) => f.path),
                    ]),
                  ]
                    .sort()
                    .map((path) => ({
                      path,
                      omission: d.snapshot.files.find((f) => f.path === path)
                        ?.omission,
                    }));
                  const offset = z
                    .number()
                    .int()
                    .min(0)
                    .parse(a.offset ?? 0);
                  return {
                    files: files.slice(offset, offset + 200),
                    nextOffset:
                      offset + 200 < files.length ? offset + 200 : null,
                  };
                }
                if (op === "read") {
                  const filename = relativePath(z.string().parse(a.path));
                  const f = d.snapshot.files.find((x) => x.path === filename);
                  let text: string;
                  if (f) {
                    if (f.omission) throw Error(f.omission);
                    text = f.status === "removed" ? f.before : f.after;
                  } else {
                    const b = d.snapshot.pr
                      ? await api.file(
                          d.snapshot.pr.headRepo,
                          d.snapshot.head,
                          filename,
                        )
                      : await readBlob(
                          d.snapshot.repository!,
                          d.snapshot.head,
                          filename,
                        );
                    const t = decodeText(b);
                    if (t === undefined)
                      fail("File is not UTF-8 text.", "文件不是 UTF-8 文本。");
                    text = t;
                  }
                  return this.page(text, a.offset);
                }
                throw Error("Unsupported tool");
              },
            );
            d = this.store.get(id);
            const stored = d.snapshot.files.find((f) => f.path === file.path)!;
            stored.reviews[String(n)] = String(result);
            stored.error = undefined;
            this.save(d);
            done++;
          }
        }
        d = this.store.get(id);
        d.analysisState = "complete";
        if (!d.summary.trim()) {
          const warning =
            d.snapshot.pr && descriptionMissing(d.snapshot.pr.body)
              ? `> ${this.settings.language === "en" ? missingDescription.en : missingDescription.zh}\n\n`
              : "";
          d.summary =
            warning +
            d.snapshot.files
              .map(
                (f) =>
                  `## ${f.path}\n\n${f.omission ?? Object.values(f.reviews).join("\n\n")}`,
              )
              .join("\n\n");
        }
        this.update("Complete", done, total);
        return this.save(d);
      } catch (e) {
        d = this.store.get(id);
        d.analysisState = "interrupted";
        const f = d.snapshot.files.find((f) => f.path === currentPath);
        if (f) f.error = e instanceof ForgeError ? e.en : "Review interrupted";
        this.save(d);
        throw e;
      }
    });
  }
  private page(text: string, offset = 0) {
    offset = z.number().int().min(0).max(text.length).parse(offset);
    return {
      text: text.slice(offset, offset + 32000),
      offset,
      nextOffset: offset + 32000 < text.length ? offset + 32000 : null,
      total: text.length,
    };
  }
  previewReview(id: string) {
    const d = this.draft(id);
    return {
      fingerprint: reviewFingerprint(d),
      payload: reviewPayload(d),
      issues: reviewIssues(d),
    };
  }
  approveReview(id: string, fingerprint: string) {
    const d = this.draft(id);
    this.editable(d);
    if (reviewIssues(d).length)
      fail(
        "Resolve all publication checklist items first.",
        "请先处理所有发布检查项。",
      );
    if (fingerprint !== reviewFingerprint(d))
      fail("Review changed. Preview it again.", "审查已变化，请重新预览。");
    d.approval = fingerprint;
    return this.save(d);
  }
  async publishReview(id: string) {
    return this.operation("Publishing review", id, async () => {
      const d = this.draft(id);
      this.editable(d);
      if (
        !d.snapshot.pr ||
        d.approval !== reviewFingerprint(d) ||
        reviewIssues(d).length
      )
        fail(
          "Preview and approve this review before publishing.",
          "请先预览并批准当前审查。",
        );
      const api = await this.api();
      const current = await api.pr(d.snapshot.pr);
      if (
        current.head !== d.snapshot.head ||
        current.base !== d.snapshot.base ||
        current.body !== d.snapshot.pr.body ||
        current.state !== "open"
      )
        fail(
          "PR code or description changed. Import the latest version and review again.",
          "PR 代码或描述已变化，请导入最新版本重新审查。",
        );
      const marker = `<!-- ReviewForge:${id}:${crypto.randomUUID()} -->`;
      const body = d.summary + "\n\n" + marker;
      d.publication = { state: "sending", marker, body };
      this.save(d);
      try {
        const r = await api.createReview(current, {
          ...reviewPayload(d),
          body,
        });
        d.publication = { state: "published", marker, body, url: r.html_url };
        return this.save(d);
      } catch (e) {
        if (e instanceof GitHubRejected && e.definitelyRejected) {
          d.publication = undefined;
          d.approval = undefined;
        } else d.publication.state = "uncertain";
        this.save(d);
        throw e;
      }
    });
  }
  async reconcileReview(id: string) {
    return this.operation("Verifying publication", id, async () => {
      const d = this.draft(id);
      if (!d.publication || !d.snapshot.pr) return d;
      const matches = (await (await this.api()).reviews(d.snapshot.pr)).filter(
        (r) =>
          r.body?.includes(d.publication!.marker) &&
          r.commit_id === d.snapshot.head,
      );
      if (matches.length === 1) {
        d.publication.state = "published";
        d.publication.url = matches[0].html_url;
        return this.save(d);
      }
      fail(
        "Publication is not yet confirmed. Do not retry until its status is known.",
        "尚未确认发布结果，请在状态明确前不要重复发布。",
      );
    });
  }
  async loadFeedback(id: string) {
    return this.operation("Loading feedback", id, async () => {
      const d = this.draft(id);
      if (!d.snapshot.pr)
        fail("Select a remote PR first.", "请先选择远程 PR。");
      const list = await (await this.api()).feedback(d.snapshot.pr);
      d.feedback = list.map((f) => {
        const old = d.feedback.find((x) => x.id === f.id);
        return {
          ...f,
          selected: !f.resolved && (old?.selected ?? false),
          reply: old?.reply ?? "",
          resolve: !f.resolved && (old?.resolve ?? Boolean(f.threadID)),
          replyPosted: old?.replyPosted,
          resolveDone: f.resolved || old?.resolveDone,
          replyAttempt: old?.replyAttempt,
        };
      });
      d.followUpApproval = undefined;
      return this.save(d);
    });
  }
  editFeedback(id: string, items: unknown) {
    const list = z
      .array(
        z.object({
          id: z.string(),
          selected: z.boolean(),
          reply: z.string().max(60000),
          resolve: z.boolean(),
        }),
      )
      .parse(items);
    const d = this.draft(id);
    for (const value of list) {
      const f = d.feedback.find((f) => f.id === value.id);
      if (!f) continue;
      if (f.replyAttempt && f.reply !== value.reply)
        fail(
          "A reply was already sent or needs verification. Refresh feedback first.",
          "回复已发送或需要核实，请先刷新反馈。",
        );
      Object.assign(f, value);
      if (!f.threadID) f.resolve = false;
    }
    d.followUpApproval = undefined;
    return this.save(d);
  }
  private gitAuth(token: string) {
    return token
      ? {
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
          GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from("x-access-token:" + token).toString("base64")}`,
        }
      : {};
  }
  async prepareWorkspace(id: string, localRepo?: string) {
    return this.operation("Preparing workspace", id, async () => {
      const d = this.draft(id);
      if (d.workspace)
        fail(
          "This review already has a workspace. Open or synchronize it.",
          "此审查已有工作区，请打开或同步。",
        );
      if (!d.snapshot.pr)
        fail("Select a remote PR first.", "请先选择远程 PR。");
      const pr = await (await this.api()).pr(d.snapshot.pr);
      const target = path.join(this.store.directory, "workspaces", id);
      const env = this.gitAuth(await this.secrets.read("github"));
      if (localRepo) {
        const source = await repoInfo(localRepo);
        await createIsolated(source.directory, target, source.head);
        await git(
          target,
          [
            "fetch",
            "--no-tags",
            `https://github.com/${pr.headRepo}.git`,
            `refs/heads/${pr.branch}`,
          ],
          env,
        );
        await git(target, ["checkout", "--detach", pr.head]);
      } else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await git(
          path.dirname(target),
          [
            "clone",
            "--no-checkout",
            "--",
            `https://github.com/${pr.headRepo}.git`,
            target,
          ],
          env,
        );
        await git(target, ["checkout", "--detach", pr.head]);
      }
      d.workspace = {
        directory: target,
        originalHead: pr.head,
        head: pr.head,
        expectedRemote: pr.head,
      };
      d.proposals = [];
      return this.save(d);
    });
  }
  async moveWorkspace(id: string, destination: string) {
    return this.operation("Moving workspace", id, async () => {
      const d = this.draft(id);
      if (!d.workspace) throw Error("No workspace");
      const target = path.join(destination, `ReviewForge-${id}`);
      try {
        await fs.access(target);
        fail(
          "Destination already exists. Choose another folder.",
          "目标已存在，请选择其他文件夹。",
        );
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
      await fs.cp(d.workspace.directory, target, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      const info = await repoInfo(target);
      if (
        info.head !==
          (await gitText(d.workspace.directory, ["rev-parse", "HEAD"])) ||
        (await workspaceDigest(target)) !==
          (await workspaceDigest(d.workspace.directory))
      )
        fail(
          "Workspace copy could not be verified. Original workspace is preserved.",
          "无法验证工作区副本，原工作区已保留。",
        );
      d.workspace.directory = target;
      d.workspace.preview = undefined;
      d.workspace.approval = undefined;
      d.followUpApproval = undefined;
      return this.save(d);
    });
  }
  async generateFix(id: string, instructions: string) {
    return this.operation("Proposing fixes", id, async () => {
      let d = this.draft(id);
      const root =
        d.snapshot.kind === "local"
          ? d.snapshot.repository
          : d.workspace?.directory;
      if (!root)
        fail("Prepare a local workspace first.", "请先准备本地工作区。");
      const targets =
        d.snapshot.kind === "local"
          ? d.findings.filter((f) => f.decision !== "exclude")
          : d.feedback.filter((f) => f.selected && !f.resolved);
      if (!targets.length)
        fail(
          "Select feedback or review findings first.",
          "请先选择反馈或生成审查问题。",
        );
      const beforeDigest = await workspaceDigest(root);
      const names = (
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
        .filter(Boolean);
      const frozen = new Map<string, string>();
      for (const name of names) {
        try {
          const text = decodeText(
            await fs.readFile(await safeFile(root, name)),
          );
          if (text !== undefined) frozen.set(name, text);
        } catch {}
      }
      const reads = new Map<string, Set<number>>();
      const proposals: Proposal[] = [];
      d.proposalContext = beforeDigest;
      d.proposals = [];
      this.save(d);
      const result = await this.ai.run(
        await this.aiMessage("fix", {
          selected: targets,
          reviewType: d.snapshot.kind,
          pr: d.snapshot.pr ?? null,
          instructions,
          branch: await gitText(root, ["branch", "--show-current"]),
          task: "Propose local changes for all selected items. Explicitly list any not addressed.",
        }),
        async (op, a) => {
          if (op === "list") {
            const offset = z
              .number()
              .int()
              .nonnegative()
              .parse(a.offset ?? 0);
            return {
              files: names.slice(offset, offset + 200),
              nextOffset: offset + 200 < names.length ? offset + 200 : null,
            };
          }
          if (op === "read") {
            const p = relativePath(a.path);
            if (!frozen.has(p))
              fail(
                "File is missing, binary or unavailable.",
                "文件不存在、是二进制或不可用。",
              );
            const page = this.page(frozen.get(p)!, a.offset);
            const set = reads.get(p) ?? new Set();
            set.add(page.offset);
            reads.set(p, set);
            return page;
          }
          if (op === "proposal") {
            const v = z
              .object({
                path: z.string(),
                content: z.string(),
                reason: z.string().max(20000),
                delete: z.boolean().optional(),
              })
              .parse(a);
            relativePath(v.path);
            await safeFile(root, v.path, true);
            const original = frozen.get(v.path) ?? "";
            if (frozen.has(v.path)) {
              for (let off = 0; off < original.length; off += 32000)
                if (!reads.get(v.path)?.has(off))
                  fail(
                    "Read the complete original file before proposing a replacement.",
                    "请先读取完整原文件，再提出替换建议。",
                  );
            } else {
              try {
                await fs.lstat(path.join(root, v.path));
                fail(
                  "Existing file is not editable text.",
                  "已有文件不是可编辑文本。",
                );
              } catch (e: any) {
                if (e.code !== "ENOENT") throw e;
              }
            }
            if (v.delete && (!frozen.has(v.path) || v.content !== ""))
              fail(
                "Deletion requires an existing text file and empty content.",
                "删除建议必须针对已有文本文件且内容为空。",
              );
            const proposal: Proposal = {
              id: idOfProposal(v.path),
              path: v.path,
              original,
              existed: frozen.has(v.path),
              delete: v.delete ?? false,
              content: v.delete
                ? ""
                : frozen.has(v.path)
                  ? preserveEndings(original, v.content)
                  : v.content,
              reason: v.reason,
              selected: true,
              status: "pending",
            };
            const index = proposals.findIndex((p) => p.path === v.path);
            if (index >= 0) proposals[index] = proposal;
            else proposals.push(proposal);
            d = this.store.get(id);
            d.proposals = proposals;
            this.save(d);
            return {
              saved: true,
              applied: false,
              path: proposal.path,
              lineEndings: proposal.existed
                ? "Host preserved original line endings and final newline; incoming model text was normalized."
                : "New file: supplied line endings retained.",
            };
          }
          throw Error("Unsupported tool");
        },
      );
      d = this.store.get(id);
      d.fixSummary = String(result);
      if ((await workspaceDigest(root)) !== beforeDigest)
        d.fixSummary +=
          "\nWorkspace changed externally. Proposals require regeneration.";
      return this.save(d);
    });
  }
  editProposal(
    id: string,
    proposalID: string,
    content: string,
    selected: boolean,
  ) {
    const d = this.draft(id);
    const p = d.proposals.find(
      (p) => p.id === proposalID && p.status === "pending",
    );
    if (!p) fail("Proposal is not editable.", "建议不可编辑。");
    p.content = p.delete
      ? ""
      : p.existed === false
        ? z.string().parse(content)
        : preserveEndings(p.original, z.string().parse(content));
    p.selected = selected;
    return this.save(d);
  }
  async applyProposals(id: string, expected: string) {
    return this.operation("Applying approved proposals", id, async () => {
      const d = this.draft(id);
      const root =
        d.snapshot.kind === "local"
          ? d.snapshot.repository
          : d.workspace?.directory;
      if (!root) throw Error("No workspace");
      const selected = d.proposals.filter(
        (p) => p.selected && p.status === "pending",
      );
      if (!selected.length || digest(selected) !== expected)
        fail(
          "Proposals changed. Preview them again.",
          "建议已变化，请重新预览。",
        );
      if ((await workspaceDigest(root)) !== d.proposalContext)
        fail(
          "Workspace changed since generation. Regenerate proposals to preserve external edits.",
          "生成建议后工作区已变化，请重新生成以保留外部修改。",
        );
      for (const p of selected) {
        const target = await safeFile(root, p.path, true);
        const existing = await fs.readFile(target).catch((e: any) => {
          if (e.code === "ENOENT") return Buffer.alloc(0);
          throw e;
        });
        if (decodeText(existing) !== p.original)
          fail(
            "A file changed. Regenerate proposals.",
            "文件已变化，请重新生成建议。",
          );
      }
      // Each applied item is checkpointed; a later failure leaves an explicit partial result.
      for (const p of selected) {
        const target = await safeFile(root, p.path, true);
        // Recheck immediately before each write; never silently replace an external edit.
        const stat = await fs.stat(target).catch((e: any) => {
          if (e.code === "ENOENT") return undefined;
          throw e;
        });
        const current = stat ? await fs.readFile(target) : Buffer.alloc(0);
        if (decodeText(current) !== p.original || (p.existed === false && stat))
          fail(
            "A file changed. Regenerate proposals.",
            "文件已变化，请重新生成建议。",
          );
        if (p.delete) await fs.unlink(target);
        else {
          await fs.mkdir(path.dirname(target), { recursive: true });
          const temporary = target + ".reviewforge-" + randomUUID();
          try {
            await fs.writeFile(temporary, p.content, {
              encoding: "utf8",
              flag: "wx",
              mode: stat?.mode ?? 0o644,
            });
            await fs.rename(temporary, target);
          } finally {
            await fs.rm(temporary, { force: true });
          }
        }
        p.status = "applied";
        this.save(d);
      }
      if (d.workspace) {
        d.workspace.preview = undefined;
        d.workspace.approval = undefined;
        d.workspace.pushedHead = undefined;
      }
      d.followUpApproval = undefined;
      return this.save(d);
    });
  }
  async syncWorkspace(id: string) {
    return this.operation("Synchronizing workspace", id, async () =>
      this.refreshWorkspace(this.draft(id)),
    );
  }
  private async refreshWorkspace(d: Draft) {
    if (!d.workspace || !d.snapshot.pr)
      fail("Prepare a PR workspace first.", "请先准备 PR 工作区。");
    const w = d.workspace,
      api = await this.api(),
      remote = await api.pr(d.snapshot.pr);
    if (
      remote.headRepo !== d.snapshot.pr.headRepo ||
      remote.branch !== d.snapshot.pr.branch
    )
      fail(
        "PR source branch changed. Import it as a new review.",
        "PR 来源分支已变化，请重新导入。",
      );
    await git(
      w.directory,
      [
        "fetch",
        "--no-tags",
        `https://github.com/${remote.headRepo}.git`,
        `refs/heads/${remote.branch}`,
      ],
      this.gitAuth(await this.secrets.read("github")),
    );
    const fetched = await gitText(w.directory, ["rev-parse", "FETCH_HEAD"]);
    if (fetched !== remote.head)
      fail(
        "Remote branch changed while syncing. Retry.",
        "同步期间远程分支变化，请重试。",
      );
    const preview = await codePreview(w.directory, remote.head, w.originalHead);
    w.head = preview.head;
    w.expectedRemote = remote.head;
    w.preview = preview;
    w.approval = undefined;
    w.pushedHead =
      preview.head === remote.head && !preview.dirty ? preview.head : undefined;
    d.followUpApproval = undefined;
    return this.save(d);
  }
  approveCode(id: string, fingerprint: string) {
    const d = this.draft(id);
    if (!d.workspace?.preview || digest(d.workspace.preview) !== fingerprint)
      fail(
        "Refresh and preview code changes first.",
        "请先刷新并预览代码修改。",
      );
    d.workspace.approval = fingerprint;
    return this.save(d);
  }
  private async verifyCode(d: Draft) {
    if (
      !d.workspace?.preview ||
      d.workspace.approval !== digest(d.workspace.preview) ||
      (await workspaceDigest(d.workspace.directory)) !==
        d.workspace.preview.digest
    )
      fail(
        "Code changed or is not approved. Refresh, preview and approve again.",
        "代码已变化或未批准，请刷新、预览并重新批准。",
      );
    return d.workspace;
  }
  async commit(id: string, message: string) {
    return this.operation("Committing locally", id, async () => {
      const d = this.draft(id),
        w = await this.verifyCode(d);
      if (
        !message.trim() ||
        !this.settings.authorName.trim() ||
        !this.settings.authorEmail.trim()
      )
        fail(
          "Set commit message, author name and email.",
          "请设置提交信息、作者姓名和邮箱。",
        );
      if (!w.preview!.dirty)
        fail("There are no uncommitted changes.", "没有未提交的修改。");
      const old = w.head;
      const commit = await withTemporaryIndex(w.directory, async (env) => {
        await git(w.directory, ["add", "--all", "--", "."], env);
        const tree = await gitText(w.directory, ["write-tree"], env);
        const stamp = {
          ...env,
          GIT_AUTHOR_NAME: this.settings.authorName,
          GIT_AUTHOR_EMAIL: this.settings.authorEmail,
          GIT_COMMITTER_NAME: this.settings.authorName,
          GIT_COMMITTER_EMAIL: this.settings.authorEmail,
        };
        return gitText(
          w.directory,
          [
            "-c",
            "commit.gpgsign=false",
            "commit-tree",
            tree,
            "-p",
            old,
            "-m",
            message,
          ],
          stamp,
        );
      });
      await git(w.directory, ["update-ref", "HEAD", commit, old]);
      await git(w.directory, ["reset", "--mixed", commit]);
      w.head = commit;
      w.approval = undefined;
      w.preview = undefined;
      w.pushedHead = undefined;
      d.followUpApproval = undefined;
      return this.save(d);
    });
  }
  async push(id: string, allowRewrite: boolean) {
    return this.operation("Pushing approved code", id, async () => {
      const d = this.draft(id),
        w = await this.verifyCode(d);
      if (!d.snapshot.pr) throw Error("No PR");
      if (w.preview!.dirty)
        fail(
          "Commit local changes, then preview and approve the commit before pushing.",
          "请先本地提交，然后预览并批准该提交再推送。",
        );
      const api = await this.api(),
        remote = await api.pr(d.snapshot.pr);
      if (
        remote.head !== w.preview!.remote ||
        remote.branch !== d.snapshot.pr.branch ||
        remote.headRepo !== d.snapshot.pr.headRepo ||
        remote.state !== "open"
      )
        fail(
          "Remote PR changed. Synchronize and preview again.",
          "远程 PR 已变化，请同步并重新预览。",
        );
      if (w.preview!.rewrite && !allowRewrite)
        fail(
          "Amended history requires explicit approval for a lease-checked force push.",
          "修改过的提交历史需要明确批准使用带租约检查的强制推送。",
        );
      const lease = `--force-with-lease=refs/heads/${remote.branch}:${remote.head}`;
      await git(
        w.directory,
        [
          "push",
          lease,
          `https://github.com/${remote.headRepo}.git`,
          `${w.head}:refs/heads/${remote.branch}`,
        ],
        this.gitAuth(await this.secrets.read("github")),
      );
      const confirmed = await api.pr(remote);
      if (confirmed.head !== w.head)
        fail(
          "Push result is not confirmed. Synchronize before replying.",
          "尚未确认推送结果，请先同步再回复。",
        );
      w.expectedRemote = w.head;
      w.pushedHead = w.head;
      d.followUpApproval = undefined;
      return this.save(d);
    });
  }
  async verify(id: string, executable: string, args: string[]) {
    return this.operation("Running verification", id, async () => {
      const d = this.draft(id);
      const root = d.workspace?.directory ?? d.snapshot.repository;
      if (!root) throw Error("No workspace");
      const before = await workspaceDigest(root),
        head = await gitText(root, ["rev-parse", "HEAD"]);
      const result = await runVerification(root, executable, args);
      if (d.workspace) {
        d.workspace.verification = {
          head,
          digest: before,
          command: [executable, ...args].join(" "),
          ...result,
        };
        d.workspace.approval = undefined;
        d.followUpApproval = undefined;
        this.save(d);
      }
      return result;
    });
  }
  async generateReplies(id: string, instructions: string) {
    return this.operation("Drafting replies", id, async () => {
      let d = this.draft(id);
      if (!d.workspace)
        fail(
          "Prepare a workspace with real code changes first.",
          "请先准备包含实际代码修改的工作区。",
        );
      const root = d.workspace.directory,
        head = await gitText(root, ["rev-parse", "HEAD"]),
        before = await workspaceDigest(root),
        diff = await workingDiff(root, d.workspace.originalHead);
      if (!diff.trim())
        fail(
          "No code changes are available to ground replies.",
          "没有可用于生成回复的实际代码修改。",
        );
      const selected = d.feedback.filter((f) => f.selected && !f.replyAttempt);
      if (!selected.length)
        fail("Select feedback to draft replies.", "请选择需要生成回复的反馈。");
      const fresh = await (await this.api()).pr(d.snapshot.pr!);
      const dirty = Boolean(await gitText(root, ["status", "--porcelain"]));
      const pushed = fresh.head === head && !dirty;
      let n = 0;
      for (const item of selected) {
        this.update(item.path ?? item.author, n++, selected.length);
        const replies = new Map<string, string>();
        await this.ai.run(
          await this.aiMessage("reply", {
            items: [{ id: item.id, comment: item.body, path: item.path }],
            actualDiff: diff,
            head,
            publicationState: pushed
              ? "confirmed pushed"
              : "local changes, NOT pushed",
            verification:
              d.workspace?.verification?.digest === before
                ? d.workspace?.verification
                : null,
            instructions,
          }),
          async (op, a) => {
            if (
              op !== "reply" ||
              a.id !== item.id ||
              typeof a.body !== "string" ||
              !a.body.trim() ||
              a.body.length > 60000
            )
              throw Error("Invalid reply target or content");
            replies.set(a.id, a.body);
            return "Local draft only; no publication.";
          },
        );
        if (!replies.has(item.id))
          fail(
            "Copilot did not return a reply for the selected comment.",
            "Copilot 未返回所选评论的回复。",
          );
        if ((await workspaceDigest(root)) !== before)
          fail(
            "Code changed during drafting. Regenerate replies.",
            "生成回复期间代码变化，请重新生成。",
          );
        d = this.store.get(id);
        d.feedback.find((f) => f.id === item.id)!.reply = replies.get(item.id)!;
        d.followUpApproval = undefined;
        this.save(d);
      }
      return d;
    });
  }
  async previewReplies(id: string) {
    return this.operation("Checking reply publication", id, async () => {
      const d = this.draft(id);
      await this.verifyPushed(d);
      return {
        fingerprint: replyFingerprint(d),
        head: d.workspace!.pushedHead,
        items: d.feedback.filter((f) => f.selected),
      };
    });
  }
  private async verifyPushed(d: Draft) {
    if (!d.workspace || !d.snapshot.pr)
      fail(
        "Prepare and push code before publishing replies.",
        "请先准备并推送代码，再发布回复。",
      );
    const w = d.workspace;
    const head = await gitText(w.directory, ["rev-parse", "HEAD"]);
    const remote = await (await this.api()).pr(d.snapshot.pr);
    if (
      remote.head !== head ||
      (await gitText(w.directory, ["status", "--porcelain"])) ||
      remote.headRepo !== d.snapshot.pr.headRepo ||
      remote.branch !== d.snapshot.pr.branch
    )
      fail(
        "Code is not confirmed pushed, or local changes remain. Synchronize and push first.",
        "尚未确认代码已推送，或仍有本地修改，请先同步并推送。",
      );
    w.pushedHead = head;
    const items = d.feedback.filter((f) => f.selected);
    if (!items.length || items.some((f) => !f.reply.trim() && !f.resolve))
      fail(
        "Select replies or resolve actions first.",
        "请先选择回复或标记解决操作。",
      );
  }
  async approveReplies(id: string, fingerprint: string) {
    const d = this.draft(id);
    await this.verifyPushed(d);
    if (replyFingerprint(d) !== fingerprint)
      fail(
        "Reply plan changed. Preview again.",
        "回复计划已变化，请重新预览。",
      );
    d.followUpApproval = fingerprint;
    return this.save(d);
  }
  async publishReplies(id: string) {
    return this.operation("Publishing replies", id, async () => {
      const d = this.draft(id);
      await this.verifyPushed(d);
      if (d.followUpApproval !== replyFingerprint(d))
        fail(
          "Preview and approve the current reply plan.",
          "请预览并批准当前回复计划。",
        );
      const api = await this.api(),
        pr = d.snapshot.pr!;
      for (const item of d.feedback.filter((f) => f.selected)) {
        await this.verifyPushed(d);
        if (item.reply.trim() && !item.replyPosted) {
          if (item.replyAttempt) {
            const found = await api.postedReply(
              pr,
              item,
              item.replyAttempt.marker,
            );
            if (found) {
              item.replyPosted = found.html_url;
              item.replyAttempt.state = "posted";
              this.save(d);
            } else
              fail(
                "A previous reply needs verification. It will not be posted twice.",
                "之前的回复需要核实，不会重复发布。",
              );
          } else {
            const marker = `<!-- ReviewForge-reply:${id}:${crypto.randomUUID()} -->`;
            item.replyAttempt = { marker, state: "sending", body: item.reply };
            this.save(d);
            try {
              const posted = await api.reply(
                pr,
                item,
                item.reply + "\n\n" + marker,
              );
              item.replyPosted = posted.html_url;
              item.replyAttempt.state = "posted";
              this.save(d);
            } catch (e) {
              if (e instanceof GitHubRejected && e.definitelyRejected) {
                item.replyAttempt = undefined;
                d.followUpApproval = undefined;
              } else item.replyAttempt.state = "uncertain";
              this.save(d);
              throw e;
            }
          }
        }
        if (item.resolve && item.threadID && !item.resolveDone) {
          await this.verifyPushed(d);
          await api.resolve(item.threadID);
          item.resolved = true;
          item.resolveDone = true;
          this.save(d);
        }
      }
      return this.save(d);
    });
  }
  async reconcileReplies(id: string) {
    return this.operation("Verifying replies", id, async () => {
      const d = this.draft(id),
        api = await this.api();
      if (!d.snapshot.pr) throw Error("No PR");
      for (const f of d.feedback) {
        if (f.replyAttempt && !f.replyPosted) {
          const match = await api.postedReply(
            d.snapshot.pr,
            f,
            f.replyAttempt.marker,
          );
          if (match) {
            f.replyPosted = match.html_url;
            f.replyAttempt.state = "posted";
          }
        }
      }
      const fresh = await api.feedback(d.snapshot.pr);
      for (const f of d.feedback)
        if (fresh.find((x) => x.id === f.id)?.resolved) {
          f.resolved = true;
          f.resolveDone = true;
        }
      return this.save(d);
    });
  }
}
const idOfProposal = (filename: string) => digest(filename).slice(0, 32);
