/* 🎨 Our Canvas — one private infinite canvas for two */
(() => {
'use strict';

const $ = (s) => document.querySelector(s);
const G = window.gsap || null; // animations degrade gracefully if the CDN is blocked
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
  $('#ic-moon').classList.toggle('hidden', t !== 'dark');
  $('#ic-sun').classList.toggle('hidden', t !== 'light');
  document.querySelector('meta[name="theme-color"]').content = t === 'dark' ? '#000000' : '#f2f2f7';
  refreshThemeColors();
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

function showOnly(id) {
  for (const s of ['screen-lock', 'screen-name', 'screen-canvas']) {
    $('#' + s).classList.toggle('hidden', s !== id);
  }
  if (G) {
    const card = document.querySelector('#' + id + ' .lock-card');
    if (card) G.fromTo(card, { y: 26, opacity: 0, scale: .98 }, { y: 0, opacity: 1, scale: 1, duration: .7, ease: 'power3.out' });
  }
}
function showLockScreen() {
  showOnly('screen-lock');
  setTimeout(() => { try { lockOtp.clear(); } catch {} }, 100);
}
function showNameScreen() {
  showOnly('screen-name');
  if (myName) $('#inp-myname').value = myName;
  setTimeout(() => $('#inp-myname').focus(), 100);
}
function shakeEl(sel) {
  if (G) G.fromTo(sel, { x: 0 }, { x: -12, duration: .06, repeat: 5, yoyo: true, clearProps: 'x', ease: 'power1.inOut' });
}
function shakeCard() { shakeEl('#screen-lock .lock-card'); }

/* 8-digit OTP entry — auto-advances, auto-submits when complete.
   iOS-style privacy: each digit shows briefly, then masks to • with a subtle
   pop. An eye toggle reveals the digits as plain numbers.
   Digits live in dataset.d; the visible value may be masked, so value()
   reads the dataset, never the display text.
   Reusable: wireOtpBoxes(container, onComplete) -> {value, clear}. */
const MASK_DELAY = 650;
function wireOtpBoxes(container, onComplete) {
  const inputs = [...container.querySelectorAll('.otp')];
  const eyeBtn = container.parentElement.querySelector('.eye-btn');
  let busy = false;
  let revealed = false;
  const timers = new Map();

  const cancelMask = (inp) => {
    const t = timers.get(inp);
    if (t) { clearTimeout(t); timers.delete(inp); }
  };
  const maskDigit = (inp) => {
    cancelMask(inp);
    if (!inp.dataset.d) { inp.value = ''; return; }
    if (revealed) { inp.value = inp.dataset.d; return; }
    inp.value = '•';
    inp.classList.remove('mask-pop');
    void inp.offsetWidth; // restart the pop animation
    inp.classList.add('mask-pop');
  };
  const scheduleMask = (inp) => {
    cancelMask(inp);
    if (!revealed && inp.dataset.d) timers.set(inp, setTimeout(() => maskDigit(inp), MASK_DELAY));
  };
  const setDigit = (inp, ch) => {
    cancelMask(inp);
    inp.classList.remove('mask-pop');
    if (ch) { inp.dataset.d = ch; inp.value = ch; scheduleMask(inp); }
    else { delete inp.dataset.d; inp.value = ''; }
  };

  const box = {
    value: () => inputs.map((i) => i.dataset.d || '').join(''),
    clear(focusFirst = true) {
      inputs.forEach((i) => { cancelMask(i); delete i.dataset.d; i.value = ''; i.classList.remove('mask-pop'); });
      busy = false;
      if (focusFirst && inputs[0]) inputs[0].focus();
    },
  };
  const maybeDone = () => {
    if (!busy && inputs.every((i) => i.dataset.d)) {
      busy = true;
      // mask everything right away so no digit lingers on screen while we wait
      inputs.forEach(maskDigit);
      onComplete(box.value(), box);
    }
  };
  const refreshEye = () => {
    if (!eyeBtn) return;
    eyeBtn.classList.toggle('on', revealed);
    eyeBtn.setAttribute('aria-label', revealed ? 'Hide password' : 'Show password');
    eyeBtn.setAttribute('aria-pressed', revealed ? 'true' : 'false');
    const eye = eyeBtn.querySelector('.ic-eye'), eyeOff = eyeBtn.querySelector('.ic-eye-off');
    if (eye) eye.classList.toggle('hidden', revealed);
    if (eyeOff) eyeOff.classList.toggle('hidden', !revealed);
  };
  if (eyeBtn) {
    refreshEye();
    eyeBtn.addEventListener('click', () => {
      revealed = !revealed;
      inputs.forEach((inp) => { cancelMask(inp); if (inp.dataset.d) inp.value = revealed ? inp.dataset.d : '•'; });
      refreshEye();
      const firstEmpty = inputs.find((i) => !i.dataset.d);
      (firstEmpty || inputs[inputs.length - 1]).focus();
    });
  }

  inputs.forEach((inp, idx) => {
    inp.addEventListener('input', () => {
      // value may currently be the '•' mask — strip it before reading the new digit
      const ch = inp.value.replace(/•/g, '').replace(/\D/g, '').slice(-1);
      setDigit(inp, ch);
      if (ch && idx < inputs.length - 1) inputs[idx + 1].focus();
      maybeDone();
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Backspace') return;
      e.preventDefault();
      if (inp.dataset.d) {
        setDigit(inp, ''); // filled (maybe masked): clear this box, stay put
      } else if (idx > 0) {
        setDigit(inputs[idx - 1], ''); // empty: step back and clear the previous box
        inputs[idx - 1].focus();
      }
    });
    inp.addEventListener('paste', (e) => {
      e.preventDefault();
      const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, inputs.length);
      digits.split('').forEach((ch, k) => { if (inputs[idx + k]) setDigit(inputs[idx + k], ch); });
      inputs[Math.min(idx + digits.length, inputs.length - 1)].focus();
      maybeDone();
    });
    inp.addEventListener('focus', () => inp.select());
  });
  return box;
}

const lockOtp = wireOtpBoxes($('#otp-row'), (pw) => doUnlock(pw));

async function doUnlock(pw) {
  if (!pw || pw.length !== 8) { lockOtp.clear(); return; }
  $('#lock-error').textContent = '';
  const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: pw }) });
  if (r.ok) {
    lockOtp.clear(false);
    const me = await api('/api/me');
    if (me.ok && me.name) { myName = me.name; enterCanvas(); }
    else showNameScreen();
  } else if (r.banned) {
    $('#lock-form').classList.add('hidden');
    $('#lock-blocked').classList.remove('hidden');
    $('#blocked-msg').textContent = r.error;
  } else {
    shakeCard();
    lockOtp.clear();
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
let textSize = 18; // text defaults to a phone-readable size (font ≈ size × 2.2)
function currentSize() { return tool === 'text' ? textSize : brushSize; }

const PALETTE = ['#ffffff', '#1c1c1e', '#ff2d55', '#ff7a59', '#ff9f0a', '#ffcc00',
  '#30d158', '#0a84ff', '#bf5af2', '#64d2ff', '#ff6482', '#ac8e68'];

function enterCanvas() {
  showOnly('screen-canvas');
  resize();
  updateRing();
  if (G) {
    G.fromTo('#topbar', { y: -34, opacity: 0 }, { y: 0, opacity: 1, duration: .6, ease: 'power3.out', delay: .05 });
    G.fromTo('#toolbar', { y: 70, opacity: 0 }, { y: 0, opacity: 1, duration: .65, ease: 'power3.out', delay: .15 });
    G.fromTo('#toolbar .tool', { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: .45, ease: 'back.out(1.8)', stagger: .035, delay: .3, clearProps: 'scale,opacity' });
  }
  if (!socket) {
    // canvas content arrives over the socket — playful loader until it does
    $('#canvas-loader').classList.remove('hidden');
    connectSocket();
  }
}

function hideLoader() {
  const l = $('#canvas-loader');
  if (!l || l.classList.contains('hidden')) return;
  if (G) G.to(l, { opacity: 0, duration: .45, ease: 'power2.out', onComplete: () => { l.classList.add('hidden'); l.style.opacity = ''; } });
  else l.classList.add('hidden');
}

/* persistent server connection indicator */
let firstConn = true;
function setConn(state) {
  const pill = $('#conn-pill'), txt = $('#conn-text');
  if (!pill || !txt) return;
  pill.classList.remove('live', 'connecting', 'offline');
  pill.classList.add(state);
  txt.textContent = state === 'live' ? 'Live' : state === 'connecting' ? 'Reconnecting…' : 'Offline';
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
function worldToScreen(w) {
  return { x: (w.x - cam.x) * cam.zoom + cssW / 2, y: (w.y - cam.y) * cam.zoom + cssH / 2 };
}

/* ================= rendering ================= */
function tracePath(s) {
  const p = s.points;
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
}

function drawStroke(s) {
  // A real eraser: paints the canvas background back over ink.
  const C = s.tool === 'eraser' ? themeColors.bg : s.color;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  if (s.tool === 'text') {
    ctx.fillStyle = C;
    ctx.font = `${s.size * 2.2}px -apple-system, "SF Pro Text", sans-serif`;
    // Pin the baseline explicitly: glyphs hang below (s.x, s.y).
    // (Previously this relied on leftover context state from the peer-name
    //  labels, which also made the selection box disagree with the render.)
    ctx.textBaseline = 'top';
    ctx.fillText(s.text, s.x, s.y);
    ctx.restore();
    return;
  }
  if (s.tool === 'line' || s.tool === 'rect' || s.tool === 'circle') {
    ctx.strokeStyle = C; ctx.lineWidth = s.size; ctx.globalAlpha = 1;
    const [x1, y1, x2, y2] = s.points;
    ctx.beginPath();
    if (s.tool === 'line') { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    else if (s.tool === 'rect') ctx.rect(x1, y1, x2 - x1, y2 - y1);
    else ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (!s.points || s.points.length < 2) { ctx.restore(); return; }

  if (s.points.length < 4) { // tap = dot
    ctx.fillStyle = C;
    ctx.globalAlpha = s.tool === 'highlighter' ? 0.32 : 1;
    ctx.beginPath();
    ctx.arc(s.points[0], s.points[1], (s.size * (s.tool === 'eraser' ? 2.2 : 1)) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const passes = s.tool === 'neon'
    ? [[3.2, 0.20, C], [1.8, 0.45, C], [1.0, 1, C], [0.45, 0.9, '#ffffff']]
    : s.tool === 'pencil'   ? [[0.55, 0.7, C]]
    : s.tool === 'marker'   ? [[1.7, 0.95, C]]
    : s.tool === 'highlighter' ? [[2.8, 0.32, C]]
    : s.tool === 'eraser'   ? [[2.2, 1, C]]
    : [[1.0, 1, C]];

  for (const [wm, alpha, col] of passes) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = col;
    ctx.lineWidth = s.size * wm;
    tracePath(s);
    ctx.stroke();
  }
  ctx.restore();
}

function easeOutBack(t) {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

function drawSelection(now) {
  const s = strokes.get(selectedId);
  if (!s) return;
  const k = easeOutBack(Math.max(0, Math.min(1, (now - selectedAt) / 280)));
  const b = shapeBBox(s);
  const pad = 12 / cam.zoom;
  ctx.save();
  ctx.strokeStyle = '#0a84ff';
  ctx.lineWidth = 2 / cam.zoom;
  if (s.tool === 'line') {
    const [x1, y1, x2, y2] = s.points;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  } else {
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
  }
  for (const h of selectionHandles(s)) {
    const r = Math.max(0.1, (8 / cam.zoom) * k);
    ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.lineWidth = 2 / cam.zoom; ctx.strokeStyle = '#0a84ff'; ctx.stroke();
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

  if (selectedId) {
    drawSelection(performance.now());
    positionDeleteBtn();
    // keep frames coming while the selection pop-in animates
    if (performance.now() - selectedAt < 320) dirty = true;
  }

  const now = Date.now();
  ctx.textBaseline = 'top';
  let peerMoving = false;
  for (const [, p] of peers) {
    if (now - p.last > 4000 || p.x === undefined) continue;
    // buttery cursor: ease toward the latest known position
    const dx = p.tx - p.x, dy = p.ty - p.y;
    if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) {
      p.x += dx * 0.35; p.y += dy * 0.35;
      peerMoving = true;
    }
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
  if (peerMoving) dirty = true;
}

/* ================= selection: tap to select, drag to move, handles to resize ================= */
const SELECTABLE = ['line', 'rect', 'circle', 'text'];
let selectedId = null;
let selectedAt = 0;

function textMetrics(s) {
  const fs = s.size * 2.2;
  ctx.font = `${fs}px -apple-system, "SF Pro Text", sans-serif`;
  return { w: Math.max(12, ctx.measureText(s.text || ' ').width), h: fs };
}
function shapeBBox(s) {
  if (s.tool === 'text') {
    // Must match drawStroke: textBaseline 'top' means the em box starts at
    // (s.x, s.y) and glyphs extend downward — not above the point.
    const { w, h } = textMetrics(s);
    return { x: s.x, y: s.y, w, h };
  }
  const [x1, y1, x2, y2] = s.points;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}
function selectionHandles(s) {
  if (s.tool === 'line') {
    const [x1, y1, x2, y2] = s.points;
    return [{ x: x1, y: y1, corner: 0 }, { x: x2, y: y2, corner: 1 }];
  }
  const b = shapeBBox(s);
  return [
    { x: b.x, y: b.y, corner: 'tl' },
    { x: b.x + b.w, y: b.y, corner: 'tr' },
    { x: b.x, y: b.y + b.h, corner: 'bl' },
    { x: b.x + b.w, y: b.y + b.h, corner: 'br' },
  ];
}
function oppositeCorner(b, corner) {
  switch (corner) {
    case 'tl': return { x: b.x + b.w, y: b.y + b.h };
    case 'tr': return { x: b.x, y: b.y + b.h };
    case 'bl': return { x: b.x + b.w, y: b.y };
    default: return { x: b.x, y: b.y };
  }
}
function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function hitSelectable(w) {
  const pad = 16 / cam.zoom;
  const arr = [...strokes.values()];
  for (let i = arr.length - 1; i >= 0; i--) {
    const s = arr[i];
    if (!SELECTABLE.includes(s.tool)) continue;
    if (s.tool === 'line') {
      const [x1, y1, x2, y2] = s.points;
      if (distToSeg(w, { x: x1, y: y1 }, { x: x2, y: y2 }) < Math.max(pad, s.size)) return s;
    } else {
      const b = shapeBBox(s);
      if (w.x > b.x - pad && w.x < b.x + b.w + pad && w.y > b.y - pad && w.y < b.y + b.h + pad) return s;
    }
  }
  return null;
}
function hitHandle(w) {
  const s = strokes.get(selectedId);
  if (!s) return null;
  const r = 22 / cam.zoom;
  for (const h of selectionHandles(s)) {
    if (Math.hypot(w.x - h.x, w.y - h.y) < r) return h;
  }
  return null;
}
function insideSelection(w) {
  const s = strokes.get(selectedId);
  if (!s) return false;
  if (s.tool === 'line') {
    const [x1, y1, x2, y2] = s.points;
    return distToSeg(w, { x: x1, y: y1 }, { x: x2, y: y2 }) < Math.max(16 / cam.zoom, s.size);
  }
  const b = shapeBBox(s);
  const pad = 12 / cam.zoom;
  return w.x > b.x - pad && w.x < b.x + b.w + pad && w.y > b.y - pad && w.y < b.y + b.h + pad;
}

function select(id) {
  selectedId = id;
  selectedAt = performance.now();
  const btn = $('#btn-delete');
  btn.classList.remove('hidden');
  if (G) G.fromTo(btn, { scale: .3, opacity: 0 }, { scale: 1, opacity: 1, duration: .38, ease: 'back.out(2.2)', clearProps: 'scale' });
  positionDeleteBtn();
  dirty = true;
}
function deselect() {
  if (!selectedId) return;
  selectedId = null;
  $('#btn-delete').classList.add('hidden');
  dirty = true;
}
function positionDeleteBtn() {
  const s = strokes.get(selectedId);
  const btn = $('#btn-delete');
  if (!s) { btn.classList.add('hidden'); return; }
  const b = shapeBBox(s);
  const p = worldToScreen({ x: b.x + b.w, y: b.y });
  btn.style.left = (p.x + 8) + 'px';
  btn.style.top = (p.y - 52) + 'px';
}

$('#btn-delete').onclick = () => {
  const s = strokes.get(selectedId);
  if (!s) return deselect();
  // shared canvas: either of you can delete anything
  strokes.delete(s.id);
  const i = myStrokeIds.indexOf(s.id);
  if (i >= 0) myStrokeIds.splice(i, 1);
  redoStack.push({ id: s.id, stroke: s });
  socket.emit('stroke-delete', { id: s.id });
  deselect();
  toast('Deleted — redo brings it back');
  dirty = true;
};

/* ---- live transform sync (throttled, volatile mid-gesture, guaranteed final) ---- */
let xformTimer = null;
function transformPatch(s) {
  return s.tool === 'text'
    ? { x: s.x, y: s.y, size: s.size }
    : { points: s.points.slice() };
}
function emitTransform(s, final) {
  if (!socket || !s) return;
  const msg = { id: s.id, ...transformPatch(s) };
  if (final) socket.emit('stroke-transform', msg);
  else socket.volatile.emit('stroke-transform', msg);
}
function scheduleTransform(s) {
  if (xformTimer) return;
  xformTimer = setTimeout(() => { xformTimer = null; emitTransform(s, false); }, 40);
}
function finalizeTransform(s) {
  if (xformTimer) { clearTimeout(xformTimer); xformTimer = null; }
  emitTransform(s, true);
}
function applyMove(s, dx, dy) {
  if (s.tool === 'text') { s.x += dx; s.y += dy; }
  else for (let i = 0; i < s.points.length; i += 2) { s.points[i] += dx; s.points[i + 1] += dy; }
}
function applyResize(s, g, curW) {
  if (s.tool === 'line') {
    const i = g.handle.corner === 0 ? 0 : 2;
    let nx = curW.x, ny = curW.y;
    const fx = s.points[i === 0 ? 2 : 0], fy = s.points[i === 0 ? 3 : 1];
    const len = Math.hypot(nx - fx, ny - fy);
    if (len < 8 && len > 0.01) { nx = fx + ((nx - fx) / len) * 8; ny = fy + ((ny - fy) / len) * 8; }
    s.points[i] = nx; s.points[i + 1] = ny;
    return;
  }
  if (s.tool === 'text') {
    const o = g.opposite;
    const d0 = Math.hypot(g.startW.x - o.x, g.startW.y - o.y) || 1;
    const d1 = Math.hypot(curW.x - o.x, curW.y - o.y);
    const k = Math.max(0.25, Math.min(5, d1 / d0));
    s.size = Math.min(200, Math.max(4, g.orig.size * k));
    s.x = o.x + (g.orig.x - o.x) * k;
    s.y = o.y + (g.orig.y - o.y) * k;
    return;
  }
  // rect / circle: map original geometry into the new bbox
  const b0 = g.bbox0, o = g.opposite;
  let nx = curW.x, ny = curW.y;
  if (Math.abs(nx - o.x) < 10) nx = o.x + (nx >= o.x ? 10 : -10);
  if (Math.abs(ny - o.y) < 10) ny = o.y + (ny >= o.y ? 10 : -10);
  const nb = { x: Math.min(o.x, nx), y: Math.min(o.y, ny), w: Math.abs(nx - o.x), h: Math.abs(ny - o.y) };
  const [x1, y1, x2, y2] = b0.pts;
  const map = (px, py) => [
    nb.x + (b0.w ? (px - b0.x) / b0.w : 0) * nb.w,
    nb.y + (b0.h ? (py - b0.y) / b0.h : 0) * nb.h,
  ];
  const [ax, ay] = map(x1, y1), [bx, by] = map(x2, y2);
  s.points = [ax, ay, bx, by];
}

/* ================= input ================= */
const pointers = new Map();
let activeStroke = null;   // local stroke being drawn (network start deferred to first move)
let strokeStarted = false; // whether stroke-start was emitted for activeStroke
let pendingPoints = [];
let flushTimer = null;
let previewShape = null;
let shapeStart = null;
let pinch = null;
let gesture = null; // tap-candidate | drawing | shape-preview | move-sel | resize-sel | pan-drag

const TAP_SLOP = 8;   // px on screen
const TAP_MS = 600;

function newStrokeId() { return `${socket.id}:${strokeSeq++}`; }
function flushPoints() {
  if (!activeStroke || !strokeStarted || !pendingPoints.length) return;
  socket.emit('stroke-point', { id: activeStroke.id, points: pendingPoints });
  pendingPoints = [];
}
function beginNetworkStroke() {
  if (!activeStroke || strokeStarted) return;
  strokeStarted = true;
  socket.emit('stroke-start', { ...activeStroke, points: activeStroke.points.slice() });
}
function endActiveStroke() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (activeStroke) {
    if (strokeStarted) {
      flushPoints();
      socket.emit('stroke-end', { id: activeStroke.id });
    }
    strokes.set(activeStroke.id, activeStroke);
    myStrokeIds.push(activeStroke.id);
    redoStack.length = 0;
    activeStroke = null;
    strokeStarted = false;
    dirty = true;
  }
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { sx: e.clientX, sy: e.clientY });

  if (pointers.size === 2) {
    if (gesture && (gesture.kind === 'move-sel' || gesture.kind === 'resize-sel') && gesture.s) finalizeTransform(gesture.s);
    endActiveStroke();
    previewShape = null; shapeStart = null; gesture = null;
    hideRing();
    const [a, b] = [...pointers.values()];
    pinch = { d0: Math.hypot(a.sx - b.sx, a.sy - b.sy), zoom0: cam.zoom, mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
    return;
  }
  if (pointers.size > 2) return;

  const w = screenToWorld(e.clientX, e.clientY);

  // selection interactions take priority
  if (selectedId) {
    const h = hitHandle(w);
    if (h) {
      const s = strokes.get(selectedId);
      // shared canvas: either of you can resize anything
      const b = shapeBBox(s);
      gesture = {
        kind: 'resize-sel', s, handle: h,
        startW: w, opposite: s.tool === 'line' ? null : oppositeCorner(b, h.corner),
        bbox0: { ...b, pts: s.points ? s.points.slice() : null },
        orig: s.tool === 'text' ? { x: s.x, y: s.y, size: s.size } : null,
      };
      hideRing();
      return;
    }
    if (insideSelection(w)) {
      const s = strokes.get(selectedId);
      // shared canvas: either of you can move anything
      gesture = { kind: 'move-sel', s, lastW: w };
      hideRing();
      return;
    }
  }

  // tapping an existing shape/text selects it instead of starting new input —
  // so tap-to-select works even with the text tool active
  if (tool !== 'pan') {
    const hit = hitSelectable(w);
    if (hit) {
      activeStroke = null; strokeStarted = false;
      previewShape = null; shapeStart = null;
      select(hit.id);
      pointers.delete(e.pointerId);
      return;
    }
  }

  if (tool === 'text') {
    deselect();
    showTextOverlay(w, e.clientX, e.clientY);
    pointers.delete(e.pointerId);
    return;
  }
  if (tool === 'pan') {
    deselect();
    gesture = { kind: 'pan-drag', sx: e.clientX, sy: e.clientY };
    return;
  }
  // brush or shape tool → tap-candidate (tap selects, drag draws)
  gesture = { kind: 'tap-candidate', sx: e.clientX, sy: e.clientY, t: Date.now() };
  if (tool === 'line' || tool === 'rect' || tool === 'circle') {
    shapeStart = w;
    previewShape = { tool, color, size: brushSize, points: [w.x, w.y, w.x, w.y] };
  } else {
    activeStroke = { id: newStrokeId(), tool, color, size: brushSize, points: [w.x, w.y] };
    strokeStarted = false;
    dirty = true; // local ink appears instantly; network follows on first move
  }
  sendCursor(e.clientX, e.clientY);
});

canvas.addEventListener('pointermove', (e) => {
  sendCursor(e.clientX, e.clientY);
  if (!pointers.has(e.pointerId)) { moveRing(e.clientX, e.clientY); return; }
  pointers.set(e.pointerId, { sx: e.clientX, sy: e.clientY });
  moveRing(e.clientX, e.clientY);

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
    updateRing();
    return;
  }

  if (!gesture) return;
  const w = screenToWorld(e.clientX, e.clientY);

  if (gesture.kind === 'pan-drag') {
    cam.x -= (e.clientX - gesture.sx) / cam.zoom;
    cam.y -= (e.clientY - gesture.sy) / cam.zoom;
    gesture.sx = e.clientX; gesture.sy = e.clientY;
    dirty = true;
    return;
  }
  if (gesture.kind === 'move-sel') {
    const dx = w.x - gesture.lastW.x, dy = w.y - gesture.lastW.y;
    gesture.lastW = w;
    applyMove(gesture.s, dx, dy);
    scheduleTransform(gesture.s);
    dirty = true;
    return;
  }
  if (gesture.kind === 'resize-sel') {
    applyResize(gesture.s, gesture, w);
    scheduleTransform(gesture.s);
    dirty = true;
    return;
  }
  if (gesture.kind === 'tap-candidate') {
    const moved = Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy);
    if (moved < TAP_SLOP) return;
    // it's a drag, not a tap
    deselect();
    if (previewShape && shapeStart) {
      gesture.kind = 'shape-preview';
    } else if (activeStroke) {
      gesture.kind = 'drawing';
    } else {
      gesture = null; return;
    }
  }
  if (gesture.kind === 'shape-preview' && previewShape && shapeStart) {
    previewShape.points = [shapeStart.x, shapeStart.y, w.x, w.y];
    dirty = true;
    return;
  }
  if (gesture.kind === 'drawing' && activeStroke) {
    const evts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evts) {
      const p = screenToWorld(ev.clientX, ev.clientY);
      activeStroke.points.push(p.x, p.y);
      pendingPoints.push(p.x, p.y);
    }
    beginNetworkStroke(); // first move → peer starts seeing the stroke, with initial points bundled
    dirty = true;
    if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; flushPoints(); }, 30);
  }
});

