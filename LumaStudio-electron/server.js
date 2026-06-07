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
import { createRequire } from 'module';
// yazl 是 CJS 模块,用 createRequire 导入
const require2 = createRequire(import.meta.url);
const { ZipFile: _ZipFile } = require2('yazl');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Windows 下 libvips 会缓存文件句柄,导致随后覆盖/写入同名原文件时报 UNKNOWN open 错误。
// 关闭 sharp 的内部缓存,确保读完即释放句柄。
sharp.cache(false);

/* ============ 目录与数据 ============ */
const DIRS = {
  uploads: path.join(__dirname, 'storage', 'uploads'),
  thumbs: path.join(__dirname, 'storage', 'thumbs'),
  data: path.join(__dirname, 'storage', 'data'),
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

/* ============ 日志系统 ============ */
// 检测运行环境：便携版(Electron)使用 lumastudio-log，安装版(Web)使用 log
// 检测依据: process.versions.electron (Electron环境特有) 或 ELECTRON_RUN_AS_NODE 环境变量
const isElectron = !!(process.versions && process.versions.electron) ||
                   process.env.ELECTRON_RUN_AS_NODE === '1';

const LOG_DIR_NAME = isElectron ? 'lumastudio-log' : 'log';
const LOG_DIR = path.join(__dirname, LOG_DIR_NAME);
fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, 'app.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB 限制
const MAX_LOG_BACKUPS = 3; // 最多保留 3 个轮转备份，超出删除最旧的

// 清理过多的轮转备份文件，仅保留最近 MAX_LOG_BACKUPS 个
function cleanupLogBackups() {
  try {
    const backups = fs.readdirSync(LOG_DIR)
      .filter(f => /^app-\d+\.log$/.test(f))
      .map(f => ({ name: f, time: parseInt(f.match(/\d+/)[0], 10) }))
      .sort((a, b) => b.time - a.time); // 新→旧
    for (const old of backups.slice(MAX_LOG_BACKUPS)) {
      fs.unlinkSync(path.join(LOG_DIR, old.name));
    }
  } catch (e) {
    console.error('清理日志备份失败:', e.message);
  }
}

// 日志写入函数
function logMessage(level, source, message, data = null) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 23);
  const logEntry = {
    time: timestamp,
    level: level.toUpperCase(),
    source: source,
    message: message,
    data: data
  };

  const logLine = JSON.stringify(logEntry) + '\n';

  // 检查日志文件大小，超过限制则轮转
  try {
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        const backupFile = path.join(LOG_DIR, `app-${Date.now()}.log`);
        fs.renameSync(LOG_FILE, backupFile);
        cleanupLogBackups(); // 轮转后清理过旧备份，避免无限堆积
      }
    }
  } catch (e) {
    console.error('日志轮转失败:', e.message);
  }

  // 写入日志文件（写入失败不应中断主流程）
  try {
    fs.appendFileSync(LOG_FILE, logLine, 'utf8');
  } catch (e) {
    console.error('写入日志失败:', e.message);
  }

  // 同时输出到控制台
  const consoleMsg = `[${timestamp}] [${level.toUpperCase()}] [${source}] ${message}`;
  if (level === 'error') console.error(consoleMsg);
  else if (level === 'warn') console.warn(consoleMsg);
  else console.log(consoleMsg);
}

// 便捷方法
const logger = {
  info: (source, msg, data) => logMessage('info', source, msg, data),
  warn: (source, msg, data) => logMessage('warn', source, msg, data),
  error: (source, msg, data) => logMessage('error', source, msg, data),
  debug: (source, msg, data) => logMessage('debug', source, msg, data),
};

// 启动日志
logger.info('system', 'Luma Studio 启动', { isElectron, logDir: LOG_DIR });

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
// 迁移:旧数据可能没有 albums 或照片缺少 stars/flag 字段
if (!db.albums) db.albums = [];
for (const p of db.photos) {
  if (p.stars == null) p.stars = 0;
  if (p.flag == null) p.flag = null;
}
let settings = loadJSON(SETTINGS_FILE, {
  defaultFormat: 'jpeg',
  defaultQuality: 82,
  thumbSize: 480,
  accent: '#0071e3',
});
const persistDB = () => saveJSON(DB_FILE, db);
const persistSettings = () => saveJSON(SETTINGS_FILE, settings);

