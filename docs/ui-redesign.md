# Luma Studio UI/UX 改版方案（v1.2 设计规格）

> 状态：**待评审**（评审通过后再动手实现）
> 范围：所有现有页面的细节升级 + 深色模式 + 关键交互增强；ROADMAP 大功能（时间线 / 标签 / 版本链 / 回收站 / 更多 EXIF 字段编辑）明确排除，独立规划。
> 配套：本文档为唯一事实来源；实现时需同步更新 `scripts/ui-smoke.cjs` 与 `test/server.test.cjs`（见 §5 验收清单）。

---

## 0. 背景与目标

现状（v1.1.0）：功能骨架完整，但"细节密度"不足——浅色单主题、原生 `confirm()`、灯箱无计数/无缩放/无胶片条、编辑器参数有限、收藏夹无封面、页面切换动画粗糙、滚动条未定制、部分拖放路径被吞。

目标：不改功能骨架，把"质感"补齐。三件事：

1. **统一设计系统**：颜色 / 间距 / 圆角 / 阴影 / 字体 / 动效全部 token 化，深浅两套皮肤。
2. **深色模式**：默认浅色 + 手动深色开关，主题色共用，只适配中性色变量。
3. **关键交互升级**：拖放上传、Flip 网格过渡、灯箱缩放与胶片条、编辑器新参数与画布缩放、收藏夹封面与批量条、全局组件（confirm / 滚动条 / 焦点 / 快捷键浮层 / 页面过渡）。

评审通过后按 §5 的工作量拆解分批实现，每批跑通 `npm test` 与 UI 冒烟。

---

## 1. 设计系统

### 1.1 设计原则

- **克制、快速、即时反馈**：动效是"反馈"不是"表演"，所有时长 0.18–0.45s。
- 层级靠"颜色 + 阴影 + 间距"，不靠"边框 + 装饰"。
- 深浅两套皮肤共享同一套变量名，切换只换值。
- 只动画 `transform` / `opacity`（GSAP 规范），不动画布局属性。

### 1.2 色彩 token

#### 浅色（现状值，增补新 token）

```css
:root{
  --bg:#ffffff;          /* 页面底 */
  --bg-soft:#f6f7f9;     /* 侧边栏/按钮底 */
  --bg-soft2:#eef0f3;    /* 输入底/滑轨 */
  --bg-raised:#ffffff;   /* 卡片/浮层底（新增，浅色下同 bg） */
  --text:#1d1d1f;
  --text-soft:#86868b;
  --text-faint:#b4b4ba;  /* 新增：占位/次要说明 */
  --line:#e9eaee;
  --accent:#0071e3;
  --accent-soft:#eef6ff;
  --accent-soft-strong:#d6eaff; /* 新增：hover/选中加深底 */
  --danger:#ff3b30;
  --success:#34c759;     /* 新增 */
  --warn:#ff9500;        /* 新增 */
  --shadow:0 8px 30px rgba(0,0,0,.07);
  --shadow-lg:0 18px 56px rgba(0,0,0,.14);
  --scrollbar:rgba(0,0,0,.18);        /* 新增 */
  --scrollbar-hover:rgba(0,0,0,.32);  /* 新增 */
  --focus-ring:rgba(0,113,227,.45);   /* 新增 */
  --overlay:rgba(0,0,0,.6);           /* 模态框遮罩，新增统一 */
}
```

#### 深色（`html[data-theme="dark"]` 覆盖）

```css
html[data-theme="dark"]{
  --bg:#101012;
  --bg-soft:#1b1b1e;
  --bg-soft2:#26262b;
  --bg-raised:#1d1d21;   /* 卡片比页面底亮一档 */
  --text:#f5f5f7;
  --text-soft:#a1a1a6;
  --text-faint:#6e6e73;
  --line:#303036;
  --danger:#ff453a;
  --success:#32d74b;
  --warn:#ff9f0a;
  --shadow:0 10px 30px rgba(0,0,0,.5);
  --shadow-lg:0 18px 60px rgba(0,0,0,.62);
  --scrollbar:rgba(255,255,255,.22);
  --scrollbar-hover:rgba(255,255,255,.38);
  --focus-ring:rgba(10,132,255,.55);
  --overlay:rgba(0,0,0,.72);
  color-scheme:dark;   /* 原生控件（select/scrollbar/color input）跟随 */
}
```

#### 主题色在深色下的适配（评审已定：共用同一主题色，只适配中性色）

- `--accent` 深浅共用用户选色，不做运行时算色。
- `--accent-soft` / `--accent-soft-strong` 在深色下不再用浅色底，改为低饱和暗色底。
- **预置 6 色板**各配一组暗色变体（写死在 CSS，不运行 JS 算色）：

