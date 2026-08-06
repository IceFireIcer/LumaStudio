/**
 * UI 冒烟测试：用 Electron 真实加载前端，捕获渲染进程 JS 错误，
 * 并验证 GSAP / UIAnim 已加载、动画可触发。
 * 运行：npx electron scripts/ui-smoke.cjs
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
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
    version: '1.0.5-smoke',
  });

  const server = serverApp.listen(0, '127.0.0.1', async () => {
    const port = server.address().port;
    const errors = [];
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 860,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    win.webContents.on('console-message', (eventOrLevel, maybeLevel, maybeMsg) => {
      const ev = eventOrLevel && typeof eventOrLevel === 'object' ? eventOrLevel : null;
      const level = ev ? ev.level : maybeLevel;
      const message = ev ? ev.message : maybeMsg;
      if (level >= 2) errors.push(String(message));
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
