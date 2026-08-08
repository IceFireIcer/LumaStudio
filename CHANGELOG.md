# Changelog

## v1.2.1

### 中文
- **多开支持**：检测到已有实例时新实例弹原生对话框，可选「关闭新实例」或「多开新窗口」（自动换端口启动、共享同一数据目录，适合「只看不编」的浏览场景）
- **文件级写锁**：多开共享数据时，`db.json` / `drafts.json` / `settings.json` / 任务状态写入均加文件锁，另一实例持锁时写请求返回 409 提示；残留锁（进程已退出/超时）自动接管
- **本地访问令牌**：首启生成随机令牌存 `settings.json`，写请求须携带 `X-Luma-Token`（Electron 生产默认启用，测试/纯浏览器不强制）；设置页可查看 / 复制 / 重新生成
- **批量任务落盘**：任务状态写入 `jobs.json`，重启后恢复历史任务记录；重启时仍在运行的任务标记为「中断」并保留进度（不自动续跑）
- **性能优化**：批量处理改为 2 路有限并发（吞吐提升同时控制 sharp 内存峰值）；日志页刷新间隔可设置（3 / 10 / 30 秒，默认 3）；sharp 内部缓存仅在 Windows 上禁用（避免文件句柄锁定），其他平台启用默认缓存
- **错误体验**：损坏 / 动画 WebP 或损坏 PNG 写 EXIF 的 400 文案改为友好提示「不支持写入 EXIF，原文件未改动」；端口占用等启动失败弹原生错误窗（不再静默退出）
- 版本号同步至 v1.2.1（package.json / package-lock.json / server-app.cjs 默认值 / 关于页）

### English
- **Multi-open support**: when another instance is detected, the new instance shows a native dialog with "Close new instance" or "Open a second window" (auto-selects a free port, shares the same data directory — suited for read-only browsing)
- **Per-file write locks**: when multiple instances share the data directory, writes to `db.json` / `drafts.json` / `settings.json` / job state are guarded by file locks; a write while another instance holds the lock returns 409 with a friendly message; stale locks (dead pid / timeout) are taken over automatically
- **Local access token**: a random token is generated on first run and stored in `settings.json`; write requests must carry `X-Luma-Token` (enforced in Electron production by default; not enforced in tests / pure browser); the Settings page can view / copy / regenerate the token
- **Batch job persistence**: job state is written to `jobs.json` and restored after restart; jobs still running at restart are marked "interrupted" with progress kept (no auto-resume)
- **Performance**: batch processing now uses 2-way limited concurrency (higher throughput while capping sharp memory); the logs page refresh interval is configurable (3 / 10 / 30 s, default 3); sharp's internal cache is disabled only on Windows (to avoid file-handle locking) and enabled elsewhere
- **Better errors**: EXIF writes to broken / animated WebP or broken PNG now return a friendly 400 "unsupported, original file unchanged"; startup failures (e.g. port in use) show a native error dialog instead of silently quitting
- Version bumped to v1.2.1 (package.json / package-lock.json / server-app.cjs default / About page)

### Notes
- Multi-open with a shared data directory is primarily for browsing; concurrent edits from two instances are de-conflicted by write locks but should still be avoided
- Token enforcement is on by default only in the packaged Electron app; the node test suite and UI smoke run with it disabled to preserve existing coverage

### Release Assets
- `Luma Studio Setup 1.2.1.exe` — Windows 安装版（推荐大多数用户）
- `Luma Studio 1.2.1.exe` — Windows 便携版（免安装，数据跟随 exe）

---

## v1.2.0

### 中文
- 新增**深色模式**：浅色 / 深色手动切换，深浅共用主题色，中性色变量自动适配（含原生控件 `color-scheme`）
- 统一**设计系统**：颜色 / 间距 / 圆角 / 阴影 / 字体 / 动效全量 token 化，定制滚动条与键盘焦点样式；减弱动效升级为三态（跟随系统 / 开启 / 关闭）
- 新增全局组件：自定义确认模态框（替换原生 `confirm`）、Toast 动作按钮、`?` 快捷键速查浮层、窗口任意位置拖放上传遮罩、页面方向过渡动画
- 相册页增强：上传进度明细、网格 Flip 过渡、卡片悬停快速评分、批量条缩略图与计数、空状态 CTA
- 灯箱增强：`3 / 25` 计数、底部胶片条、EXIF 摘要条、滚轮缩放平移（1×–5×）、方向化切换动画；缩放态下方向键改为平移
- 幻灯片增强：Ken Burns 慢推、播放间隔设置（3 / 5 / 10 秒）、顶部进度条、计数
- 编辑器增强：色温 / 色调 / 暗角 / 颗粒四个新参数、滑块双击复位与改动标记、撤销/重做按钮、画布缩放平移、裁剪框三分线网格与方向键微调、前后对比任意拖动与左右/上下分屏、**编辑草稿持久化**（自动保存 / 恢复 / 导出后清除）
- EXIF 页增强：相机 / 拍摄参数 / 时间 / 文件 / GPS 分组展示、值一键复制、GPS 高德与 Google 地图链接
- 收藏夹增强：卡片首图封面、详情页完整批量条、相册页拖拽照片加入收藏夹
- 设置页新增外观卡：深色模式、减弱动效三态、快捷键速查入口；存储卡新增数据目录显示与「打开数据目录」按钮
- 日志页增强：搜索、暂停实时刷新、行展开与复制
- OOBE 更新：拖放上传引导、快捷键表同步、步骤方向动画、深色适配

