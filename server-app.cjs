/**
 * Luma Studio — 共享 Express 应用与图像处理管线（单一事实来源）
 *
 * 由 electron-main.cjs 引入，并可被测试直接使用。
 * 本模块集中承载所有业务逻辑，避免服务端代码在多处复制导致漂移。
 */
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const exifr = require('exifr');
const piexif = require('piexifjs');
const { nanoid } = require('nanoid');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { ZipFile } = require('yazl');

const IMAGE_MIME = /^image\/(jpeg|png|webp|gif|avif|tiff|bmp)$/i;
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'tif', 'tiff', 'bmp']);
const FORMAT_TO_EXT = {
  jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif',
  avif: 'avif', tiff: 'tiff', bmp: 'bmp',
};
const FMT_EXT = { jpeg: 'jpeg', jpg: 'jpeg', png: 'png', webp: 'webp', avif: 'avif' };
const VALID_OUTPUT_FORMATS = new Set(['jpeg', 'jpg', 'png', 'webp', 'avif']);
const DEFAULT_SETTINGS = {
  defaultFormat: 'jpeg',
  defaultQuality: 82,
  thumbSize: 480,
  accent: '#0071e3',
};
const MAX_LOG_SIZE = 10 * 1024 * 1024;
const MAX_LOG_BACKUPS = 3;

/* ============ 工具 ============ */
function clampNum(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
function clampInt(v, min, max, dflt) {
  return Math.round(clampNum(v, min, max, dflt));
}
function toBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}
// 将任意角度归一化到 0/90/180/270（编辑器仅使用 90° 步进；裁剪坐标换算依赖此约定）
function normalizeAngle(angle) {
  const n = Math.round(Number(angle) || 0);
  const snapped = Math.round(n / 90) * 90;
  return ((snapped % 360) + 360) % 360;
}

// 浏览器以 UTF-8 原始字节发送 multipart 文件名，Node 的 HTTP 头按 latin1 解码，
// 导致中文文件名变成乱码；这里把 latin1 字节串还原为 UTF-8（纯 ASCII 不受影响）。
// 若还原结果含替换符 U+FFFD，说明原串本来就是正常文本（如合法的 Latin-1 字符），保持原样。
function fixUploadName(raw) {
  const s = String(raw || '');
  if (!s || /^[\x00-\x7F]*$/.test(s)) return s;
  const fixed = Buffer.from(s, 'latin1').toString('utf8');
  return fixed.includes('\uFFFD') ? s : fixed;
}

/* ============ 日志系统 ============ */
function formatLocalTime(date = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function createLogger(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const LOG_FILE = path.join(logDir, 'app.log');

  function cleanupLogBackups() {
    try {
      const backups = fs.readdirSync(logDir)
        .filter(f => /^app-\d+\.log$/.test(f))
        .map(f => ({ name: f, time: parseInt(f.match(/\d+/)[0], 10) }))
        .sort((a, b) => b.time - a.time);
      for (const old of backups.slice(MAX_LOG_BACKUPS)) {
        fs.unlinkSync(path.join(logDir, old.name));
      }
    } catch (e) {
      console.error('清理日志备份失败:', e.message);
    }
  }

  function logMessage(level, source, message, data = null) {
    const timestamp = formatLocalTime();
    const logEntry = {
      time: timestamp,
      level: String(level).toUpperCase(),
      source,
      message: String(message).slice(0, 2000),
      data,
    };
    const logLine = JSON.stringify(logEntry) + '\n';

    try {
      if (fs.existsSync(LOG_FILE)) {
        const stats = fs.statSync(LOG_FILE);
        if (stats.size > MAX_LOG_SIZE) {
          fs.renameSync(LOG_FILE, path.join(logDir, `app-${Date.now()}.log`));
          cleanupLogBackups();
        }
      }
    } catch (e) {
      console.error('日志轮转失败:', e.message);
    }

    try {
      fs.appendFileSync(LOG_FILE, logLine, 'utf8');
    } catch (e) {
      console.error('日志写入失败:', e.message);
    }

    const consoleMsg = `[${timestamp}] [${logEntry.level}] [${source}] ${logEntry.message}`;
    if (logEntry.level === 'ERROR') console.error(consoleMsg);
    else if (logEntry.level === 'WARN') console.warn(consoleMsg);
    else console.log(consoleMsg);
  }

  const logger = {
    info: (s, m, d) => logMessage('info', s, m, d),
    warn: (s, m, d) => logMessage('warn', s, m, d),
    error: (s, m, d) => logMessage('error', s, m, d),
    debug: (s, m, d) => logMessage('debug', s, m, d),
  };
  return { logger, LOG_FILE, LOG_DIR: logDir };
}

/* ============ JSON 持久化（原子写 + 损坏备份） ============ */
function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e && e.code !== 'ENOENT' && fs.existsSync(file)) {
      try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch (_) { /* 忽略 */ }
    }
    return fallback;
  }
}
function saveJSONAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/* ============ 设置校验 ============ */
function sanitizeSettings(input = {}) {
  const src = (input && typeof input === 'object') ? input : {};
  const format = String(src.defaultFormat || DEFAULT_SETTINGS.defaultFormat).toLowerCase();
  return {
    defaultFormat: VALID_OUTPUT_FORMATS.has(format) ? format : DEFAULT_SETTINGS.defaultFormat,
    defaultQuality: clampInt(src.defaultQuality, 1, 100, DEFAULT_SETTINGS.defaultQuality),
    thumbSize: clampInt(src.thumbSize, 120, 1200, DEFAULT_SETTINGS.thumbSize),
    accent: /^#[0-9a-fA-F]{6}$/.test(String(src.accent || '')) ? String(src.accent) : DEFAULT_SETTINGS.accent,
  };
}

