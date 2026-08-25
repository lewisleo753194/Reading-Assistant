# Changelog

All notable changes to Reading Assistant are documented here.

## [Unreleased]

### Added

- Optional IndexedDB-backed file memory for conversations, page position, zoom, and reading state.
- Optional AI-maintained user memory with in-app viewing, editing, and deletion.
- A dedicated Memory settings tab with independent controls and file-memory management.

### Improved

- The AI prompt can be resized vertically.
- The settings window is taller while retaining a stable size across tabs.
- New selections respect a collapsed selection sidebar.

## [0.2.0] - 2026-08-24

### Added

- Unified Model, Skill, and Language settings tabs.
- Importable Skills from folders containing `SKILL.md`.
- Automatic Skill routing and explicit `/skill-command` selection.
- Importable language packs from folders containing `language.json`.
- Desktop folder selection through a secure Electron preload bridge.

### Improved

- Stable settings window size across all tabs.
- Language selection now controls the interface, AI responses, and translation targets.
- Skill instructions are injected only after a Skill is selected.

### Fixed

- Image selections are no longer silently discarded when using a text-only deep-thinking model.
- Desktop folder import now works correctly in Electron sandbox mode.

## [0.1.0] - 2026-08-24

### Added

- Windows desktop application and NSIS installer.
- Multi-file workspaces and independent conversation archives.
- Concurrent AI requests across files and conversations.
- Separate default, vision, and deep-thinking model configurations.
- Cross-page area selection, native text selection, and removable visual crops.
- GitHub Flavored Markdown and KaTeX rendering for AI responses.
- Chinese and English interface modes.
- Importable Skills with automatic routing and explicit `/skill` commands.
- Importable language packs for the interface, AI responses, and translation targets.

### Improved

- Continuous PDF scrolling and per-workspace page restoration.
- On-demand rendering and sampled context extraction for large PDFs.
- Persistent light and dark themes with a lower-glare document treatment.
- Explicit validation that prevents image selections from being silently dropped by text-only deep-thinking models.
