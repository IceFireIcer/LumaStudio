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
      <div class="acts">
        <button class="mini" onclick="openLightbox(${i})">👁</button>
        <button class="mini" onclick="openEditorById('${p.id}')">🎨</button>
        <button class="mini" onclick="downloadPhoto({file:'${p.file}',name:'${esc(p.name)}'})">⬇</button>
      </div>
      <div class="stars">${starStr}</div>
      ${flagHtml}
      <div class="name">${esc(p.name)}</div>
    `;
    card.onclick = e=>{
      if(e.target.classList.contains('sel-check') || e.target.classList.contains('mini')) return;
      if(e.ctrlKey || e.metaKey){
        toggleSelect(p.id);
      } else {
        openLightbox(i);
      }
    };
    grid.appendChild(card);
  });
}

/* ============ 搜索与筛选 ============ */
let searchTimer;
$('#searchInput').addEventListener('input', ()=>{
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadPhotos, 300);
});
$('#sortSelect').addEventListener('change', loadPhotos);
$('#filterSelect').addEventListener('change', loadPhotos);
$('#formatFilter').addEventListener('change', loadPhotos);

/* ============ 多选与批量操作 ============ */
const batchBar = $('#batchBar');
function toggleSelect(id){
  if(selected.has(id)) selected.delete(id);
  else selected.add(id);
  updateBatchBar();
  if(selected.has(id)) $('.card[data-id="'+id+'"]').classList.add('selected');
  else $('.card[data-id="'+id+'"]').classList.remove('selected');
}
function updateBatchBar(){
  const n = selected.size;
  batchBar.classList.toggle('show', n>0);
  $('#batchCount').textContent = `已选择 ${n} 张`;
}
$('#selectAll').onclick = ()=>{
  photos.forEach(p=>{ selected.add(p.id); $('.card[data-id="'+p.id+'"]').classList.add('selected'); });
  updateBatchBar();
};
$('#selectNone').onclick = ()=>{
  selected.clear();
  $$('.card').forEach(c=>c.classList.remove('selected'));
  updateBatchBar();
};

/* ============ 灯箱 ============ */
const lightbox = $('#lightbox'), lbImg = $('#lbImg');
function openLightbox(idx){
  lbIndex = idx;
  const p = photos[idx];
  if(!p) return;
  lbImg.src = '/files/'+p.file;
  $('#lbCap').textContent = `${p.name} · ${p.width}×${p.height} · ${fmtSize(p.size)}`;
  lightbox.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeLightbox(){
  lightbox.classList.remove('open');
  document.body.style.overflow = '';
}
function navLb(d){
  lbIndex = (lbIndex + d + photos.length) % photos.length;
  openLightbox(lbIndex);
}
$('#lbPrev').onclick = ()=>navLb(-1);
$('#lbNext').onclick = ()=>navLb(1);
$('#lbClose').onclick = closeLightbox;
$('#lbDownload').onclick = ()=>{ downloadPhoto(photos[lbIndex]); };
$('#lbEdit').onclick = ()=>{ closeLightbox(); openEditorById(photos[lbIndex].id); };
$('#lbRename').onclick = async ()=>{
  const p = photos[lbIndex];
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

async function openEditorById(id){
  const p = photos.find(x=>x.id===id);
  if(!p){ toast('未找到照片', true); return; }
  openEditor(p);
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

$$('.ptab').forEach(t=>t.onclick=()=>{
  $$('.ptab').forEach(x=>x.classList.toggle('active', x===t));
  $$('.ptab-panel').forEach(p=>p.classList.toggle('active', p.dataset.ptab===t.dataset.ptab));
});

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

let dragging = false, resizing = false, dragStart = {x:0,y:0}, boxStart = {x:0,y:0,w:0,h:0};
cropBox.addEventListener('mousedown', e=>{ if(e.target.classList.contains('ch')) return; dragging=true; dragStart={x:e.clientX,y:e.clientY}; const r=cropBox.getBoundingClientRect(); boxStart={x:r.left,y:r.top,w:r.width,h:r.height}; });
document.addEventListener('mousemove', e=>{
  if(!cropping) return;
  if(dragging){
    const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    const r = editImg.getBoundingClientRect();
    const stage = $('#canvasStage').getBoundingClientRect();
    let left = boxStart.x + dx, top = boxStart.y + dy;
    left = Math.max(stage.left, Math.min(left, stage.left+stage.width-boxStart.w));
    top = Math.max(stage.top, Math.min(top, stage.top+stage.height-boxStart.h));
    Object.assign(cropBox.style,{left:left+'px',top:top+'px'});
    e.preventDefault();
  }
  if(resizing){
    const r = editImg.getBoundingClientRect();
    const stage = $('#canvasStage').getBoundingClientRect();
    let {x,y,w,h} = boxStart;
    const min=60;
    if(resizing.includes('e')){ w = Math.max(min, e.clientX - x); }
    if(resizing.includes('s')){ h = Math.max(min, e.clientY - y); }
    if(resizing.includes('w')){ const dw = x + w - e.clientX; x = Math.min(x, x + w - min); w = Math.max(min, w - dw); }
    if(resizing.includes('n')){ const dh = y + h - e.clientY; y = Math.min(y, y + h - min); h = Math.max(min, h - dh); }
    w = Math.min(w, stage.left+stage.width-x); h = Math.min(h, stage.top+stage.height-y);
    if(cropRatio!=='free'){
      const ratio=parseFloat(cropRatio);
      if(resizing.includes('e') || resizing.includes('w')){ h = Math.round(w/ratio); }
      else{ w = Math.round(h*ratio); }
    }
    Object.assign(cropBox.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});
    e.preventDefault();
  }
});
document.addEventListener('mouseup', ()=>{ dragging=false; resizing=false; });
$$('.ch').forEach(c=>c.addEventListener('mousedown',e=>{
  resizing = c.classList[1];
  const r=cropBox.getBoundingClientRect();
  boxStart={x:r.left,y:r.top,w:r.width,h:r.height};
}));

$('#applyCrop').onclick = ()=>{
  const r = cropBox.getBoundingClientRect();
  const imgR = editImg.getBoundingClientRect();
  const scaleX = current.width / imgR.width;
  const scaleY = current.height / imgR.height;
  edit.crop = {
    left: Math.round((r.left - imgR.left) * scaleX),
    top: Math.round((r.top - imgR.top) * scaleY),
    width: Math.round(r.width * scaleX),
    height: Math.round(r.height * scaleY),
  };
  cropping = false;
  cropOverlay.hidden = true;
  $('#cropRatios').hidden = true;
  $('#applyCrop').hidden = true;
  $('#cropToggle').textContent = '✂ 开启裁剪';
  applyFilter();
  toast('裁剪已应用');
};

function buildEditBody(mode){
  return {
    mode,
    adjust:{
      brightness: $('#brightness').value/100,
      contrast: $('#contrast').value/100,
      saturation: $('#saturation').value/100,
      hue: $('#hue').value,
      sharpen: +$('#sharpen').value,
      blur: +$('#blur').value,
      grayscale: $('#grayscale').checked,
    },
    transform:{ rotate:edit.rotate, flipH:edit.flipH, flipV:edit.flipV, crop:edit.crop },
    resize:{ width:+$('#reW').value, height:+$('#reH').value },
    output:{ format:$('#outFormat').value, quality:+$('#quality').value },
  };
}

$('#exportBtn').onclick = async ()=>{
  showLoading();
  const r = await api.post(`/api/photos/${current.id}/process`, buildEditBody($('#overwrite').checked ? 'overwrite' : 'copy'));
  hideLoading();
  if(r.ok){
    toast($('#overwrite').checked ? '已覆盖原图 ✓' : '已保存副本 ✓');
    photos = photos.map(p=>p.id===r.photo.id ? r.photo : p);
    await loadPhotos();
    openEditor(r.photo);
  } else {
    toast(r.error||'处理失败', true);
  }
};

$('#downloadBtn').onclick = async ()=>{
  showLoading();
  const r = await fetch(`/api/photos/${current.id}/render`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify(buildEditBody('copy'))
  });
  hideLoading();
  if(!r.ok){ toast('下载失败', true); return; }
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const ext = $('#outFormat').value;
  const base = current.name.replace(/\.[^.]+$/, '');
  a.download = `${base}_edited.${ext}`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
};

/* ============ EXIF ============ */
function openExif(p){
  current = p;
  switchView('exif');
  $('#exifEmpty').classList.remove('show');
  $('#exifWrap').classList.remove('hidden');
  loadExif(p.id);
}
async function loadExif(id){
  const r = await api.get(`/api/photos/${id}/exif`);
  if(!r.ok) return;
  const exif = r.exif;
  $('#exifCamera').textContent = exif.Make ? (exif.Model ? `${exif.Make} ${exif.Model}` : exif.Make) : '—';
  $('#exifLens').textContent = exif.LensModel || exif.Lens || '—';
  $('#exifAperture').textContent = exif.Aperture ? 'f/'+exif.Aperture.toFixed(1) : '—';
  $('#exifShutter').textContent = exif.ExposureTime ? formatShutter(exif.ExposureTime) : '—';
  $('#exifISO').textContent = exif.ISO ? 'ISO '+exif.ISO : '—';
  $('#exifFocal').textContent = exif.FocalLength ? exif.FocalLength+'mm' : '—';
  $('#exifDate').textContent = exif.DateTimeOriginal || exif.DateTime || exif.CreateDate || '—';
  $('#exifGPS').textContent = exif.latitude != null && exif.longitude != null
    ? `${exif.latitude.toFixed(6)}, ${exif.longitude.toFixed(6)}` : '—';
  $('#exifArtist').value = exif.Artist || '';
  $('#exifCopyright').value = exif.Copyright || '';
  $('#exifDesc').value = exif.ImageDescription || '';
  const dt = exif.DateTimeOriginal || exif.DateTime || '';
  $('#exifDatetime').value = dt.replace(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/, '$1-$2-$3T$4:$5:$6');
}
function formatShutter(t){
  if(t >= 1) return t+'s';
  const f = 1/t;
  const n = Math.round(f);
  return n===f ? '1/'+n : '1/'+f.toFixed(1);
}
$('#exifPhotoName').onclick = ()=>{ downloadPhoto(current); };

$('#saveExif').onclick = async ()=>{
  const r = await api.post(`/api/photos/${current.id}/exif`, {
    artist: $('#exifArtist').value,
    copyright: $('#exifCopyright').value,
    description: $('#exifDesc').value,
    datetime: $('#exifDatetime').value.replace('T', ' '),
  });
  if(r.ok) toast('EXIF 已保存 ✓');
  else toast(r.error||'保存失败', true);
};

$('#stripExif').onclick = async ()=>{
  if(!confirm('确定要移除所有元数据吗？此操作不可撤销。')) return;
  const r = await api.post(`/api/photos/${current.id}/strip-exif`);
  if(r.ok){ toast('元数据已移除 ✓'); await loadExif(current.id); }
  else toast(r.error||'操作失败', true);
};

/* ============ 相册管理 ============ */
function renderAlbums(){
  const list = $('#albumsGrid');
  list.innerHTML = '';
  albums.forEach(a=>{
    const card = document.createElement('div');
    card.className = 'album-card';
    card.dataset.id = a.id;
    card.innerHTML = `
      <div class="album-thumb">${a.count>0?'📷':'📁'}</div>
      <div class="album-name">${esc(a.name)}</div>
      <div class="album-count">${a.count} 张</div>
    `;
    card.onclick = ()=>openAlbum(a);
    list.appendChild(card);
  });
}

function openAlbum(a){
  activeAlbumId = a.id;
  $('#albumDetail').hidden = false;
  $('#albumsGrid').style.display = 'none';
  $('#albumTitle').textContent = a.name;
  loadPhotos();
}

$('#backFromAlbum').onclick = ()=>{
  activeAlbumId = null;
  $('#albumDetail').hidden = true;
  $('#albumsGrid').style.display = '';
  loadPhotos();
};

$('#createAlbum').onclick = async ()=>{
  const name = prompt('创建新相册', '新相册');
  if(name == null) return;
  const trimmed = name.trim();
  if(!trimmed){ toast('名称不能为空', true); return; }
  const r = await api.post('/api/albums', { name: trimmed });
  if(r.ok){ toast('相册已创建 ✓'); await loadAlbums(); }
  else toast(r.error||'创建失败', true);
};

$('#renameAlbum').onclick = async ()=>{
  if(!activeAlbumId) return;
  const a = albums.find(x=>x.id===activeAlbumId);
  if(!a) return;
  const name = prompt('重命名相册', a.name);
  if(name == null) return;
  const trimmed = name.trim();
  if(!trimmed){ toast('名称不能为空', true); return; }
  const r = await api.post(`/api/albums/${a.id}/rename`, { name: trimmed });
  if(r.ok){ a.name = r.album.name; $('#albumTitle').textContent = a.name; toast('已重命名 ✓'); }
  else toast(r.error||'重命名失败', true);
};

$('#deleteAlbum').onclick = async ()=>{
  if(!activeAlbumId) return;
  const a = albums.find(x=>x.id===activeAlbumId);
  if(!a) return;
  if(!confirm(`确定要删除相册「${a.name}」吗？相册中的照片不会被删除。`)) return;
  const r = await api.del(`/api/albums/${a.id}`);
  if(r.ok){ toast('相册已删除 ✓'); activeAlbumId=null; $('#albumDetail').hidden=true; $('#albumsGrid').style.display=''; await loadAlbums(); }
  else toast(r.error||'删除失败', true);
};

/* ============ 收藏夹添加 ============ */
async function addToAlbum(photoId, albumId){
  const r = await api.post(`/api/albums/${albumId}/add`, { ids: [photoId] });
  if(r.ok) toast('已添加到相册 ✓');
  else toast(r.error||'添加失败', true);
}

$('#addToAlbum').onclick = async ()=>{
  const id = current ? current.id : photos[lbIndex]?.id;
  if(!id) return;
  const html = albums.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');
  const sel = document.createElement('select');
  sel.innerHTML = `<option value="">选择相册...</option>${html}`;
  const dialog = document.createElement('div');
  dialog.className = 'modal';
  dialog.innerHTML = `
    <div class="modal-bg" onclick="this.parentElement.remove()"></div>
    <div class="modal-body">
      <h3>添加到相册</h3>
      <select id="selAlbum" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:12px">${html}</select>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn ghost" onclick="this.parentElement.parentElement.parentElement.remove()">取消</button>
        <button class="btn primary" onclick="addToAlbum('${id}', $('#selAlbum').value); this.parentElement.parentElement.parentElement.remove()">添加</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
};