/* ============ 图像处理管线 ============
 * 语义约定：
 *  - 裁剪坐标基于「自动校正 EXIF 方向后」的原始像素空间；
 *    前端在显示画面（旋转/翻转后）框选裁剪框时，已反向换算回该空间。
 *  - 处理顺序：自动校正方向 → 裁剪 → 水平翻转 → 垂直翻转 → 旋转 → 调整 → 缩放 → 编码。
 *  - sharp 只允许调用一次 rotate()，因此有 EXIF 方向时需要先烘焙方向再显式旋转。
 */
async function runPipeline(srcPath, opts = {}, settings = DEFAULT_SETTINGS) {
  const adjust = opts.adjust || {};
  const transform = opts.transform || {};
  const resize = opts.resize || {};
  const output = opts.output || {};

  const meta = await sharp(srcPath).metadata();
  const orientation = meta.orientation || 1;
  const angle = normalizeAngle(transform.rotate);

  let source = srcPath;
  let W = meta.width || 0;
  let H = meta.height || 0;
  if (orientation !== 1) {
    // 先烘焙方向（rotate 只允许一次），再处理显式旋转
    source = await sharp(srcPath).rotate().toBuffer();
    const bm = await sharp(source).metadata();
    W = bm.width || (orientation >= 5 ? meta.height : meta.width) || 0;
    H = bm.height || (orientation >= 5 ? meta.width : meta.height) || 0;
  }

  let img = sharp(source);

  const c = transform.crop;
  if (c && W > 0 && H > 0) {
    const cw = Math.round(Number(c.width) || 0);
    const ch = Math.round(Number(c.height) || 0);
    if (cw > 0 && ch > 0) {
      const left = Math.max(0, Math.min(Math.round(Number(c.left) || 0), W - 1));
      const top = Math.max(0, Math.min(Math.round(Number(c.top) || 0), H - 1));
      const width = Math.max(1, Math.min(cw, W - left));
      const height = Math.max(1, Math.min(ch, H - top));
      img = img.extract({ left, top, width, height });
    }
  }

  if (toBool(transform.flipH)) img = img.flop();
  if (toBool(transform.flipV)) img = img.flip();
  if (angle) img = img.rotate(angle);

  const mods = {};
  if (adjust.brightness != null) {
    const b = clampNum(adjust.brightness, 0, 3, 1);
    if (b !== 1) mods.brightness = b;
  }
  if (adjust.saturation != null) {
    const s = clampNum(adjust.saturation, 0, 3, 1);
    if (s !== 1) mods.saturation = s;
  }
  if (adjust.hue != null) {
    const h = clampNum(adjust.hue, 0, 360, 0);
    if (h !== 0) mods.hue = h;
  }
  if (Object.keys(mods).length) img = img.modulate(mods);

  if (adjust.contrast != null) {
    const a = clampNum(adjust.contrast, 0, 3, 1);
    if (a !== 1) img = img.linear(a, 128 * (1 - a));
  }
  if (toBool(adjust.grayscale)) img = img.grayscale();
  if (adjust.blur) {
    const bl = clampNum(adjust.blur, 0, 100, 0);
    if (bl > 0) img = img.blur(bl);
  }
  if (adjust.sharpen) {
    const sh = clampNum(adjust.sharpen, 0, 50, 0);
    if (sh > 0) img = img.sharpen({ sigma: sh });
  }

  if (resize.width || resize.height) {
    const rw = clampInt(resize.width, 1, 16384, 0);
    const rh = clampInt(resize.height, 1, 16384, 0);
    img = img.resize(rw || null, rh || null, { fit: 'fill' });
  }

  let fmt = String(output.format || settings.defaultFormat || 'jpeg').toLowerCase();
  if (!VALID_OUTPUT_FORMATS.has(fmt)) fmt = 'jpeg';
  const q = clampInt(output.quality || settings.defaultQuality || 82, 1, 100, 82);
  if (fmt === 'jpeg' || fmt === 'jpg') img = img.jpeg({ quality: q, mozjpeg: true });
  else if (fmt === 'png') img = img.png({ compressionLevel: 9 });
  else if (fmt === 'webp') img = img.webp({ quality: q });
  else if (fmt === 'avif') img = img.avif({ quality: q });

  const buffer = await img.toBuffer();
  return { buffer, ext: FMT_EXT[fmt] || 'jpeg' };
}