| 主题色 | 浅色 `--accent-soft` | 深色 `--accent-soft` | 深色 `--accent-soft-strong` |
|---|---|---|---|
| `#0071e3` | `#eef6ff` | `#0b1f33` | `#12314f` |
| `#ff375f` | `#fff0f3` | `#33101a` | `#4f1626` |
| `#34c759` | `#effaf1` | `#0a2412` | `#10371c` |
| `#ff9500` | `#fff7ec` | `#2b1d07` | `#422d0b` |
| `#af52de` | `#faf0fc` | `#221030` | `#34184a` |
| `#5856d6` | `#f2f1fd` | `#12102e` | `#1d1a46` |

- 用户手选的非预置色：深色 `--accent-soft` 用 CSS `color-mix(in srgb, var(--accent) 14%, var(--bg-raised))` 兜底（Chromium 134 支持，Electron 35 可用；不用 JS）。

### 1.3 间距 / 圆角 / 阴影

- 间距沿用现有 4px 节奏（4/8/12/16/20/24/32/40），新组件统一从该刻度取，不出现 7px、13px 之类散值（按钮内边距 `10px 18px` 等现有值保留，不强行改）。
- 圆角：`--radius:18px`（大卡）、`--radius-sm:12px`（控件/面板）、新增 `--radius-xs:8px`（输入框、日志表、角标统一用它）。
- 阴影：仅 `--shadow` / `--shadow-lg` 两档，深色下按上表替换。

### 1.4 字体与数字

- 字体栈保留现状（系统栈 + PingFang / Microsoft YaHei）。
- 计数器、尺寸、滑块数值统一 `font-variant-numeric:tabular-nums`，避免数字跳动（滑块数值已用，扩展到灯箱计数、幻灯片计数、批量进度）。

### 1.5 动效 token（全局统一，引用不复制）

CSS 变量（供 `transition` 使用）：

```css
:root{
  --motion-fast:.18s;
  --motion-base:.28s;
  --motion-slow:.45s;
  --motion-spring:cubic-bezier(.34,1.56,.64,1);
  --motion-out:cubic-bezier(.22,1,.36,1);
}
```

JS token（`public/ui-anim.js` 顶部集中定义）：

```js
const D = { fast: .18, base: .28, slow: .45 };
const EASE = { out: 'power2.out', spring: 'back.out(1.6)', in: 'power1.in' };
const STAGGER = .04;
```

节奏约定：

| 场景 | 时长 | 缓动 |
|---|---|---|
| hover / 状态切换（开关、chip、图标） | 0.18s | `power2.out` |
| 单元素入场（toast、卡片） | 0.28s | `power2.out` / `back.out(1.6)` |
| 模态框 / 遮罩 | 0.2–0.28s | `power1.out` + `back.out(1.6)` |
| 网格 Flip 重排 | 0.4s | `power2.inOut` |
| 页面切换 | 0.32s | `power2.out` |
| 图片交叉过渡 | 0.1s 出 + 0.26s 入 | `power1.in` / `power2.out` |
| stagger 间隔 | 0.04s | — |

**减弱动效**：`reduceMotion !== 'off'` 时所有时长归 0（沿用现有 `UIAnim.reduce` 模式）。评审已定三态：`跟随系统 / 开启 / 关闭`，默认跟随系统（见 §3.7 设置页与 §4 settings 新键）。

### 1.6 深色模式机制

- 开关只手动二态（评审已定：不跟随系统）：`settings.theme = 'light' | 'dark'`，默认 `light`。
- 应用方式：`document.documentElement.dataset.theme = settings.theme`，CSS 用 `html[data-theme="dark"]` 覆盖变量；同时设置 `color-scheme`。
- 启动时 `loadSettings()` 后立即应用，切换即时生效、无需重启。
- 主题色机制（`applyAccent`）不变，与深色变量正交。

### 1.7 滚动条（新增全局样式）

```css
*{scrollbar-width:thin;scrollbar-color:var(--scrollbar) transparent}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:var(--scrollbar);border-radius:6px;border:2px solid transparent;background-clip:padding-box}
::-webkit-scrollbar-thumb:hover{background:var(--scrollbar-hover);background-clip:padding-box}
::-webkit-scrollbar-track{background:transparent}
```

深浅自动跟随变量，无需媒体查询。

### 1.8 焦点样式（键盘可访问性）

```css
:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;border-radius:6px}
```

应用到所有按钮、链接、输入框、select、range、卡片。不改变 `:focus`（鼠标点击不显示粗描边）。

---

## 2. 全局组件

### 2.1 自定义 confirm 模态框

**目标**：替换全部原生 `confirm()`，统一视觉与键盘行为。

- 新增 `#confirmModal`（复用 `.modal` 外壳与 `UIAnim.modal` 动画），结构：标题、正文、`[取消] [确定]`；危险操作时确定按钮用 `.danger` 样式。
- 前端 API：`showConfirm(title, message, { danger = false, confirmText = '确定' }) → Promise<boolean>`；Esc / 取消 → `false`，Enter / 确定 → `true`；打开时确定按钮自动聚焦（防误按 Enter 直接删除）。
- 替换点（现 `confirm()` 全部迁移）：清空全部照片（相册顶栏 + 设置页存储卡）、单张删除、批量删除、抹除 EXIF、删除收藏夹、清空日志。
- 与现有 `showInputModal` / `showSelectModal` 同一套模态体系，可复用关闭互斥逻辑（同时只开一个）。

