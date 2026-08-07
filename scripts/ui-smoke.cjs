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
const { createAppServer } = require('../server-app.cjs');

const ROOT = path.resolve(__dirname, '..');
// 固定端口：CSRF 同源校验在 createAppServer 时按传入端口生成白名单，
// 若用端口 0（随机），渲染进程的 POST 会被 403 拦截。
const SMOKE_PORT = 18765;

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
    // 先上传两张测试照片，让页面有可选的当前照片与对比对象
    const jpeg = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 120, g: 180, b: 90 } },
    }).jpeg().toBuffer();
    const fd = new FormData();
    fd.append('photos', new Blob([jpeg], { type: 'image/jpeg' }), 'smoke-a.jpg');
    fd.append('photos', new Blob([jpeg], { type: 'image/jpeg' }), 'smoke-b.jpg');
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
