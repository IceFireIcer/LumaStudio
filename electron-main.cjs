/**
 * Luma Studio — Electron 主进程
 * 打开应用 = 启动 Express 服务器 + 显示窗口
 * 关闭窗口 = 停止服务器 + 退出
 *
 * 业务逻辑统一在 server-app.cjs 中，本文件只负责：
 *  - 数据目录（userData）与旧数据迁移
 *  - 单实例锁
 *  - OOBE（Windows 注册表）
 *  - 启动服务器与窗口
 */
const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;
const shell = electron.shell;
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { createAppServer } = require('./server-app.cjs');

const APP_ROOT = __dirname;
const PORT = 13579; // 固定高端口，仅监听本机回环地址

/* ============ 数据目录解析 ============
 * 便携版（electron-builder portable 目标）：数据放在 exe 旁 storage/，随 exe 携带；
 * 安装版：数据放在 userData（%APPDATA%\luma-studio）。
 * 便携版 exe 目录不可写时自动回退 userData，保证数据安全。
 */
const USER_DATA = app.getPath('userData');
const PORTABLE_DIR = (app.isPackaged && process.env.PORTABLE_EXECUTABLE_DIR)
  ? process.env.PORTABLE_EXECUTABLE_DIR
  : null;

function isDirWritable(dir) {
  try {
    const probe = path.join(dir, `.luma-write-${process.pid}.tmp`);
    fs.writeFileSync(probe, '1');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

let DATA_ROOT = USER_DATA;
let IS_PORTABLE_DATA = false;
if (PORTABLE_DIR) {
  if (isDirWritable(PORTABLE_DIR)) {
    DATA_ROOT = PORTABLE_DIR;
    IS_PORTABLE_DATA = true;
  } else {
    console.warn('便携版目录不可写，已回退到 userData:', USER_DATA);
  }
}
const LOG_DIR = path.join(DATA_ROOT, 'log');
const DIRS = {
  uploads: path.join(DATA_ROOT, 'storage', 'uploads'),
  thumbs: path.join(DATA_ROOT, 'storage', 'thumbs'),
  data: path.join(DATA_ROOT, 'storage', 'data'),
};

/* ============ 数据一次性迁移 ============ */
function migrateData() {
  if (!app.isPackaged) return;
  if (IS_PORTABLE_DATA) {
    // 便携版：把 userData 中已有的数据复制到 exe 旁（目标不存在时执行一次，安装版数据不受影响）
    const target = path.join(DATA_ROOT, 'storage');
    const source = path.join(USER_DATA, 'storage');
    if (!fs.existsSync(target) && fs.existsSync(source)) {
      try {
        fs.mkdirSync(target, { recursive: true });
        fs.cpSync(source, target, { recursive: true });
        console.log('已复制便携版数据到:', target);
      } catch (e) {
        console.error('便携版数据复制失败（继续使用空数据目录）:', e.message);
      }
    }
  } else {
    // 安装版：旧版本把数据放在可执行文件旁边，升级后移动到 userData，避免数据“消失”
    const legacy = path.join(path.dirname(process.execPath), 'storage');
    const target = path.join(DATA_ROOT, 'storage');
    if (fs.existsSync(legacy) && !fs.existsSync(target)) {
      try {
        fs.mkdirSync(DATA_ROOT, { recursive: true });
        fs.renameSync(legacy, target);
        console.log('已迁移旧数据目录:', target);
      } catch (e) {
        console.error('旧数据迁移失败（将使用空数据目录）:', e.message);
      }
    }
  }
}

/* ============ Windows 注册表 OOBE 管理 ============ */
const REG_KEY = 'HKCU\\Software\\LumaStudio';
const REG_VALUE = 'OOBECompleted';

async function checkOOBECompleted() {
  if (process.platform !== 'win32') return true; // 非 Windows 跳过 OOBE
  try {
    const { stdout } = await execAsync(`reg query "${REG_KEY}" /v ${REG_VALUE}`);
    return stdout.includes(REG_VALUE) && stdout.includes('0x1');
  } catch {
    return false;
  }
}

async function setOOBECompleted() {
  if (process.platform !== 'win32') return;
  try {
    await execAsync(`reg add "${REG_KEY}" /v ${REG_VALUE} /t REG_DWORD /d 1 /f`);
  } catch (err) {
    console.error('设置 OOBE 注册表失败:', err);
  }
}

async function resetOOBE() {
  if (process.platform !== 'win32') return;
  try {
    await execAsync(`reg delete "${REG_KEY}" /v ${REG_VALUE} /f`);
  } catch (err) {
    console.error('重置 OOBE 注册表失败:', err);
  }
}

/* ============ 窗口与服务器 ============ */
let mainWindow = null;
let serverInstance = null;
let currentLogger = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Luma Studio · 光影工作室',
    icon: path.join(APP_ROOT, 'public', 'favicon.ico'),
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(APP_ROOT, 'preload.cjs'),
    },
    autoHideMenuBar: true,
    show: false,
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.once('ready-to-show', () => { mainWindow.show(); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function startServer() {
  const { app: appServer, logger } = createAppServer({
    port: PORT,
    dirs: DIRS,
    logDir: LOG_DIR,
    publicDir: path.join(APP_ROOT, 'public'),
    version: app.getVersion(),
    isElectron: true,
  });
  currentLogger = logger;

  // OOBE API（仅桌面端需要，注册表持久化）
  appServer.get('/api/oobe/status', async (req, res) => {
    res.json({ completed: await checkOOBECompleted() });
  });
  appServer.post('/api/oobe/complete', async (req, res) => {
    await setOOBECompleted();
    res.json({ ok: true });
  });
  appServer.post('/api/oobe/reset', async (req, res) => {
    await resetOOBE();
    res.json({ ok: true });
  });

  return new Promise((resolve, reject) => {
    serverInstance = appServer.listen(PORT, '127.0.0.1', () => {
      logger.info('system', `服务器已启动在端口 ${PORT}`);
      console.log(`\n  📷 Luma Studio 已启动 → http://localhost:${PORT}\n`);
      resolve();
    });
    serverInstance.on('error', reject); // 端口占用等错误显式暴露
  });
}

/* ---------- 打开数据目录（v1.2 §3.7.3） ---------- */
ipcMain.handle('open-data-dir', async () => {
  const err = await shell.openPath(DATA_ROOT);
  return err ? { ok: false, error: err } : { ok: true };
});

/* ============ 进程级兜底 ============ */
process.on('uncaughtException', err => {
  if (currentLogger) currentLogger.error('system', '未捕获异常', { message: err && err.message });
  else console.error('未捕获异常:', err);
});
process.on('unhandledRejection', reason => {
  if (currentLogger) currentLogger.error('system', '未处理的 Promise 拒绝', { reason: reason && reason.message });
  else console.error('未处理的 Promise 拒绝:', reason);
});

/* ============ 单实例锁 ============ */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 已有实例在运行，退出本实例
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    migrateData();
    for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
    try {
      await startServer();
    } catch (e) {
      console.error('服务器启动失败:', e.message);
      app.quit();
      return;
    }
    createWindow();

    // macOS: 点击 dock 图标时重新创建窗口
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // 所有窗口关闭时退出(非 macOS)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // 退出前停止服务器
  app.on('will-quit', () => {
    if (serverInstance) {
      serverInstance.close();
      serverInstance = null;
    }
  });
}
