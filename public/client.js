/* 🎨 Our Canvas — one private infinite canvas for two */
(() => {
'use strict';

const $ = (s) => document.querySelector(s);
const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  let body = {};
  try { body = await res.json(); } catch {}
  return { status: res.status, ...body };
};

/* ================= theme ================= */
function currentTheme() { return document.documentElement.dataset.theme || 'dark'; }
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('ourcanvas_theme', t); } catch {}
  $('#btn-theme').textContent = t === 'dark' ? '🌙' : '☀️';
  document.querySelector('meta[name="theme-color"]').content = t === 'dark' ? '#000000' : '#f2f2f7';
  refreshThemeColors();
  // keep the default ink readable when the theme flips
  if (color === '#ffffff' && t === 'light') setColor('#1c1c1e');
  if (color === '#1c1c1e' && t === 'dark') setColor('#ffffff');
  dirty = true;
}
let themeColors = { bg: '#060609', dot: 'rgba(255,255,255,.08)' };
function refreshThemeColors() {
  const cs = getComputedStyle(document.documentElement);
  themeColors.bg = cs.getPropertyValue('--canvas-bg').trim() || themeColors.bg;
  themeColors.dot = cs.getPropertyValue('--dot').trim() || themeColors.dot;
}

/* ================= boot flow ================= */
let myName = '';
try { myName = localStorage.getItem('ourcanvas_name') || ''; } catch {}

async function boot() {
  applyTheme(currentTheme());
  const me = await api('/api/me');
  if (me.ok) {
    if (me.name) { myName = me.name; enterCanvas(); }
    else showNameScreen();
  } else {
    showLockScreen();
  }
}

function showLockScreen() {
  $('#screen-lock').classList.remove('hidden');
  $('#screen-name').classList.add('hidden');
  $('#screen-canvas').classList.add('hidden');
  setTimeout(() => $('#inp-password').focus(), 100);
}
function showNameScreen() {
  $('#screen-lock').classList.add('hidden');
  $('#screen-name').classList.remove('hidden');
  $('#screen-canvas').classList.add('hidden');
  if (myName) $('#inp-myname').value = myName;
  setTimeout(() => $('#inp-myname').focus(), 100);
}

$('#btn-unlock').onclick = doUnlock;
$('#inp-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doUnlock(); });
async function doUnlock() {
  const pw = $('#inp-password').value;
  $('#lock-error').textContent = '';
  const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: pw }) });
  if (r.ok) {
    $('#inp-password').value = '';
    const me = await api('/api/me');
    if (me.ok && me.name) { myName = me.name; enterCanvas(); }
    else showNameScreen();
  } else if (r.banned) {
    $('#lock-form').classList.add('hidden');
    $('#lock-blocked').classList.remove('hidden');
    $('#blocked-msg').textContent = r.error;
  } else {
    const left = r.remaining > 0 ? ` · ${r.remaining} attempt${r.remaining === 1 ? '' : 's'} left` : '';
    $('#lock-error').textContent = (r.error || 'Wrong password') + left;
    $('#lock-hint').textContent = r.remaining <= 1 ? 'Careful — 3 wrong tries blocks this device for 24h.' : '';
  }
}

$('#btn-savename').onclick = saveName;
$('#inp-myname').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveName(); });
async function saveName() {
  const name = $('#inp-myname').value.trim().slice(0, 16);
  if (!name) { $('#name-error').textContent = 'Tell us your name 💕'; return; }
  const r = await api('/api/name', { method: 'POST', body: JSON.stringify({ name }) });
  if (r.ok) {
    myName = r.name;
    try { localStorage.setItem('ourcanvas_name', myName); } catch {}
    enterCanvas();
  } else {
    $('#name-error').textContent = r.error || 'Something went wrong';
  }
}

/* ================= canvas state ================= */
let socket = null;
const cam = { x: 0, y: 0, zoom: 1 };
const strokes = new Map();
const peers = new Map();
const myStrokeIds = [];
const redoStack = [];
let strokeSeq = 0;
let dirty = true;

let tool = 'pen';
let color = currentTheme() === 'dark' ? '#ffffff' : '#1c1c1e';
let brushSize = 8;

const PALETTE = ['#ffffff', '#1c1c1e', '#ff2d55', '#ff7a59', '#ff9f0a', '#ffcc00',
  '#30d158', '#0a84ff', '#bf5af2', '#64d2ff', '#ff6482', '#ac8e68'];

function enterCanvas() {
  $('#screen-lock').classList.add('hidden');
  $('#screen-name').classList.add('hidden');
  $('#screen-canvas').classList.remove('hidden');
  resize();
  if (!socket) connectSocket();
}

/* ================= canvas setup ================= */
const canvas = $('#board');
const ctx = canvas.getContext('2d');
let dpr = 1, cssW = 0, cssH = 0;

