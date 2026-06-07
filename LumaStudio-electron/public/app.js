/* ============ 工具 ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = {
  async get(u){ const r = await fetch(u); return r.json(); },
  async post(u, b){ const r = await fetch(u, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}); return r.json(); },
  async del(u){ const r = await fetch(u, {method:'DELETE'}); return r.json(); },
};
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
function toast(msg, err=false){
  const t = $('#toast'); t.textContent = msg;
  t.className = 'toast show' + (err?' err':'');
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>t.className='toast', 2400);
}
function showLoading(){ $('#loadingOverlay').classList.add('show'); }
function hideLoading(){ $('#loadingOverlay').classList.remove('show'); }

/* ============ 状态 ============ */
let photos = [];
let current = null;   // 正在编辑/查看的照片
let lbIndex = -1;
let settings = {};
let selected = new Set(); // 多选照片 ID 集合
let albums = [];
let activeAlbumId = null; // 正在浏览的相册
let slTimer = null; // 幻灯片定时器

/* ============ 视图切换 ============ */
function switchView(name){
  $$('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.view===name));
  $$('.view').forEach(v=>v.classList.toggle('active', v.dataset.view===name));
  $('.stage').scrollTop = 0;
  if(name==='settings') loadStats();
  if(name==='about') loadAbout();
  if(name==='albums'){ activeAlbumId=null; $('#albumDetail').hidden=true; $('#albumsGrid').style.display=''; loadAlbums(); }
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
$$('.nav-item').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$$('[data-goto]').forEach(b=>b.onclick=()=>switchView(b.dataset.goto));

/* ============ 相册 ============ */
const grid = $('#grid'), emptyState = $('#emptyState');

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
  photos = await api.get('/api/search?'+params);
  renderGrid();
  updateBatchBar();
  $('#storageMini').textContent = `${photos.length} 张照片`;
}
async function loadAlbums(){
  albums = await api.get('/api/albums');
  renderAlbums();
}

function renderGrid(){
  grid.innerHTML = '';
  emptyState.classList.toggle('show', photos.length===0);
  photos.forEach((p,i)=>{
    const card = document.createElement('div');
    card.className = 'card' + (selected.has(p.id) ? ' selected' : '');
    card.dataset.id = p.id;
    card.style.animationDelay = (i*0.035)+'s';
    const starStr = p.stars > 0 ? '★'.repeat(p.stars) + '☆'.repeat(5-p.stars) : '';
    const flagHtml = p.flag === 'pick' ? '<div class="flag-badge pick show">精选</div>'
                   : p.flag === 'reject' ? '<div class="flag-badge reject show">排除</div>'
                   : '';
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
        <button class="mini del" title="删除">✕</button>
      </div>
      <div class="meta">${esc(p.name)} · ${fmtSize(p.size)}</div>`;
    // 选中:点复选框
    card.querySelector('.sel-check').onclick = e=>{ e.stopPropagation(); toggleSelect(p.id, card); };
    // 灯箱:点图片(非复选框区域)
    card.querySelector('img').onclick = ()=>openLightbox(i);
    card.querySelector('.edit').onclick = e=>{e.stopPropagation(); openEditor(p);};
    card.querySelector('.info').onclick = e=>{e.stopPropagation(); openExif(p);};
    card.querySelector('.dl').onclick = e=>{e.stopPropagation(); downloadPhoto(p);};
    card.querySelector('.del').onclick = e=>{e.stopPropagation(); delPhoto(p, card);};
    grid.appendChild(card);
  });
}

async function delPhoto(p, card){
  card.classList.add('removing');
  await new Promise(r=>setTimeout(r,320));
  await api.del('/api/photos/'+p.id);
  photos = photos.filter(x=>x.id!==p.id);
  renderGrid();
  $('#storageMini').textContent = `${photos.length} 张照片`;
  toast('已删除');
}

/* ---- 上传 ---- */
const fileInput = $('#fileInput'), dropzone = $('#dropzone');
$('#uploadBtn').onclick = ()=>fileInput.click();
dropzone.onclick = ()=>fileInput.click();
fileInput.onchange = e=>{ uploadFiles(e.target.files); fileInput.value=''; };

['dragenter','dragover'].forEach(ev=>dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.add('drag')}));
['dragleave','drop'].forEach(ev=>dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.remove('drag')}));
dropzone.addEventListener('drop',e=>uploadFiles(e.dataTransfer.files));
window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('drop',e=>e.preventDefault());

async function uploadFiles(list){
  const files = [...list].filter(f=>f.type.startsWith('image/'));
  if(!files.length){ toast('请选择图片文件', true); return; }
  const fd = new FormData();
  files.forEach(f=>fd.append('photos', f));
  const bar = $('#uploadProgress .bar');
  bar.style.width='15%';
  try{
    const xhr = new XMLHttpRequest();
    xhr.open('POST','/api/upload');
    xhr.upload.onprogress = e=>{ if(e.lengthComputable) bar.style.width = (e.loaded/e.total*90+5)+'%'; };
    xhr.onload = async ()=>{
      bar.style.width='100%';
      setTimeout(()=>bar.style.width='0', 500);
      await loadPhotos();
      toast(`已上传 ${files.length} 张照片 ✓`);
    };
    xhr.onerror = ()=>{ toast('上传失败', true); bar.style.width='0'; };
    xhr.send(fd);
  }catch(e){ toast('上传失败:'+e.message, true); }
}

$('#clearAllBtn').onclick = $('#clearStorage').onclick = async ()=>{
  if(!photos.length) return;
  if(!confirm('确定清空全部照片?此操作不可恢复。')) return;
  await api.del('/api/photos');
  photos = []; renderGrid(); loadStats();
  $('#storageMini').textContent = '0 张照片';
  toast('已清空');
};

/* ============ 灯箱 ============ */
const lightbox = $('#lightbox');
function openLightbox(i){
  lbIndex = i; const p = photos[i];
  $('#lbImg').src = '/files/'+p.file+'?v='+p.time;
  $('#lbCap').textContent = `${p.name} · ${p.width}×${p.height} · ${fmtSize(p.size)}`;
  lightbox.classList.add('open');
}
function closeLightbox(){ lightbox.classList.remove('open'); }
function navLb(d){
  if(!photos.length) return;
  lbIndex = (lbIndex+d+photos.length)%photos.length;
  const p = photos[lbIndex], img = $('#lbImg');
  img.style.opacity='0';
  setTimeout(()=>{ img.src='/files/'+p.file+'?v='+p.time; $('#lbCap').textContent=`${p.name} · ${p.width}×${p.height} · ${fmtSize(p.size)}`; img.style.opacity='1'; },150);
}
$('#lbClose').onclick = closeLightbox;
$('#lbPrev').onclick = ()=>navLb(-1);
$('#lbNext').onclick = ()=>navLb(1);
$('#lbEdit').onclick = ()=>{ closeLightbox(); openEditor(photos[lbIndex]); };
$('#lbInfo').onclick = ()=>{ closeLightbox(); openExif(photos[lbIndex]); };
$('#lbDownload').onclick = ()=>{ if(photos[lbIndex]) downloadPhoto(photos[lbIndex]); };
$('#lbRename').onclick = async ()=>{
  const p = photos[lbIndex]; if(!p) return;
  const name = prompt('重命名照片', p.name);
  if(name == null) return;
  const trimmed = name.trim();
  if(!trimmed){ toast('名称不能为空', true); return; }
  const r = await api.post(`/api/photos/${p.id}/rename`, { name: trimmed });
  if(r.ok){ p.name = r.photo.name; $('#lbCap').textContent=`${p.name} · ${p.width}×${p.height} · ${fmtSize(p.size)}`; await loadPhotos(); toast('已重命名 ✓'); }
  else toast(r.error||'重命名失败', true);
};
lightbox.addEventListener('click',e=>{ if(e.target===lightbox) closeLightbox(); });
document.addEventListener('keydown',e=>{
  if(!lightbox.classList.contains('open')) return;
  if(e.key==='Escape') closeLightbox();
  if(e.key==='ArrowLeft') navLb(-1);
  if(e.key==='ArrowRight') navLb(1);
});

/* ============ 编辑器 ============ */
const editImg = $('#editImg');
let edit = null; // 当前编辑参数
let undoStack = []; // 撤销栈
let redoStack = []; // 重做栈

function defaultEdit(){
  return { brightness:100,contrast:100,saturation:100,hue:0,sharpen:0,blur:0,grayscale:false,
    rotate:0, flipH:false, flipV:false, crop:null };
}

function saveEditState(){
  undoStack.push(JSON.parse(JSON.stringify(edit)));
  redoStack = [];
}

function undo(){
  if(undoStack.length === 0) return;
  redoStack.push(JSON.parse(JSON.stringify(edit)));
  edit = undoStack.pop();
  applyEditState();
}

function redo(){
  if(redoStack.length === 0) return;
  undoStack.push(JSON.parse(JSON.stringify(edit)));
  edit = redoStack.pop();
  applyEditState();
}

function applyEditState(){
  $('#brightness').value = edit.brightness;
  $('#contrast').value = edit.contrast;
  $('#saturation').value = edit.saturation;
  $('#hue').value = edit.hue;
  $('#sharpen').value = edit.sharpen;
  $('#blur').value = edit.blur;
  $('#grayscale').checked = edit.grayscale;
  updateSliderLabels();
  applyFilter();
}

function openEditor(p){
  current = p;
  edit = defaultEdit();
  undoStack = [];
  redoStack = [];
  switchView('editor');
  $('#editorEmpty').classList.remove('show');
  $('#editorWrap').classList.remove('hidden');
  editImg.src = '/files/'+p.file + '?t=' + Date.now();
  $('#editName').textContent = p.name;
  $('#editDims').textContent = `${p.width}×${p.height}`;
  $('#origDims').textContent = `${p.width}×${p.height}`;
  $('#reW').value = p.width; $('#reH').value = p.height;
  resetSliders();
  setActivePreset('none');
  $('#outFormat').value = settings.defaultFormat || 'jpeg';
  $('#quality').value = settings.defaultQuality || 82;
  $('#vQuality').textContent = $('#quality').value+'%';
  applyFilter();
  estimateSize();
}

function resetSliders(){
  $('#brightness').value=100; $('#contrast').value=100; $('#saturation').value=100;
  $('#hue').value=0; $('#sharpen').value=0; $('#blur').value=0; $('#grayscale').checked=false;
  updateSliderLabels();
}
function updateSliderLabels(){
  $('#vBrightness').textContent=$('#brightness').value+'%';
  $('#vContrast').textContent=$('#contrast').value+'%';
  $('#vSaturation').textContent=$('#saturation').value+'%';
  $('#vHue').textContent=$('#hue').value+'°';
  $('#vSharpen').textContent=$('#sharpen').value;
  $('#vBlur').textContent=$('#blur').value;
}

// 实时 CSS 滤镜预览(裁剪/旋转由 transform 体现)
function applyFilter(){
  const b=$('#brightness').value/100, c=$('#contrast').value/100, s=$('#saturation').value/100;
  const h=$('#hue').value, bl=$('#blur').value/4, gray=$('#grayscale').checked?1:0;
  let f = `brightness(${b}) contrast(${c}) saturate(${s}) hue-rotate(${h}deg) grayscale(${gray})`;
  if(bl>0) f += ` blur(${bl}px)`;
  editImg.style.filter = f;
  const tr = [];
  if(edit.rotate) tr.push(`rotate(${edit.rotate}deg)`);
  if(edit.flipH) tr.push('scaleX(-1)');
  if(edit.flipV) tr.push('scaleY(-1)');
  editImg.style.transform = tr.join(' ');
}

// 调整面板事件
['brightness','contrast','saturation','hue','sharpen','blur'].forEach(id=>{
  $('#'+id).addEventListener('input',()=>{ saveEditState(); updateSliderLabels(); applyFilter(); });
});
$('#grayscale').addEventListener('change',()=>{ saveEditState(); applyFilter(); });
$('#resetAdjust').onclick = ()=>{
  edit = defaultEdit();
  resetSliders();
  if(current){ $('#reW').value = current.width; $('#reH').value = current.height; }
  setActivePreset('none');
  applyFilter();
  toast('已重置全部');
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
  $('#brightness').value=p.brightness; $('#contrast').value=p.contrast;
  $('#saturation').value=p.saturation; $('#hue').value=p.hue; $('#grayscale').checked=p.grayscale;
  updateSliderLabels(); applyFilter(); setActivePreset(c.dataset.preset);
  estimateSize();
});

// 面板 tab
$$('.ptab').forEach(t=>t.onclick=()=>{
  $$('.ptab').forEach(x=>x.classList.toggle('active', x===t));
  $$('.ptab-panel').forEach(p=>p.classList.toggle('active', p.dataset.ptab===t.dataset.ptab));
});

// 变换
$('#rotL').onclick = ()=>{ saveEditState(); edit.rotate=(edit.rotate-90)%360; applyFilter(); };
$('#rotR').onclick = ()=>{ saveEditState(); edit.rotate=(edit.rotate+90)%360; applyFilter(); };
$('#flipH').onclick = ()=>{ saveEditState(); edit.flipH=!edit.flipH; applyFilter(); };
$('#flipV').onclick = ()=>{ saveEditState(); edit.flipV=!edit.flipV; applyFilter(); };

$('#reW').addEventListener('input',()=>{
  if($('#lockRatio').checked && current){ $('#reH').value = Math.round($('#reW').value / current.width * current.height); }
});
$('#reH').addEventListener('input',()=>{
  if($('#lockRatio').checked && current){ $('#reW').value = Math.round($('#reH').value / current.height * current.width); }
});
$$('[data-scale]').forEach(b=>b.onclick=()=>{
  if(!current) return;
  const s = parseFloat(b.dataset.scale);
  $('#reW').value = Math.round(current.width*s);
  $('#reH').value = Math.round(current.height*s);
  toast(`尺寸设为 ${Math.round(s*100)}%`);
});

// 质量/格式 → 预估
$('#quality').addEventListener('input',()=>{ $('#vQuality').textContent=$('#quality').value+'%'; estimateSize(); });
$('#outFormat').addEventListener('change', estimateSize);
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
  initCropBox();
});

function initCropBox(){
  const r = editImg.getBoundingClientRect();
  const stage = $('#canvasStage').getBoundingClientRect();
  let w = r.width*0.7, h = r.height*0.7;
  if(cropRatio!=='free'){ const ratio=parseFloat(cropRatio); if(w/h>ratio) w=h*ratio; else h=w/ratio; }
  const left = (r.left-stage.left)+(r.width-w)/2;
  const top = (r.top-stage.top)+(r.height-h)/2;
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
  Object.assign(cropBox.style,{left:l+'px',top:t+'px',width:w+'px',height:h+'px'});
});
cropBox.addEventListener('pointerup',()=>cropDrag=null);

$('#applyCrop').onclick = ()=>{
  const imgR = editImg.getBoundingClientRect();
  const boxR = cropBox.getBoundingClientRect();
  const scaleX = current.width / imgR.width;
  const scaleY = current.height / imgR.height;
  edit.crop = {
    left: Math.max(0,(boxR.left-imgR.left)*scaleX),
    top: Math.max(0,(boxR.top-imgR.top)*scaleY),
    width: Math.min(current.width, boxR.width*scaleX),
    height: Math.min(current.height, boxR.height*scaleY),
  };
  cropping=false; cropOverlay.hidden=true; $('#cropRatios').hidden=true; $('#applyCrop').hidden=true;
  $('#cropToggle').textContent='✂ 开启裁剪';
  toast(`已标记裁剪 ${Math.round(edit.crop.width)}×${Math.round(edit.crop.height)}`);
};

/* ---- 导出 ---- */
$('#exportBtn').onclick = async ()=>{
  if(!current) return;
  const btn = $('#exportBtn'); btn.disabled=true; btn.textContent='处理中…';
  showLoading();
  const body = buildEditBody($('#overwrite').checked ? 'overwrite' : 'copy');
  try{
    const r = await api.post(`/api/photos/${current.id}/process`, body);
    if(r.ok){
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
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
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
    adjust:{
      brightness:$('#brightness').value/100,
      saturation:$('#saturation').value/100,
      hue:+$('#hue').value,
      contrast:$('#contrast').value/100,
      sharpen:+$('#sharpen').value,
      blur:+$('#blur').value,
      grayscale:$('#grayscale').checked,
    },
    transform:{ rotate:edit.rotate, flipH:edit.flipH, flipV:edit.flipV, crop:edit.crop },
    resize:{ width:+$('#reW').value, height:+$('#reH').value },
    output:{ format:$('#outFormat').value, quality:+$('#quality').value },
    mode,
  };
}

// 双击编辑器底部文件名可重命名
$('#editName').title = '双击重命名';
$('#editName').style.cursor = 'pointer';
$('#editName').ondblclick = async ()=>{
  if(!current) return;
  const name = prompt('重命名照片', current.name);
  if(name == null) return;
  const trimmed = name.trim();
  if(!trimmed){ toast('名称不能为空', true); return; }
  const r = await api.post(`/api/photos/${current.id}/rename`, { name: trimmed });
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
  switchView('exif');
  $('#exifEmpty').classList.remove('show');
  $('#exifWrap').classList.remove('hidden');
  $('#exifImg').src = '/files/'+p.file + '?t='+Date.now();
  const list = $('#exifList'); list.innerHTML = '<div class="exif-empty-row">读取中…</div>';
  const r = await api.get(`/api/photos/${p.id}/exif`);
  const ex = r.exif || {};
  // 基本信息总是显示
  const rows = [
    ['文件名', p.name], ['格式', (p.format||'').toUpperCase()],
    ['分辨率', `${p.width} × ${p.height}`], ['文件大小', fmtSize(p.size)],
  ];
  const map = {
    Make:'相机品牌', Model:'相机型号', LensModel:'镜头', FNumber:'光圈', ExposureTime:'快门',
    ISO:'ISO', FocalLength:'焦距', DateTimeOriginal:'拍摄时间', Artist:'作者', Copyright:'版权',
    ImageDescription:'描述', Software:'软件', Orientation:'方向',
    latitude:'纬度', longitude:'经度',
  };
  for(const [k,label] of Object.entries(map)){
    if(ex[k]!=null && ex[k]!==''){
      let v = ex[k];
      if(k==='FNumber') v='f/'+v;
      if(k==='ExposureTime') v=v<=1?`1/${Math.round(1/v)}s`:v+'s';
      if(k==='FocalLength') v=v+'mm';
      if(v instanceof Date) v=v.toLocaleString('zh-CN');
      rows.push([label, String(v)]);
    }
  }
  list.innerHTML = rows.map(([k,v])=>`<div class="exif-item"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('');
  // 填充可编辑字段
  $('#exArtist').value = ex.Artist||'';
  $('#exCopyright').value = ex.Copyright||'';
  $('#exDesc').value = ex.ImageDescription||'';
  $('#exDate').value = ex.DateTimeOriginal ? formatExifDate(ex.DateTimeOriginal) : '';
}
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
  if(!confirm('确定抹除全部元数据?(将清除相机、GPS、作者等信息)')) return;
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
async function loadSettings(){
  settings = await api.get('/api/settings');
  $('#setFormat').value = settings.defaultFormat;
  $('#setQuality').value = settings.defaultQuality;
  $('#vSetQuality').textContent = settings.defaultQuality+'%';
  $('#setThumb').value = settings.thumbSize;
  $('#setAccent').value = settings.accent;
  applyAccent(settings.accent);
  // 色板
  const sw = $('#swatches'); sw.innerHTML='';
  PRESET_COLORS.forEach(c=>{
    const d=document.createElement('div'); d.className='sw'+(c===settings.accent?' active':'');
    d.style.background=c; d.onclick=()=>{ $('#setAccent').value=c; applyAccent(c); $$('.sw').forEach(x=>x.classList.toggle('active',x===d)); };
    sw.appendChild(d);
  });
}
function applyAccent(c){ document.documentElement.style.setProperty('--accent', c); }
$('#setQuality').addEventListener('input',()=>$('#vSetQuality').textContent=$('#setQuality').value+'%');
$('#setAccent').addEventListener('input',e=>applyAccent(e.target.value));
$('#saveSettings').onclick = async ()=>{
  const body = {
    defaultFormat:$('#setFormat').value,
    defaultQuality:+$('#setQuality').value,
    thumbSize:+$('#setThumb').value,
    accent:$('#setAccent').value,
  };
  const r = await api.post('/api/settings', body);
  if(r.ok){ settings=r.settings; toast('设置已保存 ✓'); }
};
async function loadStats(){
  const s = await api.get('/api/stats');
  $('#stCount').textContent = s.count+' 张';
  $('#stSize').textContent = fmtSize(s.totalSize);
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
}
$('#batchSelectAll').onclick = ()=>{ photos.forEach(p=>selected.add(p.id)); renderGrid(); updateBatchBar(); };
$('#batchClearSel').onclick = ()=>{ selected.clear(); renderGrid(); updateBatchBar(); };

/* ---- 搜索/筛选/排序 ---- */
let searchTimer;
$('#searchInput').addEventListener('input', ()=>{ clearTimeout(searchTimer); searchTimer = setTimeout(loadPhotos, 300); });
$('#sortSelect').addEventListener('change', loadPhotos);
$('#filterSelect').addEventListener('change', loadPhotos);
$('#formatFilter').addEventListener('change', loadPhotos);

/* ---- 批量操作 ---- */
$('#batchPick').onclick = async ()=>{
  const ids = [...selected];
  await api.post('/api/photos/batch/flag', { ids, flag: 'pick' });
  toast(`已标记 ${ids.length} 张为精选 ✓`); await loadPhotos();
};
$('#batchReject').onclick = async ()=>{
  const ids = [...selected];
  await api.post('/api/photos/batch/flag', { ids, flag: 'reject' });
  toast(`已标记 ${ids.length} 张为排除 ✓`); await loadPhotos();
};
$('#batchRate').onclick = async ()=>{
  const s = prompt('批量评分 (0-5 星,0 为清除):', '5');
  if(s == null) return;
  const ids = [...selected];
  await api.post('/api/photos/batch/stars', { ids, stars: +s });
  toast(`已对 ${ids.length} 张评分 ✓`); await loadPhotos();
};
$('#batchDelete').onclick = async ()=>{
  const ids = [...selected];
  if(!confirm(`确定删除选中的 ${ids.length} 张照片?不可恢复。`)) return;
  showLoading();
  await api.post('/api/photos/batch/delete', { ids });
  selected.clear(); await loadPhotos(); hideLoading();
  toast(`已删除 ${ids.length} 张照片`);
};
$('#batchZip').onclick = async ()=>{
  const ids = [...selected];
  toast(`正在打包 ${ids.length} 张照片…`);
  showLoading();
  try{
    const resp = await fetch('/api/photos/download-zip',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ids }) });
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
  const names = albums.map((a,i)=>`${i+1}. ${a.name} (${a.count}张)`).join('\n');
  const choice = prompt('选择收藏夹:\n'+names+'\n输入编号:');
  if(!choice) return;
  const idx = parseInt(choice)-1;
  if(idx<0||idx>=albums.length){ toast('无效编号', true); return; }
  const ids = [...selected];
  await api.post(`/api/albums/${albums[idx].id}/add`, { ids });
  toast(`已添加 ${ids.length} 张到「${albums[idx].name}」✓`); await loadAlbums();
};

/* ============ 评分/标记 ============ */
async function setStars(id, stars){
  await api.post(`/api/photos/${id}/stars`, { stars });
  const p = photos.find(x=>x.id===id);
  if(p) p.stars = stars;
  renderGrid();
}
async function setFlag(id, flag){
  await api.post(`/api/photos/${id}/flag`, { flag });
  const p = photos.find(x=>x.id===id);
  if(p) p.flag = flag;
  renderGrid();
}

/* ============ 幻灯片 ============ */
let slIndex = 0;
function openSlideshow(){
  if(!photos.length) return;
  $('#slideshow').hidden = false;
  slIndex = lbIndex >= 0 ? lbIndex : 0;
  slShow();
}
function slShow(){
  const p = photos[slIndex]; if(!p) return;
  const img = $('#slImg');
  img.style.opacity = '0';
  setTimeout(()=>{
    img.src = '/files/'+p.file+'?v='+p.time;
    img.style.opacity = '1';
    $('#slInfo').textContent = `${slIndex+1}/${photos.length} · ${p.name} · ${p.width}×${p.height}`;
  }, 200);
}
function slPlay(){
  if(slTimer){ clearInterval(slTimer); slTimer=null; $('#slPlay').textContent='▶'; return; }
  $('#slPlay').textContent='⏸';
  slTimer = setInterval(()=>{ slIndex=(slIndex+1)%photos.length; slShow(); }, 3000);
}
$('#slPrev').onclick = ()=>{ slIndex=(slIndex-1+photos.length)%photos.length; slShow(); };
$('#slNext').onclick = ()=>{ slIndex=(slIndex+1)%photos.length; slShow(); };
$('#slPlay').onclick = slPlay;
$('#slExit').onclick = ()=>{ $('#slideshow').hidden=true; if(slTimer){clearInterval(slTimer);slTimer=null;} };

/* ============ 收藏夹 ============ */
function renderAlbums(){
  const ag = $('#albumsGrid');
  ag.innerHTML = '';
  $('#albumsEmpty').classList.toggle('show', albums.length===0);
  albums.forEach(a=>{
    const card = document.createElement('div');
    card.className = 'album-card';
    card.innerHTML = `<h3>📁 ${esc(a.name)}</h3><div class="album-count">${a.count} 张照片</div>`;
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
  const ag = $('#albumGrid'); ag.innerHTML = '';
  list.forEach((p,i)=>{
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<img src="/thumbs/${p.id}.webp?v=${p.time}" alt="${esc(p.name)}" loading="lazy">
      <div class="acts"><button class="mini rm" title="从收藏夹移除">✕</button></div>
      <div class="meta">${esc(p.name)}</div>`;
    card.querySelector('img').onclick = ()=>{ photos=list; lbIndex=i; openLightbox(i); };
    card.querySelector('.rm').onclick = async e=>{e.stopPropagation();
      await api.post(`/api/albums/${id}/remove`, { ids: [p.id] });
      toast('已从收藏夹移除'); openAlbum(id); loadAlbums();
    };
    ag.appendChild(card);
  });
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
  if(!confirm('确定删除此收藏夹?(不会删除照片)')) return;
  await api.del('/api/albums/'+activeAlbumId);
  activeAlbumId = null; $('#albumDetail').hidden = true;
  $('#albumsGrid').style.display = ''; await loadAlbums(); toast('已删除收藏夹');
};

/* ============ 灯箱:幻灯片按钮 ============ */
$('#lbSlideshow').onclick = ()=>{ closeLightbox(); openSlideshow(); };

/* ============ 键盘快捷键(选片/评分/标记) ============ */
document.addEventListener('keydown', e=>{
  const tgt = e.target;
  if(tgt.matches('input,textarea,select')) return;
  const k = e.key;
  
  // 编辑器撤销/重做
  if($('#editor').classList.contains('active')){
    if(e.ctrlKey || e.metaKey){
      if(k === 'z' && !e.shiftKey){ e.preventDefault(); undo(); return; }
      if((k === 'y' || (k === 'z' && e.shiftKey))){ e.preventDefault(); redo(); return; }
    }
  }
  // 1-5 星评分
  if(k>='1' && k<='5'){
    const id = current ? current.id : photos[lbIndex]?.id;
    if(id) setStars(id, +k);
  }
  // 0 清除评分
  if(k==='0'){
    const id = current ? current.id : photos[lbIndex]?.id;
    if(id) setStars(id, 0);
  }
  // P 精选 / R 排除
  if(k==='p' || k==='P'){
    const id = current ? current.id : photos[lbIndex]?.id;
    if(id) setFlag(id, 'pick');
  }
  if(k==='r' || k==='R'){
    const id = current ? current.id : photos[lbIndex]?.id;
    if(id) setFlag(id, 'reject');
  }
  // 空格:幻灯片(相册视图)
  if(k===' ' && !$('#slideshow').hidden){ e.preventDefault(); slPlay(); }
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
      if (log.data) {
        const pre = document.createElement('pre');
        pre.style.fontSize = '11px';
        pre.style.margin = '0';
        pre.style.maxHeight = '60px';
        pre.style.overflow = 'auto';
        pre.textContent = typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2);
        dataTd.appendChild(pre);
      } else {
        dataTd.textContent = '—';
        dataTd.style.color = '#888';
      }

      tr.appendChild(timeTd);
      tr.appendChild(levelTd);
      tr.appendChild(sourceTd);
      tr.appendChild(msgTd);
      tr.appendChild(dataTd);
      tbody.appendChild(tr);
    });

    // 自动滚动到底部（最新日志）
    const wrap = $('.logs-table-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;

  } catch (e) {
    console.error('加载日志失败:', e);
    logFrontend('error', '加载日志失败', { error: e.message });
  }
}

// 前端日志记录函数（发送到后端）
async function logFrontend(level, message, data = null) {
  try {
    // 同时输出到控制台
    const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
    const consoleMsg = `[${ts}] [${level.toUpperCase()}] [frontend] ${message}`;
    if (level === 'error') console.error(consoleMsg, data);
    else if (level === 'warn') console.warn(consoleMsg, data);
    else console.log(consoleMsg, data);

    // 发送到后端记录
    await fetch('/api/logs/frontend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  if (clearBtn) {
    clearBtn.onclick = async () => {
      if (!confirm('确定清空所有日志？此操作不可恢复。')) return;
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

// 自动刷新日志（当日志页面激活时）
function startLogsAutoRefresh(){
  if (logsRefreshTimer) clearInterval(logsRefreshTimer);
  logsRefreshTimer = setInterval(() => {
    const logsView = document.querySelector('.view[data-view="logs"].active');
    if (logsView && logsAutoRefresh) {
      loadLogs();
    }
  }, 3000); // 每 3 秒刷新
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

    modal.hidden = false;
    field.focus();
    field.select();

    const cleanup = (value) => {
      modal.hidden = true;
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

/* ============ 启动 ============ */
(async function init(){
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

function updateOOBEStep(){
  const pages = $$('.oobe-page');
  const steps = $$('.oobe-step');
  const prevBtn = $('#oobePrev');
  const nextBtn = $('#oobeNext');

  pages.forEach((p, i) => {
    p.hidden = (i + 1) !== oobeCurrentStep;
  });
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
    updateOOBEStep();
  }
});
$('#oobeNext')?.addEventListener('click', () => {
  if(oobeCurrentStep < 4){
    oobeCurrentStep++;
    updateOOBEStep();
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
