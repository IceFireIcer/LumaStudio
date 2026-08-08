# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Luma Studio（光影工作室）是自托管的桌面图片查看器与 Lightroom 风格图片编辑器，打包为 Electron 桌面应用。后端是 Node.js + Express + sharp(libvips)；前端是原生 HTML/CSS/JS（零框架、零构建步骤）。所有源码位于 `main` 分支（`main/` 目录是一个 git worktree，主仓库在上级 `D:\Code\CherryStudio\LumaStudio`，其中只挂载 worktree，另有一个空的 `master` 主分支，勿在其中直接开发）。

## 常用命令

所有命令在仓库根（`main/`）执行。需要 Node.js >= 18。

- `npm install` — 安装依赖
- `npm start` / `npm run dev` / `npm run electron` — 启动桌面应用（经 electron-launch.cjs spawn Electron）
- `npm test` — 运行 node:test 回归套件（`test/server.test.cjs`，当前 **49 个全部通过**）
- 运行单个测试：`node --test --test-name-pattern "关键词" test/server.test.cjs`
- `npm run build:win` / `build:mac` / `build:linux` — 打包安装器到 `release/`（win 目标为 NSIS + portable）
- UI 冒烟测试：`npx electron scripts/ui-smoke.cjs`（真实 Electron 加载前端，覆盖交互验收与回归，关注 `CONSOLE-ERRORS []` 输出）。冒烟测试有硬性约束：窗口必须 `show: true`（隐藏窗口 rAF 被节流，GSAP `onComplete` 不触发）；服务器须用**固定端口**（CSRF 白名单按端口生成，端口 0 会使渲染进程 POST 全部 403）；OOBE 路由只在 electron-main.cjs 中注册，测试需注册桩；**运行前清除环境变量 `ELECTRON_RUN_AS_NODE`**（部分 shell 预设该变量，会让 Electron 以 Node 模式启动、`app` 为 undefined 直接崩）

## 架构

### 进程结构
- `electron-main.cjs` — Electron 主进程：数据目录解析（安装版在 `%APPDATA%\luma-studio`，便携版在 exe 旁 `storage/`）、数据一次性迁移（便携版首次运行从 AppData **复制**数据到 exe 旁、安装版把 exe 旁旧 `storage` 移动到 userData）、单实例锁 / 多开（v1.2.1）、OOBE（Windows 注册表 `HKCU\Software\LumaStudio`）、启动 Express 服务器并打开窗口。默认端口 `13579`，仅监听 `127.0.0.1`；多开时经 `findFreePort` 探测空闲端口。
- `server-app.cjs` — 唯一事实来源。导出 `createAppServer({ port, dirs, logDir, publicDir, version, isElectron, requireToken })` 构建 Express 应用：请求日志中间件、CSRF 同源校验（按端口生成 origin 白名单）、全部 REST API、设置持久化、日志系统。图像管线 `runPipeline()`（旋转/裁剪/调整/缩放/导出）、EXIF 读写、PNG/WebP chunk 写入、缩略图、后台批量任务、相册、搜索、ZIP 打包都在此文件。模块导出（`runPipeline`、`stripMetadata`、`readPngExif`、`sanitizeSettings`、`fixUploadName`、`decodeExifText`、`readTiffTextTags`、`extractExifTiff`、`DEFAULT_SETTINGS` 等，完整清单见文件末尾 `module.exports`）供测试直接调用。
- `electron-launch.cjs` — 启动器（spawn Electron，清理 `ELECTRON_RUN_AS_NODE` 环境变量污染）。
- `preload.cjs` — contextBridge 暴露 `window.luma.openDataDir()` 与 `window.luma.getToken()`（v1.2.1 本地访问令牌）；纯浏览器模式无此对象，前端需判空。
- `scripts/ui-smoke.cjs` — UI 冒烟测试（真实 Electron 驱动前端交互，含 v1.1 选片工作流、v1.2 验收、EXIF 方向防重叠 `MASONRY` 回归与 v1.2.1 `WEBP400` 回归）。
- `build/installer/` — Inno Setup 安装脚本（仓库源文件，勿删）。
- `docs/ui-redesign.md` — v1.2 UI/UX 改版设计规格（评审后已实现，作为当时的事实来源）。

### 前端（public/，零构建）
- `app.js` — 全部前端逻辑（视图切换、相册、灯箱、编辑器、EXIF、设置、选片、幻灯片、收藏夹、日志、上传、草稿）。
- `ui-anim.js` — GSAP 动画层，挂到 `window.UIAnim`（网格入场、灯箱开合、页面过渡、模态框、toast、Flip）；无 GSAP 时前端有降级路径。
- `index.html` / `style.css` — SPA 外壳 + token 化设计系统（深色模式 `html[data-theme="dark"]`）。
- `vendor/gsap/` — 本地拷贝的 GSAP（含 FlipPlugin，用于网格 Flip 过渡）。

