# Luma Studio

> **[中文](README_zh.md) | [日本語](README_ja.md) | [한국어](README_ko.md) | [Français](README_fr.md) | [Español](README_es.md) | [Deutsch](README_de.md)**

A self-hosted photo viewer and **Lightroom-style image editor**. Upload once, keep forever — your photos are stored as real files on disk, not in browser storage.

Luma Studio turns your machine into a private photo workshop. Browse your library in an elegant white-themed gallery, then jump into a full editor to adjust, transform, crop, resize, recompress, and rewrite EXIF metadata — all processed server-side with [sharp](https://sharp.pixelplumbing.com/) (libvips).

---

## Features

### Gallery
- Drag-and-drop or click to upload (JPG / PNG / WebP / AVIF / GIF / TIFF / BMP)
- Server-side WebP thumbnails with animated masonry grid
- Hover actions: edit, info, download, delete
- Fullscreen lightbox with keyboard navigation (`←` `→` `Esc`)
- Photos persist as real files on disk — no data loss on restart

### Editor (Lightroom-style)
- **Presets**: Original, Vivid, Soft, Vintage, Mono, High-contrast
- **Adjustments**: brightness, contrast, saturation, hue, sharpen, blur, grayscale — live CSS preview
- **Undo / Redo**: `Ctrl+Z` / `Ctrl+Y` (state-stack based)
- **Transform**: rotate 90°, flip H/V, interactive crop with ratio chips (Free / 1:1 / 4:3 / 16:9 / 3:4)
- **Resize**: exact pixel dimensions (aspect-locked) or quick 25 / 50 / 75 / 100 %
- **Export**: JPEG / PNG / WebP / AVIF, quality slider, live size estimate
- **Save as copy** or **overwrite original**
- **Download to local** without saving to server

### Metadata (EXIF)
- View camera, lens, aperture, shutter, ISO, focal length, GPS, and more
- Edit Artist / Copyright / Description / Date (JPEG only) — full **UTF-8 / CJK support**
- One-click **strip all metadata** for privacy

### Photo Culling
- 1–5 star rating (click or keyboard `1`–`5`, `0` to clear)
- Pick / Reject flags (`P` / `R` keys)
- Batch operations: rate, flag, add to album, download ZIP, delete

### Albums
- Create, rename, delete collections
- Add / remove photos
- Browse album contents

### Search, Filter & Sort
- Search by filename
- Filter by stars, pick/reject flag, image format
- Sort by name, date, size, or stars

### Slideshow
- Auto-play (3 s interval), spacebar to pause/resume, arrow keys to navigate

### Settings & About
- Default export format & quality, thumbnail size, theme accent color
- Runtime info: Node version, sharp/libvips version, photo count, storage used, uptime

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1`–`5` | Rate 1–5 stars |
| `0` | Clear rating |
| `P` | Mark pick |
| `R` | Mark reject |
| `←` `→` | Navigate in lightbox / slideshow |
| `Ctrl+Z` | Undo (editor) |
| `Ctrl+Y` | Redo (editor) |
| `Space` | Pause / resume slideshow |
| `Esc` | Close lightbox / slideshow |

---

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) **18+**

### Source (development)

```bash
git clone https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
npm install
npm start
# Open http://localhost:7443
```

Custom port:

```bash
PORT=8080 npm start
```

### Windows installer (bat)

```
git clone -b windows-releases https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
install.bat          # installs to %LOCALAPPDATA%\LumaStudio + desktop shortcut
```

Double-click the desktop shortcut to launch. The script auto-detects and installs Node.js if missing (via winget or Chocolatey).

### Electron Desktop

```
git clone -b electron https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
npm install
npm run electron
```

> **Note**: The Electron version can now launch and build successfully. Source code is on the `electron` branch, and Windows build artifacts are on the `electron-releases` branch.

---

## Project Structure

```
LumaStudio/
├── server.js              # Express backend + sharp pipeline + REST API
├── electron-main.cjs      # Electron entry point (CJS)
├── package.json
├── public/
│   ├── index.html         # SPA shell
│   ├── style.css          # Design system
│   └── app.js             # Front-end logic
└── storage/               # Created at runtime
    ├── uploads/            # Original & processed images
    ├── thumbs/             # Generated WebP thumbnails
    └── data/               # db.json + settings.json
```

---

## Data Storage

Luma Studio uses **plain JSON files** for all data — no database server required:

- `storage/data/db.json` — Photos metadata and album collections
- `storage/data/settings.json` — User preferences and runtime settings

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
| Data storage | JSON files (`db.json`, `settings.json`) — no database required |

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/photos` | List all photos |
| `GET` | `/api/photos/:id` | Get photo metadata |
| `POST` | `/api/upload` | Upload images |
| `DELETE` | `/api/photos/:id` | Delete one photo |
| `DELETE` | `/api/photos` | Delete all photos |
| `GET` | `/api/photos/:id/exif` | Read EXIF |
| `POST` | `/api/photos/:id/exif` | Write EXIF (JPEG) |
| `POST` | `/api/photos/:id/strip-exif` | Strip all metadata |
| `POST` | `/api/photos/:id/process` | Apply edits & save |
| `POST` | `/api/photos/:id/render` | Apply edits & return bytes |
| `POST` | `/api/photos/:id/preview` | Estimate output size |
| `POST` | `/api/photos/:id/rename` | Rename photo |
| `GET` | `/api/settings` | Get settings |
| `POST` | `/api/settings` | Update settings |
| `GET` | `/api/stats` | Storage statistics |
| `GET` | `/api/search` | Search / filter (`q`, `sort`, `stars`, `flag`, `format`, `album`) |
| `GET` | `/api/info` | System info |
| `POST` | `/api/photos/:id/stars` | Set stars (0–5) |
| `POST` | `/api/photos/:id/flag` | Set flag (`pick` / `reject` / `null`) |
| `POST` | `/api/photos/batch/stars` | Batch stars `{ ids, stars }` |
| `POST` | `/api/photos/batch/flag` | Batch flag `{ ids, flag }` |
| `POST` | `/api/photos/batch/delete` | Batch delete `{ ids }` |
| `POST` | `/api/photos/download-zip` | Download as ZIP `{ ids }` |
| `GET` | `/api/albums` | List albums |
| `POST` | `/api/albums` | Create album `{ name }` |
| `DELETE` | `/api/albums/:id` | Delete album |
| `POST` | `/api/albums/:id/rename` | Rename album |
| `POST` | `/api/albums/:id/add` | Add photos `{ ids }` |
| `POST` | `/api/albums/:id/remove` | Remove photos `{ ids }` |
| `GET` | `/files/:file` | Serve original (`?download=1` to force download) |
| `GET` | `/thumbs/:id.webp` | Serve thumbnail |

### Process / Render body

```jsonc
{
  "adjust":    { "brightness": 1.1, "contrast": 1.2, "saturation": 1.4,
                 "hue": 0, "sharpen": 2, "blur": 0, "grayscale": false },
  "transform": { "rotate": 90, "flipH": false, "flipV": false,
                 "crop": { "left": 100, "top": 50, "width": 400, "height": 300 } },
  "resize":    { "width": 1280, "height": 720 },
  "output":    { "format": "webp", "quality": 80 },
  "mode":      "copy"   // or "overwrite"
}
```

---

## Notes

- **EXIF writing** is JPEG-only (EXIF standard limitation). UTF-8 / CJK text is preserved.
- On **Windows**, sharp cache is disabled (`sharp.cache(false)`) to avoid file-handle locks.
- **No authentication** — designed for local / personal use. Don't expose to the public internet without a reverse proxy.
- **Chinese EXIF**: Write uses `Buffer.from(text,'utf8').toString('latin1')`; read decodes latin1→UTF-8. This preserves multi-byte characters that piexifjs would otherwise lose.

---

## Roadmap & Contributing

See [ROADMAP.md](ROADMAP.md) for the current status, known issues, and planned features.

---

## License

[Apache License 2.0](LICENSE) © 2026 [IceFire_Icer](https://github.com/IceFireIcer)