/* ============ 工具 ============ */
const IMAGE_MIME = /^image\/(jpeg|png|webp|gif|avif|tiff|bmp)$/i;
const FMT_EXT = { jpeg: 'jpeg', jpg: 'jpeg', png: 'png', webp: 'webp', avif: 'avif' };

// 共享图像处理管线:根据编辑参数构建 sharp 实例并返回输出 buffer 与最终格式
async function runPipeline(srcPath, { adjust = {}, transform = {}, resize = {}, output = {} }) {
  let img = sharp(srcPath).rotate(); // 先按原 EXIF 方向校正
  // 只在裁剪时才读取 metadata,避免重复打开文件
  let imgMeta = null;

  // 裁剪(基于原始像素坐标)
  if (transform.crop && transform.crop.width > 0 && transform.crop.height > 0) {
    const c = transform.crop;
    if (!imgMeta) imgMeta = await sharp(srcPath).rotate().metadata();
    const left = Math.max(0, Math.min(Math.round(c.left), imgMeta.width - 1));
    const top = Math.max(0, Math.min(Math.round(c.top), imgMeta.height - 1));
    img = img.extract({
      left, top,
      width: Math.min(Math.round(c.width), imgMeta.width - left),
      height: Math.min(Math.round(c.height), imgMeta.height - top),
    });
  }

  // 旋转 / 翻转
  if (transform.rotate) img = img.rotate(transform.rotate);
  if (transform.flipH) img = img.flop();
  if (transform.flipV) img = img.flip();

  // 调整
  const mods = {};
  if (adjust.brightness != null && adjust.brightness !== 1) mods.brightness = adjust.brightness;
  if (adjust.saturation != null && adjust.saturation !== 1) mods.saturation = adjust.saturation;
  if (adjust.hue != null && adjust.hue !== 0) mods.hue = adjust.hue;
  if (Object.keys(mods).length) img = img.modulate(mods);

  if (adjust.contrast != null && adjust.contrast !== 1) {
    const a = adjust.contrast; // 线性对比度,以 128 为中心
    img = img.linear(a, 128 * (1 - a));
  }
  if (adjust.grayscale) img = img.grayscale();
  if (adjust.blur && adjust.blur > 0) img = img.blur(adjust.blur);
  if (adjust.sharpen && adjust.sharpen > 0) img = img.sharpen({ sigma: adjust.sharpen });

  // 缩放
  if (resize.width || resize.height) {
    img = img.resize(
      resize.width ? Math.round(resize.width) : null,
      resize.height ? Math.round(resize.height) : null,
      { fit: 'fill' }
    );
  }

  // 输出格式
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
  await sharp(srcPath)
    .rotate() // 按 EXIF 方向自动校正
    .resize(settings.thumbSize, settings.thumbSize, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(thumbPath);
  return thumbPath;
}

async function buildMeta(filePath, id, original) {
  const img = sharp(filePath);
  const meta = await img.metadata();
  const stat = await fsp.stat(filePath);
  return {
    id,
    name: original,
    file: path.basename(filePath),
    format: meta.format,
    width: meta.width,
    height: meta.height,
    size: stat.size,
    time: Date.now(),
    stars: 0,
    flag: null,
  };
}

/* ============ Express ============ */
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 读取 package.json 版本号(兼容 ESM)
const require = createRequire(import.meta.url);
const VERSION = (() => { try { return require('./package.json').version; } catch { return '1.0.2'; } })();

/* ---------- 关于 / 系统信息 ---------- */
app.get('/api/info', (req, res) => {
  let total = 0;
  for (const p of db.photos) total += p.size || 0;
  res.json({
    name: 'Luma Studio',
    nameCN: '光影工作室',
    version: VERSION,
    author: 'IceFire_Icer',
    year: 2026,
    node: process.version,
    sharp: sharp.versions || null,
    photoCount: db.photos.length,
    storageBytes: total,
    uptime: Math.floor(process.uptime()),
    pid: process.pid,
  });
});
// 原图访问;带 ?download=1 时强制以附件下载并使用原始文件名
app.get('/files/:file', (req, res, next) => {
  const filePath = path.join(DIRS.uploads, path.basename(req.params.file));
  if (!fs.existsSync(filePath)) return next();
  if (req.query.download) {
    const photo = db.photos.find(p => p.file === path.basename(req.params.file));
    return res.download(filePath, photo ? photo.name : path.basename(req.params.file));
  }
  res.sendFile(filePath);
});
app.use('/thumbs', express.static(DIRS.thumbs));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/* ---------- 列表 ---------- */
app.get('/api/photos', (req, res) => {
  const list = [...db.photos].sort((a, b) => b.time - a.time);
  res.json(list);
});

app.get('/api/photos/:id', (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: '未找到' });
  res.json(p);
});