### 运行时数据
照片原图、缩略图、`db.json`（照片/收藏夹）、`settings.json`、`drafts.json`、`jobs.json`（v1.2.1 批量任务落盘）、日志都在运行时数据目录，不进入仓库。`.gitignore` 排除 `release/`、`node_modules/`、运行时数据。

### 关键实现要点（需跨文件理解）
- 批量处理：`/api/photos/batch/*` 路由**必须注册在 `/api/photos/:id` 之前**，否则 `batch` 被当成 `:id`。任务状态存 `jobs` Map（`createAppServer` 闭包内，最多保留 20 个）+ **v1.2.1 起落盘 `jobs.json`**（重启恢复记录，running → 标记中断不续跑）；批量任务 2 路有限并发（worker 共享索引，取消/错误隔离语义保持）；已生成的副本/覆盖结果不回滚。
- PNG/WebP EXIF：`piexif.dump()` 输出自带 `Exif\0\0` 前缀，直接作 chunk 数据；PNG 的 `eXIf` 插在 `IEND` 前，WebP 的 `EXIF` 必须在图像数据之后（无 VP8X 时新建，画布尺寸为 24 位小端 `宽-1/高-1`，EXIF 标志 `0x08`）。exifr 的 Node 版不读 WebP EXIF，读取走 `readPngExif/readWebpExif + piexif.load` 自解析。
- EXIF 方向：`buildMeta` 对 orientation ≥ 5 交换入库宽高（存旋转后显示尺寸，与缩略图一致）；前端 `layoutMasonry` 优先用缩略图真实宽高比排版并在懒加载完成后防抖重排，防止竖拍照片卡片重叠。
- 键盘快捷键优先级：对比模式 > 灯箱 > 编辑器 > 相册。
- 草稿持久化：编辑参数经 `/api/photos/:id/draft` 自动保存（debounce 800ms），导出成功后 DELETE；`openEditor` 先 `clearTimeout(draftTimer)` 避免上一张的待保存草稿写入新照片。
- Windows 上 sharp 内部缓存已禁用（`sharp.cache(false)`）避免文件句柄锁定（v1.2.1 起仅 Windows 禁用，其他平台用默认缓存）。
- **文件级写锁（v1.2.1）**：`persistWithLock` 用 `wx` 原子建 `<file>.lock`（含 pid+时间戳，30s/死 pid 判残留接管）；db/drafts/settings/jobs 写都过锁，冲突抛 `LumaWriteConflict` → 错误中间件 409；批量任务用 `persistDBWithRetry`（3×200ms）。
- **本地令牌（v1.2.1）**：`TOKEN_ENABLED = requireToken ?? isElectron`；写请求校验 `X-Luma-Token`；令牌存 `settings.json` 不入公开 `/api/settings`；preload `getToken()` ← IPC `get-auth-token` ← `createAppServer().getAuthToken()`；重置 `POST /api/auth/reset-token`。
- **多开（v1.2.1）**：单实例锁失败 → `dialog.showMessageBox` 询问；选多开则 `findFreePort` 探测空闲端口，`bootstrap(port, { migrate:false })` 共享数据目录启动；`activePort` 供 `createWindow` 加载正确 URL。

### 前端 v1.2 实现要点（接手必读）
- **网格 Flip**：`renderGrid()` 是整体重建 DOM，`Flip.from(state)` 必须传 `targets: cards`（新元素集合），否则 Flip 补间的是已脱离文档的旧节点。
- **灯箱换源**：`showLbPhoto(0)`（首次打开/胶片条跳转）必须**同步**设置 `img.src`，不要用 crossfade 异步换源——紧随其后的 `UIAnim.lightbox` 开合动画对同一 img 用 `overwrite:'auto'`，会把 crossfade tween 杀掉导致 src 永不赋值（图片空白）。
- **GSAP 警告**：`gsap.quickTo(el,'scale')` 创建后立即调用 setter 会触发 "scale not eligible for reset" 一次性警告；画布/灯箱缩放改用 `gsap.to + overwrite:'auto'`（scale 0.2-0.25s、平移 0.08-0.12s），语义等价且零警告。
- **缩放 clamp**：`clampLbPan/clampCanvasPan` 基于 `getBoundingClientRect()`（天然含 transform）；图片小于视口时 max=0（禁止平移是正确行为，冒烟测试需先把图放大到超过视口再验证平移）。
- **全局拖放上传**：window `drop` handler 必须跳过 `e.target.closest('#dropzone')` 的事件——dropzone 自己的 drop 会冒泡到 window，否则同一批文件上传两次（冒烟 `DROP-ONCE` 回归锁定）。
- **收藏夹详情页刷新**：`renderGrid()` 只重建库视图 `#grid`；详情页内批量全选/取消、缩略图取消、评分等走 `refreshCurrentGrid()`（→ `renderAlbumGrid`），否则可见卡片选中/星星状态不更新（冒烟 `ALBUM-BATCH` 回归锁定）。
- **瀑布流防重叠**：`layoutMasonry` 用 `cardRatio()` 优先取缩略图真实宽高比（`img.complete && naturalWidth > 0`），不再直接依赖入库宽高；缩略图懒加载完成后经 `scheduleMasonry`（80ms 防抖）重排。配套 `buildMeta` 对 EXIF orientation ≥ 5 交换宽高，新上传照片入库比例与缩略图一致；已有照片由前端重排自动修复，无需数据迁移。冒烟 `MASONRY` 回归锁定。

