# Changelog

## v1.0.1

### 中文
- 修复 Electron 打包版首页可能显示 `Cannot GET /` 的问题
- 将应用内静态资源目录与可写数据目录拆分处理，避免打包后路径解析错误
- 修复 Windows 下 Electron 启动时可能受到 `ELECTRON_RUN_AS_NODE` 环境变量污染的问题
- 已验证打包后的桌面版可正常访问 `/` 与 `/api/info`

### English
- Fixed an issue where the packaged Electron app homepage could show `Cannot GET /`
- Separated bundled resource paths from writable data paths to avoid packaged path resolution errors
- Fixed Windows Electron launch behavior when `ELECTRON_RUN_AS_NODE` leaked into the environment
- Verified that the packaged desktop app serves both `/` and `/api/info` correctly

### Release Assets
- `Luma Studio Setup 1.0.1.exe` — Windows installer, recommended for most users
- `Luma Studio 1.0.1.exe` — Windows portable build, recommended for direct use without installation

### Notes
- This release focuses on Electron desktop packaging reliability and startup correctness.
