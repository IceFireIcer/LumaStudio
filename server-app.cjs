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
const crypto = require('crypto');

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
  autoAdvance: true,
  theme: 'light',
  reduceMotion: 'system',
  slideshowInterval: 3,
  logsRefreshInterval: 3, // v1.2.1：日志页自动刷新间隔（秒）
};
const VALID_THEMES = new Set(['light', 'dark']);
const VALID_REDUCE_MOTION = new Set(['system', 'on', 'off']);
const VALID_SLIDESHOW_INTERVALS = new Set([3, 5, 10]);
const VALID_LOGS_REFRESH_INTERVALS = new Set([3, 10, 30]);
const MAX_LOG_SIZE = 10 * 1024 * 1024;
const MAX_LOG_BACKUPS = 3;

/* ============ 工具 ============ */
// 数值安全裁剪：非有限数回退默认值，再将结果夹在 [min, max] 区间
function clampNum(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
// 数值安全裁剪并取整（用于评分、像素尺寸等整数参数）
function clampInt(v, min, max, dflt) {
  return Math.round(clampNum(v, min, max, dflt));
}
// 宽松布尔转换：接受 true / 1 / '1' / 'true'
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
// 本地时间格式化为 YYYY-MM-DD HH:mm:ss.mmm（日志时间戳）
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
// 读取 JSON 文件；解析失败（且文件存在）时把损坏文件改名为 .corrupt-* 留档，返回 fallback
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
// 原子写 JSON：先写临时文件再 rename，避免写一半崩溃留下损坏文件
function saveJSONAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/* ============ 文件级写锁（v1.2.1 多开支持） ============
 * 多开实例共享同一数据目录时，防止 db.json / drafts.json / settings.json 双写互相覆盖。
 * 锁文件 `<file>.lock` 以原子方式（'wx'）创建，内容含 pid 与时间戳；
 * 残留锁判定：超过 30s 视为过期可接管，或 pid 已不存在可接管。
 */
const LOCK_TIMEOUT_MS = 30 * 1000;
function acquireWriteLock(file) {
  const lockFile = file + '.lock';
  try {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, time: Date.now() }));
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      let stale = false;
      try {
        const info = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        if (Date.now() - (info.time || 0) > LOCK_TIMEOUT_MS) stale = true;
        else if (info.pid && info.pid !== process.pid) {
          try { process.kill(info.pid, 0); } catch { stale = true; } // 目标进程已退出
        }
      } catch { stale = true; } // 锁文件内容异常视为残留
      if (stale) {
        try { fs.unlinkSync(lockFile); } catch { /* 忽略 */ }
        return acquireWriteLock(file); // 接管后重试一次
      }
    }
    return false;
  }
}
function releaseWriteLock(file) {
  try { fs.unlinkSync(file + '.lock'); } catch { /* 忽略 */ }
}
class LumaWriteConflict extends Error {
  constructor(file) {
    super(`另一实例正在写入 ${path.basename(file)}，请稍后重试`);
    this.lumaWriteConflict = true;
  }
}
function persistWithLock(file, data) {
  if (!acquireWriteLock(file)) throw new LumaWriteConflict(file);
  try {
    saveJSONAtomic(file, data);
  } finally {
    releaseWriteLock(file);
  }
}

/* ============ 设置校验 ============ */
// 标签净化：输入可以是字符串数组或逗号分隔字符串（支持中英文逗号/顿号/空白分隔）。
// 每项 trim、合并连续空白、去重、限长 50 字符、最多 20 个；非法输入返回空数组。
// 标签直接挂在 photo.tags 上，删除照片即随之消失，无需维护全局标签表（零孤儿数据）。
function sanitizeTags(input) {
  const arr = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,，、\s]+/)
      : [];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const t = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ').slice(0, 50);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 20) break;
  }
  return out;
}

// 设置净化：仅保留白名单字段并对每个字段做类型/取值范围校验，非法值回退默认设置
function sanitizeSettings(input = {}) {
  const src = (input && typeof input === 'object') ? input : {};
  const format = String(src.defaultFormat || DEFAULT_SETTINGS.defaultFormat).toLowerCase();
  return {
    defaultFormat: VALID_OUTPUT_FORMATS.has(format) ? format : DEFAULT_SETTINGS.defaultFormat,
    defaultQuality: clampInt(src.defaultQuality, 1, 100, DEFAULT_SETTINGS.defaultQuality),
    thumbSize: clampInt(src.thumbSize, 120, 1200, DEFAULT_SETTINGS.thumbSize),
    accent: /^#[0-9a-fA-F]{6}$/.test(String(src.accent || '')) ? String(src.accent) : DEFAULT_SETTINGS.accent,
    autoAdvance: src.autoAdvance == null ? DEFAULT_SETTINGS.autoAdvance : toBool(src.autoAdvance),
    theme: VALID_THEMES.has(String(src.theme)) ? String(src.theme) : DEFAULT_SETTINGS.theme,
    reduceMotion: VALID_REDUCE_MOTION.has(String(src.reduceMotion)) ? String(src.reduceMotion) : DEFAULT_SETTINGS.reduceMotion,
    slideshowInterval: VALID_SLIDESHOW_INTERVALS.has(Number(src.slideshowInterval))
      ? Number(src.slideshowInterval) : DEFAULT_SETTINGS.slideshowInterval,
    logsRefreshInterval: VALID_LOGS_REFRESH_INTERVALS.has(Number(src.logsRefreshInterval))
      ? Number(src.logsRefreshInterval) : DEFAULT_SETTINGS.logsRefreshInterval,
  };
}

