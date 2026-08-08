# Luma Studio · 光影工作室

> **[English](README_en.md)**

自托管的桌面版图片查看器与 **Lightroom 风格图片编辑器**。上传一次，永久保存——照片以真实文件存储在磁盘上，不会随应用关闭丢失。

Luma Studio 将你的电脑变成私人影像工作台。在优雅的白色主题相册中浏览照片，然后进入编辑器进行调色、变换、裁剪、缩放、压缩和 EXIF 元数据编辑——全部由 [sharp](https://sharp.pixelplumbing.com/) (libvips) 在服务端处理。

---

## 功能特性

### 多开、安全与可靠性（v1.2.1）
- **多开支持**：检测到已有实例时新实例弹原生对话框，可选「关闭新实例」或「多开新窗口」（自动换空闲端口启动、共享同一数据目录，适合「只看不编」的浏览场景）
- **文件级写锁**：多开共享数据时 `db.json` / `drafts.json` / `settings.json` / 任务状态写入加文件锁，另一实例持锁时返回冲突提示；残留锁自动接管
- **本地访问令牌**：首启生成随机令牌，写请求校验 `X-Luma-Token`（防止本机其他进程 / 恶意网页篡改数据）；设置页可查看 / 复制 / 重新生成
- **批量任务落盘**：任务状态写入 `jobs.json`，重启后恢复历史记录；中断任务标记保留进度（不自动续跑）
- **性能**：批量处理 2 路有限并发；日志页刷新间隔可设置（3 / 10 / 30 秒）
- **错误体验**：损坏 / 动画 WebP 写 EXIF 返回友好提示；启动失败弹原生错误框（不再静默退出）

### 设计系统与全局组件（v1.2）
- **深色模式**：浅色 / 深色手动切换，主题色共用，中性色变量自动适配；`Esc` 随时打开**快捷键速查浮层**（`?` 键）
- **统一设计系统**：颜色 / 间距 / 圆角 / 阴影 / 字体 / 动效全部 token 化，定制滚动条与键盘焦点样式
- **全局交互增强**：自定义确认模态框（替代原生 `confirm`）、Toast 动作按钮、页面方向过渡动画、窗口任意位置拖放上传
- **减弱动效三态**：跟随系统 / 强制开启（全部动画归零）/ 强制关闭

### 相册浏览
- 拖拽或点击上传（JPG / PNG / WebP / AVIF / GIF / TIFF / BMP）
- 服务端生成 WebP 缩略图，动画瀑布网格布局
- 卡片悬浮操作：编辑、信息、下载、删除
- 灯箱大图查看，键盘 `←` `→` `Esc` 导航
- **灯箱增强**（v1.2）：`3 / 25` 计数药丸、底部胶片条、EXIF 摘要条、滚轮缩放平移（1×–5×）、方向化切换动画
- **网格增强**（v1.2）：Flip 过渡、卡片悬停快速评分、批量条缩略图
- 照片以真实文件持久化存储，重启不丢失

### 编辑器（Lightroom 风格）
- **一键预设**：原图、鲜艳、柔和、复古、黑白、高对比
- **调整面板**：亮度、对比度、饱和度、色相、锐化、模糊、黑白——CSS 实时预览
- **v1.2 新参数**：色温、色调、暗角、颗粒；滑块双击复位、改动标记、撤销/重做按钮
- **v1.2 草稿持久化**：编辑参数自动保存为单快照草稿，重开自动恢复，导出成功后清除
- **v1.2 画布缩放平移**：滚轮缩放（0.25×–4×）、拖拽平移、裁剪框方向键微调与三分线网格
- **撤销 / 重做**：`Ctrl+Z` / `Ctrl+Y`（状态栈机制）
- **变换**：旋转 90°、水平/垂直翻转、交互式裁剪（自由 / 1:1 / 4:3 / 16:9 / 3:4）
- **前后对比升级**（v1.2）：任意位置拖动分界线、左右 / 上下分屏切换
- **尺寸**：精确像素输入（锁定比例）+ 25% / 50% / 75% / 100% 快速缩放
- **导出**：JPEG / PNG / WebP / AVIF，质量滑块，实时体积预估
- **保存为副本** 或 **覆盖原图**
- **下载到本地**（不落库，直接回传字节）
- **前后对比**：原图 / 编辑后分屏对比，可拖动分界线查看任意位置的差异

### EXIF 元数据
- 查看：相机、镜头、光圈、快门、ISO、焦距、GPS 等
- **v1.2 分组展示**：相机 / 拍摄参数 / 时间 / 文件 / GPS 分区；值一键复制，GPS 支持高德与 Google 地图链接
- 编辑：作者、版权、描述、拍摄时间（JPEG / PNG / WebP）——完整支持 **UTF-8 / 中文**，无损写入
- 一键**抹除全部元数据**（隐私保护）

### 选片评分
- 1–5 星评分（键盘 `1`–`5`，`0` 清除）
- 精选 / 排除标记（`P` / `R` 键）
- **快速选片**：`X` 排除、`U` 清除标记；灯箱 / 对比中标记后自动跳转下一张（可在设置中关闭）
- **并排对比选片**（灯箱内 `C` 键）：两张照片并排比较，`Tab` 切换标记目标，`←`/`→` 换组
- **隐藏排除**：工具栏按钮或 `H` 键一键隐藏被排除的照片
- 批量操作：评分、标记、添加到收藏夹、打包 ZIP 下载、批量删除

### 批量处理
- 多选照片后统一应用预设（原图 / 鲜艳 / 柔和 / 复古 / 黑白 / 高对比）
- 支持百分比缩放、输出格式（保持原格式 / JPEG / PNG / WebP / AVIF）与质量调节
- 后台队列处理：实时进度条、逐张错误隔离、可随时取消
- 另存副本或覆盖原图

### 收藏夹
- 创建 / 重命名 / 删除收藏夹
- 添加 / 移除照片
- 浏览收藏夹内容
- **v1.2 封面与批量**：卡片首图封面、详情页完整批量条、拖拽加入收藏夹

### 搜索、筛选、排序
- 文件名搜索
- 按星级、标记状态、图片格式筛选
- 按名称、日期、大小、评分排序

### 幻灯片
- 全屏自动播放（3 秒间隔），空格暂停/继续，方向键切换
- **v1.2 增强**：Ken Burns 慢推、间隔设置（3 / 5 / 10 秒）、顶部进度条、`3 / 25` 计数

### 设置与关于
- 默认导出格式和质量、缩略图尺寸、主题色
- **v1.2 外观卡**：深色模式开关、减弱动效三态、快捷键速查入口、打开数据目录按钮
- **v1.2.1 系统卡**：日志页刷新间隔（3 / 10 / 30 秒）；存储卡访问令牌查看 / 复制 / 重新生成
- **日志增强**（v1.2）：搜索、暂停实时刷新、行展开与复制
- 运行时信息：Node 版本、sharp/libvips 版本、照片数量、占用空间、运行时间

### 快捷键

| 按键 | 功能 |
|------|------|
| `1`–`5` | 评分 1–5 星 |
| `0` | 清除评分 |
| `P` | 标记精选 |
| `R` | 标记排除 |
| `X` | 标记排除并自动跳转下一张 |
| `U` | 清除标记 |
| `C` / `Tab` | 灯箱并排对比选片 / 切换标记目标 |
| `H` | 隐藏排除照片 |
| `?` | 打开/关闭快捷键速查浮层 |
| `←` `→`（灯箱缩放态） | 平移缩放画面 |
| `Esc` / 双击（灯箱缩放态） | 复位缩放 |
| `←` `→` `↑` `↓`（编辑器裁剪） | 平移裁剪框 1px（`Shift` 为 10px） |
| `[` `]`（编辑器裁剪） | 缩放裁剪框 1px（`Shift` 为 10px） |
| `←` `→` | 灯箱 / 幻灯片导航 |
| `Ctrl+Z` | 撤销（编辑器） |
| `Ctrl+Y` | 重做（编辑器） |
| `空格` | 幻灯片暂停/继续 |
| `Esc` | 关闭灯箱 / 幻灯片 |

---

## 快速开始

### 环境要求
- [Node.js](https://nodejs.org/) **18+**

### Electron 桌面版

```
git clone https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
npm install
npm run electron
```

> **注意**：Luma Studio 现为桌面版应用，所有源码均位于 `main` 分支。

---

## 项目结构

```
.
├── server-app.cjs          # Express 后端 + sharp 图像管线 + REST API（唯一事实来源）
├── electron-main.cjs       # Electron 主进程（数据目录/迁移/单实例锁多开/OOBE/服务器窗口）
├── electron-launch.cjs     # Electron 启动器
├── preload.cjs             # contextBridge preload（openDataDir / getToken）
├── public/
│   ├── index.html          # SPA 外壳
│   ├── style.css           # 设计系统（token 化，含深色模式）
│   ├── app.js              # 前端逻辑
│   ├── ui-anim.js          # GSAP 动画层（window.UIAnim）
│   └── vendor/gsap/        # 本地 GSAP（含 FlipPlugin）
├── scripts/ui-smoke.cjs    # UI 冒烟测试（真实 Electron）
├── test/server.test.cjs    # 回归测试（node:test，44 个）
├── docs/                   # 设计规格（ui-redesign.md）
├── build/installer/        # Inno Setup 安装脚本
├── storage/                # 运行时数据（userData）
└── package.json
```

---

## API 参考

### 照片与文件

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/photos` | 获取所有照片列表 |
| `GET` | `/api/photos/:id` | 获取单张照片元数据 |
| `POST` | `/api/upload` | 上传图片 |
| `DELETE` | `/api/photos/:id` | 删除单张照片 |
| `DELETE` | `/api/photos` | 删除全部照片 |
| `GET` | `/api/photos/:id/exif` | 读取 EXIF |
| `POST` | `/api/photos/:id/exif` | 写入 EXIF（JPEG / PNG / WebP） |
| `POST` | `/api/photos/:id/strip-exif` | 抹除全部元数据 |
| `POST` | `/api/photos/:id/process` | 应用编辑并保存 |
| `POST` | `/api/photos/:id/render` | 应用编辑并返回字节 |
| `POST` | `/api/photos/:id/preview` | 预估输出体积 |
| `POST` | `/api/photos/:id/rename` | 重命名照片 |
| `POST` | `/api/photos/:id/stars` | 设置评分（0–5） |
| `POST` | `/api/photos/:id/flag` | 设置标记（`pick` / `reject` / `null`） |
| `PUT` | `/api/photos/:id/draft` | 保存编辑草稿 |
| `GET` | `/api/photos/:id/draft` | 读取编辑草稿（无草稿返回 404） |
| `DELETE` | `/api/photos/:id/draft` | 清除编辑草稿 |
| `GET` | `/files/:file` | 获取原图（`?download=1` 强制下载） |
| `GET` | `/thumbs/:id.webp` | 获取缩略图 |

### 批量处理与后台任务

| 方法 | 端点 | 说明 |
|------|------|------|
| `POST` | `/api/photos/batch/stars` | 批量评分 `{ ids, stars }` |
| `POST` | `/api/photos/batch/flag` | 批量标记 `{ ids, flag }` |
| `POST` | `/api/photos/batch/delete` | 批量删除 `{ ids }` |
| `POST` | `/api/photos/batch/process` | 批量处理 `{ ids, pipeline, mode }` → `{ jobId }` |
| `GET` | `/api/jobs/:id` | 查询后台任务进度 |
| `POST` | `/api/jobs/:id/cancel` | 取消后台任务 |
| `POST` | `/api/photos/download-zip` | 打包下载 ZIP `{ ids }` |

### 搜索 / 设置 / 系统 / 日志

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/search` | 搜索/筛选（`q`, `sort`, `stars`, `flag`, `format`, `album`, `hideReject`） |
| `GET` | `/api/settings` | 获取设置 |
| `POST` | `/api/settings` | 更新设置 |
| `GET` | `/api/stats` | 存储统计（含 `dataDir`） |
| `GET` | `/api/info` | 系统信息 |
| `GET` | `/api/logs` | 读取日志（`level` / `source` / `limit` 过滤） |
| `POST` | `/api/logs/clear` | 清空日志（含轮转备份） |
| `GET` | `/api/logs/info` | 日志文件路径信息 |
| `POST` | `/api/logs/frontend` | 前端日志上报 |

### 收藏夹 / 认证 / OOBE

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/albums` | 获取收藏夹列表（含首图封面 `cover`） |
| `POST` | `/api/albums` | 创建收藏夹 `{ name }` |
| `DELETE` | `/api/albums/:id` | 删除收藏夹 |
| `POST` | `/api/albums/:id/rename` | 重命名收藏夹 |
| `POST` | `/api/albums/:id/add` | 添加照片 `{ ids }` |
| `POST` | `/api/albums/:id/remove` | 移除照片 `{ ids }` |
| `POST` | `/api/auth/reset-token` | 重置本地访问令牌（需持旧令牌） |
| `GET` | `/api/oobe/status` | 读取 OOBE 完成状态（桌面端注册表） |
| `POST` | `/api/oobe/complete` | 标记 OOBE 完成 |
| `POST` | `/api/oobe/reset` | 重置 OOBE 引导 |

### Process / Render 请求体

```jsonc
{
  "adjust":    { "brightness": 1.1, "contrast": 1.2, "saturation": 1.4,
                 "hue": 0, "sharpen": 2, "blur": 0, "grayscale": false,
                 "temperature": 0, "tint": 0, "vignette": 0, "grain": 0 },
  "transform": { "rotate": 90, "flipH": false, "flipV": false,
                 "crop": { "left": 100, "top": 50, "width": 400, "height": 300 } },
  "resize":    { "width": 1280, "height": 720 },
  "output":    { "format": "webp", "quality": 80 },
  "mode":      "copy"   // 或 "overwrite"
}
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | [Express](https://expressjs.com/) |
| 图像处理 | [sharp](https://sharp.pixelplumbing.com/) (libvips) |
| EXIF 读取 | [exifr](https://github.com/MikeKovarik/exifr) |
| EXIF 写入 | [piexifjs](https://github.com/hMatoba/piexifjs) |
| 文件上传 | [multer](https://github.com/expressjs/multer) |
| ZIP 打包 | [yazl](https://github.com/thejoshwolfe/yazl) |
| ID 生成 | [nanoid](https://github.com/ai/nanoid) |
| 桌面版 | [Electron](https://www.electronjs.org/) |
| 前端 | 原生 JavaScript / HTML / CSS（零框架、零构建步骤） |
| 数据存储 | JSON 文件（`db.json` / `settings.json` / `drafts.json` / `jobs.json`），无需数据库 |

---

## 注意事项

- **EXIF 写入**支持 JPEG / PNG / WebP：JPEG 走 APP1 段，PNG / WebP 走 eXIf / EXIF chunk（无损，不重编码像素）。UTF-8 / 中文文本完整保留。
- **Windows** 上 sharp 内部缓存已禁用（`sharp.cache(false)`）以避免文件句柄锁定；其他平台启用默认缓存。
- **安全**：桌面版写请求默认校验本地访问令牌（`X-Luma-Token`，设置页可查看/重置）。仍仅限本地/个人使用，不要直接暴露到公网。
- **多开**：新实例与现有实例共享同一数据目录，适合「只看不编」；两个实例同时编辑仍应避免（写锁只兜底瞬时写冲突）。
- **中文 EXIF**：写入时使用 `Buffer.from(text,'utf8').toString('latin1')` 编码；读取时 latin1→UTF-8 解码，确保多字节字符不丢失。

---

## 路线图与贡献

当前进度、已知问题和计划功能见 [ROADMAP.md](ROADMAP.md)。

---

## 许可证

[Apache License 2.0](LICENSE) © 2026 [IceFire_Icer](https://github.com/IceFireIcer)