function resize() {
  dpr = Math.min(2.5, window.devicePixelRatio || 1);
  cssW = window.innerWidth; cssH = window.innerHeight;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  dirty = true;
}
window.addEventListener('resize', resize);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function applyCam() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(cssW / 2, cssH / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);
}
function screenToWorld(sx, sy) {
  return { x: (sx - cssW / 2) / cam.zoom + cam.x, y: (sy - cssH / 2) / cam.zoom + cam.y };
}

/* ================= rendering ================= */
function tracePath(s) {
  const p = s.points;
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
}

function drawStroke(s) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  if (s.tool === 'text') {
    ctx.fillStyle = s.color;
    ctx.font = `${s.size * 2.2}px -apple-system, "SF Pro Text", sans-serif`;
    ctx.fillText(s.text, s.x, s.y);
    ctx.restore();
    return;
  }
  if (s.tool === 'line' || s.tool === 'rect' || s.tool === 'circle') {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.size; ctx.globalAlpha = 1;
    const [x1, y1, x2, y2] = s.points;
    ctx.beginPath();
    if (s.tool === 'line') { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    else if (s.tool === 'rect') ctx.rect(x1, y1, x2 - x1, y2 - y1);
    else ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (s.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
  if (!s.points || s.points.length < 2) { ctx.restore(); return; }

  if (s.points.length < 4) { // tap = dot
    ctx.fillStyle = s.tool === 'eraser' ? '#000' : s.color;
    ctx.globalAlpha = s.tool === 'highlighter' ? 0.32 : 1;
    ctx.beginPath();
    ctx.arc(s.points[0], s.points[1], (s.size * (s.tool === 'eraser' ? 2.2 : 1)) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const passes = s.tool === 'neon'
    ? [[3.2, 0.20, s.color], [1.8, 0.45, s.color], [1.0, 1, s.color], [0.45, 0.9, '#ffffff']]
    : s.tool === 'pencil'   ? [[0.55, 0.7, s.color]]
    : s.tool === 'marker'   ? [[1.7, 0.95, s.color]]
    : s.tool === 'highlighter' ? [[2.8, 0.32, s.color]]
    : s.tool === 'eraser'   ? [[2.2, 1, '#000']]
    : [[1.0, 1, s.color]];

  for (const [wm, alpha, col] of passes) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = col;
    ctx.lineWidth = s.size * wm;
    tracePath(s);
    ctx.stroke();
  }
  ctx.restore();
}

function render() {
  requestAnimationFrame(render);
  if (!dirty) return;
  dirty = false;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = themeColors.bg;
  ctx.fillRect(0, 0, cssW, cssH);
  applyCam();

  const step = 90;
  const x0 = cam.x - cssW / 2 / cam.zoom, x1 = cam.x + cssW / 2 / cam.zoom;
  const y0 = cam.y - cssH / 2 / cam.zoom, y1 = cam.y + cssH / 2 / cam.zoom;
  ctx.fillStyle = themeColors.dot;
  for (let gx = Math.floor(x0 / step) * step; gx <= x1; gx += step)
    for (let gy = Math.floor(y0 / step) * step; gy <= y1; gy += step) {
      ctx.beginPath(); ctx.arc(gx, gy, 1.4, 0, Math.PI * 2); ctx.fill();
    }

  for (const s of strokes.values()) drawStroke(s);
  if (activeStroke && activeStroke.points.length >= 2) drawStroke(activeStroke);

  if (previewShape) {
    ctx.save();
    ctx.setLineDash([10 / cam.zoom, 8 / cam.zoom]);
    drawStroke(previewShape);
    ctx.restore();
  }

  const now = Date.now();
  ctx.textBaseline = 'top';
  for (const [, p] of peers) {
    if (now - p.last > 4000 || p.x === undefined) continue;
    const fade = Math.max(0.25, 1 - (now - p.last) / 4000);
    ctx.save(); ctx.globalAlpha = fade;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 7 / cam.zoom, 0, Math.PI * 2); ctx.fill();
    ctx.font = `${13 / cam.zoom}px -apple-system, sans-serif`;
    const w = ctx.measureText(p.name).width;
    const bx = p.x + 12 / cam.zoom, by = p.y + 12 / cam.zoom;
    const pad = 6 / cam.zoom, h = 20 / cam.zoom;
    ctx.fillStyle = currentTheme() === 'dark' ? 'rgba(28,28,30,.9)' : 'rgba(255,255,255,.92)';
    ctx.beginPath(); ctx.roundRect(bx, by, w + pad * 2, h, h / 2); ctx.fill();
    ctx.fillStyle = currentTheme() === 'dark' ? '#fff' : '#000';
    ctx.fillText(p.name, bx + pad, by + pad * 0.7);
    ctx.restore();
  }
}

/* ================= input ================= */
const pointers = new Map();
let activeStroke = null;
let pendingPoints = [];
let flushTimer = null;
let previewShape = null;
let shapeStart = null;
let pinch = null;
let dragLast = null;

function newStrokeId() { return `${socket.id}:${strokeSeq++}`; }
function flushPoints() {
  if (!activeStroke || !pendingPoints.length) return;
  socket.emit('stroke-point', { id: activeStroke.id, points: pendingPoints });
  pendingPoints = [];
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { sx: e.clientX, sy: e.clientY });

  if (pointers.size === 2) {
    endActiveStroke();
    previewShape = null; shapeStart = null;
    const [a, b] = [...pointers.values()];
    pinch = { d0: Math.hypot(a.sx - b.sx, a.sy - b.sy), zoom0: cam.zoom, mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
    return;
  }
  if (pointers.size > 2) return;

  const w = screenToWorld(e.clientX, e.clientY);
  if (tool === 'text') {
    showTextOverlay(w);
    pointers.delete(e.pointerId);
    return;
  } else if (tool === 'line' || tool === 'rect' || tool === 'circle') {
    shapeStart = w;
    previewShape = { tool, color, size: brushSize, points: [w.x, w.y, w.x, w.y] };
  } else if (tool !== 'pan') {
    activeStroke = { id: newStrokeId(), tool, color, size: brushSize, points: [w.x, w.y] };
    socket.emit('stroke-start', { ...activeStroke, points: [] });
  }
  dragLast = { sx: e.clientX, sy: e.clientY };
  sendCursor(e.clientX, e.clientY);
});

canvas.addEventListener('pointermove', (e) => {
  sendCursor(e.clientX, e.clientY);
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { sx: e.clientX, sy: e.clientY });

  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.sx - b.sx, a.sy - b.sy);
    const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
    const before = screenToWorld(mx, my);
    cam.zoom = Math.min(4, Math.max(0.2, pinch.zoom0 * (d / Math.max(1, pinch.d0))));
    const after = screenToWorld(mx, my);
    cam.x += before.x - after.x; cam.y += before.y - after.y;
    cam.x -= (mx - pinch.mx) / cam.zoom; cam.y -= (my - pinch.my) / cam.zoom;
    pinch.mx = mx; pinch.my = my;
    dirty = true;
    return;
  }

  const w = screenToWorld(e.clientX, e.clientY);

  if (tool === 'pan' && dragLast) {
    cam.x -= (e.clientX - dragLast.sx) / cam.zoom;
    cam.y -= (e.clientY - dragLast.sy) / cam.zoom;
    dragLast = { sx: e.clientX, sy: e.clientY };
    dirty = true;
    return;
  }
  if (previewShape && shapeStart) {
    previewShape.points = [shapeStart.x, shapeStart.y, w.x, w.y];
    dirty = true;
    return;
  }
  if (activeStroke) {
    const evts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evts) {
      const p = screenToWorld(ev.clientX, ev.clientY);
      activeStroke.points.push(p.x, p.y);
      pendingPoints.push(p.x, p.y);
    }
    dirty = true;
    if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; flushPoints(); }, 60);
  }
});

