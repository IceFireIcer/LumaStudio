/**
 * Luma Studio 回归测试（node:test）
 * 覆盖此前代码审查中实测确认的缺陷：
 *  - 旋转被静默忽略 / 旋转后裁剪坐标错位
 *  - 抹除元数据造成有损重压缩
 *  - 日志中间件位置错误导致请求不落日志
 *  - 设置未校验导致上传 500
 *  - /api/logs/frontend 任意 level 导致 500
 *  - 跨站表单请求（CSRF）
 *  - 扩展名/文件名净化
 *  - EXIF 中文读写
 *  - 中文文件名上传不乱码、外部 UTF-16/GBK 中文 EXIF 读取不乱码
 *  - db.json 损坏恢复
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const sharp = require('sharp');
const exifr = require('exifr');
const piexif = require('piexifjs');
const {
  createAppServer,
  runPipeline,
  stripMetadata,
  sanitizeSettings,
  sanitizeZipName,
  normalizeAngle,
  readPngExif,
  readWebpExif,
  writePngExif,
  writeWebpExif,
  readWebpChunks,
  sanitizeTags,
} = require('../server-app.cjs');

const ROOT = path.resolve(__dirname, '..');

/* ============ 工具 ============ */
function makeFixture() {
  // 200x100：上红下蓝
  const raw = Buffer.alloc(200 * 100 * 3);
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 200; x++) {
      const i = (y * 200 + x) * 3;
      raw[i] = y < 50 ? 255 : 0;
      raw[i + 1] = 0;
      raw[i + 2] = y < 50 ? 0 : 255;
    }
  }
  return raw;
}

function countColors(buf) {
  let red = 0;
  let blue = 0;
  for (let i = 0; i < buf.length; i += 3) {
    if (buf[i] > 100) red++;
    else blue++;
  }
  return { red, blue };
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'luma-test-'));
}