function finishGesture(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  const g = gesture;
  gesture = null;

  if (!g) return;
  if (g.kind === 'move-sel' || g.kind === 'resize-sel') {
    if (g.s) finalizeTransform(g.s);
    dirty = true;
    return;
  }
  if (g.kind === 'shape-preview' && previewShape && shapeStart) {
    const s = { id: newStrokeId(), tool: previewShape.tool, color, size: brushSize, points: previewShape.points.slice() };
    strokes.set(s.id, s);
    myStrokeIds.push(s.id); redoStack.length = 0;
    socket.emit('stroke-add', s);
    previewShape = null; shapeStart = null;
    dirty = true;
    return;
  }
  if (g.kind === 'drawing') {
    endActiveStroke();
    return;
  }
  if (g.kind === 'tap-candidate') {
    // a real tap → maybe select, maybe dot, maybe deselect
    const w = screenToWorld(e.clientX, e.clientY);
    const hit = hitSelectable(w);
    if (hit) {
      activeStroke = null; previewShape = null; shapeStart = null;
      if (selectedId !== hit.id) select(hit.id);
      return;
    }
    deselect();
    if (activeStroke && !strokeStarted) {
      // tap with a brush on empty canvas = dot
      const s = { ...activeStroke, points: activeStroke.points.slice() };
      strokes.set(s.id, s);
      myStrokeIds.push(s.id); redoStack.length = 0;
      socket.emit('stroke-add', s);
      activeStroke = null;
      dirty = true;
    } else {
      activeStroke = null; previewShape = null; shapeStart = null;
    }
  }
}
canvas.addEventListener('pointerup', finishGesture);
canvas.addEventListener('pointercancel', finishGesture);
canvas.addEventListener('pointerleave', hideRing);