### English
- Added **dark mode**: manual light/dark toggle sharing the accent color, with neutral colors adapted automatically (including native control `color-scheme`)
- Unified **design system**: colors / spacing / radius / shadows / typography / motion fully tokenized, custom scrollbars and keyboard focus styles; reduced-motion is now a tri-state (system / on / off)
- Added global components: custom confirm modal (replacing native `confirm`), toast action buttons, `?` shortcut cheatsheet, window-wide drag-and-drop upload overlay, directional page transitions
- Gallery: upload progress details, grid Flip transitions, hover quick rating, batch-bar thumbnails and count, empty-state CTAs
- Lightbox: `3 / 25` counter, bottom filmstrip, EXIF summary bar, wheel zoom/pan (1×–5×), directional navigation; arrow keys pan while zoomed
- Slideshow: Ken Burns pan, configurable interval (3 / 5 / 10 s), top progress bar, counter
- Editor: four new parameters (temperature / tint / vignette / grain), double-click slider reset and modification dots, Undo/Redo buttons, canvas zoom/pan, rule-of-thirds crop grid with arrow-key nudging, before/after drag-anywhere with left-right/top-bottom split, and **edit draft persistence** (auto-save / restore / clear after export)
- EXIF page: grouped camera / capture / time / file / GPS sections, one-click value copy, Amap and Google Maps links for GPS
- Albums: first-photo card covers, full batch bar in album detail, drag photos into the sidebar album
- Settings: new Appearance card (dark mode, reduced-motion tri-state, shortcut cheatsheet entry); storage card shows the data directory with an "Open Data Directory" button
- Logs: search, pause live refresh, row expand & copy
- OOBE: drag-and-drop guidance, synced shortcut table, step direction animations, dark-mode support

### Notes
- This is the v1.2 UI/UX redesign batch (design spec `docs/ui-redesign.md`); ROADMAP features (timeline, tags, version chains, recycle bin, more EXIF editing) remain out of scope and are planned separately.

### Release Assets
- `Luma Studio Setup 1.2.0.exe` — Windows 安装版（推荐大多数用户）
- `Luma Studio 1.2.0.exe` — Windows 便携版（免安装，数据跟随 exe）

---

## v1.1.0

### 中文
- 新增**批量处理**：多选照片统一应用预设（原图/鲜艳/柔和/复古/黑白/高对比）、百分比缩放、输出格式（保持原格式/JPEG/PNG/WebP/AVIF）与质量；后台队列 + 实时进度条 + 逐张错误隔离 + 可取消；另存副本或覆盖原图
- 新增编辑器**前后对比视图**：原图 / 编辑后分屏对比，可拖动分界线查看任意位置的差异
- 新增灯箱**并排对比选片**（C 键/对比按钮）：两张照片并排比较，`Tab` 切换标记目标，`P/R/X/U/1-5` 标记后自动进入下一组
- 新增快速选片快捷键：`X` 标记排除并自动跳转下一张，`U` 清除标记；灯箱中评分/标记后自动跳转下一张（设置中可关闭）
- 新增**隐藏排除**筛选：工具栏按钮或 `H` 键一键隐藏被排除的照片
- 修复批量评分/标记/删除被 `/api/photos/:id` 路由遮蔽导致 404 的潜在问题（批量路由改为提前注册）
- 设置页新增“选片”分组：选片标记后自动跳转下一张开关

### English
- Added **batch processing**: apply a preset (Original/Vivid/Soft/Vintage/Mono/High-contrast), percentage resize, output format (keep original/JPEG/PNG/WebP/AVIF) and quality to multiple photos at once, with a background queue, live progress, per-photo error isolation and cancel support; save as copies or overwrite originals
- Added **Before/After** comparison in the editor with a draggable divider
- Added **side-by-side compare culling** in the lightbox (`C` key/button): compare two photos, `Tab` switches the marking target, `P/R/X/U/1-5` marks and advances to the next pair
- Added fast culling shortcuts: `X` rejects and advances, `U` clears the flag; rating/flags in the lightbox auto-advance (toggle in Settings)
- Added **Hide Rejects** filter via toolbar button or `H` key
- Fixed batch stars/flag/delete endpoints being shadowed by `/api/photos/:id` routes (404); batch routes are now registered first
- Added a "Culling" section in Settings with the auto-advance toggle

### Release Assets
- `Luma Studio Setup 1.1.0.exe` — Windows installer, recommended for most users
- `Luma Studio 1.1.0.exe` — Windows portable build, recommended for direct use without installation

### Notes
- This release focuses on the photographer's culling workflow: batch processing, before/after and side-by-side comparison, fast flag shortcuts, and hide-rejects filtering.

---

## v1.0.9

### 中文
- 修复从侧边栏进入“信息”页时左侧预览空白的问题（此前只切换页面外壳，不会加载当前照片的图片与元数据；现在会自动加载）
- 修复侧边栏“编辑器”入口未加载当前照片的问题（已加载的照片进入时不重置编辑状态）
- 信息页预览改为棋盘格底并给预览图加白底，浅色/白色图片不再融入背景

### English
- Fixed the blank preview when entering the Info page from the sidebar (the view shell was shown without loading the current photo's image and metadata; it now loads automatically)
- Fixed the sidebar Editor entry not loading the current photo (edits are preserved when re-entering the same photo)
- The Info preview now uses a checkerboard background with white-bordered images, so light/white photos no longer blend into the background

### Release Assets
- `Luma Studio Setup 1.0.9.exe` — Windows installer, recommended for most users
- `Luma Studio 1.0.9.exe` — Windows portable build, recommended for direct use without installation

### Notes
- This release fixes the blank Info/Editor preview when navigating from the sidebar and improves preview contrast for light images.

---

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