async function makeNoiseJpeg(withExif = false) {
  const noise = Buffer.alloc(400 * 300 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256);
  let buf = await sharp(noise, { raw: { width: 400, height: 300, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
  if (withExif) {
    const bin = buf.toString('binary');
    buf = Buffer.from(
      piexif.insert(
        piexif.dump({ '0th': { [piexif.ImageIFD.Artist]: '测试作者' } }),
        bin
      ),
      'binary'
    );
  }
  return buf;
}

function startServer(opts = {}) {
  const d = tmpdir();
  const dirs = {
    uploads: path.join(d, 'uploads'),
    thumbs: path.join(d, 'thumbs'),
    data: path.join(d, 'data'),
  };
  const { app, getDb, getAuthToken } = createAppServer({
    port: 0,
    dirs,
    logDir: path.join(d, 'log'),
    publicDir: path.join(ROOT, 'public'),
    version: '1.0.7-test',
    requireToken: opts.requireToken === true,
  });
  return new Promise(resolve => {
    const srv = app.listen(0, '127.0.0.1', () => {
      resolve({
        srv,
        base: `http://127.0.0.1:${srv.address().port}`,
        d,
        dirs,
        getDb,
        getAuthToken,
      });
    });
  });
}

async function uploadJpeg(base, buf, filename = 'test.jpg') {
  const fd = new FormData();
  fd.append('photos', new Blob([buf], { type: 'image/jpeg' }), filename);
  const r = await fetch(`${base}/api/upload`, { method: 'POST', body: fd });
  return r.json();
}

function closeServer(srv) {
  return new Promise(resolve => srv.close(resolve));
}

async function waitJob(base, jobId, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let j;
  do {
    j = await (await fetch(`${base}/api/jobs/${jobId}`)).json();
    if (j.status === 'done' || j.status === 'error' || j.status === 'canceled') return j;
    await new Promise(r => setTimeout(r, 100));
  } while (Date.now() < deadline);
  return j;
}

/* ============ 单元测试 ============ */
test('normalizeAngle 归一化为 0/90/180/270', () => {
  assert.equal(normalizeAngle(0), 0);
  assert.equal(normalizeAngle(90), 90);
  assert.equal(normalizeAngle(270), 270);
  assert.equal(normalizeAngle(360), 0);
  assert.equal(normalizeAngle(-90), 270);
  assert.equal(normalizeAngle(45), 90);
  assert.equal(normalizeAngle('abc'), 0);
});

test('runPipeline: 显式旋转不再被静默忽略', async () => {
  const d = tmpdir();
  const file = path.join(d, 'fixture.png');
  await sharp(makeFixture(), { raw: { width: 200, height: 100, channels: 3 } }).png().toFile(file);
  const out = await runPipeline(file, { transform: { rotate: 90 } }, {});
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.width, 100);
  assert.equal(meta.height, 200);
});

test('runPipeline: 旋转后裁剪使用源空间坐标（与预览一致）', async () => {
  const d = tmpdir();
  const file = path.join(d, 'fixture.png');
  await sharp(makeFixture(), { raw: { width: 200, height: 100, channels: 3 } }).png().toFile(file);
  // 显示画面旋转 90° 后框选中心（对应源空间矩形 (75,0,50,100)）
  const out = await runPipeline(
    file,
    { transform: { rotate: 90, crop: { left: 75, top: 0, width: 50, height: 100 } } },
    {}
  );
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.width, 100);
  assert.equal(meta.height, 50);
  const colors = countColors(await sharp(out.buffer).raw().toBuffer());
  assert.ok(colors.red > 0, '应包含红色区域');
  assert.ok(colors.blue > 0, '应包含蓝色区域');
});

test('stripMetadata: JPEG 无损抹除 EXIF', async () => {
  const d = tmpdir();
  const file = path.join(d, 'noise.jpg');
  const buf = await makeNoiseJpeg(true);
  fs.writeFileSync(file, buf);
  const before = fs.statSync(file).size;
  const beforePixels = await sharp(file).raw().toBuffer();
  const beforeObj = piexif.load(fs.readFileSync(file).toString('binary'));
  assert.ok(beforeObj['0th'][piexif.ImageIFD.Artist], '测试前应存在 EXIF 作者');

  await stripMetadata(file);

  const afterPixels = await sharp(file).raw().toBuffer();
  let diff = 0;
  for (let i = 0; i < beforePixels.length; i++) diff += Math.abs(beforePixels[i] - afterPixels[i]);
  assert.equal(diff, 0, '像素不应有任何改变（无损）');
  const after = fs.statSync(file).size;
  assert.ok(after <= before, '去掉 EXIF 后体积不应增大');
  const afterObj = piexif.load(fs.readFileSync(file).toString('binary'));
  assert.equal(afterObj['0th'][piexif.ImageIFD.Artist], undefined, 'EXIF 作者应被移除');
});

test('stripMetadata: 保留方向标记（避免图片侧躺）', async () => {
  const d = tmpdir();
  const file = path.join(d, 'oriented.jpg');
  const plain = await makeNoiseJpeg(false);
  const bin = plain.toString('binary');
  fs.writeFileSync(
    file,
    Buffer.from(
      piexif.insert(piexif.dump({ '0th': { [piexif.ImageIFD.Orientation]: 6 } }), bin),
      'binary'
    )
  );
  await stripMetadata(file);
  const obj = piexif.load(fs.readFileSync(file).toString('binary'));
  assert.equal((obj['0th'] || {})[piexif.ImageIFD.Orientation], 6, '方向标记应保留');
});

test('sanitizeZipName: 净化非法字符与路径', () => {
  const out = sanitizeZipName('..\\..\\evil:name?.jpg');
  assert.ok(!out.includes('\\'));
  assert.ok(!out.includes('/'));
  assert.ok(!out.startsWith('.'));
  assert.ok(out.length > 0);
  assert.equal(sanitizeZipName(''), 'photo');
});

test('sanitizeSettings: 非法设置被钳制到安全范围', () => {
  const s = sanitizeSettings({
    thumbSize: 0,
    defaultQuality: 999,
    defaultFormat: 'gif',
    accent: 'red',
  });
  assert.equal(s.thumbSize, 120);
  assert.equal(s.defaultQuality, 100);
  assert.equal(s.defaultFormat, 'jpeg');
  assert.equal(s.accent, '#0071e3');
});

/* ============ HTTP 集成测试 ============ */
test('HTTP: 日志中间件记录所有请求', async () => {
  const { srv, base } = await startServer();
  try {
    await fetch(`${base}/api/photos`);
    await uploadJpeg(base, await makeNoiseJpeg(false), 'a.jpg');
    const lg = await (await fetch(`${base}/api/logs?limit=500`)).json();
    const messages = (lg.logs || []).map(l => l.message);
    assert.ok(messages.some(m => m.includes('GET /api/photos')), 'GET /api/photos 应被记录');
    assert.ok(messages.some(m => m.includes('POST /api/upload')), 'POST /api/upload 应被记录');
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 设置校验 + 上传在非法设置下仍可用', async () => {
  const { srv, base } = await startServer();
  try {
    const r = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thumbSize: 0, defaultQuality: 999, defaultFormat: 'gif', accent: 'red' }),
    });
    const j = await r.json();
    assert.equal(j.settings.thumbSize, 120);
    assert.equal(j.settings.defaultQuality, 100);
    assert.equal(j.settings.defaultFormat, 'jpeg');
    const up = await uploadJpeg(base, await makeNoiseJpeg(false), 'ok.jpg');
    assert.ok(up.ok);
    assert.equal(up.added.length, 1);
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 非法扩展名被拒绝且不产生文件', async () => {
  const { srv, base, dirs } = await startServer();
  try {
    const up = await uploadJpeg(base, await makeNoiseJpeg(false), 'x.evil');
    assert.ok(up.ok);
    assert.equal(up.added.length, 0);
    assert.ok(up.errors.length > 0);
    const files = fs.readdirSync(dirs.uploads);
    assert.equal(files.length, 0, '不应留下任何文件');
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 带路径的文件名不会写出上传目录', async () => {
  const { srv, base, dirs, d } = await startServer();
  try {
    const up = await uploadJpeg(base, await makeNoiseJpeg(false), '..\\..\\escape_here');
    assert.ok(up.ok);
    assert.equal(up.added.length, 0);
    assert.ok(up.errors.length > 0);
    const uploads = fs.readdirSync(dirs.uploads);
    assert.equal(uploads.length, 0);
    assert.ok(!fs.existsSync(path.join(d, 'escape_here')), '不应在目录外生成文件');
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: CSRF 防护拒绝跨站表单请求', async () => {
  const { srv, base } = await startServer();
  try {
    const r = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example.com' },
      body: JSON.stringify({ thumbSize: 100 }),
    });
    assert.equal(r.status, 403);
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: /api/logs/frontend 非法 level 不再 500', async () => {
  const { srv, base } = await startServer();
  try {
    const r = await fetch(`${base}/api/logs/frontend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: '__proto__', message: 'x' }),
    });
    assert.equal(r.status, 200);
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: EXIF 中文读写 + 抹除', async () => {
  const { srv, base } = await startServer();
  try {
    const up = await uploadJpeg(base, await makeNoiseJpeg(true), 'exif.jpg');
    const id = up.added[0].id;
    const w = await fetch(`${base}/api/photos/${id}/exif`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist: '张三', description: '测试图片' }),
    });
    assert.equal(w.status, 200);
    const rd = await (await fetch(`${base}/api/photos/${id}/exif`)).json();
    assert.equal(rd.exif.Artist, '张三');
    assert.equal(rd.exif.ImageDescription, '测试图片');
    const st = await fetch(`${base}/api/photos/${id}/strip-exif`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(st.status, 200);
    const rd2 = await (await fetch(`${base}/api/photos/${id}/exif`)).json();
    assert.ok(!rd2.exif.Artist, '抹除后不应再读到作者');
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 中文文件名上传后不再乱码', async () => {
  const { srv, base } = await startServer();
  try {
    const up = await uploadJpeg(base, await makeNoiseJpeg(false), '我的旅行照片.jpg');
    assert.ok(up.ok);
    assert.equal(up.added.length, 1);
    assert.equal(up.added[0].name, '我的旅行照片.jpg', '文件名应为正确中文而非 latin1 乱码');
    const list = await (await fetch(`${base}/api/photos`)).json();
    assert.equal(list[0].name, '我的旅行照片.jpg', '列表返回的文件名应一致');
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 外部 UTF-16 / GBK 中文 EXIF 读取不再乱码', async () => {
  const { srv, base } = await startServer();
  try {
    const variants = {
      // 相机 / Windows 软件常见写法：UTF-16LE 带 BOM
      'utf16le': Buffer.from('\uFEFF' + '测试作者', 'utf16le').toString('latin1'),
      // 国产软件常见写法：GBK 编码（测试作者 的 GBK 字节）
      'gbk': Buffer.from([0xB2, 0xE2, 0xCA, 0xD4, 0xD7, 0xF7, 0xD5, 0xDF]).toString('latin1'),
    };
    for (const [label, raw] of Object.entries(variants)) {
      const bin = (await makeNoiseJpeg(false)).toString('binary');
      const withExif = Buffer.from(
        piexif.insert(piexif.dump({ '0th': { [piexif.ImageIFD.Artist]: raw } }), bin),
        'binary'
      );
      const up = await uploadJpeg(base, withExif, `${label}.jpg`);
      assert.equal(up.added.length, 1, `${label} 应上传成功`);
      const rd = await (await fetch(`${base}/api/photos/${up.added[0].id}/exif`)).json();
      assert.equal(rd.exif.Artist, '测试作者', `${label} 作者应正确解码`);
    }
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 启动时自动修正历史乱码文件名', async () => {
  const d = tmpdir();
  const dirs = {
    uploads: path.join(d, 'uploads'),
    thumbs: path.join(d, 'thumbs'),
    data: path.join(d, 'data'),
  };
  fs.mkdirSync(dirs.data, { recursive: true });
  const mojibake = Buffer.from('我的旅行照片.jpg', 'utf8').toString('latin1');
  fs.writeFileSync(
    path.join(dirs.data, 'db.json'),
    JSON.stringify({ photos: [{ id: 'old1', name: mojibake, file: 'old1.jpg' }], albums: [] }),
    'utf8'
  );
  const { app, getDb } = createAppServer({
    port: 0,
    dirs,
    logDir: path.join(d, 'log'),
    publicDir: path.join(ROOT, 'public'),
    version: '1.0.7-test',
  });
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    assert.equal(getDb().photos[0].name, '我的旅行照片.jpg', '内存中的历史乱码名应已修正');
    const saved = JSON.parse(fs.readFileSync(path.join(dirs.data, 'db.json'), 'utf8'));
    assert.equal(saved.photos[0].name, '我的旅行照片.jpg', '修正后的名字应持久化回 db.json');
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: PNG / WebP EXIF 无损写入与读取', async () => {
  const { srv, base, dirs, getDb } = await startServer();
  try {
    const raw = makeFixture();
    const png = await sharp(raw, { raw: { width: 200, height: 100, channels: 3 } }).png().toBuffer();
    const webp = await sharp(raw, { raw: { width: 200, height: 100, channels: 3 } }).webp({ quality: 90 }).toBuffer();

    const upPng = await uploadJpeg(base, png, 'a.png');
    const upWebp = await uploadJpeg(base, webp, 'b.webp');
    assert.equal(upPng.added.length, 1, 'PNG 应上传成功');
    assert.equal(upWebp.added.length, 1, 'WebP 应上传成功');
    const pngId = upPng.added[0].id;
    const webpId = upWebp.added[0].id;

    for (const id of [pngId, webpId]) {
      const w = await fetch(`${base}/api/photos/${id}/exif`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artist: '张三',
          copyright: '©测试',
          description: 'PNG/WebP 描述',
          datetime: '2026:08:07 12:00:00',
        }),
      });
      assert.equal(w.status, 200, `EXIF 写入应成功 (${id})`);
    }

    for (const [id, label, fmt] of [[pngId, 'PNG', 'png'], [webpId, 'WebP', 'webp']]) {
      const g = await (await fetch(`${base}/api/photos/${id}/exif`)).json();
      const ex = g.exif || {};
      assert.equal(ex.Artist, '张三', `${label} 作者`);
      assert.equal(ex.Copyright, '©测试', `${label} 版权`);
      assert.equal(ex.ImageDescription, 'PNG/WebP 描述', `${label} 描述`);

      // 写入后文件仍能被 sharp 解码，像素尺寸不变（未重编码）
      const meta = getDb().photos.find(p => p.id === id);
      const fileBuf = fs.readFileSync(path.join(dirs.uploads, meta.file));
      const m = await sharp(fileBuf).metadata();
      assert.equal(m.format, fmt, `${label} 格式保持`);
      assert.equal(m.width, 200, `${label} 宽度保持`);
      assert.equal(m.height, 100, `${label} 高度保持`);

      // 绕过 API 读取路径，直接验证文件内存在 EXIF chunk（无损写入，未重编码）
      const chunk = fmt === 'png' ? readPngExif(fileBuf) : readWebpExif(fileBuf);
      assert.ok(chunk && chunk.length > 0, `${label} 应包含 EXIF chunk`);
    }
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: PNG/WebP EXIF 读取返回完整拍摄字段（相机/快门/光圈）', async () => {
  const { srv, base } = await startServer();
  try {
    const raw = makeFixture();
    const png = await sharp(raw, { raw: { width: 200, height: 100, channels: 3 } }).png().toBuffer();
    const webp = await sharp(raw, { raw: { width: 200, height: 100, channels: 3 } }).webp({ quality: 90 }).toBuffer();
    const dump = piexif.dump({
      '0th': { [piexif.ImageIFD.Make]: 'TestCam', [piexif.ImageIFD.Model]: 'X100' },
      Exif: {
        [piexif.ExifIFD.ExposureTime]: [1, 125],
        [piexif.ExifIFD.FNumber]: [28, 10],
        [piexif.ExifIFD.DateTimeOriginal]: '2026:08:07 12:00:00',
      },
    });
    const tiff = Buffer.from(dump, 'binary');
    const files = [
      ['a.png', writePngExif(png, tiff)],
      ['b.webp', writeWebpExif(webp, tiff)],
    ];
    for (const [name, buf] of files) {
      const up = await uploadJpeg(base, buf, name);
      assert.equal(up.added.length, 1, `${name} 应上传成功`);
      const g = await (await fetch(`${base}/api/photos/${up.added[0].id}/exif`)).json();
      const ex = g.exif || {};
      assert.equal(ex.Make, 'TestCam', `${name} 相机品牌`);
      assert.equal(ex.Model, 'X100', `${name} 相机型号`);
      assert.equal(ex.ExposureTime, 0.008, `${name} 快门`);
      assert.equal(ex.FNumber, 2.8, `${name} 光圈`);
    }
  } finally {
    await closeServer(srv);
  }
});

test('writeWebpExif: 动画 WebP（VP8X+ANIM+ANMF）可写入 EXIF 并设置 VP8X 标志', () => {
  const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 4, 'ascii');
    h.writeUInt32LE(data.length, 4);
    return Buffer.concat([h, data, (data.length & 1) ? Buffer.from([0]) : Buffer.alloc(0)]);
  };
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x02; // ANIM 标志
  vp8x[4] = 7; vp8x[7] = 7; // 画布 8x8
  const anim = Buffer.alloc(6);
  anim[0] = 0xFF; anim[1] = 0xFF; anim[2] = 0xFF; anim[3] = 0xFF; anim[4] = 0; anim[5] = 0;
  const anmfHdr = Buffer.alloc(16);
  anmfHdr.writeUInt16LE(0, 0);   // x
  anmfHdr.writeUInt16LE(0, 2);   // y
  anmfHdr.writeUInt16LE(7, 4);   // width-1
  anmfHdr.writeUInt16LE(7, 6);   // height-1
  anmfHdr[8] = 100; anmfHdr[9] = 0; anmfHdr[10] = 0; // 100ms
  anmfHdr[11] = 0;               // flags
  const anmf = Buffer.concat([anmfHdr, Buffer.from('VP8 '), Buffer.from([0x9D, 0x01, 0x2A, 0x00, 0x07, 0x00, 0x07, 0x00])]);
  const body = Buffer.concat([chunk('VP8X', vp8x), chunk('ANIM', anim), chunk('ANMF', anmf)]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WEBP', 8, 4, 'ascii');
  const animFile = Buffer.concat([header, body]);

  const tiff = Buffer.from(piexif.dump({ '0th': { [piexif.ImageIFD.Make]: 'AnimCam' } }), 'binary');
  const out = writeWebpExif(animFile, tiff);
  assert.ok(out, '动画 WebP 应能写入 EXIF');
  const chunks = readWebpChunks(out);
  assert.ok(chunks, '写入后仍应可解析为 chunk 列表');
  assert.ok(chunks.find(c => c.type === 'EXIF'), '应包含 EXIF chunk');
  const vp8xAfter = chunks.find(c => c.type === 'VP8X');
  assert.ok(vp8xAfter && (vp8xAfter.data[0] & 0x08), 'VP8X 应设置 EXIF 标志位');
  assert.equal(chunks.find(c => c.type === 'ANIM').data.length, 6, 'ANIM chunk 应保留');
  assert.ok(readWebpExif(out) && readWebpExif(out).length > 0, 'EXIF 应可读回');
});

test('HTTP: 损坏的 WebP/PNG 写入 EXIF 安全拒绝且原文件不变', async () => {
  const { srv, base, dirs, getDb } = await startServer();
  try {
    const raw = makeFixture();
    const png = await sharp(raw, { raw: { width: 200, height: 100, channels: 3 } }).png().toBuffer();
    const webp = await sharp(raw, { raw: { width: 200, height: 100, channels: 3 } }).webp({ quality: 90 }).toBuffer();
    for (const [name, buf] of [['a.png', png], ['b.webp', webp]]) {
      const up = await uploadJpeg(base, buf, name);
      const p = getDb().photos.find(x => x.id === up.added[0].id);
      const full = path.join(dirs.uploads, p.file);
      const original = fs.readFileSync(full);
      const broken = original.subarray(0, Math.floor(original.length / 2));
      fs.writeFileSync(full, broken); // 截断模拟损坏
      const w = await fetch(`${base}/api/photos/${p.id}/exif`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: 'x' }),
      });
      assert.equal(w.status, 400, `${name} 损坏文件应返回 400`);
      const wBody = await w.json();
      assert.ok(String(wBody.error).includes('不支持写入 EXIF'), `${name} 错误信息应说明不支持写入`);
      assert.ok(fs.readFileSync(full).equals(broken), `${name} 原文件不应被改写`);
    }
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: db.json 损坏时自动备份并回退', async () => {
  const d = tmpdir();
  const dirs = {
    uploads: path.join(d, 'uploads'),
    thumbs: path.join(d, 'thumbs'),
    data: path.join(d, 'data'),
  };
  fs.mkdirSync(dirs.data, { recursive: true });
  fs.writeFileSync(path.join(dirs.data, 'db.json'), '{ broken json');
  const { app, getDb } = createAppServer({
    port: 0,
    dirs,
    logDir: path.join(d, 'log'),
    version: '1.0.7-test',
  });
  const srv = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const photos = await (await fetch(`${base}/api/photos`)).json();
    assert.deepEqual(photos, []);
    const corrupt = fs.readdirSync(dirs.data).filter(f => f.includes('.corrupt-'));
    assert.ok(corrupt.length > 0, '损坏文件应被备份为 .corrupt-*');
    assert.deepEqual(getDb().photos, []);
  } finally {
    await closeServer(srv);
  }
});

/* ============ v1.1.0 选片工作流：批量处理 / 隐藏排除 / 选片设置 ============ */
test('HTTP: 批量评分/标记路由不被 /:id 遮蔽（回归）', async () => {
  const { srv, base } = await startServer();
  try {
    const upA = await uploadJpeg(base, await makeNoiseJpeg(false), 'a.jpg');
    const upB = await uploadJpeg(base, await makeNoiseJpeg(false), 'b.jpg');
    const ids = [upA.added[0].id, upB.added[0].id];

    const r = await fetch(`${base}/api/photos/batch/stars`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, stars: 4 }),
    });
    assert.equal(r.status, 200, '批量评分应命中批量路由而非 404');
    const j = await r.json();
    assert.equal(j.updated, 2);
    assert.equal(j.stars, 4);

    const fl = await fetch(`${base}/api/photos/batch/flag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, flag: 'pick' }),
    });
    const fj = await fl.json();
    assert.equal(fj.updated, 2);
    assert.equal(fj.flag, 'pick');

    // 单张照片路由不受影响
    const one = await fetch(`${base}/api/photos/${ids[0]}`);
    assert.equal(one.status, 200);
    const op = await one.json();
    assert.equal(op.stars, 4);
    assert.equal(op.flag, 'pick');
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 批量处理创建副本并报告进度（逐文件错误隔离）', async () => {
  const { srv, base, dirs, getDb } = await startServer();
  try {
    const upA = await uploadJpeg(base, await makeNoiseJpeg(false), 'a.jpg');
    const upB = await uploadJpeg(base, await makeNoiseJpeg(false), 'b.jpg');
    const ids = [upA.added[0].id, upB.added[0].id, 'not-exist-id'];

    const r = await fetch(`${base}/api/photos/batch/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids,
        pipeline: {
          adjust: { brightness: 1.1, saturation: 1.3 },
          output: { format: 'webp', quality: 80 },
        },
        mode: 'copy',
      }),
    });
    const jr = await r.json();
    assert.equal(jr.ok, true);
    assert.ok(jr.jobId, '应返回 jobId');
    assert.equal(jr.total, 3);

    const j = await waitJob(base, jr.jobId);
    assert.equal(j.status, 'done');
    assert.equal(j.done, 3, '任务应处理完全部条目');
    assert.equal(j.results.length, 2, '两张有效照片应成功');
    assert.equal(j.errors.length, 1, '不存在的 id 应被记录为错误且不影响其他照片');
    assert.equal(j.errors[0].id, 'not-exist-id');

    // 副本应写入存储且为 WebP
    const copies = getDb().photos.filter(p => p.name.includes('_edited'));
    assert.equal(copies.length, 2);
    for (const c of copies) {
      const filePath = path.join(dirs.uploads, c.file);
      assert.ok(fs.existsSync(filePath), '副本文件应存在');
      const meta = await sharp(filePath).metadata();
      assert.equal(meta.format, 'webp');
    }
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 批量处理覆盖原图模式直接替换文件', async () => {
  const { srv, base, dirs, getDb } = await startServer();
  try {
    const up = await uploadJpeg(base, await makeNoiseJpeg(false), 'overwrite.jpg');
    const id = up.added[0].id;
    const origFile = getDb().photos.find(p => p.id === id).file;

    const r = await fetch(`${base}/api/photos/batch/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: [id],
        pipeline: { output: { format: 'png' } },
        mode: 'overwrite',
      }),
    });
    const jr = await r.json();
    const j = await waitJob(base, jr.jobId);
    assert.equal(j.status, 'done');
    assert.equal(getDb().photos.length, 1, '覆盖模式不应新增记录');
    const now = getDb().photos[0];
    const filePath = path.join(dirs.uploads, now.file);
    assert.equal(now.id, id, 'id 保持不变');
    const meta = await sharp(filePath).metadata();
    assert.equal(meta.format, 'png', '原文件应被替换为 PNG');
    assert.ok(!fs.existsSync(path.join(dirs.uploads, origFile)), '旧格式文件应被清理');
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 批量任务取消接口语义正确', async () => {
  const { srv, base } = await startServer();
  try {
    const notFound = await fetch(`${base}/api/jobs/nope/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(notFound.status, 404);

    // 对空选择启动任务应被拒绝
    const bad = await fetch(`${base}/api/photos/batch/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [], pipeline: {} }),
    });
    assert.equal(bad.status, 400);

    // 已结束任务再取消应返回 ok 且状态不变
    const up = await uploadJpeg(base, await makeNoiseJpeg(false), 'c.jpg');
    const r = await fetch(`${base}/api/photos/batch/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [up.added[0].id], pipeline: {}, mode: 'copy' }),
    });
    const jr = await r.json();
    const done = await waitJob(base, jr.jobId);
    assert.equal(done.status, 'done');
    const cancel = await fetch(`${base}/api/jobs/${jr.jobId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const cj = await cancel.json();
    assert.equal(cj.ok, true);
    assert.equal(cj.status, 'done');
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: hideReject 搜索参数排除被标记排除的照片', async () => {
  const { srv, base } = await startServer();
  try {
    const upA = await uploadJpeg(base, await makeNoiseJpeg(false), 'a.jpg');
    const upB = await uploadJpeg(base, await makeNoiseJpeg(false), 'b.jpg');
    await fetch(`${base}/api/photos/${upA.added[0].id}/flag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flag: 'reject' }),
    });
    const all = await (await fetch(`${base}/api/search`)).json();
    assert.equal(all.length, 2);
    const hidden = await (await fetch(`${base}/api/search?hideReject=1`)).json();
    assert.equal(hidden.length, 1);
    assert.notEqual(hidden[0].id, upA.added[0].id);
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: autoAdvance 设置默认开启且可关闭', async () => {
  const { srv, base } = await startServer();
  try {
    const s0 = await (await fetch(`${base}/api/settings`)).json();
    assert.equal(s0.autoAdvance, true, '默认应开启选片自动跳转');
    const r = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoAdvance: false }),
    });
    const j = await r.json();
    assert.equal(j.settings.autoAdvance, false);
    const s1 = await (await fetch(`${base}/api/settings`)).json();
    assert.equal(s1.autoAdvance, false);
  } finally {
    await closeServer(srv);
  }
});

/* ============ v1.2 回归：设置新键 / adjust 新参数 / 草稿 / 封面 / dataDir ============ */
test('sanitizeSettings: v1.2 新键校验与默认值', () => {
  const s = sanitizeSettings({});
  assert.equal(s.theme, 'light');
  assert.equal(s.reduceMotion, 'system');
  assert.equal(s.slideshowInterval, 3);
  assert.equal(s.logsRefreshInterval, 3, '默认日志刷新间隔为 3');
  const ok = sanitizeSettings({ theme: 'dark', reduceMotion: 'on', slideshowInterval: 10, logsRefreshInterval: 30 });
  assert.equal(ok.theme, 'dark');
  assert.equal(ok.reduceMotion, 'on');
  assert.equal(ok.slideshowInterval, 10);
  assert.equal(ok.logsRefreshInterval, 30);
  // 非法值回退默认
  const bad = sanitizeSettings({ theme: 'blue', reduceMotion: 'sometimes', slideshowInterval: 7, logsRefreshInterval: 999 });
  assert.equal(bad.theme, 'light');
  assert.equal(bad.reduceMotion, 'system');
  assert.equal(bad.slideshowInterval, 3);
  assert.equal(bad.logsRefreshInterval, 3);
});

test('runPipeline: 旧请求无新参数时结果与 v1.1.0 一致（缺省=默认）', async () => {
  const d = tmpdir();
  const file = path.join(d, 'fixture.png');
  await sharp(makeFixture(), { raw: { width: 200, height: 100, channels: 3 } }).png().toFile(file);
  const out = await runPipeline(file, { output: { format: 'png' } }, {});
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.width, 200);
  assert.equal(meta.height, 100);
});

test('runPipeline: temperature/tint/vignette/grain 均可处理且不改尺寸', async () => {
  const d = tmpdir();
  const file = path.join(d, 'fixture.png');
  await sharp(makeFixture(), { raw: { width: 200, height: 100, channels: 3 } }).png().toFile(file);
  const out = await runPipeline(file, {
    adjust: { temperature: 40, tint: -20, vignette: 60, grain: 30 },
    output: { format: 'png' },
  }, {});
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.width, 200);
  assert.equal(meta.height, 100);
});

test('HTTP: 草稿 PUT/GET/DELETE 往返与上限清理', async () => {
  const { srv, base } = await startServer();
  try {
    const up = await uploadJpeg(base, await makeNoiseJpeg(false), 'draft.jpg');
    const id = up.added[0].id;
    const put = await fetch(`${base}/api/photos/${id}/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adjust: { brightness: 1.1, temperature: 20 },
        transform: {},
        resize: { width: 100, height: 50 },
        output: { format: 'jpeg', quality: 82 },
      }),
    });
    const pj = await put.json();
    assert.equal(pj.ok, true);
    assert.equal(pj.draft.adjust.temperature, 20);

    const got = await (await fetch(`${base}/api/photos/${id}/draft`)).json();
    assert.equal(got.ok, true);
    assert.equal(got.draft.resize.width, 100);

    // 无草稿的照片返回 404
    const up2 = await uploadJpeg(base, await makeNoiseJpeg(false), 'nodraft.jpg');
    const miss = await fetch(`${base}/api/photos/${up2.added[0].id}/draft`);
    assert.equal(miss.status, 404);

    const del = await fetch(`${base}/api/photos/${id}/draft`, { method: 'DELETE' });
    assert.equal((await del.json()).ok, true);
    const gone = await fetch(`${base}/api/photos/${id}/draft`);
    assert.equal(gone.status, 404);
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 草稿超 8KB 被拒绝', async () => {
  const { srv, base } = await startServer();
  try {
    const up = await uploadJpeg(base, await makeNoiseJpeg(false), 'bigdraft.jpg');
    const id = up.added[0].id;
    const r = await fetch(`${base}/api/photos/${id}/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adjust: { pad: 'x'.repeat(9000) } }),
    });
    assert.equal(r.status, 400);
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 草稿超过 1000 条时按 updatedAt 清理最旧', async () => {
  const { srv, base, d } = await startServer();
  try {
    const ids = [];
    for (let i = 0; i < 1001; i++) {
      const id = 'draft-' + String(i).padStart(4, '0');
      ids.push(id);
      const r = await fetch(`${base}/api/photos/${id}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjust: { brightness: 1 }, transform: {}, resize: {}, output: {} }),
      });
      assert.equal(r.status, 200, `第 ${i + 1} 条草稿应可保存`);
    }
    // 超过 1000 上限：最旧（第一条）被清理，最新（最后一条）保留
    const oldest = await fetch(`${base}/api/photos/${ids[0]}/draft`);
    assert.equal(oldest.status, 404, '最旧草稿应被清理');
    const newest = await fetch(`${base}/api/photos/${ids[1000]}/draft`);
    assert.equal(newest.status, 200, '最新草稿应保留');
    const draftsFile = path.join(d, 'data', 'drafts.json');
    const drafts = JSON.parse(fs.readFileSync(draftsFile, 'utf8'));
    assert.equal(Object.keys(drafts).length, 1000, '草稿总数应限制在 1000');
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 收藏夹 cover 取第一张加入的照片', async () => {
  const { srv, base } = await startServer();
  try {
    const upA = await uploadJpeg(base, await makeNoiseJpeg(false), 'c1.jpg');
    const upB = await uploadJpeg(base, await makeNoiseJpeg(false), 'c2.jpg');
    const idA = upA.added[0].id;
    const idB = upB.added[0].id;
    const created = await (await fetch(`${base}/api/albums`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '封面测试' }),
    })).json();
    await fetch(`${base}/api/albums/${created.album.id}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [idB, idA] }),
    });
    const albums = await (await fetch(`${base}/api/albums`)).json();
    const a = albums.find(x => x.id === created.album.id);
    assert.equal(a.count, 2);
    assert.equal(a.cover, idB, '封面应为第一张加入的照片');
    const emptyAlbums = await (await fetch(`${base}/api/albums`)).json();
    assert.equal(emptyAlbums.find(x => x.id !== created.album.id)?.cover ?? null, null);
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: /api/stats 返回 dataDir', async () => {
  const { srv, base, dirs } = await startServer();
  try {
    const s = await (await fetch(`${base}/api/stats`)).json();
    assert.equal(s.dataDir, dirs.data);
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: EXIF 方向照片入库宽高为旋转后的显示尺寸（与缩略图比例一致）', async () => {
  const { srv, base, dirs } = await startServer();
  try {
    // 原始 200×100 + orientation 6 → 显示为 100×200（竖拍）
    const raw = await sharp(makeFixture(), { raw: { width: 200, height: 100, channels: 3 } }).jpeg().toBuffer();
    const oriented = Buffer.from(
      piexif.insert(piexif.dump({ '0th': { [piexif.ImageIFD.Orientation]: 6 } }), raw.toString('binary')),
      'binary'
    );
    const up = await uploadJpeg(base, oriented, 'orie.jpg');
    assert.equal(up.added.length, 1);
    const p = up.added[0];
    assert.equal(p.width, 100, '宽度应为旋转后的显示宽度');
    assert.equal(p.height, 200, '高度应为旋转后的显示高度');
    // 缩略图宽高比与入库宽高比一致（前端瀑布流按此排版，不一致会重叠）
    const thumb = await sharp(path.join(dirs.thumbs, p.id + '.webp')).metadata();
    assert.equal(thumb.width / thumb.height, p.width / p.height, '缩略图比例应与入库宽高比一致');
  } finally {
    await closeServer(srv);
  }
});

/* ============ v1.2.1：本地访问令牌 ============ */
test('HTTP: 本地 Token——无令牌写请求返回 401，GET 不受影响', async () => {
  const { srv, base } = await startServer({ requireToken: true });
  try {
    // 写请求无令牌 → 401
    const noToken = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultQuality: 90 }),
    });
    assert.equal(noToken.status, 401);
    // GET 不受令牌校验影响
    const stats = await fetch(`${base}/api/stats`);
    assert.equal(stats.status, 200);
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 本地 Token——带正确令牌可写，错误令牌 401，重置后旧令牌失效', async () => {
  const { srv, base, getAuthToken } = await startServer({ requireToken: true });
  try {
    const token = getAuthToken();
    assert.ok(token && token.length >= 16, '首启应生成随机令牌');
    // 正确令牌 → 写成功
    const ok = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Luma-Token': token },
      body: JSON.stringify({ defaultQuality: 90 }),
    });
    assert.equal(ok.status, 200);
    // 错误令牌 → 401
    const bad = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Luma-Token': 'wrong-token' },
      body: JSON.stringify({ defaultQuality: 90 }),
    });
    assert.equal(bad.status, 401);
    // 重置令牌 → 返回新令牌，旧令牌立即失效
    const reset = await (await fetch(`${base}/api/auth/reset-token`, {
      method: 'POST',
      headers: { 'X-Luma-Token': token },
    })).json();
    assert.equal(reset.ok, true);
    assert.ok(reset.token && reset.token !== token, '重置应生成不同令牌');
    const oldStillWorks = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Luma-Token': token },
      body: JSON.stringify({ defaultQuality: 91 }),
    });
    assert.equal(oldStillWorks.status, 401, '旧令牌应失效');
    const newWorks = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Luma-Token': reset.token },
      body: JSON.stringify({ defaultQuality: 91 }),
    });
    assert.equal(newWorks.status, 200, '新令牌应生效');
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 本地 Token——默认（非 Electron）不强制校验，旧行为保持', async () => {
  const { srv, base, d } = await startServer(); // requireToken 默认 false
  try {
    const r = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultQuality: 88 }),
    });
    assert.equal(r.status, 200, '默认不应要求令牌');
    // 令牌仍持久化在 settings.json（Electron 生产场景经 preload 读取）
    const settings = JSON.parse(fs.readFileSync(path.join(d, 'data', 'settings.json'), 'utf8'));
    assert.ok(settings.authToken && settings.authToken.length >= 16, 'settings.json 应保存令牌');
    // 令牌不应出现在公开的 /api/settings 返回中（避免泄露到页面）
    const pub = await (await fetch(`${base}/api/settings`)).json();
    assert.equal(pub.authToken, undefined, '公开设置不应包含令牌');
  } finally {
    await closeServer(srv);
  }
});

/* ============ v1.2.1：文件级写锁（多开共享数据冲突兜底） ============ */
test('HTTP: 写锁——他人持锁时写请求返回 409，锁释放后可正常写', async () => {
  const { srv, base, d } = await startServer();
  try {
    const up = await uploadJpeg(base, await makeNoiseJpeg(false), 'lock.jpg');
    const id = up.added[0].id;
    const dbFile = path.join(d, 'data', 'db.json');
    const lockFile = dbFile + '.lock';
    // 模拟另一活跃实例持有 db.json 写锁
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, time: Date.now() }));
    const r = await fetch(`${base}/api/photos/${id}/stars`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stars: 4 }),
    });
    assert.equal(r.status, 409, '他人持锁时应返回写冲突');
    const body = await r.json();
    assert.ok(String(body.error).includes('另一实例正在写入'), '错误信息应说明写冲突');
    // 释放锁后可正常写
    fs.unlinkSync(lockFile);
    const ok = await fetch(`${base}/api/photos/${id}/stars`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stars: 4 }),
    });
    assert.equal(ok.status, 200, '锁释放后应可正常写入');
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 写锁——残留锁（进程已退出）可被接管', async () => {
  const { srv, base, d } = await startServer();
  try {
    const up = await uploadJpeg(base, await makeNoiseJpeg(false), 'lock2.jpg');
    const id = up.added[0].id;
    const dbFile = path.join(d, 'data', 'db.json');
    const lockFile = dbFile + '.lock';
    // 模拟已退出进程的残留锁：pid 指向不存在的进程（999999）且时间戳新 → 应判定 pid 已死并接管
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 999999999, time: Date.now() }));
    const r = await fetch(`${base}/api/photos/${id}/stars`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stars: 5 }),
    });
    assert.equal(r.status, 200, '残留锁应被接管，写入成功');
  } finally {
    await closeServer(srv);
  }
});

/* ============ v1.2.1：批量任务落盘 + 重启恢复 ============ */
test('HTTP: 批量任务落盘——完成后重启可恢复任务记录', async () => {
  const d = tmpdir();
  const dirs = {
    uploads: path.join(d, 'uploads'),
    thumbs: path.join(d, 'thumbs'),
    data: path.join(d, 'data'),
  };
  const mk = () => {
    const { app } = createAppServer({
      port: 0, dirs, logDir: path.join(d, 'log'),
      publicDir: path.join(ROOT, 'public'), version: '1.0.7-test',
    });
    return new Promise(resolve => {
      const srv = app.listen(0, '127.0.0.1', () =>
        resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
    });
  };
  const { srv, base } = await mk();
  let jobId;
  try {
    const up = await uploadJpeg(base, await makeNoiseJpeg(false), 'jobp.jpg');
    const r = await fetch(`${base}/api/photos/batch/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [up.added[0].id], pipeline: {}, mode: 'copy' }),
    });
    const jr = await r.json();
    jobId = jr.jobId;
    const done = await waitJob(base, jobId);
    assert.equal(done.status, 'done');
  } finally {
    await closeServer(srv);
  }
  // 模拟重启：用同一数据目录再启动一个服务器
  const jobsFile = path.join(d, 'data', 'jobs.json');
  assert.ok(fs.existsSync(jobsFile), '任务状态应落盘到 jobs.json');
  const saved = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  assert.equal(Array.isArray(saved), true);
  const { srv: srv2, base: base2 } = await mk();
  try {
    const restored = await (await fetch(`${base2}/api/jobs/${jobId}`)).json();
    assert.equal(restored.status, 'done', '重启后应能查询到已完成任务');
    assert.equal(restored.total, 1);
  } finally {
    await closeServer(srv2);
  }
});