/* ============ 幻灯片 ============ */
let slPlaying = false;
function openSlideshow(){
  $('#slideshow').hidden = false;
  document.body.style.overflow = 'hidden';
  slTimer = setInterval(()=>{ slPlay(); }, 3000);
  slPlaying = true;
}
function closeSlideshow(){
  $('#slideshow').hidden = true;
  document.body.style.overflow = '';
  clearInterval(slTimer);
  slPlaying = false;
}
function slPlay(){
  if(!slPlaying) return;
  lbIndex = (lbIndex + 1) % photos.length;
  updateSlide();
}
function updateSlide(){
  const p = photos[lbIndex];
  $('#slImg').src = '/files/'+p.file;
  $('#slInfo').textContent = `${p.name} · ${lbIndex+1}/${photos.length}`;
}
$('#slPrev').onclick = ()=>{ lbIndex=(lbIndex-1+photos.length)%photos.length; updateSlide(); };
$('#slNext').onclick = ()=>{ lbIndex=(lbIndex+1)%photos.length; updateSlide(); };
$('#slExit').onclick = closeSlideshow;

/* ============ 批量操作 ============ */
async function batchAction(action){
  const ids = [...selected];
  if(ids.length === 0) return;
  let r;
  switch(action){
    case 'pick': r = await api.post('/api/photos/batch/flag', { ids, flag: 'pick' }); break;
    case 'reject': r = await api.post('/api/photos/batch/flag', { ids, flag: 'reject' }); break;
    case 'unflag': r = await api.post('/api/photos/batch/flag', { ids, flag: null }); break;
    case 'stars1': case 'stars2': case 'stars3': case 'stars4': case 'stars5':
      r = await api.post('/api/photos/batch/stars', { ids, stars: action.replace('stars','') }); break;
    case 'stars0': r = await api.post('/api/photos/batch/stars', { ids, stars: 0 }); break;
    case 'delete':
      if(!confirm(`确定要删除 ${ids.length} 张照片吗？此操作不可撤销。`)) return;
      r = await api.post('/api/photos/batch/delete', { ids }); break;
    case 'zip':
      const zipRes = await fetch('/api/photos/download-zip', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ids })
      });
      if(!zipRes.ok){ toast('打包失败', true); return; }
      const blob = await zipRes.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'LumaStudio_export.zip';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
      return;
  }
  if(r && r.ok){
    toast(`已处理 ${r.updated||r.deleted||ids.length} 张照片 ✓`);
    selected.clear();
    updateBatchBar();
    await loadPhotos();
  } else {
    toast(r?.error||'操作失败', true);
  }
}
$$('#batchBar [data-action]').forEach(b=>b.onclick=()=>batchAction(b.dataset.action));

