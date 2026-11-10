# ReviewForge contributor instructions

- English is the first-launch default regardless of the operating system language.
- Support Simplified Chinese and persist the explicit in-app language selection.
- Localize new UI text in both languages, and inspect both layouts. Keep user content and paths unchanged.
- Run `npm run check` for behavioral changes. Use synthetic repositories and mocked GitHub writes in tests.
- Preserve the preview/approval gates for code application, push, review publication and replies/resolution.
- Never include credentials, local review databases, private repository code, generated installers or signing keys in source commits.