let cursorTimer = 0;
function sendCursor(sx, sy) {
  const now = Date.now();
  if (now - cursorTimer < 50 || !socket) return;
  cursorTimer = now;
  const w = screenToWorld(sx, sy);
  socket.volatile.emit('cursor', { x: Math.round(w.x), y: Math.round(w.y) });
}

/* ================= text tool ================= */
let textWorld = null;
function showTextOverlay(w, sx, sy) {
  textWorld = w;
  const ov = $('#text-overlay');
  ov.classList.remove('hidden');
  $('#inp-text').value = '';
  // anchor the entry box to the tap point, Apple-popover style
  const ow = Math.min(280, window.innerWidth * 0.78);
  ov.style.width = ow + 'px';
  ov.style.left = Math.max(12, Math.min(sx - 24, window.innerWidth - ow - 12)) + 'px';
  const oh = ov.offsetHeight || 160;
  let y = sy + 18;
  if (y + oh > window.innerHeight - 96) y = sy - oh - 18; // tap low on screen → show above, clear of the keyboard
  ov.style.top = Math.max(12, y) + 'px';
  if (G) G.fromTo(ov, { y: 10, opacity: 0, scale: .96 }, { y: 0, opacity: 1, scale: 1, duration: .35, ease: 'back.out(1.7)', clearProps: 'scale' });
  setTimeout(() => $('#inp-text').focus(), 50);
}
$('#btn-text-cancel').onclick = () => { $('#text-overlay').classList.add('hidden'); textWorld = null; };
$('#btn-text-ok').onclick = () => {
  const t = $('#inp-text').value.trim().slice(0, 200);
  $('#text-overlay').classList.add('hidden');
  if (!t || !textWorld) { textWorld = null; return; }
  const s = { id: newStrokeId(), tool: 'text', color, size: textSize, text: t, x: textWorld.x, y: textWorld.y };
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
    previewShape = null; shapeStart = null; gesture = null;
    document.querySelectorAll('.tool').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    tool = btn.dataset.tool;
    $('#inp-size').value = currentSize();
    canvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
    if (G) G.fromTo(btn, { scale: .8 }, { scale: 1, duration: .38, ease: 'back.out(2.5)', clearProps: 'scale' });
    updateRing();
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
  b.onclick = () => {
    setColor(c);
    if (G) G.fromTo(b, { scale: .75 }, { scale: 1, duration: .3, ease: 'back.out(2.5)', clearProps: 'scale' });
  };
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

$('#inp-size').oninput = (e) => {
  const v = Number(e.target.value);
  if (tool === 'text') textSize = v; else brushSize = v;
  updateRing();
};

/* ---------- brush cursor ring (desktop) ---------- */
const ring = $('#brush-ring');
const finePointer = matchMedia('(pointer:fine)').matches;
const RING_TOOLS = ['pen', 'pencil', 'marker', 'highlighter', 'neon', 'eraser', 'line', 'rect', 'circle'];
function updateRing() {
  if (!finePointer) return;
  const show = RING_TOOLS.includes(tool);
  const d = Math.max(10, Math.min(220, brushSize * cam.zoom * (tool === 'eraser' ? 2.2 : 1)));
  ring.style.width = ring.style.height = d + 'px';
  ring.classList.toggle('eraser', tool === 'eraser');
  ring.dataset.show = show ? '1' : '';
}
function moveRing(x, y) {
  if (!finePointer || !ring.dataset.show) return;
  ring.style.opacity = '1';
  ring.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%)`;
}
function hideRing() { ring.style.opacity = '0'; }

/* ================= top bar ================= */
$('#btn-theme').onclick = () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
$('#btn-undo').onclick = () => {
  const id = myStrokeIds.pop();
  if (!id) return toast('Nothing to undo');
  const s = strokes.get(id);
  strokes.delete(id);
  if (s) redoStack.push({ id, stroke: s });
  socket.emit('stroke-undo', { id });
  if (selectedId === id) deselect();
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
$('#btn-clear').onclick = () => showConfirmClear();
function actuallyClearCanvas() {
  strokes.clear(); myStrokeIds.length = 0; redoStack.length = 0;
  deselect();
  socket.emit('canvas-clear');
  dirty = true;
  toast('Canvas cleared');
}

/* password gate before wiping the canvas for both */
const confirmOtp = wireOtpBoxes($('#confirm-otp-row'), async (pw, box) => {
  $('#confirm-error').textContent = '';
  const r = await api('/api/confirm-password', { method: 'POST', body: JSON.stringify({ password: pw }) });
  if (r.ok) {
    hideConfirmClear();
    actuallyClearCanvas();
  } else {
    shakeEl('#confirm-card');
    box.clear();
    $('#confirm-error').textContent = r.error || 'Wrong password';
  }
});
function showConfirmClear() {
  $('#confirm-error').textContent = '';
  $('#confirm-clear').classList.remove('hidden');
  confirmOtp.clear();
  if (G) G.fromTo('#confirm-card', { scale: .92, y: 14, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: .35, ease: 'back.out(1.6)' });
}
function hideConfirmClear() { $('#confirm-clear').classList.add('hidden'); }
$('#btn-confirm-cancel').onclick = hideConfirmClear;
$('#confirm-clear').addEventListener('click', (e) => { if (e.target.id === 'confirm-clear') hideConfirmClear(); });
$('#btn-lock').onclick = async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
};

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  if (G) {
    G.killTweensOf(t);
    G.fromTo(t, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .35, ease: 'power3.out' });
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (G) G.to(t, { opacity: 0, y: 8, duration: .3, ease: 'power2.in', onComplete: () => t.classList.add('hidden') });
    else t.classList.add('hidden');
  }, 2200);
}
function peerToast(msg) {
  const el = $('#peer-toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (G) {
    G.killTweensOf(el);
    G.fromTo(el, { y: -14, opacity: 0 }, { y: 0, opacity: 1, duration: .4, ease: 'back.out(1.6)' });
    G.to(el, { opacity: 0, y: -10, duration: .3, delay: 2.2, onComplete: () => el.classList.add('hidden') });
  } else {
    setTimeout(() => el.classList.add('hidden'), 2500);
  }
}

/* ================= socket: tuned for minimum latency ================= */
function connectSocket() {
  // websocket first (no long-polling handshake delay), polling as fallback
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    setConn('live');
    if (!firstConn) toast('Back online 💕');
    firstConn = false;
  });
  socket.on('disconnect', () => {
    setConn('connecting');
    toast('Connection lost — reconnecting…');
  });
  socket.io.on('reconnect_attempt', () => setConn('connecting'));
  socket.on('connect_error', (err) => {
    // expired session → back to the lock screen via reload;
    // anything else → socket.io retries on its own, pill shows it
    if (err && /unauthorized/i.test(err.message || '')) { setTimeout(() => location.reload(), 800); return; }
    setConn('connecting');
  });
  socket.on('canvas-state', ({ strokes: list, me, peers: peerList }) => {
    hideLoader();
    strokes.clear();
    for (const s of list) strokes.set(s.id, s);
    peers.clear();
    for (const p of peerList) peers.set(p.id, { ...p, x: p.x || 0, y: p.y || 0, tx: p.x || 0, ty: p.y || 0, last: 0 });
    deselect();
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
    if (selectedId === id) deselect();
    dirty = true;
  });
  socket.on('stroke-transform', ({ id, points, x, y, size }) => {
    const s = strokes.get(id);
    if (!s) return;
    if (points) s.points = points;
    if (x !== undefined) { s.x = x; s.y = y; }
    if (size !== undefined) s.size = size;
    dirty = true;
  });
  socket.on('canvas-clear', () => {
    strokes.clear(); myStrokeIds.length = 0; redoStack.length = 0;
    deselect();
    toast('Canvas cleared');
    dirty = true;
  });
  socket.on('peer-cursor', ({ id, name, color: c, x, y }) => {
    const prev = peers.get(id);
    peers.set(id, {
      name, color: c, last: Date.now(),
      x: prev && prev.x !== undefined ? prev.x : x,
      y: prev && prev.y !== undefined ? prev.y : y,
      tx: x, ty: y,
    });
    dirty = true;
  });
  socket.on('peer-join', ({ id, name, color: c }) => {
    peers.set(id, { name, color: c, x: 0, y: 0, tx: 0, ty: 0, last: 0 });
    peerToast(`${name} is here 💞`);
  });
  socket.on('peer-leave', ({ id }) => { peers.delete(id); dirty = true; });
}

/* ================= go ================= */
resize();
refreshThemeColors();
render();
boot();
})();
