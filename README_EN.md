# Raid

[中文](README.md) | [English](README_EN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-2.5.1-6b7cff)
![Platform](https://img.shields.io/badge/platform-Windows-0078d4)

Raid is an AI-assisted PDF and image reader for papers, textbooks, and technical documents. It combines continuous PDF reading, text selection, cross-page area capture, OCR, document-aware conversations, and user-configured OpenAI Chat Completions-compatible models.

> Maintained by **LewisLeo44** · [Repository](https://github.com/lewisleo753194/Reading-Assistant)

## Origin and acknowledgements

This project continues from **version 1.0.0** of [`Reading-Assistant`](https://github.com/lxymol/Reading-Assistant), created by **xyLee (GitHub: [`lxymol`](https://github.com/lxymol))**. Sincere thanks to the original author for the initial product design, PDF reading and selection interactions, OCR and AI Q&A workflow, Electron desktop foundation, and open-source release that made this continued work possible.

Compared with the original author's version 1.0.0, the current 2.5.1 release primarily adds or improves:

- Multi-source study projects with a separate source scope for each conversation.
- ChatGPT Plus / Codex sign-in, model selection, streamed answers, deeper reasoning, and optional web search.
- Contextual follow-ups that retain the real question, source scope, source names, page anchors, and attachments, and reuse recent questions when searching large documents.
- Conversation-only attachments, OpenAI Responses original-file indexing, and project file search.
- A fast path for large scanned PDFs using representative visual pages instead of blocking on full-document OCR, plus selection OCR and cancellation.
- Project notes, text and ink annotations, navigable source citations, user memory, and long-conversation compaction.
- Improved native floating panels and docking, concurrent requests, error isolation, and Windows build and release workflows.
- Application-drive `RaidData` partitions for persistent data, runtime files, and Chromium caches, including verified legacy migration and a bounded disk cache to reduce system-drive growth.
- Repairs for page navigation, forced scrolling during streamed answers, and scope isolation across free, document, selection, and project-source questions.

This fork preserves the original copyright notice required by the MIT License and adds the current maintainer notice.

## Features

- Continuous PDF scrolling with mouse wheels or trackpads and 60%–300% zoom.
- Multiple file workspaces with independent page position, zoom, selections, and conversations.
- Text selection with copy, inline translation, and Send to AI actions.
- Cross-page area selection for scanned text, formulas, charts, and figures.
- Native PDF text extraction plus Chinese and English Tesseract OCR.
- Translation, explanation, insight, summarization, and custom prompts for a selection or the document.
- Separate default, vision, and deep-thinking model configurations.
- Concurrent AI requests across files and conversations.
- GitHub Flavored Markdown, code blocks, tables, and KaTeX formula rendering.
- Persistent light and dark themes for both the interface and document pages.
- Built-in Chinese and English UI; the selected language also controls AI responses and translation targets.
- On-demand rendering around the current page to reduce memory use for large PDFs.
- The AI prompt resizes from its top edge while keeping the newest conversation content visible; the selection and conversation areas also have a draggable divider.
- Adding a selection no longer forces a collapsed selection sidebar open.
- Optional file memory restores conversations, page position, and reading state when the same file is reopened.
- Optional user memory learns stable background and response preferences and remains viewable, editable, and removable.

## Installation

Windows users can download the latest installer from [GitHub Releases](https://github.com/lewisleo753194/Reading-Assistant/releases). The installer does not modify system environment variables and does not require a separate Node.js installation.

Current version: `2.5.1`.

Starting with 2.3.0, Raid creates `RaidData/Data`, `RaidData/Runtime`, and `RaidData/Cache` on the application drive by default. On first launch it verifies migrated legacy data before cleaning the old location; runtime files are cleaned at startup and exit, and combined Chromium caches are cleared on the next launch after exceeding 128 MB. Set `RAID_DATA_ROOT` to choose another data-drive directory.

## AI configuration

Open Settings in the upper-right corner and choose one of two connection modes:

- **ChatGPT Plus / Codex**: install the `codex` CLI, click **Sign in** in Settings, finish the browser login, then load and select a model. No API key is required. This mode uses the current ChatGPT account through the local `codex app-server`.
- **API-compatible service**: keep using the original base URL, model name, and API key fields. The original default, vision, and deep-thinking model configurations remain available.

Codex mode replaces only the model call. PDF/image handling, OCR, document and selection context, Skills, memory, notes, annotations, and page citations continue through the existing Raid workflow. Each Codex request uses a temporary read-only thread that is discarded after the answer.

| Configuration | Purpose |
| --- | --- |
| Default model | Text processing, document Q&A, and translation |
| Formula and chart understanding | Receives area crops for formulas, charts, and figures |
| Deep-thinking model | Handles text reasoning when Deep thinking is enabled |

Advanced configurations inherit the default endpoint and key when those fields are left blank. Test connection validates the default model and every enabled advanced model. The endpoint should support:

- `GET /models`
- `POST /chat/completions`

When an image selection and Deep thinking are both active, the app asks the user to turn off Deep thinking instead of silently dropping the image and answering from document context.

## Skills and language packs

- In **Settings → Skill settings**, choose a folder whose root contains `SKILL.md`. The app imports the Skill instructions and readable text reference files in that folder.
- AI selects a Skill automatically from its `name` and `description`. Start a chat message with `/skill-command` to require a specific Skill.
- In **Settings → Language settings**, import a folder containing `language.json`. A pack must define `code`, `label`, `aiLanguage`, and `strings`.
- The selected language controls the UI, AI response language, and translation target language.

## Memory

- Enable or disable File memory and User memory independently under **Settings → Memory settings**.
- File memory uses local IndexedDB and stores only conversations and reading state, never the PDF or image itself. Records can be removed individually or all at once.
- User memory is stored locally. Its extraction uses the configured default AI model and personalizes explanation depth, wording, and formatting.
- The profile can be edited or cleared directly. When User memory is off, the profile is neither sent to AI nor updated automatically.

## Run from source

Node.js 20 or later is required.

ChatGPT Plus / Codex mode also requires `codex --version` to work from the command line. Set `CODEX_CLI_PATH` to the full CLI path when it is not on `PATH`.

```bash
npm install
npm run dev
```

The browser development server is available at <http://localhost:5173> by default. To start an isolated desktop test instance:

```bash
npm run desktop:test
```

## Build

```bash
npm run lint
npm run test:codex
npm run build
npm run desktop:pack
```

The Windows NSIS installer is written to `release-2.5.1/`. Release artifacts are ignored by Git and should be uploaded through GitHub Releases instead of committed to source history.

## Privacy and security

- PDF and image processing runs locally through PDF.js and Tesseract.js.
- A configured AI service receives data only after an AI action: relevant selections, required document context, recent conversation messages, and up to four visual crops when applicable.
- When User memory is enabled, the current request and assistant response are sent to the default model to update the profile; document source text is not used as profile-learning material.
- API settings are stored in the application's local data directory. They are not included in the repository or installer, but they are not protected by an operating-system credential vault. Use trusted devices only.
- ChatGPT credentials are managed by the Codex CLI; Raid neither reads nor stores access tokens. Material sent through Codex is processed under the ChatGPT/Codex service terms.
- `.env` files and local build outputs are ignored by Git. Run a secret scan before publishing and verify that no key was staged accidentally.

See [SECURITY.md](SECURITY.md) for vulnerability reporting guidance.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting development.

## License

This project is licensed under the [MIT License](LICENSE).

### 2.5.1 model connection fix

On Windows, Raid selects the newer working Codex CLI from PATH or the desktop app installation. An explicit `CODEX_CLI_PATH` takes precedence. Codex model choices are loaded from the actual service, including GPT-6/6.1 when returned for your account. Fully quit and restart Raid after updating.
