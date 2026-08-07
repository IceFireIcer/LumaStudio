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