/* ============ 设置页 ============ */
async function loadSettings(){
  settings = await api.get('/api/settings');
  $('#defFormat').value = settings.defaultFormat || 'jpeg';
  $('#defQuality').value = settings.defaultQuality || 82;
  $('#defQualityVal').textContent = (settings.defaultQuality || 82)+'%';
  $('#thumbSize').value = settings.thumbSize || 480;
  $('#accentPicker').value = settings.accent || '#0071e3';
  document.documentElement.style.setProperty('--accent', settings.accent || '#0071e3');
}

async function saveSettings(){
  const r = await api.post('/api/settings', {
    defaultFormat: $('#defFormat').value,
    defaultQuality: +$('#defQuality').value,
    thumbSize: +$('#thumbSize').value,
    accent: $('#accentPicker').value,
  });
  if(r.ok){
    settings = r.settings;
    document.documentElement.style.setProperty('--accent', settings.accent);
    toast('设置已保存 ✓');
  } else {
    toast(r.error||'保存失败', true);
  }
}

$('#saveSettings').onclick = saveSettings;
$('#defQuality').addEventListener('input',()=>{ $('#defQualityVal').textContent = $('#defQuality').value+'%'; });
$('#accentPicker').addEventListener('input',e=>{
  document.documentElement.style.setProperty('--accent', e.target.value);
});

