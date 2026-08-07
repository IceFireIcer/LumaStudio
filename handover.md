# Luma Studio 交接文档（HANDOVER）

> 给下一个接手的人/Agent：本文档记录项目现状、已实现功能、关键决策与各种需要注意的情况。
> 版本更新历史见 [CHANGELOG.md](CHANGELOG.md)，功能规划见 [ROADMAP.md](ROADMAP.md)，仓库规范见 [AGENTS.md](AGENTS.md)，功能清单见 [README.md](README.md)（中文）与 [README_en.md](README_en.md)。本文不重复这些内容，只做索引与上下文补充。

## 1. 项目概况

- **项目**：Luma Studio · 光影工作室 —— 自托管桌面版图片查看器与 Lightroom 风格编辑器
- **形态**：Electron 桌面应用（Node.js + Express 后端，sharp/libvips 图像管线，原生 HTML/CSS/JS 前端，零构建步骤）
- **仓库**：https://github.com/IceFireIcer/LumaStudio ，单一分支 `main`（git 仓库根 = 本目录）
- **当前版本**：v1.2.0（UI/UX 改版批次，实现已完成并通过 `npm test` 与 UI 冒烟；待评审/发版），`package.json` / `package-lock.json` / `server-app.cjs` 默认值 / `index.html` 关于页版本号同步维护；**工作区另有未提交的 bug 修复（EXIF 方向照片瀑布流重叠导致点图片不进预览），详见 §3 与 §4.5**
- **最近版本发布提交**：`0afffc9` release: 发布 v1.1.0（选片工作流增强）；v1.2 规格见 `docs/ui-redesign.md`（唯一事实来源），最新 HEAD 以 `git log` 为准
- **README 政策（v1.1.0 起）**：仅保留中文主文档 `README.md` 与英文版 `README_en.md`，de/es/fr/ja/ko 变体已移除，勿再新增

## 2. 代码结构（仓库根）

| 文件 | 职责 |
|---|---|
| `server-app.cjs` | 唯一事实来源：Express 应用、图像处理管线、日志、EXIF 读写、PNG/WebP chunk 写入、相册/批量/后台任务/ZIP/搜索等全部 REST API |
| `electron-main.cjs` | Electron 主进程：数据目录解析（便携版/安装版）、单实例锁、OOBE 注册表、启动服务器与窗口 |
| `preload.cjs` | Electron preload：`contextBridge` 暴露 `window.luma.openDataDir()`（打开数据目录，v1.2 新增） |
| `electron-launch.cjs` | 启动器（spawn Electron，清理 `ELECTRON_RUN_AS_NODE` 污染） |
| `public/` | 前端：`index.html` / `style.css` / `app.js` / `ui-anim.js`（GSAP 动画层）/ `vendor/gsap/`（含 `FlipPlugin.min.js`，v1.2 从 gsap npm 包复制） |
| `scripts/ui-smoke.cjs` | UI 冒烟测试：真实 Electron 加载前端，覆盖 v1.1.0 选片工作流交互、v1.2 验收用例与 EXIF 方向防重叠回归（`MASONRY`），捕获渲染进程错误 |
| `test/server.test.cjs` | node:test 回归测试（当前 34 个，全部通过） |
| `build/installer/` | Inno Setup 安装脚本（仓库源文件，勿删） |
| `ROADMAP.md` / `CHANGELOG.md` / `README.md` / `README_en.md` / `AGENTS.md` / `handover.md` | 规划 / 版本日志 / 文档 / 仓库规范 / 本交接文档 |

## 3. 已实现功能（v1.1.0 现状）