async function makeThumb(srcPath, id, thumbSize, thumbsDir) {
  const thumbPath = path.join(thumbsDir, id + '.webp');
  await sharp(srcPath)
    .rotate()
    .resize(thumbSize, thumbSize, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(thumbPath);
  return thumbPath;
}

async function buildMeta(filePath, id, original) {
  const meta = await sharp(filePath).metadata();
  const stat = await fsp.stat(filePath);
  return {
    id,
    name: String(original || '').slice(0, 200),
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

/* ---------- 抹除元数据（无损优先） ---------- */
async function stripMetadata(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    const bin = fs.readFileSync(filePath).toString('binary');
    try {
      const obj = piexif.load(bin);
      const orientation = (obj['0th'] || {})[piexif.ImageIFD.Orientation] || 1;
      // 移除全部 EXIF；若原图有方向标记则无损保留，避免图片侧躺
      let out = piexif.remove(bin);
      if (orientation !== 1) {
        out = piexif.insert(
          piexif.dump({ '0th': { [piexif.ImageIFD.Orientation]: orientation } }),
          out
        );
      }
      fs.writeFileSync(filePath, Buffer.from(out, 'binary'));
      return;
    } catch {
      fs.writeFileSync(filePath, Buffer.from(piexif.remove(bin), 'binary'));
      return;
    }
  }
  // 非 JPEG：用无损/高质量方式重编码以去掉元数据
  const meta = await sharp(filePath).metadata();
  const fmt = meta.format;
  let img = sharp(filePath).rotate();
  if (fmt === 'png') img = img.png({ compressionLevel: 9 });
  else if (fmt === 'webp') img = img.webp({ lossless: true, quality: 100 });
  else if (fmt === 'avif') img = img.avif({ lossless: true, quality: 100 });
  else if (fmt === 'gif') img = img.gif();
  else img = img.png();
  await fsp.writeFile(filePath, await img.toBuffer());
}

/* ---------- ZIP 条目名净化 ---------- */
function sanitizeZipName(name) {
  let s = String(name || 'photo')
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .replace(/^\/+/, '')
    .trim()
    .slice(0, 180);
  return s || 'photo';
}

/* ---------- PNG / WebP EXIF 写入（无损 chunk 级，不重新编码像素） ---------- */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function readPngExif(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (pos + 8 + len > buf.length) return null;
    if (type === 'eXIf') return buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IEND') return null;
    pos += 12 + len;
  }
  return null;
}

function writePngExif(buf, tiff) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const parts = [buf.subarray(0, 8)];
  let pos = 8;
  let done = false;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (data.length !== len) return null;
    if (type === 'IEND') {
      if (!done) parts.push(pngChunk('eXIf', tiff));
      parts.push(pngChunk('IEND', data));
      done = true;
      break;
    }
    parts.push(type === 'eXIf' ? pngChunk('eXIf', tiff) : pngChunk(type, data));
    if (type === 'eXIf') done = true;
    pos += 12 + len;
  }
  if (!done) return null;
  return Buffer.concat(parts);
}

function readWebpChunks(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunks = [];
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const type = buf.toString('ascii', pos, pos + 4);
    const len = buf.readUInt32LE(pos + 4);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (data.length !== len) return null;
    chunks.push({ type, data });
    pos += 8 + len + (len & 1);
  }
  return chunks;
}

function readWebpExif(buf) {
  const chunks = readWebpChunks(buf);
  if (!chunks) return null;
  const ex = chunks.find(c => c.type === 'EXIF');
  return ex ? ex.data : null;
}

function webpCanvasSize(chunk) {
  const d = chunk.data;
  if (chunk.type === 'VP8L' && d.length >= 5 && d[0] === 0x2F) {
    return {
      width: 1 + (d[1] | ((d[2] & 0x3F) << 8)),
      height: 1 + ((d[2] >> 6) | (d[3] << 2) | ((d[4] & 0x0F) << 10)),
    };
  }
  if (chunk.type === 'VP8 ' && d.length >= 10 && d[3] === 0x9D && d[4] === 0x01 && d[5] === 0x2A) {
    return {
      width: (d[6] | (d[7] << 8)) & 0x3FFF,
      height: (d[8] | (d[9] << 8)) & 0x3FFF,
    };
  }
  return null;
}

function writeWebpExif(buf, tiff) {
  const chunks = readWebpChunks(buf);
  if (!chunks) return null;
  const next = [];
  let replaced = false;
  for (const c of chunks) {
    if (c.type === 'EXIF') { next.push({ type: 'EXIF', data: tiff }); replaced = true; }
    else next.push(c);
  }
  if (!replaced) {
    const vp8x = next.find(c => c.type === 'VP8X');
    if (vp8x) {
      const nd = Buffer.from(vp8x.data);
      nd[0] = (nd[0] || 0) | 0x08; // 设置 EXIF 标志位
      const idx = next.indexOf(vp8x);
      next[idx] = { type: 'VP8X', data: nd };
    } else {
      const img = next.find(c => c.type === 'VP8 ' || c.type === 'VP8L' || c.type === 'ANIM' || c.type === 'ANMF');
      const dims = img && webpCanvasSize(img);
      if (!img || !dims) return null;
      const vp8xData = Buffer.alloc(10);
      vp8xData[0] = 0x08;
      // 画布尺寸为 24 位小端（RIFF 约定），与 libwebp 输出一致
      const cw = dims.width - 1;
      const ch = dims.height - 1;
      vp8xData[4] = cw & 0xFF; vp8xData[5] = (cw >> 8) & 0xFF; vp8xData[6] = (cw >> 16) & 0xFF;
      vp8xData[7] = ch & 0xFF; vp8xData[8] = (ch >> 8) & 0xFF; vp8xData[9] = (ch >> 16) & 0xFF;
      next.unshift({ type: 'VP8X', data: vp8xData });
    }
    // EXIF chunk 放在图像数据之后（与 libwebp/sharp 的输出顺序一致）
    next.push({ type: 'EXIF', data: tiff });
  }
  const body = [];
  for (const c of next) {
    const h = Buffer.alloc(8);
    h.write(c.type, 0, 4, 'ascii');
    h.writeUInt32LE(c.data.length, 4);
    body.push(h, c.data);
    if (c.data.length & 1) body.push(Buffer.from([0]));
  }
  const bodyBuf = Buffer.concat(body);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(4 + bodyBuf.length, 4);
  header.write('WEBP', 8, 4, 'ascii');
  return Buffer.concat([header, bodyBuf]);
}

