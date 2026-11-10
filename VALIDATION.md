# Validation — 2026-11-10

## Automated

- `npm run typecheck`: passed.
- `npm test`: 24 tests passed at the last full check.
- `npm run build`: passed.
- `npm audit --omit=dev`: zero known production dependency vulnerabilities at the checked lockfile revision.
- Tests cover local Git snapshots/ignore rules/branch scopes/root commits, lossless large-file chunking, traversal/symlink rejection, LF/CRLF/mixed EOL preservation, external amend detection, review decisions and stale approval checks, interrupted-review resume, description changes, remote thread pagination/resolved state, truncated patches, native repository context traversal, uncertain publication reconciliation, creation/deletion proposals, pre-push reply gating, definitively rejected publication recovery, and real local-bare Git pushes with amend/lease/race protection.

## Live macOS / Copilot

- Packaged macOS ARM64 app launched through its actual application bundle.
- First launch used English. Settings loaded 8 Copilot model identifiers through the bundled native runtime using the existing GitHub CLI login.
- Created an isolated synthetic repository under `.test-data/fixture-repo`; no private production code was used.
- UI selected the repository, read current branch `feature/cart-average`, captured Latest commit, and ran a real Copilot review.
- Copilot found the removed empty-array guard causing `average([])` to return `NaN`; file progress reached 1/1 and the finding remained pending human decision.
- UI generated a real Copilot repair proposal, previewed a one-line insertion, and explicitly applied it only to the fixture repository.
- Independent assertions confirmed `average([]) === 0`, `average([10,20]) === 15`, and all four CRLF line endings remained unchanged.
- English and Simplified Chinese layouts inspected in the native app; the selected language and review history survived application restart. Markdown preview and editable/raw content controls were visible.
- Live reply-generation smoke check used a synthetic PR comment, the actual fixture diff and the real Copilot worker. A local Markdown draft was saved; the pre-push publication gate rejected publication preview. The GitHub transport was a fixture that prohibits writes.

- Final packaged `--smoke-test` returned `ok: true`, bundled Git `2.56.0`, native Copilot runtime loaded, platform `darwin`, architecture `arm64`.
- Archive/restore and automatic repository/branch restoration were verified in the final native interface.

- Final DMG checksum verification and both platform ZIP integrity checks passed. Both packaged main/preload/Copilot worker bundles match the final build byte-for-byte. Installer checksums are recorded in `SHA256SUMS` and `RELEASE.json`.

## Distribution limits

The macOS application was tested on Apple Silicon. Windows x64 is cross-built with Windows-specific Electron, Git and Copilot native dependencies. No Windows machine is attached to this task, so Windows installation/runtime execution is not claimed. Native macOS x64 and Windows CI definitions are included, with subsequent public-release runs recorded below. No live GitHub review, push, comment or resolve operation was performed. External write flows were tested against mocked transports/local fixture repositories.

Developer ID notarization and Authenticode signing require publisher credentials and were not performed.

## 2.0.1 About update

- TypeScript typecheck and production build passed.
- Verified English and Simplified Chinese About layouts in the rebuilt macOS app. Author Kevin Sun and localized IHG bio are displayed; the email and copy-email control are removed.
- English was restored as the current preference; first-launch default remains English.
- Both macOS and Windows application archives contain the final renderer byte-for-byte, version 2.0.1, and no author email in package metadata.
- Rebuilt macOS DMG/ZIP and Windows installer/ZIP; regenerated release checksums. Windows remains cross-built, without native runtime validation.

## 2.0.2 public release preparation

- Typecheck, all 24 tests and production build passed after MIT metadata and distribution-notice changes.
- Captured four actual macOS UI screenshots in an isolated synthetic profile: remote review, local review, feedback and Simplified Chinese. No production repository or credential data was used.
- Added bilingual README/user guides, MIT license, third-party notices, contribution/security guidance and issue templates.
- No new live Copilot or GitHub PR write verification is claimed for this documentation/distribution update.

- Final 2.0.2 packaged macOS smoke returned `ok: true` with Git 2.56.0 and the native Copilot runtime loaded. Both platform ASARs match the production bundles and contain MIT/third-party licenses; local data, credentials and Git metadata are excluded.

## Native public-release CI — v2.0.2

[Build run 42905044776](https://github.com/ascube/ReviewForge/actions/runs/42905044776) completed successfully on 2026-11-10 for source commit `904203de54b901f0db87df0065cdfd799e04a292`.

| Runner | Typecheck / 24 tests / build | Native packaging | Packaged Git / SQLite / Copilot runtime |
| --- | --- | --- | --- |
| macOS ARM64 | Passed | Passed | Passed |
| macOS Intel x64 | Passed | Passed | Passed |
| Windows x64 | Passed | Passed | Passed |

Public installer assets are assembled from these native build artifacts. This supersedes the earlier cross-build-only runtime limitation for Windows and Intel, while interactive installation/UI acceptance on those platforms remains outstanding. No publisher signature or notarization was added. Public screenshots use synthetic data only.

The source ZIP retains the tag's application code and overlays current public documentation. The release metadata records both revisions. README and setup/build guides explain why Copilot was chosen (the author's workplace-mandated tool), and explicitly exclude company source, internal documents, business data, credentials and private repository information from this public distribution.
