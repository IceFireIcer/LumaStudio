# Changelog

## v1.0.8

### 中文
- 修复导入中文文件名照片后名称乱码的问题（multipart 文件名按 UTF-8 重新解码；启动时自动修正历史乱码文件名）
- 修复外部照片中文 EXIF（作者/版权/描述/软件等）在 UTF-16 / GBK 编码下读取乱码的问题（按 BOM / UTF-8 / GBK 智能解码）
- 修复网格卡片悬停时左上角复选框与像素尺寸角标重叠的问题

### English
- Fixed garbled Chinese file names on import (multipart filenames are re-decoded as UTF-8; existing mojibake names are auto-fixed on startup)
- Fixed garbled Chinese EXIF text (Artist/Copyright/Description/Software) from external photos encoded as UTF-16 or GBK (now decoded via BOM/UTF-8/GBK detection)
- Fixed the pixel-size badge overlapping the selection checkbox on card hover

### Release Assets
- `Luma Studio Setup 1.0.8.exe` — Windows installer, recommended for most users
- `Luma Studio 1.0.8.exe` — Windows portable build, recommended for direct use without installation

### Notes
- This release fixes Chinese text garbling (file names and EXIF metadata from external tools) and the card hover badge/checkbox overlap.

---

## v1.0.7

### 中文
- 相册改为瀑布流布局（GSAP 驱动，卡片按图片原始比例显示，DOM 顺序与灯箱/幻灯片保持一致，支持"减弱动态效果"偏好）
- 便携版数据目录跟随 exe（数据存到 exe 旁 storage/，首次运行自动复制 %APPDATA% 中的已有数据；exe 目录不可写时自动回退 userData 并记录日志）
- 批量评分与"加入收藏夹"改用自定义模态框（评分带 0-5 校验，收藏夹改为点选而非手输编号）
- 收藏夹详情页新增空状态提示
- EXIF 编辑扩展至 PNG / WebP（无损 chunk 级写入，保留原有其他 EXIF 字段，读取同样支持）
- 修复键盘快捷键全部失效的问题（误引用不存在的 #editor 元素导致撤销/重做、评分、标记、幻灯片快捷键不可用）
- 修复编辑器"重置全部"未重置旋转/翻转/裁剪的问题
- 修复 UI 冒烟测试无法捕获渲染进程错误的问题（兼容 Electron 32+ console-message 事件），并新增键盘事件检查