// 从 PNG eXIf / WebP EXIF chunk 的裸 TIFF 数据加载 EXIF 对象（保留已有字段）
function loadTiffFromChunk(data) {
  if (!data) return null;
  try {
    const prefix = Buffer.from('Exif\0\0', 'binary');
    const hasPrefix = data.length >= 6 && data.subarray(0, 6).equals(prefix);
    return piexif.load(hasPrefix ? data.toString('binary') : prefix.toString('binary') + data.toString('binary'));
  } catch {
    return null;
  }
}

/* ---------- EXIF 文本标签智能解码（兼容 UTF-8 / UTF-16 / GBK） ----------
 * piexif.load 按 ASCII 逐字节读字符串，遇到 NUL 即截断；exifr 也只按 null 猜测 UTF-16，
 * 外部软件写入的 UTF-16 / GBK 中文（Windows、相机、国产图床等常见）都会读成乱码。
 * 因此文本标签直接从 TIFF 字节读取，按 BOM → 严格 UTF-8 → GBK 的顺序解码。
 */
function decodeExifText(bytes) {
  if (!bytes || !bytes.length) return '';
  let b = bytes;
  while (b.length && b[b.length - 1] === 0) b = b.subarray(0, b.length - 1); // 去掉末尾 NUL 填充
  if (!b.length) return '';
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2)).replace(/\u0000+$/, '');
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2)).replace(/\u0000+$/, '');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch { /* 非 UTF-8，继续尝试 GBK */ }
  try {
    return new TextDecoder('gbk').decode(b);
  } catch { /* 环境不支持 GBK 时按 latin1 原样返回 */ }
  return b.toString('latin1');
}

const EXIF_TEXT_TAGS_IFD0 = {
  0x010E: 'ImageDescription',
  0x010F: 'Make',
  0x0110: 'Model',
  0x0131: 'Software',
  0x013B: 'Artist',
  0x8298: 'Copyright',
};
const EXIF_TEXT_TAGS_EXIF = {
  0x9003: 'DateTimeOriginal',
};
const EXIF_TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

// 解析 TIFF 结构中的文本标签；data 可以是带 'Exif\0\0' 前缀的 chunk 数据或裸 TIFF
function readTiffTextTags(data) {
  const out = {};
  if (!data || data.length < 8) return out;
  const prefix = Buffer.from('Exif\0\0', 'binary');
  const tiff = data.length >= 6 && data.subarray(0, 6).equals(prefix) ? data.subarray(6) : data;
  if (tiff.length < 8) return out;
  const isLE = tiff[0] === 0x49 && tiff[1] === 0x49; // 'II'
  if (!isLE && !(tiff[0] === 0x4D && tiff[1] === 0x4D)) return out; // 既非 II 也非 MM
  const u16 = o => isLE ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o);
  const u32 = o => isLE ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o);
  if (u16(2) !== 42) return out;
  const readIfd = (off, tagMap) => {
    if (off < 0 || off + 2 > tiff.length) return null;
    const count = u16(off);
    const found = {};
    for (let i = 0; i < count; i++) {
      const e = off + 2 + i * 12;
      if (e + 12 > tiff.length) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const n = u32(e + 4);
      const byteLen = (EXIF_TYPE_SIZE[type] || 0) * n;
      if (!byteLen || n > 0x10000) continue;
      if (tag === 0x8769 && byteLen === 4) found.exifPtr = u32(e + 8);
      if (!tagMap[tag]) continue;
      const valueOff = byteLen <= 4 ? e + 8 : u32(e + 8);
      if (valueOff < 0 || valueOff + byteLen > tiff.length) continue;
      if (type === 2 || type === 7 || type === 1) {
        const s = decodeExifText(tiff.subarray(valueOff, valueOff + byteLen));
        if (s) found[tagMap[tag]] = s;
      }
    }
    return found;
  };
  const ifd0 = readIfd(u32(4), EXIF_TEXT_TAGS_IFD0) || {};
  Object.assign(out, ifd0);
  if (ifd0.exifPtr) Object.assign(out, readIfd(ifd0.exifPtr, EXIF_TEXT_TAGS_EXIF) || {});
  return out;
}