/* ---------- 上传 ---------- */
app.post('/api/upload', upload.array('photos'), async (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ error: '未收到任何文件' });
    const out = [];
    for (const f of req.files) {
      if (!IMAGE_MIME.test(f.mimetype)) continue;
      const id = nanoid(10);
      const ext = (f.originalname.split('.').pop() || 'jpg').toLowerCase();
      const fileName = `${id}.${ext}`;
      const dest = path.join(DIRS.uploads, fileName);
      await fsp.writeFile(dest, f.buffer);
      await makeThumb(dest, id);
      const meta = await buildMeta(dest, id, f.originalname);
      db.photos.push(meta);
      out.push(meta);
    }
    persistDB();
    res.json({ ok: true, added: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/* ---------- 删除 ---------- */
app.delete('/api/photos/:id', async (req, res) => {
  const idx = db.photos.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '未找到' });
  const p = db.photos[idx];
  await fsp.rm(path.join(DIRS.uploads, p.file), { force: true });
  await fsp.rm(path.join(DIRS.thumbs, p.id + '.webp'), { force: true });
  db.photos.splice(idx, 1);
  persistDB();
  res.json({ ok: true });
});

app.delete('/api/photos', async (req, res) => {
  for (const p of db.photos) {
    await fsp.rm(path.join(DIRS.uploads, p.file), { force: true });
    await fsp.rm(path.join(DIRS.thumbs, p.id + '.webp'), { force: true });
  }
  db.photos = [];
  persistDB();
  res.json({ ok: true });
});

/* ---------- EXIF 读取 ---------- */
app.get('/api/photos/:id/exif', async (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: '未找到' });
  try {
    const full = path.join(DIRS.uploads, p.file);
    const data = await exifr.parse(full, { tiff: true, exif: true, gps: true, ifd0: true }).catch(() => null) || {};
    // exifr 对 ASCII 字段做 7-bit 解码会丢失中文,改用 piexif 回读文本字段并按 UTF-8 还原
    const ext = path.extname(full).toLowerCase();
    if (['.jpg', '.jpeg'].includes(ext)) {
      try {
        const bin = fs.readFileSync(full).toString('binary');
        const obj = piexif.load(bin);
        const dec = raw => {
          if (raw == null) return undefined;
          // piexif 以 latin1 承载字节,去掉尾部 null 后按 UTF-8 还原
          const s = String(raw).replace(/\u0000+$/, '');
          if (!s) return undefined;
          return Buffer.from(s, 'latin1').toString('utf8');
        };
        const z = obj['0th'] || {}, ex = obj['Exif'] || {};
        const m = {
          Artist: z[piexif.ImageIFD.Artist],
          Copyright: z[piexif.ImageIFD.Copyright],
          ImageDescription: z[piexif.ImageIFD.ImageDescription],
          Software: z[piexif.ImageIFD.Software],
          DateTimeOriginal: ex[piexif.ExifIFD.DateTimeOriginal],
        };
        for (const [k, v] of Object.entries(m)) {
          if (v != null && v !== '') { const d = dec(v); if (d) data[k] = d; }
        }
      } catch { /* 忽略,沿用 exifr 结果 */ }
    }
    res.json({ ok: true, exif: data });
  } catch (e) {
    res.json({ ok: true, exif: {} });
  }
});

