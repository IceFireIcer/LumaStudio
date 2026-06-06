# Luma Studio - Electron Releases

此分支用于存放 Luma Studio Electron 桌面版的 Windows 构建产物。

## 当前版本

- 当前发布版本：**v1.0.1**
- 包含文件：
  - `Luma Studio Setup 1.0.1.exe`（安装版，推荐大多数用户使用）
  - `Luma Studio 1.0.1.exe`（便携版，免安装直接运行）
  - `Luma Studio Setup 1.0.1.exe.blockmap`（增量更新相关文件）

## 本次修复

- 修复 Electron 打包版首页可能显示 `Cannot GET /` 的问题
- 修复打包环境下静态资源路径与可写数据路径混用的问题
- 修复 Windows 下启动时可能受 `ELECTRON_RUN_AS_NODE` 环境变量污染的问题
- 已验证桌面版可正常访问首页 `/` 与系统信息接口 `/api/info`

## 构建方式

```bash
cd LumaStudio-electron
npm install
npm run build:win
```

构建产物将输出到 `release/` 目录。