### 2.2 Toast 动作按钮

**目标**：`toast()` 支持可选动作，为"复制成功可跳转 / 处理完成可查看"等场景预留。

- `toast(msg, opts)`，`opts = { err, action: { label, onClick } }`；动作按钮显示在消息右侧（`.toast .toast-action`），点击执行并立即关闭 toast；自动消失时间不变。
- 现有 `toast(msg, err)` 调用保持兼容（`err` 布尔沿用）。
- 首批消费者：EXIF 值复制成功（"已复制" + [打开地图] 仅在 GPS 字段时出现）、ZIP 打包完成、批量处理完成。
- 动画：消息区 `autoAlpha`，动作按钮随 toast 一起进出，不单独动画。

### 2.3 空状态 CTA

| 页面 | 触发 | CTA |
|---|---|---|
| 相册搜索无结果 | `photos.length===0` 且搜索/筛选/隐藏排除任一激活 | "没有找到匹配的照片" + **[清除筛选]**（清空 searchInput + 两个 select + hideReject，重新 loadPhotos） |
| 相册为空 | 无筛选且 `photos.length===0` | 保留现有 dropzone 引导（见 §3.1） |
| 收藏夹为空 | `albums.length===0` | 保留现有"点击上方创建一个" |
| 收藏夹详情为空 | 无照片 | **[去相册选照片]**（switchView('library')） |
| 日志为空 | 无日志 | 保留"暂无日志记录"（不加 CTA） |
| 编辑器 / EXIF 空 | 无当前照片 | 已有"前往相册"，样式随深色变量即可 |

### 2.4 页面方向过渡（GSAP 接管 `.view`）

- 现状：CSS `viewIn` 每次切视图重放（淡入 + 上移 16px）。
- 目标：由 `ui-anim.js` 接管，`switchView()` 变化时：
  1. 旧视图 `autoAlpha 0`（0.14s，`power1.in`），结束后移除 `.active`；
  2. 新视图加 `.active`，从 `y:12` + `autoAlpha 0` → 原位（0.32s，`power2.out`）；
  3. 方向感知（低成本版）：从侧边栏进入的非首层视图（编辑器/EXIF/设置/日志/关于）从 `x:16` 进入；返回相册/收藏夹用 `y:12`。reduced-motion 下瞬时切换。
- 实现要点：用 `gsap.context()` 包裹每次切换并 `ctx.revert()` 清理；同一时间只允许一个页面 tween；`.ui-anim` 类存在时禁用 CSS `viewIn`（现有模式）。

### 2.5 `?` 快捷键浮层

- 新增 `#shortcutModal`（复用模态体系），内容为**快捷键总表**（§6 附录为准），分组：相册 / 灯箱 / 缩放态 / 对比选片 / 编辑器 / 幻灯片 / 全局。
- 顶部搜索框（按键名/说明过滤，纯前端）。
- 打开：`?` 键（非输入框内）、设置页"快捷键速查"按钮；关闭：Esc、点遮罩、关闭按钮。
- 每次打开重建列表（从一份 JS 常量表渲染，保证与实现一致；后续加快捷键只需改常量表）。

### 2.6 全局拖放上传遮罩

- 现状问题：`window` 的 `dragover/drop` 被 `preventDefault()` 吞掉，dropzone 之外拖放无反应。
- 目标：窗口任意位置拖入图片文件 → 显示全屏遮罩 `#uploadOverlay`（半透明深色底 + 虚线框 + "松开即可上传 N 张"计数），松手即上传；按 Esc 或拖出窗口取消。
- 实现：window 级 `dragenter/dragover` 检测 `dataTransfer.types.includes('Files')` → 显示遮罩并更新计数；`drop` → `uploadFiles(files)` 并隐藏；`dragleave`（target 不在窗口内时）隐藏。dropzone 本地 handler 保留（小区域即时反馈）。
- 遮罩 z-index 高于除模态外的所有层；深色下用 `--overlay` 变量。

---

## 3. 逐页规格

### 3.1 相册页

#### 3.1.1 dropzone 弱化为紧凑条（评审已定）

- 无照片时：显示现有完整 dropzone（新用户发现性）。
- 有照片时：`.dropzone` 加 `.compact`——高度减半（`padding:14px 20px`），内容改为单行："📷 点击或拖拽照片到窗口任意位置上传"（`strong` 样式），仍可点击打开文件选择；上传进度条保留在底部。
- 过渡：切换时 `height/padding` 用 `transition`（0.28s `--motion-out`）；这是布局属性，仅发生一次，不做 GSAP。

#### 3.1.2 上传进度细化

- 进度条下方/上方新增一行 `#uploadStatus`："上传 3/12 · DSC_0042.jpg"（`tabular-nums`）。
- 完成 toast 带汇总：成功 N 张，失败 M 张（M>0 用 err 样式）。
- 失败清单：上传接口按现有整体返回，前端按 XHR `onload` 的 `r` 解析（现有逻辑已返回每张结果；规格：失败时在 toast 后追加可展开的失败列表，或写入日志页并提示"详见日志"——实现时二选一，默认后者，不新增 UI 组件）。

