# Luma Studio 交接文档（HANDOVER）

> 给下一个接手的人/Agent：本文档记录项目现状、已实现功能、关键决策与各种需要注意的情况。
> 版本更新历史见 [CHANGELOG.md](CHANGELOG.md)，功能规划见 [ROADMAP.md](ROADMAP.md)，仓库规范见 [AGENTS.md](AGENTS.md)，功能清单见 [README.md](README.md)（中文）与 [README_en.md](README_en.md)。本文不重复这些内容，只做索引与上下文补充。

## 1. 项目概况

- **项目**：Luma Studio · 光影工作室 —— 自托管桌面版图片查看器与 Lightroom 风格编辑器
- **形态**：Electron 桌面应用（Node.js + Express 后端，sharp/libvips 图像管线，原生 HTML/CSS/JS 前端，零构建步骤）
- **仓库**：https://github.com/IceFireIcer/LumaStudio ，单一分支 `main`（git 仓库根 = 本目录）
- **当前版本**：v1.1.0（2026-08-07 发布），`package.json` / `package-lock.json` / `server-app.cjs` 默认值 / `index.html` 关于页版本号同步维护
- **最近版本发布提交**：`0afffc9` release: 发布 v1.1.0（选片工作流增强）；其后为文档维护提交，最新 HEAD 以 `git log` 为准
- **README 政策（v1.1.0 起）**：仅保留中文主文档 `README.md` 与英文版 `README_en.md`，de/es/fr/ja/ko 变体已移除，勿再新增

## 2. 代码结构（仓库根）

| 文件 | 职责 |
|---|---|
| `server-app.cjs` | 唯一事实来源：Express 应用、图像处理管线、日志、EXIF 读写、PNG/WebP chunk 写入、相册/批量/后台任务/ZIP/搜索等全部 REST API |
| `electron-main.cjs` | Electron 主进程：数据目录解析（便携版/安装版）、单实例锁、OOBE 注册表、启动服务器与窗口 |
| `electron-launch.cjs` | 启动器（spawn Electron，清理 `ELECTRON_RUN_AS_NODE` 污染） |
| `public/` | 前端：`index.html` / `style.css` / `app.js` / `ui-anim.js`（GSAP 动画层）/ `vendor/gsap/` |
| `scripts/ui-smoke.cjs` | UI 冒烟测试：真实 Electron 加载前端，覆盖 v1.1.0 选片工作流交互，捕获渲染进程错误 |
| `test/server.test.cjs` | node:test 回归测试（当前 25 个，全部通过） |
| `build/installer/` | Inno Setup 安装脚本（仓库源文件，勿删） |
| `ROADMAP.md` / `CHANGELOG.md` / `README.md` / `README_en.md` / `AGENTS.md` / `handover.md` | 规划 / 版本日志 / 文档 / 仓库规范 / 本交接文档 |

## 3. 已实现功能（v1.1.0 现状）

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

## 5. 常见操作

- **跑测试**：`npm test`（25 个，含 PNG/WebP EXIF 往返、中文文件名/EXIF、批量处理/路由回归、hideReject、autoAdvance、信息页导航加载回归）
- **UI 冒烟**：`npx electron scripts/ui-smoke.cjs`（期望 `BA-COMPARE ba-ok ...`、`LB-COMPARE lb-ok ...`、`BATCH-DONE ... 1 / 1`、`BATCH-AFTER grid=3`、`TOGGLE-H toggle-h on=true off=true`、`CONSOLE-ERRORS []`）
- **启动开发**：`npm start` / `npm run electron`
- **构建**：`npm run build:win` → `release/`（NSIS + portable）
- **发版流程**（每次一致）：改版本号（package.json + package-lock.json + server-app.cjs 默认值 + index.html 关于页）→ CHANGELOG 加条目（中文+English+Release Assets+Notes）→ `release:` 提交 → push main → `git tag -a vX.Y.Z` + push tag → `gh release create vX.Y.Z --title "Luma Studio vX.Y.Z 桌面版" --notes-file ... --latest`，产物按 `Luma.Studio.Setup.X.Y.Z.exe` / `Luma.Studio.X.Y.Z.exe` 命名上传

## 6. 各种情况 / 注意事项

- **“数据不见了”**：先分清是安装版还是便携版——便携版数据在 exe 旁，安装版在 AppData；换目录/换机器不会自动跟过去
- **批量任务丢了**：任务状态在内存中，重启即失；已生成的副本/覆盖结果不会回滚
- **键盘快捷键没反应**：先确认是否在输入框内；若整体失效，检查 keydown 监听是否被异常打断；注意**对比模式优先级最高**，会吞掉灯箱/相册的按键
- **EXIF 写入 400**：仅支持 JPEG/PNG/WebP；WebP 变体（动画等）可能被安全拒绝
- **信息页/编辑器预览空白**：v1.0.9 已修复（从侧边栏进入也会自动加载）；若再出现，先查日志里是否有 `GET /api/photos/:id/exif`
- **冒烟测试输出 GPU 报错**（`command_buffer_proxy_impl`）：Chromium 无头窗口噪声，可忽略；关注 `CONSOLE-ERRORS`
- **构建/测试的 DeprecationWarning**（`DEP0190`、LF/CRLF 警告）：无害，无需处理
- **端口**：固定 `13579`，仅监听 `127.0.0.1`；被占用则启动失败
- **安全**：无认证机制，仅限本机/个人使用，勿暴露公网
- **不要提交**：`release/`、`release.old-*/`、`node_modules/`、运行时照片数据、`storage/` 内容（见 `.gitignore`）

## 7. 下一步建议

- 新功能候选（已列入 ROADMAP“计划中”，待确认优先级）：编辑版本链（非破坏式）→ 时间线/日历浏览 → 标签体系 → 回收站 + 全库备份 → 更多 EXIF 字段编辑 → 便携版与安装版数据迁移工具
- 若新增前端交互，请同步扩展 `scripts/ui-smoke.cjs` 覆盖
- 若修 bug，按 AGENTS.md 先补 node:test 回归测试

## 8. 建议使用的 skills

- `gsap-core` — 涉及前端动画（瀑布流、灯箱、模态框）时
- `diagnosing-bugs` — 排查崩溃/性能/异常时
- `tdd` — 修 bug 或加功能时先写测试
- `grilling` / `grill-me` — 规划新功能或产品决策时
- `handoff` — 再次交接/压缩上下文时
