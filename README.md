# Raid

[中文](README.md) | [English](README_EN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-2.2.0-6b7cff)
![Platform](https://img.shields.io/badge/platform-Windows-0078d4)

Raid 是一款面向论文、教材和技术文档的 PDF / 图片 AI 阅读助手。它提供连续 PDF 阅读、文字选择、跨页区域框选、OCR、全文上下文问答，以及可自行配置的 OpenAI Chat Completions 兼容模型。

> 维护者：**LewisLeo44** · [项目仓库](https://github.com/lewisleo753194/Reading-Assistant)

## 项目来源与致谢

本项目是在原作者 **xyLee（GitHub：[`lxymol`](https://github.com/lxymol)）** 的 [`Reading-Assistant`](https://github.com/lxymol/Reading-Assistant) **1.0.0** 版本基础上继续改进的。感谢原作者完成最初的产品设计、PDF 阅读与选区交互、OCR、AI 问答、桌面应用框架及开源发布；这些工作构成了本项目后续开发的基础。

当前 `2.2.0` 版本相较原作者的 `1.0.0` 版本，主要增加和改进了：

- 以项目组织多份 PDF、图片和文本来源，并允许每个对话单独选择资料范围。
- 接入 ChatGPT Plus / Codex 登录、模型选择、流式回答、深度思考和可选联网搜索。
- 增强同一对话内的连续追问：保存每轮真实问题、资料范围、来源、页码和附件，并让短追问参与大文档检索。
- 增加对话专属附件、OpenAI Responses 原文件索引与项目文件搜索能力。
- 优化大型扫描 PDF：首次提问使用代表页视觉上下文，避免整本 OCR 长时间阻塞，并支持选区 OCR 与停止生成。
- 增加项目级笔记、文字/墨迹批注、来源引用跳转、用户记忆及长对话压缩。
- 改进多面板与原生浮动窗口、停靠交互、并行请求、错误隔离和 Windows 构建发布流程。

本分支保留 MIT License 中的原作者版权声明，并追加当前维护者声明。

## 主要功能

- 连续 PDF 页面流，支持鼠标滚轮或触控板平滑滚动，以及 60%–300% 缩放。
- 同时打开多个来源；每份来源分别保存页码、缩放、选区、笔记与批注，并共享项目对话。
- 将多份 PDF、图片和文本资料放进同一个学习项目；聊天可在“自由提问 / 选区 / 当前来源 / 项目来源”之间切换。
- “项目来源”支持按对话勾选任意文件组合，并用“文件名 + 页码”的可跳转引用区分不同教材分册；输入区上方会持续显示本次实际使用的上下文。
- 可在学习过程中继续批量加入 PDF、PNG/JPEG/WebP 等图片，以及 TXT、Markdown、CSV、JSON、HTML、XML 文本资料。
- 文字选择模式支持复制、就近翻译和发送到 AI；区域选择模式支持跨页框选。
- 读取 PDF 原生文字；图片和扫描内容可使用中英文 Tesseract OCR。
- 对选区或全文执行翻译、解释、洞察、总结和自定义提问。
- 分别配置默认模型、公式与图表理解模型、深度思考模型。
- 不同文件和不同对话可并行请求 AI，不会相互阻塞。
- AI 回答支持 GitHub Flavored Markdown、代码块、表格和 KaTeX 数学公式。
- 日间 / 夜间模式同步作用于界面和文档，并保留上次选择。
- 内置中文和英文界面；AI 回答及翻译目标语言随应用语言切换。
- 大型 PDF 按需渲染当前页附近内容，降低内存占用。
- AI 输入框可从上边界垂直调整高度，并保持最新对话可见；左侧选区与对话区域也可拖动分隔线调整。
- 关闭选区侧栏后，新增选区不会强制重新展开。
- 可选的文件记忆会在重新打开同一文件时恢复对话、页码和阅读状态。
- 可选的用户记忆会学习稳定的背景与回答偏好，并支持在设置中查看、编辑和清空。
- Codex 模式可按需联网搜索最新或项目外资料，并在回答中把项目内引用与网页链接分开显示。
- Studio 可基于全部来源一键生成学习指南、简报、FAQ 和时间线。

## 安装

Windows 用户可以在 [GitHub Releases](https://github.com/lewisleo753194/Reading-Assistant/releases) 下载最新安装程序。安装包不会修改系统环境变量，也不要求另行安装 Node.js。

当前版本：`2.2.0`。

## AI 配置

点击应用右上角的设置按钮，可以在两种调用方式间切换：

- **ChatGPT Plus / Codex**：先在系统中安装 `codex` CLI，然后在设置页点击“登录 ChatGPT”。浏览器登录完成后，获取模型列表并选择模型；不需要填写 API Key。此模式通过本机 `codex app-server` 使用当前 ChatGPT 账户的 Codex 权益。
- **兼容 API 服务**：沿用原来的兼容接口地址、模型名称和 API Key。应用不预设服务商，原有默认、视觉和深度思考三套模型配置保持不变。

Codex 模式只替换模型调用。PDF/图片读取、OCR、全文与选区上下文、Skills、记忆、笔记、批注和页码引用仍使用 Raid 原有流程。Codex 临时线程采用只读沙箱、禁止审批，并在回答结束后自动丢弃。

Codex 模式还可以在模型设置中开启“联网搜索”。开启后，模型仍优先使用项目内来源；只有问题要求最新信息、外部补充或本地材料不足时才搜索网页。项目资料使用文件名与页码引用，网络补充保留可点击网页链接。兼容 API 模式仍使用服务商的 Chat Completions 兼容接口，不假定服务商支持联网工具。

| 配置 | 用途 |
| --- | --- |
| 默认模型 | 普通文字处理、全文问答和翻译 |
| 公式与图表理解 | 接收区域裁图，分析公式、图表和示意图 |
| 深度思考 | 开启右侧“深度思考”后处理纯文字推理任务 |

高级模型的接口地址或 Key 留空时会沿用默认配置。“测试连接”会验证默认模型以及所有已启用的高级模型。接口应兼容：

- `GET /models`
- `POST /chat/completions`

图片选区与深度思考同时开启时，应用会明确提示关闭深度思考，避免丢弃图片后误用全文回答。

## Skill 与语言包

- 在“设置 → 技能设置”中选择一个根目录含 `SKILL.md` 的文件夹。应用会读取 Skill 说明及目录中的文本参考文件。
- AI 默认根据 Skill 的 `name` 和 `description` 自动选择；也可在聊天开头输入 `/skill-command` 强制指定。
- 在“设置 → 语言设置”中可导入包含 `language.json` 的文件夹。语言包需包含 `code`、`label`、`aiLanguage` 和 `strings` 字段。
- 选中语言同时控制界面语言、AI 回答语言和翻译目标语言。

## 记忆

- “设置 → 记忆设置”可分别开启或关闭文件记忆与用户记忆。
- 文件记忆存入本机 IndexedDB，仅保存对话和阅读状态，不保存 PDF 或图片文件本体；可以按文件删除或全部清空。
- 用户记忆保存在本机，提炼过程会调用用户配置的默认 AI 模型。它只用于个性化讲解深度、表达方式和格式。
- 用户可以直接修改或清空画像；关闭用户记忆后，画像不会发送给 AI，也不会继续自动更新。

## 从源码运行

需要 Node.js 20 或更高版本。

如需使用 ChatGPT Plus / Codex 模式，还需确保命令行中可以运行 `codex --version`。也可通过 `CODEX_CLI_PATH` 环境变量指定 Codex CLI 的完整路径。

```bash
npm install
npm run dev
```

浏览器开发服务默认位于 <http://localhost:5173>。启动桌面测试版：

```bash
npm run desktop:test
```

## 构建

```bash
npm run lint
npm run test:codex
npm run build
npm run desktop:pack
```

Windows NSIS 安装程序输出到 `release-2.2.0/`。发布产物已被 Git 忽略，请通过 GitHub Releases 上传安装包，不要把安装包直接提交到源码历史。

## 隐私与安全

- PDF 和图片由 PDF.js 与 Tesseract.js 在本机处理。
- 只有发起 AI 请求后，相关选区、必要的文档上下文、近期对话和最多 4 张视觉选区才会发送到用户配置的服务。
- 开启用户记忆后，本次用户要求和助手回答会发送给默认模型以提炼画像；文档原文不会作为画像提炼材料。
- API 配置保存在应用本机数据目录，不会写入仓库或安装包，但并非操作系统密钥库加密；请只在可信设备使用。
- ChatGPT 登录凭据由 Codex CLI 自己管理，Raid 不读取或保存访问令牌；发起 Codex 问答时，相关材料会按 ChatGPT/Codex 的服务规则发送给 OpenAI。
- `.env` 与本地构建产物已被 Git 忽略。提交前仍建议运行秘密扫描，并确认没有误加入 Key。

安全问题请参阅 [SECURITY.md](SECURITY.md)。

## 贡献

欢迎提交 Issue 和 Pull Request。开始开发前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

本项目采用 [MIT License](LICENSE)。
