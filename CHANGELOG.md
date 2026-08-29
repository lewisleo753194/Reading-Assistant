# Changelog

All notable changes to Reading Assistant are documented here.

## [Unreleased]

## [1.0.0] - 2026-08-29

### Added

- Added the final book-shaped application icon across the browser shell, desktop window, Windows taskbar, and installer.
- Added collapsible project conversations with matching expand and collapse indicators.

### Improved

- Split the activity bar, project explorer, preferences, and shared workspace types out of the main application component without changing the existing interface.
- Removed the unused legacy drop-zone implementation, obsolete exports, translations, and unreferenced stylesheet rules.
- Deferred OCR runtime loading until a document is opened, reducing unnecessary startup work.
- Completed lint, type, Electron entry-point, server entry-point, dependency-tree, and production-build validation for the stable release.

## [0.4.0] - 2026-08-29

### Fixed

- Rebuilt all project, selection, assistant, and notes surfaces on one persistent panel framework with simultaneous docked panels, draggable splitters, edge docking, movable/resizable floating windows, and proper document reflow.
- Removed the remaining file-memory controls from Settings while keeping automatic project restoration.
- Fixed pasted-image and ink note storage so the editor uses compact asset references and exported Markdown contains valid image data.
- Unified the light and dark accent color, restored sun/moon theme icons, simplified empty-state hints, and removed the duplicate project creation entry.
- Added live Markdown rendering, a slider-style reasoning control, compact reader toolbar inputs, and stronger dark-document contrast.
- Moved project deletion into Settings with an explicit data-loss warning and added per-project conversation/note shortcuts.
- Replaced sampled document context with full-page indexing: selection requests receive a whole-document miniature plus exact neighboring pages, while document requests receive exact full text and grounded clickable source tags.
- Persisted highlights as exact page-relative rectangles, moved text/area selection controls to the left of the reader toolbar, and rendered floating panels at the application root so workspace boundaries no longer clip them.

## [0.4.0-beta.1] - 2026-08-28

### Added

- VS Code-style activity bar for selections, projects, conversations, notes, new projects, settings, and themes.
- Persistent project files, per-project Markdown notes, pasted images, resizable ink canvases, and Markdown export.
- Persistent text highlights, source-page tags in conversations, message deletion, and stop-generation controls.
- Editable page and zoom fields plus dockable and floating side panels.

### Improved

- Projects and their files are restored automatically until explicitly deleted.
- Document text is extracted and indexed when a file opens; AI requests use a compact summary and relevant chunks instead of repeatedly sending the full text.
- Empty selections now fall back to document conversation, image requests try the selected default/reasoning model before the vision fallback, and single-word translations request American IPA.
- Selection state is cleared after each AI request, translation popovers can be moved, and dark-mode contrast is stronger.

## [0.3.0] - 2026-08-26

### Added

- Optional IndexedDB-backed file memory for conversations, page position, zoom, and reading state.
- Optional AI-maintained user memory with in-app viewing, editing, and deletion.
- A dedicated Memory settings tab with independent controls and file-memory management.

### Improved

- The AI prompt can be resized vertically.
- The AI prompt is resized from its top edge while the newest conversation content stays visible.
- The selection and conversation areas in the left sidebar have a draggable horizontal divider.
- The settings window is taller while retaining a stable size across tabs.
- New selections respect a collapsed selection sidebar.

### Fixed

- Only the divider currently being dragged is highlighted.

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
