# Desktop feature parity

ReviewForge Desktop 2.1 closes the functional gaps identified by comparing the original local Swift implementation with Desktop 2.0.3. Windows/macOS use the same application logic. Old Swift database migration and iPad are deliberately outside this release.

| Workflow | Desktop behavior |
|---|---|
| Remote PR review | Frozen head/base and description, missing-description guidance, default defects + maintainability + NIT, scope selection, per-file/chunk progress, resume, category filters, diff findings, editable decisions and separate publication approval. |
| Local review | Working changes, branch comparison picker, latest commit and whole repository; current branch refresh; ignore handling; large-file parts; explicit unavailable files. Unborn repositories are supported; shallow history is distinguished from a root commit. |
| Local fixes | Original review snapshot validation before generation/application; editable per-file proposals; preserved EOL/EOF conventions; independent recovery copy before writes; automatic rollback on failure; guarded, previewed restore; draft discard. |
| Feedback | Full paginated conversations, resolved/outdated labels, hide-resolved filtering, isolated workspace from local or remote source, external editor access and in-app file editing/discard. |
| Code verification and push | Verification tied to code, commit identity and whitespace preview, approval fingerprints, explicit amend consent, force-with-lease, durable attempt record, interrupted push reconciliation and external push synchronization by commit ancestry. |
| Reply drafting | Before or after push; grounded in selected comments and an actual code snapshot; AI suggestion separate from human text; evidence/limitations; single-item or batch generation; explicit adopt/dismiss. Failed batches preserve existing suggestions and replies. |
| Reply publication | Exact confirmed commit/diff preview; independent send and resolve choices; approval gate; account and original-comment checks; returned reply identity and resolved-state verification; uncertain-result recovery. Later remote commits/local edits are kept separate from the confirmed code. |
| Review publication | Own-PR/pending-review checks, current account, frozen PR/description checks, publication fingerprint, durable intent, returned commit/author/state validation, and marker-based reconciliation without blind duplication. |
| Authentication | GitHub Settings → environment → CLI precedence and visible source/account; independent Copilot authentication; model list cleared on failure; bilingual IP/SSO/auth/rate/TLS/network/service/runtime diagnostics. |
| Reports and Markdown | Complete local Markdown export including file assessments, findings/decisions and omissions; remote JSON export; Markdown preview/raw copy, code-block copy, extended document extensions and original AI finding preservation. |
| Data and recovery | Local SQLite, archive/restore/delete guards, verified data-folder copy, unavailable-folder protection, workspace/recovery-path relocation, and retained uncertain publication records. |
| Language and onboarding | English first launch regardless of system locale, persistent Simplified Chinese selection, localized new flows, offline demo, About/author information and setup/build guides. |

The UI need not duplicate Swift control placement. Verification uses an executable plus argument list instead of an implicit shell command. Git and the Copilot runtime are bundled instead of requiring manual runtime-path settings.

## Evidence and limits

The automated suite uses real temporary Git repositories and mocked GitHub mutations. It covers interrupted writes/pushes, stale snapshots, external amend, remote descendants, publication account/state mismatches, reply preservation, report contents, data copying and other core paths. See [VALIDATION.md](../VALIDATION.md) for the exact test/build runs and platform acceptance.

A live Copilot check uses only synthetic code and feedback. It verifies model access, a real review and an evidence-backed reply suggestion, while its GitHub transport prohibits requests/writes. Local UI checks cover both languages and a minimum-size window. These checks do not imply that every GitHub organization permission or every repository/toolchain has been exercised.

Recovery copies are local sensitive project data. They are kept under the configured data folder and are never uploaded with application releases. If later external edits conflict with a restore, ReviewForge preserves those edits and the recovery copy instead of silently overwriting them.
