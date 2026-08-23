# Contributing to Reading Assistant

感谢你参与 Reading Assistant。Issues 和 Pull Requests 均可使用中文或英文。

## 开发流程

1. Fork 仓库并从最新主分支创建功能分支。
2. 安装依赖：`npm install`。
3. 启动开发服务：`npm run dev`；桌面测试可使用 `npm run desktop:test`。
4. 保持修改范围清晰，不要提交 `node_modules`、`dist`、安装包、API Key 或本机配置。
5. 提交前运行：

```bash
npm run lint
npm run build
```

## Pull Request

- 说明问题、解决方式和验证结果。
- UI 修改请附截图或录屏。
- 行为变化请同步更新中文和英文 README。
- 与 AI 接口有关的修改应保持服务商中立，并避免记录或回传用户的 API Key。

## Bug 报告

请提供操作系统、应用版本、文件类型、复现步骤和错误信息。请勿在 Issue、日志或截图中公开 API Key、私人文档内容或其他敏感信息。
