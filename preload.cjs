/**
 * Luma Studio — Electron preload
 * 通过 contextBridge 暴露最小化本机能力（当前仅"打开数据目录"）。
 * 渲染端通过 window.luma?.openDataDir() 调用，不存在时按钮禁用（如纯浏览器模式）。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('luma', {
  openDataDir: () => ipcRenderer.invoke('open-data-dir'),
});
