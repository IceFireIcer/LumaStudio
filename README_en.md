# Luma Studio

> **[中文](README.md)**

A self-hosted photo viewer and **Lightroom-style image editor**. Upload once, keep forever — your photos are stored as real files on disk, not in browser storage.

Luma Studio turns your machine into a private photo workshop. Browse your library in an elegant white-themed gallery, then jump into a full editor to adjust, transform, crop, resize, recompress, and rewrite EXIF metadata — all processed server-side with [sharp](https://sharp.pixelplumbing.com/) (libvips).

---

## Features

### Multi-open, Security & Reliability (v1.2.1)
- **Multi-open support**: when another instance is detected, a native dialog asks you to "Close new instance" or "Open a second window" (auto-selects a free port, shares the same data directory — suited for read-only browsing)
- **Per-file write locks**: when multiple instances share the data directory, writes to `db.json` / `drafts.json` / `settings.json` / job state are guarded by file locks; a write while another instance holds the lock returns a conflict message; stale locks are taken over automatically
- **Local access token**: a random token is generated on first run; write requests must carry `X-Luma-Token` (protects against other local processes / malicious pages); the Settings page can view / copy / regenerate it
- **Batch job persistence**: job state is written to `jobs.json` and restored after restart; interrupted jobs keep their progress (no auto-resume)
- **Performance**: batch processing uses 2-way limited concurrency; the logs page refresh interval is configurable (3 / 10 / 30 s)
- **Better errors**: EXIF writes to broken / animated WebP return a friendly message; startup failures show a native error dialog instead of silently quitting

### Design System & Global Components (v1.2)
- **Dark mode**: manual light / dark toggle sharing the same accent color, with neutral colors adapted automatically
- **Unified design tokens**: colors, spacing, radius, shadows, typography and motion are tokenized; custom scrollbars and keyboard focus styles
- **Global interaction upgrades**: custom confirm modal (replaces native `confirm`), toast action buttons, directional page transitions, drag-and-drop upload anywhere in the window
- **Reduced-motion tri-state**: follow system / force on (all animations zeroed) / force off

### Gallery
- Drag-and-drop or click to upload (JPG / PNG / WebP / AVIF / GIF / TIFF / BMP)
- Server-side WebP thumbnails with animated masonry grid
- Hover actions: edit, info, download, delete
- Fullscreen lightbox with keyboard navigation (`←` `→` `Esc`)
- **Lightbox upgrades (v1.2)**: `3 / 25` counter pill, bottom filmstrip, EXIF summary bar, wheel zoom/pan (1×–5×), directional navigation animation
- **Grid upgrades (v1.2)**: Flip transitions, hover quick rating, batch-bar thumbnails
- Photos persist as real files on disk — no data loss on restart

### Editor (Lightroom-style)
- **Presets**: Original, Vivid, Soft, Vintage, Mono, High-contrast
- **Adjustments**: brightness, contrast, saturation, hue, sharpen, blur, grayscale — live CSS preview
- **New parameters (v1.2)**: temperature, tint, vignette, grain; double-click slider reset, modification dots, Undo/Redo buttons
- **Draft persistence (v1.2)**: edits auto-save as a single snapshot draft, restored on reopen, cleared after a successful export
- **Canvas zoom/pan (v1.2)**: wheel zoom (0.25×–4×), drag pan, arrow-key crop nudging and rule-of-thirds grid
- **Undo / Redo**: `Ctrl+Z` / `Ctrl+Y` (state-stack based)
- **Transform**: rotate 90°, flip H/V, interactive crop with ratio chips (Free / 1:1 / 4:3 / 16:9 / 3:4)
- **Resize**: exact pixel dimensions (aspect-locked) or quick 25 / 50 / 75 / 100 %
- **Export**: JPEG / PNG / WebP / AVIF, quality slider, live size estimate
- **Save as copy** or **overwrite original**
- **Download to local** without saving to server
- **Before / After**: split-screen comparison of the original vs. the edited result with a draggable divider
- **Before/After upgrades (v1.2)**: drag anywhere to move the divider, left-right / top-bottom split toggle

### Metadata (EXIF)
- View camera, lens, aperture, shutter, ISO, focal length, GPS, and more
- **Grouped display (v1.2)**: Camera / Capture / Time / File / GPS sections; one-click value copy, Amap and Google Maps links for GPS
- Edit Artist / Copyright / Description / Date (JPEG / PNG / WebP) — full **UTF-8 / CJK support**, lossless writes
- One-click **strip all metadata** for privacy

### Photo Culling
- 1–5 star rating (click or keyboard `1`–`5`, `0` to clear)
- Pick / Reject flags (`P` / `R` keys)
- **Fast culling**: `X` rejects and advances, `U` clears the flag; auto-advance after rating/flags in lightbox & compare (toggle in Settings)
- **Side-by-side compare** (`C` in lightbox): compare two photos, `Tab` switches the marking target, `←`/`→` moves to the next pair
- **Hide rejects**: toolbar button or `H` key hides rejected photos instantly
- Batch operations: rate, flag, add to album, download ZIP, delete

### Batch Processing
- Apply a preset (Original / Vivid / Soft / Vintage / Mono / High-contrast) to all selected photos at once
- Optional percentage resize, output format (keep original / JPEG / PNG / WebP / AVIF) and quality
- Background queue with live progress, per-photo error isolation, and cancel support
- Save as copies or overwrite originals

### Albums
- Create, rename, delete collections
- Add / remove photos
- Browse album contents
- **Cover & batch (v1.2)**: first-photo card covers, full batch bar in album detail, drag photos into the sidebar album

### Tags (v1.3)
- Multiple free-form tags per photo (any text, Chinese supported) — a second organization dimension alongside albums
- Edit tags in the info panel: chips display, add by input, remove by click
- Toolbar tag filter dropdown + batch tag add
- Tag cloud with counts (`/api/tags`); tags disappear automatically when a photo is deleted

### Search, Filter & Sort
- Search by filename
- Filter by stars, pick/reject flag, image format, or tag
- Sort by name, date, size, or stars

### Slideshow
- Auto-play (3 s interval), spacebar to pause/resume, arrow keys to navigate
- **v1.2 upgrades**: Ken Burns pan, configurable interval (3 / 5 / 10 s), top progress bar, `3 / 25` counter

### Settings & About
- Default export format & quality, thumbnail size, theme accent color
- **Appearance card (v1.2)**: dark-mode switch, reduced-motion tri-state, shortcut cheatsheet entry, open-data-directory button
- **System card (v1.2.1)**: logs page refresh interval (3 / 10 / 30 s); access-token view / copy / regenerate in the storage card
- **Log upgrades (v1.2)**: search, pause live refresh, row expand & copy
- Runtime info: Node version, sharp/libvips version, photo count, storage used, uptime

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1`–`5` | Rate 1–5 stars |
| `0` | Clear rating |
| `P` | Mark pick |
| `R` | Mark reject |
| `X` | Mark reject and advance to the next photo |
| `U` | Clear flag |
| `C` / `Tab` | Side-by-side compare in lightbox / switch marking target |
| `H` | Hide rejected photos |
| `?` | Open / close the shortcut cheatsheet |
| `←` `→` (lightbox zoomed) | Pan the zoomed image |
| `Esc` / double-click (lightbox zoomed) | Reset zoom |
| `←` `→` `↑` `↓` (editor crop) | Nudge crop box 1 px (`Shift` = 10 px) |
| `[` `]` (editor crop) | Resize crop box 1 px (`Shift` = 10 px) |
| `←` `→` | Navigate in lightbox / slideshow |
| `Ctrl+Z` | Undo (editor) |
| `Ctrl+Y` | Redo (editor) |
| `Space` | Pause / resume slideshow |
| `Esc` | Close lightbox / slideshow |

---

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) **18+**

### Electron Desktop

```
git clone https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
npm install
npm run electron
```

> **Note**: Luma Studio is now a desktop-only app; all source code lives on the single `main` branch.

---

## Project Structure

```
.
├── server-app.cjs          # Express backend + sharp pipeline + REST API (single source of truth)
├── electron-main.cjs       # Electron main process (data dir / migration / multi-open / OOBE / server & window)
├── electron-launch.cjs     # Electron launcher
├── preload.cjs             # contextBridge preload (openDataDir / getToken)
├── public/
│   ├── index.html          # SPA shell
│   ├── style.css           # Design system (tokenized, dark mode)
│   ├── app.js              # Front-end logic
│   ├── ui-anim.js          # GSAP animation layer (window.UIAnim)
│   └── vendor/gsap/        # Local GSAP (incl. FlipPlugin)
├── scripts/ui-smoke.cjs    # UI smoke test (real Electron)
├── test/server.test.cjs    # Regression tests (node:test, 51 tests)
├── docs/                   # Design spec (ui-redesign.md)
├── build/installer/        # Inno Setup installer scripts
├── storage/                # Runtime data (userData)
└── package.json
```

---

## Data Storage

Luma Studio uses **plain JSON files** for all data — no database server required:

- `storage/data/db.json` — Photos metadata and album collections
- `storage/data/settings.json` — User preferences and runtime settings
- `storage/data/drafts.json` — Edit drafts (v1.2)
- `storage/data/jobs.json` — Batch job state (v1.2.1)

All photos are stored as real files in `storage/uploads/`, thumbnails in `storage/thumbs/`. Delete the `storage/` folder to reset everything.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | [Express](https://expressjs.com/) |
| Image processing | [sharp](https://sharp.pixelplumbing.com/) (libvips) |
| EXIF read | [exifr](https://github.com/MikeKovarik/exifr) |
| EXIF write | [piexifjs](https://github.com/hMatoba/piexifjs) |
| Uploads | [multer](https://github.com/expressjs/multer) |
| ZIP | [yazl](https://github.com/thejoshwolfe/yazl) |
| ID generation | [nanoid](https://github.com/ai/nanoid) |
| Desktop | [Electron](https://www.electronjs.org/) |
| Front-end | Vanilla JavaScript / HTML / CSS (zero framework, zero build step) |
| Data storage | JSON files (`db.json`, `settings.json`, `drafts.json`, `jobs.json`) — no database required |

---

## API Reference

### Photos & Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/photos` | List all photos |
| `GET` | `/api/photos/:id` | Get photo metadata |
| `POST` | `/api/upload` | Upload images |
| `DELETE` | `/api/photos/:id` | Delete one photo |
| `DELETE` | `/api/photos` | Delete all photos |
| `GET` | `/api/photos/:id/exif` | Read EXIF |
| `POST` | `/api/photos/:id/exif` | Write EXIF (JPEG / PNG / WebP) |
| `POST` | `/api/photos/:id/strip-exif` | Strip all metadata |
| `POST` | `/api/photos/:id/process` | Apply edits & save |
| `POST` | `/api/photos/:id/render` | Apply edits & return bytes |
| `POST` | `/api/photos/:id/preview` | Estimate output size |
| `POST` | `/api/photos/:id/rename` | Rename photo |
| `POST` | `/api/photos/:id/stars` | Set stars (0–5) |
| `POST` | `/api/photos/:id/flag` | Set flag (`pick` / `reject` / `null`) |
| `POST` | `/api/photos/:id/tags` | Replace tags `{ tags: string[] | string }` |
| `GET` | `/api/tags` | Tag cloud (name + usage count) |
| `POST` | `/api/photos/batch/tags` | Batch tags `{ ids, tags, mode: set|add|remove }` |
| `PUT` | `/api/photos/:id/draft` | Save the edit draft |
| `GET` | `/api/photos/:id/draft` | Read the edit draft (404 when none) |
| `DELETE` | `/api/photos/:id/draft` | Clear the edit draft |
| `GET` | `/files/:file` | Serve original (`?download=1` to force download) |
| `GET` | `/thumbs/:id.webp` | Serve thumbnail |

### Batch & Background Jobs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/photos/batch/stars` | Batch stars `{ ids, stars }` |
| `POST` | `/api/photos/batch/flag` | Batch flag `{ ids, flag }` |
| `POST` | `/api/photos/batch/delete` | Batch delete `{ ids }` |
| `POST` | `/api/photos/batch/process` | Batch process `{ ids, pipeline, mode }` → `{ jobId }` |
| `GET` | `/api/jobs/:id` | Query background job progress |
| `POST` | `/api/jobs/:id/cancel` | Cancel a background job |
| `POST` | `/api/photos/download-zip` | Download as ZIP `{ ids }` |

### Search / Settings / System / Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/search` | Search / filter (`q`, `sort`, `stars`, `flag`, `format`, `tag`, `album`, `hideReject`) |
| `GET` | `/api/settings` | Get settings |
| `POST` | `/api/settings` | Update settings |
| `GET` | `/api/stats` | Storage statistics (incl. `dataDir`) |
| `GET` | `/api/info` | System info |
| `GET` | `/api/logs` | Read logs (`level` / `source` / `limit` filters) |
| `POST` | `/api/logs/clear` | Clear logs (incl. rotated backups) |
| `GET` | `/api/logs/info` | Log file path info |
| `POST` | `/api/logs/frontend` | Report frontend log |

### Albums / Auth / OOBE

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/albums` | List albums (each with first-photo `cover`) |
| `POST` | `/api/albums` | Create album `{ name }` |
| `DELETE` | `/api/albums/:id` | Delete album |
| `POST` | `/api/albums/:id/rename` | Rename album |
| `POST` | `/api/albums/:id/add` | Add photos `{ ids }` |
| `POST` | `/api/albums/:id/remove` | Remove photos `{ ids }` |
| `POST` | `/api/auth/reset-token` | Reset the local access token (old token required) |
| `GET` | `/api/oobe/status` | Read OOBE completion status (desktop registry) |
| `POST` | `/api/oobe/complete` | Mark OOBE complete |
| `POST` | `/api/oobe/reset` | Reset OOBE onboarding |

### Process / Render body

```jsonc
{
  "adjust":    { "brightness": 1.1, "contrast": 1.2, "saturation": 1.4,
                 "hue": 0, "sharpen": 2, "blur": 0, "grayscale": false,
                 "temperature": 0, "tint": 0, "vignette": 0, "grain": 0 },
  "transform": { "rotate": 90, "flipH": false, "flipV": false,
                 "crop": { "left": 100, "top": 50, "width": 400, "height": 300 } },
  "resize":    { "width": 1280, "height": 720 },
  "output":    { "format": "webp", "quality": 80 },
  "mode":      "copy"   // or "overwrite"
}
```

---

## Notes

- **EXIF writing** supports JPEG / PNG / WebP: JPEG via the APP1 segment, PNG / WebP via lossless chunk-level writes. UTF-8 / CJK text is preserved.
- On **Windows**, sharp cache is disabled (`sharp.cache(false)`) to avoid file-handle locks; other platforms use the default cache.
- **Security**: the desktop build validates a local access token (`X-Luma-Token`, viewable/regenerable in Settings) for write requests. Still designed for local / personal use — don't expose to the public internet without a reverse proxy.
- **Multi-open**: a second instance shares the same data directory and is suited for read-only browsing; concurrent edits from two instances should still be avoided (write locks only guard momentary write conflicts).
- **Chinese EXIF**: Write uses `Buffer.from(text,'utf8').toString('latin1')`; read decodes latin1→UTF-8. This preserves multi-byte characters that piexifjs would otherwise lose.

---

## Roadmap & Contributing

See [ROADMAP.md](ROADMAP.md) for the current status, known issues, and planned features.

---

## License

[Apache License 2.0](LICENSE) © 2026 [IceFire_Icer](https://github.com/IceFireIcer)