#### 3.1.3 网格 Flip 过渡（评审已定）

- 引入 `Flip` 插件：`public/vendor/gsap/FlipPlugin.min.js`（从 gsap npm 包复制），`ui-anim.js` 内 `gsap.registerPlugin(Flip)`。
- `renderGrid()` 流程改为：
  1. `const flipState = Flip.getState(cards)`（旧卡片集合，按 id 建索引）；
  2. 重建 DOM（现状逻辑）；
  3. `Flip.from(flipState, { duration:.4, ease:'power2.inOut', scale:true, absolute:true })`；
  4. 仅对**新出现**的卡片执行 `UIAnim.gridIn`（避免重复入场动画）。
- 触发场景：搜索 / 排序 / 筛选 / 隐藏排除 / 评分标记后重绘（现有全部走 `renderGrid()`，一处改动全覆盖）。
- 与瀑布流共存：`Flip` 在 `layoutMasonry` 之后调用（先定位，再补间）。
- 无 GSAP 时保持现状（CSS 网格 + `pop` 动画）。

#### 3.1.4 卡片 hover 快捷评分（评审已定）

- 卡片 hover 时，在底部 meta 上方显示 5 颗小星 `.quick-stars`（font-size 12px，颜色 `#f5c518`，已评满的星实心）。
- 交互：hover 显示（`autoAlpha` + `y:4→0`，0.18s）；点击第 n 颗 → `setStars(id, n)`，星星做一次 `scale 1→1.25→1` 的 pop（GSAP，0.2s）；第 0 星（清除）不提供——清除评分仍走键盘 `0` 或批量评分。
- 与现有 `stars-badge` 的关系：`stars-badge` 保留（非 hover 常显当前评分），`.quick-stars` 只在 hover 时出现；二者不重叠（quick-stars 位于 meta 内）。

#### 3.1.5 批量条与计数（评审已定）

- 工具栏右侧新增计数 `#libCount`："共 42 张"（当前筛选结果数；空则隐藏）。
- 批量条新增已选缩略图条 `.batch-thumbs`：24px 圆角缩略图（`/thumbs/{id}.webp`），水平滚动，最多显示 8 个 + "＋N"；点击某缩略图取消选中该张（与勾选一致）。
- 批量条布局：缩略图条在左（`selCount` 之前），操作按钮保持现状；`flex-wrap` 已支持换行，深色下 `--accent-soft` 暗色底即可。

#### 3.1.6 深色适配要点

- 卡片底 `--bg-raised`；hover 阴影用深色 `--shadow-lg`；meta 渐变保留（黑色上浮即可）；勾选框未选中态在深色下用 `rgba(255,255,255,.25)` 底。
- 瀑布流占位色：`img` 未加载时卡片底用 `--bg-soft2`，避免深色下闪白。

### 3.2 灯箱

#### 3.2.1 计数器（评审已定）

- 新增 `.lb-index` 药丸（左上角，`top:26px;left:26px`）：`3 / 25`，`tabular-nums`，`backdrop-filter` 白/黑底跟随主题变量。
- `openLightbox` / `navLb` / `openCompare` 时同步更新；缩放态仍显示。

#### 3.2.2 底部胶片条（评审已定）

- 新增 `#lbFilmstrip`（底部、工具条上方）：水平缩略图条，每张 56px 圆角缩略图，当前张高亮（`--accent` 描边 + 轻微放大 `scale(1.08)`）；点击跳转（`lbIndex=i; navLb(0)` 语义为直接换图 + 更新 caption）。
- 可见性：`photos.length > 1` 时显示；**对比模式与缩放态隐藏**（避免与 `←/→` 语义冲突）。
- 深色下缩略图边框 `--line`，未选中透明度 0.75。

#### 3.2.3 EXIF 摘要条（评审已定）

- 新增 `.lb-exif` 摘要条（顶部居中或右上，跟随计数器同侧避免遮挡）：`f/2.8 · 1/250s · ISO 400 · 50mm · 2026-08-07 10:00`，字段缺失跳过，全部缺失则不显示。
- 数据：按需 `GET /api/photos/:id/exif`，前端内存缓存 `Map<id, ex>`（换页不重复请求）；加载中显示 `——`。
- 点击摘要条 → 打开该照片信息页（`openExif`）；样式带 hover 提示"查看详细信息"。
- 与缩放/胶片条不冲突：摘要常显。

#### 3.2.4 缩放平移（评审已定）

- 交互规格：
  - 滚轮：以鼠标位置为锚点缩放，范围 **1×–5×**；`deltaY<0` 放大、`>0` 缩小。
  - 拖拽：缩放 > 1 时按住图片平移；缩放 = 1 时拖拽不响应（保留换图）。
  - 双击：1× ↔ 2× 切换（双击时若已缩放则复位 1×）。
  - `Esc`：复位 1× 并退出缩放态。
  - 复位按钮：工具条新增 `[⤢ 适应窗口]`（缩放非 1 时显示）。