### v1.2 UI/UX 改版（2026-08-07，规格：docs/ui-redesign.md）
- **设计系统**：颜色/间距/圆角/阴影/动效全量 token 化；深色模式 `html[data-theme="dark"]`（settings.theme，手动二态）；预置 6 色板暗色变体写死 CSS，非预置色用 `color-mix` 兜底；定制滚动条与 `:focus-visible`
- **全局组件**：`showConfirm` 替代全部原生 `confirm()`；toast 动作按钮（`toast(msg, opts)`）；`?` 快捷键速查浮层（`SHORTCUTS` 常量表驱动）；窗口任意位置拖放上传遮罩；`UIAnim.switchView` 方向化页面过渡；`UIAnim.navCrossfade` 方向化灯箱导航
- **相册**：dropzone 紧凑条、上传进度明细（逐张 + 成功/失败汇总）、网格 Flip（`FlipPlugin.min.js` + `Flip.getState`/`Flip.from`，重建 DOM 需传 `targets: cards`）、hover 快捷评分、批量条缩略图 + `#libCount` 计数、空状态 CTA
- **灯箱**：`#lbIndex` 计数药丸、`#lbFilmstrip` 胶片条、`#lbExif` EXIF 摘要（`lbExifCache` 内存缓存）、滚轮缩放平移 1×–5×（transform 挂 `.lb-zoom`，缩放态 `←/→` 平移、选片键仍生效、与对比互斥）
- **幻灯片**：Ken Burns 慢推（奇偶张交替缩放）、`settings.slideshowInterval`（3/5/10s）、`#slProgress` 顶部进度条
- **编辑器**：色温/色调/暗角/颗粒新参数（服务端 sharp 近似：temperature/tint 用 recomb 矩阵、vignette/grain 用最终尺寸叠加）、滑块双击复位 + 改动标记、撤销/重做按钮、画布缩放平移（`.canvas-zoom` 统一挂 transform）、裁剪框三分线 + 方向键微调 + 贴边吸附、前后对比任意拖动 + 左右/上下分屏（`--ba-dir`）、**草稿持久化**（`/api/photos/:id/draft`，debounce 800ms，导出成功后 DELETE）
- **EXIF**：相机/拍摄参数/时间/文件/GPS 分组展示、值一键复制（GPS 附"打开地图"动作）、GPS 高德/Google 链接
- **收藏夹**：卡片首图封面（`cover` 字段）、详情页完整批量条（`createCard` 复用 + `refreshAfterBatch` 留在当前收藏夹刷新）、卡片拖拽到侧边栏"收藏夹"加入、详情页窗口拖放自动上传并加入
- **设置**：外观卡（深色模式、减弱动效三态 `system|on|off`、快捷键速查按钮）、存储卡显示 `dataDir` + 打开数据目录（preload）
- **日志**：搜索框、暂停实时刷新、行展开与复制；**OOBE**：步骤方向动画、拖放引导、快捷键表同步、深色适配

### 修复：EXIF 方向照片瀑布流重叠（2026-08-07，工作区未提交）
- **症状**：相册页点击照片图片进不了预览（或打开的是相邻照片），点文件名才能正常打开——竖拍照片（EXIF orientation 5-8）入库宽高未按方向旋转，瀑布流按错误比例排版导致卡片互相重叠，图片区域被下一张卡片盖住
- **修复（两层）**：`buildMeta` 对 orientation ≥ 5 交换宽高、存旋转后的显示尺寸（与缩略图一致）；前端 `layoutMasonry` 优先用缩略图真实宽高比排版，并在缩略图懒加载完成后防抖重排
- **对已有照片**：无需重新上传/迁移数据，前端按真实比例重排即自动修复；新上传照片同时获得正确的入库宽高（EXIF 页/灯箱/编辑器尺寸显示随之修正）
- **回归**：node:test 新增“EXIF 方向照片入库宽高为旋转后的显示尺寸（与缩略图比例一致）”；冒烟新增 `MASONRY` 防重叠检查（6 张混合照片，`bad=[]`）

### v1.1.0 现状（基础能力，v1.2 保持）

- **相册**：上传（拖拽/点击，JPG/PNG/WebP/AVIF/GIF/TIFF/BMP）、WebP 缩略图、**瀑布流布局**（GSAP 驱动，DOM 顺序=视觉顺序）、搜索/排序/筛选、灯箱、幻灯片
- **编辑器**：6 种预设、亮度/对比度/饱和度/色相/锐化/模糊/黑白、撤销重做（Ctrl+Z/Y）、旋转/翻转/交互式裁剪、像素与百分比缩放、JPEG/PNG/WebP/AVIF 导出（另存副本/覆盖原图/下载）、**前后对比视图**（原图/编辑后分屏，可拖动分界线）
- **批量处理（v1.1.0）**：多选统一应用预设/百分比缩放/输出格式（保持原格式/JPEG/PNG/WebP/AVIF）/质量；后台队列 + 实时进度条 + 逐张错误隔离 + 可取消；另存副本或覆盖原图
- **选片（v1.1.0 增强）**：1-5 星、精选/排除（P/R）、**X 排除并跳转 / U 清除标记**、灯箱标记后自动跳转（设置 `autoAdvance` 可关）、**隐藏排除（H / 工具栏按钮）**、**灯箱并排对比选片（C，Tab 切换标记目标）**、批量评分/标记/删除/ZIP、收藏夹
- **EXIF**：查看、编辑（JPEG 走 APP1；**PNG/WebP 走 eXIf/EXIF chunk 无损写入**）、无损抹除
- **中文兼容（v1.0.8）**：上传文件名按 UTF-8 还原（启动时自动修正历史乱码名）；EXIF 文本从 TIFF 字节解析，按 BOM → UTF-8 → GBK 智能解码，外部软件写的 UTF-16 / GBK 中文不再乱码
- **预览修复（v1.0.9）**：信息页/编辑器从侧边栏进入自动加载当前照片（`lastExifId`/`lastEditorId` 防重复加载/重置）；信息页预览棋盘格底 + 图片白边，浅色图清晰可见
- **系统**：设置持久化、日志系统（本地时区、3 秒实时刷新、过滤/清空）、OOBE 首次引导、GSAP 动效（支持减弱动效）、Inno Setup 安装脚本、**便携版数据跟随 exe**