/* ---------- EXIF 写入(仅 JPEG)---------- */
app.post('/api/photos/:id/exif', async (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: '未找到' });
  const full = path.join(DIRS.uploads, p.file);
  try {
    const ext = path.extname(full).toLowerCase();
    if (!['.jpg', '.jpeg'].includes(ext)) {
      return res.status(400).json({ error: 'EXIF 写入仅支持 JPEG 格式' });
    }
    const { artist, copyright, description, datetime, software } = req.body;
    // piexifjs 按单字节处理字符串,中文等非 ASCII 需先转成 UTF-8 字节序列(以 latin1 字符承载)
    const enc = s => Buffer.from(String(s), 'utf8').toString('latin1');
    const binary = fs.readFileSync(full).toString('binary');
    let exifObj;
    try { exifObj = piexif.load(binary); }
    catch { exifObj = { '0th': {}, Exif: {}, GPS: {}, '1st': {}, thumbnail: null }; }

    if (artist !== undefined) exifObj['0th'][piexif.ImageIFD.Artist] = enc(artist);
    if (copyright !== undefined) exifObj['0th'][piexif.ImageIFD.Copyright] = enc(copyright);
    if (description !== undefined) exifObj['0th'][piexif.ImageIFD.ImageDescription] = enc(description);
    if (software !== undefined) exifObj['0th'][piexif.ImageIFD.Software] = enc(software);
    if (datetime !== undefined) {
      exifObj['0th'][piexif.ImageIFD.DateTime] = datetime;
      exifObj['Exif'][piexif.ExifIFD.DateTimeOriginal] = datetime;
    }
    const exifBytes = piexif.dump(exifObj);
    const newData = piexif.insert(exifBytes, binary);
    fs.writeFileSync(full, Buffer.from(newData, 'binary'));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/* ---------- 抹除元数据 ---------- */
app.post('/api/photos/:id/strip-exif', async (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: '未找到' });
  const full = path.join(DIRS.uploads, p.file);
  try {
    const buf = await sharp(full).rotate().toBuffer(); // rotate 烘焙方向后丢弃元数据
    await fsp.writeFile(full, buf);
    Object.assign(p, await buildMeta(full, p.id, p.name));
    await makeThumb(full, p.id);
    persistDB();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- 处理 / 导出 ----------
  body: {
    adjust: { brightness, saturation, hue, contrast(线性), sharpen, blur, grayscale },
    transform: { rotate, flipH, flipV, crop:{left,top,width,height}(像素) },
    resize: { width, height },
    output: { format, quality },
    mode: 'copy' | 'overwrite'
  }
*/
app.post('/api/photos/:id/process', async (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: '未找到' });
  const full = path.join(DIRS.uploads, p.file);
  const { mode = 'copy' } = req.body;

  try {
    const { buffer, ext } = await runPipeline(full, req.body);

    if (mode === 'overwrite') {
      const newName = p.id + '.' + ext;
      const newPath = path.join(DIRS.uploads, newName);
      if (newName !== p.file) await fsp.rm(full, { force: true });
      await fsp.writeFile(newPath, buffer);
      const meta = await buildMeta(newPath, p.id, p.name);
      Object.assign(p, meta);
      await makeThumb(newPath, p.id);
      persistDB();
      return res.json({ ok: true, photo: p, mode });
    } else {
      const id = nanoid(10);
      const newName = id + '.' + ext;
      const newPath = path.join(DIRS.uploads, newName);
      await fsp.writeFile(newPath, buffer);
      await makeThumb(newPath, id);
      const baseName = p.name.replace(/\.[^.]+$/, '');
      const meta = await buildMeta(newPath, id, `${baseName}_edited.${ext}`);
      db.photos.push(meta);
      persistDB();
      return res.json({ ok: true, photo: meta, mode });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/* ---------- 渲染下载(处理后直接回传字节,不落库)---------- */
app.post('/api/photos/:id/render', async (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: '未找到' });
  const full = path.join(DIRS.uploads, p.file);
  try {
    const { buffer, ext } = await runPipeline(full, req.body);
    const mime = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' }[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/* ---------- 处理预览(返回处理后体积估算,不落库)---------- */
app.post('/api/photos/:id/preview', async (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: '未找到' });
  const full = path.join(DIRS.uploads, p.file);
  try {
    const { buffer } = await runPipeline(full, req.body);
    res.json({ ok: true, estimatedSize: buffer.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- 重命名 ---------- */
app.post('/api/photos/:id/rename', (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: '未找到' });
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '名称不能为空' });
  p.name = name.slice(0, 200);
  persistDB();
  res.json({ ok: true, photo: p });
});

/* ---------- 设置 ---------- */
app.get('/api/settings', (req, res) => res.json(settings));
app.post('/api/settings', (req, res) => {
  settings = { ...settings, ...req.body };
  persistSettings();
  res.json({ ok: true, settings });
});

/* ---------- 存储统计 ---------- */
app.get('/api/stats', async (req, res) => {
  let total = 0;
  for (const p of db.photos) total += p.size || 0;
  res.json({
    count: db.photos.length,
    totalSize: total,
    thumbSize: settings.thumbSize,
  });
});

/* ==================== 新增功能:选片/相册/批量 ==================== */

/* ---------- 评分(1-5星) ---------- */
app.post('/api/photos/:id/stars', (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: '未找到' });
  const s = Math.max(0, Math.min(5, Math.round(Number(req.body.stars) || 0)));
  p.stars = s;
  persistDB();
  res.json({ ok: true, stars: s });
});

/* ---------- 标记(pick/reject/clear) ---------- */
app.post('/api/photos/:id/flag', (req, res) => {
  const p = db.photos.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: '未找到' });
  const f = req.body.flag;
  p.flag = (f === 'pick' || f === 'reject') ? f : null;
  persistDB();
  res.json({ ok: true, flag: p.flag });
});

