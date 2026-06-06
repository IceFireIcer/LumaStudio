# 📷 Luma Studio

> A beautiful, self-hosted photo viewer and **Lightroom-style image editor** with a Node.js backend. Upload once, keep forever — your photos are stored as real files on disk, not in browser storage.

Luma Studio (光影工作室) is a single-server web app that turns your machine into a private photo workshop. Browse your library in an elegant white-themed gallery, then jump into a full editor to adjust, transform, crop, resize, recompress, and rewrite EXIF metadata — all processed server-side with [sharp](https://sharp.pixelplumbing.com/) (libvips).

---

## ✨ Features

### 🖼️ Gallery
- Drag-and-drop or click to upload (JPG / PNG / WebP / AVIF / GIF / TIFF / BMP)
- Server-side thumbnails for fast grid loading
- Animated masonry-style grid with hover actions (edit / info / download / delete)
- Fullscreen lightbox with keyboard navigation (`←` `→` `Esc`)
- Photos persist as real files on disk and survive restarts

### 🎨 Editor (Lightroom-style)
- **One-tap presets**: Original, Vivid, Soft, Vintage, Mono, High-contrast
- **Adjustments**: brightness, contrast, saturation, hue, sharpen, blur, grayscale — with live CSS preview
- **Transform**: rotate 90°, flip horizontal/vertical, interactive crop with aspect-ratio chips (Free / 1:1 / 4:3 / 16:9 / 3:4)
- **Resize**: exact pixel dimensions (with aspect lock) or quick 25/50/75/100% scaling
- **Export & compress**: choose JPEG / PNG / WebP / AVIF, quality slider, live output-size estimate
- **Save as copy** (keeps original) or **overwrite original**
- **Download to local** — render the edited result and save it to your computer

### ℹ️ Metadata (EXIF)
- View camera, lens, aperture, shutter, ISO, focal length, GPS, and more
- Edit Artist / Copyright / Description / Date (JPEG) — with full **UTF-8 / Chinese support**
- One-click **strip all metadata** for privacy

### ⚙️ Settings
- Default export format & quality
- Thumbnail size
- Theme accent color (with presets)
- Storage statistics & clear-all

### ℹ️ About
- Version, author (IceFire_Icer), tech stack
- Live runtime info: Node version, sharp/libvips version, photo count, storage used, server uptime

### ⭐ Photo Culling (选片)
- 1–5 star rating (click or keyboard `1`–`5`, `0` to clear)
- Pick/Reject flags (`P` key = pick, `R` key = reject)
- Multi-select with checkbox, batch operations: rate, flag, add to album, download ZIP, delete

### 📁 Albums / Collections (收藏夹)
- Create, rename, delete albums
- Add/remove photos from albums
- Browse album contents

### 🔍 Search, Filter & Sort
- Search by filename
- Filter by stars, pick/reject flag, image format
- Sort by name, date, size, or stars

### 🎬 Slideshow (幻灯片)
- Auto-play through photos (3s interval)
- Spacebar to pause/resume, arrow keys to navigate

### ⌨️ Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `1`–`5` | Rate current photo 1–5 stars |
| `0` | Clear rating |
| `P` | Mark as pick |
| `R` | Mark as reject |
| `←` `→` | Navigate in lightbox / slideshow |
| `Space` | Pause / resume slideshow |
| `Esc` | Close lightbox / slideshow |

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) **18 or newer**

### Install & run

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
```

Then open **http://localhost:3000** in your browser.

## 🪟 Electron Desktop Release

Current desktop release line: **v1.0.2**

### What's fixed in v1.0.2
- Fixed the front-end script mismatch that caused the portable Electron build to initialize with page errors
- Fixed the issue where buttons appeared clickable in the portable build but had no actual behavior after startup
- Synced the Electron front-end bundle with the current main branch UI and interaction logic
- Kept packaged app resources and writable runtime data paths separated correctly
- Fixed Windows Electron launch behavior by clearing `ELECTRON_RUN_AS_NODE` contamination
- Verified the packaged desktop app can serve `/`, `/api/info`, and normal in-app view switching correctly

### Recommended Windows downloads
- **Installer**: `Luma Studio Setup 1.0.2.exe`
- **Portable**: `Luma Studio 1.0.2.exe`

The installer is recommended for most users. The portable build is suitable for direct use without installation.

To run on a different port:

```bash
PORT=8080 npm start
```

---

## 📁 Project Structure

```
luma-studio/
├── server.js            # Express backend + sharp image pipeline + REST API
├── package.json
├── public/              # Front-end single-page app (vanilla JS, no framework)
│   ├── index.html
│   ├── style.css
│   └── app.js
└── storage/             # Created at runtime
    ├── uploads/         # Original & processed images (real files)
    ├── thumbs/          # Generated WebP thumbnails
    └── data/            # db.json (metadata index) + settings.json
