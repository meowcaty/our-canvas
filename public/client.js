/* 🎨 Our Canvas — infinite collaborative whiteboard */
(() => {
'use strict';

const socket = io();
const $ = (s) => document.querySelector(s);

/* ================= home ================= */
const params = new URLSearchParams(location.search);
if (params.get('room')) $('#inp-join-code').value = params.get('room').toUpperCase();

$('#tab-create').onclick = () => {
  $('#tab-create').classList.add('active'); $('#tab-join').classList.remove('active');
  $('#pane-create').classList.remove('hidden'); $('#pane-join').classList.add('hidden');
};
$('#tab-join').onclick = () => {
  $('#tab-join').classList.add('active'); $('#tab-create').classList.remove('active');
  $('#pane-join').classList.remove('hidden'); $('#pane-create').classList.add('hidden');
};

const homeError = (msg) => { $('#home-error').textContent = msg || ''; };
const myName = () => $('#inp-name').value.trim().slice(0, 16);

$('#btn-create').onclick = () => {
  const name = myName();
  if (!name) return homeError('Enter your name first 🎨');
  const pass = $('#inp-create-pass').value;
  socket.emit('create-room', { name, password: pass }, (res) => {
    if (!res.ok) return homeError(res.error);
    enterRoom(res.code, name);
  });
};
$('#btn-join').onclick = () => {
  const name = myName();
  if (!name) return homeError('Enter your name first 🎨');
  socket.emit('join-room', {
    code: $('#inp-join-code').value.trim().toUpperCase(),
    name,
    password: $('#inp-join-pass').value,
  }, (res) => {
    if (!res.ok) return homeError(res.error);
    enterRoom(res.code, name);
  });
};

/* ================= room state ================= */
let roomCode = null;
const cam = { x: 0, y: 0, zoom: 1 };
const strokes = new Map();          // id -> stroke
const peers = new Map();            // socketId -> {name,color,x,y,last}
const myStrokeIds = [];             // my strokes, creation order (for undo)
const redoStack = [];               // {id, stroke}
let strokeSeq = 0;
let dirty = true;

let tool = 'pen';
let color = '#ffffff';
let brushSize = 8;

const PALETTE = ['#ffffff', '#111111', '#ff5d8f', '#ff7a59', '#ffb84d', '#ffee58',
  '#7dde92', '#4da3ff', '#9b6bff', '#c792ea', '#5dd4d4', '#ff9ecb'];

function enterRoom(code, name) {
  roomCode = code;
  $('#screen-home').classList.add('hidden');
  $('#screen-room').classList.remove('hidden');
  $('#room-code').textContent = code;
  history.replaceState(null, '', `?room=${code}`);
  toast(`Welcome, ${name}! 💞`);
  resize();
}

/* ================= canvas ================= */
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
    ctx.font = `${s.size * 2.2}px -apple-system, "Segoe UI", sans-serif`;
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

  // tap = dot
  if (s.points && s.points.length < 4 && s.points.length >= 2) {
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
  ctx.clearRect(0, 0, cssW, cssH);
  applyCam();

  // dot grid — sells the "infinite" feel while panning
  const step = 90;
  const x0 = cam.x - cssW / 2 / cam.zoom, x1 = cam.x + cssW / 2 / cam.zoom;
  const y0 = cam.y - cssH / 2 / cam.zoom, y1 = cam.y + cssH / 2 / cam.zoom;
  ctx.fillStyle = 'rgba(185,168,214,0.16)';
  for (let gx = Math.floor(x0 / step) * step; gx <= x1; gx += step)
    for (let gy = Math.floor(y0 / step) * step; gy <= y1; gy += step) {
      ctx.beginPath(); ctx.arc(gx, gy, 1.4, 0, Math.PI * 2); ctx.fill();
    }

  for (const s of strokes.values()) drawStroke(s);
  if (activeStroke && activeStroke.points.length >= 2) drawStroke(activeStroke);

  // shape preview
  if (previewShape) {
    ctx.save();
    ctx.setLineDash([10 / cam.zoom, 8 / cam.zoom]);
    drawStroke({ ...previewShape, color: previewShape.color });
    ctx.restore();
  }

  // partner cursors
  const now = Date.now();
  ctx.textBaseline = 'top';
  for (const [id, p] of peers) {
    if (now - p.last > 4000 || p.x === undefined) continue;
    const fade = Math.max(0.25, 1 - (now - p.last) / 4000);
    ctx.save(); ctx.globalAlpha = fade;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 7 / cam.zoom, 0, Math.PI * 2); ctx.fill();
    ctx.font = `${13 / cam.zoom}px -apple-system, sans-serif`;
    const w = ctx.measureText(p.name).width;
    ctx.fillStyle = 'rgba(20,16,31,0.85)';
    const bx = p.x + 12 / cam.zoom, by = p.y + 12 / cam.zoom;
    const pad = 6 / cam.zoom, h = 20 / cam.zoom;
    ctx.beginPath(); ctx.roundRect(bx, by, w + pad * 2, h, h / 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(p.name, bx + pad, by + pad * 0.7);
    ctx.restore();
  }
}

/* ================= input ================= */
const pointers = new Map();   // pointerId -> {sx, sy}
let activeStroke = null;      // local stroke being drawn
let pendingPoints = [];       // batched for network
let flushTimer = null;
let previewShape = null;
let shapeStart = null;
let pinch = null;

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
    // switch to pinch gesture — commit any in-progress stroke first
    endActiveStroke();
    previewShape = null; shapeStart = null;
    const [a, b] = [...pointers.values()];
    pinch = { d0: Math.hypot(a.sx - b.sx, a.sy - b.sy), zoom0: cam.zoom, mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
    return;
  }
  if (pointers.size > 2) return;

  const w = screenToWorld(e.clientX, e.clientY);
  if (tool === 'pan') { /* single-finger pan handled in move via drag state */ }
  else if (tool === 'text') {
    showTextOverlay(e.clientX, e.clientY, w);
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

let dragLast = null;

canvas.addEventListener('pointermove', (e) => {
  sendCursor(e.clientX, e.clientY);
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  pointers.set(e.pointerId, { sx: e.clientX, sy: e.clientY });

  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.sx - b.sx, a.sy - b.sy);
    const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
    // zoom around midpoint
    const before = screenToWorld(mx, my);
    cam.zoom = Math.min(4, Math.max(0.2, pinch.zoom0 * (d / Math.max(1, pinch.d0))));
    const after = screenToWorld(mx, my);
    cam.x += before.x - after.x; cam.y += before.y - after.y;
    // pan by midpoint drift
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

/* partner cursor, throttled */
let cursorTimer = 0;
function sendCursor(sx, sy) {
  const now = Date.now();
  if (now - cursorTimer < 120 || !roomCode) return;
  cursorTimer = now;
  const w = screenToWorld(sx, sy);
  socket.emit('cursor', { x: Math.round(w.x), y: Math.round(w.y) });
}

/* ================= text tool ================= */
let textWorld = null;
function showTextOverlay(sx, sy, w) {
  textWorld = w;
  const ov = $('#text-overlay');
  ov.classList.remove('hidden');
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
PALETTE.forEach((c) => {
  const b = document.createElement('button');
  b.className = 'swatch' + (c === color ? ' active' : '');
  b.style.background = c;
  b.onclick = () => {
    document.querySelectorAll('.swatch').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    color = c;
  };
  colorsRow.appendChild(b);
});
const customWrap = document.createElement('label');
customWrap.className = 'swatch custom';
customWrap.title = 'custom color';
customWrap.innerHTML = '<input type="color" value="#ff5d8f">';
customWrap.querySelector('input').oninput = (e) => {
  document.querySelectorAll('.swatch').forEach((x) => x.classList.remove('active'));
  customWrap.classList.add('active');
  color = e.target.value;
};
colorsRow.appendChild(customWrap);

$('#inp-size').oninput = (e) => { brushSize = Number(e.target.value); };

/* ================= top bar ================= */
$('#btn-undo').onclick = () => {
  const id = myStrokeIds.pop();
  if (!id) return toast('Nothing to undo 🙈');
  const s = strokes.get(id);
  strokes.delete(id);
  if (s) redoStack.push({ id, stroke: s });
  socket.emit('stroke-undo', { id });
  dirty = true;
};
$('#btn-redo').onclick = () => {
  const r = redoStack.pop();
  if (!r) return toast('Nothing to redo 🙈');
  strokes.set(r.id, r.stroke);
  myStrokeIds.push(r.id);
  socket.emit('stroke-add', r.stroke);
  dirty = true;
};
$('#btn-clear').onclick = () => {
  if (!confirm('Clear the whole canvas for both of you? 🧹')) return;
  strokes.clear(); myStrokeIds.length = 0; redoStack.length = 0;
  socket.emit('canvas-clear');
  dirty = true;
};
$('#chip-code').onclick = () => {
  const link = `${location.origin}${location.pathname}?room=${roomCode}`;
  navigator.clipboard.writeText(link).then(
    () => toast('Invite link copied! Send it to your person 💌'),
    () => toast(`Room code: ${roomCode}`));
};

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ================= socket events ================= */
socket.on('canvas-state', ({ strokes: list, peers: peerList }) => {
  strokes.clear();
  for (const s of list) strokes.set(s.id, s);
  peers.clear();
  for (const p of peerList) peers.set(p.id, { ...p, last: 0 });
  dirty = true;
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
    if (i >= 0) myStrokeIds.splice(i, 1); // my own redo echo
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
  toast('Canvas cleared 🧹');
  dirty = true;
});
socket.on('peer-cursor', ({ id, name, color: c, x, y }) => {
  peers.set(id, { name, color: c, x, y, last: Date.now() });
  dirty = true;
});
socket.on('peer-join', ({ id, name, color: c }) => {
  peers.set(id, { name, color: c, last: 0 });
  const el = $('#peer-toast');
  el.textContent = `${name} joined 💞`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
});
socket.on('peer-leave', ({ id }) => { peers.delete(id); dirty = true; });

/* ================= go ================= */
resize();
render();
})();
