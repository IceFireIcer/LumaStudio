# Repository Guidelines

Luma Studio is a self-hosted photo viewer and Lightroom-style image editor packaged as an Electron desktop app. The backend is Node.js + Express with `sharp` (libvips); the frontend is vanilla HTML/CSS/JS.

## Project Structure & Branch Organization

The repository has a single branch, `main` (the former `electron` branch, renamed; the standalone web version and release-artifact branches were removed). All development happens here.

> Worktree note: `main/` is a git worktree. The parent repo at `D:\Code\CherryStudio\LumaStudio` only mounts this worktree and has an empty `master` default branch — do not commit work there; everything lives on `main` in `main/`.

Source layout (repository root):

- `server-app.cjs` — shared Express app + image pipeline (single source of truth)
- `electron-main.cjs` — Electron main process (window, single-instance lock / multi-open dialog, data dir migration, OOBE registry, IPC)
- `preload.cjs` — contextBridge preload (`window.luma.openDataDir()` / `getToken()`)
- `electron-launch.cjs` — launcher that spawns Electron
- `public/` — frontend: `index.html`, `style.css`, `app.js`, `ui-anim.js` (GSAP layer), `vendor/gsap/` (with `FlipPlugin.min.js`)
- `scripts/ui-smoke.cjs` — Electron UI smoke test (23 scenario markers + `CONSOLE-ERRORS` assertion, 3 failure markers)
- `test/` — node:test regression suite (`test/server.test.cjs`, 44 tests)
- `docs/ui-redesign.md` — v1.2 UI/UX redesign spec (the fact source for that batch)
- `build/installer/` — Inno Setup installer scripts (source files, do not delete)
- `storage/` — writable runtime data root (kept via `.gitkeep`; contents never committed)
- `CLAUDE.md` / `AGENTS.md` / `handover.md` / `README.md` / `README_en.md` / `CHANGELOG.md` / `ROADMAP.md` — docs

Photo files, thumbnails, and metadata live in the Electron `userData` directory at runtime (not in the repository).

## Build, Test, and Development Commands

Requires Node.js >= 18. Run from the repository root:

- `npm install` — install dependencies
- `npm start` / `npm run dev` / `npm run electron` — launch the desktop app
- `npm test` — run the node:test regression suite (44 tests)
- `npx electron scripts/ui-smoke.cjs` — UI smoke test (clear `ELECTRON_RUN_AS_NODE` env first if set)
- `npm run build:win|mac|linux` — package installers into `release/`

## Coding Style & Naming Conventions

- 2-space indentation, single quotes, semicolons; no linter is configured, so match the existing style
- CommonJS (`require`) in `server-app.cjs` and Electron main files; plain browser JS in `public/`
- camelCase for functions and variables; lowercase for files and directories
- Source comments are written in Chinese; keep README.md (中文) and README_en.md in sync
- Never commit runtime photo data — respect `.gitignore`

## Testing Guidelines

Regression tests live in `test/` and use the built-in `node:test` runner — run `npm test`. When fixing a bug, add a test that reproduces it first. Existing coverage: rotation/crop coordinates, lossless EXIF stripping, request logging, settings validation, CSRF, upload sanitization, DB corruption recovery, PNG/WebP EXIF round-trip, Chinese filenames/EXIF, batch routes, drafts, EXIF orientation, local access token (401/reset/default-off), file write locks (409/stale takeover), batch job persistence (restore/interrupted), WebP 400 friendly message, `logsRefreshInterval` validation.

UI smoke (`scripts/ui-smoke.cjs`, real Electron) must be extended for new front-end interactions. It asserts `CONSOLE-ERRORS []` plus the per-scenario markers: `UI-STATE`, `ANIM`, `MODAL`, `KEYDOWN`, `LAYOUT`, `NAV-EXIF`, `BA-COMPARE`, `LB-COMPARE`, `BATCH-UI`, `BATCH-DONE`, `BATCH-AFTER`, `TOGGLE-H`, `DARK-MODE`, `SHORTCUTS`, `CONFIRM`, `LB-ZOOM`, `UPLOAD-OVERLAY`, `DROP-ONCE`, `FLIP-GRID`, `ALBUM-BATCH`, `DRAFT`, `MASONRY`, `WEBP400`. Hard constraints: window must be `show: true`; server must use a fixed port (CSRF allowlist is built from the port); OOBE routes must be stubbed (they only exist in `electron-main.cjs`); clear `ELECTRON_RUN_AS_NODE` before running.

## Current Gaps (see ROADMAP.md / handover.md)

Not yet implemented: edit version chains (non-destructive), timeline/calendar browsing, tags, recycle bin + full-library backup, more EXIF field editing (GPS etc.), portable↔installed data migration tool.

Open bugs worth fixing (data-safety priority): interrupted batch jobs don't auto-resume (state is persisted to `jobs.json` but running jobs are only marked interrupted); batch overwrite results aren't rolled back; multi-open concurrent edits to the same photo aren't strongly isolated; portable OOBE still writes the registry; no public-network auth (local token only).

## Commit & Pull Request Guidelines

Commit messages use Conventional Commits prefixes with Chinese descriptions:

- `feat:` new feature · `fix:` bug fix · `docs:` documentation · `chore:` maintenance · `release:` version bump

Examples from history: `feat: 实现完整日志系统和输入模态框`, `release: 发布 v1.2.0（UI/UX 改版：深色模式/设计系统/全局组件/灯箱编辑器增强）`.

Pull requests should:

- Target `main`; describe the change and link related issues
- Update `CHANGELOG.md` (中文 + English) and bump `package.json` version for releases
- Include screenshots for UI changes