/* ---------- 相册 CRUD ---------- */
app.get('/api/albums', (req, res) => {
  // 附加每个相册的照片数
  const out = db.albums.map(a => ({
    ...a,
    count: (a.photoIds || []).filter(id => db.photos.some(p => p.id === id)).length,
  }));
  res.json(out);
});

app.post('/api/albums', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '名称不能为空' });
  const album = { id: nanoid(10), name: name.slice(0, 100), photoIds: [], time: Date.now() };
  db.albums.push(album);
  persistDB();
  res.json({ ok: true, album });
});

app.delete('/api/albums/:id', (req, res) => {
  db.albums = db.albums.filter(a => a.id !== req.params.id);
  persistDB();
  res.json({ ok: true });
});

app.post('/api/albums/:id/rename', (req, res) => {
  const a = db.albums.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: '未找到' });
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '名称不能为空' });
  a.name = name.slice(0, 100);
  persistDB();
  res.json({ ok: true, album: a });
});

app.post('/api/albums/:id/add', (req, res) => {
  const a = db.albums.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: '未找到相册' });
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids];
  for (const id of ids) {
    if (db.photos.some(p => p.id === id) && !a.photoIds.includes(id)) a.photoIds.push(id);
  }
  persistDB();
  res.json({ ok: true, count: a.photoIds.length });
});

app.post('/api/albums/:id/remove', (req, res) => {
  const a = db.albums.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: '未找到相册' });
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids];
  a.photoIds = a.photoIds.filter(id => !ids.includes(id));
  persistDB();
  res.json({ ok: true, count: a.photoIds.length });
});

/* ---------- 批量标记 / 评分 ---------- */
app.post('/api/photos/batch/stars', (req, res) => {
  const { ids = [], stars = 0 } = req.body;
  const s = Math.max(0, Math.min(5, Math.round(Number(stars) || 0)));
  let n = 0;
  for (const id of ids) {
    const p = db.photos.find(x => x.id === id);
    if (p) { p.stars = s; n++; }
  }
  persistDB();
  res.json({ ok: true, updated: n, stars: s });
});

app.post('/api/photos/batch/flag', (req, res) => {
  const { ids = [], flag = null } = req.body;
  const f = (flag === 'pick' || flag === 'reject') ? flag : null;
  let n = 0;
  for (const id of ids) {
    const p = db.photos.find(x => x.id === id);
    if (p) { p.flag = f; n++; }
  }
  persistDB();
  res.json({ ok: true, updated: n, flag: f });
});

/* ---------- 批量下载为 ZIP ---------- */
app.post('/api/photos/download-zip', async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const photos = ids.map(id => db.photos.find(p => p.id === id)).filter(Boolean);
  if (!photos.length) return res.status(400).json({ error: '未选择照片' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="LumaStudio_export.zip"');

  const zip = new _ZipFile();
  zip.outputStream.pipe(res);

  // 处理重名:追加后缀
  const nameCount = {};
  for (const p of photos) {
    let base = p.name || p.file;
    if (nameCount[base]) { nameCount[base]++; base = base.replace(/(\.[^.]+)$/, `_${nameCount[base]}$1`); }
    else nameCount[base] = 1;
    zip.addFile(path.join(DIRS.uploads, p.file), base);
  }
  zip.end();
});

/* ---------- 批量删除 ---------- */
app.post('/api/photos/batch/delete', async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  let n = 0;
  for (const id of ids) {
    const idx = db.photos.findIndex(x => x.id === id);
    if (idx === -1) continue;
    const p = db.photos[idx];
    await fsp.rm(path.join(DIRS.uploads, p.file), { force: true });
    await fsp.rm(path.join(DIRS.thumbs, p.id + '.webp'), { force: true });
    db.photos.splice(idx, 1);
    n++;
    // 从所有相册中移除
    for (const a of db.albums) a.photoIds = a.photoIds.filter(i => i !== id);
  }
  persistDB();
  res.json({ ok: true, deleted: n });
});

