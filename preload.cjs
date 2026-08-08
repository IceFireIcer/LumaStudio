/**
 * Luma Studio — Electron preload
 * 通过 contextBridge 暴露最小化本机能力：
 *  - openDataDir()：打开数据目录
 *  - getToken()：返回本地访问令牌（v1.2.1 安全增强，供渲染进程写请求鉴权）
 * 渲染端通过 window.luma?.xxx 调用，不存在时降级（如纯浏览器模式）。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('luma', {
  openDataDir: () => ipcRenderer.invoke('open-data-dir'),
  getToken: () => ipcRenderer.invoke('get-auth-token'),
});