- 实现：`#lbImg` 外包一层 `.lb-zoom`（transform 挂这里，clip 不裁），`scale` 用 `gsap.quickTo`（缩放 0.25s、平移 0.12s 跟手），平移边界 clamp（`gsap.utils.clamp`）。
- **缩放态键盘语义（评审已定）**：`←/→` 平移（不再换图）、`Esc`/双击退出；**选片键 `P/R/X/U/1-5/0` 仍生效**（继续 `markTarget/rateTarget`）；退出缩放后 `←/→` 恢复换图。
- 与对比模式互斥：进入对比前若缩放中先复位（`resetZoom()`）。

#### 3.2.5 方向化导航动画（评审已定）

- `navLb(d)` 用 timeline：当前图 `x:∓14` + `autoAlpha:0`（0.1s）→ 换 src → 新图从 `x:±14` 归零 + 淡入（0.26s，`power2.out`）；方向由 `d` 决定。
- 保留现有 `crossfade` 接口给幻灯片（§3.3 扩展），灯箱导航改用新的 `navCrossfade(img, src, dir, onDone)`。
- reduced-motion：直接换源（现有分支）。

### 3.3 幻灯片

#### 3.3.1 Ken Burns 慢推（评审已定）

- 每张图播放：`scale 1 → 1.06`（克制），奇偶张交替"放大 / 缩小"（从 1.06 → 1），避免连续同向；时长 = 播放间隔，`power1.inOut`。
- 实现：`slShow` 内 timeline——`crossfade` 换源后并行启动 Ken Burns；图片 `transform-origin` 交替取 `50% 40%` / `50% 60%`（轻微重心变化）。
- reduced-motion：仅 fade，无缩放。

#### 3.3.2 播放间隔与进度（评审已定）

- 间隔读 `settings.slideshowInterval`（3 / 5 / 10 秒，默认 3），设置页修改后对已开幻灯片即时生效（下一次间隔）。
- 计数：`sl-info` 前缀 `3 / 25`（`tabular-nums`）。
- 顶部细进度条 `#slProgress`：每张从 `scaleX(0)` 动画到 `scaleX(1)`（`transform-origin:left`，时长=间隔，`power1.inOut`）；暂停时 `pause()`，继续 `resume()`。

### 3.4 编辑器

#### 3.4.1 滑块细节（评审已定）

- **双击复位**：双击滑块标签或值 → 恢复该参数默认值（亮度/对比度/饱和度 100、色相 0、锐化 0、模糊 0；新参数见 3.4.2），走 `saveEditState()` 入撤销栈。
- **改动标记**：参数值 ≠ 默认时，标签右侧显示 4px 主题色圆点（`.slider-row.modified i::after`）；重置后消失。
- 撤销/重做按钮：调整面板顶部加 `[↶ 撤销] [↷ 重做]`（`disabled` 状态跟随栈空/满），与 Ctrl+Z/Y 共享 `undo()/redo()`。

#### 3.4.2 新参数：色温 / 色调 / 暗角 / 颗粒（评审已定）

前端（调整面板，"黑白"开关上方）：

| 参数 | 范围 | 默认 | 说明 |
|---|---|---|---|
| 色温 `temperature` | -100 … 100 | 0 | 正=暖（琥珀），负=冷（蓝） |
| 色调 `tint` | -100 … 100 | 0 | 正=品红，负=绿 |
| 暗角 `vignette` | 0 … 100 | 0 | 四周压暗强度 |
| 颗粒 `grain` | 0 … 100 | 0 | 胶片颗粒强度 |

- 实时预览（CSS 近似，最终以服务端渲染为准）：色温/色调用 `filter` 叠加近似（`sepia` + `hue-rotate` 组合或 `mix-blend-mode` 覆盖层，实现时取视觉最接近且便宜的方案）；暗角/颗粒用 canvas-stage 上的叠加层（`#editVignette` 径向渐变、`#editGrain` 噪声 SVG）控制 `opacity`。
- 服务端（sharp，见 §4）：`temperature/tint` 用 `recomb`/`tint` 矩阵近似；`vignette` 用径向渐变蒙版 `composite`；`grain` 用噪声图叠加 `overlay` 混合。
- `defaultEdit`、`buildEditBody`、`applyFilter`、`estimateSize`、批量 pipeline.adjust 校验全部扩展；旧请求缺省 = 默认值（向后兼容）。

#### 3.4.3 草稿持久化（评审已定）

- 定义：每张照片一份**单快照草稿**（不是版本链，版本链仍排除）：`{ adjust, transform, resize, output, updatedAt }`。
- 行为：
  - 编辑参数变化后 debounce 800ms → `PUT /api/photos/:id/draft`；
  - `openEditor(p)` 时若有草稿 → 恢复参数与撤销栈（撤销栈为 [默认态]）；
  - 导出成功（copy 或 overwrite）→ `DELETE /api/photos/:id/draft`，重开后为干净状态；
  - 设置页不加开关（默认开）。