async function loadStats(){
  const r = await api.get('/api/stats');
  if(r.ok){
    $('#statCount').textContent = r.count;
    $('#statSize').textContent = fmtSize(r.totalSize);
  }
}

$('#clearAll').onclick = async ()=>{
  if(!confirm('确定要清空所有照片吗？此操作不可撤销！')) return;
  showLoading();
  const r = await api.del('/api/photos');
  hideLoading();
  if(r.ok){
    photos = [];
    selected.clear();
    updateBatchBar();
    renderGrid();
    toast('已清空所有照片');
  } else {
    toast(r.error||'操作失败', true);
  }
};

/* ============ 关于页 ============ */
async function loadAbout(){
  const r = await api.get('/api/info');
  if(r.ok){
    $('#aboutVersion').textContent = r.version;
    $('#aboutNode').textContent = r.node;
    $('#aboutSharp').textContent = r.sharp?.sharp || '—';
    $('#aboutVips').textContent = r.sharp?.libvips || '—';
    $('#aboutPhotos').textContent = r.photoCount;
    $('#aboutSize').textContent = fmtSize(r.storageBytes);
    $('#aboutUptime').textContent = formatUptime(r.uptime);
  }
}
function formatUptime(sec){
  const d = Math.floor(sec/86400);
  const h = Math.floor((sec%86400)/3600);
  const m = Math.floor((sec%3600)/60);
  if(d>0) return `${d}天 ${h}小时 ${m}分钟`;
  if(h>0) return `${h}小时 ${m}分钟`;
  return `${m}分钟`;
}