test('HTTP: 批量任务落盘——重启时 running 任务标记为中断（不自动续跑）', async () => {
  const d = tmpdir();
  const dirs = {
    uploads: path.join(d, 'uploads'),
    thumbs: path.join(d, 'thumbs'),
    data: path.join(d, 'data'),
  };
  const mk = () => {
    const { app } = createAppServer({
      port: 0, dirs, logDir: path.join(d, 'log'),
      publicDir: path.join(ROOT, 'public'), version: '1.0.7-test',
    });
    return new Promise(resolve => {
      const srv = app.listen(0, '127.0.0.1', () =>
        resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
    });
  };
  // 直接写入一个 running 任务到 jobs.json（模拟崩溃时遗留）
  fs.mkdirSync(path.join(d, 'data'), { recursive: true });
  const runningJob = {
    id: 'interrupted-1',
    type: 'batch-process',
    status: 'running',
    total: 5, done: 2, current: { id: 'x', name: 'a.jpg' },
    results: [], errors: [], canceled: false, error: null,
    payload: { ids: ['a', 'b', 'c', 'd', 'e'], pipeline: {}, mode: 'copy' },
    createdAt: Date.now(),
  };
  fs.writeFileSync(path.join(d, 'data', 'jobs.json'), JSON.stringify([runningJob]));
  const { srv, base } = await mk();
  try {
    const restored = await (await fetch(`${base}/api/jobs/interrupted-1`)).json();
    assert.equal(restored.status, 'error', '重启时 running 任务应标记为 error');
    assert.ok(String(restored.error).includes('中断'), '错误信息应说明任务中断');
    assert.equal(restored.done, 2, '应保留已处理进度');
    // 不应自动续跑：done 不会增长
    await new Promise(r => setTimeout(r, 300));
    const again = await (await fetch(`${base}/api/jobs/interrupted-1`)).json();
    assert.equal(again.done, 2, '中断任务不应自动续跑');
  } finally {
    await closeServer(srv);
  }
});

/* ============ 标签体系（v1.3）============ */
test('sanitizeTags: 净化/去重/限长/限数/类型防护', () => {
  // 数组输入：去空、去重
  assert.deepEqual(sanitizeTags(['人像', ' 人像 ', '风景', '', '   ']), ['人像', '风景']);
  // 字符串输入：支持中英文逗号/顿号/空白分隔
  assert.deepEqual(sanitizeTags('人像,风景、夜景 街头'), ['人像', '风景', '夜景', '街头']);
  // 单标签限长 50
  const long = 'x'.repeat(80);
  assert.equal(sanitizeTags([long])[0].length, 50);
  // 最多 20 个
  const many = Array.from({ length: 30 }, (_, i) => 't' + i);
  assert.equal(sanitizeTags(many).length, 20);
  // 非法输入回退空数组
  assert.deepEqual(sanitizeTags(null), []);
  assert.deepEqual(sanitizeTags(123), []);
  assert.deepEqual(sanitizeTags(undefined), []);
});

test('HTTP: 单张标签设置/替换/读取 + 上传默认空标签', async () => {
  const { srv, base } = await startServer();
  try {
    const up = await uploadJpeg(base, await makeNoiseJpeg(), 'tag-a.jpg');
    const id = up.added[0].id;
    // 上传后默认无标签
    assert.deepEqual(up.added[0].tags, []);
    // 设置标签（数组）
    let r = await (await fetch(`${base}/api/photos/${id}/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['人像', '夜景'] }),
    })).json();
    assert.ok(r.ok);
    assert.deepEqual(r.tags, ['人像', '夜景']);
    // 全量替换（字符串输入）
    r = await (await fetch(`${base}/api/photos/${id}/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: '夜景' }),
    })).json();
    assert.deepEqual(r.tags, ['夜景']);
    // GET /api/photos/:id 读取
    const p = await (await fetch(`${base}/api/photos/${id}`)).json();
    assert.deepEqual(p.tags, ['夜景']);
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 旧数据无 tags 字段加载时回退为空数组', async () => {
  const d = tmpdir();
  const dirs = {
    uploads: path.join(d, 'uploads'),
    thumbs: path.join(d, 'thumbs'),
    data: path.join(d, 'data'),
  };
  fs.mkdirSync(path.join(d, 'data'), { recursive: true });
  fs.writeFileSync(path.join(d, 'data', 'db.json'), JSON.stringify({
    photos: [{ id: 'old1', name: 'old.jpg', stars: 0, flag: null }],
    albums: [],
  }));
  const { app, getDb } = createAppServer({
    port: 0, dirs, logDir: path.join(d, 'log'), publicDir: path.join(ROOT, 'public'),
  });
  const srv = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const p = getDb().photos[0];
    assert.deepEqual(p.tags, [], '旧照片无 tags 字段应回退为空数组');
    assert.equal(p.stars, 0, 'stars 兼容保持');
  } finally { await closeServer(srv); }
});