// 从图片文件字节中取出 EXIF 的 TIFF 段（JPEG APP1 / PNG eXIf / WebP EXIF）
function extractExifTiff(buf, ext) {
  if (ext === '.jpg' || ext === '.jpeg') {
    let pos = 2; // 跳过 SOI
    while (pos + 4 <= buf.length) {
      if (buf[pos] !== 0xFF) { pos++; continue; }
      const marker = buf[pos + 1];
      if (marker === 0xFF) { pos += 2; continue; } // 填充字节
      if (marker === 0xD8 || marker === 0xD9 || marker === 0xDA) break; // SOI/EOI/SOS
      const segLen = buf.readUInt16BE(pos + 2);
      if (segLen < 2 || pos + 2 + segLen > buf.length) break;
      if (marker === 0xE1) {
        const payload = buf.subarray(pos + 4, pos + 2 + segLen);
        if (payload.length >= 6 && payload.toString('ascii', 0, 6) === 'Exif\0\0') return payload.subarray(6);
      }
      pos += 2 + segLen;
    }
    return null;
  }
  if (ext === '.png') return readPngExif(buf);
  if (ext === '.webp') return readWebpExif(buf);
  return null;
}

/* ============ Express 应用 ============ */
function createAppServer({ port, dirs, logDir, publicDir, version = '1.0.8', isElectron = false }) {
  sharp.cache(false);
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const { logger, LOG_FILE, LOG_DIR } = createLogger(logDir);

  const DB_FILE = path.join(dirs.data, 'db.json');
  const SETTINGS_FILE = path.join(dirs.data, 'settings.json');

  let db = loadJSON(DB_FILE, { photos: [], albums: [] });
  if (!db.albums) db.albums = [];
  let nameMigrated = false;
  for (const p of db.photos) {
    if (p.stars == null) p.stars = 0;
    if (p.flag == null) p.flag = null;
    // 修复旧版本按 latin1 误存的中文文件名（仅处理可疑的乱码串，正常 Unicode 名不受影响）
    if (p.name && p.name !== fixUploadName(p.name)) {
      p.name = fixUploadName(p.name);
      nameMigrated = true;
    }
  }
  let settings = sanitizeSettings(loadJSON(SETTINGS_FILE, DEFAULT_SETTINGS));
  const persistDB = () => saveJSONAtomic(DB_FILE, db);
  if (nameMigrated) persistDB();
  const persistSettings = () => saveJSONAtomic(SETTINGS_FILE, settings);

  const DIRS = dirs;
  const app = express();

  // 请求日志中间件（必须在所有路由之前注册）
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      try {
        logger.info('backend', `${req.method} ${req.path}`, {
          status: res.statusCode,
          duration: `${Date.now() - start}ms`,
          query: Object.keys(req.query).length ? req.query : undefined,
        });
      } catch { /* 日志失败不影响响应 */ }
    });
    next();
  });

  // 同源校验：阻止恶意网页向本地服务发起跨站表单请求（CSRF）
  const allowedOrigins = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(String(origin))) {
      return res.status(403).json({ error: '跨站请求被拒绝' });
    }
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  if (publicDir) app.use(express.static(publicDir));

  const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  /* ---------- 关于 / 系统信息 ---------- */
  app.get('/api/info', (req, res) => {
    let total = 0;
    for (const p of db.photos) total += p.size || 0;
    res.json({
      name: 'Luma Studio',
      nameCN: '光影工作室',
      version,
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
    res.json([...db.photos].sort((a, b) => b.time - a.time));
  });
  app.get('/api/photos/:id', (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    res.json(p);
  });

  /* ---------- 上传（逐文件隔离 + 扩展名白名单 + 真实格式校验） ---------- */
  app.post('/api/upload', upload.array('photos'), ah(async (req, res) => {
    if (!req.files || !req.files.length) return res.status(400).json({ error: '未收到任何文件' });
    const out = [];
    const errors = [];
    for (const f of req.files) {
      let dest = null;
      let id = null;
      const original = fixUploadName(f.originalname);
      try {
        if (!IMAGE_MIME.test(f.mimetype)) {
          errors.push(`${original}: 不支持的图片类型`);
          continue;
        }
        const rawExt = String(original).split('.').pop() || '';
        const safeExt = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!ALLOWED_EXT.has(safeExt)) {
          errors.push(`${original}: 不支持的文件扩展名`);
          continue;
        }
        id = nanoid(10);
        dest = path.join(DIRS.uploads, `${id}.${safeExt}`);
        await fsp.writeFile(dest, f.buffer);
        // 以真实解码结果为准，防止伪装文件
        const realMeta = await sharp(dest).metadata();
        const realExt = FORMAT_TO_EXT[realMeta.format];
        if (!realExt) throw new Error('无法识别的图片内容');
        const finalName = `${id}.${realExt}`;
        if (finalName !== path.basename(dest)) {
          const finalPath = path.join(DIRS.uploads, finalName);
          await fsp.rename(dest, finalPath);
          dest = finalPath;
        }
        await makeThumb(dest, id, settings.thumbSize, DIRS.thumbs);
        const meta = await buildMeta(dest, id, original);
        db.photos.push(meta);
        out.push(meta);
      } catch (e) {
        if (dest) { try { await fsp.rm(dest, { force: true }); } catch { /* 忽略 */ } }
        if (id) { try { await fsp.rm(path.join(DIRS.thumbs, `${id}.webp`), { force: true }); } catch { /* 忽略 */ } }
        errors.push(`${original}: ${e.message}`);
      }
    }
    if (out.length) persistDB();
    res.json({ ok: true, added: out, errors });
  }));

  /* ---------- 删除 ---------- */
  app.delete('/api/photos/:id', ah(async (req, res) => {
    const idx = db.photos.findIndex(x => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '未找到' });
    const p = db.photos[idx];
    await fsp.rm(path.join(DIRS.uploads, p.file), { force: true });
    await fsp.rm(path.join(DIRS.thumbs, p.id + '.webp'), { force: true });
    db.photos.splice(idx, 1);
    persistDB();
    res.json({ ok: true });
  }));

  app.delete('/api/photos', ah(async (req, res) => {
    for (const p of db.photos) {
      await fsp.rm(path.join(DIRS.uploads, p.file), { force: true });
      await fsp.rm(path.join(DIRS.thumbs, p.id + '.webp'), { force: true });
    }
    db.photos = [];
    db.albums.forEach(a => a.photoIds = []);
    persistDB();
    res.json({ ok: true });
  }));

  /* ---------- EXIF 读取 ---------- */
  app.get('/api/photos/:id/exif', ah(async (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    const full = path.join(DIRS.uploads, p.file);
    try {
      const data = await exifr.parse(full, { tiff: true, exif: true, gps: true, ifd0: true }).catch(() => null) || {};
      const ext = path.extname(full).toLowerCase();
      // 文本标签统一从 TIFF 字节解析（兼容 UTF-8 / UTF-16 / GBK，piexif/exifr 对后两者常读成乱码）
      if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        try {
          const tiff = extractExifTiff(fs.readFileSync(full), ext);
          if (tiff) Object.assign(data, readTiffTextTags(tiff));
        } catch { /* 沿用 exifr 结果 */ }
      }
      res.json({ ok: true, exif: data });
    } catch {
      res.json({ ok: true, exif: {} });
    }
  }));

  /* ---------- EXIF 写入（JPEG / PNG / WebP） ---------- */
  app.post('/api/photos/:id/exif', ah(async (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    const full = path.join(DIRS.uploads, p.file);
    const ext = path.extname(full).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      return res.status(400).json({ error: 'EXIF 写入仅支持 JPEG / PNG / WebP 格式' });
    }
    const slice = v => String(v == null ? '' : v).slice(0, 255);
    const { artist, copyright, description, datetime, software } = req.body || {};
    const enc = s => Buffer.from(String(s), 'utf8').toString('latin1');
    const bin = fs.readFileSync(full);
    const binary = bin.toString('binary');
    let exifObj;
    if (ext === '.png') exifObj = loadTiffFromChunk(readPngExif(bin));
    else if (ext === '.webp') exifObj = loadTiffFromChunk(readWebpExif(bin));
    else { try { exifObj = piexif.load(binary); } catch { exifObj = null; } }
    if (!exifObj) exifObj = { '0th': {}, Exif: {}, GPS: {}, '1st': {}, thumbnail: null };
    if (artist !== undefined) exifObj['0th'][piexif.ImageIFD.Artist] = enc(slice(artist));
    if (copyright !== undefined) exifObj['0th'][piexif.ImageIFD.Copyright] = enc(slice(copyright));
    if (description !== undefined) exifObj['0th'][piexif.ImageIFD.ImageDescription] = enc(slice(description));
    if (software !== undefined) exifObj['0th'][piexif.ImageIFD.Software] = enc(slice(software));
    if (datetime !== undefined) {
      exifObj['0th'][piexif.ImageIFD.DateTime] = slice(datetime);
      exifObj['Exif'][piexif.ExifIFD.DateTimeOriginal] = slice(datetime);
    }
    if (ext === '.png') {
      const out = writePngExif(bin, Buffer.from(piexif.dump(exifObj), 'binary'));
      if (!out) return res.status(400).json({ error: 'PNG 结构无法写入 EXIF' });
      fs.writeFileSync(full, out);
    } else if (ext === '.webp') {
      const out = writeWebpExif(bin, Buffer.from(piexif.dump(exifObj), 'binary'));
      if (!out) return res.status(400).json({ error: 'WebP 结构无法写入 EXIF' });
      fs.writeFileSync(full, out);
    } else {
      fs.writeFileSync(full, Buffer.from(piexif.insert(piexif.dump(exifObj), binary), 'binary'));
    }
    res.json({ ok: true });
  }));

  /* ---------- 抹除元数据（无损） ---------- */
  app.post('/api/photos/:id/strip-exif', ah(async (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    const full = path.join(DIRS.uploads, p.file);
    await stripMetadata(full);
    Object.assign(p, await buildMeta(full, p.id, p.name));
    await makeThumb(full, p.id, settings.thumbSize, DIRS.thumbs);
    persistDB();
    res.json({ ok: true });
  }));

  /* ---------- 处理 / 导出 ---------- */
  app.post('/api/photos/:id/process', ah(async (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    const full = path.join(DIRS.uploads, p.file);
    const mode = (req.body && req.body.mode === 'overwrite') ? 'overwrite' : 'copy';
    const { buffer, ext } = await runPipeline(full, req.body, settings);
    if (mode === 'overwrite') {
      const newName = p.id + '.' + ext;
      const newPath = path.join(DIRS.uploads, newName);
      if (newName !== p.file) await fsp.rm(full, { force: true });
      await fsp.writeFile(newPath, buffer);
      Object.assign(p, await buildMeta(newPath, p.id, p.name));
      await makeThumb(newPath, p.id, settings.thumbSize, DIRS.thumbs);
      persistDB();
      return res.json({ ok: true, photo: p, mode });
    }
    const id = nanoid(10);
    const newName = id + '.' + ext;
    const newPath = path.join(DIRS.uploads, newName);
    await fsp.writeFile(newPath, buffer);
    await makeThumb(newPath, id, settings.thumbSize, DIRS.thumbs);
    const baseName = p.name.replace(/\.[^.]+$/, '');
    const meta = await buildMeta(newPath, id, `${baseName}_edited.${ext}`);
    db.photos.push(meta);
    persistDB();
    res.json({ ok: true, photo: meta, mode });
  }));

  /* ---------- 渲染下载 / 预览 ---------- */
  app.post('/api/photos/:id/render', ah(async (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    const { buffer, ext } = await runPipeline(path.join(DIRS.uploads, p.file), req.body, settings);
    const mime = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' }[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.send(buffer);
  }));

  app.post('/api/photos/:id/preview', ah(async (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    const { buffer } = await runPipeline(path.join(DIRS.uploads, p.file), req.body, settings);
    res.json({ ok: true, estimatedSize: buffer.length });
  }));

  /* ---------- 重命名 ---------- */
  app.post('/api/photos/:id/rename', (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ error: '名称不能为空' });
    p.name = name.slice(0, 200);
    persistDB();
    res.json({ ok: true, photo: p });
  });

  /* ---------- 设置（校验） ---------- */
  app.get('/api/settings', (req, res) => res.json(settings));
  app.post('/api/settings', (req, res) => {
    settings = sanitizeSettings({ ...settings, ...(req.body || {}) });
    persistSettings();
    res.json({ ok: true, settings });
  });

  /* ---------- 存储统计 ---------- */
  app.get('/api/stats', (req, res) => {
    let total = 0;
    for (const p of db.photos) total += p.size || 0;
    res.json({ count: db.photos.length, totalSize: total, thumbSize: settings.thumbSize });
  });

  /* ---------- 评分 / 标记 ---------- */
  app.post('/api/photos/:id/stars', (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    p.stars = clampInt(req.body && req.body.stars, 0, 5, 0);
    persistDB();
    res.json({ ok: true, stars: p.stars });
  });

  app.post('/api/photos/:id/flag', (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    const f = req.body && req.body.flag;
    p.flag = (f === 'pick' || f === 'reject') ? f : null;
    persistDB();
    res.json({ ok: true, flag: p.flag });
  });

  /* ---------- 相册 ---------- */
  app.get('/api/albums', (req, res) => {
    res.json(db.albums.map(a => ({
      ...a,
      count: (a.photoIds || []).filter(id => db.photos.some(p => p.id === id)).length,
    })));
  });
  app.post('/api/albums', (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();
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
    a.name = String((req.body && req.body.name) || '').trim().slice(0, 100);
    persistDB();
    res.json({ ok: true, album: a });
  });
  app.post('/api/albums/:id/add', (req, res) => {
    const a = db.albums.find(x => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: '未找到相册' });
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [(req.body && req.body.ids)];
    for (const id of ids) {
      if (db.photos.some(p => p.id === id) && !a.photoIds.includes(id)) a.photoIds.push(id);
    }
    persistDB();
    res.json({ ok: true, count: a.photoIds.length });
  });
  app.post('/api/albums/:id/remove', (req, res) => {
    const a = db.albums.find(x => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: '未找到相册' });
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [(req.body && req.body.ids)];
    a.photoIds = a.photoIds.filter(id => !ids.includes(id));
    persistDB();
    res.json({ ok: true, count: a.photoIds.length });
  });

  /* ---------- 批量操作 ---------- */
  app.post('/api/photos/batch/stars', (req, res) => {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
    const s = clampInt(req.body && req.body.stars, 0, 5, 0);
    let n = 0;
    for (const id of ids) {
      const p = db.photos.find(x => x.id === id);
      if (p) { p.stars = s; n++; }
    }
    persistDB();
    res.json({ ok: true, updated: n, stars: s });
  });

  app.post('/api/photos/batch/flag', (req, res) => {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
    const f = (req.body && req.body.flag === 'pick' || req.body && req.body.flag === 'reject') ? req.body.flag : null;
    let n = 0;
    for (const id of ids) {
      const p = db.photos.find(x => x.id === id);
      if (p) { p.flag = f; n++; }
    }
    persistDB();
    res.json({ ok: true, updated: n, flag: f });
  });

  app.post('/api/photos/batch/delete', ah(async (req, res) => {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
    let n = 0;
    for (const id of ids) {
      const idx = db.photos.findIndex(x => x.id === id);
      if (idx === -1) continue;
      const p = db.photos[idx];
      await fsp.rm(path.join(DIRS.uploads, p.file), { force: true });
      await fsp.rm(path.join(DIRS.thumbs, p.id + '.webp'), { force: true });
      db.photos.splice(idx, 1);
      n++;
      for (const a of db.albums) a.photoIds = a.photoIds.filter(i => i !== id);
    }
    persistDB();
    res.json({ ok: true, deleted: n });
  }));

  /* ---------- 批量下载 ZIP（条目名净化） ---------- */
  app.post('/api/photos/download-zip', (req, res) => {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
    const photos = ids.map(id => db.photos.find(p => p.id === id)).filter(Boolean);
    if (!photos.length) return res.status(400).json({ error: '未选择照片' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="LumaStudio_export.zip"');
    const zip = new ZipFile();
    zip.outputStream.pipe(res);
    const used = new Set();
    for (const p of photos) {
      let base = sanitizeZipName(p.name || p.file);
      if (used.has(base)) {
        const ext = path.extname(base);
        const stem = ext ? base.slice(0, -ext.length) : base;
        let i = 2;
        while (used.has(`${stem}_${i}${ext}`)) i++;
        base = `${stem}_${i}${ext}`;
      }
      used.add(base);
      zip.addFile(path.join(DIRS.uploads, p.file), base);
    }
    zip.end();
  });

  /* ---------- 搜索 ---------- */
  app.get('/api/search', (req, res) => {
    let list = [...db.photos];
    const { q, stars, flag, album, format, sort } = req.query;
    if (q) {
      const lower = String(q).toLowerCase();
      list = list.filter(p => String(p.name).toLowerCase().includes(lower));
    }
    if (stars) list = list.filter(p => p.stars === Number(stars));
    if (flag === 'pick') list = list.filter(p => p.flag === 'pick');
    else if (flag === 'reject') list = list.filter(p => p.flag === 'reject');
    else if (flag === 'flagged') list = list.filter(p => p.flag);
    if (format) list = list.filter(p => String(p.format || '').toLowerCase() === String(format).toLowerCase());
    if (album) {
      const a = db.albums.find(x => x.id === album);
      if (a) list = list.filter(p => a.photoIds.includes(p.id));
    }
    if (sort === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    else if (sort === 'name_desc') list.sort((a, b) => String(b.name).localeCompare(String(a.name)));
    else if (sort === 'size') list.sort((a, b) => (a.size || 0) - (b.size || 0));
    else if (sort === 'size_desc') list.sort((a, b) => (b.size || 0) - (a.size || 0));
    else if (sort === 'stars') list.sort((a, b) => (b.stars || 0) - (a.stars || 0));
    else if (sort === 'oldest') list.sort((a, b) => a.time - b.time);
    else list.sort((a, b) => b.time - a.time);
    res.json(list);
  });

  /* ---------- 日志 API ---------- */
  app.get('/api/logs', (req, res) => {
    try {
      if (!fs.existsSync(LOG_FILE)) return res.json({ logs: [], total: 0 });
      const { level, source } = req.query;
      const limit = clampInt(req.query.limit, 1, 5000, 100);
      const content = fs.readFileSync(LOG_FILE, 'utf8');
      let logs = content.trim().split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      if (level) logs = logs.filter(l => String(l.level).toLowerCase() === String(level).toLowerCase());
      if (source) logs = logs.filter(l => String(l.source).toLowerCase() === String(source).toLowerCase());
      const matched = logs.length;
      logs = logs.slice(-limit).reverse();
      res.json({ logs, total: logs.length, matched, logDir: LOG_DIR, logFile: LOG_FILE });
    } catch (e) {
      logger.error('backend', '读取日志失败', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/logs/clear', (req, res) => {
    try {
      if (fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '', 'utf8');
      // 同时清理轮转备份
      for (const f of fs.readdirSync(LOG_DIR).filter(f => /^app-\d+\.log$/.test(f))) {
        fs.unlinkSync(path.join(LOG_DIR, f));
      }
      logger.info('backend', '日志已清空');
      res.json({ ok: true });
    } catch (e) {
      logger.error('backend', '清空日志失败', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/logs/info', (req, res) => {
    res.json({ logDir: LOG_DIR, logFile: LOG_FILE, isElectron, logDirName: isElectron ? 'log' : 'log' });
  });

  app.post('/api/logs/frontend', (req, res) => {
    const allowed = new Set(['info', 'warn', 'error', 'debug']);
    const level = allowed.has(req.body && req.body.level) ? req.body.level : 'info';
    const message = String((req.body && req.body.message) || '').slice(0, 1000);
    if (message) logger[level]('frontend', message, req.body && req.body.data);
    res.json({ ok: true });
  });

  /* ---------- 统一错误处理 ---------- */
  app.use((err, req, res, next) => {
    logger.error('backend', '未处理的请求错误', {
      path: req.path,
      message: err && err.message,
    });
    if (res.headersSent) return next(err);
    res.status(500).json({ error: (err && err.message) || '服务器内部错误' });
  });

  logger.info('system', 'Luma Studio 应用初始化完成', { version, isElectron });
  return { app, logger, getDb: () => db, getSettings: () => settings };
}

module.exports = {
  createAppServer,
  runPipeline,
  stripMetadata,
  sanitizeSettings,
  sanitizeZipName,
  normalizeAngle,
  readPngExif,
  writePngExif,
  readWebpChunks,
  readWebpExif,
  writeWebpExif,
  decodeExifText,
  readTiffTextTags,
  extractExifTiff,
  fixUploadName,
  DEFAULT_SETTINGS,
};
