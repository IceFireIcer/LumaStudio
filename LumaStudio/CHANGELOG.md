# Changelog

## v1.0.3

### 中文
- 新增完整日志系统:自动检测运行环境(便携版创建lumastudio-log,安装版创建log),实时显示前后端日志(3秒自动刷新)
- 新增日志过滤器(级别/来源)和清空功能,日志文件自动轮转(10MB限制)
- 新增自定义输入模态框,替换浏览器prompt()对话框,用于新建/重命名收藏夹时的命名输入
- 将默认端口从3000/8765改为7443(冷门端口,避免与常见Web开发端口冲突)
- 改进Electron环境检测逻辑,使用process.versions.electron而非检查文件存在性
- 同步源代码到windows-releases分支,确保BAT包版本功能一致

### English
- Added comprehensive logging system: auto-detects runtime environment (portable creates lumastudio-log, installed creates log), real-time frontend/backend log display (3-second auto-refresh)
- Added log filters (level/source) and clear functionality, log file auto-rotation (10MB limit)
- Added custom input modal replacing browser prompt() dialogs for album creation/rename operations
- Changed default port from 3000/8765 to 7443 (uncommon port to avoid conflicts with common web dev ports)
- Improved Electron environment detection using process.versions.electron instead of file existence checks
- Synced source code to windows-releases branch ensuring BAT package version feature parity

### Release Assets
- `Luma Studio Setup 1.0.3.exe` — Windows installer, recommended for most users
- `Luma Studio 1.0.3.exe` — Windows portable build, recommended for direct use without installation
- `Luma Studio BAT 1.0.3.zip` — Windows bat-script edition, packaged as a zip for release distribution

### Notes
- This release focuses on developer tooling (logging system) and improved user experience (custom modals).

---

## v1.0.2

### 中文
- 修复 Electron 便携版前端脚本与页面结构不同步导致的初始化报错问题
- 修复便携版启动后按钮看似可点击但实际没有功能的问题
- 将 Electron 前端资源重新与 main 主线同步，恢复视图切换和页面交互
- 保持打包资源路径与可写数据路径分离，避免便携版路径解析错误
- 修复 Windows 下 Electron 启动时可能受到 `ELECTRON_RUN_AS_NODE` 环境变量污染的问题
- 已验证打包后的桌面版可正常访问 `/`、`/api/info`，并可正常切换设置页与关于页

### English
- Fixed the front-end bundle mismatch that caused initialization errors in the portable Electron build
- Fixed the issue where buttons in the portable build appeared clickable but had no actual behavior after startup
- Re-synced Electron front-end assets with the main branch UI and interaction logic
- Kept packaged resource paths separated from writable data paths to avoid portable path resolution errors
- Fixed Windows Electron launch behavior when `ELECTRON_RUN_AS_NODE` leaked into the environment
- Verified that the packaged desktop app serves `/` and `/api/info` correctly and supports normal in-app view switching

### Release Assets
- `Luma Studio Setup 1.0.2.exe` — Windows installer, recommended for most users
- `Luma Studio 1.0.2.exe` — Windows portable build, recommended for direct use without installation
- `Luma Studio BAT 1.0.2.zip` — Windows bat-script edition, packaged as a zip for release distribution

### Notes
- This release focuses on fixing broken desktop interactions and re-aligning downstream builds with the main source branch.
