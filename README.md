# Luma Studio - Electron 桌面版

Luma Studio 的 Windows 桌面应用版本,无需浏览器即可使用完整功能。

## 📦 当前版本

**v1.0.2**

### 包含文件

| 文件名 | 类型 | 说明 |
|--------|------|------|
| `Luma Studio Setup 1.0.2.exe` | 安装版 | 推荐大多数用户使用,自动安装到系统并创建桌面快捷方式 |
| `Luma Studio 1.0.2.exe` | 便携版 | 免安装,解压即用,适合移动设备或临时使用 |

## 🚀 快速开始

### 安装版(推荐)

1. 下载 `Luma Studio Setup 1.0.2.exe`
2. 双击运行安装程序
3. 完成安装后,桌面会自动创建快捷方式
4. 双击桌面图标即可启动

### 便携版

1. 下载 `Luma Studio 1.0.2.exe`
2. 直接双击运行(首次启动可能需要几秒初始化)
3. 应用会自动在同级目录创建 `lumastudio-log` 文件夹存放日志

## ✨ 功能特性

- **图片库浏览**: 优雅的画廊界面,支持拖拽上传
- **Lightroom式编辑器**: 预设、调整、变换、裁剪、调整大小
- **EXIF元数据**: 查看和编辑相机信息,支持UTF-8/CJK字符
- **星级与标记**: 1-5星评分、Pick/Reject标记
- **相册管理**: 创建、编辑、删除收藏夹
- **批量操作**: 批量评分、标记、下载ZIP、删除
- **搜索与筛选**: 按名称、星级、格式、标记筛选
- **幻灯片放映**: 自动播放,支持键盘控制
- **完整日志系统**: 实时查看前后端日志,便于调试

## 🔧 技术说明

- **默认端口**: 7443 (应用内嵌Express服务器)
- **数据存储**: 所有数据使用JSON文件存储,无需数据库
- **图片存储**: 原始文件保存在 `storage/uploads/`,缩略图在 `storage/thumbs/`
- **日志位置**: 便携版 → `lumastudio-log/`,安装版 → `log/`

## 📝 更新日志

### v1.0.2
- 修复收藏夹按钮点击无响应问题
- 新增完整日志系统(实时显示前后端日志)
- 新增自定义输入模态框(替换浏览器prompt)
- 将默认端口从3000改为7443(避免常见端口冲突)
- 改进Electron环境检测逻辑

## 🔗 相关资源

- **项目主页**: https://github.com/IceFireIcer/LumaStudio
- **源码分支**: `main` (Web服务端) / `electron` (桌面版源码)
- **问题反馈**: https://github.com/IceFireIcer/LumaStudio/issues

## 📄 许可证

[Apache License 2.0](https://github.com/IceFireIcer/LumaStudio/blob/main/LICENSE) © 2026 [IceFire_Icer](https://github.com/IceFireIcer)
