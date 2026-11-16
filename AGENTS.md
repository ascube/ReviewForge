# ReviewForge contributor instructions

- English is the first-launch default regardless of the operating system language.
- Support Simplified Chinese and persist the explicit in-app language selection.
- Localize new UI text in both languages, and inspect both layouts. Keep user content and paths unchanged.
- Run `npm run check` for behavioral changes. Use synthetic repositories and mocked GitHub writes in tests.
- Preserve the preview/approval gates for code application, push, review publication and replies/resolution.
- Never include credentials, local review databases, private repository code, generated installers or signing keys in source commits.

## GitHub publishing identity

- The project remote is `https://github.com/ascube/ReviewForge.git`.
- Use the personal GitHub account `ascube` for project pushes, tags, GitHub Actions dispatches and Releases. Do not use a company account for publishing this project.
- Scope credentials to each publishing command; do not switch the global GitHub CLI account. Verify the scoped identity before publishing, and never log tokens.
- This publishing identity is separate from the application's user-configured credentials for reviewing other repositories.