## 4. 关键决策与实现细节（接手前必读）

### 4.1 数据目录（重要）

- **安装版**：数据在 `%APPDATA%\luma-studio`（uploads / thumbs / data / log）
- **便携版**（electron-builder portable 目标）：检测 `process.env.PORTABLE_EXECUTABLE_DIR`，数据存 **exe 旁 `storage/`**；首次运行若 exe 旁无数据而 AppData 有，则**复制**（不是移动，避免搬空安装版数据）一次；exe 目录不可写时回退 userData 并打印警告
- **单实例锁仍基于 userData**：便携版与安装版不能同时运行（端口 13579 固定，本就不能并存）
- OOBE 完成状态在 Windows 注册表 `HKCU\Software\LumaStudio`（便携版也写注册表，属已知取舍）
- 旧版（v1.0.5 之前）数据在 exe 旁 `storage`：安装版启动时会迁移到 userData

### 4.2 PNG/WebP EXIF（v1.0.7 新增，技术要点）

- `piexif.dump()` 输出**自带 `Exif\0\0` 前缀**，直接作为 chunk 数据即可（与 libwebp 一致）
- PNG：`eXIf` chunk 插在 `IEND` 之前；WebP：`EXIF` chunk 必须放在**图像数据之后**，无 VP8X 时需新建 VP8X（EXIF 标志位 `0x08`，画布尺寸为 **24 位小端** `宽-1/高-1`）
- **exifr 的 Node 版不读 WebP EXIF**（`Unknown file format`），读取路径用 `readPngExif/readWebpExif + piexif.load` 自解析
- 损坏或不支持的变体（部分动画 WebP）会安全返回 400，不写坏原图
- 相关函数：`readPngExif / writePngExif / readWebpChunks / readWebpExif / writeWebpExif / loadTiffFromChunk / crc32`（已导出，便于测试）

### 4.3 批量处理与后台任务（v1.1.0，技术要点）

- 路由顺序：`/api/photos/batch/*`（stars/flag/delete/process）**必须注册在 `/api/photos/:id` 之前**，否则 `batch` 会被当作 `:id` 吞掉返回 404（v1.1.0 修复，有回归测试锁定）
- `POST /api/photos/batch/process`：`{ ids, pipeline, mode }` → 立即返回 `{ jobId, total }`；`ids` 上限 500
- 任务状态保存在**内存** `jobs` Map（`createAppServer` 闭包内），最多保留 20 个（只清理已结束任务）；`GET /api/jobs/:id` 轮询进度，`POST /api/jobs/:id/cancel` 置 `canceled` 标志，循环在每张照片之间检查
- 逐张顺序处理（避免 sharp 并发内存压力）；每张照片独立 try/catch，**错误隔离不中断整批**；每处理一张 `persistDB()` 一次
- `pipeline.output.format === 'keep'` 时按每张照片真实格式解析（gif/tiff/bmp 不支持输出，回退 jpeg）；`pipeline.resizeScale`（0.05–1）按每张照片自身像素换算宽高
- 任务与进度**不持久化**：应用重启后任务记录消失，但已落盘的照片（含副本）保留

### 4.4 前端（v1.1.0 更新）

