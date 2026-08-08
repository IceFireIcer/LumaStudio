/* ============ 工具 ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
// v1.2.1 本地访问令牌：Electron 场景经 preload 获取，写请求自动携带 X-Luma-Token 头；
// 纯浏览器/测试场景无令牌且服务端不强制校验，行为与旧版一致。
let authToken = '';
const api = {
  async get(u){ const r = await fetch(u); return r.json(); },
  async post(u, b){ const r = await fetch(u, {method:'POST',headers:{'Content-Type':'application/json', ...(authToken ? {'X-Luma-Token': authToken} : {})},body:JSON.stringify(b)}); return r.json(); },
  async put(u, b){ const r = await fetch(u, {method:'PUT',headers:{'Content-Type':'application/json', ...(authToken ? {'X-Luma-Token': authToken} : {})},body:JSON.stringify(b)}); return r.json(); },
  async del(u){ const r = await fetch(u, {method:'DELETE', headers: authToken ? {'X-Luma-Token': authToken} : {}}); return r.json(); },
};
// 启动时经 preload IPC 获取访问令牌（非 Electron 环境返回空串）
async function initAuthToken(){
  try {
    if (window.luma && typeof window.luma.getToken === 'function') {
      const t = await window.luma.getToken();
      if (typeof t === 'string') return t;
    }
  } catch (e) { console.error('获取访问令牌失败', e); }
  return '';
}
const fmtSize = n => n < 1024 ? n+' B' : n < 1048576 ? (n/1024).toFixed(1)+' KB' : (n/1048576).toFixed(2)+' MB';
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// 触发浏览器下载某张照片的原图文件
function downloadPhoto(p){
  const a = document.createElement('a');
  a.href = '/files/' + p.file + '?download=1';
  a.download = p.name || p.file;
  document.body.appendChild(a); a.click(); a.remove();
}

let toastTimer;
// v1.2 §2.2：toast(msg, opts)，opts = { err, action: { label, onClick } }；兼容旧 toast(msg, err)
function toast(msg, opts){
  const t = $('#toast');
  const o = (opts && typeof opts === 'object') ? opts : { err: !!opts };
  if (window.UIAnim) { window.UIAnim.toast(t, msg, o); return; }
  // 无 GSAP 降级
  t.textContent = msg;
  let btn = t.querySelector('.toast-action');
  if (o.action && o.action.label) {
    if (!btn) { btn = document.createElement('button'); btn.className = 'toast-action'; t.appendChild(btn); }
    btn.textContent = o.action.label;
    btn.onclick = () => { const fn = o.action.onClick; t.classList.remove('show'); if (fn) fn(); };
  } else if (btn) { btn.remove(); }
  t.className = 'toast show' + (o.err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>t.className='toast', 2400);
}
function showLoading(){ $('#loadingOverlay').classList.add('show'); }
function hideLoading(){ $('#loadingOverlay').classList.remove('show'); }

// v1.2 §2.1：统一确认模态框，替代原生 confirm()；返回 Promise<boolean>
function showConfirm(title, message, opts = {}){
  return new Promise(resolve => {
    const modal = $('#confirmModal');
    if (!modal) { resolve(window.confirm(message)); return; }
    // 与其他模态互斥：打开前关掉输入/选择模态
    $('#inputModal').hidden = true;
    $('#selectModal').hidden = true;
    $('#confirmTitle').textContent = title;
    $('#confirmMsg').textContent = message;
    const okBtn = $('#confirmOk');
    okBtn.textContent = opts.confirmText || '确定';
    okBtn.classList.toggle('danger', !!opts.danger);
    if (window.UIAnim) window.UIAnim.modal(modal, $('.modal-content', modal), true);
    else modal.hidden = false;
    okBtn.focus(); // 防误按 Enter 直接删除
    const cleanup = val => {
      if (window.UIAnim) window.UIAnim.modal(modal, $('.modal-content', modal), false);
      else modal.hidden = true;
      $('#confirmCancel').onclick = null;
      $('#confirmOk').onclick = null;
      document.removeEventListener('keydown', onKey, true);
      resolve(val);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
      else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
    };
    document.addEventListener('keydown', onKey, true);
    $('#confirmCancel').onclick = () => cleanup(false);
    $('#confirmOk').onclick = () => cleanup(true);
  });
}

/* ============ 状态 ============ */
let photos = [];
let current = null;   // 正在编辑/查看的照片
let lbIndex = -1;
let lastExifId = null;   // 信息页当前已加载的照片 id
let lastEditorId = null; // 编辑器当前已加载的照片 id
let settings = {};
let selected = new Set(); // 多选照片 ID 集合
let albums = [];
let activeAlbumId = null; // 正在浏览的相册
let hideReject = false;   // 隐藏排除照片
let slTimer = null; // 幻灯片定时器

/* ============ 视图切换 ============ */
function switchView(name){
  $$('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.view===name));
  const oldEl = document.querySelector('.view.active');
  const newEl = document.querySelector(`.view[data-view="${name}"]`);
  if (!newEl) return;
  // v1.2 §2.4：非首层视图从侧边栏进入用 x 方向；返回相册/收藏夹用 y 方向
  const fromSidebar = ['editor','exif','settings','logs','about'].includes(name);
  if (window.UIAnim) window.UIAnim.switchView(oldEl, newEl, { fromSidebar });
  else {
    if (oldEl) oldEl.classList.remove('active');
    newEl.classList.add('active');
  }
  $('.stage').scrollTop = 0;
  if(name==='settings') loadStats();
  if(name==='about') loadAbout();
  if(name==='albums'){ activeAlbumId=null; $('#albumDetail').hidden=true; $('#albumsGrid').style.display=''; loadAlbums(); }
  // v1.2 §3.6.2 从收藏夹详情切回相册：复位专辑上下文，避免库视图被 album 过滤
  if(name==='library' && activeAlbumId){ activeAlbumId = null; loadPhotos(); }
  if(name==='logs') loadLogs();
  // 编辑器 / 信息 页若没有已选照片,显示空状态提示而不是破图
  if(name==='editor'){
    const has = !!current;
    $('#editorWrap').classList.toggle('hidden', !has);
    $('#editorEmpty').classList.toggle('show', !has);
  }
  if(name==='exif'){
    const has = !!current;
    $('#exifWrap').classList.toggle('hidden', !has);
    $('#exifEmpty').classList.toggle('show', !has);
  }
}
// 侧边栏导航：信息/编辑器页面若已有当前照片，需先加载对应内容，
// 否则只切视图外壳会导致左侧预览空白（图片 src 和元数据都没有设置）
$$('.nav-item').forEach(b=>b.onclick=()=>{
  const v = b.dataset.view;
  if(v==='exif' && current){
    if(lastExifId !== current.id) openExif(current); else switchView('exif');
  } else if(v==='editor' && current){
    if(lastEditorId !== current.id) openEditor(current); else switchView('editor');
  } else {
    switchView(v);
  }
});
$$('[data-goto]').forEach(b=>b.onclick=()=>switchView(b.dataset.goto));

/* ============ 相册 ============ */
const grid = $('#grid'), emptyState = $('#emptyState');
let lastRenderedIds = new Set(); // 上次渲染的卡片 id（用于 Flip 区分新卡片）

async function loadPhotos(){
  const q = $('#searchInput').value.trim();
  const sort = $('#sortSelect').value;
  const flag = $('#filterSelect').value;
  const fmt = $('#formatFilter').value;
  const params = new URLSearchParams();
  if(q) params.set('q', q);
  if(sort) params.set('sort', sort);
  if(flag && !isNaN(flag)) params.set('stars', flag);
  else if(flag) params.set('flag', flag);
  if(fmt) params.set('format', fmt);
  if(activeAlbumId) params.set('album', activeAlbumId);
  if(hideReject) params.set('hideReject', '1');
  photos = await api.get('/api/search?'+params);
  renderGrid();
  updateBatchBar();
  $('#storageMini').textContent = `${photos.length} 张照片`;
}
async function loadAlbums(){
  albums = await api.get('/api/albums');
  renderAlbums();
}

/* ============ 瀑布流布局 ============
 * GSAP 可用时启用：短列优先分配，DOM 顺序 = 视觉顺序（灯箱/幻灯片索引保持一致）。
 * 定位用 left/top（静态布局），入场动画由 UIAnim.gridIn 用 transform 完成。
 */
const GRID_GAP = 18;
let masonryRoot = null;
let masonryCards = [];

// 卡片实际显示比例：缩略图已加载时用真实宽高比。
// 不能用入库宽高直接算——EXIF 方向照片（竖拍）的入库宽高可能是旋转前的，
// 与缩略图（已按方向旋转）比例不一致，按它排版会让卡片重叠。
function cardRatio(card){
  const img = card.querySelector('img');
  if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
    return img.naturalHeight / img.naturalWidth;
  }
  return parseFloat(card.dataset.ratio || '1') || 1;
}

function layoutMasonry(root, cards){
  masonryRoot = root;
  masonryCards = cards;
  if(!root || !cards.length){ if(root) root.style.height = ''; return; }
  if(!window.gsap) return; // 无 GSAP 时保持原 CSS 网格
  const width = root.clientWidth;
  const minCol = 200;
  const cols = Math.max(1, Math.min(8, Math.floor((width + GRID_GAP) / (minCol + GRID_GAP))));
  const colW = (width - GRID_GAP * (cols - 1)) / cols;
  const heights = new Array(cols).fill(0);
  cards.forEach(card => {
    const ratio = cardRatio(card);
    const h = Math.round(colW * ratio);
    let col = 0;
    for(let c = 1; c < cols; c++) if(heights[c] < heights[col]) col = c;
    card.style.left = (col * (colW + GRID_GAP)) + 'px';
    card.style.top = heights[col] + 'px';
    card.style.width = colW + 'px';
    heights[col] += h + GRID_GAP;
  });
  root.style.height = Math.max(...heights) + 'px';
  // 缩略图是懒加载的：加载完成后按真实尺寸重排，避免首轮排版与实际高度不符导致重叠
  cards.forEach(card => {
    const img = card.querySelector('img');
    if (img && !img._masonryBound) {
      img._masonryBound = true;
      img.addEventListener('load', scheduleMasonry);
    }
  });
}

let masonryTimer;
// 缩略图逐个加载完成时合并成一次重排（防抖）
function scheduleMasonry(){
  clearTimeout(masonryTimer);
  masonryTimer = setTimeout(()=>{ if(masonryRoot && masonryCards.length) layoutMasonry(masonryRoot, masonryCards); }, 80);
}
window.addEventListener('resize', ()=>{
  clearTimeout(masonryTimer);
  masonryTimer = setTimeout(()=>{ if(masonryRoot) layoutMasonry(masonryRoot, masonryCards); }, 150);
});

function renderGrid(){
  // v1.2 §3.1.3 网格 Flip：重绘前捕获旧卡片状态
  const flipState = (window.Flip && window.gsap) ? Flip.getState(grid.querySelectorAll('.card')) : null;
  grid.innerHTML = '';
  // v1.2 §2.3 空状态 CTA：搜索/筛选/隐藏排除激活时显示"清除筛选"
  const filtersActive = !!( $('#searchInput').value.trim() || $('#filterSelect').value || $('#formatFilter').value || hideReject );
  if (photos.length === 0 && filtersActive) {
    emptyState.innerHTML = '<div class="empty-ico">🔍</div><p>没有找到匹配的照片</p><button class="btn primary" id="clearFiltersBtn">清除筛选</button>';
    $('#clearFiltersBtn').onclick = () => {
      $('#searchInput').value = '';
      $('#sortSelect').value = '';
      $('#filterSelect').value = '';
      $('#formatFilter').value = '';
      hideReject = false;
      $('#hideRejectBtn').classList.toggle('active', false);
      loadPhotos();
    };
  } else {
    emptyState.innerHTML = '<div class="empty-ico">🖼️</div><p>还没有照片,上传几张开始吧</p>';
  }
  emptyState.classList.toggle('show', photos.length===0);
  // v1.2 §3.1.5 计数
  const libCount = $('#libCount');
  if (libCount) {
    libCount.textContent = `共 ${photos.length} 张`;
    libCount.hidden = photos.length === 0;
  }
  const cards = [];
  photos.forEach((p,i)=>{
    const card = createCard(p, i);
    grid.appendChild(card);
    cards.push(card);
  });
  if(window.gsap){ grid.classList.add('masonry'); layoutMasonry(grid, cards); }
  else grid.classList.remove('masonry');
  // Flip 补间旧卡片位置；仅新出现卡片执行入场动画
  if (flipState && window.Flip) {
    // renderGrid 是整体重建 DOM，需把新卡片集合传给 Flip 做位置匹配
    Flip.from(flipState, { targets: cards, duration: 0.4, ease: 'power2.inOut', scale: true, absolute: true });
  }
  const newCards = cards.filter(c => !lastRenderedIds.has(c.dataset.id));
  if (window.UIAnim) window.UIAnim.gridIn(newCards);
  lastRenderedIds = new Set(cards.map(c=>c.dataset.id));
  // v1.2 §3.1.1：有照片时 dropzone 弱化为紧凑条
  $('#dropzone').classList.toggle('compact', photos.length > 0);
}

// 构建照片卡片（相册/收藏夹详情共用；v1.2 §3.1.4 快捷评分、§3.6.2 详情批量）
function createCard(p, i, opts = {}){
  const card = document.createElement('div');
  card.className = 'card' + (selected.has(p.id) ? ' selected' : '');
  card.dataset.id = p.id;
  card.dataset.ratio = (p.width && p.height) ? (p.height / p.width) : 1;
  const starN = Math.max(0, Math.min(5, +p.stars || 0));
  const starStr = starN > 0 ? '★'.repeat(starN) + '☆'.repeat(5-starN) : '';
  const quickStars = [1,2,3,4,5].map(n =>
    `<span data-s="${n}" title="评 ${n} 星">${n <= starN ? '★' : '☆'}</span>`).join('');
  const flagHtml = p.flag === 'pick' ? '<div class="flag-badge pick show">精选</div>'
                 : p.flag === 'reject' ? '<div class="flag-badge reject show">排除</div>'
                 : '';
  const rmBtn = opts.albumMode
    ? '<button class="mini rm" title="从收藏夹移除">✕</button>'
    : '<button class="mini del" title="删除">✕</button>';
  card.innerHTML = `
    <div class="sel-check" title="点击选中/取消">${selected.has(p.id)?'✓':''}</div>
    <img src="/thumbs/${p.id}.webp?v=${p.time}" alt="${esc(p.name)}" loading="lazy">
    <div class="badge">${p.width}×${p.height}</div>
    <div class="stars-badge${p.stars>0?' has':''}">${starStr}</div>
    ${flagHtml}
    <div class="acts">
      <button class="mini edit" title="编辑">✎</button>
      <button class="mini info" title="信息">ⓘ</button>
      <button class="mini dl" title="下载">⬇</button>
      ${rmBtn}
    </div>
    <div class="meta">
      <div class="quick-stars">${quickStars}</div>
      <div class="meta-name">${esc(p.name)} · ${fmtSize(p.size)}</div>
    </div>`;
  // v1.2 §3.6.3 相册页卡片可拖拽（记录 photo id）
  card.draggable = true;
  card.addEventListener('dragstart', e=>{
    e.dataTransfer.setData('text/plain', p.id);
    e.dataTransfer.effectAllowed = 'copy';
  });
  card.querySelector('.sel-check').onclick = e=>{ e.stopPropagation(); toggleSelect(p.id, card); };
  card.querySelector('img').onclick = ()=>openLightbox(i);
  card.querySelector('.edit').onclick = e=>{e.stopPropagation(); openEditor(p);};
  card.querySelector('.info').onclick = e=>{e.stopPropagation(); openExif(p);};
  card.querySelector('.dl').onclick = e=>{e.stopPropagation(); downloadPhoto(p);};
  if (opts.albumMode) {
    card.querySelector('.rm').onclick = async e=>{
      e.stopPropagation();
      await api.post(`/api/albums/${opts.albumId}/remove`, { ids: [p.id] });
      selected.delete(p.id);
      toast('已从收藏夹移除');
      openAlbum(opts.albumId);
      loadAlbums();
    };
  } else {
    card.querySelector('.del').onclick = e=>{e.stopPropagation(); delPhoto(p, card);};
  }
  card.querySelectorAll('.quick-stars span').forEach(s=>{
    s.onclick = e=>{
      e.stopPropagation();
      const n = +s.dataset.s;
      if (window.UIAnim) window.UIAnim.starPop(s);
      setTimeout(()=>setStars(p.id, n), 200);
    };
  });
  return card;
}

