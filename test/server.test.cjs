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

function startServer() {
  const d = tmpdir();
  const dirs = {
    uploads: path.join(d, 'uploads'),
    thumbs: path.join(d, 'thumbs'),
    data: path.join(d, 'data'),
  };
  const { app, getDb } = createAppServer({
    port: 0,
    dirs,
    logDir: path.join(d, 'log'),
    publicDir: path.join(ROOT, 'public'),
    version: '1.0.7-test',
  });
  return new Promise(resolve => {
    const srv = app.listen(0, '127.0.0.1', () => {
      resolve({
        srv,
        base: `http://127.0.0.1:${srv.address().port}`,
        d,
        dirs,
        getDb,
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