/* ============ 图像处理管线 ============
 * 语义约定：
 *  - 裁剪坐标基于「自动校正 EXIF 方向后」的原始像素空间；
 *    前端在显示画面（旋转/翻转后）框选裁剪框时，已反向换算回该空间。
 *  - 处理顺序：自动校正方向 → 裁剪 → 水平翻转 → 垂直翻转 → 旋转 → 调整 → 缩放 → 编码。
 *  - sharp 只允许调用一次 rotate()，因此有 EXIF 方向时需要先烘焙方向再显式旋转。
 */
async function runPipeline(srcPath, opts = {}, settings = DEFAULT_SETTINGS, onWarn = null) {
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
  // v1.2 新参数：色温（正=暖/琥珀，负=冷/蓝）与色调（正=品红，负=绿）用 recomb 矩阵近似
  if (adjust.temperature != null || adjust.tint != null) {
    const t = clampNum(adjust.temperature, -100, 100, 0);
    const n = clampNum(adjust.tint, -100, 100, 0);
    if ((t !== 0 || n !== 0) && meta.channels >= 3 && meta.space !== 'cmyk') {
      const r = 1 + t * 0.0012 + n * 0.001;
      const g = 1 - n * 0.0012;
      const b = 1 - t * 0.0012 + n * 0.001;
      const matrix = [[r, 0, 0], [0, g, 0], [0, 0, b]];
      if (meta.channels >= 4) {
        // RGBA：recomb 只接受 3 通道，先拆 alpha，重组后再拼回
        const alpha = img.extractChannel(3);
        img = img.removeAlpha().recomb(matrix).joinChannel(alpha);
      } else {
        img = img.recomb(matrix);
      }
    }
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

  let buffer = await img.toBuffer();

  // v1.2 新参数：暗角（径向渐变蒙版 multiply）与颗粒（噪声 overlay），
  // 在最终尺寸上叠加，避免依赖链式 resize 的尺寸推断。
  const vig = adjust.vignette != null ? clampNum(adjust.vignette, 0, 100, 0) : 0;
  const grain = adjust.grain != null ? clampNum(adjust.grain, 0, 100, 0) : 0;
  if (vig > 0 || grain > 0) {
    try {
      const m = await sharp(buffer).metadata();
      const layers = [];
      if (vig > 0) {
        const strength = vig / 100;
        const opacity = (0.5 * strength + 0.12).toFixed(3);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}">` +
          `<defs><radialGradient id="v" cx="50%" cy="50%" r="72%">` +
          `<stop offset="42%" stop-color="#000" stop-opacity="0"/>` +
          `<stop offset="100%" stop-color="#000" stop-opacity="${opacity}"/>` +
          `</radialGradient></defs><rect width="100%" height="100%" fill="url(#v)"/></svg>`;
        layers.push({ input: Buffer.from(svg), blend: 'multiply' });
      }
      if (grain > 0) {
        const alpha = ((grain / 100) * 0.28).toFixed(3);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}">` +
          `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>` +
          `<feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${alpha} 0"/>` +
          `</filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
        layers.push({ input: Buffer.from(svg), blend: 'overlay' });
      }
      let out = sharp(buffer).composite(layers);
      if (fmt === 'jpeg' || fmt === 'jpg') out = out.toFormat('jpeg', { quality: q, mozjpeg: true });
      else if (fmt === 'png') out = out.toFormat('png', { compressionLevel: 9 });
      else if (fmt === 'webp') out = out.toFormat('webp', { quality: q });
      else if (fmt === 'avif') out = out.toFormat('avif', { quality: q });
      buffer = await out.toBuffer();
    } catch (e) {
      // 叠加失败（如单通道灰度图）时回退未叠加结果，不阻断处理
      const warn = onWarn || console.warn.bind(console);
      warn(`[Luma] 暗角/颗粒叠加失败，已回退原图: ${e && e.message}`);
    }
  }

  return { buffer, ext: FMT_EXT[fmt] || 'jpeg' };
}

// 生成 WebP 缩略图：按 EXIF 方向旋转后等比缩放进 thumbSize 方形内（不放大），存 <id>.webp
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
  // 缩略图生成（makeThumb）已按 EXIF 方向旋转，这里同样保存旋转后的显示尺寸，
  // 否则竖拍照片（orientation 5-8）入库宽高与缩略图比例不一致，
  // 前端瀑布流按错误比例排版会导致卡片重叠、点击图片命中错误目标。
  const orientation = meta.orientation || 1;
  const rotated = orientation >= 5;
  return {
    id,
    name: String(original || '').slice(0, 200),
    file: path.basename(filePath),
    format: meta.format,
    width: rotated ? meta.height : meta.width,
    height: rotated ? meta.width : meta.height,
    size: stat.size,
    time: Date.now(),
    stars: 0,
    flag: null,
    tags: [],
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
// CRC-32 校验：PNG chunk 写入时计算校验和（表驱动，懒初始化查找表）
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

// 组装单个 PNG chunk：长度(4B BE) + 类型(4B ASCII) + 数据 + CRC-32
function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

// 从 PNG 字节中取出 eXIf chunk 数据；无 eXIf 或已到 IEND 返回 null
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

// 写入 PNG EXIF：将 tiff 数据放进 eXIf chunk（插在 IEND 前），已存在则替换，返回新 PNG 字节
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

// 解析 WebP 文件为 chunk 列表（RIFF 结构，含奇数字节 padding 处理）
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

// 从 WebP chunk 列表中取出 EXIF chunk 数据；不存在返回 null
function readWebpExif(buf) {
  const chunks = readWebpChunks(buf);
  if (!chunks) return null;
  const ex = chunks.find(c => c.type === 'EXIF');
  return ex ? ex.data : null;
}

// 从 VP8 / VP8L 图像 chunk 中解析画布尺寸（新建 VP8X 时需要）
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

// 写入 WebP EXIF：替换已有 EXIF chunk；无则新建 VP8X（设 EXIF 标志 + 画布尺寸）并把 EXIF 追加在图像数据后
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
function createAppServer({ port, dirs, logDir, publicDir, version = '1.3.1', isElectron = false, requireToken = null }) {
  // sharp 缓存策略：Windows 上禁用内部缓存避免文件句柄锁定（历史问题，保持现状）；
  // 其他平台启用默认缓存，重复解码同图时提升性能（v1.2.1 权衡后仅按平台差异处理）。
  if (process.platform === 'win32') sharp.cache(false);
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const { logger, LOG_FILE, LOG_DIR } = createLogger(logDir);

  const DB_FILE = path.join(dirs.data, 'db.json');
  const SETTINGS_FILE = path.join(dirs.data, 'settings.json');
  const DRAFTS_FILE = path.join(dirs.data, 'drafts.json');
  const JOBS_FILE = path.join(dirs.data, 'jobs.json'); // v1.2.1：批量任务状态落盘，重启可恢复
  const DRAFT_MAX_BYTES = 8 * 1024;   // 单条草稿 ≤ 8KB
  const DRAFT_MAX_COUNT = 1000;       // 草稿总数 ≤ 1000，超限清 updatedAt 最旧

  let db = loadJSON(DB_FILE, { photos: [], albums: [] });
  if (!db.albums) db.albums = [];
  let drafts = loadJSON(DRAFTS_FILE, {});
  let nameMigrated = false;
  for (const p of db.photos) {
    if (p.stars == null) p.stars = 0;
    if (p.flag == null) p.flag = null;
    if (!Array.isArray(p.tags)) p.tags = sanitizeTags(p.tags);
    // 修复旧版本按 latin1 误存的中文文件名（仅处理可疑的乱码串，正常 Unicode 名不受影响）
    if (p.name && p.name !== fixUploadName(p.name)) {
      p.name = fixUploadName(p.name);
      nameMigrated = true;
    }
  }
  // 本地访问令牌：首启生成随机 token 存 settings.json，
  // 防止本机其他进程 / 恶意网页绕过浏览器同源策略直接调用写 API。
  const rawSettings = loadJSON(SETTINGS_FILE, DEFAULT_SETTINGS);
  const isFirstRun = !rawSettings.authToken;
  if (isFirstRun) rawSettings.authToken = crypto.randomBytes(32).toString('hex');
  let settings = sanitizeSettings(rawSettings);
  const persistDB = () => persistWithLock(DB_FILE, db);
  const persistDrafts = () => persistWithLock(DRAFTS_FILE, drafts);
  if (nameMigrated) persistDB();
  const persistSettings = () => persistWithLock(SETTINGS_FILE, { ...settings, authToken: rawSettings.authToken });
  // 首启生成令牌：直接原子写，避免锁竞争（此刻无其他实例）
  if (isFirstRun) saveJSONAtomic(SETTINGS_FILE, { ...settings, authToken: rawSettings.authToken });
  // 批量任务专用：锁冲突时短暂重试（其他实例写锁通常很快释放），避免整张照片被误判为失败
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const persistDBWithRetry = async (retries = 3, delay = 200) => {
    for (let i = 0; i < retries; i++) {
      try { persistDB(); return; }
      catch (e) {
        if (!e || !e.lumaWriteConflict || i === retries - 1) throw e;
        await sleep(delay);
      }
    }
  };
  // 管线运行包装：暗角/颗粒叠加失败等告警进后端日志页，便于排查
  const runPipelineLogged = (src, opts, stt) =>
    runPipeline(src, opts, stt, msg => logger.warn('backend', msg));

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

  // 本地 Token 校验：写请求必须携带 X-Luma-Token
  //（仅 Electron 生产场景或显式 requireToken 时启用；测试/冒烟默认关闭，避免破坏既有用例）
  const TOKEN_ENABLED = requireToken == null ? isElectron : requireToken;
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (!TOKEN_ENABLED) return next();
    if (req.headers['x-luma-token'] !== rawSettings.authToken) {
      return res.status(401).json({ error: '访问令牌无效，请重新打开应用' });
    }
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  if (publicDir) app.use(express.static(publicDir));

  const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  /* ---------- 关于 / 系统信息 ---------- */
  // 应用信息：版本、Node/sharp 版本、照片统计、运行时长、进程信息（关于页）
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

  // 原图文件服务：路径净化（仅取 basename 防目录穿越）；带 download=1 时以下载方式返回
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
  // 全部照片列表（按上传时间倒序）
  app.get('/api/photos', (req, res) => {
    res.json([...db.photos].sort((a, b) => b.time - a.time));
  });

  /* ---------- 标签云 ---------- */
  // 全库标签统计：按使用数降序、名称升序返回 [{ name, count }]（填充工具栏筛选下拉）
  app.get('/api/tags', (req, res) => {
    const counts = new Map();
    for (const p of db.photos) {
      for (const t of (p.tags || [])) counts.set(t, (counts.get(t) || 0) + 1);
    }
    // 按使用数降序、名称升序排列
    const tags = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), 'zh'));
    res.json({ tags });
  });

  /* ---------- 批量操作 ----------
   * 必须注册在 /api/photos/:id 系列路由之前：否则 'batch' 会被当作 id 吞掉，
   * 批量端点永远命中单张照片路由并返回 404。
   */
  // 批量评分：对 ids 中的照片统一设置评分 0-5
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

  // 批量标记精选/排除：flag = pick | reject，其他值清除标记
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

  // 批量标签：mode = set（替换为给定集合）| add（合并追加）| remove（移除）
  app.post('/api/photos/batch/tags', (req, res) => {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
    const tags = sanitizeTags(req.body && req.body.tags);
    const mode = (['set', 'add', 'remove'].includes(req.body && req.body.mode)) ? req.body.mode : 'add';
    let n = 0;
    for (const id of ids) {
      const p = db.photos.find(x => x.id === id);
      if (!p) continue;
      if (mode === 'set') p.tags = [...tags];
      else if (mode === 'add') {
        const cur = p.tags || [];
        p.tags = [...new Set([...cur, ...tags])];
      } else { // remove
        p.tags = (p.tags || []).filter(t => !tags.includes(t));
      }
      n++;
    }
    persistDB();
    res.json({ ok: true, updated: n, mode, tags });
  });

  // 批量删除：删原图 + 缩略图，并从所有相册中移除引用
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

  // 批量处理：创建后台任务（mode=overwrite 覆盖原图 / copy 另存副本），返回 jobId 供轮询
  app.post('/api/photos/batch/process', (req, res) => {
    const body = req.body || {};
    const ids = Array.isArray(body.ids)
      ? body.ids.filter(x => typeof x === 'string' && x).slice(0, 500)
      : [];
    if (!ids.length) return res.status(400).json({ error: '未选择照片' });
    const mode = body.mode === 'overwrite' ? 'overwrite' : 'copy';
    const pipeline = (body.pipeline && typeof body.pipeline === 'object') ? body.pipeline : {};
    const job = createJob('batch-process', { ids, pipeline, mode });
    runBatchJob(job);
    logger.info('backend', '批量处理任务已创建', { job: job.id, total: job.total, mode });
    res.json({ ok: true, jobId: job.id, total: job.total });
  });

  // 单张照片详情
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
  // 删除单张照片：删原图 + 缩略图，并从所有相册中移除引用
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

  // 清空全部照片：删所有原图 + 缩略图，并清空所有相册引用
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
  // 读取照片 EXIF：JPEG 走 exifr 直接解析；PNG/WebP 从 chunk 取 TIFF 后解析；
  // 文本标签统一走 readTiffTextTags（兼容 UTF-8/UTF-16/GBK），解析失败返回空对象
  app.get('/api/photos/:id/exif', ah(async (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    const full = path.join(DIRS.uploads, p.file);
    try {
      const ext = path.extname(full).toLowerCase();
      const tiff = extractExifTiff(fs.readFileSync(full), ext);
      let data = {};
      if (ext === '.png' || ext === '.webp') {
        // exifr 的 Node 版不解析 WebP EXIF，PNG eXIf 也不稳；从 chunk 取出 TIFF、
        // 剥离 'Exif\0\0' 前缀后交给 exifr，得到与 JPEG 一致的命名结果（相机/拍摄参数/GPS）
        if (tiff) {
          const prefix = Buffer.from('Exif\0\0', 'binary');
          const bare = tiff.length >= 6 && tiff.subarray(0, 6).equals(prefix) ? tiff.subarray(6) : tiff;
          data = await exifr.parse(bare, { tiff: true, exif: true, gps: true, ifd0: true }).catch(() => null) || {};
        }
      } else {
        data = await exifr.parse(full, { tiff: true, exif: true, gps: true, ifd0: true }).catch(() => null) || {};
      }
      // 文本标签统一从 TIFF 字节解析（兼容 UTF-8 / UTF-16 / GBK，piexif/exifr 对后两者常读成乱码）
      if (tiff) {
        try {
          Object.assign(data, readTiffTextTags(tiff));
        } catch { /* 沿用 exifr 结果 */ }
      }
      res.json({ ok: true, exif: data });
    } catch {
      res.json({ ok: true, exif: {} });
    }
  }));

  /* ---------- EXIF 写入（JPEG / PNG / WebP） ---------- */
  // 写入可编辑字段（作者/版权/描述/软件/拍摄时间）：JPEG 用 piexif 插入，PNG/WebP 无损 chunk 级写入
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
    let tiffData;
    try {
      tiffData = Buffer.from(piexif.dump(exifObj), 'binary');
    } catch {
      return res.status(400).json({ error: 'EXIF 内容无法序列化，原文件未改动' });
    }
    if (ext === '.png') {
      const out = writePngExif(bin, tiffData);
      if (!out) return res.status(400).json({ error: '该 PNG 变体不支持写入 EXIF，原文件未改动' });
      fs.writeFileSync(full, out);
    } else if (ext === '.webp') {
      const out = writeWebpExif(bin, tiffData);
      if (!out) return res.status(400).json({ error: '该 WebP 变体（如动画/损坏文件）不支持写入 EXIF，原文件未改动' });
      fs.writeFileSync(full, out);
    } else {
      fs.writeFileSync(full, Buffer.from(piexif.insert(tiffData.toString('binary'), binary), 'binary'));
    }
    res.json({ ok: true });
  }));

  /* ---------- 抹除元数据（无损） ---------- */
  // 抹除全部 EXIF：JPEG 无损剥离（保留方向标记防侧躺），其他格式重编码；随后重建元数据与缩略图
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
  // 处理并保存：mode=overwrite 覆盖原图 / copy 另存新副本；返回处理后的照片记录
  app.post('/api/photos/:id/process', ah(async (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    const full = path.join(DIRS.uploads, p.file);
    const mode = (req.body && req.body.mode === 'overwrite') ? 'overwrite' : 'copy';
    const { buffer, ext } = await runPipelineLogged(full, req.body, settings);
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
  // 渲染下载：按编辑参数处理后直接返回图片字节（不落库）
  app.post('/api/photos/:id/render', ah(async (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    const { buffer, ext } = await runPipelineLogged(path.join(DIRS.uploads, p.file), req.body, settings);
    const mime = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' }[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.send(buffer);
  }));

  // 预览估算：处理但不返回图片，仅给出结果字节大小（编辑器「预计大小」）
  app.post('/api/photos/:id/preview', ah(async (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    const { buffer } = await runPipelineLogged(path.join(DIRS.uploads, p.file), req.body, settings);
    res.json({ ok: true, estimatedSize: buffer.length });
  }));

  /* ---------- 重命名 ---------- */
  // 重命名照片显示名称（仅改库中 name，不改物理文件名）
  app.post('/api/photos/:id/rename', (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ error: '名称不能为空' });
    p.name = name.slice(0, 200);
    persistDB();
    res.json({ ok: true, photo: p });
  });

  /* ---------- 编辑草稿（v1.2 §3.4.3：单快照草稿，非版本链） ---------- */
  // 读取某照片的已保存草稿；无草稿返回 404
  app.get('/api/photos/:id/draft', (req, res) => {
    const d = drafts[req.params.id];
    if (!d) return res.status(404).json({ error: '无草稿' });
    res.json({ ok: true, draft: d });
  });
  // 保存草稿（覆盖式）：写入 adjust/transform/resize/output 快照，超 8KB 或超 1000 条时按最旧清理
  app.put('/api/photos/:id/draft', (req, res) => {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const draft = {
      adjust: body.adjust && typeof body.adjust === 'object' ? body.adjust : {},
      transform: body.transform && typeof body.transform === 'object' ? body.transform : {},
      resize: body.resize && typeof body.resize === 'object' ? body.resize : {},
      output: body.output && typeof body.output === 'object' ? body.output : {},
      updatedAt: Date.now(),
    };
    if (Buffer.byteLength(JSON.stringify(draft), 'utf8') > DRAFT_MAX_BYTES) {
      return res.status(400).json({ error: '草稿超过 8KB 上限' });
    }
    drafts[req.params.id] = draft;
    const keys = Object.keys(drafts);
    if (keys.length > DRAFT_MAX_COUNT) {
      const sorted = keys.sort((a, b) => (drafts[a].updatedAt || 0) - (drafts[b].updatedAt || 0));
      for (const k of sorted.slice(0, keys.length - DRAFT_MAX_COUNT)) delete drafts[k];
    }
    persistDrafts();
    res.json({ ok: true, draft });
  });
  // 删除草稿（导出成功或用户重置时调用）
  app.delete('/api/photos/:id/draft', (req, res) => {
    delete drafts[req.params.id];
    persistDrafts();
    res.json({ ok: true });
  });

  /* ---------- 设置（校验） ---------- */
  // 读取当前设置（不含本地访问令牌）
  app.get('/api/settings', (req, res) => res.json(settings));
  // 更新设置：合并传入字段后整体净化落盘
  app.post('/api/settings', (req, res) => {
    settings = sanitizeSettings({ ...settings, ...(req.body || {}) });
    persistSettings();
    res.json({ ok: true, settings });
  });

  /* ---------- 本地访问令牌（重置；需持旧令牌通过校验） ---------- */
  app.post('/api/auth/reset-token', (req, res) => {
    if (!TOKEN_ENABLED) return res.status(400).json({ error: '令牌校验未启用' });
    rawSettings.authToken = crypto.randomBytes(32).toString('hex');
    persistSettings();
    res.json({ ok: true, token: rawSettings.authToken });
  });

  /* ---------- 存储统计 ---------- */
  // 存储统计：照片数、总占用、缩略图尺寸、数据目录路径（设置页展示）
  app.get('/api/stats', (req, res) => {
    let total = 0;
    for (const p of db.photos) total += p.size || 0;
    res.json({
      count: db.photos.length,
      totalSize: total,
      thumbSize: settings.thumbSize,
      dataDir: dirs.data || null,
    });
  });

  /* ---------- 评分 / 标记 ---------- */
  // 单张评分：设置 0-5 星
  app.post('/api/photos/:id/stars', (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    p.stars = clampInt(req.body && req.body.stars, 0, 5, 0);
    persistDB();
    res.json({ ok: true, stars: p.stars });
  });

  // 单张标记精选/排除：flag = pick | reject，其他值清除标记
  app.post('/api/photos/:id/flag', (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    const f = req.body && req.body.flag;
    p.flag = (f === 'pick' || f === 'reject') ? f : null;
    persistDB();
    res.json({ ok: true, flag: p.flag });
  });

  // 单张标签：全量替换（数组或逗号分隔字符串均可，sanitizeTags 统一净化）
  app.post('/api/photos/:id/tags', (req, res) => {
    const p = db.photos.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: '未找到' });
    p.tags = sanitizeTags(req.body && req.body.tags);
    persistDB();
    res.json({ ok: true, tags: p.tags });
  });

  /* ---------- 相册 ---------- */
  // 相册列表：附带有效照片数 count 与首图封面 id（已删除的照片自动从引用中剔除）
  app.get('/api/albums', (req, res) => {
    res.json(db.albums.map(a => {
      const ids = (a.photoIds || []).filter(id => db.photos.some(p => p.id === id));
      return { ...a, count: ids.length, cover: ids.length ? ids[0] : null };
    }));
  });
  // 新建相册（名称必填，最长 100 字）
  app.post('/api/albums', (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ error: '名称不能为空' });
    const album = { id: nanoid(10), name: name.slice(0, 100), photoIds: [], time: Date.now() };
    db.albums.push(album);
    persistDB();
    res.json({ ok: true, album });
  });
  // 删除相册（仅删引用，不删照片）
  app.delete('/api/albums/:id', (req, res) => {
    db.albums = db.albums.filter(a => a.id !== req.params.id);
    persistDB();
    res.json({ ok: true });
  });
  // 重命名相册
  app.post('/api/albums/:id/rename', (req, res) => {
    const a = db.albums.find(x => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: '未找到' });
    a.name = String((req.body && req.body.name) || '').trim().slice(0, 100);
    persistDB();
    res.json({ ok: true, album: a });
  });
  // 向相册添加照片（ids 数组，已存在/不存在的 id 自动跳过）
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
  // 从相册移除照片（ids 数组）
  app.post('/api/albums/:id/remove', (req, res) => {
    const a = db.albums.find(x => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: '未找到相册' });
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [(req.body && req.body.ids)];
    a.photoIds = a.photoIds.filter(id => !ids.includes(id));
    persistDB();
    res.json({ ok: true, count: a.photoIds.length });
  });

  /* ---------- 后台任务：批量处理（队列 + 进度 + 取消） ---------- */
  const jobs = new Map();
  const MAX_JOBS = 20;
  const persistJobs = () => persistWithLock(JOBS_FILE, [...jobs.values()]);

  // v1.2.1：启动时从 jobs.json 恢复历史任务。
  // 重启时仍在 running 的任务标记为 error（不自动续跑），保留进度/错误信息供查看。
  function loadPersistedJobs() {
    const saved = loadJSON(JOBS_FILE, []);
    if (!Array.isArray(saved)) return;
    for (const j of saved) {
      if (!j || !j.id) continue;
      if (j.status === 'running') {
        j.status = 'error';
        j.error = '应用重启，任务中断（已完成的照片保留，未处理部分不自动续跑）';
      }
      jobs.set(j.id, j);
    }
  }
  loadPersistedJobs();

  // 创建批量任务记录：初始化进度字段、入内存 Map 并落盘；超 MAX_JOBS 时清理最早结束的任务
  function createJob(type, payload) {
    const job = {
      id: nanoid(10),
      type,
      status: 'running', // running | done | canceled | error
      total: payload.ids.length,
      done: 0,
      current: null,
      results: [],
      errors: [],
      canceled: false,
      error: null,
      payload,
      createdAt: Date.now(),
    };
    jobs.set(job.id, job);
    // 只清理已结束的旧任务，避免误删运行中的任务
    if (jobs.size > MAX_JOBS) {
      const finished = [...jobs.entries()].find(([, j]) => j.status !== 'running');
      if (finished) jobs.delete(finished[0]);
    }
    persistJobs();
    return job;
  }

  // 批量任务并发度：2 路并行。串行太慢（大量照片时明显），过高则 sharp 内存峰值失控
  const BATCH_CONCURRENCY = 2;

  // 执行批量任务：BATCH_CONCURRENCY 路 worker 共享索引逐张处理，
  // 单张错误隔离（只记 errors），完成/取消/异常时落盘任务状态
  async function runBatchJob(job) {
    const { ids, pipeline, mode } = job.payload;
    // 单张照片处理（错误隔离：失败只记录，不中断整批）
    const processOne = async (id) => {
      if (job.canceled) return;
      const p = db.photos.find(x => x.id === id);
      if (!p) {
        job.errors.push({ id, error: '未找到' });
        job.done++;
        return;
      }
      job.current = { id, name: p.name };
      try {
        const opts = JSON.parse(JSON.stringify(pipeline || {}));
        // 保持原格式：按每张照片的真实格式决定输出（gif/tiff/bmp 不支持时回退 jpeg）
        if (opts.output && opts.output.format === 'keep') {
          opts.output.format = FMT_EXT[p.format] || 'jpeg';
        }
        // 按百分比缩放：以每张照片自身像素为准
        const scale = clampNum(opts.resizeScale, 0.05, 1, 1);
        if (scale < 1 && p.width && p.height) {
          opts.resize = {
            width: Math.max(1, Math.round(p.width * scale)),
            height: Math.max(1, Math.round(p.height * scale)),
          };
        }
        delete opts.resizeScale;

        const full = path.join(DIRS.uploads, p.file);
        const { buffer, ext } = await runPipelineLogged(full, opts, settings);
        if (mode === 'overwrite') {
          const newName = p.id + '.' + ext;
          const newPath = path.join(DIRS.uploads, newName);
          if (newName !== p.file) await fsp.rm(full, { force: true });
          await fsp.writeFile(newPath, buffer);
          Object.assign(p, await buildMeta(newPath, p.id, p.name));
          await makeThumb(newPath, p.id, settings.thumbSize, DIRS.thumbs);
          job.results.push({ id, name: p.name, mode: 'overwrite' });
        } else {
          const newId = nanoid(10);
          const newName = newId + '.' + ext;
          const newPath = path.join(DIRS.uploads, newName);
          await fsp.writeFile(newPath, buffer);
          await makeThumb(newPath, newId, settings.thumbSize, DIRS.thumbs);
          const baseName = p.name.replace(/\.[^.]+$/, '');
          const meta = await buildMeta(newPath, newId, `${baseName}_edited.${ext}`);
          db.photos.push(meta);
          job.results.push({ id, name: meta.name, mode: 'copy', newId });
        }
        await persistDBWithRetry();
      } catch (e) {
        job.errors.push({ id, name: p.name, error: e.message });
      }
      job.done++;
      job.current = null;
      // 每张照片后落盘任务进度，重启后可恢复
      try { persistJobs(); } catch { /* 落盘失败不阻断处理 */ }
    };
    // 有限并发池：worker 从共享索引取下一张，取完为止（取消时不再取新任务）
    let next = 0;
    const workers = Array.from({ length: Math.min(BATCH_CONCURRENCY, Math.max(ids.length, 1)) }, async () => {
      while (next < ids.length && !job.canceled) {
        const i = next++;
        await processOne(ids[i]);
      }
    });
    try {
      await Promise.all(workers);
      if (job.status !== 'canceled') job.status = 'done';
      try { persistJobs(); } catch { /* 忽略 */ }
      logger.info('backend', `批量处理完成 job=${job.id}`, {
        total: job.total,
        done: job.done,
        errors: job.errors.length,
      });
    } catch (e) {
      job.status = 'error';
      job.error = e.message;
      try { persistJobs(); } catch { /* 忽略 */ }
      logger.error('backend', '批量处理任务异常', { job: job.id, message: e.message });
    }
  }

  // 查询批量任务进度：总数/已完成/当前照片/结果/错误（前端 500ms 轮询）
  app.get('/api/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: '任务不存在' });
    res.json({
      id: job.id,
      type: job.type,
      status: job.status,
      total: job.total,
      done: job.done,
      current: job.current,
      results: job.results,
      errors: job.errors,
      error: job.error,
    });
  });

  // 取消批量任务：置 canceled 标志，worker 不再取新任务（已完成的保留）
  app.post('/api/jobs/:id/cancel', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: '任务不存在' });
    if (job.status === 'running') job.canceled = true;
    try { persistJobs(); } catch { /* 落盘失败不阻断取消 */ }
    res.json({ ok: true, status: job.status });
  });

  /* ---------- 批量下载 ZIP（条目名净化） ---------- */
  // 将选中照片打包为 ZIP 流式下载；文件名经 sanitizeZipName 净化，重名自动加 _2/_3 后缀
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
  // 相册搜索/筛选：支持 q(文件名)、stars、flag(pick/reject/flagged)、format、tag、album，
  // hideReject=1 隐藏排除照片，sort 支持 newest/oldest/name/name_desc/size/size_desc/stars
  app.get('/api/search', (req, res) => {
    let list = [...db.photos];
    const { q, stars, flag, album, format, sort, tag } = req.query;
    if (q) {
      const lower = String(q).toLowerCase();
      list = list.filter(p => String(p.name).toLowerCase().includes(lower));
    }
    if (toBool(req.query.hideReject)) list = list.filter(p => p.flag !== 'reject');
    if (stars) list = list.filter(p => p.stars === Number(stars));
    if (flag === 'pick') list = list.filter(p => p.flag === 'pick');
    else if (flag === 'reject') list = list.filter(p => p.flag === 'reject');
    else if (flag === 'flagged') list = list.filter(p => p.flag);
    if (format) list = list.filter(p => String(p.format || '').toLowerCase() === String(format).toLowerCase());
    if (tag) list = list.filter(p => Array.isArray(p.tags) && p.tags.includes(String(tag)));
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
  // 读取日志（JSONL）：按 level/source 过滤，取末尾 limit 条并倒序（最新在前）
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

  // 清空日志：清空主文件并删除所有轮转备份
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

  // 日志路径信息（设置/关于页展示用）
  app.get('/api/logs/info', (req, res) => {
    res.json({ logDir: LOG_DIR, logFile: LOG_FILE, isElectron, logDirName: isElectron ? 'log' : 'log' });
  });

  // 接收前端上报日志（级别白名单 + 消息截断 1000 字），来源记为 frontend
  app.post('/api/logs/frontend', (req, res) => {
    const allowed = new Set(['info', 'warn', 'error', 'debug']);
    const level = allowed.has(req.body && req.body.level) ? req.body.level : 'info';
    const message = String((req.body && req.body.message) || '').slice(0, 1000);
    if (message) logger[level]('frontend', message, req.body && req.body.data);
    res.json({ ok: true });
  });

  /* ---------- 统一错误处理 ---------- */
  // 全局错误中间件：写锁冲突返回 409；其余记日志后返回 500，headersSent 时交给 Express 默认处理
  app.use((err, req, res, next) => {
    // 写锁冲突：返回 409（前端提示另一实例正在写入）
    if (err && err.lumaWriteConflict) {
      logger.warn('backend', '写锁冲突', { path: req.path, message: err.message });
      if (res.headersSent) return next(err);
      return res.status(409).json({ error: err.message });
    }
    logger.error('backend', '未处理的请求错误', {
      path: req.path,
      message: err && err.message,
    });
    if (res.headersSent) return next(err);
    res.status(500).json({ error: (err && err.message) || '服务器内部错误' });
  });

  logger.info('system', 'Luma Studio 应用初始化完成', { version, isElectron });
  return {
    app,
    logger,
    getDb: () => db,
    getSettings: () => settings,
    getAuthToken: () => rawSettings.authToken,
  };
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
  sanitizeTags,
  DEFAULT_SETTINGS,
};
