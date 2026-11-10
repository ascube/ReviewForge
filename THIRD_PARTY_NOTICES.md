# Third-party software notices

ReviewForge itself is MIT licensed. That license does not replace the licenses of bundled dependencies or grant a GitHub Copilot subscription. Copyright, trademark and license notices from dependency packages are retained.

| Component | License / source |
| --- | --- |
| Electron 45.2.3, including Chromium and Node.js | [Electron MIT](docs/licenses/ELECTRON.txt); the distribution retains `LICENSES.chromium.html` and upstream component notices. [Source](https://github.com/electron/electron/tree/v45.2.3). |
| React, React DOM, diff, Markdown tooling, Zod and other production npm packages | See [collected notices](docs/licenses/NPM-DEPENDENCIES.txt), `package-lock.json` and individual package licenses. |
| GitHub Copilot SDK 1.0.31 | [MIT](docs/licenses/COPILOT-SDK.txt), [upstream](https://github.com/github/copilot-sdk). |
| Bundled GitHub Copilot runtime / CLI 1.0.109 | [GitHub Copilot CLI license](docs/licenses/COPILOT-CLI.txt). Redistributed unmodified as a component of ReviewForge; licensed independently from this application's MIT source. Copilot access remains subject to GitHub's terms and entitlement. Native runtime component notices are retained, including QuickJS and OneAuth. |
| Dugite 3.0.0 | MIT; notices included in the production dependency collection. |
| Embedded Git 2.56.0 / Git for Windows 2.56.0.windows.4 | [GPL-2.0](docs/licenses/GIT-GPL-2.0.txt); standalone executables invoked by ReviewForge. [Build recipe](https://github.com/desktop/dugite-native/tree/a44aeca), [Git source](https://github.com/git/git/tree/a018953688f1b10bddf91bff8747068f5f4746a4), [Windows source](https://github.com/git-for-windows/git/tree/v2.56.0.windows.4). Matching source/build-recipe archives accompany the public release; upstream dependency recipes identify additional bundled libraries. |
| Git LFS 3.8.1 | MIT; [source and notices](https://github.com/git-lfs/git-lfs/tree/v3.8.1). |
| Git Credential Manager 2.9.1 | MIT; [source](https://github.com/git-ecosystem/git-credential-manager/tree/v2.9.1) and [bundled notices](docs/licenses/GIT-CREDENTIAL-MANAGER-NOTICES.txt). |

The Git build is distributed by the upstream `desktop/dugite-native` release `v2.56.0-2`; checksums are pinned by Dugite's embedded-git manifest. Windows includes upstream MinGit components and their original notices. Source/build archives are available alongside the installers in [GitHub Releases](https://github.com/ascube/ReviewForge/releases).

No GitHub, Microsoft or IHG endorsement is implied. ReviewForge is an independently licensed personal application.

## 中文

ReviewForge 自身采用 MIT 许可证；第三方组件保留各自许可证，不因本项目开源而改变。Git、Copilot 运行时等不受 ReviewForge 的 MIT 授权重新许可。Copilot 功能仍需要有效账号权限并遵守 GitHub 条款。发行包保留第三方声明，同时提供 Git 源码及构建配方归档。此项目不代表 IHG、GitHub 或 Microsoft 官方背书。