async function delPhoto(p, card){
  if (!(await showConfirm('删除照片', `确定删除「${p.name}」?此操作不可恢复。`, { danger: true, confirmText: '删除' }))) return;
  card.classList.add('removing');
  await new Promise(r=>setTimeout(r,320));
  try{
    const r = await api.del('/api/photos/'+p.id);
    if(!r.ok) throw new Error(r.error||'删除失败');
    photos = photos.filter(x=>x.id!==p.id);
    renderGrid();
    $('#storageMini').textContent = `${photos.length} 张照片`;
    toast('已删除');
  }catch(e){
    toast('删除失败:'+e.message, true);
    card.classList.remove('removing');
  }
}

/* ---- 上传 ---- */
const fileInput = $('#fileInput'), dropzone = $('#dropzone');
$('#uploadBtn').onclick = ()=>fileInput.click();
dropzone.onclick = ()=>fileInput.click();
fileInput.onchange = e=>{ uploadFiles(e.target.files); fileInput.value=''; };

['dragenter','dragover'].forEach(ev=>dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.add('drag')}));
['dragleave','drop'].forEach(ev=>dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.remove('drag')}));
dropzone.addEventListener('drop',e=>uploadFiles(e.dataTransfer.files));

/* v1.2 §2.6 全局拖放上传遮罩：窗口任意位置拖入图片文件 → 全屏遮罩 + 松开上传 */
const uploadOverlay = $('#uploadOverlay');
let dragDepth = 0;
window.addEventListener('dragenter', e=>{
  if (!e.dataTransfer || !e.dataTransfer.types || !e.dataTransfer.types.includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  const files = e.dataTransfer.items ? [...e.dataTransfer.items].filter(i => i.kind === 'file' && i.type.startsWith('image/')).length : 0;
  $('#uoCount').textContent = files ? `松开即可上传 ${files} 张` : '松开即可上传';
  uploadOverlay.classList.add('show');
});
window.addEventListener('dragover', e=>{
  if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) e.preventDefault();
});
window.addEventListener('dragleave', ()=>{
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) uploadOverlay.classList.remove('show');
});
window.addEventListener('drop', e=>{
  e.preventDefault();
  dragDepth = 0;
  uploadOverlay.classList.remove('show');
  // dropzone 自己有 drop 处理，事件冒泡到 window 时跳过，避免同一批文件上传两次
  if (e.target && e.target.closest && e.target.closest('#dropzone')) return;
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
    uploadFiles(e.dataTransfer.files).then(addedIds=>{
      // v1.2 §3.6.3 收藏夹详情页：窗口拖放本地图片 → 上传并自动加入当前收藏夹
      if (activeAlbumId && addedIds && addedIds.length) {
        api.post(`/api/albums/${activeAlbumId}/add`, { ids: addedIds }).then(()=>{
          loadAlbums();
          toast(`已上传并加入收藏夹 ${addedIds.length} 张 ✓`);
        });
      }
    });
  }
});
document.addEventListener('keydown', e=>{
  if (e.key === 'Escape' && uploadOverlay.classList.contains('show')) {
    dragDepth = 0;
    uploadOverlay.classList.remove('show');
  }
}, true);

/* v1.2 §3.1.2 上传进度细化：逐张上传，"上传 3/12 · DSC_0042.jpg"，完成 toast 汇总 */
async function uploadFiles(list){
  const files = [...list].filter(f=>f.type.startsWith('image/'));
  if(!files.length){ toast('请选择图片文件', true); return []; }
  const bar = $('#uploadProgress .bar');
  const status = $('#uploadStatus');
  const total = files.length;
  let ok = 0, failed = 0;
  const addedIds = [];
  status.hidden = false;
  for(let i=0;i<total;i++){
    const f = files[i];
    status.textContent = `上传 ${i+1}/${total} · ${f.name}`;
    try {
      const id = await uploadOne(f, bar, i, total);
      if(id){ ok++; addedIds.push(id); }
      else { failed++; logFrontend('error', '上传失败', { name: f.name }); }
    } catch { failed++; logFrontend('error', '上传失败', { name: f.name }); }
  }
  status.hidden = true;
  bar.style.width='100%';
  setTimeout(()=>bar.style.width='0', 500);
  await loadPhotos();
  if(failed > 0){
    toast(`上传完成：成功 ${ok} 张，失败 ${failed} 张`, {
      err: true,
      action: { label: '查看日志', onClick: ()=>switchView('logs') },
    });
  } else {
    toast(`已上传 ${ok} 张照片 ✓`);
  }
  return addedIds;
}
function uploadOne(f, bar, i, total){
  return new Promise(resolve=>{
    const fd = new FormData();
    fd.append('photos', f);
    const xhr = new XMLHttpRequest();
    xhr.open('POST','/api/upload');
    if (authToken) xhr.setRequestHeader('X-Luma-Token', authToken);
    xhr.upload.onprogress = e=>{
      if(e.lengthComputable) bar.style.width = ((i + e.loaded/e.total) / total * 90 + 5) + '%';
    };
    xhr.onload = ()=>{
      let r = {};
      try { r = JSON.parse(xhr.responseText); } catch { /* 非 JSON 响应视为失败 */ }
      resolve((r.ok && Array.isArray(r.added) && r.added.length) ? r.added[0].id : null);
    };
    xhr.onerror = ()=>resolve(null);
    xhr.send(fd);
  });
}

$('#clearAllBtn').onclick = $('#clearStorage').onclick = async ()=>{
  if(!photos.length) return;
  if(!(await showConfirm('清空全部照片', '确定清空全部照片?此操作不可恢复。', { danger: true, confirmText: '清空' }))) return;
  try{
    const r = await api.del('/api/photos');
    if(!r.ok) throw new Error(r.error||'清空失败');
    photos = []; renderGrid(); loadStats();
    $('#storageMini').textContent = '0 张照片';
    toast('已清空');
  }catch(e){ toast('清空失败:'+e.message, true); }
};

/* ============ 灯箱 ============ */
const lightbox = $('#lightbox');
/* v1.2 §3.2.4 灯箱缩放平移（1×–5×） */
let lbZoom = 1, lbPanX = 0, lbPanY = 0;
let lbPanDrag = null;
function applyLbZoom(animate = true){
  const el = $('#lbZoom');
  if (!el) return;
  if (window.gsap) {
    if (!animate) {
      gsap.set(el, { scale: lbZoom, x: lbPanX, y: lbPanY });
    } else {
      // 缩放 0.25s、平移 0.12s 跟手；overwrite 使新值从当前位置接管（等价 quickTo 语义）
      gsap.to(el, { scale: lbZoom, duration: 0.25, ease: 'power2.out', overwrite: 'auto' });
      gsap.to(el, { x: lbPanX, y: lbPanY, duration: 0.12, ease: 'power2.out', overwrite: 'auto' });
    }
  } else {
    el.style.transform = `translate(${lbPanX}px,${lbPanY}px) scale(${lbZoom})`;
  }
  $('#lbZoomFit').hidden = lbZoom === 1;
  $('#lbFilmstrip').hidden = !(photos.length > 1) || cmpActive || lbZoom !== 1;
}
function resetLbZoom(){
  lbZoom = 1; lbPanX = 0; lbPanY = 0;
  applyLbZoom();
}
function clampLbPan(){
  if (!window.gsap) return;
  const zoom = $('#lbZoom');
  const vp = lightbox.getBoundingClientRect();
  const imgR = zoom.getBoundingClientRect();
  const w = imgR.width / lbZoom, h = imgR.height / lbZoom;
  const maxX = Math.max(0, (w * lbZoom - vp.width) / 2);
  const maxY = Math.max(0, (h * lbZoom - vp.height) / 2);
  lbPanX = gsap.utils.clamp(-maxX, maxX, lbPanX);
  lbPanY = gsap.utils.clamp(-maxY, maxY, lbPanY);
}
function lbZoomAt(factor, clientX, clientY){
  const r = lightbox.getBoundingClientRect();
  const cx = r.width / 2, cy = r.height / 2;
  const px = clientX - r.left, py = clientY - r.top;
  const next = Math.max(1, Math.min(5, lbZoom * factor));
  if (next === lbZoom) return;
  const localX = cx + (px - cx - lbPanX) / lbZoom;
  const localY = cy + (py - cy - lbPanY) / lbZoom;
  lbZoom = next;
  lbPanX = px - cx - (localX - cx) * lbZoom;
  lbPanY = py - cy - (localY - cy) * lbZoom;
  clampLbPan();
  applyLbZoom();
}
function lbZoomCenter(factor){
  const r = lightbox.getBoundingClientRect();
  lbZoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
}
$('#lbZoomFit').onclick = resetLbZoom;
lightbox.addEventListener('wheel', e=>{
  if (cmpActive) return;
  e.preventDefault();
  lbZoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
}, { passive: false });
$('#lbZoom').addEventListener('pointerdown', e=>{
  if (lbZoom <= 1) return;
  lbPanDrag = { sx: e.clientX, sy: e.clientY, px: lbPanX, py: lbPanY };
  $('#lbZoom').setPointerCapture(e.pointerId);
  e.preventDefault();
});
$('#lbZoom').addEventListener('pointermove', e=>{
  if (!lbPanDrag) return;
  lbPanX = lbPanDrag.px + (e.clientX - lbPanDrag.sx);
  lbPanY = lbPanDrag.py + (e.clientY - lbPanDrag.sy);
  clampLbPan();
  applyLbZoom();
});
$('#lbZoom').addEventListener('pointerup', ()=>{ lbPanDrag = null; });
$('#lbImg').addEventListener('dblclick', e=>{
  e.stopPropagation();
  if (lbZoom !== 1) resetLbZoom();
  else lbZoomCenter(2);
});

