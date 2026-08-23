# Reading Assistant

[中文](README.md) | [English](README_EN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-0.2.0-6b7cff)
![Platform](https://img.shields.io/badge/platform-Windows-0078d4)

Reading Assistant 是一款面向论文、教材和技术文档的 PDF / 图片 AI 阅读助手。它提供连续 PDF 阅读、文字选择、跨页区域框选、OCR、全文上下文问答，以及可自行配置的 OpenAI Chat Completions 兼容模型。

> 作者：**xyLee** · [项目仓库](https://github.com/lxymol/Reading-Assistant)

## 主要功能

- 连续 PDF 页面流，支持鼠标滚轮或触控板平滑滚动，以及 60%–300% 缩放。
- 同时打开多个文件；每个工作区分别保存页码、缩放、选区和多条 AI 对话。
- 文字选择模式支持复制、就近翻译和发送到 AI；区域选择模式支持跨页框选。
- 读取 PDF 原生文字；图片和扫描内容可使用中英文 Tesseract OCR。
- 对选区或全文执行翻译、解释、洞察、总结和自定义提问。
- 分别配置默认模型、公式与图表理解模型、深度思考模型。
- 不同文件和不同对话可并行请求 AI，不会相互阻塞。
- AI 回答支持 GitHub Flavored Markdown、代码块、表格和 KaTeX 数学公式。
- 日间 / 夜间模式同步作用于界面和文档，并保留上次选择。
- 内置中文和英文界面；AI 回答及翻译目标语言随应用语言切换。
- 大型 PDF 按需渲染当前页附近内容，降低内存占用。

## 安装

Windows 用户可以在 [GitHub Releases](https://github.com/lxymol/Reading-Assistant/releases) 下载最新安装程序。安装包不会修改系统环境变量，也不要求另行安装 Node.js。

当前版本：`0.2.0`。

## AI 配置

点击应用右上角的设置按钮，填写兼容接口地址、模型名称和 API Key。应用不预设服务商。

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

## 从源码运行

需要 Node.js 20 或更高版本。

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
npm run build
npm run desktop:pack
```

Windows NSIS 安装程序输出到 `release-0.2.0/`。发布产物已被 Git 忽略，请通过 GitHub Releases 上传安装包，不要把安装包直接提交到源码历史。

## 隐私与安全

- PDF 和图片由 PDF.js 与 Tesseract.js 在本机处理。
- 只有发起 AI 请求后，相关选区、必要的文档上下文、近期对话和最多 4 张视觉选区才会发送到用户配置的服务。
- API 配置保存在应用本机数据目录，不会写入仓库或安装包，但并非操作系统密钥库加密；请只在可信设备使用。
- `.env` 与本地构建产物已被 Git 忽略。提交前仍建议运行秘密扫描，并确认没有误加入 Key。

安全问题请参阅 [SECURITY.md](SECURITY.md)。

## 贡献

欢迎提交 Issue 和 Pull Request。开始开发前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

本项目采用 [MIT License](LICENSE)。
