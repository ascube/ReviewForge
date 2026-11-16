import React, { useEffect, useState } from "react";
import type { Language, RequestedReviewPage } from "../shared/types";
import { translate } from "./i18n";

export function RequestedReviews({
  language,
  busy,
  settingsOpen,
  openSettings,
  openReview,
}: {
  language: Language;
  busy: boolean;
  settingsOpen: boolean;
  openSettings: () => void;
  openReview: (url: string) => Promise<boolean>;
}) {
  const t = (key: string) => translate(language, key);
  const [data, setData] = useState<RequestedReviewPage>();
  const [page, setPage] = useState(1);
  const [directOnly, setDirectOnly] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError("");
    if (settingsOpen) return;
    setLoading(true);
    window.forge
      .call<RequestedReviewPage>("requestedReviews", { page, directOnly })
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, directOnly, refresh, settingsOpen, language]);
  return (
    <section className="reviewInbox">
      <div className="inboxHeading">
        <button
          className="inboxTitle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "▾" : "▸"} {t("Awaiting my review")}
          {data ? ` (${data.total})` : ""}
        </button>
        {data && <span className="muted">@{data.login}</span>}
        <button
          disabled={loading || settingsOpen}
          onClick={() => {
            setPage(1);
            setRefresh((n) => n + 1);
          }}
        >
          {t("Refresh requests")}
        </button>
      </div>
      {expanded && (
        <>
          <div className="inboxControls">
            <label>
              {t("Review requests")}{" "}
              <select
                value={directOnly ? "direct" : "all"}
                onChange={(e) => {
                  setDirectOnly(e.target.value === "direct");
                  setPage(1);
                }}
              >
                <option value="all">{t("Me and my teams")}</option>
                <option value="direct">{t("Direct requests only")}</option>
              </select>
            </label>
            <small>
              {t(
                "Open PRs requested for the current GitHub account. Results depend on repository access.",
              )}
            </small>
          </div>
          {loading && <p role="status">{t("Loading review requests…")}</p>}
          {error && (
            <div className="alert error">
              <span>{error}</span>
              <button onClick={openSettings}>{t("Settings")}</button>
            </div>
          )}
          {data && (
            <>
              {(data.incomplete || data.truncated) && (
                <p className="warning">
                  {t(
                    data.truncated
                      ? "GitHub search returns at most 1,000 results. This list is not complete."
                      : "GitHub returned partial search results. Refresh to try again.",
                  )}
                </p>
              )}
              {!data.items.length && (
                <p className="muted">
                  {t(
                    "No pending review requests found for this account and filter.",
                  )}
                </p>
              )}
              <div className="inboxList">
                {data.items.map((item) => (
                  <div className="inboxItem" key={item.url}>
                    <div className="inboxItemText">
                      <b>
                        {item.repository} · #{item.number}
                      </b>
                      <div>
                        {item.title}{" "}
                        {item.draft && (
                          <span className="pill">{t("Draft PR")}</span>
                        )}
                      </div>
                      <small>
                        {item.author
                          ? `@${item.author}`
                          : t("Account not reported")}{" "}
                        · {t("Updated")}{" "}
                        {new Date(item.updatedAt).toLocaleString(language)}
                      </small>
                    </div>
                    <div className="rowTools">
                      <button
                        disabled={busy}
                        onClick={async () => {
                          if (await openReview(item.url)) setExpanded(false);
                        }}
                      >
                        {t("Open review")}
                      </button>
                      <button
                        onClick={() =>
                          window.forge.call("openExternal", { url: item.url })
                        }
                      >
                        {t("View on GitHub")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="inboxPages">
                <button
                  disabled={loading || page === 1}
                  onClick={() => setPage((n) => n - 1)}
                >
                  {t("Previous page")}
                </button>
                <span>
                  {t("Page")} {data.page} /{" "}
                  {Math.max(1, Math.ceil(Math.min(data.total, 1000) / 50))}
                </span>
                <button
                  disabled={loading || !data.hasNext}
                  onClick={() => setPage((n) => n + 1)}
                >
                  {t("Next page")}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