test('HTTP: 批量标签 set/add/remove 语义与持久化', async () => {
  const { srv, base } = await startServer();
  try {
    const up = await uploadJpeg(base, await makeNoiseJpeg(), 'bt-a.jpg');
    const up2 = await uploadJpeg(base, await makeNoiseJpeg(), 'bt-b.jpg');
    const idA = up.added[0].id, idB = up2.added[0].id;
    // add 追加（两批都打上）
    let r = await (await fetch(`${base}/api/photos/batch/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [idA, idB], tags: ['街头'], mode: 'add' }),
    })).json();
    assert.equal(r.updated, 2);
    // add 去重追加
    r = await (await fetch(`${base}/api/photos/batch/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [idA], tags: ['街头', '人像'], mode: 'add' }),
    })).json();
    const pa = await (await fetch(`${base}/api/photos/${idA}`)).json();
    assert.deepEqual(pa.tags, ['街头', '人像']);
    // set 替换
    r = await (await fetch(`${base}/api/photos/batch/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [idB], tags: ['夜景'], mode: 'set' }),
    })).json();
    const pb = await (await fetch(`${base}/api/photos/${idB}`)).json();
    assert.deepEqual(pb.tags, ['夜景']);
    // remove 移除
    r = await (await fetch(`${base}/api/photos/batch/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [idA], tags: ['街头'], mode: 'remove' }),
    })).json();
    const pa2 = await (await fetch(`${base}/api/photos/${idA}`)).json();
    assert.deepEqual(pa2.tags, ['人像']);
  } finally {
    await closeServer(srv);
  }
});

