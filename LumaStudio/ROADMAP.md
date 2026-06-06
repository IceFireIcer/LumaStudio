# Roadmap

Current status, completed milestones, and planned features for Luma Studio.

---

## Status

| Branch | Content | Status |
|--------|---------|--------|
| `main` | Source code (development) | ✅ Stable |
| `windows-releases` | Windows bat installer (one-click install/launch/uninstall) | ✅ Stable |
| `electron` | Electron desktop app source | ✅ Buildable |
| `electron-releases` | Electron build artifacts (.exe installer) | ✅ Available |

---

## Electron Status

The Electron desktop version is now fixed and buildable.

- App launch works with the dedicated Electron entrypoint
- Windows builds can be produced successfully
- Source code lives on the `electron` branch
- Windows build artifacts live on the `electron-releases` branch

---

## Completed

- [x] Gallery with drag-and-drop upload, grid, lightbox
- [x] Editor: brightness, contrast, saturation, hue, sharpen, blur, grayscale
- [x] Editor: 6 one-tap presets (Original, Vivid, Soft, Vintage, Mono, High-contrast)
- [x] Editor: rotate, flip, interactive crop (Free / 1:1 / 4:3 / 16:9 / 3:4)
- [x] Editor: resize (pixel input + percentage quick scale)
- [x] Editor: export (JPEG / PNG / WebP / AVIF), quality slider, size estimate
- [x] Editor: undo / redo (`Ctrl+Z` / `Ctrl+Y`), keyboard-only (no UI buttons)
- [x] EXIF: view metadata, edit fields (JPEG, UTF-8 / CJK), strip all
- [x] Photo culling: 1–5 stars, pick/reject flags, batch operations
- [x] Albums: create / rename / delete, add / remove photos
- [x] Search, filter (stars, flags, format), sort (name, date, size, stars)
- [x] Slideshow with auto-play and keyboard controls
- [x] Batch operations: rate, flag, add to album, download ZIP, delete
- [x] Settings: default export, thumbnail size, theme accent color
- [x] About page with runtime info
- [x] Windows bat installer (install.bat / start.bat / uninstall.bat)
- [x] Dark-screen bug fix (`[hidden]` attribute vs CSS `display` priority)

---

## Planned

### High Priority
- [ ] **Batch processing** — apply same edit parameters to multiple photos

### Medium Priority
- [ ] **Before/After comparison** — side-by-side or slider in editor
- [ ] **EXIF hover overlay** — show aperture / shutter / ISO on card hover
- [ ] **Export all** — one-click download of entire library
- [ ] **Dark theme** — toggle in settings
- [ ] **i18n** — in-app language switch (currently UI is Chinese)

### Low Priority
- [ ] **Watermark** — text or image overlay on export
- [ ] **Custom presets** — save user-defined adjustment presets
- [ ] **Tags** — custom labels (landscape, portrait, etc.) with filtering
- [ ] **Drag-to-reorder** — manual photo ordering in library / albums
- [ ] **Print layout** — passport photo / collage templates

---

## Frontend Design Guidelines

All new UI must follow the existing design system. **Do not change the established layout or style.**

| Token | Value |
|-------|-------|
| Background | `#ffffff` |
| Surface | `#f6f7f9` |
| Text | `#1d1d1f` |
| Accent | `#0071e3` |
| Card radius | `18px` |
| Button radius | `980px` (pill) |
| Input radius | `12px` |
| Shadow (default) | `0 8px 30px rgba(0,0,0,.07)` |
| Shadow (hover) | `0 18px 56px rgba(0,0,0,.14)` |
| Bounce curve | `cubic-bezier(.34,1.56,.64,1)` |
| Enter curve | `cubic-bezier(.22,1,.36,1)` |
| Font | `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif` |

**Rules**:
- Reuse existing components: `.btn`, `.card`, `.field`, `.slider-row`, `.switch-row`, `.chip`, `.hint`, `.divider`
- New pages follow the "About" structure: `.topbar` + `.settings-card` container
- New sidebar items use `.nav-item` SVG + `<span>` pattern (no icon fonts)
- Responsive breakpoints: `900px` (editor/exif single-column) and `680px` (sidebar collapses to icons)
