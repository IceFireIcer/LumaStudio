# Luma Studio · 光影工作室

> **[English](README_en.md) | [日本語](README_ja.md) | [한국어](README_ko.md) | [Français](README_fr.md) | [Español](README_es.md) | [Deutsch](README_de.md)**

自托管的桌面版图片查看器与 **Lightroom 风格图片编辑器**。上传一次，永久保存——照片以真实文件存储在磁盘上，不会随应用关闭丢失。

Luma Studio 将你的电脑变成私人影像工作台。在优雅的白色主题相册中浏览照片，然后进入编辑器进行调色、变换、裁剪、缩放、压缩和 EXIF 元数据编辑——全部由 [sharp](https://sharp.pixelplumbing.com/) (libvips) 在服务端处理。

---

## 功能特性

### 相册浏览
- 拖拽或点击上传（JPG / PNG / WebP / AVIF / GIF / TIFF / BMP）
- 服务端生成 WebP 缩略图，动画瀑布网格布局
- 卡片悬浮操作：编辑、信息、下载、删除
- 灯箱大图查看，键盘 `←` `→` `Esc` 导航
- 照片以真实文件持久化存储，重启不丢失

### 编辑器（Lightroom 风格）
- **一键预设**：原图、鲜艳、柔和、复古、黑白、高对比
- **调整面板**：亮度、对比度、饱和度、色相、锐化、模糊、黑白——CSS 实时预览
- **撤销 / 重做**：`Ctrl+Z` / `Ctrl+Y`（状态栈机制）
- **变换**：旋转 90°、水平/垂直翻转、交互式裁剪（自由 / 1:1 / 4:3 / 16:9 / 3:4）
- **尺寸**：精确像素输入（锁定比例）+ 25% / 50% / 75% / 100% 快速缩放
- **导出**：JPEG / PNG / WebP / AVIF，质量滑块，实时体积预估
- **保存为副本** 或 **覆盖原图**
- **下载到本地**（不落库，直接回传字节）
- **前后对比**：原图 / 编辑后分屏对比，可拖动分界线查看任意位置的差异

### EXIF 元数据
- 查看：相机、镜头、光圈、快门、ISO、焦距、GPS 等
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

### 搜索、筛选、排序
- 文件名搜索
- 按星级、标记状态、图片格式筛选
- 按名称、日期、大小、评分排序

### 幻灯片
- 全屏自动播放（3 秒间隔），空格暂停/继续，方向键切换

### 设置与关于
- 默认导出格式和质量、缩略图尺寸、主题色
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
├── server-app.cjs          # Express 后端 + sharp 图像管线 + REST API
├── electron-main.cjs       # Electron 主进程
├── electron-launch.cjs     # Electron 启动器
├── public/
│   ├── index.html          # SPA 外壳
│   ├── style.css           # 设计系统
│   └── app.js              # 前端逻辑
├── storage/                # 运行时数据（userData）
├── test/                   # 回归测试（node:test）
└── package.json
```

---

## API 参考

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
| `GET` | `/api/settings` | 获取设置 |
| `POST` | `/api/settings` | 更新设置 |
| `GET` | `/api/stats` | 存储统计 |
| `GET` | `/api/search` | 搜索/筛选（`q`, `sort`, `stars`, `flag`, `format`, `album`, `hideReject`） |
| `GET` | `/api/info` | 系统信息 |
| `POST` | `/api/photos/:id/stars` | 设置评分（0–5） |
| `POST` | `/api/photos/:id/flag` | 设置标记（`pick` / `reject` / `null`） |
| `POST` | `/api/photos/batch/stars` | 批量评分 `{ ids, stars }` |
| `POST` | `/api/photos/batch/flag` | 批量标记 `{ ids, flag }` |
| `POST` | `/api/photos/batch/delete` | 批量删除 `{ ids }` |
| `POST` | `/api/photos/batch/process` | 批量处理 `{ ids, pipeline, mode }` → `{ jobId }` |
| `GET` | `/api/jobs/:id` | 查询后台任务进度 |
| `POST` | `/api/jobs/:id/cancel` | 取消后台任务 |
| `POST` | `/api/photos/download-zip` | 打包下载 ZIP `{ ids }` |
| `GET` | `/api/albums` | 获取收藏夹列表 |
| `POST` | `/api/albums` | 创建收藏夹 `{ name }` |
| `DELETE` | `/api/albums/:id` | 删除收藏夹 |
| `POST` | `/api/albums/:id/rename` | 重命名收藏夹 |
| `POST` | `/api/albums/:id/add` | 添加照片 `{ ids }` |
| `POST` | `/api/albums/:id/remove` | 移除照片 `{ ids }` |
| `GET` | `/files/:file` | 获取原图（`?download=1` 强制下载） |
| `GET` | `/thumbs/:id.webp` | 获取缩略图 |

### Process / Render 请求体

```jsonc
{
  "adjust":    { "brightness": 1.1, "contrast": 1.2, "saturation": 1.4,
                 "hue": 0, "sharpen": 2, "blur": 0, "grayscale": false },
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
| 桌面版 | [Electron](https://www.electronjs.org/) |
| 前端 | 原生 JavaScript / HTML / CSS（零框架、零构建步骤） |

---

## 注意事项

- **EXIF 写入**支持 JPEG / PNG / WebP：JPEG 走 APP1 段，PNG / WebP 走 eXIf / EXIF chunk（无损，不重编码像素）。UTF-8 / 中文文本完整保留。
- **Windows** 上 sharp 内部缓存已禁用（`sharp.cache(false)`）以避免文件句柄锁定。
- **无认证机制**——设计用于本地/个人使用。不要直接暴露到公网，建议放在反向代理后面。
- **中文 EXIF**：写入时使用 `Buffer.from(text,'utf8').toString('latin1')` 编码；读取时 latin1→UTF-8 解码，确保多字节字符不丢失。

---

## 路线图与贡献

当前进度、已知问题和计划功能见 [ROADMAP.md](ROADMAP.md)。

---

## 许可证

[Apache License 2.0](LICENSE) © 2026 [IceFire_Icer](https://github.com/IceFireIcer)
