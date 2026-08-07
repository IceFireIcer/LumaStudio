/**
 * UI 冒烟测试：用 Electron 真实加载前端，捕获渲染进程 JS 错误，
 * 并验证 GSAP / UIAnim 已加载、动画可触发。
 * 运行：npx electron scripts/ui-smoke.cjs
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const { createAppServer } = require('../server-app.cjs');

const ROOT = path.resolve(__dirname, '..');

app.whenReady().then(async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-ui-smoke-'));
  const dirs = {
    uploads: path.join(d, 'uploads'),
    thumbs: path.join(d, 'thumbs'),
    data: path.join(d, 'data'),
  };
  const { app: serverApp } = createAppServer({
    port: 0,
    dirs,
    logDir: path.join(d, 'log'),
    publicDir: path.join(ROOT, 'public'),
    version: '1.0.7-smoke',
  });

  const server = serverApp.listen(0, '127.0.0.1', async () => {
    const port = server.address().port;
    // 先上传一张测试照片，让页面有可选的当前照片
    const jpeg = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 120, g: 180, b: 90 } },
    }).jpeg().toBuffer();
    const fd = new FormData();
    fd.append('photos', new Blob([jpeg], { type: 'image/jpeg' }), 'smoke.jpg');
    await fetch(`http://127.0.0.1:${port}/api/upload`, { method: 'POST', body: fd });
    const errors = [];
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 860,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
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
