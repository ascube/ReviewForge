# Build ReviewForge from source

[简体中文](BUILDING.zh-CN.md) · [Home](../README.md) · [First-time setup](SETUP.md)

The public source is self-contained: no company source, private package registry, internal service or company credential is needed to build or run tests. Copilot is used because it is the tool mandated for the author's work; AI operations require the user's own authorized access after startup. This is an independent personal project.

## 1. Prepare your computer

Use macOS 13+ (Apple Silicon or Intel) or Windows 10/11 x64. Install [Node.js 24+](https://nodejs.org/) with npm and [Git](https://git-scm.com/downloads). Restart the terminal after installation and check:

```sh
node --version
npm --version
git --version
```

Use Terminal on macOS and PowerShell on Windows. In an environment where PowerShell blocks `npm.ps1`, use the installed `npm.cmd` command instead of weakening execution policy. A network connection is needed for public npm packages and official Electron/Git/runtime downloads.

## 2. Get the source

```sh
git clone https://github.com/ascube/ReviewForge.git
cd ReviewForge
```

To reproduce a specific version, optionally run `git checkout v2.1.2` before installing. `main` contains the latest documentation and maintenance changes. A release's Source ZIP also contains the app code and an accompanying provenance record in the release metadata.

## 3. Install locked dependencies

```sh
npm ci
```

Use the supplied lockfile. Do not copy `node_modules` between systems/architectures: Electron, Git and Copilot contain platform-specific binaries. Do not add `--ignore-scripts` for a normal build; dependency installation prepares the required binaries.

## 4. Validate

```sh
npm run check
```

This runs TypeScript checking, 27 tests using temporary repositories/mocked GitHub operations, and the production build. No live GitHub publication or Copilot account is required. The optional live Copilot script is not part of these tests.

## 5. Run locally

```sh
npm start
```

This builds and opens Electron. English is the default. Follow [SETUP.md](SETUP.md) for GitHub/Copilot credentials, model selection and a small first review. Building the app does not grant a Copilot subscription.

## 6. Create native installers

Close the development app, then run:

```sh
npm run make
```

| Build machine | Expected output |
| --- | --- |
| Apple Silicon Mac | `out/make/dmg/arm64/*.dmg` and `out/make/zip/darwin/arm64/*.zip` |
| Intel Mac | `out/make/dmg/x64/*.dmg` and `out/make/zip/darwin/x64/*.zip` |
| Windows x64 | Setup EXE / NuGet update files under `out/make/squirrel.windows/`; portable ZIP under `out/make/zip/win32/` |

Build on the matching system/architecture. The public Windows release uses the native Forge/Squirrel installer for the current user. Ordinary end users do not need your Node.js/Git development installation because the packaged app includes its runtime and Git.

An optional Windows x64 **NSIS cross-build**, with a selectable installation directory, is available via:

```sh
npm run make:windows
```

That separate script downloads checksum-verified Windows runtimes and stages Windows dependencies under `.cache/windows-stage`; outputs are under `out/windows/`. Cross-building does not replace native Windows checks.

## 7. Check packaged startup

On an Apple Silicon Mac:

```sh
"out/ReviewForge Desktop-darwin-arm64/ReviewForge Desktop.app/Contents/MacOS/ReviewForgeDesktop" --smoke-test
```

Use `darwin-x64` on an Intel Mac. On Windows PowerShell:

```powershell
& ".\out\ReviewForge Desktop-win32-x64\ReviewForgeDesktop.exe" --smoke-test
```

The smoke check loads SQLite, bundled Git and the native Copilot runtime without a live login. A successful smoke check does not validate installation UX or a live review/push workflow.

## 8. Signing and release provenance

Unsigned local builds are expected unless publisher credentials are configured. Signing is optional for building and requires your own certificates for trusted distribution; no signing key is included in this repository. See README development notes for supported signing environment variables.

The build workflow runs native checks/packaging on macOS ARM, macOS Intel and Windows x64. The release-assets workflow accepts only a successful build for the selected tag, assembles matching outputs, computes SHA-256 digests and leaves publication as a draft. `RELEASE.json` on the GitHub Release records the application source commit, documentation commit and CI run. Always use the release's own `SHA256SUMS` for its installer files: local rebuilds may have different bytes.

## Troubleshooting

- `npm ci` fails downloading binaries: check network/proxy access to the official registries and release hosts; do not substitute unknown binaries.
- Wrong-architecture runtime: install fresh dependencies on the correct architecture.
- Test/build syntax errors: verify Node.js is 24 or newer and use the lockfile.
- Packaging requires platform tooling: install the tool requested by the build error through the OS/vendor's normal developer setup. Do not bypass security controls.
- Copilot login fails after launch: follow the setup guide; compilation success and Copilot entitlement are separate.

Contribute focused fixes with `npm run check` results and both UI languages verified when relevant.