## 编码规范
- 2 空格缩进、单引号、分号；未配置 linter，匹配现有风格。
- `server-app.cjs` / Electron 主文件用 CommonJS（`require`）；`public/` 用纯浏览器 JS（无模块）。
- camelCase 命名、小写文件名；源码注释用中文。
- 修复 bug 时先在 `test/` 补可复现的 node:test 回归测试（现有覆盖：旋转/裁剪坐标、无损 EXIF 抹除、请求日志、设置校验、CSRF、上传净化、DB 损坏恢复、PNG/WebP EXIF 往返、中文文件名/EXIF、批量路由回归、草稿、EXIF 方向、本地令牌、写锁、批量任务落盘、WebP 400、日志刷新间隔校验）。
- 提交用 Conventional Commits + 中文描述（`feat:` / `fix:` / `docs:` / `chore:` / `release:`）。
- PR 规范：target `main`；描述变更并关联 issue；UI 变更附截图；发版类 PR 需同步更新 `CHANGELOG.md`（中文 + English）并 bump `package.json` 版本。
- 新增前端交互时同步扩展 `scripts/ui-smoke.cjs` 覆盖。

## 发版流程（每次一致）
1. 改版本号，需同步 4 处：`package.json` + `package-lock.json` + `server-app.cjs` 的 `createAppServer` 默认版本 + `index.html` 关于页。
2. 更新 `CHANGELOG.md`（中文 + English + Release Assets + Notes）。
3. `release:` 提交 → push `main` → `git tag -a vX.Y.Z` + push tag → `gh release create vX.Y.Z --title "Luma Studio vX.Y.Z 桌面版" --notes-file ... --latest`。
4. 产物命名：`Luma Studio Setup X.Y.Z.exe`（安装版）/ `Luma Studio X.Y.Z.exe`（便携版）。
5. README 只保留 `README.md`（中文）与 `README_en.md`（英文），两者内容需保持同步，勿新增其他语言变体。

## 注意事项 / 陷阱
- 无公网认证，仅限本机/个人使用，勿暴露公网。
- 端口 13579 被占用则启动失败；便携版与安装版因单实例锁基于 userData 不能同时运行。
- EXIF 写入仅支持 JPEG/PNG/WebP；损坏或不支持的 WebP 变体会安全返回 400。
- 构建/测试的 `DEP0190`、LF/CRLF DeprecationWarning 无害可忽略；冒烟测试的 Chromium GPU 报错（`command_buffer_proxy_impl`）是窗口噪声，关注 `CONSOLE-ERRORS`。
- 批量任务状态在内存中，重启即失；已生成的副本/覆盖结果不会回滚。
- 运行时照片数据、`storage/` 内容、`release/`、`release.old-*/`、`node_modules/` 一律不提交（见 `.gitignore`）。
- 更多细节见 `handover.md`（交接文档）、`docs/ui-redesign.md`（v1.2 设计规格）、`ROADMAP.md`、`CHANGELOG.md`、`AGENTS.md`。

## 故障排查
- **"数据不见了"**：先分清安装版还是便携版——便携版数据在 exe 旁 `storage/`，安装版在 `%APPDATA%\luma-studio`；换目录/换机器不会自动跟过去。
- **键盘快捷键整体失效**：检查 keydown 监听是否被异常打断；注意**对比模式优先级最高**，会吞掉灯箱/相册的按键；确认是否在输入框内。
- **EXIF 写入 400**：仅支持 JPEG/PNG/WebP；WebP 变体（动画等）可能被安全拒绝。
- **信息页/编辑器预览空白**：从侧边栏进入应自动加载当前照片（`openExif/openEditor(current)`，`lastExifId/lastEditorId` 防重复加载）；若再出现，先查日志里是否有 `GET /api/photos/:id/exif`。
- **点击图片不进预览 / 打开的是相邻照片**：EXIF 方向照片瀑布流重叠所致，v1.2.0 已修复（`buildMeta` 存旋转后宽高 + 前端按缩略图真实比例排版并加载后重排）；若再出现，先确认是否旧版本构建，或该照片缩略图是否加载失败（失败时回落用入库宽高比）。