/* ---------- 全局搜索(支持名称/格式/星级/标记/相册) ---------- */
app.get('/api/search', (req, res) => {
  let list = [...db.photos];
  const { q, stars, flag, album, format, sort } = req.query;

  if (q) {
    const lower = q.toLowerCase();
    list = list.filter(p => p.name.toLowerCase().includes(lower));
  }
  if (stars) list = list.filter(p => p.stars === Number(stars));
  if (flag === 'pick') list = list.filter(p => p.flag === 'pick');
  else if (flag === 'reject') list = list.filter(p => p.flag === 'reject');
  else if (flag === 'flagged') list = list.filter(p => p.flag);
  if (format) list = list.filter(p => (p.format || '').toLowerCase() === format.toLowerCase());
  if (album) {
    const a = db.albums.find(x => x.id === album);
    if (a) list = list.filter(p => a.photoIds.includes(p.id));
  }

  // 排序
  if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'name_desc') list.sort((a, b) => b.name.localeCompare(a.name));
  else if (sort === 'size') list.sort((a, b) => a.size - b.size);
  else if (sort === 'size_desc') list.sort((a, b) => b.size - a.size);
  else if (sort === 'stars') list.sort((a, b) => b.stars - a.stars);
  else if (sort === 'oldest') list.sort((a, b) => a.time - b.time);
  else list.sort((a, b) => b.time - a.time); // 默认:最新在前

  res.json(list);
});

/* ---------- 日志系统 API ---------- */
// 请求日志中间件
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api/')) {
      logger.info('backend', `${req.method} ${req.path}`, {
        status: res.statusCode,
        duration: `${duration}ms`,
        query: Object.keys(req.query).length ? req.query : undefined,
        body: req.method !== 'GET' && req.body ? JSON.stringify(req.body).substring(0, 200) : undefined
      });
    }
  });
  next();
});

// 获取日志列表
app.get('/api/logs', (req, res) => {
  try {
    const { limit = 100, level, source } = req.query;

    if (!fs.existsSync(LOG_FILE)) {
      return res.json({ logs: [], total: 0 });
    }

    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);

    let logs = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);

    // 过滤
    if (level) {
      logs = logs.filter(l => l.level.toLowerCase() === level.toLowerCase());
    }
    if (source) {
      logs = logs.filter(l => l.source.toLowerCase() === source.toLowerCase());
    }

    const totalMatched = logs.length; // 过滤后、截断前的总数

    // 取最近的 N 条（文件是追加的，所以需要反转）
    logs = logs.slice(-parseInt(limit)).reverse();

    res.json({
      logs,
      total: totalMatched,    // 符合过滤条件的日志总数
      returned: logs.length,  // 本次实际返回的条数
      logDir: LOG_DIR,
      logFile: LOG_FILE
    });
  } catch (e) {
    logger.error('backend', '读取日志失败', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// 清空日志
app.post('/api/logs/clear', (req, res) => {
  try {
    if (fs.existsSync(LOG_FILE)) {
      fs.writeFileSync(LOG_FILE, '', 'utf8');
    }
    // 同时删除所有轮转备份，确保"清空"是彻底的
    try {
      fs.readdirSync(LOG_DIR)
        .filter(f => /^app-\d+\.log$/.test(f))
        .forEach(f => fs.unlinkSync(path.join(LOG_DIR, f)));
    } catch (e) {
      console.error('清理日志备份失败:', e.message);
    }
    logger.info('backend', '日志已清空');
    res.json({ ok: true });
  } catch (e) {
    logger.error('backend', '清空日志失败', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// 获取日志文件路径信息
app.get('/api/logs/info', (req, res) => {
  res.json({
    logDir: LOG_DIR,
    logFile: LOG_FILE,
    isElectron,
    logDirName: LOG_DIR_NAME
  });
});

// 接收前端日志
app.post('/api/logs/frontend', (req, res) => {
  const { level = 'info', message, data } = req.body;
  if (message) {
    logger[level] ? logger[level]('frontend', message, data) : logger.info('frontend', message, data);
  }
  res.json({ ok: true });
});

const PORT = process.env.PORT || 7443;
app.listen(PORT, () => {
  logger.info('system', `服务器已启动在端口 ${PORT}`);
  console.log(`\n  📷 图片工作室已启动`);
  console.log(`  → http://localhost:${PORT}\n`);
  console.log(`  📝 日志目录: ${LOG_DIR}\n`);
});