test('HTTP: 标签云聚合计数 + search tag 筛选', async () => {
  const { srv, base } = await startServer();
  try {
    const up1 = await uploadJpeg(base, await makeNoiseJpeg(), 'cloud-a.jpg');
    const up2 = await uploadJpeg(base, await makeNoiseJpeg(), 'cloud-b.jpg');
    const up3 = await uploadJpeg(base, await makeNoiseJpeg(), 'cloud-c.jpg');
    const id1 = up1.added[0].id, id2 = up2.added[0].id, id3 = up3.added[0].id;
    // 打标签：a/b 有"街头"，a 有"人像"
    for (const [id, tags] of [[id1, ['街头', '人像']], [id2, ['街头']], [id3, []]]) {
      await (await fetch(`${base}/api/photos/${id}/tags`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      })).json();
    }
    const cloud = await (await fetch(`${base}/api/tags`)).json();
    const names = cloud.tags.map(t => t.name);
    assert.ok(names.includes('街头') && names.includes('人像'), '标签云应含全部标签');
    const street = cloud.tags.find(t => t.name === '街头');
    assert.equal(street.count, 2, '街头计数应为 2');
    const portrait = cloud.tags.find(t => t.name === '人像');
    assert.equal(portrait.count, 1, '人像计数应为 1');
    // 排序：计数降序，同数按名称
    assert.equal(cloud.tags[0].name, '街头', '计数高的排前');
    // search?tag= 精确筛选
    const hits = await (await fetch(`${base}/api/search?tag=${encodeURIComponent('街头')}`)).json();
    assert.equal(hits.length, 2);
    assert.ok(hits.every(p => p.tags.includes('街头')));
    const noHit = await (await fetch(`${base}/api/search?tag=${encodeURIComponent('不存在')}`)).json();
    assert.equal(noHit.length, 0);
    // search?tag= 与 format 组合
    const fmt = await (await fetch(`${base}/api/search?tag=${encodeURIComponent('街头')}&format=jpeg`)).json();
    assert.equal(fmt.length, 2);
  } finally {
    await closeServer(srv);
  }
});