function endActiveStroke() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (activeStroke) {
    flushPoints();
    socket.emit('stroke-end', { id: activeStroke.id });
    strokes.set(activeStroke.id, activeStroke);
    myStrokeIds.push(activeStroke.id);
    redoStack.length = 0;
    activeStroke = null;
    dirty = true;
  }
}

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (previewShape && shapeStart) {
    const s = { id: newStrokeId(), tool: previewShape.tool, color, size: brushSize, points: previewShape.points.slice() };
    strokes.set(s.id, s);
    myStrokeIds.push(s.id); redoStack.length = 0;
    socket.emit('stroke-add', s);
    previewShape = null; shapeStart = null;
    dirty = true;
  }
  endActiveStroke();
  dragLast = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

let cursorTimer = 0;
function sendCursor(sx, sy) {
  const now = Date.now();
  if (now - cursorTimer < 120 || !socket) return;
  cursorTimer = now;
  const w = screenToWorld(sx, sy);
  socket.emit('cursor', { x: Math.round(w.x), y: Math.round(w.y) });
}

/* ================= text tool ================= */
let textWorld = null;
function showTextOverlay(w) {
  textWorld = w;
  $('#text-overlay').classList.remove('hidden');
  $('#inp-text').value = '';
  setTimeout(() => $('#inp-text').focus(), 50);
}
$('#btn-text-cancel').onclick = () => { $('#text-overlay').classList.add('hidden'); textWorld = null; };
$('#btn-text-ok').onclick = () => {
  const t = $('#inp-text').value.trim().slice(0, 200);
  $('#text-overlay').classList.add('hidden');
  if (!t || !textWorld) { textWorld = null; return; }
  const s = { id: newStrokeId(), tool: 'text', color, size: brushSize, text: t, x: textWorld.x, y: textWorld.y };
  strokes.set(s.id, s);
  myStrokeIds.push(s.id); redoStack.length = 0;
  socket.emit('stroke-add', s);
  textWorld = null;
  dirty = true;
};

