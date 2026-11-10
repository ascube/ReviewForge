# ReviewForge Desktop

[English](README.md) · **简体中文** · [下载安装包](https://github.com/ascube/ReviewForge/releases/latest) · [完整使用指南](docs/USER_GUIDE.zh-CN.md)

**审查代码、处理反馈，每次发布由你确认。**

ReviewForge 是基于 Electron、TypeScript 和 React 的 macOS / Windows 桌面应用，使用 GitHub Copilot 审查远程 PR 和本地仓库，生成修复与回复草稿。所有内容先保存在本地，预览并批准后才能发布。

![本地代码审查](docs/screenshots/local-review.png)

*截图来自实际 macOS 应用，使用合成演示数据；不代表真实 PR 或新生成的 Copilot 结果。*

## 下载与安装

到 [Releases](https://github.com/ascube/ReviewForge/releases/latest) 下载：

| 系统 | 推荐安装包 | 其他选项 |
| --- | --- | --- |
| macOS Apple Silicon | `.dmg`，拖到 Applications | `.zip` |
| Windows x64 | `.exe`，可选择安装目录 | 便携 `.zip` |

已内置 Git 和 Copilot 运行时，普通用户无需安装 Node.js、Python、Xcode 或 Git。运行仓库测试仍需项目自己的工具链。当前发布未做 Apple 公证或 Windows 发布者签名；Windows 包为交叉构建，真实 Windows 安装及运行仍待验证。macOS Intel 暂不提供已验证安装包。详细要求和校验方法见[安装指南](docs/USER_GUIDE.zh-CN.md#安装)。

## 主要功能

- **远程 PR 审查：** 读取 PR 描述作为审查依据，缺失时提示；默认缺陷、可维护性和 NIT，支持范围选择、分类筛选、逐文件进度和断点续审。
- **本地审查：** 自动读取当前分支，支持整个仓库、未提交修改、分支对比和最新提交；分支通过列表选择。忽略文件不计入审查，大文件分段，不因总文件数或总上下文大小而静默遗漏。
- **修复问题：** Copilot 先生成本地提案，逐项预览、修改、确认后应用，保留原有换行约定。
- **处理反馈：** 标注已解决与过期评论；本地仓库复制或克隆隔离工作区；同步外部 commit、amend 和 push。
- **回复与解决：** 推送前即可生成回复草稿；确认代码已经推送后，才允许预览批准并发布回复、标记 resolved。
- **本地优先：** SQLite 草稿、归档恢复、Markdown 预览及原文复制、可调整数据目录。代码批准、评论批准和回复批准互相独立。

## 开始使用

1. 首次启动默认英文，与系统语言无关。在 **Settings → Language → 简体中文** 切换，选择会保存。
2. 设置 GitHub / Copilot 凭据，或使用现有 GitHub CLI 登录；点击 **检查 Copilot / 加载模型**。需要有效 Copilot 使用权限，企业 SSO/VPN 限制仍适用。
3. 选择 **远程审查**、**本地审查** 或 **处理反馈**，按[使用指南](docs/USER_GUIDE.zh-CN.md)操作。

只有启动 AI 操作时，选定代码和上下文才会发送给 GitHub Copilot。模型不具备终端执行、提交、推送、发布评论或解决线程的工具。

![中文界面](docs/screenshots/chinese.png)

## 关于与许可证

**Kevin Sun** — *An IT guy working for IHG.*

长期以来，以个人偏好而非共同标准为依据的 code review，促使我决定开源这款长期个人使用的工具，希望让审查更有依据，并聚焦代码质量。这是个人项目，并非 IHG、GitHub 或 Microsoft 的官方产品。

ReviewForge 源码和原创资源使用 [MIT 许可证](LICENSE)。内置的第三方组件保留各自许可证，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。

## 开发与支持

需要 Node.js 24+：`npm ci` → `npm run check` → `npm start`。打包方式参见[英文说明](README.md#development)。

欢迎提交 [Issue](https://github.com/ascube/ReviewForge/issues) 或 PR。请先阅读 [贡献指南](CONTRIBUTING.md)、[安全说明](SECURITY.md) 和 [验证记录](VALIDATION.md)。公开问题中不要上传凭据、公司代码或未脱敏日志。
