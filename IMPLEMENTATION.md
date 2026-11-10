# ReviewForge Desktop 2

Fresh Electron/TypeScript/React application. No Swift data migration; original project untouched.

Required workflows:

- [x] Persistent English-default / Simplified Chinese UI, encrypted credentials, editable data directory.
- [x] GitHub PR import, description assessment/missing warning, frozen diff/file context, per-file review, scopes/categories, resumable progress, findings/summary Markdown and raw copy.
- [x] Local repository selection, current branch/ref picker, whole repository / uncommitted / branch / latest commit snapshots; ignored files excluded, large files chunked, unsupported files listed.
- [x] Manual findings, review decisions, fingerprinted preview/approval, stale PR check and publish reconciliation.
- [x] GitHub feedback threads with resolved state, filter, select, isolated workspace from local repository or clone.
- [x] Copilot selected feedback/fix-all proposals; preserve EOL, preview/edit/apply with exact-content checks.
- [x] Verification, external commits/amend synchronization, code preview/approval, safe push / explicit lease-checked rewrite, externally pushed state synchronization.
- [x] Copilot reply drafts before push, per-item edit/preview; reply/resolve only after confirmed push and explicit approval; partial failure handling.
- [x] Archive/restore/delete, export, local history.
- [x] Bundled Git and Copilot runtime, macOS/Windows packaging, native-runtime smoke test, native CI and signing configuration.
- [x] Integration and workflow tests; bilingual native UI verification; packaged startup.

Remaining release verification (not claimed complete): Windows physical installation/runtime verification, macOS Intel execution, and publisher signing/notarization.

No live GitHub publication or source repository edits are part of development validation. Use fixture repositories and mocked transports for write flows.
