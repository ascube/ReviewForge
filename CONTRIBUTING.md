# Contributing / 参与贡献

Thanks for helping improve ReviewForge. Open an issue describing the problem and expected behavior before making a large change. Small fixes can go straight to a pull request.

## Development

Use Node.js 24+, npm and Git. Run `npm ci`, `npm run check`, then `npm start`. Tests use temporary fixture repositories and mock GitHub writes; they must not require credentials or modify a real PR. Live Copilot checks are opt-in and must use synthetic data.

Keep changes focused. Preserve English-first startup and persisted Simplified Chinese selection. Update both languages for every new menu, setting, error, dialog and help message, and inspect both layouts. Preserve existing line endings when applying code fixes.

Every external write needs the existing explicit preview/approval workflow. Never give model tools commit, push, shell, publication or resolve capabilities. Include tests for changes to approval, stale-state detection, path containment, authentication or publication recovery.

Run `npm run check` before submitting. Describe the problem, resulting behavior and validation in the PR. Do not commit credentials, local databases, workspace snapshots, company code, build output or signing certificates. Contributions are submitted under the project's MIT license; third-party material must retain its original notices.

## 中文

欢迎提交问题和 PR。大改动先讨论；使用 Node.js 24+，执行 `npm ci`、`npm run check`、`npm start`。测试只能使用临时仓库和模拟发布接口。

所有界面保持默认英文、可选简体中文且选择可保存；新增文案同时维护两种语言并检查布局。保留修复时的换行格式。发布、推送和解决评论必须经过明确预览批准；不能给模型添加直接执行这些操作的能力。

不要提交凭据、数据库、公司代码、工作区快照、打包产物或签名证书。PR 说明问题、修改效果和验证结果。贡献遵循 MIT 许可证，第三方声明必须保留。
