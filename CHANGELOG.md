# Changelog

## 2.1.2

- Add in-app Copilot browser/device authorization, with automatic prompting when no login is available and automatic continuation after authorization.
- Reuse the stored login without changing GitHub repository credentials or the active GitHub CLI account; provide an explicit browser sign-in button.
- Add bilingual authorization UI, manual browser fallback, code copying, cancellation and expiry; reject plaintext credential persistence.


## 2.1.1 — 2026-11-10

- Make the rollback fault-injection test use platform-independent path matching, so Windows actually exercises the intended write failure.
- Ship the 2.1 workflow parity changes below after native-platform validation.

## 2.1.0 — validation candidate, not published

- Complete the identified Swift workflow parity gaps: original-snapshot validation, durable fix recovery copies and rollback, workspace file editing/discard, and preserved original AI findings.
- Persist and reconcile exact push attempts, including network interruption followed by external amend; verify contained commits rather than requiring identical remote/local tips.
- Keep generated reply suggestions separate from edited human replies, with per-item generation, evidence, explicit adoption/dismissal, and independent send/resolve choices.
- Recheck publication identity, existing pending reviews, original feedback targets, returned review/reply identity and resolved state.
- Restore GitHub credential fallback with visible account/source, clear stale models, and improve bilingual Copilot diagnostics.
- Restore complete Markdown local reports and extended Markdown document recognition; support unborn repositories and correctly reject missing shallow-clone parent history.
- Add offline demonstration, branch refresh on focus, whitespace/commit identity previews, and verified data-folder copying with recovery-path updates.
- Preserve English-first launch, persistent Simplified Chinese selection, and all explicit approval gates.

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