```

---

## 🔌 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`    | `/api/photos`              | List all photos (newest first) |
| `GET`    | `/api/photos/:id`          | Get one photo's metadata |
| `POST`   | `/api/upload`              | Upload images (`multipart/form-data`, field `photos`) |
| `DELETE` | `/api/photos/:id`          | Delete one photo |
| `DELETE` | `/api/photos`              | Delete all photos |
| `GET`    | `/api/photos/:id/exif`     | Read EXIF metadata |
| `POST`   | `/api/photos/:id/exif`     | Write EXIF fields (JPEG only) |
| `POST`   | `/api/photos/:id/strip-exif` | Remove all metadata |
| `POST`   | `/api/photos/:id/process`  | Apply edits & save (copy/overwrite) |
| `POST`   | `/api/photos/:id/render`   | Apply edits & return bytes (for download) |
| `POST`   | `/api/photos/:id/preview`  | Estimate processed output size |
| `POST`   | `/api/photos/:id/rename`   | Rename a photo |
| `GET`    | `/api/settings`            | Get settings |
| `POST`   | `/api/settings`            | Update settings |
| `GET`    | `/api/stats`               | Storage statistics |
| `GET`    | `/api/search`              | Search/filter photos (query params: `q`, `sort`, `stars`, `flag`, `format`, `album`) |
| `GET`    | `/api/info`                | System info (version, author, runtime) |
| `POST`   | `/api/photos/:id/stars`    | Set star rating (0–5) |
| `POST`   | `/api/photos/:id/flag`     | Set flag (`pick` / `reject` / `null`) |
| `POST`   | `/api/photos/batch/stars`  | Batch set stars (`{ ids, stars }`) |
| `POST`   | `/api/photos/batch/flag`   | Batch set flag (`{ ids, flag }`) |
| `POST`   | `/api/photos/batch/delete` | Batch delete (`{ ids }`) |
| `POST`   | `/api/photos/download-zip` | Download selected photos as ZIP (`{ ids }`) |
| `GET`    | `/api/albums`              | List all albums |
| `POST`   | `/api/albums`              | Create album (`{ name }`) |
| `DELETE` | `/api/albums/:id`          | Delete album |
| `POST`   | `/api/albums/:id/rename`   | Rename album |
| `POST`   | `/api/albums/:id/add`      | Add photos to album (`{ ids }`) |
| `POST`   | `/api/albums/:id/remove`   | Remove photos from album (`{ ids }`) |
| `GET`    | `/files/:file`             | Serve original (add `?download=1` to force download) |
| `GET`    | `/thumbs/:id.webp`         | Serve thumbnail |

### Process / Render request body

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

## 🛠️ Tech Stack

- **Backend**: [Express](https://expressjs.com/)
- **Image processing**: [sharp](https://sharp.pixelplumbing.com/) (libvips)
- **EXIF**: [exifr](https://github.com/MikeKovarik/exifr) (read) + [piexifjs](https://github.com/hMatoba/piexifjs) (write)
- **Uploads**: [multer](https://github.com/expressjs/multer)
- **Front-end**: Vanilla JavaScript, HTML, CSS — zero front-end framework, zero build step required

---

## 📝 Notes

- **EXIF writing** is supported for **JPEG** files only (a format limitation of the EXIF standard). Chinese and other UTF-8 text is preserved.
- On **Windows**, sharp's internal cache is disabled (`sharp.cache(false)`) to avoid file-handle locks when overwriting originals.
- This app has **no authentication** — it's designed for local / personal use. Don't expose it directly to the public internet without putting it behind a reverse proxy with access control.

---

## 📄 License

MIT © 2026
