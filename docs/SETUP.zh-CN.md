# ReviewForge 逐步设置指南

[English](SETUP.md) · [首页](../README.zh-CN.md) · [源码构建](BUILDING.zh-CN.md)

## 个人项目 · 不含任何公司内部信息

**本公开仓库、发行文档和截图不包含任何公司源码、内部文档、业务数据、凭据或私有仓库信息。** 截图仅使用合成演示数据。这是 Kevin Sun 的个人项目，并非 IHG、GitHub 或 Microsoft 的官方或背书产品。

### 为什么后台使用 GitHub Copilot？

**因为 GitHub Copilot 是工作中规定使用的工具，所以我选择它作为 ReviewForge 的 AI 后台。** 我希望在既定工具之上，建立更有依据、更一致的代码审查流程。这不表示本项目包含公司代码、内部系统或公司提供的凭据。

使用时连接你自己有权使用的账号，并自行选择仓库。开始 AI 分析或生成时，选定上下文会发送给 GitHub Copilot，请遵循仓库所有者的使用规则。“公开发行内容不含公司信息”与用户后续自行选择的审查内容是两回事。

## 1. 安装并启动

从 [Releases](https://github.com/ascube/ReviewForge/releases/latest) 选择系统和 CPU 对应的包。macOS 从 DMG 拖入 Applications；Windows 运行 Setup EXE 安装到当前用户目录。便携 ZIP 必须完整解压。校验及未签名限制见[安装说明](USER_GUIDE.zh-CN.md#安装)。

## 2. 选择界面语言

点右上角 **Settings**，在 **Language** 选择 English 或简体中文。首次始终为英文，切换后立即保存；不会翻译代码、路径或已有评论。

## 3. 配置远程 PR 的 GitHub 访问

使用你自己有权访问目标仓库的账号，按 [GitHub 官方 token 指南](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) 创建适当限制的凭据。选择资源所有者和目标仓库、设置有效期，只授予计划操作所需权限。读取仓库、发布审查、推送代码和回复／解决评论所需权限不同；组织可能要求审批或 SSO。

直接在 **GitHub token** 输入凭据，点击 **Check GitHub／检查 GitHub**。应用会先保存再检查，确认返回的是预期账号。此凭据用于仓库和 API 操作，不会自动变成 Copilot 授权。只做本地审查可跳过这一步。

## 4. 配置 Copilot

需要有 Copilot 使用权限的账号及组织要求的授权。二选一：

- **已有批准的凭据：** 在 **Copilot token** 输入支持 Copilot 的凭据。支持方式见 [GitHub 官方说明](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate)，此 Copilot 认证路径不支持 classic PAT。
- **GitHub CLI 登录：** 从 [cli.github.com](https://cli.github.com) 安装 CLI，在终端／PowerShell 执行：

  ```sh
  gh auth login --hostname github.com --git-protocol https --web
  gh auth status
  ```

  在浏览器中用有 Copilot 权限的账号完成登录。ReviewForge 的 **Copilot token** 留空。若以前保存了失效 token，先勾选 **Clear credential／清除凭据** 并保存；单纯留空会保留旧值，旧值仍然优先。多账号可用 `gh auth switch --hostname github.com --user YOUR_USERNAME` 切换，再检查身份；把占位符换成实际用户名。

点击 **Check Copilot / load models／检查 Copilot / 加载模型**。GitHub 连接成功不等于 Copilot 有权限。失败时分别检查账号、订阅、凭据有效期、SSO 和批准的网络。应用运行时使用独立数据目录，不会自动导入其他编辑器的登录。

## 5. 选择模型

连接成功后，从 **Model／模型** 返回的模型中选择，或留空使用默认模型。可用模型取决于当前账号。

## 6. 设置提交身份和数据位置

**Commit author／提交作者** 的姓名与邮箱是你自己的 Git 提交信息，可使用 GitHub no-reply 地址，不是工具作者的联系方式。

**Local data／本地数据** 显示草稿及工作区保存位置。更改目录会复制数据并保留原目录；关闭应用后可备份。凭据由操作系统加密保护。

点击 **Save settings／保存设置**。token 输入框留空表示保留；只有明确勾选清除才会移除。

## 7. 第一次小范围审查

使用你有权发送给 Copilot 的个人或合成示例仓库：

1. **本地审查 → 选择仓库**。
2. 核对当前分支和 HEAD。
3. 选择 **最新提交 → 捕获快照**。
4. 保留默认范围或选择仅缺陷，再点 **分析**。
5. 查看逐文件进度并逐条审核，结果仅保存在本地。

审查 GitHub PR 时，在远程审查中导入 PR，检查描述后再分析；不会自动发布。

## 8. 有意识地预览、批准和发布

修复提案、同步外部提交、安全推送、推送前回复草稿，以及回复／解决操作见[使用指南](USER_GUIDE.zh-CN.md)。不要为了测试认证而点击发布；先核对目标、内容和代码状态。

## 常见设置问题

- **账号不对：** 查看 CLI 当前账号，或保存凭据所属账号。
- **旧 token 一直优先：** 必须明确清除；留空保留旧值。
- **Copilot 拒绝访问：** 单独检查 Copilot 权限，不能只看 GitHub 仓库权限。
- **SSO／网络拒绝：** 走组织批准的访问流程，不绕过限制。
- **没有模型列表：** 先重试 Copilot 连接检查。
- **测试命令找不到：** 安装项目自身工具链，应用只内置自身运行时及 Git。

求助时不要附带凭据、私有／公司代码或未脱敏日志。
