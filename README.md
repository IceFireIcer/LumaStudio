# Luma Studio - Electron Releases

此分支用于存放 Luma Studio Electron 桌面版的 Windows 构建产物。

## 当前版本

- 当前发布版本：**v1.0.2**
- 包含文件：
  - `Luma Studio Setup 1.0.2.exe`（安装版，推荐大多数用户使用）
  - `Luma Studio 1.0.2.exe`（便携版，免安装直接运行）
  - `Luma Studio Setup 1.0.2.exe.blockmap`（增量更新相关文件）

## 本次修复

- 修复 Electron 便携版前端脚本与页面结构不同步导致的初始化报错问题
- 修复便携版启动后按钮看似可点击但实际没有功能的问题
- 将 Electron 前端资源重新与 main 主线同步，恢复页面交互
- 修复 Windows 下启动时可能受 `ELECTRON_RUN_AS_NODE` 环境变量污染的问题
- 已验证桌面版可正常访问 `/`、`/api/info`，并可正常切换设置页与关于页

## 构建方式

```bash
cd LumaStudio-electron
npm install
npm run build:win
```

构建产物将输出到 `release/` 目录。
