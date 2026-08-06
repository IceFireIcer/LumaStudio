# Repository Guidelines

Luma Studio is a self-hosted photo viewer and Lightroom-style image editor packaged as an Electron desktop app. The backend is Node.js + Express with `sharp` (libvips); the frontend is vanilla HTML/CSS/JS.

## Project Structure & Branch Organization

The repository has a single branch, `main` (the former `electron` branch, renamed; the standalone web version and release-artifact branches were removed). All development happens here.

Source layout (repository root):

- `server-app.cjs` — shared Express app + image pipeline (single source of truth)
- `electron-main.cjs` — Electron main process (window, single-instance lock, data dir)
- `electron-launch.cjs` — launcher that spawns Electron
- `public/` — frontend: `index.html`, `style.css`, `app.js`
- `test/` — node:test regression suite
- `CHANGELOG.md` — release notes

Photo files, thumbnails, and metadata live in the Electron `userData` directory at runtime (not in the repository).

## Build, Test, and Development Commands

Requires Node.js >= 18. Run from the repository root:

- `npm install` — install dependencies
- `npm start` / `npm run dev` / `npm run electron` — launch the desktop app
- `npm test` — run the regression suite
- `npm run build:win|mac|linux` — package installers into `release/`

## Coding Style & Naming Conventions

- 2-space indentation, single quotes, semicolons; no linter is configured, so match the existing style
- CommonJS (`require`) in `server-app.cjs` and Electron main files; plain browser JS in `public/`
- camelCase for functions and variables; lowercase for files and directories
- Source comments are written in Chinese; keep README language variants in sync
- Never commit runtime photo data — respect `.gitignore`

## Testing Guidelines

Regression tests live in `test/` and use the built-in `node:test` runner — run `npm test`. When fixing a bug, add a test that reproduces it first (existing coverage: rotation/crop coordinates, lossless EXIF stripping, request logging, settings validation, CSRF, upload sanitization, DB corruption recovery).

## Commit & Pull Request Guidelines

Commit messages use Conventional Commits prefixes with Chinese descriptions:

- `feat:` new feature · `fix:` bug fix · `docs:` documentation · `chore:` maintenance · `release:` version bump

Examples from history: `feat: 实现完整日志系统和输入模态框`, `release: 更新版本号到v1.0.3并添加更新日志`.

Pull requests should:

- Target `main`; describe the change and link related issues
- Update `CHANGELOG.md` (中文 + English) and bump `package.json` version for releases
- Include screenshots for UI changes
