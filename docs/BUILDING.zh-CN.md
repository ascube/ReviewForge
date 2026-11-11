# 从源码构建 ReviewForge

[English](BUILDING.md) · [首页](../README.zh-CN.md) · [首次设置](SETUP.zh-CN.md)

公开源码可独立构建和测试，不需要公司源码、私有包源、内部服务或公司凭据。选择 Copilot 是因为它是作者工作中规定使用的工具；启动后使用 AI 功能，需要用户自己的有效授权。这是独立个人项目。

## 1. 准备环境

使用 macOS 13+（Apple Silicon 或 Intel）或 Windows 10/11 x64。安装 [Node.js 24+](https://nodejs.org/)（包含 npm）和 [Git](https://git-scm.com/downloads)，重新打开终端后确认：

```sh
node --version
npm --version
git --version
```

macOS 使用 Terminal，Windows 使用 PowerShell。如果 PowerShell 阻止 `npm.ps1`，使用已安装的 `npm.cmd`，不要为此降低执行策略。安装依赖需要访问公共 npm 包源和官方 Electron／Git／运行时下载地址。

## 2. 获取源码

```sh
git clone https://github.com/ascube/ReviewForge.git
cd ReviewForge
```

若复现指定版本，可在安装前执行 `git checkout v2.1.2`。`main` 包含最新文档和维护改动；Release 的 Source ZIP 也提供应用源码，来源记录见发行元数据。

## 3. 安装锁定依赖

```sh
npm ci
```

使用仓库提供的 lockfile。不要跨系统或 CPU 架构复制 `node_modules`，其中包含特定平台的 Electron、Git 和 Copilot 二进制文件。普通构建不要加 `--ignore-scripts`，安装脚本需要准备这些运行时。

## 4. 检查、测试和构建

```sh
npm run check
```

会执行 TypeScript 检查、27 项临时仓库／模拟 GitHub 测试及生产构建，不需要真实 GitHub 发布权限或 Copilot 账号。可选的真实 Copilot 验证脚本不在这组测试内。

## 5. 本地启动

```sh
npm start
```

会构建并打开 Electron。首次默认英文，认证、模型和第一次审查见[设置指南](SETUP.zh-CN.md)。构建应用本身不会获得 Copilot 订阅。

## 6. 生成原生安装包

关闭开发应用，然后执行：

```sh
npm run make
```

| 构建机器 | 产物位置 |
| --- | --- |
| Apple Silicon Mac | `out/make/dmg/arm64/*.dmg`、`out/make/zip/darwin/arm64/*.zip` |
| Intel Mac | `out/make/dmg/x64/*.dmg`、`out/make/zip/darwin/x64/*.zip` |
| Windows x64 | `out/make/squirrel.windows/` 下的 Setup EXE／更新文件，以及 `out/make/zip/win32/` 下的便携 ZIP |

请在对应系统／架构上构建。公开 Windows 版使用原生 Forge／Squirrel 安装器，安装到当前用户目录；普通用户不需要安装你的开发环境，成品内置运行时和 Git。

另有可选择安装目录的 Windows x64 **NSIS 交叉构建**：

```sh
npm run make:windows
```

该脚本下载经过校验的 Windows 运行时，在 `.cache/windows-stage` 暂存依赖，产物在 `out/windows/`。交叉构建不能代替 Windows 原生验证。

## 7. 检查打包后的运行时

Apple Silicon Mac：

```sh
"out/ReviewForge Desktop-darwin-arm64/ReviewForge Desktop.app/Contents/MacOS/ReviewForgeDesktop" --smoke-test
```

Intel 将路径中的 `darwin-arm64` 改为 `darwin-x64`。Windows PowerShell：

```powershell
& ".\out\ReviewForge Desktop-win32-x64\ReviewForgeDesktop.exe" --smoke-test
```

会检查 SQLite、内置 Git 和 Copilot 原生运行时，无需登录。通过该检查不等于已经验证安装交互或真实审查／推送全过程。

## 8. 签名与发行来源

未配置发布者证书时，本地安装包默认未签名。签名不是构建的必要条件，但可信发行需要你自己的证书；仓库不包含任何签名密钥。支持的签名环境变量见英文 README 开发部分。

CI 在 macOS ARM、Intel 和 Windows x64 上分别检查并打包。发行附件流程只接受目标 tag 的成功构建，计算 SHA-256 后仍保留为草稿。Release 中的 `RELEASE.json` 记录源码提交、文档提交和 CI；校验安装包时使用同一 Release 的 `SHA256SUMS`，本地重新构建可能得到不同字节。

## 常见构建问题

- **依赖下载失败：** 检查网络／代理是否可访问官方包源和发行地址，不要替换为不明二进制文件。
- **架构不匹配：** 在正确系统和架构上重新安装依赖。
- **语法或测试错误：** 确认 Node.js 24+ 并使用提供的 lockfile。
- **提示缺少平台工具：** 按报错通过系统／供应商正常渠道安装，不绕过安全防护。
- **启动后 Copilot 登录失败：** 参照设置指南，构建成功与 Copilot 账号权限是两回事。