- 数据模型：`drafts.json`（data 目录），`{ [photoId]: {...} }`，原子写（tmp + rename）；单草稿 ≤ 8KB，总数 ≤ 1000，超限清理 `updatedAt` 最旧；`GET` 返回 404 表示无草稿。

#### 3.4.4 画布缩放平移（评审已定）

- 画布 `canvas-stage` 内滚轮缩放（0.25×–4×，鼠标锚点）、缩放 > 1 时拖拽平移、双击复位适应窗口。
- 缩放作用于 `#editImg` 及其兄弟（`#baOrigImg`、裁剪框、叠加层）的外包层 `.canvas-zoom`（transform 统一挂载，避免各元素单独 transform 叠加错乱）。
- 画布底栏新增缩放指示 `[＋] [42%] [－] [适应]`；与现有 `editDims` 并存。
- 与裁剪/对比的坐标换算：`getBoundingClientRect()` 已天然包含 transform，现有 `applyCrop`、BA 分界线逻辑不改；仅需在缩放/平移后对裁剪框和分界线调用一次 `initCropBox()` / 保持 `--ba` 百分比（百分比相对画布，自动正确）。
- 实现：`gsap.quickTo`（scale 0.2s、x/y 0.08s），clamp 用 `gsap.utils.clamp`。

#### 3.4.5 裁剪框升级（评审已定）

- **三分线网格**：`.crop-box` 内 2 竖 2 横 1px 半透明白线（`::before/::after` + 2 个子元素或 CSS 渐变实现），随框缩放。
- **方向键微调**：裁剪激活且框聚焦时，`←/→/↑/↓` 平移 1px、`Shift+方向键` 10px；`[` `]` 缩放框（1px / Shift 10px）——仅在裁剪模式且焦点不在输入框时生效。
- **贴边吸附**：拖动/缩放时距图片边界或中心线 ≤ 6px 时吸附（`gsap.utils.snap` 到边界/中心值）。
- **比例切换保持中心**：`cropRatio` 切换时以当前框中心为锚缩放（现逻辑已居中，补"保持中心"）。

#### 3.4.6 前后对比升级（评审已定）

- **拖动区域扩大**：`baActive` 时在 `canvas-stage` 上 `pointerdown` 即可拖动分界线（不再只能抓 2px 线）；现有分界线 handler 保留并合并（同一事件逻辑）。
- **分屏方向**：新增方向切换按钮（`⇆ 左右` / `⇅ 上下`，循环切换），`canvas-stage` 存 `--ba-dir`；上下分屏用 `clip-path:inset(calc(100% - var(--ba)) 0 0 0)` + 水平分界线（`left:0;right:0;top:var(--ba);height:2px`）。
- 双击分界线复位 50%。

### 3.5 EXIF 页

#### 3.5.1 分组展示（评审已定）

`exif-list` 改为分区渲染：

| 分组 | 字段 |
|---|---|
| 相机 | 相机品牌 / 相机型号 / 镜头 / 软件 |
| 拍摄参数 | 光圈 / 快门 / ISO / 焦距 / 方向 |
| 时间 | 拍摄时间 |
| 文件 | 文件名 / 格式 / 分辨率 / 文件大小 |
| GPS | 纬度 / 经度 |

- 每组一个标题行（`.exif-group-title`，13px 次要色）；空组隐藏。可编辑字段区（作者/版权/描述/拍摄时间）保持现状。

#### 3.5.2 值复制（评审已定）

- 每个 `.exif-item .v` 可点击复制（hover 显示 `⧉` 角标）；成功 toast "已复制：{值}"。
- 实现：`navigator.clipboard.writeText`，失败回退 `textarea + document.execCommand('copy')`（Electron 本地环境兼容）。

#### 3.5.3 GPS 坐标与地图链接（评审已定）

- GPS 组显示：十进制度 + 度分秒两行，值可复制。
- 地图链接（仅在经纬度齐全时）：高德 `https://uri.amap.com/marker?position={lng},{lat}&name=Luma` 与 Google `https://www.google.com/maps?q={lat},{lng}`，`target="_blank" rel="noopener"`（导航不受 CSP `connect-src` 限制）。

### 3.6 收藏夹

#### 3.6.1 首图封面（评审已定）

- 后端 `GET /api/albums` 每项新增 `cover: photoId | null`（第一张加入的照片，按现有存储顺序取第一张）；前端拼 `/thumbs/{id}.webp`。
- 卡片布局：上 16:10 封面图（`object-fit:cover`）+ 下信息区（名称、张数）；无封面时保留现有 📁 占位。
- hover：封面 `scale(1.04)`（0.5s，`power2.out`）+ 阴影升档。
- 深色：封面下叠 8% 黑色渐变保证文字可读。

#### 3.6.2 详情页批量条（评审已定）

