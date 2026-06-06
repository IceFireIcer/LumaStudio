/**
 * Luma Studio — Electron 主进程 (ESM 版本)
 * 打开应用 = 启动 Express 服务器 + 显示窗口
 * 关闭窗口 = 停止服务器 + 退出
 */
import { app, BrowserWindow } from 'electron';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import exifr from 'exifr';
import piexif from 'piexifjs';
import { nanoid } from 'nanoid';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZipFile } from 'yazl';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const __dirname_app = app.isPackaged
  ? path.dirname(process.execPath)
  : __dirname;

sharp.cache(false);

/* ============ 目录与数据 ============ */
const DIRS = {
  uploads: path.join(__dirname_app, 'storage', 'uploads'),
  thumbs: path.join(__dirname_app, 'storage', 'thumbs'),
  data: path.join(__dirname_app, 'storage', 'data'),
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

const DB_FILE = path.join(DIRS.data, 'db.json');
const SETTINGS_FILE = path.join(DIRS.data, 'settings.json');

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function saveJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

let db = loadJSON(DB_FILE, { photos: [], albums: [] });
if (!db.albums) db.albums = [];
for (const p of db.photos) {
  if (p.stars == null) p.stars = 0;
  if (p.flag == null) p.flag = null;
}
let settings = loadJSON(SETTINGS_FILE, {
  defaultFormat: 'jpeg', defaultQuality: 82, thumbSize: 480, accent: '#0071e3',
});
const persistDB = () => saveJSON(DB_FILE, db);
const persistSettings = () => saveJSON(SETTINGS_FILE, settings);

/* ============ 工具函数 ============ */
const IMAGE_MIME = /^image\/(jpeg|png|webp|gif|avif|tiff|bmp)$/i;
const FMT_EXT = { jpeg: 'jpeg', jpg: 'jpeg', png: 'png', webp: 'webp', avif: 'avif' };

async function runPipeline(srcPath, { adjust = {}, transform = {}, resize = {}, output = {} }) {
  let img = sharp(srcPath).rotate();
  let imgMeta = null;
  if (transform.crop && transform.crop.width > 0 && transform.crop.height > 0) {
    const c = transform.crop;
    if (!imgMeta) imgMeta = await sharp(srcPath).rotate().metadata();
    const left = Math.max(0, Math.min(Math.round(c.left), imgMeta.width - 1));
    const top = Math.max(0, Math.min(Math.round(c.top), imgMeta.height - 1));
    img = img.extract({ left, top, width: Math.min(Math.round(c.width), imgMeta.width - left), height: Math.min(Math.round(c.height), imgMeta.height - top) });
  }
  if (transform.rotate) img = img.rotate(transform.rotate);
  if (transform.flipH) img = img.flop();
  if (transform.flipV) img = img.flip();
  const mods = {};
  if (adjust.brightness != null && adjust.brightness !== 1) mods.brightness = adjust.brightness;
  if (adjust.saturation != null && adjust.saturation !== 1) mods.saturation = adjust.saturation;
  if (adjust.hue != null && adjust.hue !== 0) mods.hue = adjust.hue;
  if (Object.keys(mods).length) img = img.modulate(mods);
  if (adjust.contrast != null && adjust.contrast !== 1) { const a = adjust.contrast; img = img.linear(a, 128 * (1 - a)); }
  if (adjust.grayscale) img = img.grayscale();
  if (adjust.blur && adjust.blur > 0) img = img.blur(adjust.blur);
  if (adjust.sharpen && adjust.sharpen > 0) img = img.sharpen({ sigma: adjust.sharpen });
  if (resize.width || resize.height) img = img.resize(resize.width ? Math.round(resize.width) : null, resize.height ? Math.round(resize.height) : null, { fit: 'fill' });
  const fmt = (output.format || settings.defaultFormat || 'jpeg').toLowerCase();
  const q = output.quality || settings.defaultQuality || 82;
  if (fmt === 'jpeg' || fmt === 'jpg') img = img.jpeg({ quality: q, mozjpeg: true });
  else if (fmt === 'png') img = img.png({ quality: q, compressionLevel: 9 });
  else if (fmt === 'webp') img = img.webp({ quality: q });
  else if (fmt === 'avif') img = img.avif({ quality: q });
  const buffer = await img.toBuffer();
  return { buffer, ext: FMT_EXT[fmt] || 'jpeg' };
}

async function makeThumb(srcPath, id) {
  const thumbPath = path.join(DIRS.thumbs, id + '.webp');
  await sharp(srcPath).rotate().resize(settings.thumbSize, settings.thumbSize, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(thumbPath);
  return thumbPath;
}

async function buildMeta(filePath, id, original) {
  const meta = await sharp(filePath).metadata();
  const stat = await fsp.stat(filePath);
  return { id, name: original, file: path.basename(filePath), format: meta.format, width: meta.width, height: meta.height, size: stat.size, time: Date.now(), stars: 0, flag: null };
}

/* ============ Express 服务器 ============ */
const appServer = express();
appServer.use(express.json({ limit: '2mb' }));
appServer.use(express.static(path.join(__dirname_app, 'public')));
appServer.get('/files/:file', (req, res, next) => {
  const filePath = path.join(DIRS.uploads, path.basename(req.params.file));
  if (!fs.existsSync(filePath)) return next();
  if (req.query.download) {
    const photo = db.photos.find(p => p.file === path.basename(req.params.file));
    return res.download(filePath, photo ? photo.name : path.basename(req.params.file));
  }
  res.sendFile(filePath);
});
appServer.use('/thumbs', express.static(DIRS.thumbs));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ---- 所有 API 端点 ----
appServer.get('/api/info', (req, res) => {
  let total = 0; for (const p of db.photos) total += p.size || 0;
  res.json({ name: 'Luma Studio', nameCN: '光影工作室', version: '1.0.0', author: 'IceFire_Icer', year: 2026, node: process.version, sharp: sharp.versions || null, photoCount: db.photos.length, storageBytes: total, uptime: Math.floor(process.uptime()), pid: process.pid });
});
appServer.get('/api/photos', (req, res) => { res.json([...db.photos].sort((a, b) => b.time - a.time)); });
appServer.get('/api/photos/:id', (req, res) => { const p = db.photos.find(x => x.id === req.params.id); if (!p) return res.status(404).json({ error: '未找到' }); res.json(p); });
appServer.post('/api/upload', upload.array('photos'), async (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ error: '未收到任何文件' });
    const out = [];
    for (const f of req.files) {
      if (!IMAGE_MIME.test(f.mimetype)) continue;
      const id = nanoid(10); const ext = (f.originalname.split('.').pop() || 'jpg').toLowerCase();
      const dest = path.join(DIRS.uploads, `${id}.${ext}`);
      await fsp.writeFile(dest, f.buffer); await makeThumb(dest, id);
      const meta = await buildMeta(dest, id, f.originalname); db.photos.push(meta); out.push(meta);
    }
    persistDB(); res.json({ ok: true, added: out });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
appServer.delete('/api/photos/:id', async (req, res) => {
  const idx = db.photos.findIndex(x => x.id === req.params.id); if (idx === -1) return res.status(404).json({ error: '未找到' });
  const p = db.photos[idx]; await fsp.rm(path.join(DIRS.uploads, p.file), { force: true }); await fsp.rm(path.join(DIRS.thumbs, p.id + '.webp'), { force: true });
  db.photos.splice(idx, 1); persistDB(); res.json({ ok: true });
});
appServer.delete('/api/photos', async (req, res) => {
  for (const p of db.photos) { await fsp.rm(path.join(DIRS.uploads, p.file), { force: true }); await fsp.rm(path.join(DIRS.thumbs, p.id + '.webp'), { force: true }); }
  db.photos = []; db.albums.forEach(a => a.photoIds = []); persistDB(); res.json({ ok: true });
});
appServer.get('/api/photos/:id/exif', async (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id); if (!p) return res.status(404).json({ error: '未找到' });
  try {
    const full = path.join(DIRS.uploads, p.file);
    const data = await exifr.parse(full, { tiff: true, exif: true, gps: true, ifd0: true }).catch(() => null) || {};
    const ext = path.extname(full).toLowerCase();
    if (['.jpg', '.jpeg'].includes(ext)) {
      try {
        const bin = fs.readFileSync(full).toString('binary'); const obj = piexif.load(bin);
        const dec = raw => { if (raw == null) return undefined; const s = String(raw).replace(/\u0000+$/, ''); if (!s) return undefined; return Buffer.from(s, 'latin1').toString('utf8'); };
        const z = obj['0th'] || {}, ex = obj['Exif'] || {};
        for (const [k, v] of Object.entries({ Artist: z[piexif.ImageIFD.Artist], Copyright: z[piexif.ImageIFD.Copyright], ImageDescription: z[piexif.ImageIFD.ImageDescription], Software: z[piexif.ImageIFD.Software], DateTimeOriginal: ex[piexif.ExifIFD.DateTimeOriginal] })) {
          if (v != null && v !== '') { const d = dec(v); if (d) data[k] = d; }
        }
      } catch {}
    }
    res.json({ ok: true, exif: data });
  } catch { res.json({ ok: true, exif: {} }); }
});
appServer.post('/api/photos/:id/exif', async (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id); if (!p) return res.status(404).json({ error: '未找到' });
  const full = path.join(DIRS.uploads, p.file);
  try {
    const ext = path.extname(full).toLowerCase(); if (!['.jpg', '.jpeg'].includes(ext)) return res.status(400).json({ error: 'EXIF 写入仅支持 JPEG 格式' });
    const { artist, copyright, description, datetime, software } = req.body;
    const enc = s => Buffer.from(String(s), 'utf8').toString('latin1');
    const binary = fs.readFileSync(full).toString('binary');
    let exifObj; try { exifObj = piexif.load(binary); } catch { exifObj = { '0th': {}, Exif: {}, GPS: {}, '1st': {}, thumbnail: null }; }
    if (artist !== undefined) exifObj['0th'][piexif.ImageIFD.Artist] = enc(artist);
    if (copyright !== undefined) exifObj['0th'][piexif.ImageIFD.Copyright] = enc(copyright);
    if (description !== undefined) exifObj['0th'][piexif.ImageIFD.ImageDescription] = enc(description);
    if (software !== undefined) exifObj['0th'][piexif.ImageIFD.Software] = enc(software);
    if (datetime !== undefined) { exifObj['0th'][piexif.ImageIFD.DateTime] = datetime; exifObj['Exif'][piexif.ExifIFD.DateTimeOriginal] = datetime; }
    fs.writeFileSync(full, Buffer.from(piexif.insert(piexif.dump(exifObj), binary), 'binary'));
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
appServer.post('/api/photos/:id/strip-exif', async (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id); if (!p) return res.status(404).json({ error: '未找到' });
  const full = path.join(DIRS.uploads, p.file);
  try { const buf = await sharp(full).rotate().toBuffer(); await fsp.writeFile(full, buf); Object.assign(p, await buildMeta(full, p.id, p.name)); await makeThumb(full, p.id); persistDB(); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});
appServer.post('/api/photos/:id/process', async (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id); if (!p) return res.status(404).json({ error: '未找到' });
  const full = path.join(DIRS.uploads, p.file); const { mode = 'copy' } = req.body;
  try {
    const { buffer, ext } = await runPipeline(full, req.body);
    if (mode === 'overwrite') {
      const newName = p.id + '.' + ext; const newPath = path.join(DIRS.uploads, newName);
      if (newName !== p.file) await fsp.rm(full, { force: true }); await fsp.writeFile(newPath, buffer);
      const meta = await buildMeta(newPath, p.id, p.name); Object.assign(p, meta); await makeThumb(newPath, p.id); persistDB(); return res.json({ ok: true, photo: p, mode });
    } else {
      const id = nanoid(10); const newName = id + '.' + ext; const newPath = path.join(DIRS.uploads, newName);
      await fsp.writeFile(newPath, buffer); await makeThumb(newPath, id);
      const baseName = p.name.replace(/\.[^.]+$/, ''); const meta = await buildMeta(newPath, id, `${baseName}_edited.${ext}`); db.photos.push(meta); persistDB(); return res.json({ ok: true, photo: meta, mode });
    }
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
appServer.post('/api/photos/:id/render', async (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id); if (!p) return res.status(404).json({ error: '未找到' });
  try { const { buffer, ext } = await runPipeline(path.join(DIRS.uploads, p.file), req.body); res.setHeader('Content-Type', { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' }[ext] || 'application/octet-stream'); res.send(buffer); } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
appServer.post('/api/photos/:id/preview', async (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id); if (!p) return res.status(404).json({ error: '未找到' });
  try { const { buffer } = await runPipeline(path.join(DIRS.uploads, p.file), req.body); res.json({ ok: true, estimatedSize: buffer.length }); } catch (e) { res.status(500).json({ error: e.message }); }
});
appServer.post('/api/photos/:id/rename', (req, res) => { const p = db.photos.find(x => x.id === req.params.id); if (!p) return res.status(404).json({ error: '未找到' }); const name = (req.body.name || '').trim(); if (!name) return res.status(400).json({ error: '名称不能为空' }); p.name = name.slice(0, 200); persistDB(); res.json({ ok: true, photo: p }); });
appServer.get('/api/settings', (req, res) => res.json(settings));
appServer.post('/api/settings', (req, res) => { settings = { ...settings, ...req.body }; persistSettings(); res.json({ ok: true, settings }); });
appServer.get('/api/stats', async (req, res) => { let total = 0; for (const p of db.photos) total += p.size || 0; res.json({ count: db.photos.length, totalSize: total, thumbSize: settings.thumbSize }); });
appServer.post('/api/photos/:id/stars', (req, res) => { const p = db.photos.find(x => x.id === req.params.id); if (!p) return res.status(404).json({ error: '未找到' }); p.stars = Math.max(0, Math.min(5, Math.round(Number(req.body.stars) || 0))); persistDB(); res.json({ ok: true, stars: p.stars }); });
appServer.post('/api/photos/:id/flag', (req, res) => { const p = db.photos.find(x => x.id === req.params.id); if (!p) return res.status(404).json({ error: '未找到' }); p.flag = (req.body.flag === 'pick' || req.body.flag === 'reject') ? req.body.flag : null; persistDB(); res.json({ ok: true, flag: p.flag }); });
appServer.get('/api/albums', (req, res) => { res.json(db.albums.map(a => ({ ...a, count: (a.photoIds || []).filter(id => db.photos.some(p => p.id === id)).length }))); });
appServer.post('/api/albums', (req, res) => { const name = (req.body.name || '').trim(); if (!name) return res.status(400).json({ error: '名称不能为空' }); const album = { id: nanoid(10), name: name.slice(0, 100), photoIds: [], time: Date.now() }; db.albums.push(album); persistDB(); res.json({ ok: true, album }); });
appServer.delete('/api/albums/:id', (req, res) => { db.albums = db.albums.filter(a => a.id !== req.params.id); persistDB(); res.json({ ok: true }); });
appServer.post('/api/albums/:id/rename', (req, res) => { const a = db.albums.find(x => x.id === req.params.id); if (!a) return res.status(404).json({ error: '未找到' }); a.name = (req.body.name || '').trim().slice(0, 100); persistDB(); res.json({ ok: true, album: a }); });
appServer.post('/api/albums/:id/add', (req, res) => { const a = db.albums.find(x => x.id === req.params.id); if (!a) return res.status(404).json({ error: '未找到相册' }); const ids = Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids]; for (const id of ids) { if (db.photos.some(p => p.id === id) && !a.photoIds.includes(id)) a.photoIds.push(id); } persistDB(); res.json({ ok: true, count: a.photoIds.length }); });
appServer.post('/api/albums/:id/remove', (req, res) => { const a = db.albums.find(x => x.id === req.params.id); if (!a) return res.status(404).json({ error: '未找到相册' }); a.photoIds = a.photoIds.filter(id => !(Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids]).includes(id)); persistDB(); res.json({ ok: true, count: a.photoIds.length }); });
appServer.post('/api/photos/batch/stars', (req, res) => { const { ids = [], stars = 0 } = req.body; const s = Math.max(0, Math.min(5, Math.round(Number(stars) || 0))); let n = 0; for (const id of ids) { const p = db.photos.find(x => x.id === id); if (p) { p.stars = s; n++; } } persistDB(); res.json({ ok: true, updated: n, stars: s }); });
appServer.post('/api/photos/batch/flag', (req, res) => { const { ids = [], flag = null } = req.body; const f = (flag === 'pick' || flag === 'reject') ? flag : null; let n = 0; for (const id of ids) { const p = db.photos.find(x => x.id === id); if (p) { p.flag = f; n++; } } persistDB(); res.json({ ok: true, updated: n, flag: f }); });
appServer.post('/api/photos/batch/delete', async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : []; let n = 0;
  for (const id of ids) { const idx = db.photos.findIndex(x => x.id === id); if (idx === -1) continue; const p = db.photos[idx]; await fsp.rm(path.join(DIRS.uploads, p.file), { force: true }); await fsp.rm(path.join(DIRS.thumbs, p.id + '.webp'), { force: true }); db.photos.splice(idx, 1); n++; for (const a of db.albums) a.photoIds = a.photoIds.filter(i => i !== id); }
  persistDB(); res.json({ ok: true, deleted: n });
});
appServer.post('/api/photos/download-zip', async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const photos = ids.map(id => db.photos.find(p => p.id === id)).filter(Boolean);
  if (!photos.length) return res.status(400).json({ error: '未选择照片' });
  res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', 'attachment; filename="LumaStudio_export.zip"');
  const zip = new ZipFile(); zip.outputStream.pipe(res);
  const nameCount = {}; for (const p of photos) { let base = p.name || p.file; if (nameCount[base]) { nameCount[base]++; base = base.replace(/(\.[^.]+)$/, `_${nameCount[base]}$1`); } else nameCount[base] = 1; zip.addFile(path.join(DIRS.uploads, p.file), base); }
  zip.end();
});
appServer.get('/api/search', (req, res) => {
  let list = [...db.photos]; const { q, stars, flag, album, format, sort } = req.query;
  if (q) { const lower = q.toLowerCase(); list = list.filter(p => p.name.toLowerCase().includes(lower)); }
  if (stars) list = list.filter(p => p.stars === Number(stars));
  if (flag === 'pick') list = list.filter(p => p.flag === 'pick'); else if (flag === 'reject') list = list.filter(p => p.flag === 'reject'); else if (flag === 'flagged') list = list.filter(p => p.flag);
  if (format) list = list.filter(p => (p.format || '').toLowerCase() === format.toLowerCase());
  if (album) { const a = db.albums.find(x => x.id === album); if (a) list = list.filter(p => a.photoIds.includes(p.id)); }
  if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'name_desc') list.sort((a, b) => b.name.localeCompare(a.name));
  else if (sort === 'size') list.sort((a, b) => a.size - b.size);
  else if (sort === 'size_desc') list.sort((a, b) => b.size - a.size);
  else if (sort === 'stars') list.sort((a, b) => b.stars - a.stars);
  else if (sort === 'oldest') list.sort((a, b) => a.time - b.time);
  else list.sort((a, b) => b.time - a.time);
  res.json(list);
});

/* ============ Electron 主进程 ============ */
const PORT = 13579; // 使用固定高端口,避免冲突
let mainWindow = null;
let serverInstance = null;

function startServer() {
  return new Promise((resolve) => {
    serverInstance = appServer.listen(PORT, '127.0.0.1', () => {
      console.log(`  Luma Studio 服务器已启动 → http://localhost:${PORT}`);
      resolve();
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Luma Studio · 光影工作室',
    icon: path.join(__dirname_app, 'public', 'favicon.ico'),
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    autoHideMenuBar: true,
    show: false,
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Electron 生命周期
app.whenReady().then(async () => {
  console.log('正在启动 Luma Studio...');
  await startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (serverInstance) {
    serverInstance.close();
    console.log('服务器已停止');
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverInstance) {
    serverInstance.close();
  }
});