- 瀑布流：`layoutMasonry()`（短列优先，left/top 静态定位，入场动画由 `UIAnim.gridIn` 用 transform 完成并 `clearProps` 还原 hover 效果）；无 GSAP 时自动退回原 CSS 网格
- 模态框体系：`showInputModal`（文本输入）+ `showSelectModal`（选项点选）+ 专用 `#batchModal`（批量处理，含进度条与逐张错误列表）
- 前后对比：`#baOrigImg` 绝对定位铺满画布，`clip-path: inset(0 calc(100% - var(--ba)) 0 0)` 与分界线共用 `--ba` 变量（百分比均相对画布），拖拽分界线更新变量；对比时隐藏裁剪框
- 灯箱并排对比：`cmpActive / cmpIdx / cmpSide` 状态；`C` 进入，`Tab` 切换标记目标，`←/→` 换组，`Esc` 先退对比再关灯箱（`closeLightbox` 内先 `closeCompare`）
- 键盘快捷键优先级：**对比模式 > 灯箱 > 编辑器 > 相册**；`markTarget / rateTarget` 按优先级取目标 id；灯箱/对比中标记后按 `settings.autoAdvance` 决定是否自动跳转
- 侧边栏导航：`nav-item` 点击对信息/编辑器视图会先 `openExif/openEditor(current)` 填充内容（曾只 `switchView` 导致预览空白）
- 冒烟测试注意：窗口必须 `show: true`（隐藏窗口 rAF 被节流，GSAP `onComplete` 不触发）；服务器须用**固定端口**（CSRF 白名单按端口生成，端口 0 会导致渲染进程 POST 全被 403）；需注册 OOBE 路由桩（OOBE 路由只在 electron-main.cjs 中注册）

### 4.5 前端（v1.2 更新，接手必读）
- **网格 Flip**：`renderGrid()` 是整体重建 DOM，`Flip.from(state)` 必须传 `targets: cards`（新元素集合），否则 Flip 补间的是已脱离文档的旧节点
- **灯箱换源**：`showLbPhoto(0)`（首次打开/胶片条跳转）**同步**设置 `img.src`，不要用 crossfade 异步换源——紧随其后的 `UIAnim.lightbox` 开合动画对同一 img 用 `overwrite:'auto'`，会把 crossfade tween 杀掉导致 src 永不赋值（图片空白）
- **GSAP 警告**：`gsap.quickTo(el,'scale')` 创建后立即调用 setter 会触发 "scale not eligible for reset" 一次性警告；画布/灯箱缩放改用 `gsap.to + overwrite:'auto'`（scale 0.2-0.25s、平移 0.08-0.12s），语义等价且零警告
- **缩放 clamp**：`clampLbPan/clampCanvasPan` 基于 `getBoundingClientRect()`（天然含 transform）；图片小于视口时 max=0（禁止平移是正确行为，冒烟测试需先把图放大到超过视口再验证平移）
- **草稿**：`openEditor` 会先 `clearTimeout(draftTimer)` 避免上一张照片的待保存草稿写入新照片；导出成功（copy/overwrite）后 `DELETE /api/photos/:id/draft`
- **设置驱动动效**：`UIAnim.setReduceMode('system'|'on'|'off')` 由 `settings.reduceMotion` 驱动，不再是模块加载时一次性读取 matchMedia
- **全局拖放上传**：window `drop` handler 必须跳过 `e.target.closest('#dropzone')` 的事件——dropzone 自己的 drop 会冒泡到 window，否则同一批文件上传两次（冒烟 `DROP-ONCE` 回归锁定）
- **收藏夹详情页刷新**：`renderGrid()` 只重建库视图 `#grid`；详情页内的批量全选/取消、缩略图取消、评分等走 `refreshCurrentGrid()`（→ `renderAlbumGrid`），否则可见卡片选中/星星状态不更新（冒烟 `ALBUM-BATCH` 回归锁定）
- **瀑布流防重叠（v1.2.0 修复）**：`layoutMasonry` 用 `cardRatio()` 优先取缩略图真实宽高比（`img.complete && naturalWidth > 0`），不再直接依赖入库宽高；缩略图懒加载完成后经 `scheduleMasonry`（80ms 防抖）重排。配套 `buildMeta` 对 EXIF orientation ≥ 5 交换宽高，新上传照片入库比例与缩略图一致；已有照片由前端重排自动修复，无需数据迁移。冒烟 `MASONRY` 回归锁定

## 5. 常见操作