/* ============ 评分与标记 ============ */
async function setStars(id, stars){
  const r = await api.post(`/api/photos/${id}/stars`, { stars });
  if(r.ok){
    const p = photos.find(x=>x.id===id);
    if(p) p.stars = stars;
    if($('.card[data-id="'+id+'"]')){
      $('.card[data-id="'+id+'"] .stars').textContent = stars>0 ? '★'.repeat(stars)+'☆'.repeat(5-stars) : '';
    }
  }
}
async function setFlag(id, flag){
  const r = await api.post(`/api/photos/${id}/flag`, { flag });
  if(r.ok){
    const p = photos.find(x=>x.id===id);
    if(p) p.flag = flag;
    const card = $('.card[data-id="'+id+'"]');
    if(card){
      card.querySelector('.flag-badge.pick')?.remove();
      card.querySelector('.flag-badge.reject')?.remove();
      if(flag==='pick') card.innerHTML += '<div class="flag-badge pick show">精选</div>';
      if(flag==='reject') card.innerHTML += '<div class="flag-badge reject show">排除</div>';
    }
  }
}

/* ============ 灯箱:幻灯片按钮 ============ */
$('#lbSlideshow').onclick = ()=>{ closeLightbox(); openSlideshow(); };

/* ============ 键盘快捷键(选片/评分/标记) ============ */
document.addEventListener('keydown', e=>{
  const tgt = e.target;
  if(tgt.matches('input,textarea,select')) return;
  const k = e.key;
  
  if($('#editor').classList.contains('active')){
    if(e.ctrlKey || e.metaKey){
      if(k === 'z' && !e.shiftKey){ e.preventDefault(); undo(); return; }
      if((k === 'y' || (k === 'z' && e.shiftKey))){ e.preventDefault(); redo(); return; }
    }
  }
  
  if(k>='1' && k<='5'){
    const id = current ? current.id : photos[lbIndex]?.id;
    if(id) setStars(id, +k);
  }
  if(k==='0'){
    const id = current ? current.id : photos[lbIndex]?.id;
    if(id) setStars(id, 0);
  }
  if(k==='p' || k==='P'){
    const id = current ? current.id : photos[lbIndex]?.id;
    if(id) setFlag(id, 'pick');
  }
  if(k==='r' || k==='R'){
    const id = current ? current.id : photos[lbIndex]?.id;
    if(id) setFlag(id, 'reject');
  }
  if(k===' ' && !$('#slideshow').hidden){ e.preventDefault(); slPlay(); }
  if(!$('#slideshow').hidden){
    if(k==='ArrowLeft') $('#slPrev').click();
    if(k==='ArrowRight') $('#slNext').click();
    if(k==='Escape') $('#slExit').click();
  }
});

/* ============ 启动 ============ */
(async function init(){
  await loadSettings();
  await loadPhotos();
  await loadAlbums();
  hideLoading();
})();