/* v1.2 §3.2.2 底部胶片条 */
let filmstripBuiltFor = null; // 已构建胶片条的 photos 数组引用
function renderLbFilmstrip(){
  const strip = $('#lbFilmstrip');
  if (photos.length <= 1) { strip.hidden = true; return; }
  // 打开灯箱时按当前 photos 全量构建一次；导航/计数更新只改高亮与滚动（O(1)）
  if (filmstripBuiltFor !== photos) {
    strip.innerHTML = '';
    photos.forEach((p, i)=>{
      const t = document.createElement('div');
      t.className = 'lb-film-thumb';
      t.innerHTML = `<img src="/thumbs/${p.id}.webp?v=${p.time}" alt="">`;
      t.title = p.name;
      t.onclick = ()=>{ lbIndex = i; showLbPhoto(0); };
      strip.appendChild(t);
    });
    filmstripBuiltFor = photos;
  }
  [...strip.children].forEach((t, i)=>t.classList.toggle('active', i === lbIndex));
  const active = strip.querySelector('.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* v1.2 §3.2.3 EXIF 摘要条（按需请求 + 内存缓存） */
const lbExifCache = new Map();
function formatLbExif(ex){
  const parts = [];
  if (ex.FNumber != null && ex.FNumber !== '') parts.push('f/' + ex.FNumber);
  if (ex.ExposureTime != null && ex.ExposureTime !== '') {
    const v = ex.ExposureTime;
    parts.push(v <= 1 ? `1/${Math.round(1 / v)}s` : v + 's');
  }
  if (ex.ISO != null && ex.ISO !== '') parts.push('ISO ' + ex.ISO);
  if (ex.FocalLength != null && ex.FocalLength !== '') parts.push(ex.FocalLength + 'mm');
  if (ex.DateTimeOriginal) {
    let d = ex.DateTimeOriginal;
    if (d instanceof Date) {
      const p = n => String(n).padStart(2, '0');
      d = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    parts.push(String(d).replace(/^(\d{4})[:\/](\d{2})[:\/](\d{2})/, '$1-$2-$3').slice(0, 16));
  }
  return parts.join(' · ');
}
async function loadLbExif(p){
  const el = $('#lbExif');
  if (!el) return;
  const set = (txt, loading) => {
    el.textContent = txt || '';
    el.classList.toggle('loading', !!loading);
    el.hidden = !txt && !loading;
  };
  set('——', true);
  if (lbExifCache.has(p.id)) {
    set(formatLbExif(lbExifCache.get(p.id)), false);
    return;
  }
  try {
    const r = await api.get(`/api/photos/${p.id}/exif`);
    const ex = r.exif || {};
    lbExifCache.set(p.id, ex);
    if (!lightbox.classList.contains('open') || !photos[lbIndex] || photos[lbIndex].id !== p.id) return;
    set(formatLbExif(ex), false);
  } catch { if (photos[lbIndex] && photos[lbIndex].id === p.id) set('', false); }
}
$('#lbExif').onclick = ()=>{
  if (photos[lbIndex]) { closeLightbox(); openExif(photos[lbIndex]); }
};

function openLightbox(i){
  lbIndex = i;
  resetLbZoom();
  showLbPhoto(0);
  if (window.UIAnim) window.UIAnim.lightbox(lightbox, $('#lbImg'), true);
  else lightbox.classList.add('open');
}
function closeLightbox(){
  if(cmpActive) closeCompare();
  resetLbZoom();
  if (window.UIAnim) window.UIAnim.lightbox(lightbox, $('#lbImg'), false);
  else lightbox.classList.remove('open');
}
// 换图（dir: -1/0/1）：方向化导航 + 计数 + 胶片条 + EXIF 摘要
function showLbPhoto(dir){
  if (!photos.length) return;
  const p = photos[lbIndex], img = $('#lbImg');
  const src = '/files/'+p.file+'?v='+p.time;
  const show = ()=>{
    $('#lbCap').textContent = `${p.name} · ${p.width}×${p.height} · ${fmtSize(p.size)}`;
    $('#lbIndex').textContent = `${lbIndex + 1} / ${photos.length}`;
    renderLbFilmstrip();
    loadLbExif(p);
  };
  resetLbZoom();
  if (window.UIAnim && dir !== 0) {
    window.UIAnim.navCrossfade(img, src, dir, show);
  } else {
    // 首次打开/胶片条跳转：同步换源（避免与灯箱开合动画的 overwrite 冲突导致 src 未赋值）
    img.src = src;
    show();
  }
}
function navLb(d){
  if(!photos.length) return;
  lbIndex = (lbIndex+d+photos.length)%photos.length;
  showLbPhoto(d);
}
$('#lbClose').onclick = closeLightbox;
$('#lbPrev').onclick = ()=>navLb(-1);
$('#lbNext').onclick = ()=>navLb(1);
$('#lbEdit').onclick = ()=>{ closeLightbox(); openEditor(photos[lbIndex]); };
$('#lbInfo').onclick = ()=>{ closeLightbox(); openExif(photos[lbIndex]); };
$('#lbDownload').onclick = ()=>{ if(photos[lbIndex]) downloadPhoto(photos[lbIndex]); };
$('#lbRename').onclick = async ()=>{
  const p = photos[lbIndex]; if(!p) return;
  const name = await showInputModal('重命名照片', '新名称', p.name, '输入新的照片名称');
  if(!name) return;
  const r = await api.post(`/api/photos/${p.id}/rename`, { name });
  if(r.ok){ p.name = r.photo.name; $('#lbCap').textContent=`${p.name} · ${p.width}×${p.height} · ${fmtSize(p.size)}`; await loadPhotos(); toast('已重命名 ✓'); }
  else toast(r.error||'重命名失败', true);
};
lightbox.addEventListener('click',e=>{ if(e.target===lightbox) closeLightbox(); });

/* ============ 灯箱并排对比选片（C 键 / 对比按钮） ============ */
let cmpActive = false;   // 对比模式
let cmpIdx = -1;         // 左图索引；右图 = cmpIdx + 1
let cmpSide = 1;         // 标记目标：0 左 / 1 右

function openCompare(){
  if(cmpActive || photos.length < 2) return;
  resetLbZoom(); // v1.2 §3.2.4 进入对比前若缩放中先复位
  cmpActive = true;
  cmpIdx = Math.max(0, Math.min(lbIndex >= 0 ? lbIndex : 0, photos.length - 2));
  cmpSide = 1;
  lightbox.classList.add('compare');
  $('#lbImg').style.display = 'none';
  $('#lbCompareWrap').hidden = false;
  $('#lbPrev').hidden = true;
  $('#lbNext').hidden = true;
  $('#lbCompare').textContent = '退出对比';
  $('#lbFilmstrip').hidden = true; // 对比模式隐藏胶片条
  updateCompare();
}
function closeCompare(){
  if(!cmpActive) return;
  cmpActive = false;
  lightbox.classList.remove('compare');
  $('#lbImg').style.display = '';
  $('#lbCompareWrap').hidden = true;
  $('#lbPrev').hidden = false;
  $('#lbNext').hidden = false;
  $('#lbCompare').textContent = '对比';
  $('#lbFilmstrip').hidden = !(photos.length > 1);
}
function updateCompare(){
  if(!cmpActive || photos.length < 2) return;
  cmpIdx = Math.max(0, Math.min(cmpIdx, photos.length - 2));
  const setImg = (img, cap, p, i)=>{
    const src = '/files/' + p.file + '?v=' + p.time;
    if(img.src !== src) img.src = src;
    cap.textContent = `${i + 1}/${photos.length} · ${p.name}`;
  };
  setImg($('#lbImgA'), $('#lbCapA'), photos[cmpIdx], cmpIdx);
  setImg($('#lbImgB'), $('#lbCapB'), photos[cmpIdx + 1], cmpIdx + 1);
  $('#lbIndex').textContent = `${cmpIdx + 1} / ${photos.length}`;
  updateCompareSide();
}
function updateCompareSide(){
  [...$('#lbCompareWrap').querySelectorAll('.lb-cmp')]
    .forEach((f, i) => f.classList.toggle('target', i === cmpSide));
  $('#lbCmpHint').textContent =
    `标记目标：${cmpSide === 0 ? '左' : '右'}侧 · Tab 切换 · ←/→ 换组 · Esc 退出`;
}
// 标记后自动进入下一组（设置 autoAdvance 可关闭）
function afterCullMark(){
  if(settings.autoAdvance !== false && cmpSide === 1){
    cmpIdx = Math.min(cmpIdx + 1, photos.length - 2);
  }
  updateCompare();
}
$('#lbCompare').onclick = ()=>{ cmpActive ? closeCompare() : openCompare(); };

/* ============ 编辑器 ============ */
const editImg = $('#editImg');
let edit = null; // 当前编辑参数
let undoStack = []; // 撤销栈
let redoStack = []; // 重做栈

// v1.2 §3.4.1/3.4.2：全部滑块默认值（双击复位 + 改动标记共用）
const SLIDER_DEFAULTS = {
  brightness: 100, contrast: 100, saturation: 100, hue: 0,
  sharpen: 0, blur: 0, temperature: 0, tint: 0, vignette: 0, grain: 0,
};
function defaultEdit(){
  return { ...SLIDER_DEFAULTS, grayscale:false,
    rotate:0, flipH:false, flipV:false, crop:null, resize:null };
}
// 从 UI 同步滑块值到 edit（预设/撤销重做之外的手动改动入口）
function syncEditFromUI(){
  for (const k of Object.keys(SLIDER_DEFAULTS)) edit[k] = +$('#'+k).value;
  edit.grayscale = $('#grayscale').checked;
}
function updateUndoRedo(){
  const u = $('#undoBtn'), r = $('#redoBtn');
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}

function saveEditState(){
  undoStack.push(JSON.parse(JSON.stringify(edit)));
  redoStack = [];
  updateUndoRedo();
}

function undo(){
  if(undoStack.length === 0) return;
  redoStack.push(JSON.parse(JSON.stringify(edit)));
  edit = undoStack.pop();
  applyEditState();
  updateUndoRedo();
  scheduleDraftSave();
}

function redo(){
  if(redoStack.length === 0) return;
  undoStack.push(JSON.parse(JSON.stringify(edit)));
  edit = redoStack.pop();
  applyEditState();
  updateUndoRedo();
  scheduleDraftSave();
}

function applyEditState(){
  for (const k of Object.keys(SLIDER_DEFAULTS)) $('#'+k).value = edit[k] ?? SLIDER_DEFAULTS[k];
  $('#grayscale').checked = edit.grayscale;
  if(edit.resize && current){
    $('#reW').value = edit.resize.width;
    $('#reH').value = edit.resize.height;
  }
  if (edit.output) {
    $('#outFormat').value = edit.output.format;
    $('#quality').value = edit.output.quality;
    $('#vQuality').textContent = edit.output.quality + '%';
  }
  updateSliderLabels();
  applyFilter();
  updateUndoRedo();
}

function openEditor(p){
  current = p;
  lastEditorId = p.id;
  edit = defaultEdit();
  undoStack = [];
  redoStack = [];
  clearTimeout(draftTimer); draftTimer = null; // 避免上一张照片的待保存草稿写入新照片
  // 画布缩放复位
  canvasZoom = 1; canvasPanX = 0; canvasPanY = 0;
  if (canvasZoomEl) applyCanvasZoom(false);
  // 重置前后对比状态
  baActive = false;
  baDir = 'h';
  canvasStageEl.dataset.baDir = 'h';
  $('#baDirToggle').hidden = true;
  baOrigImg.hidden = true;
  baDivider.hidden = true;
  $('#baToggle').classList.remove('active');
  $('#baToggle').textContent = '⇄ 对比原图';
  $('#canvasStage').style.setProperty('--ba', '50%');
  switchView('editor');
  $('#editorEmpty').classList.remove('show');
  $('#editorWrap').classList.remove('hidden');
  editImg.src = '/files/'+p.file + '?t=' + Date.now();
  $('#editName').textContent = p.name;
  $('#editDims').textContent = `${p.width}×${p.height}`;
  $('#origDims').textContent = `${p.width}×${p.height}`;
  edit.resize = { width: p.width, height: p.height };
  $('#reW').value = p.width; $('#reH').value = p.height;
  resetSliders();
  setActivePreset('none');
  $('#outFormat').value = settings.defaultFormat || 'jpeg';
  $('#quality').value = settings.defaultQuality || 82;
  $('#vQuality').textContent = $('#quality').value+'%';
  applyFilter();
  estimateSize();
  // v1.2 §3.4.3 草稿恢复：有草稿则恢复参数（撤销栈=[默认态]）
  (async () => {
    try {
      const r = await api.get(`/api/photos/${p.id}/draft`);
      if (!r.ok || !r.draft || lastEditorId !== p.id) return;
      const d = r.draft, adj = d.adjust || {};
      edit = defaultEdit();
      for (const k of Object.keys(SLIDER_DEFAULTS)) if (adj[k] != null) edit[k] = +adj[k];
      edit.grayscale = !!adj.grayscale;
      if (d.transform) {
        edit.rotate = d.transform.rotate || 0;
        edit.flipH = !!d.transform.flipH;
        edit.flipV = !!d.transform.flipV;
        edit.crop = d.transform.crop || null;
      }
      if (d.resize && d.resize.width && d.resize.height) edit.resize = { width: +d.resize.width, height: +d.resize.height };
      if (d.output) edit.output = { format: d.output.format, quality: +d.output.quality };
      undoStack = [defaultEdit()];
      redoStack = [];
      applyEditState();
      estimateSize();
    } catch { /* 网络异常静默 */ }
  })();
}

function resetSliders(){
  for (const [k, v] of Object.entries(SLIDER_DEFAULTS)) $('#'+k).value = v;
  $('#grayscale').checked=false;
  updateSliderLabels();
}
function updateSliderLabels(){
  $('#vBrightness').textContent=$('#brightness').value+'%';
  $('#vContrast').textContent=$('#contrast').value+'%';
  $('#vSaturation').textContent=$('#saturation').value+'%';
  $('#vHue').textContent=$('#hue').value+'°';
  $('#vSharpen').textContent=$('#sharpen').value;
  $('#vBlur').textContent=$('#blur').value;
  $('#vTemperature').textContent=$('#temperature').value;
  $('#vTint').textContent=$('#tint').value;
  $('#vVignette').textContent=$('#vignette').value;
  $('#vGrain').textContent=$('#grain').value;
  updateModifiedDots();
}
// v1.2 §3.4.1 改动标记：参数 ≠ 默认时显示主题色圆点
function updateModifiedDots(){
  $$('.slider-row').forEach(row=>{
    const input = row.querySelector('input[type=range]');
    if (!input || SLIDER_DEFAULTS[input.id] == null) return;
    row.classList.toggle('modified', +input.value !== SLIDER_DEFAULTS[input.id]);
  });
}
// 双击滑块标签/值 → 恢复默认（v1.2 §3.4.1）
function resetOneSlider(id){
  const d = SLIDER_DEFAULTS[id];
  if (d == null) return false;
  if (+$('#'+id).value === d) return false;
  $('#'+id).value = d;
  return true;
}

// 实时 CSS 滤镜预览(裁剪/旋转由 transform 体现)
function applyFilter(){
  const b=$('#brightness').value/100, c=$('#contrast').value/100, s=$('#saturation').value/100;
  const h=$('#hue').value, bl=$('#blur').value/2, gray=$('#grayscale').checked?1:0;
  let f = `brightness(${b}) contrast(${c}) saturate(${s}) hue-rotate(${h}deg) grayscale(${gray})`;
  // v1.2 §3.4.2 色温/色调 CSS 近似预览
  const t = +$('#temperature').value, tn = +$('#tint').value;
  if (t) f += ` sepia(${Math.abs(t)/160}) hue-rotate(${t*0.18}deg)`;
  if (tn) f += ` hue-rotate(${tn*0.12}deg) saturate(${1+Math.abs(tn)/300})`;
  if(bl>0) f += ` blur(${bl}px)`;
  editImg.style.filter = f;
  const tr = [];
  if(edit.rotate) tr.push(`rotate(${edit.rotate}deg)`);
  if(edit.flipH) tr.push('scaleX(-1)');
  if(edit.flipV) tr.push('scaleY(-1)');
  editImg.style.transform = tr.join(' ');
  // v1.2 §3.4.2 暗角/颗粒叠加层（canvas-stage 上，控制 opacity）
  $('#editVignette').style.opacity = (+$('#vignette').value / 100) * 0.8;
  $('#editGrain').style.opacity = (+$('#grain').value / 100) * 0.5;
  // 对比视图的原图层跟随同样的旋转/翻转，仅保留调色差异
  if(baOrigImg) baOrigImg.style.transform = editImg.style.transform;
}

// 调整面板事件
Object.keys(SLIDER_DEFAULTS).forEach(id=>{
  $('#'+id).addEventListener('input',()=>{
    saveEditState();           // 入栈旧状态
    edit[id] = +$('#'+id).value; // 更新为新值
    updateSliderLabels(); applyFilter(); scheduleDraftSave();
  });
});
$$('.slider-row').forEach(row=>{
  const input = row.querySelector('input[type=range]');
  if (!input || SLIDER_DEFAULTS[input.id] == null) return;
  const doReset = () => {
    if (!resetOneSlider(input.id)) return;
    saveEditState();
    edit[input.id] = SLIDER_DEFAULTS[input.id];
    updateSliderLabels(); applyFilter(); scheduleDraftSave();
  };
  const label = row.querySelector('span');
  const val = row.querySelector('i');
  if (label) label.addEventListener('dblclick', doReset);
  if (val) val.addEventListener('dblclick', doReset);
});
$('#grayscale').addEventListener('change',()=>{ saveEditState(); edit.grayscale = $('#grayscale').checked; applyFilter(); scheduleDraftSave(); });
$('#resetAdjust').onclick = ()=>{
  edit = defaultEdit();
  resetSliders();
  if(current){ edit.resize = { width: current.width, height: current.height }; $('#reW').value = current.width; $('#reH').value = current.height; }
  // “重置全部”：同时重置旋转/翻转/裁剪，并退出裁剪模式
  if (cropping) {
    cropping = false;
    cropOverlay.hidden = true;
    $('#cropRatios').hidden = true;
    $('#applyCrop').hidden = true;
    $('#cropToggle').textContent = '✂ 开启裁剪';
  }
  setActivePreset('none');
  applyFilter();
  toast('已重置全部');
  scheduleDraftSave();
};

/* ---- 滤镜预设 ---- */
const PRESETS = {
  none:   { brightness:100, contrast:100, saturation:100, hue:0, grayscale:false },
  vivid:  { brightness:105, contrast:112, saturation:140, hue:0, grayscale:false },
  soft:   { brightness:108, contrast:92,  saturation:88,  hue:0, grayscale:false },
  vintage:{ brightness:104, contrast:88,  saturation:70,  hue:18, grayscale:false },
  mono:   { brightness:102, contrast:110, saturation:100, hue:0, grayscale:true },
  punch:  { brightness:100, contrast:135, saturation:120, hue:0, grayscale:false },
};
function setActivePreset(name){
  $$('#presets .chip').forEach(c=>c.classList.toggle('active', c.dataset.preset===name));
}
$$('#presets .chip').forEach(c=>c.onclick=()=>{
  const p = PRESETS[c.dataset.preset]; if(!p) return;
  saveEditState();
  $('#brightness').value=p.brightness; $('#contrast').value=p.contrast;
  $('#saturation').value=p.saturation; $('#hue').value=p.hue; $('#grayscale').checked=p.grayscale;
  syncEditFromUI();
  updateSliderLabels(); applyFilter(); setActivePreset(c.dataset.preset);
  estimateSize(); scheduleDraftSave();
});

// 面板 tab
$$('.ptab').forEach(t=>t.onclick=()=>{
  $$('.ptab').forEach(x=>x.classList.toggle('active', x===t));
  $$('.ptab-panel').forEach(p=>p.classList.toggle('active', p.dataset.ptab===t.dataset.ptab));
});

// 变换
$('#rotL').onclick = ()=>{ saveEditState(); edit.rotate=(edit.rotate-90)%360; applyFilter(); scheduleDraftSave(); };
$('#rotR').onclick = ()=>{ saveEditState(); edit.rotate=(edit.rotate+90)%360; applyFilter(); scheduleDraftSave(); };
$('#flipH').onclick = ()=>{ saveEditState(); edit.flipH=!edit.flipH; applyFilter(); scheduleDraftSave(); };
$('#flipV').onclick = ()=>{ saveEditState(); edit.flipV=!edit.flipV; applyFilter(); scheduleDraftSave(); };

$('#reW').addEventListener('input',()=>{
  saveEditState();
  if($('#lockRatio').checked && current){ $('#reH').value = Math.round($('#reW').value / current.width * current.height); }
  edit.resize = { width: Math.max(1, +$('#reW').value || 1), height: Math.max(1, +$('#reH').value || 1) };
  scheduleDraftSave();
});
$('#reH').addEventListener('input',()=>{
  saveEditState();
  if($('#lockRatio').checked && current){ $('#reW').value = Math.round($('#reH').value / current.height * current.width); }
  edit.resize = { width: Math.max(1, +$('#reW').value || 1), height: Math.max(1, +$('#reH').value || 1) };
  scheduleDraftSave();
});
$$('[data-scale]').forEach(b=>b.onclick=()=>{
  if(!current) return;
  saveEditState();
  const s = parseFloat(b.dataset.scale);
  edit.resize = { width: Math.max(1, Math.round(current.width*s)), height: Math.max(1, Math.round(current.height*s)) };
  $('#reW').value = edit.resize.width;
  $('#reH').value = edit.resize.height;
  toast(`尺寸设为 ${Math.round(s*100)}%`);
  scheduleDraftSave();
});

// 质量/格式 → 预估
$('#quality').addEventListener('input',()=>{ $('#vQuality').textContent=$('#quality').value+'%'; estimateSize(); scheduleDraftSave(); });
$('#outFormat').addEventListener('change', ()=>{ estimateSize(); scheduleDraftSave(); });
$('#overwrite').addEventListener('change',e=>{
  $('#overwriteHint').textContent = e.target.checked ? '⚠ 将直接覆盖原图,无法还原' : '关闭时将另存为新副本,保留原图';
});

let estTimer;
function estimateSize(){
  if(!current) return;
  clearTimeout(estTimer);
  estTimer = setTimeout(async ()=>{
    const r = await api.post(`/api/photos/${current.id}/preview`, buildEditBody('copy'));
    if(r.ok) $('#estSize').textContent = '≈ '+fmtSize(r.estimatedSize);
  }, 350);
}

/* v1.2 §3.4.3 草稿持久化：参数变化 debounce 800ms 保存，导出成功后清除 */
let draftTimer = null;
function scheduleDraftSave(){
  if (!current) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 800);
}
function buildAdjustFromUI(){
  return {
    brightness:$('#brightness').value/100,
    saturation:$('#saturation').value/100,
    hue:+$('#hue').value,
    contrast:$('#contrast').value/100,
    sharpen:+$('#sharpen').value,
    blur:+$('#blur').value,
    grayscale:$('#grayscale').checked,
    temperature:+$('#temperature').value,
    tint:+$('#tint').value,
    vignette:+$('#vignette').value,
    grain:+$('#grain').value,
  };
}
async function saveDraft(){
  if (!current) return;
  const body = {
    adjust: buildAdjustFromUI(),
    transform: { rotate: edit.rotate, flipH: edit.flipH, flipV: edit.flipV, crop: edit.crop },
    resize: edit.resize || { width: +$('#reW').value, height: +$('#reH').value },
    output: { format: $('#outFormat').value, quality: +$('#quality').value },
    updatedAt: Date.now(),
  };
  try { await api.put(`/api/photos/${current.id}/draft`, body); } catch { /* 草稿保存失败不阻断编辑 */ }
}

/* ---- 裁剪 ---- */
let cropping = false, cropRatio = 'free';
const cropOverlay = $('#cropOverlay'), cropBox = $('#cropBox');

$('#cropToggle').onclick = ()=>{
  cropping = !cropping;
  cropOverlay.hidden = !cropping;
  $('#cropRatios').hidden = !cropping;
  $('#applyCrop').hidden = !cropping;
  $('#cropToggle').textContent = cropping ? '✕ 取消裁剪' : '✂ 开启裁剪';
  if(cropping) initCropBox();
};
$$('#cropRatios .chip').forEach(c=>c.onclick=()=>{
  $$('#cropRatios .chip').forEach(x=>x.classList.toggle('active',x===c));
  cropRatio = c.dataset.ratio;
  initCropBox(true); // v1.2 §3.4.5 比例切换保持框中心
});

function initCropBox(keepCenter){
  const r = editImg.getBoundingClientRect();
  const stage = $('#canvasStage').getBoundingClientRect();
  let w = r.width*0.7, h = r.height*0.7;
  if(cropRatio!=='free'){ const ratio=parseFloat(cropRatio); if(w/h>ratio) w=h*ratio; else h=w/ratio; }
  let cx, cy;
  if(keepCenter && cropBox.style.width){
    const br = cropBox.getBoundingClientRect();
    cx = (br.left - stage.left) + br.width/2;
    cy = (br.top - stage.top) + br.height/2;
  } else {
    cx = (r.left-stage.left)+r.width/2;
    cy = (r.top-stage.top)+r.height/2;
  }
  const left = cx - w/2;
  const top = cy - h/2;
  Object.assign(cropBox.style,{left:left+'px',top:top+'px',width:w+'px',height:h+'px'});
}

// 裁剪框拖拽 & 缩放
let cropDrag = null;
cropBox.addEventListener('pointerdown', e=>{
  const handle = e.target.classList.contains('ch') ? e.target.classList[1] : 'move';
  cropDrag = { handle, sx:e.clientX, sy:e.clientY,
    l:parseFloat(cropBox.style.left), t:parseFloat(cropBox.style.top),
    w:cropBox.offsetWidth, h:cropBox.offsetHeight };
  cropBox.setPointerCapture(e.pointerId);
  e.preventDefault();
});
cropBox.addEventListener('pointermove', e=>{
  if(!cropDrag) return;
  const dx=e.clientX-cropDrag.sx, dy=e.clientY-cropDrag.sy;
  let {l,t,w,h,handle}=cropDrag;
  if(handle==='move'){ l+=dx; t+=dy; }
  else{
    if(handle.includes('r')) w=cropDrag.w+dx;
    if(handle.includes('l')){ w=cropDrag.w-dx; l=cropDrag.l+dx; }
    if(handle.includes('b')) h=cropDrag.h+dy;
    if(handle.includes('t')){ h=cropDrag.h-dy; t=cropDrag.t+dy; }
    if(cropRatio!=='free'){ const ratio=parseFloat(cropRatio); h=w/ratio; }
  }
  w=Math.max(30,w); h=Math.max(30,h);
  // v1.2 §3.4.5 贴边/中心线吸附（≤6px）
  if(window.gsap){
    const imgR = editImg.getBoundingClientRect();
    const stageR = $('#canvasStage').getBoundingClientRect();
    const boxL = imgR.left - stageR.left, boxT = imgR.top - stageR.top;
    const candsL = [boxL, boxL + imgR.width/2 - w/2, boxL + imgR.width - w];
    const candsT = [boxT, boxT + imgR.height/2 - h/2, boxT + imgR.height - h];
    let bestL = l, bestT = t;
    for(const c of candsL) if(Math.abs(c - l) <= 6){ bestL = c; break; }
    for(const c of candsT) if(Math.abs(c - t) <= 6){ bestT = c; break; }
    l = bestL; t = bestT;
  }
  Object.assign(cropBox.style,{left:l+'px',top:t+'px',width:w+'px',height:h+'px'});
});
cropBox.addEventListener('pointerup',()=>cropDrag=null);

// v1.2 §3.4.5 裁剪框键盘微调（方向键平移 1px、Shift 10px；[ ] 缩放框）
function moveCropBox(dx, dy){
  const rect = canvasStageEl.getBoundingClientRect();
  const imgR = editImg.getBoundingClientRect();
  const minL = imgR.left - rect.left, minT = imgR.top - rect.top;
  const maxL = minL + imgR.width - cropBox.offsetWidth;
  const maxT = minT + imgR.height - cropBox.offsetHeight;
  let l = Math.max(minL, Math.min(parseFloat(cropBox.style.left) + dx, maxL));
  let t = Math.max(minT, Math.min(parseFloat(cropBox.style.top) + dy, maxT));
  cropBox.style.left = l + 'px';
  cropBox.style.top = t + 'px';
}
function resizeCropBoxBy(dx){
  const w = cropBox.offsetWidth + dx;
  const h = cropRatio !== 'free' ? w / parseFloat(cropRatio) : cropBox.offsetHeight + dx;
  if (w < 30 || h < 30) return;
  const rect = canvasStageEl.getBoundingClientRect();
  const br = cropBox.getBoundingClientRect();
  const cx = (br.left - rect.left) + br.width/2;
  const cy = (br.top - rect.top) + br.height/2;
  cropBox.style.width = w + 'px';
  cropBox.style.height = h + 'px';
  cropBox.style.left = (cx - w/2) + 'px';
  cropBox.style.top = (cy - h/2) + 'px';
}

// 显示画面 = rotate(flips(裁剪源))；把显示空间矩形反向换算回源空间（自动校正方向后的像素坐标）
function unrotateRect(rect, angle, W, H){
  switch(angle){
    case 90:  return { x: rect.y, y: H - rect.w - rect.x, w: rect.h, h: rect.w };
    case 180: return { x: W - rect.x - rect.w, y: H - rect.y - rect.h, w: rect.w, h: rect.h };
    case 270: return { x: W - rect.y - rect.h, y: rect.x, w: rect.h, h: rect.w };
    default:  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }
}

$('#applyCrop').onclick = ()=>{
  const imgR = editImg.getBoundingClientRect();
  const boxR = cropBox.getBoundingClientRect();
  const angle = ((Math.round(edit.rotate || 0) % 360) + 360) % 360;
  const rot90 = angle === 90 || angle === 270;
  const rotW = rot90 ? current.height : current.width;
  const rotH = rot90 ? current.width : current.height;
  const sx = rotW / imgR.width;
  const sy = rotH / imgR.height;
  let rect = {
    x: (boxR.left - imgR.left) * sx,
    y: (boxR.top - imgR.top) * sy,
    w: boxR.width * sx,
    h: boxR.height * sy,
  };
  rect = unrotateRect(rect, angle, current.width, current.height);
  if(edit.flipH) rect.x = current.width - rect.x - rect.w;
  if(edit.flipV) rect.y = current.height - rect.y - rect.h;
  const clamp = (v, max) => Math.max(0, Math.min(v, max));
  const left = clamp(Math.round(rect.x), current.width);
  const top = clamp(Math.round(rect.y), current.height);
  const width = clamp(Math.round(rect.w), current.width - left);
  const height = clamp(Math.round(rect.h), current.height - top);
  if(width < 1 || height < 1){ toast('裁剪区域过小', true); return; }
  edit.crop = { left, top, width, height };
  cropping=false; cropOverlay.hidden=true; $('#cropRatios').hidden=true; $('#applyCrop').hidden=true;
  $('#cropToggle').textContent='✂ 开启裁剪';
  toast(`已标记裁剪 ${width}×${height}`);
  scheduleDraftSave();
};

/* ---- 前后对比（原图 vs 编辑后，可拖动分界线） ---- */
const baOrigImg = $('#baOrigImg'), baDivider = $('#baDivider');
let baActive = false;
let baDir = 'h'; // h=左右分屏  v=上下分屏（v1.2 §3.4.6）
let baDragStart = null;

$('#baToggle').onclick = toggleBA;
function toggleBA(){
  if(!current) return;
  baActive = !baActive;
  $('#baToggle').classList.toggle('active', baActive);
  $('#baToggle').textContent = baActive ? '⇄ 退出对比' : '⇄ 对比原图';
  $('#baDirToggle').hidden = !baActive;
  if (baActive) canvasStageEl.dataset.baDir = baDir;
  baOrigImg.hidden = !baActive;
  baDivider.hidden = !baActive;
  if(baActive){
    baOrigImg.src = editImg.src;
    baOrigImg.style.transform = editImg.style.transform;
    $('#canvasStage').style.setProperty('--ba', '50%');
    // 对比时隐藏裁剪框，避免两层叠加干扰
    cropOverlay.hidden = true;
  } else if(cropping){
    cropOverlay.hidden = false;
    initCropBox();
  }
}

// v1.2 §3.4.6：baActive 时 canvas-stage 任意位置按下即可拖动分界线
$('#baDirToggle').onclick = ()=>{
  baDir = baDir === 'h' ? 'v' : 'h';
  canvasStageEl.dataset.baDir = baDir;
  $('#baDirToggle').textContent = baDir === 'h' ? '⇆ 左右' : '⇅ 上下';
};

/* v1.2 §3.4.4 画布缩放平移（0.25×–4×，transform 挂 .canvas-zoom） */
const canvasStageEl = $('#canvasStage');
const canvasZoomEl = $('#canvasZoom');
let canvasZoom = 1, canvasPanX = 0, canvasPanY = 0;
let canvasPanDrag = null;

function clampCanvasPan(){
  const stageR = canvasStageEl.getBoundingClientRect();
  const imgR = editImg.getBoundingClientRect();
  const imgW = imgR.width / canvasZoom, imgH = imgR.height / canvasZoom;
  const maxX = Math.max(0, (imgW * canvasZoom - stageR.width) / 2);
  const maxY = Math.max(0, (imgH * canvasZoom - stageR.height) / 2);
  const c = window.gsap ? gsap.utils.clamp(-maxX, maxX, canvasPanX) : Math.max(-maxX, Math.min(maxX, canvasPanX));
  canvasPanX = c;
  const c2 = window.gsap ? gsap.utils.clamp(-maxY, maxY, canvasPanY) : Math.max(-maxY, Math.min(maxY, canvasPanY));
  canvasPanY = c2;
}
function applyCanvasZoom(animate = true){
  if (!canvasZoomEl) return;
  if (window.gsap) {
    if (!animate) {
      gsap.set(canvasZoomEl, { scale: canvasZoom, x: canvasPanX, y: canvasPanY });
    } else {
      // 缩放 0.2s、平移 0.08s 跟手
      gsap.to(canvasZoomEl, { scale: canvasZoom, duration: 0.2, ease: 'power2.out', overwrite: 'auto' });
      gsap.to(canvasZoomEl, { x: canvasPanX, y: canvasPanY, duration: 0.08, ease: 'power2.out', overwrite: 'auto' });
    }
  } else {
    canvasZoomEl.style.transform = `translate(${canvasPanX}px,${canvasPanY}px) scale(${canvasZoom})`;
  }
  $('#canvasZoomPct').textContent = Math.round(canvasZoom * 100) + '%';
  $('#canvasZoomFit').hidden = canvasZoom === 1 && canvasPanX === 0 && canvasPanY === 0;
  if (cropping) initCropBox();
}
function resetCanvasZoom(){
  canvasZoom = 1; canvasPanX = 0; canvasPanY = 0;
  applyCanvasZoom();
}
function canvasZoomAt(factor, clientX, clientY){
  const rect = canvasStageEl.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  const px = clientX - rect.left, py = clientY - rect.top;
  const next = Math.max(0.25, Math.min(4, canvasZoom * factor));
  if (next === canvasZoom) return;
  // 以鼠标位置为锚点：保持鼠标下的内容点不动
  const localX = cx + (px - cx - canvasPanX) / canvasZoom;
  const localY = cy + (py - cy - canvasPanY) / canvasZoom;
  canvasZoom = next;
  canvasPanX = px - cx - (localX - cx) * canvasZoom;
  canvasPanY = py - cy - (localY - cy) * canvasZoom;
  clampCanvasPan();
  applyCanvasZoom();
}
function canvasZoomCenter(factor){
  const r = canvasStageEl.getBoundingClientRect();
  canvasZoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
}
canvasStageEl.addEventListener('wheel', e=>{
  e.preventDefault();
  canvasZoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
}, { passive: false });
$('#canvasZoomIn').onclick = ()=>canvasZoomCenter(1.25);
$('#canvasZoomOut').onclick = ()=>canvasZoomCenter(0.8);
$('#canvasZoomFit').onclick = resetCanvasZoom;

// 统一指针处理：裁剪框拖拽由 cropBox 自管；baActive 拖分界线；缩放>1 拖拽平移
canvasStageEl.addEventListener('pointerdown', e=>{
  if (e.target.closest('.crop-box')) return;
  if (baActive) {
    baDragStart = { axis: baDir === 'v' ? 'y' : 'x', sx: e.clientX, sy: e.clientY };
    canvasStageEl.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  if (canvasZoom <= 1) return;
  canvasPanDrag = { sx: e.clientX, sy: e.clientY, px: canvasPanX, py: canvasPanY };
  canvasStageEl.setPointerCapture(e.pointerId);
  e.preventDefault();
});
canvasStageEl.addEventListener('pointermove', e=>{
  if (baDragStart) {
    const r = canvasStageEl.getBoundingClientRect();
    const v = baDragStart.axis === 'y' ? e.clientY - r.top : e.clientX - r.left;
    const denom = baDragStart.axis === 'y' ? r.height : r.width;
    if (!denom) return;
    const pct = Math.min(100, Math.max(0, (v / denom) * 100));
    canvasStageEl.style.setProperty('--ba', pct + '%');
    return;
  }
  if (canvasPanDrag) {
    canvasPanX = canvasPanDrag.px + (e.clientX - canvasPanDrag.sx);
    canvasPanY = canvasPanDrag.py + (e.clientY - canvasPanDrag.sy);
    clampCanvasPan();
    applyCanvasZoom();
  }
});
canvasStageEl.addEventListener('pointerup', ()=>{ canvasPanDrag = null; baDragStart = null; });
canvasStageEl.addEventListener('dblclick', e=>{
  if (e.target.closest('.crop-box')) return;
  if (e.target.closest('.ba-divider')) { canvasStageEl.style.setProperty('--ba', '50%'); return; }
  resetCanvasZoom();
});

/* ---- 导出 ---- */
$('#exportBtn').onclick = async ()=>{
  if(!current) return;
  const btn = $('#exportBtn'); btn.disabled=true; btn.textContent='处理中…';
  showLoading();
  const body = buildEditBody($('#overwrite').checked ? 'overwrite' : 'copy');
  try{
    const r = await api.post(`/api/photos/${current.id}/process`, body);
    if(r.ok){
      // 导出成功 → 清除草稿
      api.del(`/api/photos/${current.id}/draft`).catch(()=>{});
      clearTimeout(draftTimer); draftTimer = null;
      toast(body.mode==='overwrite' ? '已覆盖保存 ✓' : '已另存为新副本 ✓');
      await loadPhotos();
      const np = photos.find(x=>x.id===r.photo.id);
      if(np) openEditor(np);
    } else toast('处理失败:'+r.error, true);
  }catch(e){ toast('处理失败:'+e.message, true); }
  hideLoading();
  btn.disabled=false; btn.textContent='💾 处理并保存';
};

// 下载当前编辑结果到本地(不落库,服务器实时处理后回传字节)
$('#downloadBtn').onclick = async ()=>{
  if(!current) return;
  const btn = $('#downloadBtn'); btn.disabled=true; btn.textContent='生成中…';
  showLoading();
  const body = buildEditBody('copy');
  try{
    const resp = await fetch(`/api/photos/${current.id}/render`, {
      method:'POST', headers:{'Content-Type':'application/json', ...(authToken ? {'X-Luma-Token': authToken} : {})}, body:JSON.stringify(body),
    });
    if(!resp.ok){ const j = await resp.json().catch(()=>({})); throw new Error(j.error||'渲染失败'); }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = current.name.replace(/\.[^.]+$/, '');
    a.href = url; a.download = `${base}_edited.${body.output.format}`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('已下载到本地 ✓');
  }catch(e){ toast('下载失败:'+e.message, true); }
  hideLoading();
  btn.disabled=false; btn.textContent='⬇ 下载到本地';
};

// 从当前 UI 收集编辑参数
function buildEditBody(mode){
  return {
    adjust: buildAdjustFromUI(),
    transform:{ rotate:edit.rotate, flipH:edit.flipH, flipV:edit.flipV, crop:edit.crop },
    resize: edit.resize || { width:+$('#reW').value, height:+$('#reH').value },
    output:{ format:$('#outFormat').value, quality:+$('#quality').value },
    mode,
  };
}

// 双击编辑器底部文件名可重命名
$('#editName').title = '双击重命名';
$('#editName').style.cursor = 'pointer';
$('#editName').ondblclick = async ()=>{
  if(!current) return;
  const name = await showInputModal('重命名照片', '新名称', current.name, '输入新的照片名称');
  if(!name) return;
  const r = await api.post(`/api/photos/${current.id}/rename`, { name });
  if(r.ok){
    current.name = r.photo.name;
    $('#editName').textContent = current.name;
    await loadPhotos();
    toast('已重命名 ✓');
  } else toast(r.error||'重命名失败', true);
};

/* ============ EXIF ============ */
async function openExif(p){
  current = p;
  lastExifId = p.id;
  switchView('exif');
  $('#exifEmpty').classList.remove('show');
  $('#exifWrap').classList.remove('hidden');
  $('#exifImg').src = '/files/'+p.file + '?t='+Date.now();
  const list = $('#exifList'); list.innerHTML = '<div class="exif-empty-row">读取中…</div>';
  const r = await api.get(`/api/photos/${p.id}/exif`);
  const ex = r.exif || {};
  list.innerHTML = renderExifGroups(p, ex);
  // 填充可编辑字段
  $('#exArtist').value = ex.Artist||'';
  $('#exCopyright').value = ex.Copyright||'';
  $('#exDesc').value = ex.ImageDescription||'';
  $('#exDate').value = ex.DateTimeOriginal ? formatExifDate(ex.DateTimeOriginal) : '';
}
// v1.2 §3.5.1 分组展示；§3.5.3 GPS 十进制度 + 度分秒 + 地图链接
function dmsFormat(v, isLat){
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const dir = isLat ? (n >= 0 ? 'N' : 'S') : (n >= 0 ? 'E' : 'W');
  const a = Math.abs(n);
  const deg = Math.floor(a);
  const min = Math.floor((a - deg) * 60);
  const sec = Math.round(((a - deg) * 60 - min) * 60 * 100) / 100;
  return `${deg}°${min}′${sec}″${dir}`;
}
function renderExifGroups(p, ex){
  const rows = (map, fmt) => {
    const out = [];
    for (const [k, label] of Object.entries(map)) {
      if (ex[k] == null || ex[k] === '') continue;
      let v = ex[k];
      if (fmt && fmt[k]) v = fmt[k](v);
      out.push([label, String(v)]);
    }
    return out;
  };
  const cam = rows({ Make:'相机品牌', Model:'相机型号', LensModel:'镜头', Software:'软件' });
  const shot = rows(
    { FNumber:'光圈', ExposureTime:'快门', ISO:'ISO', FocalLength:'焦距', Orientation:'方向' },
    {
      FNumber: v => 'f/' + v,
      ExposureTime: v => (v <= 1 ? `1/${Math.round(1 / v)}s` : v + 's'),
      FocalLength: v => v + 'mm',
    }
  );
  const time = rows({ DateTimeOriginal:'拍摄时间' }, {
    DateTimeOriginal: v => (v instanceof Date ? formatExifDate(v) : String(v).replace(/^(\d{4})[:\/](\d{2})[:\/](\d{2})/, '$1-$2-$3')),
  });
  const file = [
    ['文件名', p.name],
    ['格式', (p.format || '').toUpperCase()],
    ['分辨率', `${p.width} × ${p.height}`],
    ['文件大小', fmtSize(p.size)],
  ];
  const gps = [];
  const lat = ex.latitude, lng = ex.longitude;
  const hasLat = lat != null && lat !== '', hasLng = lng != null && lng !== '';
  if (hasLat) gps.push(['纬度', `${lat} · ${dmsFormat(lat, true)}`, 'gps']);
  if (hasLng) gps.push(['经度', `${lng} · ${dmsFormat(lng, false)}`, 'gps']);
  if (hasLat && hasLng) {
    gps.push(['地图',
      `<a href="https://uri.amap.com/marker?position=${lng},${lat}&name=Luma" target="_blank" rel="noopener">高德地图</a> · ` +
      `<a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener">Google 地图</a>`]);
  }
  const groups = [['相机', cam], ['拍摄参数', shot], ['时间', time], ['文件', file], ['GPS', gps]];
  let html = '';
  for (const [title, rowsArr] of groups) {
    if (!rowsArr.length) continue;
    html += `<div class="exif-group-title">${esc(title)}</div>`;
    html += rowsArr.map(([k, v, extra]) => {
      const plain = String(v).replace(/<[^>]+>/g, '');
      return `<div class="exif-item"><span class="k">${esc(k)}</span>` +
        `<span class="v" data-copy="${esc(plain)}"${extra === 'gps' ? ' data-gps="1"' : ''}>${v}<i class="copy-badge">⧉</i></span></div>`;
    }).join('');
  }
  return html;
}
async function copyText(txt){
  try { await navigator.clipboard.writeText(txt); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}
// v1.2 §3.5.2 值复制（GPS 字段附带"打开地图"动作）
$('#exifList').addEventListener('click', async e=>{
  if (e.target.closest('a')) return;
  const vEl = e.target.closest('.exif-item .v');
  if (!vEl) return;
  const txt = vEl.dataset.copy != null ? vEl.dataset.copy : vEl.textContent.trim();
  if (!txt) return;
  await copyText(txt);
  const action = vEl.dataset.gps ? {
    label: '打开地图',
    onClick: ()=>{ window.open('https://www.google.com/maps?q=' + encodeURIComponent(txt), '_blank', 'noopener'); },
  } : null;
  toast(`已复制：${txt.length > 40 ? txt.slice(0, 40) + '…' : txt}`, action ? { action } : undefined);
});
function formatExifDate(d){
  if(d instanceof Date){
    const p=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}:${p(d.getMonth()+1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  return String(d);
}
$('#saveExif').onclick = async ()=>{
  if(!current) return;
  const r = await api.post(`/api/photos/${current.id}/exif`, {
    artist:$('#exArtist').value, copyright:$('#exCopyright').value,
    description:$('#exDesc').value, datetime:$('#exDate').value,
  });
  if(r.ok){ toast('元数据已保存 ✓'); openExif(current); }
  else toast(r.error||'保存失败', true);
};
$('#stripExif').onclick = async ()=>{
  if(!current) return;
  if(!(await showConfirm('抹除元数据', '确定抹除全部元数据?(将清除相机、GPS、作者等信息)', { danger: true, confirmText: '抹除' }))) return;
  const btn = $('#stripExif'); btn.disabled=true; btn.textContent='处理中…';
  showLoading();
  try {
    const r = await api.post(`/api/photos/${current.id}/strip-exif`, {});
    if(r.ok){ toast('元数据已抹除 ✓'); await loadPhotos(); const np=photos.find(x=>x.id===current.id); if(np) openExif(np); }
    else toast('操作失败', true);
  } catch(e){ toast('操作失败:'+e.message, true); }
  hideLoading();
  btn.disabled=false; btn.textContent='抹除全部元数据';
};
$('#dlFromExif').onclick = ()=>{ if(current) downloadPhoto(current); };

/* ============ 设置 ============ */
const PRESET_COLORS = ['#0071e3','#ff375f','#34c759','#ff9500','#af52de','#5856d6'];
// v1.2 §1.6：深色模式应用（即时生效，无需重启）
function applyTheme(theme){
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const sw = $('#setTheme'); if (sw) sw.checked = dark;
  const rm = $('#setReduceMotion'); if (rm) rm.value = settings.reduceMotion || 'system';
  if (window.UIAnim) window.UIAnim.setReduceMode(settings.reduceMotion || 'system');
}
async function loadSettings(){
  settings = await api.get('/api/settings');
  $('#setFormat').value = settings.defaultFormat;
  $('#setQuality').value = settings.defaultQuality;
  $('#vSetQuality').textContent = settings.defaultQuality+'%';
  $('#setThumb').value = settings.thumbSize;
  $('#setAccent').value = settings.accent;
  $('#setAutoAdvance').checked = settings.autoAdvance !== false;
  const logsSel = $('#setLogsRefresh'); if (logsSel) logsSel.value = String(settings.logsRefreshInterval || 3);
  applyAccent(settings.accent);
  applyTheme(settings.theme || 'light');
  // 色板
  const sw = $('#swatches'); sw.innerHTML='';
  PRESET_COLORS.forEach(c=>{
    const d=document.createElement('div'); d.className='sw'+(c===settings.accent?' active':'');
    d.style.background=c; d.onclick=()=>{ $('#setAccent').value=c; applyAccent(c); $$('.sw').forEach(x=>x.classList.toggle('active',x===d)); };
    sw.appendChild(d);
  });
}
function applyAccent(c){ document.documentElement.style.setProperty('--accent', c); document.documentElement.dataset.accent = c; }
$('#setQuality').addEventListener('input',()=>$('#vSetQuality').textContent=$('#setQuality').value+'%');
$('#setAccent').addEventListener('input',e=>applyAccent(e.target.value));
// 深色模式 / 减弱动效：切换即时生效
$('#setTheme').addEventListener('change', ()=>{
  settings.theme = $('#setTheme').checked ? 'dark' : 'light';
  applyTheme(settings.theme);
});
$('#setReduceMotion').addEventListener('change', ()=>{
  settings.reduceMotion = $('#setReduceMotion').value;
  if (window.UIAnim) window.UIAnim.setReduceMode(settings.reduceMotion);
});
$('#saveSettings').onclick = async ()=>{
  const body = {
    defaultFormat:$('#setFormat').value,
    defaultQuality:+$('#setQuality').value,
    thumbSize:+$('#setThumb').value,
    accent:$('#setAccent').value,
    autoAdvance: $('#setAutoAdvance').checked,
    theme: $('#setTheme').checked ? 'dark' : 'light',
    reduceMotion: $('#setReduceMotion').value,
    logsRefreshInterval: +($('#setLogsRefresh') ? $('#setLogsRefresh').value : 3),
  };
  const r = await api.post('/api/settings', body);
  if(r.ok){ settings=r.settings; applyAccent(settings.accent); applyTheme(settings.theme); startLogsAutoRefresh(); toast('设置已保存 ✓'); }
};
async function loadStats(){
  const s = await api.get('/api/stats');
  $('#stCount').textContent = s.count+' 张';
  $('#stSize').textContent = fmtSize(s.totalSize);
  // v1.2 §3.7.3 数据目录路径 + 打开按钮（仅 Electron 可用）
  if (s.dataDir) $('#stDir').textContent = s.dataDir;
  const btn = $('#openDataDirBtn');
  if (btn) {
    if (window.luma && window.luma.openDataDir) {
      btn.disabled = false;
      btn.onclick = async ()=>{
        const r = await window.luma.openDataDir();
        if (r && !r.ok) toast('打开数据目录失败:' + (r.error || ''), true);
      };
    } else {
      btn.disabled = true;
      btn.title = '打开数据目录仅桌面版可用';
    }
  }
  // v1.2.1 本地访问令牌：设置页展示 / 复制 / 重新生成（仅 Electron 可用）
  const tokenEl = $('#stToken');
  const copyBtn = $('#copyTokenBtn');
  const resetBtn = $('#resetTokenBtn');
  if (tokenEl && window.luma && typeof window.luma.getToken === 'function') {
    const t = await window.luma.getToken();
    if (t) {
      tokenEl.textContent = t;
      if (copyBtn) {
        copyBtn.disabled = false;
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(t);
          toast('令牌已复制 ✓');
        };
      }
      if (resetBtn) {
        resetBtn.disabled = false;
        resetBtn.onclick = async () => {
          const r = await api.post('/api/auth/reset-token', {});
          if (r && r.ok && r.token) {
            authToken = r.token; // 更新本地令牌，后续写请求使用新令牌
            tokenEl.textContent = r.token;
            toast('令牌已重新生成 ✓');
          } else {
            toast('重新生成失败:' + ((r && r.error) || '未知错误'), true);
          }
        };
      }
    }
  } else if (tokenEl) {
    tokenEl.textContent = '仅桌面版可用';
  }
}

/* ============ 关于页 ============ */
async function loadAbout(){
  try{
    const info = await api.get('/api/info');
    $('#aboutVer').textContent = 'v' + (info.version || '?');
    $('#aboutNode').textContent = info.node || '—';
    $('#aboutSharp').textContent = info.sharp ? `v${info.sharp.vips || '?'} (libvips)` : '—';
    $('#aboutPhotos').textContent = (info.photoCount || 0) + ' 张';
    $('#aboutStorage').textContent = fmtSize(info.storageBytes || 0);
    const h=Math.floor(info.uptime/3600), m=Math.floor((info.uptime%3600)/60), s=info.uptime%60;
    $('#aboutUptime').textContent = h>0 ? `${h}时${m}分${s}秒` : m>0 ? `${m}分${s}秒` : `${s}秒`;
  } catch(e){ console.error('加载关于信息失败', e); }
}

/* ============ 选片/多选 ============ */
function toggleSelect(id, card){
  if(selected.has(id)){ selected.delete(id); if(card) card.classList.remove('selected'); }
  else { selected.add(id); if(card) card.classList.add('selected'); }
  if(card) card.querySelector('.sel-check').textContent = selected.has(id) ? '✓' : '';
  updateBatchBar();
}
function updateBatchBar(){
  const n = selected.size;
  $('#batchBar').hidden = n === 0;
  $('#selCount').textContent = n + ' 张已选';
  // v1.2 §3.6.2 收藏夹详情页隐藏"加入收藏夹"按钮（已在该收藏夹内）
  const albumBtn = $('#batchAlbum');
  if (albumBtn) albumBtn.hidden = !!activeAlbumId;
  // v1.2 §3.1.5 已选缩略图条：最多 8 个 + "＋N"，点击取消选中
  const thumbs = $('#batchThumbs');
  if (!thumbs) return;
  thumbs.innerHTML = '';
  const arr = photos.filter(p=>selected.has(p.id));
  arr.slice(0, 8).forEach(p=>{
    const d = document.createElement('div');
    d.className = 'batch-thumb';
    d.title = p.name;
    d.innerHTML = `<img src="/thumbs/${p.id}.webp?v=${p.time}" alt="">`;
    d.onclick = ()=>{ selected.delete(p.id); refreshCurrentGrid(); };
    thumbs.appendChild(d);
  });
  if (arr.length > 8) {
    const plus = document.createElement('div');
    plus.className = 'batch-thumb plus';
    plus.textContent = `＋${arr.length - 8}`;
    thumbs.appendChild(plus);
  }
}
// v1.2 §3.6.2 批量操作完成后：详情页留在当前收藏夹刷新，主相册正常刷新
async function refreshAfterBatch(){
  if (activeAlbumId) await openAlbum(activeAlbumId);
  else await loadPhotos();
  await loadAlbums();
}
$('#batchSelectAll').onclick = ()=>{ photos.forEach(p=>selected.add(p.id)); refreshCurrentGrid(); };
$('#batchClearSel').onclick = ()=>{ selected.clear(); refreshCurrentGrid(); };

/* ---- 搜索/筛选/排序 ---- */
let searchTimer;
$('#searchInput').addEventListener('input', ()=>{ clearTimeout(searchTimer); searchTimer = setTimeout(loadPhotos, 300); });
$('#sortSelect').addEventListener('change', loadPhotos);
$('#filterSelect').addEventListener('change', loadPhotos);
$('#formatFilter').addEventListener('change', loadPhotos);
$('#hideRejectBtn').onclick = ()=>{
  hideReject = !hideReject;
  $('#hideRejectBtn').classList.toggle('active', hideReject);
  loadPhotos();
};

/* ---- 批量操作 ---- */
$('#batchPick').onclick = async ()=>{
  const ids = [...selected];
  try{
    const r = await api.post('/api/photos/batch/flag', { ids, flag: 'pick' });
    if(!r.ok) throw new Error(r.error||'操作失败');
    toast(`已标记 ${ids.length} 张为精选 ✓`); await refreshAfterBatch();
  }catch(e){ toast('操作失败:'+e.message, true); }
};
$('#batchReject').onclick = async ()=>{
  const ids = [...selected];
  try{
    const r = await api.post('/api/photos/batch/flag', { ids, flag: 'reject' });
    if(!r.ok) throw new Error(r.error||'操作失败');
    toast(`已标记 ${ids.length} 张为排除 ✓`); await refreshAfterBatch();
  }catch(e){ toast('操作失败:'+e.message, true); }
};
$('#batchRate').onclick = async ()=>{
  const raw = await showInputModal('批量评分', '0-5 星（0 为清除）', '5', '输入 0-5 的整数评分');
  if(raw == null) return;
  const s = parseInt(raw, 10);
  if(isNaN(s) || s < 0 || s > 5){ toast('评分需为 0-5 的整数', true); return; }
  const ids = [...selected];
  try{
    const r = await api.post('/api/photos/batch/stars', { ids, stars: +s });
    if(!r.ok) throw new Error(r.error||'操作失败');
    toast(`已对 ${ids.length} 张评分 ✓`); await refreshAfterBatch();
  }catch(e){ toast('操作失败:'+e.message, true); }
};
$('#batchDelete').onclick = async ()=>{
  const ids = [...selected];
  if(!(await showConfirm('批量删除', `确定删除选中的 ${ids.length} 张照片?不可恢复。`, { danger: true, confirmText: '删除' }))) return;
  showLoading();
  try{
    const r = await api.post('/api/photos/batch/delete', { ids });
    if(!r.ok) throw new Error(r.error||'删除失败');
    selected.clear(); await refreshAfterBatch();
    toast(`已删除 ${ids.length} 张照片`);
  }catch(e){ toast('删除失败:'+e.message, true); }
  hideLoading();
};
$('#batchZip').onclick = async ()=>{
  const ids = [...selected];
  toast(`正在打包 ${ids.length} 张照片…`);
  showLoading();
  try{
    const resp = await fetch('/api/photos/download-zip',{ method:'POST', headers:{'Content-Type':'application/json', ...(authToken ? {'X-Luma-Token': authToken} : {})}, body:JSON.stringify({ ids }) });
    if(!resp.ok) throw new Error('打包失败');
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'LumaStudio_export.zip';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    toast('ZIP 已下载 ✓');
  } catch(e){ toast('下载失败:'+e.message, true); }
  hideLoading();
};
$('#batchAlbum').onclick = async ()=>{
  if(!albums.length){ toast('请先创建一个收藏夹', true); return; }
  const options = albums.map(a => ({ label: `${a.name}（${a.count} 张）`, value: a.id }));
  const albumId = await showSelectModal('加入收藏夹', options, '选择要把照片加入的收藏夹');
  if(!albumId) return;
  const target = albums.find(a => a.id === albumId);
  if(!target) return;
  const ids = [...selected];
  await api.post(`/api/albums/${target.id}/add`, { ids });
  toast(`已添加 ${ids.length} 张到「${target.name}」✓`); await loadAlbums();
};

/* ---- 批量处理（后台任务 + 进度条 + 取消） ---- */
let batchJobId = null;
let batchJobTimer = null;
let batchRunning = false;
let batchPreset = 'none';

$('#batchProcess').onclick = ()=>{
  if(!selected.size){ toast('请先选择照片', true); return; }
  batchRunning = false;
  batchJobId = null;
  $('#batchCancel').textContent = '取消';
  $('#batchModalCount').textContent = selected.size;
  $('#batchProgress').hidden = true;
  $('#batchErrors').innerHTML = '';
  $('#batchStart').hidden = false;
  $('#batchProgressBar').style.width = '0%';
  $$('#batchPresets .chip').forEach(c=>c.classList.toggle('active', c.dataset.preset===batchPreset));
  if(window.UIAnim) window.UIAnim.modal($('#batchModal'), $('.modal-content', $('#batchModal')), true);
  else $('#batchModal').hidden = false;
};
$('#batchPresets').addEventListener('click', e=>{
  const c = e.target.closest('.chip'); if(!c) return;
  batchPreset = c.dataset.preset;
  $$('#batchPresets .chip').forEach(x=>x.classList.toggle('active', x===c));
});
$('#batchQuality').addEventListener('input', ()=>{
  $('#batchVQuality').textContent = $('#batchQuality').value + '%';
});
$('#batchStart').onclick = async ()=>{
  const ids = [...selected];
  if(!ids.length) return;
  const preset = PRESETS[batchPreset] || PRESETS.none;
  const body = {
    ids,
    pipeline: {
      adjust: {
        brightness: preset.brightness / 100,
        contrast: preset.contrast / 100,
        saturation: preset.saturation / 100,
        hue: preset.hue,
        grayscale: preset.grayscale,
      },
      resizeScale: parseFloat($('#batchScale').value) || 1,
      output: { format: $('#batchFormat').value, quality: +$('#batchQuality').value },
    },
    mode: $('#batchOverwrite').checked ? 'overwrite' : 'copy',
  };
  $('#batchStart').hidden = true;
  $('#batchProgress').hidden = false;
  $('#batchProgressText').textContent = `0 / ${ids.length}`;
  batchRunning = true;
  try{
    const r = await api.post('/api/photos/batch/process', body);
    if(!r.ok) throw new Error(r.error || '启动失败');
    batchJobId = r.jobId;
    pollBatchJob();
  }catch(e){
    batchRunning = false;
    $('#batchStart').hidden = false;
    toast('批量处理启动失败:' + e.message, true);
  }
};
function pollBatchJob(){
  stopBatchPolling();
  batchJobTimer = setInterval(async ()=>{
    if(!batchJobId) return;
    const j = await api.get('/api/jobs/' + batchJobId).catch(()=>null);
    if(!j) return;
    $('#batchProgressBar').style.width = (j.total ? (j.done / j.total * 100) : 0) + '%';
    $('#batchProgressText').textContent =
      `${j.done} / ${j.total}${j.current ? ' · ' + j.current.name : ''}`;
    if(j.errors && j.errors.length){
      $('#batchErrors').innerHTML = j.errors.slice(0, 10)
        .map(x => `<div class="err">${esc(x.name || x.id)}: ${esc(x.error)}</div>`)
        .join('');
    }
    if(j.status === 'done' || j.status === 'canceled' || j.status === 'error'){
      stopBatchPolling();
      batchRunning = false;
      const failed = (j.errors || []).length;
      if(j.status === 'done'){
        toast(`批量处理完成：成功 ${j.done - failed} 张${failed ? '，失败 ' + failed + ' 张' : ''}`, failed > 0);
        selected.clear();
        await refreshAfterBatch();
      } else {
        toast(j.status === 'canceled' ? '批量处理已取消' : '批量处理出错', true);
      }
      $('#batchStart').hidden = true;
      $('#batchCancel').textContent = '关闭';
    }
  }, 500);
}
function stopBatchPolling(){
  if(batchJobTimer){ clearInterval(batchJobTimer); batchJobTimer = null; }
}
$('#batchCancel').onclick = async ()=>{
  if(batchRunning && batchJobId){
    await api.post('/api/jobs/' + batchJobId + '/cancel', {}).catch(()=>{});
    stopBatchPolling();
    batchRunning = false;
  }
  batchJobId = null;
  if(window.UIAnim) window.UIAnim.modal($('#batchModal'), $('.modal-content', $('#batchModal')), false);
  else $('#batchModal').hidden = true;
};

/* ============ 评分/标记 ============ */
async function setStars(id, stars){
  try{
    const r = await api.post(`/api/photos/${id}/stars`, { stars });
    if(!r.ok) throw new Error(r.error||'评分失败');
    const p = photos.find(x=>x.id===id);
    if(p) p.stars = stars;
    refreshCurrentGrid();
  }catch(e){ toast('评分失败:'+e.message, true); }
}
async function setFlag(id, flag){
  try{
    const r = await api.post(`/api/photos/${id}/flag`, { flag });
    if(!r.ok) throw new Error(r.error||'标记失败');
    const p = photos.find(x=>x.id===id);
    if(p) p.flag = flag;
    refreshCurrentGrid();
  }catch(e){ toast('标记失败:'+e.message, true); }
}

/* ============ 幻灯片 ============ */
let slIndex = 0;
let slProgressTween = null;
function openSlideshow(){
  if(!photos.length) return;
  $('#slideshow').hidden = false;
  slIndex = lbIndex >= 0 ? lbIndex : 0;
  slShow();
}
function slShow(){
  const p = photos[slIndex]; if(!p) return;
  const img = $('#slImg');
  const show = ()=>{
    $('#slInfo').textContent = `${slIndex+1}/${photos.length} · ${p.name} · ${p.width}×${p.height}`;
    slKenBurns(img, slIndex);
    slStartProgress();
  };
  if (window.UIAnim) window.UIAnim.crossfade(img, '/files/'+p.file+'?v='+p.time, show);
  else {
    img.style.opacity = '0';
    setTimeout(()=>{ img.src = '/files/'+p.file+'?v='+p.time; show(); img.style.opacity = '1'; }, 200);
  }
}
// v1.2 §3.3.1 Ken Burns 慢推：奇偶张交替放大/缩小（1 ↔ 1.06）
function slKenBurns(img, idx){
  if (!window.gsap || (window.UIAnim && window.UIAnim.reduce)) return;
  gsap.killTweensOf(img);
  const dur = (settings.slideshowInterval || 3);
  const zoomIn = idx % 2 === 0;
  img.style.transformOrigin = zoomIn ? '50% 40%' : '50% 60%';
  gsap.fromTo(img, { scale: zoomIn ? 1 : 1.06 }, { scale: zoomIn ? 1.06 : 1, duration: dur, ease: 'power1.inOut' });
}
// v1.2 §3.3.2 顶部细进度条：每张从 scaleX(0) 到 scaleX(1)，时长=播放间隔
function slStartProgress(){
  const el = $('#slProgress');
  const dur = (settings.slideshowInterval || 3);
  gsap.killTweensOf(el);
  if (window.gsap && !(window.UIAnim && window.UIAnim.reduce)) {
    gsap.set(el, { scaleX: 0, transformOrigin: 'left' });
    slProgressTween = gsap.to(el, { scaleX: 1, duration: dur, ease: 'power1.inOut' });
  } else {
    el.style.transform = 'scaleX(1)';
  }
}
function slStopProgress(){
  if (slProgressTween) { slProgressTween.kill(); slProgressTween = null; }
  gsap.killTweensOf($('#slProgress'));
  $('#slProgress').style.transform = 'scaleX(0)';
}
function slPlay(){
  if(slTimer){
    clearInterval(slTimer); slTimer=null; $('#slPlay').textContent='▶';
    if (slProgressTween) slProgressTween.pause();
    return;
  }
  $('#slPlay').textContent='⏸';
  const interval = (settings.slideshowInterval || 3) * 1000;
  slTimer = setInterval(()=>{ slIndex=(slIndex+1)%photos.length; slShow(); }, interval);
  slStartProgress(); // 恢复播放时进度从当前张重新开始，保持与定时器同步
}
$('#slPrev').onclick = ()=>{ slIndex=(slIndex-1+photos.length)%photos.length; slShow(); };
$('#slNext').onclick = ()=>{ slIndex=(slIndex+1)%photos.length; slShow(); };
$('#slPlay').onclick = slPlay;
$('#slExit').onclick = ()=>{ $('#slideshow').hidden=true; if(slTimer){clearInterval(slTimer);slTimer=null;} slStopProgress(); };

/* ============ 收藏夹 ============ */
function renderAlbums(){
  const ag = $('#albumsGrid');
  ag.innerHTML = '';
  $('#albumsEmpty').classList.toggle('show', albums.length===0);
  albums.forEach(a=>{
    const card = document.createElement('div');
    card.className = 'album-card';
    // v1.2 §3.6.1 首图封面（16:10）；无封面保留 📁 占位
    const cover = a.cover
      ? `<img src="/thumbs/${a.cover}.webp" alt="" loading="lazy">`
      : '';
    const time = a.time ? `<div class="album-time">${new Date(a.time).toLocaleDateString('zh-CN')}</div>` : '';
    card.innerHTML =
      `<div class="album-cover">${cover}<span class="album-emoji">📁</span></div>` +
      `<div class="album-info"><h3>${esc(a.name)}</h3><div class="album-count">${a.count} 张照片</div>${time}</div>`;
    card.onclick = ()=>openAlbum(a.id);
    ag.appendChild(card);
  });
}
async function openAlbum(id){
  activeAlbumId = id;
  const a = albums.find(x=>x.id===id); if(!a) return;
  $('#albumDetail').hidden = false;
  $('#albumsGrid').style.display = 'none';
  $('#albumsEmpty').style.display = 'none';
  $('#albumTitle').textContent = a.name;
  const list = await api.get(`/api/search?album=${id}`);
  photos = list; // v1.2 §3.6.2 详情页复用主相册批量条/灯箱
  renderAlbumGrid(list, id);
  updateBatchBar();
}
// 渲染收藏夹详情网格（openAlbum 与详情页内局部刷新共用）
function renderAlbumGrid(list, id){
  const ag = $('#albumGrid'); ag.innerHTML = '';
  const cards = [];
  list.forEach((p,i)=>{
    const card = createCard(p, i, { albumMode: true, albumId: id });
    ag.appendChild(card);
    cards.push(card);
  });
  // 收藏夹空状态
  const albumEmpty = $('#albumEmpty');
  if (albumEmpty) albumEmpty.style.display = list.length === 0 ? 'flex' : 'none';
  if(window.gsap){ ag.classList.add('masonry'); layoutMasonry(ag, cards); }
  else ag.classList.remove('masonry');
  const newCards = cards.filter(c=>!lastRenderedIds.has(c.dataset.id));
  if (window.UIAnim) window.UIAnim.gridIn(newCards);
  lastRenderedIds = new Set(cards.map(c=>c.dataset.id));
}
// 上下文感知的网格刷新：收藏夹详情页重建 #albumGrid，相册页重建 #grid
function refreshCurrentGrid(){
  if (activeAlbumId) renderAlbumGrid(photos, activeAlbumId);
  else renderGrid();
  updateBatchBar();
}
$('#albumBackBtn').onclick = ()=>{
  activeAlbumId = null;
  $('#albumDetail').hidden = true;
  $('#albumsGrid').style.display = '';
  $('#albumsEmpty').style.display = '';
  loadPhotos();
};
$('#createAlbumBtn').onclick = async ()=>{
  const name = await showInputModal('新建收藏夹', '收藏夹名称', '', '输入收藏夹名称，例如：旅行照片、家庭相册');
  if(!name||!name.trim()) return;
  await api.post('/api/albums', { name: name.trim() });
  logFrontend('info', '创建收藏夹', { name: name.trim() });
  await loadAlbums(); toast('收藏夹已创建 ✓');
};
$('#albumRenameBtn').onclick = async ()=>{
  const a = albums.find(x=>x.id===activeAlbumId); if(!a) return;
  const name = await showInputModal('重命名收藏夹', '新名称', a.name, `当前名称: ${a.name}`);
  if(!name||!name.trim()) return;
  await api.post(`/api/albums/${a.id}/rename`, { name: name.trim() });
  logFrontend('info', '重命名收藏夹', { id: a.id, oldName: a.name, newName: name.trim() });
  await loadAlbums(); openAlbum(a.id); toast('已重命名 ✓');
};
$('#albumDeleteBtn').onclick = async ()=>{
  if(!(await showConfirm('删除收藏夹', '确定删除此收藏夹?(不会删除照片)', { danger: true, confirmText: '删除' }))) return;
  await api.del('/api/albums/'+activeAlbumId);
  activeAlbumId = null; $('#albumDetail').hidden = true;
  $('#albumsGrid').style.display = ''; await loadAlbums(); toast('已删除收藏夹');
};

/* v1.2 §3.6.3 拖拽加入：相册卡片拖到侧边栏"收藏夹" → 选择目标收藏夹 */
const albumsNav = document.querySelector('.nav-item[data-view="albums"]');
if (albumsNav) {
  albumsNav.addEventListener('dragover', e=>{
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    albumsNav.classList.add('drop-target');
  });
  albumsNav.addEventListener('dragleave', ()=>albumsNav.classList.remove('drop-target'));
  albumsNav.addEventListener('drop', async e=>{
    e.preventDefault();
    e.stopPropagation();
    albumsNav.classList.remove('drop-target');
    const photoId = e.dataTransfer && e.dataTransfer.getData('text/plain');
    if (!photoId) return;
    if (!albums.length) { toast('请先创建一个收藏夹', true); return; }
    const options = albums.map(a => ({ label: `${a.name}（${a.count} 张）`, value: a.id }));
    const albumId = await showSelectModal('加入收藏夹', options, '选择要把照片加入的收藏夹');
    if (!albumId) return;
    await api.post(`/api/albums/${albumId}/add`, { ids: [photoId] });
    toast('已加入收藏夹 ✓');
    await loadAlbums();
  });
}

/* ============ 灯箱:幻灯片按钮 ============ */
$('#lbSlideshow').onclick = ()=>{ closeLightbox(); openSlideshow(); };

/* ============ 键盘快捷键(选片/评分/标记/对比) ============ */
// v1.2 §6 附录快捷键总表：单一定义，浮层渲染与实现保持一致
const SHORTCUTS = [
  { group: '全局', items: [
    ['?', '打开/关闭快捷键速查浮层'],
    ['H', '相册视图隐藏/显示排除照片'],
  ]},
  { group: '灯箱', items: [
    ['← →', '上一张 / 下一张'],
    ['Esc', '退出缩放 → 关闭灯箱'],
    ['P R X U', '精选 / 排除 / 排除并跳转 / 清除标记'],
    ['1-5 0', '评分 / 清除评分（配合自动跳转设置）'],
    ['C', '进入并排对比选片'],
  ]},
  { group: '缩放态', items: [
    ['← →', '平移（换图被缩放替代）'],
    ['Esc / 双击', '复位缩放'],
  ]},
  { group: '对比选片', items: [
    ['Tab', '切换标记目标（左/右）'],
    ['← →', '上一组 / 下一组'],
    ['Esc', '退出对比'],
    ['P/R/X/U 1-5 0', '标记/评分当前目标并进下一组'],
  ]},
  { group: '编辑器', items: [
    ['Ctrl+Z / Ctrl+Y', '撤销 / 重做'],
    ['1-5 0 P/R/X/U', '对当前照片评分/标记'],
    ['←↑→↓ / Shift+方向键', '平移裁剪框 1px / 10px'],
    ['[ ] / Shift+[ ]', '缩放裁剪框 1px / 10px'],
  ]},
  { group: '幻灯片', items: [
    ['空格', '暂停 / 继续'],
    ['← → Esc', '上一张 / 下一张 / 退出'],
  ]},
];
function renderShortcuts(q = ''){
  const list = $('#shortcutList');
  list.innerHTML = '';
  const query = q.trim().toLowerCase();
  SHORTCUTS.forEach(g => {
    const items = g.items.filter(([keys, desc]) =>
      !query || keys.toLowerCase().includes(query) || desc.toLowerCase().includes(query));
    if (!items.length) return;
    const group = document.createElement('div');
    group.className = 'shortcut-group';
    group.innerHTML = `<h4>${esc(g.group)}</h4>`;
    items.forEach(([keys, desc]) => {
      const row = document.createElement('div');
      row.className = 'shortcut-item';
      row.innerHTML = `<span class="sc-name">${esc(desc)}</span><span class="shortcut-keys">${keys.split(' ').map(k => `<kbd>${esc(k)}</kbd>`).join('')}</span>`;
      group.appendChild(row);
    });
    list.appendChild(group);
  });
}
function openShortcutModal(){
  renderShortcuts($('#shortcutSearch').value);
  if (window.UIAnim) window.UIAnim.modal($('#shortcutModal'), $('.modal-content', $('#shortcutModal')), true);
  else $('#shortcutModal').hidden = false;
  setTimeout(()=>$('#shortcutSearch').focus(), 50);
}
function closeShortcutModal(){
  if (window.UIAnim) window.UIAnim.modal($('#shortcutModal'), $('.modal-content', $('#shortcutModal')), false);
  else $('#shortcutModal').hidden = true;
}
$('#openShortcuts').onclick = openShortcutModal;
$('#shortcutClose').onclick = closeShortcutModal;
$('#shortcutSearch').addEventListener('input', e => renderShortcuts(e.target.value));
$('#shortcutModal').addEventListener('click', e => { if (e.target === $('#shortcutModal')) closeShortcutModal(); });

// 标记/评分后的自动跳转：对比模式进下一组，灯箱模式进下一张（受设置 autoAdvance 控制）
function afterCullAdvance(){
  if(cmpActive){ afterCullMark(); return; }
  if(lightbox.classList.contains('open') && settings.autoAdvance !== false) navLb(1);
}
function markTarget(flag){
  const id = cmpActive
    ? photos[cmpIdx + cmpSide]?.id
    : lightbox.classList.contains('open')
      ? photos[lbIndex]?.id
      : current ? current.id : null;
  if(id){ setFlag(id, flag); afterCullAdvance(); }
}
function rateTarget(stars){
  const id = cmpActive
    ? photos[cmpIdx + cmpSide]?.id
    : lightbox.classList.contains('open')
      ? photos[lbIndex]?.id
      : current ? current.id : null;
  if(id){ setStars(id, stars); afterCullAdvance(); }
}
document.addEventListener('keydown', e=>{
  const k = e.key;
  // 快捷键浮层：Esc / ? 关闭（优先于输入框守卫）
  if (!$('#shortcutModal').hidden && (k === 'Escape' || k === '?')) { closeShortcutModal(); return; }
  const tgt = e.target;
  if(tgt && typeof tgt.matches === 'function' && tgt.matches('input,textarea,select')) return;
  if(k === '?'){ e.preventDefault(); openShortcutModal(); return; }
  const editorActive = document.querySelector('.view[data-view="editor"].active');
  const lbOpen = lightbox.classList.contains('open');

  // 编辑器撤销/重做
  if(editorActive && (e.ctrlKey || e.metaKey)){
    if(k === 'z' && !e.shiftKey){ e.preventDefault(); undo(); return; }
    if((k === 'y' || (k === 'z' && e.shiftKey))){ e.preventDefault(); redo(); return; }
  }

  // 对比选片模式（优先级最高）
  if(cmpActive){
    if(k==='Escape'){ closeCompare(); return; }
    if(k==='Tab'){ e.preventDefault(); cmpSide = 1 - cmpSide; updateCompareSide(); return; }
    if(k==='ArrowLeft' || k==='ArrowRight'){
      e.preventDefault();
      cmpIdx = Math.max(0, Math.min(cmpIdx + (k==='ArrowRight' ? 1 : -1), photos.length - 2));
      updateCompare();
      return;
    }
    const id = photos[cmpIdx + cmpSide]?.id;
    if(k>='1' && k<='5'){ if(id) setStars(id, +k); afterCullMark(); return; }
    if(k==='0'){ if(id) setStars(id, 0); afterCullMark(); return; }
    if(k==='p' || k==='P'){ if(id) setFlag(id, 'pick'); afterCullMark(); return; }
    if(k==='r' || k==='R' || k==='x' || k==='X'){ if(id) setFlag(id, 'reject'); afterCullMark(); return; }
    if(k==='u' || k==='U'){ if(id) setFlag(id, null); afterCullMark(); return; }
    return;
  }

  // 灯箱：C 进入对比，评分/标记后自动跳转下一张
  if(lbOpen){
    if(k==='Escape'){ if(lbZoom !== 1) resetLbZoom(); else closeLightbox(); return; }
    if(k==='c' || k==='C'){ e.preventDefault(); if(photos.length > 1) openCompare(); return; }
    // v1.2 §3.2.4 缩放态：←/→ 平移（换图被缩放替代），选片键仍生效
    if(lbZoom !== 1){
      if(k==='ArrowLeft'){ e.preventDefault(); lbPanX -= 40; clampLbPan(); applyLbZoom(); return; }
      if(k==='ArrowRight'){ e.preventDefault(); lbPanX += 40; clampLbPan(); applyLbZoom(); return; }
    }
    if(k==='ArrowLeft'){ navLb(-1); return; }
    if(k==='ArrowRight'){ navLb(1); return; }
    if(k==='p' || k==='P'){ markTarget('pick'); return; }
    if(k==='r' || k==='R' || k==='x' || k==='X'){ markTarget('reject'); return; }
    if(k==='u' || k==='U'){ markTarget(null); return; }
    if(k>='1' && k<='5'){ rateTarget(+k); return; }
    if(k==='0'){ rateTarget(0); return; }
    return;
  }

  // 编辑器：评分/标记作用于当前照片（不自动跳转）
  if(editorActive){
    // v1.2 §3.4.5 裁剪框键盘微调（仅裁剪模式，焦点不在输入框时）
    if(cropping){
      const step = e.shiftKey ? 10 : 1;
      if(k==='ArrowLeft'){ e.preventDefault(); moveCropBox(-step,0); return; }
      if(k==='ArrowRight'){ e.preventDefault(); moveCropBox(step,0); return; }
      if(k==='ArrowUp'){ e.preventDefault(); moveCropBox(0,-step); return; }
      if(k==='ArrowDown'){ e.preventDefault(); moveCropBox(0,step); return; }
      if(k==='['){ e.preventDefault(); resizeCropBoxBy(-step); return; }
      if(k===']'){ e.preventDefault(); resizeCropBoxBy(step); return; }
    }
    if(k>='1' && k<='5'){ if(current) setStars(current.id, +k); return; }
    if(k==='0'){ if(current) setStars(current.id, 0); return; }
    if(k==='p' || k==='P'){ if(current) setFlag(current.id, 'pick'); return; }
    if(k==='r' || k==='R' || k==='x' || k==='X'){ if(current) setFlag(current.id, 'reject'); return; }
    if(k==='u' || k==='U'){ if(current) setFlag(current.id, null); return; }
    return;
  }

  // 相册视图：H 隐藏排除，评分/标记作用于灯箱索引（若曾打开）
  if(k==='h' || k==='H'){
    hideReject = !hideReject;
    $('#hideRejectBtn').classList.toggle('active', hideReject);
    loadPhotos();
    return;
  }
  const gridId = lbIndex >= 0 ? photos[lbIndex]?.id : null;
  if(k>='1' && k<='5'){ if(gridId) setStars(gridId, +k); return; }
  if(k==='0'){ if(gridId) setStars(gridId, 0); return; }
  if(k==='p' || k==='P'){ if(gridId) setFlag(gridId, 'pick'); return; }
  if(k==='r' || k==='R' || k==='x' || k==='X'){ if(gridId) setFlag(gridId, 'reject'); return; }
  if(k==='u' || k==='U'){ if(gridId) setFlag(gridId, null); return; }
  // 空格:幻灯片(相册视图)
  if(k===' ' && !$('#slideshow').hidden){ e.preventDefault(); slPlay(); return; }
  if(!$('#slideshow').hidden){
    if(k==='ArrowLeft') $('#slPrev').click();
    if(k==='ArrowRight') $('#slNext').click();
    if(k==='Escape') $('#slExit').click();
  }
});

/* ============ 日志系统 ============ */
let logsRefreshTimer = null;
let logsAutoRefresh = true;

async function loadLogs(){
  try {
    const level = $('#logsLevelFilter')?.value || '';
    const source = $('#logsSourceFilter')?.value || '';
    const params = new URLSearchParams();
    params.set('limit', '200');
    if (level) params.set('level', level);
    if (source) params.set('source', source);

    const data = await api.get(`/api/logs?${params.toString()}`);

    // 更新路径信息
    if ($('#logsPath')) $('#logsPath').textContent = data.logDir || '—';
    if ($('#logsCount')) $('#logsCount').textContent = data.total || 0;

    const tbody = $('#logsTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!data.logs || data.logs.length === 0) {
      const empty = $('#logsEmpty');
      if (empty) empty.style.display = 'block';
      return;
    }
    { const empty = $('#logsEmpty'); if (empty) empty.style.display = 'none'; }

    data.logs.forEach(log => {
      const lvl = (log.level || 'info').toLowerCase();
      const tr = document.createElement('tr');
      tr.className = `log-row log-${lvl}`;

      const timeTd = document.createElement('td');
      timeTd.textContent = log.time || '—';
      timeTd.style.fontFamily = 'monospace';
      timeTd.style.fontSize = '12px';

      const levelTd = document.createElement('td');
      const levelBadge = document.createElement('span');
      levelBadge.className = `log-badge log-badge-${lvl}`;
      levelBadge.textContent = log.level || 'INFO';
      levelTd.appendChild(levelBadge);

      const sourceTd = document.createElement('td');
      const sourceSpan = document.createElement('span');
      sourceSpan.className = 'log-source';
      sourceSpan.textContent = log.source || '—';
      sourceTd.appendChild(sourceSpan);

      const msgTd = document.createElement('td');
      msgTd.textContent = log.message || '—';
      msgTd.style.wordBreak = 'break-word';

      const dataTd = document.createElement('td');
      dataTd.className = 'data-cell';
      if (log.data) {
        const pre = document.createElement('pre');
        pre.style.fontSize = '11px';
        pre.style.margin = '0';
        pre.style.maxHeight = '60px';
        pre.style.overflow = 'hidden';
        pre.textContent = typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2);
        dataTd.appendChild(pre);
      } else {
        dataTd.textContent = '—';
        dataTd.style.color = '#888';
      }
      // v1.2 §3.8 行尾复制按钮
      const copyBtn = document.createElement('button');
      copyBtn.className = 'log-copy';
      copyBtn.textContent = '⧉';
      copyBtn.title = '复制此行';
      copyBtn.onclick = e=>{
        e.stopPropagation();
        const line = `[${log.time || ''}][${log.level || 'INFO'}][${log.source || ''}] ${log.message || ''}` +
          (log.data ? '\n' + (typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)) : '');
        copyText(line);
        toast('已复制日志行');
      };
      dataTd.appendChild(copyBtn);

      tr.appendChild(timeTd);
      tr.appendChild(levelTd);
      tr.appendChild(sourceTd);
      tr.appendChild(msgTd);
      tr.appendChild(dataTd);
      // v1.2 §3.8 点击行展开/收起详情
      tr.addEventListener('click', ()=>tr.classList.toggle('expanded'));
      tbody.appendChild(tr);
    });
    applyLogSearch();

    // 自动滚动到顶部（最新日志在最上方）
    const wrap = $('.logs-table-wrap');
    if (wrap) wrap.scrollTop = 0;

  } catch (e) {
    console.error('加载日志失败:', e);
    logFrontend('error', '加载日志失败', { error: e.message });
  }
}

// v1.2 §3.8 日志搜索框：纯前端过滤当前已加载行（消息/详情，大小写不敏感）
function applyLogSearch(){
  const input = $('#logsSearch');
  const q = (input ? input.value : '').trim().toLowerCase();
  $$('#logsTableBody tr').forEach(tr=>{
    tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

// 前端日志记录函数（发送到后端）
async function logFrontend(level, message, data = null) {
  try {
    // 同时输出到控制台
    const now = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
    const consoleMsg = `[${ts}] [${level.toUpperCase()}] [frontend] ${message}`;
    if (level === 'error') console.error(consoleMsg, data);
    else if (level === 'warn') console.warn(consoleMsg, data);
    else console.log(consoleMsg, data);

    // 发送到后端记录
    await fetch('/api/logs/frontend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authToken ? {'X-Luma-Token': authToken} : {}) },
      body: JSON.stringify({ level, message, data })
    }).catch(() => {}); // 静默失败，不影响主流程
  } catch (e) {
    // 静默处理
  }
}

// 绑定日志过滤器
function bindLogFilters(){
  const levelFilter = $('#logsLevelFilter');
  const sourceFilter = $('#logsSourceFilter');
  const refreshBtn = $('#logsRefreshBtn');
  const clearBtn = $('#logsClearBtn');

  if (levelFilter) {
    levelFilter.onchange = () => {
      if (document.querySelector('.view[data-view="logs"].active')) {
        loadLogs();
      }
    };
  }

  if (sourceFilter) {
    sourceFilter.onchange = () => {
      if (document.querySelector('.view[data-view="logs"].active')) {
        loadLogs();
      }
    };
  }

  if (refreshBtn) {
    refreshBtn.onclick = () => loadLogs();
  }

  const pauseBtn = $('#logsPauseBtn');
  if (pauseBtn) {
    pauseBtn.onclick = () => {
      logsAutoRefresh = !logsAutoRefresh;
      pauseBtn.classList.toggle('active', !logsAutoRefresh);
      pauseBtn.textContent = logsAutoRefresh ? '⏸ 暂停' : '▶ 已暂停';
    };
  }

  const search = $('#logsSearch');
  if (search) search.addEventListener('input', applyLogSearch);

  if (clearBtn) {
    clearBtn.onclick = async () => {
      if (!(await showConfirm('清空日志', '确定清空所有日志？此操作不可恢复。', { danger: true, confirmText: '清空' }))) return;
      try {
        await api.post('/api/logs/clear', {});
        toast('日志已清空');
        loadLogs();
        logFrontend('info', '用户清空了日志');
      } catch (e) {
        toast('清空失败: ' + e.message);
      }
    };
  }
}

// 自动刷新日志（当日志页面激活时）；间隔由设置 logsRefreshInterval 控制（v1.2.1）
function startLogsAutoRefresh(){
  if (logsRefreshTimer) clearInterval(logsRefreshTimer);
  const intervalMs = (settings.logsRefreshInterval || 3) * 1000;
  logsRefreshTimer = setInterval(() => {
    const logsView = document.querySelector('.view[data-view="logs"].active');
    if (logsView && logsAutoRefresh) {
      loadLogs();
    }
  }, intervalMs);
}

function stopLogsAutoRefresh(){
  if (logsRefreshTimer) {
    clearInterval(logsRefreshTimer);
    logsRefreshTimer = null;
  }
}

/* ============ 通用模态输入框 ============ */
function showInputModal(title, placeholder = '', defaultValue = '', hint = '') {
  return new Promise((resolve) => {
    const modal = $('#inputModal');
    const titleEl = $('#inputModalTitle');
    const field = $('#inputModalField');
    const hintEl = $('#inputModalHint');
    const cancelBtn = $('#inputModalCancel');
    const confirmBtn = $('#inputModalConfirm');

    if (!modal || !field) {
      // 降级到 prompt
      const val = prompt(title, defaultValue);
      resolve(val);
      return;
    }

    titleEl.textContent = title;
    field.placeholder = placeholder;
    field.value = defaultValue;
    hintEl.textContent = hint;

    if (window.UIAnim) window.UIAnim.modal(modal, $('.modal-content', modal), true);
    else modal.hidden = false;
    field.focus();
    field.select();

    const cleanup = (value) => {
      if (window.UIAnim) window.UIAnim.modal(modal, $('.modal-content', modal), false);
      else modal.hidden = true;
      cancelBtn.onclick = null;
      confirmBtn.onclick = null;
      field.onkeydown = null;
      resolve(value);
    };

    cancelBtn.onclick = () => cleanup(null);
    confirmBtn.onclick = () => {
      const val = field.value.trim();
      cleanup(val || null);
    };

    field.onkeydown = (e) => {
      if (e.key === 'Enter') {
        const val = field.value.trim();
        cleanup(val || null);
      }
      if (e.key === 'Escape') {
        cleanup(null);
      }
    };
  });
}

// 通用选择模态框：options = [{ label, value }]，点击选项返回 value，取消返回 null
function showSelectModal(title, options = [], hint = '') {
  return new Promise((resolve) => {
    const modal = $('#selectModal');
    const box = $('#selectOptions');
    if (!modal || !box || !options.length) {
      resolve(null);
      return;
    }
    $('#selectModalTitle').textContent = title;
    $('#selectModalHint').textContent = hint;
    box.innerHTML = '';

    options.forEach(o => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'select-option';
      b.textContent = o.label;
      b.onclick = () => cleanup(o.value);
      box.appendChild(b);
    });

    if (window.UIAnim) window.UIAnim.modal(modal, $('.modal-content', modal), true);
    else modal.hidden = false;

    const cleanup = (value) => {
      if (window.UIAnim) window.UIAnim.modal(modal, $('.modal-content', modal), false);
      else modal.hidden = true;
      $('#selectModalCancel').onclick = null;
      box.innerHTML = '';
      resolve(value);
    };
    $('#selectModalCancel').onclick = () => cleanup(null);
  });
}

/* ============ 启动 ============ */
(async function init(){
  authToken = await initAuthToken();
  await loadSettings();
  await loadPhotos();
  await loadAlbums();
  bindLogFilters();
  startLogsAutoRefresh();
  // 记录启动日志
  logFrontend('info', '应用启动完成');
  // 检查 OOBE 状态
  await checkAndShowOOBE();
})();

/* ============ OOBE 首次使用向导 ============ */
let oobeCurrentStep = 1;

async function checkAndShowOOBE(){
  try {
    const res = await api.get('/api/oobe/status');
    if(!res.completed){
      showOOBE();
    }
  } catch(e){
    console.error('OOBE 状态检查失败:', e);
  }
}

function showOOBE(){
  const modal = $('#oobeModal');
  if(!modal) return;
  oobeCurrentStep = 1;
  updateOOBEStep();
  modal.hidden = false;
}

// v1.2 §3.9 步骤动画：下一步/上一步内容按方向滑入（reduced-motion 瞬时）
function updateOOBEStep(dir = 1){
  const pages = $$('.oobe-page');
  const steps = $$('.oobe-step');
  const prevBtn = $('#oobePrev');
  const nextBtn = $('#oobeNext');
  const currentPage = pages.find(p => !p.hidden) || pages[0];
  const target = pages[oobeCurrentStep - 1];
  const finish = () => {
    currentPage.hidden = true;
    target.hidden = false;
    if (window.gsap && window.UIAnim && !window.UIAnim.reduce) {
      gsap.fromTo(target, { x: 18 * dir, autoAlpha: 0 },
        { x: 0, autoAlpha: 1, duration: 0.28, ease: 'power2.out' });
    }
    updateOOBESteps(steps, prevBtn, nextBtn);
  };
  if (target && target !== currentPage && window.gsap && window.UIAnim && !window.UIAnim.reduce) {
    gsap.to(currentPage, { x: -18 * dir, autoAlpha: 0, duration: 0.14, ease: 'power1.in', onComplete: finish });
  } else if (target) {
    finish();
  } else {
    updateOOBESteps(steps, prevBtn, nextBtn);
  }
}
function updateOOBESteps(steps, prevBtn, nextBtn){
  steps.forEach((s, i) => {
    s.classList.toggle('active', (i + 1) <= oobeCurrentStep);
  });

  prevBtn.disabled = oobeCurrentStep === 1;
  nextBtn.textContent = oobeCurrentStep === 4 ? '开始使用' : '下一步';
}

async function completeOOBE(){
  try {
    await api.post('/api/oobe/complete');
    $('#oobeModal').hidden = true;
    toast('欢迎使用光影工作室！');
    logFrontend('info', 'OOBE 向导完成');
  } catch(e){
    console.error('OOBE 完成失败:', e);
    toast('保存失败', true);
  }
}

// OOBE 按钮绑定
$('#oobeSkip')?.addEventListener('click', completeOOBE);
$('#oobePrev')?.addEventListener('click', () => {
  if(oobeCurrentStep > 1){
    oobeCurrentStep--;
    updateOOBEStep(-1);
  }
});
$('#oobeNext')?.addEventListener('click', () => {
  if(oobeCurrentStep < 4){
    oobeCurrentStep++;
    updateOOBEStep(1);
  } else {
    completeOOBE();
  }
});

// 设置页：重置首次使用向导
$('#resetOOBE')?.addEventListener('click', async () => {
  try {
    await api.post('/api/oobe/reset');
    toast('首次使用向导已重置，下次启动将重新显示');
    logFrontend('info', 'OOBE 已重置');
  } catch(e){
    console.error('OOBE 重置失败:', e);
    toast('重置失败', true);
  }
});