- **跑测试**：`npm test`（34 个，含 PNG/WebP EXIF 往返、中文文件名/EXIF、批量处理/路由回归、hideReject、autoAdvance、信息页导航加载回归、v1.2 settings/adjust/草稿/cover/dataDir 回归、EXIF 方向照片入库宽高回归）
- **UI 冒烟**：`npx electron scripts/ui-smoke.cjs`（期望 v1.1 全部用例 + `DARK-MODE dark-ok ...`、`SHORTCUTS shortcut-ok ...`、`CONFIRM confirm-ok ...`、`LB-ZOOM lbzoom-ok zoomed=true panned=true ...`、`UPLOAD-OVERLAY overlay-ok ...`、`FLIP-GRID flip-ok ...`、`DRAFT draft-ok saved=true afterExport=404`、`MASONRY masonry-ok cards=6 bad=[]`（EXIF 方向照片防重叠）、`CONSOLE-ERRORS []`；脚本已加主进程未捕获异常兜底与 90s 看门狗）
- **启动开发**：`npm start` / `npm run electron`
- **构建**：`npm run build:win` → `release/`（NSIS + portable）
- **发版流程**（每次一致）：改版本号（package.json + package-lock.json + server-app.cjs 默认值 + index.html 关于页）→ CHANGELOG 加条目（中文+English+Release Assets+Notes）→ `release:` 提交 → push main → `git tag -a vX.Y.Z` + push tag → `gh release create vX.Y.Z --title "Luma Studio vX.Y.Z 桌面版" --notes-file ... --latest`，产物按 `Luma.Studio.Setup.X.Y.Z.exe` / `Luma.Studio.X.Y.Z.exe` 命名上传

## 6. 各种情况 / 注意事项

- **“数据不见了”**：先分清是安装版还是便携版——便携版数据在 exe 旁，安装版在 AppData；换目录/换机器不会自动跟过去
- **批量任务丢了**：任务状态在内存中，重启即失；已生成的副本/覆盖结果不会回滚
- **键盘快捷键没反应**：先确认是否在输入框内；若整体失效，检查 keydown 监听是否被异常打断；注意**对比模式优先级最高**，会吞掉灯箱/相册的按键
- **EXIF 写入 400**：仅支持 JPEG/PNG/WebP；WebP 变体（动画等）可能被安全拒绝
- **信息页/编辑器预览空白**：v1.0.9 已修复（从侧边栏进入也会自动加载）；若再出现，先查日志里是否有 `GET /api/photos/:id/exif`
- **点击图片不进预览 / 打开的是别的照片**：EXIF 方向照片瀑布流重叠所致，v1.2.0 已修复（`buildMeta` 存旋转后宽高 + 前端按缩略图真实比例排版并加载后重排）；若再出现，先确认是否旧版本构建，或该照片缩略图是否加载失败（失败时回落用入库宽高比）
- **冒烟测试输出 GPU 报错**（`command_buffer_proxy_impl`）：Chromium 无头窗口噪声，可忽略；关注 `CONSOLE-ERRORS`
- **构建/测试的 DeprecationWarning**（`DEP0190`、LF/CRLF 警告）：无害，无需处理
- **端口**：固定 `13579`，仅监听 `127.0.0.1`；被占用则启动失败
- **安全**：无认证机制，仅限本机/个人使用，勿暴露公网
- **不要提交**：`release/`、`release.old-*/`、`node_modules/`、运行时照片数据、`storage/` 内容（见 `.gitignore`）

## 7. 下一步建议

- **立即提交**：工作区未提交的 EXIF 方向/瀑布流重叠修复（`server-app.cjs`、`public/app.js`、`test/server.test.cjs`、`scripts/ui-smoke.cjs`），提交后可将 §1 与 §3 中的“未提交”表述更新为提交号
- 新功能候选（已列入 ROADMAP“计划中”，待确认优先级）：编辑版本链（非破坏式）→ 时间线/日历浏览 → 标签体系 → 回收站 + 全库备份 → 更多 EXIF 字段编辑 → 便携版与安装版数据迁移工具
- 若新增前端交互，请同步扩展 `scripts/ui-smoke.cjs` 覆盖
- 若修 bug，按 AGENTS.md 先补 node:test 回归测试

## 8. 建议使用的 skills

- `gsap-core` — 涉及前端动画（瀑布流、灯箱、模态框）时
- `diagnosing-bugs` — 排查崩溃/性能/异常时
- `tdd` — 修 bug 或加功能时先写测试
- `grilling` / `grill-me` — 规划新功能或产品决策时
- `handoff` — 再次交接/压缩上下文时
