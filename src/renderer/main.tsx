import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  AppState,
  Draft,
  Finding,
  Feedback,
  RepoInfo,
  FileSnapshot,
  Language,
  Proposal,
} from "../shared/types";
import { translate } from "./i18n";
import { about } from "../shared/about";
import "./style.css";
const api = window.forge;
let lang: Language = "en";
const t = (s: string) => translate(lang, s);
function Markdown({ text }: { text: string }) {
  const [raw, setRaw] = useState(false),
    [copied, setCopied] = useState(false);
  return (
    <div className="markdown">
      <div className="microbar">
        <div className="segments">
          <button className={!raw ? "on" : ""} onClick={() => setRaw(false)}>
            {t("Preview")}
          </button>
          <button className={raw ? "on" : ""} onClick={() => setRaw(true)}>
            {t("Raw")}
          </button>
        </div>
        <button
          onClick={() => {
            api.call("copy", { text });
            setCopied(true);
          }}
        >
          {t(copied ? "Copied" : "Copy raw")}
        </button>
      </div>
      {raw ? (
        <pre className="raw">{text}</pre>
      ) : (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (href && /^(https?:|mailto:)/i.test(href))
                    api.call("openExternal", { url: href });
                }}
              >
                {children}
              </a>
            ),
            img: ({ alt }) => <span>[{alt}]</span>,
            pre: ({ children }) => (
              <div className="codeBlock">
                <button
                  onClick={() =>
                    api.call("copy", {
                      text: React.isValidElement(children)
                        ? String((children.props as any).children ?? "")
                        : String(children ?? ""),
                    })
                  }
                >
                  {t("Copy code")}
                </button>
                <pre>{children}</pre>
              </div>
            ),
          }}
        >
          {text}
        </ReactMarkdown>
      )}
    </div>
  );
}
function Diff({
  patch,
  onAdd,
}: {
  patch: string;
  onAdd?: (line: number, side: "LEFT" | "RIGHT") => void;
}) {
  let left = 0,
    right = 0;
  return (
    <div className="diff">
      <table>
        <tbody>
          {patch.split("\n").map((line, i) => {
            const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            let l: number | undefined,
              r: number | undefined,
              kind = "context";
            if (h) {
              left = +h[1];
              right = +h[2];
              kind = "hunk";
            } else if (
              line.startsWith("---") ||
              line.startsWith("+++") ||
              line.startsWith("Index:") ||
              line.startsWith("===")
            ) {
              kind = "meta";
            } else if (line.startsWith("-")) {
              l = left++;
              kind = "removed";
            } else if (line.startsWith("+")) {
              r = right++;
              kind = "added";
            } else if (line.startsWith(" ")) {
              l = left++;
              r = right++;
            }
            return (
              <tr className={kind} key={i}>
                <td className="add">
                  {onAdd && (l || r) ? (
                    <button
                      title={t("Add finding")}
                      onClick={() => onAdd(r ?? l!, r ? "RIGHT" : "LEFT")}
                    >
                      +
                    </button>
                  ) : null}
                </td>
                <td className="line">{l}</td>
                <td className="line">{r}</td>
                <td>
                  <pre>{line || " "}</pre>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function App() {
  const [state, setState] = useState<AppState>(),
    [mode, setMode] = useState("review"),
    [selected, setSelected] = useState(""),
    [archived, setArchived] = useState(false),
    [url, setURL] = useState(""),
    [repo, setRepo] = useState<RepoInfo>(),
    [localScope, setLocalScope] = useState("working"),
    [base, setBase] = useState(""),
    [subfolder, setSubfolder] = useState(""),
    [file, setFile] = useState(""),
    [fileTab, setFileTab] = useState("Diff"),
    [filter, setFilter] = useState("all"),
    [pendingOnly, setPendingOnly] = useState(false),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState<{ type: string; data?: any }>(),
    [hideResolved, setHideResolved] = useState(true),
    [feedbackID, setFeedbackID] = useState(""),
    [addressTab, setAddressTab] = useState("Feedback"),
    [instructions, setInstructions] = useState(""),
    [commitMessage, setCommitMessage] = useState("Address review feedback"),
    [executable, setExecutable] = useState(""),
    [argumentsText, setArguments] = useState("[]"),
    [verification, setVerification] = useState<any>();
  useEffect(() => {
    api.call<AppState>("state").then(setState);
    return api.subscribe(setState);
  }, []);
  useEffect(() => api.onAbout(() => setModal({ type: "about" })), []);
  lang = state?.settings.language ?? "en";
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [state?.settings.language]);
  const d = state?.drafts.find((d) => d.id === selected),
    busy = state?.progress.busy ?? false;
  const run = async (method: string, args: any = {}) => {
    setError("");
    try {
      return await api.call<any>(method, args);
    } catch (e: any) {
      setError(e.localized?.[lang === "en" ? "en" : "zh"] ?? e.message);
      return undefined;
    }
  };
  const act = (method: string, args: any = {}) =>
    run(method, { id: selected, ...args });
  const drafts =
    state?.drafts.filter(
      (d) =>
        d.archived === archived &&
        (mode === "local"
          ? d.snapshot.kind === "local"
          : d.snapshot.kind === "remote"),
    ) ?? [];
  useEffect(() => {
    if (!drafts.some((d) => d.id === selected))
      setSelected(drafts[0]?.id ?? "");
  }, [
    mode,
    archived,
    state?.drafts.map((d) => `${d.id}:${d.archived}`).join("|"),
  ]);
  useEffect(() => {
    setFile(d?.snapshot.files[0]?.path ?? "");
    setFeedbackID(d?.feedback[0]?.id ?? "");
    setVerification(undefined);
    let current = true;
    if (d?.snapshot.kind === "local" && d.snapshot.repository) {
      setLocalScope(d.snapshot.localScope ?? "working");
      setSubfolder(d.snapshot.subfolder ?? "");
      api
        .call<RepoInfo>("repository", { directory: d.snapshot.repository })
        .then((info) => {
          if (!current) return;
          setRepo(info);
          setBase(
            d.snapshot.baseRef ??
              info.branches.find((b) => b === "main" || b === "master") ??
              info.branches[0] ??
              "",
          );
        })
        .catch((e: any) => {
          if (current) {
            setRepo(undefined);
            setError(e.localized?.[lang === "en" ? "en" : "zh"] ?? e.message);
          }
        });
    }
    return () => {
      current = false;
    };
  }, [selected]);
  useEffect(() => {
    const refresh = () => {
      if (mode === "local" && !busy && repo?.directory)
        api
          .call<RepoInfo>("repository", { directory: repo.directory })
          .then(setRepo)
          .catch(() => {});
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [mode, busy, repo?.directory]);
  const chosen = d?.snapshot.files.find((f) => f.path === file),
    selectedFeedback = d?.feedback.find((f) => f.id === feedbackID);
  const update = (patch: any) => act("edit", { patch });
  const selectDraft = (v: Draft | undefined) => {
    if (v?.id) {
      setSelected(v.id);

      setFile(v.snapshot.files[0]?.path ?? "");
    }
  };
  const feedbackChange = (f: Feedback, patch: Partial<Feedback>) =>
    act("editFeedback", {
      items: [
        {
          id: f.id,
          selected: f.selected,
          reply: f.reply,
          resolve: f.resolve,
          ...patch,
        },
      ],
    });
  const reviewed = (f: FileSnapshot) =>
    !f.omission &&
    Object.keys(f.reviews).length >= partCount(f.patch || f.after);
  const findingEditor = (
    finding?: Finding,
    line = 1,
    side: "LEFT" | "RIGHT" = "RIGHT",
  ) =>
    setModal({
      type: "finding",
      data: finding ?? {
        id: crypto.randomUUID(),
        path: file,
        line,
        side,
        title: "",
        body: "",
        kind: "bug",
        severity: "P2",
        decision: "pending",
        origin: "manual",
      },
    });
  if (!state) return <div className="loading">ReviewForge</div>;
  return (
    <div className="shell">
      <header>
        <div className="brand">
          <span className="logo">✓</span>
          <div>
            <strong>ReviewForge</strong>
            <small>{t("Read. Review. Release.")}</small>
          </div>
        </div>
        <nav>
          {[
            ["review", "Review"],
            ["local", "Local Review"],
            ["address", "Address Feedback"],
          ].map(([key, label]) => (
            <button
              className={mode === key ? "active" : ""}
              onClick={() => setMode(key)}
              key={key}
            >
              {t(label)}
            </button>
          ))}
        </nav>
        <div className="headerRight">
          <span className="pill">{t("Local only")}</span>
          <button onClick={() => setModal({ type: "settings" })}>
            ⚙ {t("Settings")}
          </button>
        </div>
      </header>
      <div className="body">
        <aside className="sidebar">
          <div className="sideTitle">
            {t("Local drafts")} <span>{drafts.length}</span>
          </div>
          <div className="segments">
            <button
              className={!archived ? "on" : ""}
              onClick={() => setArchived(false)}
            >
              {t("Active")}
            </button>
            <button
              className={archived ? "on" : ""}
              onClick={() => setArchived(true)}
            >
              {t("Archived")}
            </button>
          </div>
          <div className="draftList">
            {drafts.length === 0 ? (
              <p className="muted">{t("No drafts in this view")}</p>
            ) : (
              drafts.map((item) => (
                <div
                  className={
                    "draftCard " + (selected === item.id ? "selected" : "")
                  }
                  onClick={() => selectDraft(item)}
                  key={item.id}
                >
                  <div className="eyebrow">
                    {item.snapshot.pr
                      ? "#" + item.snapshot.pr.number
                      : item.snapshot.branch}
                    <span>
                      {item.publication?.state === "published" ? "✓" : "◌"}
                    </span>
                  </div>
                  <strong>{item.snapshot.title}</strong>
                  <p>
                    {item.snapshot.pr
                      ? `${item.snapshot.pr.owner}/${item.snapshot.pr.repo}`
                      : item.snapshot.repository?.split(/[\\/]/).at(-1)}
                  </p>
                  <small>
                    {t("Findings")}: {item.findings.length} ·{" "}
                    {new Date(item.createdAt).toLocaleDateString(lang)}
                  </small>
                  <div className="rowTools">
                    <button
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        run("archive", {
                          id: item.id,
                          archived: !item.archived,
                        });
                      }}
                    >
                      {t(item.archived ? "Restore" : "Archive")}
                    </button>
                    <button
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        run("delete", { id: item.id });
                      }}
                    >
                      {t("Delete")}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="sideFoot">
            {t("Every change starts locally. You decide what to publish.")}
          </div>
        </aside>
        <main>
          <section className="sourceToolbar">
            <fieldset disabled={busy}>
              {mode === "local" ? (
                <>
                  <div className="row">
                    <input
                      readOnly
                      value={repo?.directory ?? ""}
                      placeholder={t("Choose repository")}
                    />
                    <button
                      onClick={async () => {
                        const r = await run("chooseRepository");
                        if (r) {
                          setRepo(r);
                          setBase(
                            r.branches.find(
                              (b: string) => b === "main" || b === "master",
                            ) ??
                              r.branches[0] ??
                              "",
                          );
                        }
                      }}
                    >
                      {t("Choose repository")}
                    </button>
                    <button
                      disabled={!repo}
                      onClick={async () => {
                        if (repo)
                          setRepo(
                            await run("repository", {
                              directory: repo.directory,
                            }),
                          );
                      }}
                    >
                      {t("Refresh branches")}
                    </button>
                  </div>
                  {repo && (
                    <div className="branch">
                      ⑂ {t("Current branch")}: <b>{repo.branch}</b>{" "}
                      <code>{repo.head.slice(0, 12)}</code>
                      <span>{repo.subject}</span>
                    </div>
                  )}
                  <div className="row">
                    <label>{t("Scope")}</label>
                    <select
                      value={localScope}
                      onChange={(e) => setLocalScope(e.target.value)}
                    >
                      {[
                        ["working", "Uncommitted changes"],
                        ["branch", "Branch changes"],
                        ["latest", "Latest commit"],
                        ["repository", "Whole repository"],
                      ].map(([v, l]) => (
                        <option value={v} key={v}>
                          {t(l)}
                        </option>
                      ))}
                    </select>
                    {localScope === "branch" && (
                      <select
                        aria-label={t("Comparison branch")}
                        value={base}
                        onChange={(e) => setBase(e.target.value)}
                      >
                        {repo?.branches.map((b) => (
                          <option key={b}>{b}</option>
                        ))}
                      </select>
                    )}
                    <input
                      placeholder={t("Subfolder (optional)")}
                      value={subfolder}
                      onChange={(e) => setSubfolder(e.target.value)}
                    />
                    <button
                      className="primary"
                      disabled={!repo}
                      onClick={async () =>
                        selectDraft(
                          await run("capture", {
                            directory: repo!.directory,
                            scope: localScope,
                            baseRef: base,
                            subfolder,
                          }),
                        )
                      }
                    >
                      {t("Capture snapshot")}
                    </button>
                  </div>
                </>
              ) : (
                <div className="row">
                  <input
                    value={url}
                    placeholder={t("GitHub PR URL")}
                    onChange={(e) => setURL(e.target.value)}
                  />
                  <button
                    className="primary"
                    disabled={!url}
                    onClick={async () => {
                      const existing = state.drafts.find(
                        (d) => d.snapshot.pr?.url === url.trim() && !d.archived,
                      );
                      if (mode === "address" && existing) {
                        selectDraft(existing);
                        await run("loadFeedback", { id: existing.id });
                      } else {
                        const result = await run("importPR", { url });
                        selectDraft(result);
                        if (mode === "address" && result)
                          await run("loadFeedback", { id: result.id });
                      }
                    }}
                  >
                    {t(mode === "address" ? "Open PR feedback" : "Import PR")}
                  </button>
                </div>
              )}
            </fieldset>
          </section>
          {error && (
            <div className="alert error">
              <span>{error}</span>
              <button onClick={() => setError("")}>×</button>
            </div>
          )}
          {notice && (
            <div className="alert">
              <span>{notice}</span>
              <button onClick={() => setNotice("")}>×</button>
            </div>
          )}
          {!d ? (
            <div className="empty">
              <span className="emptyIcon">⌘</span>
              <h1>{t("Your review workspace")}</h1>
              <p>
                {t(
                  "Import a pull request or capture a local repository snapshot to begin.",
                )}
              </p>
              <small>
                {t("Every change starts locally. You decide what to publish.")}
              </small>
              <button
                onClick={async () => {
                  const demo = await run("openDemo");
                  if (demo) {
                    setMode("local");
                    selectDraft(demo);
                  }
                }}
              >
                {t("Open a demo draft")}
              </button>
            </div>
          ) : (
            <>
              <section className="reviewHead">
                <div className="row">
                  <div className="grow">
                    <div className="eyebrow">
                      {d.snapshot.pr
                        ? `${d.snapshot.pr.owner}/${d.snapshot.pr.repo} · #${d.snapshot.pr.number}`
                        : t("Local Review")}
                    </div>
                    <h2>{d.snapshot.title}</h2>
                    <p className="muted">
                      ⑂ {d.snapshot.branch}{" "}
                      <code>{d.snapshot.head.slice(0, 12)}</code>
                    </p>
                  </div>
                  <button onClick={() => act("export")}>{t("Export")}</button>
                  {d.snapshot.pr && (
                    <button
                      onClick={() =>
                        run("openExternal", { url: d.snapshot.pr!.url })
                      }
                    >
                      ↗
                    </button>
                  )}
                </div>
                {d.archived ? (
                  <div className="alert">
                    {t("This review is archived. Restore it to continue.")}
                    <button onClick={() => act("archive", { archived: false })}>
                      {t("Restore")}
                    </button>
                  </div>
                ) : mode !== "address" ? (
                  <>
                    <div className="row wrap">
                      <label>{t("Review scope")}</label>
                      <select
                        disabled={busy || !!d.publication}
                        value={d.scope}
                        onChange={(e) => update({ scope: e.target.value })}
                      >
                        <option value="detailed">
                          {t("Defects + maintainability + NIT")}
                        </option>
                        <option value="bugsOnly">{t("Defects only")}</option>
                      </select>
                      <button
                        className="primary"
                        disabled={busy || !!d.publication}
                        onClick={() => act("analyze", { resume: false })}
                      >
                        ✧{" "}
                        {t(
                          d.analysisState === "idle"
                            ? "Analyze"
                            : "Analyze again",
                        )}
                      </button>
                      <button
                        disabled={busy || !!d.publication}
                        onClick={() => act("analyze", { resume: true })}
                      >
                        {t("Resume remaining")}
                      </button>
                      {d.snapshot.kind === "local" && (
                        <button
                          disabled={
                            busy ||
                            !d.findings.some((f) => f.decision !== "exclude")
                          }
                          onClick={() => (
                            setFileTab("Proposals"),
                            act("generateFix", { instructions })
                          )}
                        >
                          {t("Fix all findings")} (
                          {
                            d.findings.filter((f) => f.decision !== "exclude")
                              .length
                          }
                          )
                        </button>
                      )}
                    </div>
                    {d.snapshot.pr && (
                      <div
                        className={
                          "descriptionNote " +
                          (missing(d.snapshot.pr.body) ? "warning" : "")
                        }
                      >
                        <span>
                          {t(
                            missing(d.snapshot.pr.body)
                              ? "PR description is missing. Review can continue, but intent and acceptance criteria cannot be verified against it."
                              : "Description included in review requirements",
                          )}
                        </span>
                        <button
                          onClick={() =>
                            setModal({
                              type: "description",
                              data: d.snapshot.pr,
                            })
                          }
                        >
                          {t("View description")}
                        </button>
                        <button
                          disabled={busy}
                          onClick={async () =>
                            selectDraft(
                              await run("importPR", {
                                url: d.snapshot.pr!.url,
                              }),
                            )
                          }
                        >
                          {t("Import latest version")}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="row wrap">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => act("loadFeedback")}
                    >
                      {t(
                        d.feedback.length
                          ? "Refresh feedback"
                          : "Load feedback",
                      )}
                    </button>
                    <span className="muted">
                      {t(
                        "Choose feedback, prepare a workspace, generate fixes, then inspect every change.",
                      )}
                    </span>
                  </div>
                )}
              </section>
              {mode !== "address" ? (
                <div className="reviewColumns">
                  <div className="reviewCenter">
                    <div className="coverage">
                      <div className="row">
                        <strong>
                          {t("Files reviewed")}:{" "}
                          {d.snapshot.files.filter(reviewed).length} /{" "}
                          {d.snapshot.files.length}
                        </strong>
                        <span>
                          {Math.round(
                            (d.snapshot.files.filter(reviewed).length /
                              Math.max(1, d.snapshot.files.length)) *
                              100,
                          )}
                          %
                        </span>
                      </div>
                      <progress
                        value={d.snapshot.files.filter(reviewed).length}
                        max={d.snapshot.files.length || 1}
                      />
                      <div className="row">
                        <label>
                          <input
                            type="checkbox"
                            checked={pendingOnly}
                            onChange={(e) => setPendingOnly(e.target.checked)}
                          />
                          {t("Unreviewed only")}
                        </label>
                        <span className="muted">
                          {t("Unsupported / unavailable")}:{" "}
                          {d.snapshot.files.filter((f) => f.omission).length}
                        </span>
                      </div>
                    </div>
                    <div
                      className="files"
                      style={{
                        height: Math.min(
                          210,
                          52 + d.snapshot.files.length * 52,
                        ),
                      }}
                    >
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t("Search files")}
                      />
                      {d.snapshot.files
                        .filter(
                          (f) =>
                            (!pendingOnly || !reviewed(f)) &&
                            f.path.toLowerCase().includes(search.toLowerCase()),
                        )
                        .map((f) => (
                          <button
                            className={
                              "fileRow " +
                              (file === f.path ? "selected" : "") +
                              " " +
                              (reviewed(f) ? "reviewed" : "")
                            }
                            key={f.path}
                            onClick={() => setFile(f.path)}
                          >
                            <span className="statusIcon">
                              {f.omission ? "!" : reviewed(f) ? "✓" : "○"}
                            </span>
                            <span className="grow">
                              <strong title={f.path}>{f.path}</strong>
                              <small>
                                {(f.omission ? t(f.omission) : undefined) ??
                                  (f.error
                                    ? t("Incomplete")
                                    : t(
                                        reviewed(f)
                                          ? "Reviewed"
                                          : "Not reviewed",
                                      ))}
                              </small>
                            </span>
                            <span className="counts">
                              {
                                d.findings.filter((x) => x.path === f.path)
                                  .length
                              }
                            </span>
                          </button>
                        ))}
                    </div>
                    <div className="codeHead">
                      <span title={file}>{file}</span>
                      <select
                        value={fileTab}
                        onChange={(e) => setFileTab(e.target.value)}
                      >
                        {[
                          "Diff",
                          "Full file",
                          "File assessment",
                          "Proposals",
                        ].map((v) => (
                          <option value={v} key={v}>
                            {t(v)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="codeBody">
                      {fileTab === "Proposals" ? (
                        <Proposals
                          draft={d}
                          busy={busy}
                          act={act}
                          show={setModal}
                        />
                      ) : chosen ? (
                        chosen.omission ? (
                          <div className="padded warning">
                            {t(chosen.omission)}
                          </div>
                        ) : fileTab === "Diff" ? (
                          <Diff
                            patch={chosen.patch}
                            onAdd={
                              !busy && !d.publication && !d.archived
                                ? (line, side) =>
                                    findingEditor(undefined, line, side)
                                : undefined
                            }
                          />
                        ) : fileTab === "Full file" ? (
                          /\.(md|markdown|mdown|mkd|mdx)$/i.test(file) ? (
                            <Markdown
                              text={
                                chosen.status === "removed"
                                  ? chosen.before
                                  : chosen.after
                              }
                            />
                          ) : (
                            <pre className="source">
                              {chosen.status === "removed"
                                ? chosen.before
                                : chosen.after}
                            </pre>
                          )
                        ) : (
                          <Markdown
                            text={
                              Object.values(chosen.reviews).join("\n\n") ||
                              t("Not reviewed")
                            }
                          />
                        )
                      ) : null}
                    </div>
                    <small className="footnote">
                      {t(
                        "Frozen snapshot · Code is sent to Copilot when you start analysis",
                      )}
                    </small>
                  </div>
                  <aside className="inspector">
                    <div className="row">
                      <h3>{t("Review draft")}</h3>
                      <span className="pill">
                        {t(
                          d.publication?.state === "published"
                            ? "Published"
                            : d.approval
                              ? "Approved"
                              : "Local only",
                        )}
                      </span>
                    </div>
                    <section>
                      <div className="row">
                        <h4>{t("Summary")}</h4>
                        <button
                          disabled={busy || !!d.publication || d.archived}
                          onClick={() =>
                            setModal({ type: "summary", data: d.summary })
                          }
                        >
                          {t("Edit")}
                        </button>
                      </div>
                      <div className="summarySmall">
                        <Markdown text={d.summary || t("No findings")} />
                      </div>
                    </section>
                    <div className="row">
                      <h4>
                        {t("Findings")} ({d.findings.length})
                      </h4>
                      <button
                        disabled={
                          busy || !!d.publication || !chosen || d.archived
                        }
                        onClick={() => findingEditor()}
                      >
                        +
                      </button>
                    </div>
                    <select
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">{t("All categories")}</option>
                      {[
                        ["bug", "Defect"],
                        ["maintainability", "Maintainability"],
                        ["nit", "NIT"],
                      ].map(([v, l]) => (
                        <option key={v} value={v}>
                          {t(l)}
                        </option>
                      ))}
                    </select>
                    <small>
                      {t("Pending decisions across all categories")}:{" "}
                      {
                        d.findings.filter((f) => f.decision === "pending")
                          .length
                      }
                    </small>
                    <div className="findingList">
                      {d.findings
                        .filter((f) => filter === "all" || f.kind === filter)
                        .map((f) => (
                          <div className="findingCard" key={f.id}>
                            <div className="row">
                              <span className={"badge " + f.kind}>
                                {t(
                                  f.kind === "bug"
                                    ? "Defect"
                                    : f.kind === "nit"
                                      ? "NIT"
                                      : "Maintainability",
                                )}{" "}
                                {f.kind === "bug" ? f.severity : ""}
                              </span>
                              <button
                                disabled={busy || !!d.publication || d.archived}
                                onClick={() => findingEditor(f)}
                              >
                                {t("Edit")}
                              </button>
                            </div>
                            <strong>{f.title}</strong>
                            <small
                              className="link"
                              onClick={() => setFile(f.path)}
                            >
                              {f.path}:{f.line}
                            </small>
                            <Markdown text={f.body} />
                            <select
                              disabled={busy || !!d.publication || d.archived}
                              value={f.decision}
                              onChange={(e) =>
                                update({
                                  findings: d.findings.map((item) =>
                                    item.id === f.id
                                      ? { ...item, decision: e.target.value }
                                      : item,
                                  ),
                                })
                              }
                            >
                              {[
                                ["pending", "Pending"],
                                ["include", "Include"],
                                ["exclude", "Exclude"],
                              ].map(([v, l]) => (
                                <option value={v} key={v}>
                                  {t(l)}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                    </div>
                    <div className="publishBar">
                      {d.snapshot.pr ? (
                        <>
                          <select
                            disabled={busy || !!d.publication || d.archived}
                            value={d.event}
                            onChange={(e) => update({ event: e.target.value })}
                          >
                            {[
                              ["COMMENT", "Comment"],
                              ["APPROVE", "Approve PR"],
                              ["REQUEST_CHANGES", "Request changes"],
                            ].map(([v, l]) => (
                              <option key={v} value={v}>
                                {t(l)}
                              </option>
                            ))}
                          </select>
                          <button
                            disabled={busy || d.archived}
                            onClick={async () => {
                              const p = await act("previewReview");
                              if (p) setModal({ type: "review", data: p });
                            }}
                          >
                            {t("Preview publication")}
                          </button>
                          {d.publication &&
                            d.publication.state !== "published" && (
                              <button
                                disabled={busy}
                                onClick={() => act("reconcileReview")}
                              >
                                {t("Verify publication")}
                              </button>
                            )}
                        </>
                      ) : (
                        <button
                          onClick={async () => {
                            const report = await act("previewReport");
                            if (report !== undefined)
                              setModal({ type: "report", data: report });
                          }}
                        >
                          {t("Preview report")}
                        </button>
                      )}
                    </div>
                  </aside>
                </div>
              ) : (
                <div className="addressColumns">
                  <div className="feedbackList">
                    <div className="row">
                      <h3>
                        {t("Feedback")} (
                        {d.feedback.filter((f) => f.selected).length})
                      </h3>
                    </div>
                    <label>
                      <input
                        type="checkbox"
                        checked={hideResolved}
                        onChange={(e) => setHideResolved(e.target.checked)}
                      />
                      {t("Hide resolved")}
                    </label>
                    {d.feedback
                      .filter((f) => !hideResolved || !f.resolved)
                      .map((f) => (
                        <div
                          key={f.id}
                          className={
                            "feedbackCard " +
                            (feedbackID === f.id ? "selected" : "")
                          }
                          onClick={() => setFeedbackID(f.id)}
                        >
                          <div className="row">
                            <input
                              type="checkbox"
                              checked={f.selected}
                              disabled={busy || d.archived}
                              onChange={(e) =>
                                feedbackChange(f, {
                                  selected: e.target.checked,
                                })
                              }
                            />
                            <b>@{f.author}</b>
                            <span className="badge">
                              {f.resolved
                                ? t("Resolved")
                                : f.outdated
                                  ? t("Outdated")
                                  : ""}
                            </span>
                          </div>
                          <p>{f.body.slice(0, 300)}</p>
                          <small>{f.path}</small>
                        </div>
                      ))}
                  </div>
                  <div className="addressCenter">
                    <div className="tabs">
                      {["Feedback", "Proposals", "Code", "Replies"].map((v) => (
                        <button
                          className={addressTab === v ? "active" : ""}
                          onClick={() => setAddressTab(v)}
                          key={v}
                        >
                          {t(v)}
                        </button>
                      ))}
                    </div>
                    <div className="addressScroll">
                      {addressTab === "Feedback" ? (
                        selectedFeedback ? (
                          <>
                            <div className="row">
                              <h3>
                                {selectedFeedback.path ??
                                  "@" + selectedFeedback.author}
                              </h3>
                              <button
                                onClick={() =>
                                  run("openExternal", {
                                    url: selectedFeedback.url,
                                  })
                                }
                              >
                                ↗
                              </button>
                            </div>
                            <Markdown text={selectedFeedback.body} />
                            {selectedFeedback.context && (
                              <>
                                <h4>{t("Comment context")}</h4>
                                <Diff patch={selectedFeedback.context} />
                              </>
                            )}
                          </>
                        ) : (
                          <div className="empty small">
                            {t("Select feedback to inspect")}
                          </div>
                        )
                      ) : addressTab === "Proposals" ? (
                        <Proposals
                          draft={d}
                          busy={busy}
                          act={act}
                          show={setModal}
                        />
                      ) : addressTab === "Code" ? (
                        <>
                          {d.workspace?.preview ? (
                            <>
                              <div className="row">
                                <span className="pill">
                                  {t(
                                    d.workspace.pushedHead
                                      ? "Confirmed pushed"
                                      : "Not confirmed pushed",
                                  )}
                                </span>
                                <code>{d.workspace.head.slice(0, 12)}</code>
                              </div>
                              {d.workspace.preview.rewrite && (
                                <p className="warning">
                                  {t("History rewrite required")}
                                </p>
                              )}
                              <Diff patch={d.workspace.preview.diff} />
                            </>
                          ) : (
                            <div className="empty small">
                              {t("Synchronize / refresh diff")}
                            </div>
                          )}
                        </>
                      ) : (
                        <Replies
                          draft={d}
                          busy={busy}
                          act={act}
                          show={setModal}
                          change={feedbackChange}
                          instructions={instructions}
                        />
                      )}
                    </div>
                  </div>
                  <aside className="tools">
                    <fieldset disabled={busy || d.archived}>
                      <h3>{t("Workspace")}</h3>
                      {!d.workspace ? (
                        <>
                          <button
                            onClick={() =>
                              act("prepareWorkspace", { useLocal: true })
                            }
                          >
                            {t("Prepare from local repo")}
                          </button>
                          <button
                            onClick={() =>
                              act("prepareWorkspace", { useLocal: false })
                            }
                          >
                            {t("Clone PR repository")}
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="path">{d.workspace.directory}</p>
                          <WorkspaceFiles
                            draft={d}
                            busy={busy}
                            act={act}
                            show={setModal}
                          />
                          {d.workspace.pushAttempt && (
                            <p>
                              {t("Push status")}:{" "}
                              {t(d.workspace.pushAttempt.state)} ·{" "}
                              {d.workspace.pushAttempt.commit.slice(0, 12)}
                            </p>
                          )}
                          <button onClick={() => act("openWorkspace")}>
                            {t("Open workspace")}
                          </button>
                          <button onClick={() => act("moveWorkspace")}>
                            {t("Change workspace folder")}
                          </button>
                          <button
                            onClick={async () => {
                              await act("syncWorkspace");
                              setAddressTab("Code");
                            }}
                          >
                            {t("Synchronize / refresh diff")}
                          </button>
                        </>
                      )}
                      <h3>{t("Additional instructions")}</h3>
                      <textarea
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        rows={4}
                      />
                      <button
                        className="primary"
                        disabled={
                          !d.workspace ||
                          !d.feedback.some((f) => f.selected && !f.resolved)
                        }
                        onClick={() => {
                          setAddressTab("Proposals");
                          act("generateFix", { instructions });
                        }}
                      >
                        {t("Generate fixes")}
                      </button>
                      <h3>{t("Verification")}</h3>
                      <input
                        placeholder={t("Executable")}
                        value={executable}
                        onChange={(e) => setExecutable(e.target.value)}
                      />
                      <input
                        placeholder={t("Arguments (JSON array)")}
                        value={argumentsText}
                        onChange={(e) => setArguments(e.target.value)}
                      />
                      <button
                        disabled={!d.workspace || !executable}
                        onClick={async () => {
                          try {
                            setVerification(
                              await act("verify", {
                                executable,
                                arguments: JSON.parse(argumentsText),
                              }),
                            );
                          } catch {
                            setError(t("Arguments (JSON array)"));
                          }
                        }}
                      >
                        {t("Run verification")}
                      </button>
                      {verification ? (
                        <details>
                          <summary
                            className={
                              verification.passed ? "success" : "warning"
                            }
                          >
                            {t(verification.passed ? "Passed" : "Failed")}
                          </summary>
                          <pre>{verification.output}</pre>
                        </details>
                      ) : (
                        <small>
                          {t("Tests have not been run by ReviewForge.")}
                        </small>
                      )}
                      <h3>{t("Code publication")}</h3>
                      <input
                        placeholder={t("Commit message")}
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                      />
                      <button
                        disabled={!d.workspace?.preview}
                        onClick={async () => {
                          const p = await act("previewCode");
                          if (p) setModal({ type: "code", data: p });
                        }}
                      >
                        {t("Preview code")}
                      </button>
                      <button
                        disabled={
                          !d.workspace?.approval || !d.workspace?.preview?.dirty
                        }
                        onClick={() =>
                          act("commit", { message: commitMessage })
                        }
                      >
                        {t("Commit locally")}
                      </button>
                      <button
                        disabled={
                          !d.workspace?.approval || d.workspace?.preview?.dirty
                        }
                        onClick={async () => {
                          const p = await act("previewCode");
                          if (p) setModal({ type: "push", data: p });
                        }}
                      >
                        {t("Push approved commit")}
                      </button>
                      <small>
                        {t(
                          "Preview and approve again after committing or external changes.",
                        )}
                      </small>
                    </fieldset>
                  </aside>
                </div>
              )}
            </>
          )}
        </main>
      </div>
      <footer>
        <span className={busy ? "pulse" : ""}>●</span>
        <span>
          {t(busy ? state.progress.operation : "Ready")}
          {busy && state.progress.detail ? " · " + state.progress.detail : ""}
        </span>
        {busy && (
          <>
            <progress
              value={state.progress.done}
              max={state.progress.total || 1}
            />
            <button onClick={() => run("cancel")}>{t("Cancel")}</button>
          </>
        )}
        <span className="footerRight">
          ReviewForge {about.version} · {t("Local only")}
        </span>
        <button onClick={() => setModal({ type: "about" })}>
          {t("About")}
        </button>
      </footer>
      {state.copilotLogin && (
        <CopilotSignIn prompt={state.copilotLogin} run={run} />
      )}
      {modal && (
        <div className="modalBackdrop">
          <div
            className={
              "modal " +
              (modal.type === "settings"
                ? "settings"
                : modal.type === "about"
                  ? "aboutModal"
                  : "")
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modalHead">
              <h2 id="modal-title">
                {t(
                  (
                    {
                      settings: "Settings",
                      about: "About ReviewForge",
                      finding: "Manual finding",
                      summary: "Review summary",
                      description: "PR description",
                      review: "Publication preview",
                      report: "Preview report",
                      proposals: "Changes preview",
                      proposal: "Edit proposed content",
                      code: "Preview code",
                      push: "Push approved commit",
                      replies: "Reply publication preview",
                      workspace: "Edit workspace file",
                      recovery: "Recovery preview",
                    } as any
                  )[modal.type] ?? modal.type,
                )}
              </h2>
              <button onClick={() => setModal(undefined)}>×</button>
            </div>
            {error && (
              <div className="alert error">
                {error}
                <button onClick={() => setError("")}>×</button>
              </div>
            )}
            <ModalContent
              key={modal.type + (modal.data?.path ?? modal.data?.id ?? "")}
              modal={modal}
              draft={d}
              state={state}
              run={run}
              act={act}
              update={update}
              close={() => setModal(undefined)}
              notice={setNotice}
            />
          </div>
        </div>
      )}
    </div>
  );
}
function CopilotSignIn({
  prompt,
  run,
}: {
  prompt: NonNullable<AppState["copilotLogin"]>;
  run: any;
}) {
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil((prompt.expiresAt - now) / 1000));
  return (
    <div className="modalBackdrop authBackdrop">
      <section
        className="modal authModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="copilot-signin-title"
      >
        <h2 id="copilot-signin-title">{t("Sign in to Copilot")}</h2>
        <p>
          {t(
            "Enter this one-time code on GitHub and authorize Copilot. ReviewForge will continue automatically.",
          )}
        </p>
        <p className="deviceCode">
          <code>{prompt.code}</code>
        </p>
        <div className="row">
          <button
            onClick={async () => {
              await run("copy", { text: prompt.code });
              setCopied(true);
            }}
          >
            {t(copied ? "Copied" : "Copy code")}
          </button>
          <button onClick={() => run("openExternal", { url: prompt.url })}>
            {t("Open GitHub authorization")}
          </button>
        </div>
        <p className="muted">{prompt.url}</p>
        <p>
          {t(
            prompt.browserOpened
              ? "Waiting for browser authorization"
              : "If the browser did not open, use the button above.",
          )}
        </p>
        <p>
          {remaining
            ? `${t("Code expires in")} ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
            : t("Code expired. Cancel and try again.")}
        </p>
        <p className="muted">
          {t(
            "Use an account with Copilot access. Organization VPN or SSO may still be required.",
          )}
        </p>
        <button onClick={() => run("cancel")}>{t("Cancel sign-in")}</button>
      </section>
    </div>
  );
}
function partCount(text: string, max = 32000) {
  let count = 0,
    buffer = 0;
  for (const p of text.match(/[^\n]*\n|[^\n]+$/g) ?? [""]) {
    if (buffer + p.length > max && buffer) {
      count++;
      buffer = 0;
    }
    if (p.length > max) count += Math.ceil(p.length / max);
    else buffer += p.length;
  }
  return count + (buffer || !count ? 1 : 0);
}
function missing(text: string) {
  return !text.replace(/<!--[\s\S]*?(?:-->|$)/g, "").trim();
}
function Proposals({ draft: d, busy, act, show }: any) {
  return (
    <div className="proposals">
      <h3>{t("Local proposals")}</h3>
      {d.proposals.length > 0 && (
        <button disabled={busy} onClick={() => act("discardProposals")}>
          {t("Discard fix draft")}
        </button>
      )}
      {d.fixSummary && <Markdown text={d.fixSummary} />}
      {d.fixBackup && (
        <button
          disabled={busy}
          onClick={async () => {
            const p = await act("previewRecovery");
            if (p) show({ type: "recovery", data: p });
          }}
        >
          {t("Preview recovery copy")}
        </button>
      )}
      <button
        disabled={
          busy ||
          !d.proposals.some(
            (p: Proposal) => p.selected && p.status === "pending",
          )
        }
        onClick={async () => {
          const p = await act("previewProposals");
          if (p) show({ type: "proposals", data: p });
        }}
      >
        {t("Preview selected changes")}
      </button>
      {d.proposals.length === 0 ? (
        <p className="muted">
          {t("Generate local proposals, then preview and apply them.")}
        </p>
      ) : (
        d.proposals.map((p: Proposal) => (
          <div className="proposalCard" key={p.id}>
            <div className="row">
              <input
                type="checkbox"
                disabled={busy || p.status === "applied"}
                checked={p.selected}
                onChange={(e) =>
                  act("editProposal", {
                    proposalID: p.id,
                    content: p.content,
                    selected: e.target.checked,
                  })
                }
              />
              <strong>{p.path}</strong>
              {p.delete && (
                <span className="pill danger">{t("Delete file")}</span>
              )}
              <button
                disabled={busy || p.status === "applied" || p.delete}
                onClick={() => show({ type: "proposal", data: p })}
              >
                {t(p.status === "applied" ? "Applied" : "Edit")}
              </button>
            </div>
            <p>{p.reason}</p>
          </div>
        ))
      )}
    </div>
  );
}
function Replies({ draft: d, busy, act, show, change, instructions }: any) {
  return (
    <div className="replies">
      <h3>{t("Reply drafts")}</h3>
      <p className="muted">
        {t(
          "Generate before push; publish only after code is confirmed pushed.",
        )}
      </p>
      <div className="row wrap">
        <button
          disabled={busy || !d.workspace}
          onClick={() => act("generateReplies", { instructions })}
        >
          {t("Generate reply drafts")}
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            const p = await act("previewReplies");
            if (p) show({ type: "replies", data: p });
          }}
        >
          {t("Preview replies and resolutions")}
        </button>
        <button disabled={busy} onClick={() => act("reconcileReplies")}>
          {t("Verify replies")}
        </button>
      </div>
      {d.feedback
        .filter((f: Feedback) => f.selected)
        .map((f: Feedback) => (
          <ReplyCard
            key={f.id}
            item={f}
            busy={busy}
            change={change}
            act={act}
            instructions={instructions}
          />
        ))}
    </div>
  );
}
function ReplyCard({ item: f, busy, change, act, instructions }: any) {
  const [reply, setReply] = useState(f.reply);
  useEffect(() => setReply(f.reply), [f.reply]);
  return (
    <div className="replyCard">
      <strong>
        @{f.author} · {f.path}
      </strong>
      {f.unavailable && (
        <p className="warning">
          {t("Comment unavailable. Verify publication before continuing.")}
        </p>
      )}
      <details>
        <summary>{t("Original comment")}</summary>
        <Markdown text={f.body} />
      </details>
      <button
        disabled={busy || !!f.replyAttempt}
        onClick={() => act("generateReplies", { instructions, itemID: f.id })}
      >
        {t("Draft this reply with Copilot")}
      </button>
      {f.copilotDraft && (
        <section className="suggestion">
          <h4>{t("Copilot suggestion · Not published")}</h4>
          <Markdown text={f.copilotDraft.body} />
          <details>
            <summary>{t("Evidence and limitations")}</summary>
            <code>{f.copilotDraft.commit}</code>
            <Markdown text={f.copilotDraft.evidence} />
          </details>
          <div className="row wrap">
            <button
              disabled={busy || reply !== f.reply}
              onClick={() => act("useReplyDraft", { itemID: f.id, use: true })}
            >
              {t("Use draft")}
            </button>
            <button
              disabled={busy}
              onClick={() => act("useReplyDraft", { itemID: f.id, use: false })}
            >
              {t("Dismiss suggestion")}
            </button>
          </div>
          {reply !== f.reply && (
            <small>
              {t("Save your edited reply before adopting a suggestion.")}
            </small>
          )}
        </section>
      )}
      <label>
        <input
          type="checkbox"
          checked={f.sendReply !== false}
          disabled={busy || !!f.replyAttempt}
          onChange={(e) => change(f, { sendReply: e.target.checked })}
        />
        {t("Send reply")}
      </label>
      <textarea
        disabled={busy || !!f.replyAttempt}
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        rows={5}
      />
      <div className="row">
        <button
          disabled={busy || !!f.replyAttempt}
          onClick={() => change(f, { reply })}
        >
          {t("Save reply")}
        </button>
        {f.threadID && (
          <label>
            <input
              type="checkbox"
              disabled={busy || f.resolved}
              checked={f.resolve}
              onChange={(e) => change(f, { resolve: e.target.checked })}
            />
            {t("Resolve thread after reply")}
          </label>
        )}
      </div>
      <details>
        <summary>{t("Preview reply")}</summary>
        <Markdown text={reply} />
      </details>
      {f.replyPosted && <small className="success">{t("Reply posted")}</small>}
    </div>
  );
}
function ModalContent({
  modal: m,
  draft: d,
  state,
  run,
  act,
  update,
  close,
  notice,
}: any) {
  const [text, setText] = useState(
      typeof m.data === "string"
        ? m.data
        : m.type === "proposal" || m.type === "workspace"
          ? m.data.content
          : "",
    ),
    [finding, setFinding] = useState<Finding | undefined>(
      m.type === "finding" ? m.data : undefined,
    ),
    [rewrite, setRewrite] = useState(false);
  if (m.type === "settings")
    return (
      <SettingsPanel state={state} run={run} close={close} notice={notice} />
    );
  if (m.type === "about")
    return (
      <div className="aboutContent">
        <div className="aboutBrand">
          <span className="logo" aria-hidden="true">
            ✓
          </span>
          <div>
            <h3>{about.name}</h3>
            <span className="muted">
              {t("Version")} {about.version}
            </span>
          </div>
        </div>
        <h3>{t("Why I’m open-sourcing ReviewForge")}</h3>
        <p className="aboutStatement">
          {about.statement[state.settings.language as Language]}
        </p>
        <div className="aboutAuthor">
          <span className="muted">{t("Author")}</span>
          <strong>{about.author}</strong>
          <span className="aboutBio">
            {about.bio[state.settings.language as Language]}
          </span>
        </div>
      </div>
    );
  if (m.type === "description")
    return (
      <>
        <p className="muted">
          {t(
            "Frozen at import. Re-import the PR to use an updated description.",
          )}
        </p>
        {missing(m.data.body) && (
          <p className="warning">
            {t(
              "PR description is missing. Review can continue, but intent and acceptance criteria cannot be verified against it.",
            )}
          </p>
        )}
        <Markdown text={m.data.body} />
      </>
    );
  if (m.type === "workspace")
    return (
      <WorkspaceFileModal
        data={m.data}
        act={act}
        close={close}
        busy={state.progress.busy}
      />
    );
  if (m.type === "recovery")
    return (
      <>
        <p>
          {t(
            "Restore only if files still match this apply attempt. Later edits are preserved.",
          )}
        </p>
        <code>{m.data.record.root}</code>
        {m.data.diffs.map((entry: any) => (
          <section key={entry.path}>
            <h4>{entry.path}</h4>
            <Diff patch={entry.diff} />
          </section>
        ))}
        <button
          disabled={state.progress.busy || m.data.record.state === "restored"}
          onClick={async () => {
            if (await act("restoreFix", { fingerprint: m.data.fingerprint }))
              close();
          }}
        >
          {t("Confirm restore")}
        </button>
      </>
    );
  if (m.type === "report") return <Markdown text={m.data} />;
  if (m.type === "summary" || m.type === "proposal")
    return (
      <>
        <textarea
          className="largeEditor"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <details>
          <summary>{t("Preview")}</summary>
          <Markdown text={text} />
        </details>
        <div className="modalFoot">
          <button
            className="primary"
            onClick={async () => {
              const result =
                m.type === "summary"
                  ? await update({ summary: text })
                  : await act("editProposal", {
                      proposalID: m.data.id,
                      content: text,
                      selected: m.data.selected,
                    });
              if (result) close();
            }}
          >
            {t("Save")}
          </button>
        </div>
      </>
    );
  if (m.type === "finding" && finding) {
    const change = (patch: Partial<Finding>) =>
      setFinding({ ...finding, ...patch });
    return (
      <div className="form">
        {finding.origin === "copilot" && finding.originalBody && (
          <details>
            <summary>{t("Original AI finding")}</summary>
            <Markdown text={finding.originalBody} />
          </details>
        )}
        <label>
          {t("Title")}
          <input
            value={finding.title}
            onChange={(e) => change({ title: e.target.value })}
          />
        </label>
        <label>
          {t("Body")}
          <textarea
            rows={7}
            value={finding.body}
            onChange={(e) => change({ body: e.target.value })}
          />
        </label>
        <div className="row">
          <select
            value={finding.path}
            onChange={(e) => change({ path: e.target.value })}
          >
            {d.snapshot.files.map((f: FileSnapshot) => (
              <option key={f.path}>{f.path}</option>
            ))}
          </select>
          <input
            aria-label={t("Line")}
            type="number"
            min={1}
            value={finding.line}
            onChange={(e) => change({ line: Number(e.target.value) })}
          />
          <select
            value={finding.side}
            onChange={(e) => change({ side: e.target.value as any })}
          >
            <option value="RIGHT">{t("New code")}</option>
            <option value="LEFT">{t("Old code")}</option>
          </select>
        </div>
        <div className="row">
          <select
            value={finding.kind}
            onChange={(e) =>
              change({
                kind: e.target.value as any,
                severity: e.target.value === "bug" ? finding.severity : "P3",
              })
            }
          >
            {[
              ["bug", "Defect"],
              ["maintainability", "Maintainability"],
              ["nit", "NIT"],
            ].map(([v, l]) => (
              <option value={v} key={v}>
                {t(l)}
              </option>
            ))}
          </select>
          {finding.kind === "bug" && (
            <select
              value={finding.severity}
              onChange={(e) => change({ severity: e.target.value })}
            >
              {["P0", "P1", "P2", "P3"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          )}
          <select
            value={finding.decision}
            onChange={(e) => change({ decision: e.target.value as any })}
          >
            {[
              ["pending", "Pending"],
              ["include", "Include"],
              ["exclude", "Exclude"],
            ].map(([v, l]) => (
              <option value={v} key={v}>
                {t(l)}
              </option>
            ))}
          </select>
        </div>
        <div className="modalFoot">
          <button
            onClick={async () => {
              if (
                await update({
                  findings: d.findings.filter(
                    (f: Finding) => f.id !== finding.id,
                  ),
                })
              )
                close();
            }}
          >
            {t("Remove finding")}
          </button>
          <button
            className="primary"
            disabled={!finding.title.trim() || !finding.body.trim()}
            onClick={async () => {
              const all = d.findings.some((f: Finding) => f.id === finding.id)
                ? d.findings.map((f: Finding) =>
                    f.id === finding.id ? finding : f,
                  )
                : [...d.findings, finding];
              if (await update({ findings: all })) close();
            }}
          >
            {t("Save finding")}
          </button>
        </div>
      </div>
    );
  }
  if (m.type === "review")
    return (
      <>
        <div className="previewScroll">
          <Markdown text={m.data.payload.body} />
          {m.data.payload.comments.map((c: any, i: number) => (
            <section key={i}>
              <code>
                {c.path}:{c.line} · {c.side}
              </code>
              <Markdown text={c.body} />
            </section>
          ))}
        </div>
        {m.data.issues.map((v: string) => (
          <p className="warning" key={v}>
            {t(v)}
          </p>
        ))}
        <div className="modalFoot">
          <button
            disabled={
              state.progress.busy || m.data.issues.length > 0 || !!d.publication
            }
            onClick={() =>
              act("approveReview", { fingerprint: m.data.fingerprint })
            }
          >
            {t("Approve review")}
          </button>
          <button
            className="primary"
            disabled={
              state.progress.busy ||
              d.approval !== m.data.fingerprint ||
              !!d.publication
            }
            onClick={async () => {
              if (await act("publishReview")) close();
            }}
          >
            {t("Publish review")}
          </button>
        </div>
      </>
    );
  if (m.type === "proposals")
    return (
      <>
        <div className="previewScroll">
          {m.data.items.map((p: any) => (
            <section key={p.id}>
              <h3>
                {p.path}{" "}
                {p.delete && (
                  <span className="pill danger">{t("Delete file")}</span>
                )}
              </h3>
              <Diff patch={p.diff} />
            </section>
          ))}
        </div>
        <div className="modalFoot">
          <button
            className="primary"
            disabled={state.progress.busy || !m.data.items.length}
            onClick={async () => {
              if (
                await act("applyProposals", { fingerprint: m.data.fingerprint })
              )
                close();
            }}
          >
            {t("Apply selected changes")}
          </button>
        </div>
      </>
    );
  if (m.type === "code" || m.type === "push")
    return (
      <>
        <div className="row">
          <code>{m.data.preview?.head}</code>
          <span className="pill">
            {t(
              m.data.preview?.dirty
                ? "Uncommitted changes remain"
                : "Awaiting approval",
            )}
          </span>
        </div>
        <p>
          {d.snapshot.pr?.headRepo} → {d.snapshot.pr?.branch}
        </p>
        <p>{m.data.preview?.commitMessage}</p>
        <p className="muted">{m.data.preview?.author}</p>
        <small>
          {t("Expected remote commit")}: {m.data.preview?.remote}
        </small>
        {m.data.preview?.whitespaceReport && (
          <details>
            <summary>{t("Diff whitespace warnings")}</summary>
            <pre>{m.data.preview.whitespaceReport}</pre>
          </details>
        )}
        {d.workspace?.verification?.digest === m.data.preview?.digest ? (
          <details>
            <summary>
              {t(d.workspace.verification.passed ? "Passed" : "Failed")}
            </summary>
            <pre>
              {d.workspace.verification.command +
                "\n" +
                d.workspace.verification.output}
            </pre>
          </details>
        ) : (
          <p className="muted">
            {t(
              "No current verification result. ReviewForge has not verified these changes with tests.",
            )}
          </p>
        )}
        <div className="previewScroll">
          <Diff patch={m.data.preview?.diff ?? ""} />
        </div>
        {m.type === "push" && m.data.preview?.rewrite && (
          <label className="warning">
            <input
              type="checkbox"
              checked={rewrite}
              onChange={(e) => setRewrite(e.target.checked)}
            />
            {t("Allow lease-checked force push for amended history")}
          </label>
        )}
        <div className="modalFoot">
          {m.type === "code" ? (
            <button
              className="primary"
              disabled={state.progress.busy || !m.data.preview}
              onClick={async () => {
                if (
                  await act("approveCode", { fingerprint: m.data.fingerprint })
                )
                  close();
              }}
            >
              {t("Approve code")}
            </button>
          ) : (
            <button
              className="primary"
              disabled={
                state.progress.busy || (m.data.preview?.rewrite && !rewrite)
              }
              onClick={async () => {
                if (await act("push", { allowRewrite: rewrite })) close();
              }}
            >
              {t("Push approved commit")}
            </button>
          )}
        </div>
      </>
    );
  if (m.type === "replies")
    return (
      <>
        <code>{m.data.head}</code>
        {m.data.context && (
          <details>
            <summary>{t("Confirmed code changes")}</summary>
            <Diff patch={m.data.context.diff} />
          </details>
        )}
        <div className="previewScroll">
          {m.data.items.map((f: Feedback) => (
            <section key={f.id}>
              <strong>
                @{f.author} · {f.path}
              </strong>
              {f.sendReply !== false && <Markdown text={f.reply} />}
              {f.resolve && (
                <p className="success">✓ {t("Resolve thread after reply")}</p>
              )}
            </section>
          ))}
        </div>
        <div className="modalFoot">
          <button
            disabled={state.progress.busy}
            onClick={() =>
              act("approveReplies", { fingerprint: m.data.fingerprint })
            }
          >
            {t("Approve reply plan")}
          </button>
          <button
            className="primary"
            disabled={
              state.progress.busy || d.followUpApproval !== m.data.fingerprint
            }
            onClick={async () => {
              if (await act("publishReplies")) close();
            }}
          >
            {t("Publish replies and resolve")}
          </button>
        </div>
      </>
    );
  return null;
}
function SettingsPanel({ state, run, close, notice }: any) {
  const [values, setValues] = useState({
      ...state.settings,
      githubToken: "",
      copilotToken: "",
    }),
    [clearGH, setClearGH] = useState(false),
    [clearCP, setClearCP] = useState(false),
    [status, setStatus] = useState("");
  const save = async () =>
    run("settings", {
      language: values.language,
      model: values.model,
      authorName: values.authorName,
      authorEmail: values.authorEmail,
      ...(clearGH || values.githubToken
        ? { githubToken: values.githubToken }
        : {}),
      ...(clearCP || values.copilotToken
        ? { copilotToken: values.copilotToken }
        : {}),
    });
  return (
    <div className="settingsForm">
      <label>
        {t("Language")}
        <select
          value={values.language}
          onChange={async (e) => {
            const language = e.target.value;
            setValues({ ...values, language });
            await run("settings", {
              language,
              model: values.model,
              authorName: values.authorName,
              authorEmail: values.authorEmail,
            });
          }}
        >
          <option value="en">English</option>
          <option value="zh-Hans">简体中文</option>
        </select>
      </label>
      <h3>GitHub</h3>
      <label>
        {t("GitHub token")} ·{" "}
        {t(state.settings.githubConfigured ? "Saved" : "Not configured")}
        <input
          type="password"
          autoComplete="off"
          value={values.githubToken}
          onChange={(e) =>
            setValues({ ...values, githubToken: e.target.value })
          }
          placeholder={t("Leave blank to keep existing credential")}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={clearGH}
          onChange={(e) => setClearGH(e.target.checked)}
        />
        {t("Clear credential")}
      </label>
      <small>
        {t(
          "PR access uses the saved token, then GH_TOKEN/GITHUB_TOKEN, then GitHub CLI. Check GitHub shows the account and credential source. Private repositories require repository access and any organization SSO authorization.",
        )}
      </small>
      <button
        disabled={state.progress.busy}
        onClick={async () => {
          setStatus("");
          if (await save()) {
            const result = await run("githubConnection");
            if (result) setStatus(t("GitHub account") + " · " + result);
          }
        }}
      >
        {t("Check GitHub")}
      </button>
      <h3>GitHub Copilot</h3>
      <button
        disabled={state.progress.busy}
        onClick={async () => {
          setStatus("");
          if (await save()) {
            const result = await run("copilotLogin");
            if (result)
              setStatus(t("Copilot models available") + " · " + result.length);
          }
        }}
      >
        {t("Sign in with browser")}
      </button>
      <small>
        {t(
          "Browser sign-in becomes the Copilot credential source. GitHub repository credentials and the GitHub CLI account are unchanged.",
        )}
      </small>
      {state.settings.preferSDKLogin && (
        <p className="success">{t("Using browser sign-in")}</p>
      )}
      {state.settings.copilotIdentity && (
        <small>
          {state.settings.copilotIdentity.login ?? t("Account not reported")} ·{" "}
          {t(state.settings.copilotIdentity.source)}
        </small>
      )}
      <label>
        {t("Copilot token")} ·{" "}
        {t(state.settings.copilotConfigured ? "Saved" : "Not configured")}
        <input
          type="password"
          autoComplete="off"
          value={values.copilotToken}
          onChange={(e) =>
            setValues({ ...values, copilotToken: e.target.value })
          }
          placeholder={t("Leave blank to keep existing credential")}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={clearCP}
          onChange={(e) => setClearCP(e.target.checked)}
        />
        {t("Clear credential")}
      </label>
      <small>
        {t(
          "Existing credentials are reused. Without a login, Copilot opens browser authorization when needed. Saving a new token switches back to that token. Company VPN may be required.",
        )}
      </small>
      <button
        disabled={state.progress.busy}
        onClick={async () => {
          setStatus("");
          if (await save()) {
            const result = await run("connection");
            if (result)
              setStatus(t("Copilot models available") + " · " + result.length);
          }
        }}
      >
        {t("Check Copilot / load models")}
      </button>
      <p className="success">{status}</p>
      <label>
        {t("Model")}
        <input
          list="models"
          value={values.model}
          placeholder={t("Default model")}
          onChange={(e) => setValues({ ...values, model: e.target.value })}
        />
        <datalist id="models">
          {state.models.map((m: string) => (
            <option key={m}>{m}</option>
          ))}
        </datalist>
      </label>
      <h3>{t("Commit author")}</h3>
      <div className="row">
        <input
          placeholder={t("Name")}
          value={values.authorName}
          onChange={(e) => setValues({ ...values, authorName: e.target.value })}
        />
        <input
          placeholder={t("Email")}
          value={values.authorEmail}
          onChange={(e) =>
            setValues({ ...values, authorEmail: e.target.value })
          }
        />
      </div>
      <h3>{t("Local data")}</h3>
      <p className="path">{state.settings.dataDirectory}</p>
      <div className="row">
        <button
          disabled={state.progress.busy}
          onClick={async () => {
            if (await run("chooseDataDirectory"))
              notice(t("Data copied; original folder retained"));
          }}
        >
          {t("Change data directory")}
        </button>
        <button onClick={() => run("openData")}>{t("Show folder")}</button>
      </div>
      <p className="muted">
        {t(
          "Tokens are encrypted with the operating system. Publishing credentials are not passed to Copilot.",
        )}
      </p>
      <div className="modalFoot">
        <button
          className="primary"
          disabled={state.progress.busy}
          onClick={async () => {
            if (await save()) close();
          }}
        >
          {t("Save settings")}
        </button>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

function WorkspaceFiles({ draft, busy, act, show }: any) {
  const [files, setFiles] = useState<string[]>([]),
    [selected, setSelected] = useState("");
  useEffect(() => {
    if (busy) return;
    let live = true;
    act("workspaceFiles").then((list: string[]) => {
      if (live && list) {
        setFiles(list);
        setSelected((prev) => (list.includes(prev) ? prev : (list[0] ?? "")));
      }
    });
    return () => {
      live = false;
    };
  }, [draft.id, draft.workspace?.preview?.digest, busy]);
  return (
    <div className="workspaceFiles">
      <select
        aria-label={t("Workspace file")}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        {files.map((file) => (
          <option key={file}>{file}</option>
        ))}
      </select>
      <button
        disabled={busy || !selected}
        onClick={async () => {
          const result = await act("readWorkspaceFile", { path: selected });
          if (result) show({ type: "workspace", data: result });
        }}
      >
        {t("Edit workspace file")}
      </button>
    </div>
  );
}
function WorkspaceFileModal({ data, act, close, busy }: any) {
  const [content, setContent] = useState(data.content),
    [discard, setDiscard] = useState(false);
  return (
    <>
      <p className="path">{data.path}</p>
      <textarea
        className="largeEditor"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <button onClick={() => api.call("copy", { text: content })}>
        {t("Copy raw")}
      </button>
      {/\.(md|markdown|mdown|mkd|mdx)$/i.test(data.path) && (
        <details>
          <summary>{t("Preview")}</summary>
          <Markdown text={content} />
        </details>
      )}
      <details>
        <summary>{t("HEAD version")}</summary>
        <pre className="raw">
          {data.original ?? t("File not present in HEAD")}
        </pre>
      </details>
      <div className="row wrap">
        <button
          disabled={busy}
          onClick={async () => {
            if (
              await act("writeWorkspaceFile", {
                path: data.path,
                content,
                fingerprint: data.fingerprint,
              })
            )
              close();
          }}
        >
          {t("Save file")}
        </button>
        <label>
          <input
            type="checkbox"
            checked={discard}
            onChange={(e) => setDiscard(e.target.checked)}
          />
          {t("Confirm discard of this file's changes")}
        </label>
        <button
          disabled={busy || !discard}
          onClick={async () => {
            if (
              await act("writeWorkspaceFile", {
                path: data.path,
                content: "",
                fingerprint: data.fingerprint,
                discard: true,
              })
            )
              close();
          }}
        >
          {t("Discard file changes")}
        </button>
      </div>
    </>
  );
}
