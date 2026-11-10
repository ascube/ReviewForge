# Changelog

## 2.0.3 — 2026-11-10

- Explain missing GitHub tokens and distinguish anonymous 404 responses from inaccessible resources when a credential is configured. Diagnostics omit query values, response bodies and credentials.
- Clarify that PR access uses the GitHub token in Settings, separately from Copilot and GitHub CLI authentication.
- Label connection results as GitHub account or Copilot model count, and clear stale results before checking again.
- Preserve the selected language for errors crossing the Electron bridge, including Simplified Chinese authentication guidance.
- Keep all existing preview and approval gates for publication.

## 2.0.2 — 2026-11-10

First public source release under the MIT License.

- Remote PR and local repository reviews with defects, maintainability and NIT categories, per-file progress, resumable review and frozen context.
- Local fix proposals and PR feedback workflows with explicit previews/approvals, external commit/amend/push synchronization and pre-push reply drafts.
- English-first interface with persistent Simplified Chinese selection, Markdown preview/raw copy, local SQLite drafts and archive/restore.
- About page credits Kevin Sun, with the biography “An IT guy working for IHG.” No author email is distributed.
- macOS Apple Silicon and Windows x64 installers, source/documentation archives, checksums and third-party license notices.

macOS Apple Silicon has been exercised locally. Windows packages are cross-built; native Windows and Intel acceptance remains pending. Installers are unsigned and not notarized.

## Earlier local builds

2.0.0 introduced the new cross-platform implementation; 2.0.1 added the bilingual About page. These were local development distributions, not prior public releases.