- 收藏夹详情页复用与主相册相同的批量条（全选/取消/评分/标记/收藏夹/批量处理/ZIP/删除）；`openAlbum` 已把 `photos` 切换为收藏夹列表，`toggleSelect/updateBatchBar` 逻辑可直接复用。
- 批量操作完成后刷新详情列表（`openAlbum(activeAlbumId)`）而非 `loadPhotos`（避免跳回主相册上下文）；"加入收藏夹"按钮在详情页隐藏（已在该收藏夹内）。

#### 3.6.3 拖拽加入（评审已定，附降级方案）

- 主方案：相册页卡片可拖拽（`draggable` + `dragstart` 记录 photo id）；侧边栏"收藏夹"导航项作为 drop target（`dragover` 高亮、`drop` 时 `preventDefault` 阻止导航切换）→ 松手弹出"加入收藏夹"选择框（复用 `showSelectModal`），确认后 `POST /api/albums/:id/add`。
- 附带：收藏夹详情页同样支持**窗口拖放本地图片文件** → 上传并自动加入当前收藏夹（复用 §2.6 遮罩，drop 后追加 `add`）。
- 降级判定：若拖拽手感/命中不稳定（实现阶段冒烟测试反馈），回退为现有"选中 → 📁 收藏夹"路径，规格中该项标记为"可选"。

### 3.7 设置页

#### 3.7.1 外观卡整合（评审已定）

`设置 > 外观` 卡片包含：

- **主题色**：现有色板 + 自定义取色（不变）。
- **深色模式**：`switch`（浅色 / 深色），即时生效，保存进 settings（`theme`）。
- **减弱动效**：三态 select（跟随系统 / 开启 / 关闭），默认跟随系统；切换后调 `gsap.matchMediaRefresh()` 即时刷新（`ui-anim.js` 改为由 settings 驱动而非模块加载时一次性读取）。

#### 3.7.2 快捷键速查按钮（评审已定）

- 设置页新增 `[⌨ 快捷键速查]` 按钮 → 打开 §2.5 浮层。

#### 3.7.3 打开数据目录（评审已定）

- 设置页"存储"卡显示数据目录路径（后端 `GET /api/stats` 增加 `dataDir`），并新增 `[打开数据目录]` 按钮。
- Electron 实现：新增 `preload.cjs`（`contextBridge.exposeInMainWorld('luma', { openDataDir })` + `ipcRenderer.invoke('open-data-dir')`），`electron-main.cjs` 注册 `ipcMain.handle('open-data-dir', () => shell.openPath(userData))`；渲染端 `window.luma?.openDataDir()`，不存在时按钮禁用。

### 3.8 日志页

- **搜索框**：顶栏新增 `#logsSearch`（占位"搜索消息或详情…"），纯前端过滤当前已加载行（`message`/`data` 文本包含，大小写不敏感），与级别/来源过滤叠加。
- **暂停实时刷新**：`#logsPause` switch；开启后停止 3 秒轮询，按钮态显示"已暂停"，手动"刷新"仍可用。
- **行展开与复制**：点击行切换详情展开（`pre` 的 `max-height:60px` ↔ `none`）；行尾复制按钮复制 `[时间][级别][来源] 消息\n详情`；复制成功走 §2.2 toast。

### 3.9 OOBE

- **深色适配**：跟随 `settings.theme`，无独立开关。
- **步骤动画**：下一步→上一步时内容按方向滑入（出 `x:∓18`/`autoAlpha 0`，入从 `±18` 归零，0.28s `power2.out`）；reduced-motion 瞬时切换。
- **文案更新**：
  - 第 2 页新增："**窗口任意位置拖放**照片即可上传"。
  - 第 4 页快捷键表更新：新增 `?` 快捷键速查、灯箱滚轮缩放/双击复位、画布滚轮缩放、裁剪方向键微调。
- 进度条激活态保持现状，只随步骤动画一起过渡。

---

## 4. 后端与数据模型变更

| 变更 | 端点/位置 | 说明 |
|---|---|---|
| settings 新键 | `GET/POST /api/settings` | `theme:'light'|'dark'`（默认 light）、`reduceMotion:'system'|'on'|'off'`（默认 system）、`slideshowInterval:3|5|10`（默认 3）；校验沿用现有白名单模式，非法值回退默认 |
| adjust 新参数 | `/api/photos/:id/process|render|preview` | `adjust.temperature/tint/vignette/grain`，范围 -100…100 / 0…100；缺失视为默认；批量 `pipeline.adjust` 同样支持（批量 UI 暂不新增滑块） |
| 草稿 | `PUT/GET/DELETE /api/photos/:id/draft` | `drafts.json` 持久化（原子写），单条 ≤8KB、总数 ≤1000、超限清最旧；导出成功后 DELETE |
| 收藏夹封面 | `GET /api/albums` | 每项新增 `cover`（首张照片 id，`null` 为空）；`GET /api/albums/:id/photos` 若存在则同步返回 |
| 数据目录 | `GET /api/stats` | 新增 `dataDir` 字段（Electron 侧注入数据目录，server 端由 `options.dataDir` 提供） |
| 打开目录 | `preload.cjs` + `electron-main.cjs` | `ipcMain.handle('open-data-dir')` → `shell.openPath(userData)`；无 preload 时按钮禁用 |
| EXIF 摘要 | 无后端变更 | 复用 `GET /api/photos/:id/exif` |