### English
- Library now uses a masonry layout (GSAP-driven, cards keep the original image ratio; DOM order stays aligned with lightbox/slideshow; supports prefers-reduced-motion)
- Portable build now stores data next to the exe (exe-side storage/); on first run it copies existing data from %APPDATA%; falls back to userData with a log warning when the exe directory is not writable
- Batch rating and "add to album" now use the custom modal system (rating validated 0-5, album picked by clicking instead of typing an index)
- Added an empty state for album detail pages
- EXIF editing extended to PNG / WebP (lossless chunk-level write, preserves other EXIF fields; reading supported too)
- Fixed all keyboard shortcuts being broken (a reference to a non-existent #editor element threw on every keydown)
- Fixed the editor "Reset All" button not resetting rotation/flip/crop
- Fixed the UI smoke test not capturing renderer errors (Electron 32+ console-message compatibility) and added a keydown check

### Release Assets
- `Luma Studio Setup 1.0.7.exe` — Windows installer, recommended for most users
- `Luma Studio 1.0.7.exe` — Windows portable build, recommended for direct use without installation

### Notes
- This release focuses on completing previously unimplemented features (masonry, portable data, batch modals, PNG/WebP EXIF) plus keyboard and reset fixes.

---

## v1.0.6

### 中文
- 新增 GSAP 驱动的 UI 动效（网格卡片入场、灯箱、幻灯片、Toast、模态框），支持系统"减弱动态效果"偏好（prefers-reduced-motion），GSAP 缺失时自动降级为原有 CSS 过渡
- 新增 UI 冒烟测试脚本，用 Electron 真实加载前端并捕获渲染进程 JS 错误（scripts/ui-smoke.cjs）
- 新增 Inno Setup 安装脚本并内置简体中文语言文件，安装包支持选择安装目录与创建快捷方式
- 应用源码迁移至仓库根目录，移除 LumaStudio-electron 子目录与冗余的 Web 版代码，服务端逻辑统一到 server-app.cjs
- 默认 README 改为中文版，英文版移至 README_en.md
- 修复日志时间显示为 UTC 的问题，改为本地时区时间（中国用户即 UTC+8）
- 修复日志页实时刷新滚动位置错误的问题，现自动停留在最新日志（顶部）

### English
- Added GSAP-powered UI animations (grid entrance, lightbox, slideshow, toast, modal) with prefers-reduced-motion support and graceful fallback to CSS transitions
- Added UI smoke test script that loads the frontend in a real Electron window and captures renderer errors (scripts/ui-smoke.cjs)
- Added Inno Setup installer script with a bundled Simplified Chinese language file; installer supports choosing the install directory and creating shortcuts
- Moved app source to the repository root, removed the LumaStudio-electron subdirectory and redundant web-only code, consolidating server logic in server-app.cjs
- Default README is now Chinese; the English version moved to README_en.md
- Fixed log timestamps showing UTC; now use local timezone (UTC+8 in China)
- Fixed the log view real-time refresh scrolling to the wrong position; now stays on the newest logs at the top

### Release Assets
- `Luma Studio Setup 1.0.6.exe` — Windows installer, recommended for most users
- `Luma Studio 1.0.6.exe` — Windows portable build, recommended for direct use without installation

### Notes
- This release focuses on UI polish (GSAP animations with reduced-motion support), a proper Inno Setup installer, and logging fixes (local timestamps + correct real-time scrolling).

---

## v1.0.5

### 中文
- 修复编辑器旋转功能在保存/下载时被静默忽略的问题（sharp 自动方向校正与显式旋转冲突）
- 修复旋转/翻转后裁剪区域与实际输出不一致的问题，坐标统一在源像素空间换算
- 修复"抹除全部元数据"导致照片被有损重压缩的问题，JPEG 现改为无损移除 EXIF
- 修复请求日志中间件位置错误导致大部分 API 请求不记录的问题
- 修复设置项未校验导致上传失败的问题（thumbSize 等非法值会被钳制到安全范围）
- 升级 multer 至 2.x，修复已知安全漏洞
- 新增同源校验，阻止恶意网页跨站操纵本地服务（CSRF）
- 新增统一错误处理与进程级异常兜底，避免异常导致崩溃
- 上传增加扩展名白名单、真实格式校验与逐文件错误隔离，失败不再产生孤儿文件
- ZIP 导出文件名净化，防止非法字符与路径逃逸
- db.json 改为原子写入，损坏时自动备份并回退
- Electron：数据目录迁移至 userData（含旧数据一键迁移），新增单实例锁
- 删除 web 版与重复代码（server.js / electron-main.mjs），服务端逻辑统一到 server-app.cjs
- 新增 node:test 回归测试（npm test），覆盖上述缺陷

### English
- Fixed editor rotation being silently ignored in saved/downloaded output (sharp auto-orient conflicted with explicit rotation)
- Fixed crop region mismatch after rotate/flip; coordinates now unified in source pixel space
- Fixed "strip all metadata" re-compressing photos lossily; JPEG now strips EXIF losslessly
- Fixed request-logging middleware placement so API requests are actually logged
- Added settings validation (invalid values such as thumbSize are clamped)
- Upgraded multer to 2.x (known CVEs fixed)
- Added same-origin check to block cross-site requests to the local service (CSRF)
- Added unified error handling and process-level fallbacks
- Upload now validates extension and real image format, and isolates per-file failures (no orphan files)
- Sanitized ZIP entry names
- db.json now written atomically with corrupt-backup recovery
- Electron: data moved to userData with one-time legacy migration; added single-instance lock
- Removed web version and duplicated code (server.js / electron-main.mjs); server logic consolidated in server-app.cjs
- Added node:test regression suite (npm test)

## v1.0.4

### 中文
- 新增 OOBE（开箱即用体验）首次运行引导教程，通过 Windows 注册表持久化状态
- 新增设置页面"重置引导教程"按钮，允许用户重新触发 OOBE 流程
- 修复日志轮转功能无限累积备份文件的问题，现仅保留最近 3 个备份
- 修复清空日志功能未删除轮转备份文件的问题
- 修复日志写入失败时可能导致服务器崩溃的问题，增加异常捕获
- 修复日志 API 返回计数不准确的问题，现正确返回匹配总数与实际返回数
- 修复前端日志渲染时字段为空可能导致崩溃的问题，增加空值防护
- 修复日志来源字段存在 XSS 风险的问题，改用 textContent 安全渲染

### English
- Added OOBE (Out-of-Box Experience) first-run tutorial with Windows Registry persistence
- Added "Reset Tutorial" button in settings page allowing users to re-trigger OOBE flow
- Fixed log rotation creating unlimited backup files, now keeps only the 3 most recent backups
- Fixed log clear functionality not deleting rotated backup files
- Fixed potential server crash on log write failure, added exception handling
- Fixed log API returning inaccurate counts, now correctly returns total matched vs actual returned
- Fixed frontend log rendering crash when fields are null/undefined, added null guards
- Fixed XSS vulnerability in log source field rendering, switched to safe textContent pattern

### Release Assets
- `Luma Studio Setup 1.0.4.exe` — Windows installer, recommended for most users
- `Luma Studio 1.0.4.exe` — Windows portable build, recommended for direct use without installation
- `Luma Studio BAT 1.0.4.zip` — Windows bat-script edition, packaged as a zip for release distribution

### Notes
- This release focuses on first-run user experience (OOBE) and comprehensive logging system stability improvements.

---

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
