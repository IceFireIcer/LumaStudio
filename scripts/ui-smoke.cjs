/**
 * UI 冒烟测试：用 Electron 真实加载前端，捕获渲染进程 JS 错误，
 * 并验证 GSAP / UIAnim 已加载、动画可触发、v1.1.0 选片工作流可交互。
 * 运行：npx electron scripts/ui-smoke.cjs
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const piexif = require('piexifjs');
const { createAppServer } = require('../server-app.cjs');

const ROOT = path.resolve(__dirname, '..');
// 固定端口：CSRF 同源校验在 createAppServer 时按传入端口生成白名单，
// 若用端口 0（随机），渲染进程的 POST 会被 403 拦截。
const SMOKE_PORT = 18765;

// 主进程兜底：未捕获异常不再弹原生错误窗，直接打印并退出；
// 看门狗防止任何一步卡死导致挂起。
process.on('uncaughtException', err => {
  console.error('SMOKE-UNCAUGHT ' + (err && err.stack ? err.stack : err));
  app.exit(1);
});
process.on('unhandledRejection', reason => {
  console.error('SMOKE-REJECTION ' + (reason && reason.stack ? reason.stack : reason));
});
const watchdog = setTimeout(() => {
  console.error('SMOKE-TIMEOUT smoke 未在 90 秒内完成');
  app.exit(2);
}, 90000);
watchdog.unref();

app.whenReady().then(async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-ui-smoke-'));
  const dirs = {
    uploads: path.join(d, 'uploads'),
    thumbs: path.join(d, 'thumbs'),
    data: path.join(d, 'data'),
  };
  const { app: serverApp } = createAppServer({
    port: SMOKE_PORT,
    dirs,
    logDir: path.join(d, 'log'),
    publicDir: path.join(ROOT, 'public'),
    version: '1.0.7-smoke',
  });

  // OOBE 路由仅由 electron-main.cjs 注册（注册表持久化），冒烟环境注册空实现避免 404
  serverApp.get('/api/oobe/status', (req, res) => res.json({ completed: true }));
  serverApp.post('/api/oobe/complete', (req, res) => res.json({ ok: true }));
  serverApp.post('/api/oobe/reset', (req, res) => res.json({ ok: true }));

  const server = serverApp.listen(SMOKE_PORT, '127.0.0.1', async () => {
    const port = SMOKE_PORT;
    // 先上传测试照片：两张横图 + 两张竖拍方向照片（EXIF orientation 6），
    // 让页面有可选的当前照片/对比对象，同时覆盖瀑布流比例失配回归。
    const jpeg = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 120, g: 180, b: 90 } },
    }).jpeg().toBuffer();
    const orieRaw = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: { r: 220, g: 120, b: 80 } },
    }).jpeg().toBuffer();
    const orieBuf = Buffer.from(
      piexif.insert(piexif.dump({ '0th': { [piexif.ImageIFD.Orientation]: 6 } }), orieRaw.toString('binary')),
      'binary'
    );
    const fd = new FormData();
    fd.append('photos', new Blob([jpeg], { type: 'image/jpeg' }), 'smoke-a.jpg');
    fd.append('photos', new Blob([jpeg], { type: 'image/jpeg' }), 'smoke-b.jpg');
    fd.append('photos', new Blob([jpeg], { type: 'image/jpeg' }), 'smoke-c.jpg');
    fd.append('photos', new Blob([jpeg], { type: 'image/jpeg' }), 'smoke-d.jpg');
    fd.append('photos', new Blob([orieBuf], { type: 'image/jpeg' }), 'smoke-orie-a.jpg');
    fd.append('photos', new Blob([orieBuf], { type: 'image/jpeg' }), 'smoke-orie-b.jpg');
    await fetch(`http://127.0.0.1:${port}/api/upload`, { method: 'POST', body: fd });
    const errors = [];
    const win = new BrowserWindow({
      show: true,
      width: 1280,
      height: 860,
      // 隐藏窗口默认节流 rAF/定时器，会让 GSAP 动画的 onComplete 迟迟不触发
      webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
    });

    win.webContents.on('console-message', (ev) => {
      // Electron 32+：单个事件对象参数，level 为字符串（'info'/'warning'/'error'/'debug'）
      const level = ev.level;
      const message = ev.message;
      const isError = typeof level === 'number'
        ? level >= 2
        : ['error', 'warning'].includes(String(level || '').toLowerCase());
      if (isError) errors.push(String(message));
    });
    win.webContents.on('did-fail-load', (e, code, desc) => {
      errors.push(`did-fail-load ${code} ${desc}`);
    });
    win.webContents.on('render-process-gone', (e, details) => {
      errors.push(`render-process-gone ${details.reason}`);
    });

    win.webContents.on('did-finish-load', async () => {
      try {
        const state = await win.webContents.executeJavaScript(`({
          gsap: typeof gsap !== 'undefined',
          gsapVersion: typeof gsap !== 'undefined' ? gsap.version : null,
          uiAnim: typeof window.UIAnim !== 'undefined',
          reduceMotion: window.UIAnim ? window.UIAnim.reduce : null,
          uiAnimClass: document.documentElement.classList.contains('ui-anim'),
          scripts: Array.from(document.scripts).map(s => s.src.replace(location.origin, ''))
        })`);
        console.log('UI-STATE ' + JSON.stringify(state));

        // 回归：EXIF 方向照片（竖拍）入库宽高应为旋转后的显示尺寸，
        // 瀑布流按缩略图真实比例排版、卡片不重叠（点击图片不被邻卡盖住）
        const masonry = await win.webContents.executeJavaScript(`(async function(){
          try {
            await new Promise(r => setTimeout(r, 900)); // 等缩略图加载 + 防抖重排
            const cards = Array.from(document.querySelectorAll('#grid .card'));
            const bad = [];
            for (const c of cards) {
              const img = c.querySelector('img');
              const r = img.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              if (hit !== img) {
                const over = hit && hit.closest ? hit.closest('.card') : null;
                bad.push(c.dataset.id + ' covered by ' + (over ? over.dataset.id : 'non-card'));
              }
              const ratio = parseFloat(c.dataset.ratio || '1');
              const nat = img.naturalWidth && img.naturalHeight ? img.naturalHeight / img.naturalWidth : null;
              if (nat && Math.abs(ratio - nat) > 0.01) bad.push(c.dataset.id + ' ratio ' + ratio + ' != ' + nat.toFixed(3));
            }
            return 'masonry-ok cards=' + cards.length + ' bad=' + JSON.stringify(bad);
          } catch (e) { return 'masonry-error:' + e.message; }
        })()`);
        console.log('MASONRY ' + masonry);

        const anim = await win.webContents.executeJavaScript(`(function(){
          const d = document.createElement('div');
          d.className = 'card';
          d.style.cssText = 'width:60px;height:60px;position:absolute';
          document.body.appendChild(d);
          try { window.UIAnim.gridIn([d]); return 'gridIn-ok'; }
          catch (e) { return 'gridIn-error:' + e.message; }
        })()`);
        console.log('ANIM ' + anim);

        const modal = await win.webContents.executeJavaScript(`(function(){
          try {
            const m = document.getElementById('inputModal');
            window.UIAnim.modal(m, document.querySelector('.modal-content', m), true);
            return 'modal-ok hidden=' + m.hidden;
          } catch (e) { return 'modal-error:' + e.message; }
        })()`);
        console.log('MODAL ' + modal);

        // 键盘事件必须不抛异常（曾因引用不存在的 #editor 元素导致全部快捷键失效）
        const keydown = await win.webContents.executeJavaScript(`(function(){
          try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));
            return 'keydown-ok';
          } catch (e) { return 'keydown-error:' + e.message; }
        })()`);
        console.log('KEYDOWN ' + keydown);

        // 卡片悬停布局：左上角复选框与像素尺寸角标不得重叠
        // （曾因两条 .card .badge 规则互相覆盖，badge 被拉回 left:9px 与复选框重合）
        const layout = await win.webContents.executeJavaScript(`(function(){
          try {
            const card = document.createElement('div');
            card.className = 'card';
            card.style.cssText = 'width:120px;height:120px;position:absolute;left:0;top:0';
            card.innerHTML = '<div class="sel-check"></div><div class="badge">1920×1080</div>';
            document.body.appendChild(card);
            const ck = card.querySelector('.sel-check').getBoundingClientRect();
            const bd = card.querySelector('.badge').getBoundingClientRect();
            card.remove();
            const overlap = !(bd.right <= ck.left || bd.left >= ck.right || bd.bottom <= ck.top || bd.top >= ck.bottom);
            return 'layout-ok overlap=' + overlap +
              ' check=' + JSON.stringify({ left: ck.left, top: ck.top, right: ck.right, bottom: ck.bottom }) +
              ' badge=' + JSON.stringify({ left: bd.left, top: bd.top, right: bd.right, bottom: bd.bottom });
          } catch (e) { return 'layout-error:' + e.message; }
        })()`);
        console.log('LAYOUT ' + layout);

        // 回归：侧边栏“信息”在已有当前照片时必须加载图片和元数据
        // （曾只调用 switchView 显示外壳，导致左侧预览空白、无 EXIF 请求）
        const navExif = await win.webContents.executeJavaScript(`(async function(){
          try {
            const cards = document.querySelectorAll('.card');
            if (!cards.length) return 'nav-exif-error:no-cards';
            cards[0].querySelector('.edit').click(); // 打开编辑器，设置 current
            await new Promise(r => setTimeout(r, 600));
            document.getElementById('navExif').click(); // 侧边栏切到信息页
            await new Promise(r => setTimeout(r, 1200));
            const img = document.getElementById('exifImg');
            return 'nav-exif-ok src=' + (img.src.includes('/files/') ? 'set' : 'EMPTY') +
              ' loaded=' + (img.naturalWidth > 0) + ' w=' + img.naturalWidth +
              ' list=' + (document.getElementById('exifList').textContent.length > 0);
          } catch (e) { return 'nav-exif-error:' + e.message; }
        })()`);
        console.log('NAV-EXIF ' + navExif);

        // 前后对比：编辑器进入对比模式（原图层 + 分界线显示，--ba 变量生效）
        const baCompare = await win.webContents.executeJavaScript(`(async function(){
          try {
            document.getElementById('navEditor').click();
            await new Promise(r => setTimeout(r, 600));
            document.getElementById('baToggle').click();
            await new Promise(r => setTimeout(r, 300));
            const orig = document.getElementById('baOrigImg');
            const div = document.getElementById('baDivider');
            return 'ba-ok origHidden=' + orig.hidden + ' divHidden=' + div.hidden +
              ' src=' + (orig.src.includes('/files/') ? 'set' : 'EMPTY') +
              ' ba=' + document.getElementById('canvasStage').style.getPropertyValue('--ba');
          } catch (e) { return 'ba-error:' + e.message; }
        })()`);
        console.log('BA-COMPARE ' + baCompare);

        // 灯箱并排对比：C 进入、X 标记不抛错、Esc 先退对比再关灯箱
        const lbCompare = await win.webContents.executeJavaScript(`(async function(){
          try {
            document.querySelectorAll('.card')[0].querySelector('img').click();
            await new Promise(r => setTimeout(r, 500));
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
            await new Promise(r => setTimeout(r, 300));
            const wrap = document.getElementById('lbCompareWrap');
            const opened = !wrap.hidden && document.getElementById('lbImgA').src.includes('/files/');
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
            await new Promise(r => setTimeout(r, 400));
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise(r => setTimeout(r, 300));
            const cmpClosed = wrap.hidden && document.getElementById('lightbox').classList.contains('open');
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            let lbClosed = false;
            for (let i = 0; i < 20; i++) {
              if (!document.getElementById('lightbox').classList.contains('open')) { lbClosed = true; break; }
              await new Promise(r => setTimeout(r, 100));
            }
            return 'lb-ok opened=' + opened + ' cmpClosed=' + cmpClosed + ' lbClosed=' + lbClosed +
              ' vis=' + document.visibilityState +
              ' reduce=' + (window.UIAnim ? window.UIAnim.reduce : 'n/a');
          } catch (e) { return 'lb-error:' + e.message; }
        })()`);
        console.log('LB-COMPARE ' + lbCompare);

        // 批量处理：多选 → 打开模态框 → 启动任务
        const batchUi = await win.webContents.executeJavaScript(`(async function(){
          try {
            document.querySelectorAll('.card')[0].querySelector('.sel-check').click();
            await new Promise(r => setTimeout(r, 200));
            const barVisible = !document.getElementById('batchBar').hidden;
            document.getElementById('batchProcess').click();
            await new Promise(r => setTimeout(r, 300));
            const modalOpen = !document.getElementById('batchModal').hidden;
            document.getElementById('batchStart').click();
            return 'batch-ok bar=' + barVisible + ' modal=' + modalOpen +
              ' progress=' + (!document.getElementById('batchProgress').hidden);
          } catch (e) { return 'batch-error:' + e.message; }
        })()`);
        console.log('BATCH-UI ' + batchUi);

        // 等待批量任务完成（后台 job 结束后按钮文案变为“关闭”）
        let batchDone = false;
        for (let i = 0; i < 40; i++) {
          const st = await win.webContents.executeJavaScript(`({
            cancelText: document.getElementById('batchCancel').textContent,
            progress: document.getElementById('batchProgressText').textContent
          })`);
          if (st.cancelText === '关闭') {
            batchDone = true;
            console.log('BATCH-DONE ' + JSON.stringify(st));
            break;
          }
          await new Promise(r => setTimeout(r, 500));
        }
        if (!batchDone) console.log('BATCH-DONE timeout');
        const afterBatch = await win.webContents.executeJavaScript(`(async function(){
          try {
            document.getElementById('batchCancel').click();
            await new Promise(r => setTimeout(r, 600));
            return 'grid=' + document.querySelectorAll('#grid .card').length;
          } catch (e) { return 'close-error:' + e.message; }
        })()`);
        console.log('BATCH-AFTER ' + afterBatch);

        // H 键隐藏排除开关
        const toggleH = await win.webContents.executeJavaScript(`(function(){
          try {
            document.querySelector('.nav-item[data-view="library"]').click();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
            const on = document.getElementById('hideRejectBtn').classList.contains('active');
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
            const off = !document.getElementById('hideRejectBtn').classList.contains('active');
            return 'toggle-h on=' + on + ' off=' + off;
          } catch (e) { return 'toggle-h-error:' + e.message; }
        })()`);
        console.log('TOGGLE-H ' + toggleH);

        /* ===== v1.2 验收用例 ===== */

        // 深色模式 / 减弱动效即时生效（无需保存）
        const darkMode = await win.webContents.executeJavaScript(`(async function(){
          try {
            document.querySelector('.nav-item[data-view="settings"]').click();
            await new Promise(r => setTimeout(r, 400));
            const theme = document.getElementById('setTheme');
            theme.checked = true;
            theme.dispatchEvent(new Event('change', { bubbles: true }));
            const dark = document.documentElement.dataset.theme === 'dark';
            const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
            theme.checked = false;
            theme.dispatchEvent(new Event('change', { bubbles: true }));
            const light = document.documentElement.dataset.theme === 'light';
            const rm = document.getElementById('setReduceMotion');
            rm.value = 'on';
            rm.dispatchEvent(new Event('change', { bubbles: true }));
            const reduced = !!(window.UIAnim && window.UIAnim.reduce);
            rm.value = 'system';
            rm.dispatchEvent(new Event('change', { bubbles: true }));
            return 'dark-ok dark=' + dark + ' light=' + light + ' bg=' + bg +
              ' reduced=' + reduced;
          } catch (e) { return 'dark-error:' + e.message; }
        })()`);
        console.log('DARK-MODE ' + darkMode);

        // ? 快捷键速查浮层：打开 → 搜索过滤 → Esc 关闭
        const shortcuts = await win.webContents.executeJavaScript(`(async function(){
          try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
            await new Promise(r => setTimeout(r, 300));
            const opened = !document.getElementById('shortcutModal').hidden &&
              document.getElementById('shortcutList').children.length > 0;
            const search = document.getElementById('shortcutSearch');
            search.value = '缩放';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            const groups = document.getElementById('shortcutList').children.length;
            search.value = '';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise(r => setTimeout(r, 400));
            return 'shortcut-ok opened=' + opened + ' filteredGroups=' + groups +
              ' closed=' + document.getElementById('shortcutModal').hidden;
          } catch (e) { return 'shortcut-error:' + e.message; }
        })()`);
        console.log('SHORTCUTS ' + shortcuts);

        // showConfirm 替代原生 confirm：Enter 确认返回 true 并关闭
        const confirmModal = await win.webContents.executeJavaScript(`(async function(){
          try {
            const p = window.showConfirm('测试', '确认内容', { danger: true });
            await new Promise(r => setTimeout(r, 300));
            const opened = !document.getElementById('confirmModal').hidden &&
              document.getElementById('confirmOk').classList.contains('danger');
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            const val = await p;
            await new Promise(r => setTimeout(r, 300));
            return 'confirm-ok opened=' + opened + ' val=' + val +
              ' closed=' + document.getElementById('confirmModal').hidden;
          } catch (e) { return 'confirm-error:' + e.message; }
        })()`);
        console.log('CONFIRM ' + confirmModal);

        // 灯箱缩放态：滚轮放大 → ←/→ 平移（不换图）→ 选片键仍生效 → Esc 复位
        const lbZoom = await win.webContents.executeJavaScript(`(async function(){
          try {
            document.querySelector('.nav-item[data-view="library"]').click();
            await new Promise(r => setTimeout(r, 600));
            document.querySelectorAll('#grid .card')[0].querySelector('img').click();
            await new Promise(r => setTimeout(r, 500));
            const lb = document.getElementById('lightbox');
            const zoomEl = document.getElementById('lbZoom');
            const before = getComputedStyle(zoomEl).transform;
            // 连续放大 5 次（约 1.76×），使图片超过视口尺寸，平移 clamp 才允许
            for (let i = 0; i < 5; i++) {
              lb.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: 640, clientY: 400, bubbles: true, cancelable: true }));
            }
            await new Promise(r => setTimeout(r, 300));
            const zoomed = !document.getElementById('lbZoomFit').hidden;
            const zoomedTransform = getComputedStyle(zoomEl).transform;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
            await new Promise(r => setTimeout(r, 200));
            const afterPanTransform = getComputedStyle(zoomEl).transform;
            const panned = afterPanTransform !== zoomedTransform;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
            await new Promise(r => setTimeout(r, 500));
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise(r => setTimeout(r, 300));
            const reset = document.getElementById('lbZoomFit').hidden;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise(r => setTimeout(r, 300));
            return 'lbzoom-ok zoomed=' + zoomed + ' panned=' + panned +
              ' reset=' + reset + ' transformChanged=' + (before !== zoomedTransform);
          } catch (e) { return 'lbzoom-error:' + e.message; }
        })()`);
        console.log('LB-ZOOM ' + lbZoom);

        // 全局拖放上传遮罩：dragenter 显示 + 计数，dragleave 消失
        const uploadOverlay = await win.webContents.executeJavaScript(`(async function(){
          try {
            const dt = new DataTransfer();
            dt.items.add(new File(['x'], 'overlay.png', { type: 'image/png' }));
            const ov = document.getElementById('uploadOverlay');
            window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
            const shown = ov.classList.contains('show');
            const count = document.getElementById('uoCount').textContent;
            window.dispatchEvent(new DragEvent('dragleave', { dataTransfer: dt, bubbles: true, cancelable: true }));
            const hidden = !ov.classList.contains('show');
            return 'overlay-ok shown=' + shown + ' count=' + count + ' hidden=' + hidden;
          } catch (e) { return 'overlay-error:' + e.message; }
        })()`);
        console.log('UPLOAD-OVERLAY ' + uploadOverlay);

        // 回归：在 dropzone 内拖放只上传一次（window drop 冒泡不得重复上传）
        const dropOnce = await win.webContents.executeJavaScript(`(async function(){
          try {
            const before = (await fetch('/api/search').then(r=>r.json())).length;
            const photos = await fetch('/api/search').then(r=>r.json());
            const blob = await (await fetch('/files/' + photos[0].file + '?v=' + photos[0].time)).blob();
            const dt = new DataTransfer();
            dt.items.add(new File([blob], 'drop-once.jpg', { type: 'image/jpeg' }));
            document.getElementById('dropzone').dispatchEvent(
              new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
            await new Promise(r => setTimeout(r, 2200));
            const after = (await fetch('/api/search').then(r=>r.json())).length;
            return 'droponce-ok before=' + before + ' after=' + after + ' added=' + (after - before);
          } catch (e) { return 'droponce-error:' + e.message; }
        })()`);
        console.log('DROP-ONCE ' + dropOnce);

        // Flip 重绘：搜索触发 renderGrid 后网格卡片数不变
        const flipGrid = await win.webContents.executeJavaScript(`(async function(){
          try {
            const before = document.querySelectorAll('#grid .card').length;
            const inp = document.getElementById('searchInput');
            inp.value = '';
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, 900));
            const after = document.querySelectorAll('#grid .card').length;
            return 'flip-ok before=' + before + ' after=' + after;
          } catch (e) { return 'flip-error:' + e.message; }
        })()`);
        console.log('FLIP-GRID ' + flipGrid);

        // 回归：收藏夹详情页全选后可见卡片出现选中态（renderGrid 只重建库网格的问题）
        const albumBatch = await win.webContents.executeJavaScript(`(async function(){
          try {
            const created = await fetch('/api/albums', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: '冒烟相册' }),
            }).then(r=>r.json());
            const photoId = document.querySelectorAll('#grid .card')[0].dataset.id;
            await fetch('/api/albums/' + created.album.id + '/add', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: [photoId] }),
            });
            document.querySelector('.nav-item[data-view="albums"]').click();
            await new Promise(r => setTimeout(r, 500));
            document.querySelector('.album-card').click();
            await new Promise(r => setTimeout(r, 900));
            const card = document.querySelector('#albumGrid .card');
            const selBefore = card.classList.contains('selected');
            document.getElementById('batchSelectAll').click();
            await new Promise(r => setTimeout(r, 400));
            // 全选会重建网格，需重新查询卡片节点
            const selAfter = document.querySelector('#albumGrid .card').classList.contains('selected');
            document.getElementById('batchClearSel').click();
            await new Promise(r => setTimeout(r, 300));
            const selCleared = !document.querySelector('#albumGrid .card').classList.contains('selected');
            document.getElementById('albumBackBtn').click();
            await new Promise(r => setTimeout(r, 600));
            return 'albumbatch-ok selBefore=' + selBefore + ' selAfter=' + selAfter + ' selCleared=' + selCleared;
          } catch (e) { return 'albumbatch-error:' + e.message; }
        })()`);
        console.log('ALBUM-BATCH ' + albumBatch);

        // 草稿：修改滑块 → debounce 保存；导出成功 → 清除
        const draftFlow = await win.webContents.executeJavaScript(`(async function(){
          try {
            const card = document.querySelectorAll('#grid .card')[0];
            const id = card.dataset.id;
            card.querySelector('.edit').click();
            await new Promise(r => setTimeout(r, 800));
            const s = document.getElementById('brightness');
            s.value = 130;
            s.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, 1500));
            const savedRes = await fetch('/api/photos/' + id + '/draft');
            const saved = savedRes.status === 200;
            document.getElementById('exportBtn').click();
            await new Promise(r => setTimeout(r, 3000));
            const afterExport = await fetch('/api/photos/' + id + '/draft').then(r => r.status).catch(() => -1);
            return 'draft-ok saved=' + saved + ' afterExport=' + afterExport;
          } catch (e) { return 'draft-error:' + e.message; }
        })()`);
        console.log('DRAFT ' + draftFlow);
      } catch (e) {
        errors.push('executeJavaScript: ' + e.message);
      }
      console.log('CONSOLE-ERRORS ' + JSON.stringify(errors));
      server.close();
      app.quit();
    });

    win.loadURL(`http://127.0.0.1:${port}/`);
  });
});