兼容性：所有新字段可选/带默认，旧客户端请求不破坏现有行为；`test/server.test.cjs` 增加对应回归（设置校验、adjust 默认值、草稿往返、albums cover）。

---

## 5. 工作量拆解与验收清单

### 5.1 拆解（相对估算 S/M/L）

| 批次 | 内容 | 前端 | 后端/Electron | 验收 |
|---|---|---|---|---|
| 1 设计系统 | token 化、深色变量、滚动条、焦点样式、`data-theme` 机制 | S | — | 深浅两套截图 |
| 2 全局组件 | confirm、toast 动作、空状态、页面过渡、`?` 浮层、拖放遮罩 | M | — | 冒烟覆盖 |
| 3 相册 | dropzone 紧凑、上传进度、Flip、hover 评分、批量条/计数 | M | — | 冒烟覆盖 |
| 4 灯箱/幻灯片 | 计数、胶片条、EXIF 摘要、缩放、方向动画、Ken Burns、间隔/进度 | M | — | 冒烟覆盖 |
| 5 编辑器 | 滑块细节、新参数、草稿、画布缩放、裁剪升级、对比升级 | M | M（新参数管线 + 草稿 API） | 服务端测试 + 冒烟 |
| 6 EXIF/收藏夹 | 分组、复制、GPS 链接、封面、详情批量条、拖拽加入 | M | S（albums cover） | 服务端测试 + 冒烟 |
| 7 设置/日志/OOBE | 外观卡、快捷键入口、打开目录、日志搜索/暂停/复制、OOBE | S | S（preload + stats.dataDir） | 冒烟覆盖 |

### 5.2 验收清单（实现时逐条勾）

- [ ] `npm test` 全绿（新增：settings 新键校验、adjust 新参数默认值、草稿往返与上限清理、albums cover）。
- [ ] `npx electron scripts/ui-smoke.cjs` 全绿；新增用例：拖放遮罩出现/消失、Flip 后网格卡片数不变、灯箱缩放态 `←/→` 平移且选片键生效、confirm 模态框替代原生、`?` 浮层打开关闭、深色开关即时生效、草稿保存/恢复/清除。
- [ ] 深浅两套主题下所有页面截图走查：无纯白/纯黑刺眼块、无文字对比度低于 4.5:1（`--text-soft` 在深色下 ≥ `#a1a1a6`）。
- [ ] reduced-motion 三态各自验证：跟随系统 / 强制开启（全动画 0 时长）/ 强制关闭（动画正常）。
- [ ] 键盘：缩放态语义、裁剪方向键、`?` 浮层搜索与 Esc 关闭、全页面 `Tab` 焦点可见。
- [ ] 旧数据兼容：老 settings.json 无新键时按默认值启动；老请求体无新 adjust 参数时结果与 v1.1.0 一致。
- [ ] 文档同步：CHANGELOG、README（功能清单）、OOBE 文案、快捷键表（§6）与实际实现一致。

---

## 6. 附录：快捷键总表（新）

| 场景 | 按键 | 动作 |
|---|---|---|
| 全局 | `?` | 打开/关闭快捷键速查浮层 |
| 全局 | `H` | 相册视图隐藏/显示排除照片 |
| 灯箱 | `←` `→` | 上一张 / 下一张 |
| 灯箱 | `Esc` | 退出缩放 → 关闭灯箱 |
| 灯箱（缩放态） | `←` `→` | 平移（换图被缩放替代） |
| 灯箱（缩放态） | `Esc` / 双击 | 复位缩放 |
| 灯箱 | `P` `R` `X` `U` | 精选 / 排除 / 排除并跳转 / 清除标记 |
| 灯箱 | `1-5` `0` | 评分 / 清除评分（配合自动跳转设置） |
| 灯箱 | `C` | 进入并排对比选片 |
| 对比选片 | `Tab` | 切换标记目标（左/右） |
| 对比选片 | `←` `→` | 上一组 / 下一组 |
| 对比选片 | `Esc` | 退出对比 |
| 对比选片 | `P/R/X/U` `1-5` `0` | 标记/评分当前目标并进下一组 |
| 编辑器 | `Ctrl+Z` `Ctrl+Y`（或 `Ctrl+Shift+Z`） | 撤销 / 重做 |
| 编辑器 | `1-5` `0` `P/R/X/U` | 对当前照片评分/标记 |
| 编辑器（裁剪） | `←→↑↓` / `Shift+方向键` | 平移裁剪框 1px / 10px |
| 编辑器（裁剪） | `[` `]` / `Shift+[` `]` | 缩放裁剪框 1px / 10px |
| 幻灯片 | `空格` | 暂停 / 继续 |
| 幻灯片 | `←` `→` `Esc` | 上一张 / 下一张 / 退出 |