/* ================= toolbar ================= */
document.querySelectorAll('.tool').forEach((btn) => {
  btn.onclick = () => {
    endActiveStroke();
    previewShape = null; shapeStart = null;
    document.querySelectorAll('.tool').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    tool = btn.dataset.tool;
    canvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
    dirty = true;
  };
});

const colorsRow = $('#colors-row');
function setColor(c) {
  color = c;
  document.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('active', x.dataset.color === c));
}
PALETTE.forEach((c) => {
  const b = document.createElement('button');
  b.className = 'swatch' + (c === color ? ' active' : '');
  b.style.background = c;
  b.dataset.color = c;
  b.onclick = () => setColor(c);
  colorsRow.appendChild(b);
});
const customWrap = document.createElement('label');
customWrap.className = 'swatch custom';
customWrap.title = 'custom color';
customWrap.innerHTML = '<input type="color" value="#ff2d55">';
customWrap.querySelector('input').oninput = (e) => {
  color = e.target.value;
  document.querySelectorAll('.swatch').forEach((x) => x.classList.remove('active'));
  customWrap.classList.add('active');
};
colorsRow.appendChild(customWrap);

$('#inp-size').oninput = (e) => { brushSize = Number(e.target.value); };

/* ================= top bar ================= */
$('#btn-theme').onclick = () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
$('#btn-undo').onclick = () => {
  const id = myStrokeIds.pop();
  if (!id) return toast('Nothing to undo');
  const s = strokes.get(id);
  strokes.delete(id);
  if (s) redoStack.push({ id, stroke: s });
  socket.emit('stroke-undo', { id });
  dirty = true;
};
$('#btn-redo').onclick = () => {
  const r = redoStack.pop();
  if (!r) return toast('Nothing to redo');
  strokes.set(r.id, r.stroke);
  myStrokeIds.push(r.id);
  socket.emit('stroke-add', r.stroke);
  dirty = true;
};
$('#btn-clear').onclick = () => {
  if (!confirm('Clear the whole canvas for both of you?')) return;
  strokes.clear(); myStrokeIds.length = 0; redoStack.length = 0;
  socket.emit('canvas-clear');
  dirty = true;
};
$('#btn-lock').onclick = async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
};

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ================= socket ================= */
function connectSocket() {
  socket = io();
  socket.on('connect_error', () => {
    // session expired or banned → back to the lock screen
    setTimeout(() => location.reload(), 800);
  });
  socket.on('canvas-state', ({ strokes: list, me, peers: peerList }) => {
    strokes.clear();
    for (const s of list) strokes.set(s.id, s);
    peers.clear();
    for (const p of peerList) peers.set(p.id, { ...p, last: 0 });
    dirty = true;
    if (me && me.name) toast(`Welcome back, ${me.name} 💕`);
  });
  socket.on('stroke-start', (s) => { strokes.set(s.id, { ...s, points: s.points || [] }); dirty = true; });
  socket.on('stroke-point', ({ id, points }) => {
    const s = strokes.get(id);
    if (s && s.points) { s.points.push(...points); dirty = true; }
  });
  socket.on('stroke-end', () => { dirty = true; });
  socket.on('stroke-add', (s) => {
    if (!strokes.has(s.id)) {
      strokes.set(s.id, s);
      const i = myStrokeIds.indexOf(s.id);
      if (i >= 0) myStrokeIds.splice(i, 1);
      dirty = true;
    }
  });
  socket.on('stroke-remove', ({ id }) => {
    strokes.delete(id);
    const i = myStrokeIds.indexOf(id);
    if (i >= 0) myStrokeIds.splice(i, 1);
    dirty = true;
  });
  socket.on('canvas-clear', () => {
    strokes.clear(); myStrokeIds.length = 0; redoStack.length = 0;
    toast('Canvas cleared');
    dirty = true;
  });
  socket.on('peer-cursor', ({ id, name, color: c, x, y }) => {
    peers.set(id, { name, color: c, x, y, last: Date.now() });
    dirty = true;
  });
  socket.on('peer-join', ({ id, name, color: c }) => {
    peers.set(id, { name, color: c, last: 0 });
    const el = $('#peer-toast');
    el.textContent = `${name} is here 💞`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 2500);
  });
  socket.on('peer-leave', ({ id }) => { peers.delete(id); dirty = true; });
}

/* ================= go ================= */
resize();
refreshThemeColors();
render();
boot();
})();
