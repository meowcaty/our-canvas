/* 🎨 Our Canvas — one private infinite canvas for two */
(() => {
'use strict';

const $ = (s) => document.querySelector(s);
const G = window.gsap || null; // animations degrade gracefully if gsap fails to load
const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  let body = {};
  try { body = await res.json(); } catch {}
  return { status: res.status, ...body };
};

/* ================= theme (dark only) ================= */
const themeColors = { bg: '#060609', dot: 'rgba(255,255,255,.08)' };

/* ================= boot flow ================= */
let myName = '';
try { myName = localStorage.getItem('ourcanvas_name') || ''; } catch {}

async function boot() {
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
// Undo is personal: it reverses my last action in order. Entries are
// {kind:'add', id} for a drawn stroke, or {kind:'erase', removed, added}
// for one eraser gesture (removed/added hold full stroke copies).
const undoStack = [];
const redoStack = [];
// drop a pending 'add' undo entry for id (e.g. the stroke vanished another way)
function dropAddUndo(id) {
  for (let i = undoStack.length - 1; i >= 0; i--)
    if (undoStack[i].kind === 'add' && undoStack[i].id === id) undoStack.splice(i, 1);
}
let strokeSeq = 0;
let dirty = true;

let tool = 'pen';
let color = '#ffffff';
let brushSize = 8;
let textSize = 18; // text defaults to a phone-readable size (font ≈ size × 2.2)
function currentSize() { return tool === 'text' ? textSize : brushSize; }

const PALETTE = ['#ffffff', '#1c1c1e', '#ff2d55', '#ff7a59', '#ff9f0a', '#ffcc00',
  '#30d158', '#0a84ff', '#bf5af2', '#64d2ff', '#ff6482', '#ac8e68'];

function enterCanvas() {
  showOnly('screen-canvas');
  resize();
  updateRing();
  maybeShowToolHint();
  if (G) {
    G.fromTo('#topbar', { y: -34, opacity: 0 }, { y: 0, opacity: 1, duration: .6, ease: 'power3.out', delay: .05 });
    G.fromTo('#toolbar', { y: 70, opacity: 0 }, { y: 0, opacity: 1, duration: .65, ease: 'power3.out', delay: .15 });
    G.fromTo('#toolbar .tool', { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: .45, ease: 'back.out(1.8)', stagger: .035, delay: .3, clearProps: 'scale,opacity' });
  }
  if (!socket) {
    // canvas content arrives over the socket — playful loader until it does
    resetLoaderState();
    $('#canvas-loader').classList.remove('hidden');
    connectSocket();
    armLoaderWatchdog();
  }
}

function hideLoader() {
  resetLoaderState();
  const l = $('#canvas-loader');
  if (!l || l.classList.contains('hidden')) return;
  if (G) G.to(l, { opacity: 0, duration: .45, ease: 'power2.out', onComplete: () => { l.classList.add('hidden'); l.style.opacity = ''; } });
  else l.classList.add('hidden');
}

/* loader watchdog: "Preparing your canvas…" must never hang silently.
   canvas-state is the only thing that dismisses the loader, so if the
   server is down, crash-looping, or waking slowly, say so and offer a retry. */
let loaderTimer = null;
function resetLoaderState() {
  if (loaderTimer) { clearTimeout(loaderTimer); loaderTimer = null; }
  const dots = $('.loader-dots'), txt = $('.loader-text'),
        err = $('#loader-error'), btn = $('#loader-retry');
  if (dots) dots.classList.remove('hidden');
  if (txt) txt.textContent = 'Preparing your canvas…';
  if (err) err.classList.add('hidden');
  if (btn) btn.classList.add('hidden');
}
function showLoaderError(msg) {
  const l = $('#canvas-loader');
  if (!l || l.classList.contains('hidden')) return;
  if (loaderTimer) { clearTimeout(loaderTimer); loaderTimer = null; }
  const dots = $('.loader-dots'), txt = $('.loader-text'),
        err = $('#loader-error'), btn = $('#loader-retry');
  if (dots) dots.classList.add('hidden');
  if (txt) txt.textContent = 'Taking longer than usual…';
  if (err) { err.textContent = msg; err.classList.remove('hidden'); }
  if (btn) btn.classList.remove('hidden');
}
function armLoaderWatchdog() {
  if (loaderTimer) clearTimeout(loaderTimer);
  loaderTimer = setTimeout(() => {
    showLoaderError('The server isn\u2019t responding. Free-tier servers can take up to a minute to wake up \u2014 if this keeps happening, the server may be down.');
  }, 20000);
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
  // Legacy eraser paint strokes (from before the geometric eraser) still render
  // as background-colored cover-up so old canvases look the same.
  const C = s.tool === 'eraser' ? themeColors.bg : s.color;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  if (s.tool === 'text') {
    ctx.fillStyle = C;
    const fs = textFontPx(s);
    ctx.font = `${fs}px ${textFontCss(s)}`;
    // Pin the baseline explicitly: glyphs hang below (s.x, s.y).
    // (Previously this relied on leftover context state from the peer-name
    //  labels, which also made the selection box disagree with the render.)
    ctx.textBaseline = 'top';
    // subtle Apple-style pop when the font changes: a quick settle, no bounce
    if (s._fontPop) {
      const p = Math.min(1, (performance.now() - s._fontPop) / 320);
      if (p >= 1) delete s._fontPop;
      else {
        const e = 1 - Math.pow(1 - p, 3);
        const k = 0.94 + 0.06 * e;
        ctx.translate(s.x, s.y); ctx.scale(k, k); ctx.translate(-s.x, -s.y);
        ctx.globalAlpha = 0.2 + 0.8 * e;
        fontAnimActive = true;
      }
    }
    const lines = wrapText(s);
    const lh = fs * TEXT_LINE_H;
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], s.x, s.y + i * lh);
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
    if (s.tool === 'neon') { ctx.shadowColor = C; ctx.shadowBlur = s.size * 5; }
    ctx.beginPath();
    ctx.arc(s.points[0], s.points[1], (s.size * (s.tool === 'eraser' ? 2.2 : 1)) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (s.tool === 'neon') {
    // True bloom: additive halo passes with real shadowBlur, then a crisp
    // saturated core with a hot white center. (Previously: flat alpha
    // passes with no blur — it read as a thick marker, not a glow.)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = C;
    ctx.shadowColor = C;
    ctx.shadowBlur = s.size * 6; ctx.globalAlpha = 0.32; ctx.lineWidth = s.size * 3.2;
    tracePath(s); ctx.stroke();
    ctx.shadowBlur = s.size * 3; ctx.globalAlpha = 0.5; ctx.lineWidth = s.size * 1.9;
    tracePath(s); ctx.stroke();
    ctx.restore();
    // saturated core, back in normal blending
    ctx.globalAlpha = 1; ctx.strokeStyle = C; ctx.lineWidth = s.size;
    tracePath(s); ctx.stroke();
    // hot white center
    ctx.globalAlpha = 0.85; ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.5, s.size * 0.42);
    tracePath(s); ctx.stroke();
    ctx.restore();
    return;
  }

  const passes =
    s.tool === 'pencil'   ? [[0.55, 0.7, C]]
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
  fontAnimActive = false;

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
  if (fontAnimActive) dirty = true; // keep frames coming until the font pop settles
  if (activeStroke && activeStroke.points.length >= 2) drawStroke(activeStroke);

  if (previewShape) {
    ctx.save();
    ctx.setLineDash([10 / cam.zoom, 8 / cam.zoom]);
    drawStroke(previewShape);
    ctx.restore();
  }
  if (textBoxPreview) {
    // dashed box while dragging out a text box, in the current text color
    const p = textBoxPreview;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = .85;
    ctx.lineWidth = 1.5 / cam.zoom;
    ctx.setLineDash([10 / cam.zoom, 8 / cam.zoom]);
    ctx.strokeRect(p.x, p.y, Math.max(2, p.w), Math.max(2, p.h));
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
    ctx.fillStyle = 'rgba(28,28,30,.9)';
    ctx.beginPath(); ctx.roundRect(bx, by, w + pad * 2, h, h / 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(p.name, bx + pad, by + pad * 0.7);
    ctx.restore();
  }
  if (peerMoving) dirty = true;
}

/* ================= selection: tap to select, drag to move, handles to resize ================= */
const SELECTABLE = ['line', 'rect', 'circle', 'text'];
let selectedId = null;
let selectedAt = 0;

/* ============ paragraph text: every text lives in a box, wraps like Photoshop ============
   A text stroke is { x, y, w } — top-left of its box plus the box width.
   Height auto-grows from the wrapped lines (auto-grow, per Yadu 2026-09-26).
   Legacy strokes without `w` get a box fitted to their single line, so
   nothing jumps when they first render as wrapped text. */
const TEXT_LINE_H = 1.2; // line height as a multiple of the font size
const TEXT_DEFAULT_W = 280; // box width for a plain tap

/* ================= text fonts ================= */
const FONTS = {
  playfair:   { label: 'Vintage',    css: '"Playfair Display", Georgia, serif' },
  typewriter: { label: 'Typewriter', css: '"Special Elite", "Courier New", monospace' },
  script:     { label: 'Script',     css: '"Pinyon Script", "Snell Roundhand", cursive' },
  classic:    { label: 'Classic',    css: '-apple-system, "SF Pro Text", sans-serif' },
};
const FONT_KEYS = Object.keys(FONTS);
const DEFAULT_FONT = 'playfair'; // vintage serif — the new default
let textFont = DEFAULT_FONT; // font for newly placed text
let fontEpoch = 0; // bumped when webfonts finish loading, invalidates the wrap cache
function textFontCss(s) {
  const key = s && s.font && FONTS[s.font] ? s.font : DEFAULT_FONT;
  return FONTS[key].css;
}
// webfonts arrive after first paint: re-measure and repaint when they land
if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
  Promise.all([
    document.fonts.load('400 16px "Playfair Display"'),
    document.fonts.load('400 16px "Special Elite"'),
    document.fonts.load('400 16px "Pinyon Script"'),
  ]).then(() => { fontEpoch++; dirty = true; }).catch(() => {});
}
let fontAnimActive = false; // set while a font-change pop is playing
function textFontPx(s) { return s.size * 2.2; }
function textBoxW(s) {
  if (Number.isFinite(s.w) && s.w > 0) return s.w;
  ctx.font = `${textFontPx(s)}px ${textFontCss(s)}`;
  return Math.max(24, ctx.measureText(s.text || ' ').width);
}
const wrapCache = new WeakMap(); // stroke object → { key, lines }
function wrapText(s) {
  const fs = textFontPx(s);
  const maxW = textBoxW(s);
  const key = `${s.text}\n${maxW}\n${fs}\n${textFontCss(s)}\n${fontEpoch}`;
  const hit = wrapCache.get(s);
  if (hit && hit.key === key) return hit.lines;
  ctx.font = `${fs}px ${textFontCss(s)}`;
  const measure = (t) => ctx.measureText(t).width;
  const lines = [];
  for (const para of String(s.text == null ? '' : s.text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const trial = line ? line + ' ' + word : word;
      if (measure(trial) <= maxW) { line = trial; continue; }
      if (line) { lines.push(line); line = ''; }
      // fresh line: place the word, breaking it if even one line can't hold it
      let rest = word;
      while (rest) {
        if (measure(rest) <= maxW) { line = rest; rest = ''; break; }
        let lo = 1, hi = rest.length;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (measure(rest.slice(0, mid)) <= maxW) lo = mid; else hi = mid - 1;
        }
        lines.push(rest.slice(0, lo));
        rest = rest.slice(lo);
      }
    }
    lines.push(line);
  }
  wrapCache.set(s, { key, lines });
  return lines;
}
function textMetrics(s) {
  const fs = textFontPx(s);
  return { w: textBoxW(s), h: wrapText(s).length * fs * TEXT_LINE_H };
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
  if (s.tool === 'text') {
    // paragraph text: corners scale the type (Free-Transform-like), left/right
    // edges reflow the box (Photoshop paragraph behavior)
    return [
      { x: b.x, y: b.y, corner: 'tl' },
      { x: b.x + b.w, y: b.y, corner: 'tr' },
      { x: b.x, y: b.y + b.h, corner: 'bl' },
      { x: b.x + b.w, y: b.y + b.h, corner: 'br' },
      { x: b.x, y: b.y + b.h / 2, corner: 'l' },
      { x: b.x + b.w, y: b.y + b.h / 2, corner: 'r' },
    ];
  }
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
    case 'l': return { x: b.x + b.w, y: b.y + b.h / 2 };
    case 'r': return { x: b.x, y: b.y + b.h / 2 };
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

/* ============ real eraser: destroy ink geometrically, no paint ============ */
// The eraser used to paint background-colored strokes over ink (a cover-up:
// moving a shape "healed" the erased part, and neon kept a ghost halo).
// Now it cuts the actual stroke geometry. Text is immune; shapes bitten by
// the eraser become plain ink (a bitten circle is no longer a circle).
const ERASABLE = ['pen', 'pencil', 'marker', 'highlighter', 'neon', 'eraser', 'line', 'rect', 'circle'];
function eraseRadiusWorld() { return brushSize * 1.1; } // matches the old 2.2x paint swath

// resample a shape into a closed polyline (flat [x,y,…]) so the eraser can bite it
function sampleShapePath(s) {
  const [x1, y1, x2, y2] = s.points;
  const pts = [];
  if (s.tool === 'line') return [x1, y1, x2, y2];
  if (s.tool === 'rect') {
    const per = 2 * (Math.abs(x2 - x1) + Math.abs(y2 - y1));
    const n = Math.max(16, Math.ceil(per / 4));
    for (let i = 0; i <= n; i++) {
      const t = (i % n) / n * 4, seg = Math.floor(t), f = t - seg;
      const cx = [x1, x2, x2, x1][seg], cy = [y1, y1, y2, y2][seg];
      const nx = [x2, x2, x1, x1][seg], ny = [y1, y2, y2, y1][seg];
      pts.push(cx + (nx - cx) * f, cy + (ny - cy) * f);
    }
    return pts;
  }
  // circle / ellipse
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
  const per = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const n = Math.max(24, Math.ceil(per / 4));
  for (let i = 0; i <= n; i++) {
    const a = (i % n) / n * Math.PI * 2;
    pts.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  }
  return pts;
}

// polyline (flat) erasable points for a stroke, or null when immune / not ink
function erasablePoints(s) {
  if (!ERASABLE.includes(s.tool)) return null; // text is immune
  const p = s.points;
  if (!p || p.length < 2) return null;
  if (s.tool === 'line' || s.tool === 'rect' || s.tool === 'circle') return sampleShapePath(s);
  return p;
}

// cut a polyline by the dab circle (cx,cy,r).
// Returns null when untouched, [] when fully erased, else an array of fragments.
function splitPolyline(pts, cx, cy, r) {
  const n = pts.length / 2;
  if (n === 1) {
    const dx = pts[0] - cx, dy = pts[1] - cy;
    return (dx * dx + dy * dy < r * r) ? [] : null;
  }
  const c = { x: cx, y: cy };
  let anyCut = false;
  const cut = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const hit = distToSeg(c, { x: pts[2 * i], y: pts[2 * i + 1] }, { x: pts[2 * i + 2], y: pts[2 * i + 3] }) < r;
    cut[i] = hit;
    if (hit) anyCut = true;
  }
  if (!anyCut) return null;
  const frags = [];
  let cur = null;
  for (let i = 0; i < n - 1; i++) {
    if (!cut[i]) {
      if (!cur) cur = [pts[2 * i], pts[2 * i + 1]];
      cur.push(pts[2 * i + 2], pts[2 * i + 3]);
    } else if (cur) { frags.push(cur); cur = null; }
  }
  if (cur) frags.push(cur);
  return frags;
}

// apply one eraser dab; g is the in-progress 'erasing' gesture (for undo bookkeeping).
// Returns true when something changed.
function applyEraseDab(cx, cy, r, g) {
  let changed = false;
  for (const s of [...strokes.values()]) {
    const pts = erasablePoints(s);
    if (!pts) continue;
    // cheap bbox reject before the segment walk
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (cx + r < x0 || cx - r > x1 || cy + r < y0 || cy - r > y1) continue;
    const frags = splitPolyline(pts, cx, cy, r);
    if (!frags) continue;
    if (!g.erase) g.erase = { removed: new Map(), added: new Set() };
    // record the pre-gesture original once; intermediate fragments belong to
    // this gesture already, so re-recording them would duplicate ink on undo
    if (!g.erase.added.has(s.id) && !g.erase.removed.has(s.id))
      g.erase.removed.set(s.id, { ...s, points: s.points.slice() });
    strokes.delete(s.id);
    socket.emit('stroke-delete', { id: s.id });
    g.erase.added.delete(s.id); // it was an intermediate fragment: superseded
    if (selectedId === s.id) deselect();
    for (const fp of frags) {
      // a bitten shape is plain ink from here on (keeps its look, loses shape-ness)
      const nt = (s.tool === 'line' || s.tool === 'rect' || s.tool === 'circle') ? 'pen' : s.tool;
      const ns = { id: newStrokeId(), tool: nt, color: s.color, size: s.size, points: fp };
      strokes.set(ns.id, ns);
      socket.emit('stroke-add', ns);
      g.erase.added.add(ns.id);
    }
    changed = true;
  }
  return changed;
}

function select(id) {
  selectedId = id;
  selectedAt = performance.now();
  const btn = $('#btn-delete');
  btn.classList.remove('hidden');
  if (G) G.fromTo(btn, { scale: .3, opacity: 0 }, { scale: 1, opacity: 1, duration: .38, ease: 'back.out(2.2)', clearProps: 'scale' });
  positionDeleteBtn();
  const s = strokes.get(id);
  if (s && s.tool === 'text') {
    $('#inp-size').value = s.size; // slider now drives this text
    if (s.font && FONTS[s.font] && s.font !== textFont) { textFont = s.font; syncFontChips(); }
  }
  updateFontRow();
  dirty = true;
}
function deselect() {
  if (!selectedId) return;
  selectedId = null;
  $('#btn-delete').classList.add('hidden');
  $('#inp-size').value = currentSize();
  updateFontRow();
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
  for (let i = undoStack.length - 1; i >= 0; i--)
    if (undoStack[i].kind === 'add' && undoStack[i].id === s.id) undoStack.splice(i, 1);
  redoStack.push({ kind: 'add', stroke: s });
  socket.emit('stroke-delete', { id: s.id });
  deselect();
  toast('Deleted — redo brings it back');
  dirty = true;
};

/* ---- live transform sync (throttled, volatile mid-gesture, guaranteed final) ---- */
let xformTimer = null;
function transformPatch(s) {
  return s.tool === 'text'
    ? { x: s.x, y: s.y, w: s.w, size: s.size, font: s.font }
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
    // edge handles: resize the BOX — text re-wraps, auto-grows, font untouched
    // (Photoshop paragraph-text behavior). Corner handles: scale the TYPE about
    // the opposite corner — font size and box grow together, wrapping stays
    // proportional (Free-Transform-like). The size slider still works too.
    const o = g.opposite;
    if (g.handle.corner === 'l' || g.handle.corner === 'r') {
      let nx = curW.x;
      if (Math.abs(nx - o.x) < 12) nx = o.x + (nx >= o.x ? 12 : -12);
      s.x = Math.min(o.x, nx);
      s.w = Math.max(24, Math.abs(nx - o.x));
      return;
    }
    const t0 = g.origText;
    if (!t0) return;
    const d0 = Math.hypot(g.startW.x - o.x, g.startW.y - o.y);
    const d1 = Math.hypot(curW.x - o.x, curW.y - o.y);
    if (d0 < 4) return;
    const newSize = Math.min(200, Math.max(4, t0.size * (d1 / d0)));
    const k = newSize / t0.size; // re-derive so the box tracks the clamped size
    s.size = newSize;
    s.w = Math.max(24, t0.w * k);
    s.x = o.x + (t0.x - o.x) * k;
    s.y = o.y + (t0.y - o.y) * k;
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
let liveStrokeErased = false; // partner erased/cleared the live stroke mid-draw → drop it on pen-up
let pendingPoints = [];
let flushTimer = null;
let previewShape = null;
let textBoxPreview = null; // dashed box while dragging out a text box
let shapeStart = null;
let pinch = null;
let gesture = null; // tap-candidate | drawing | shape-preview | move-sel | resize-sel | pan-drag

const TAP_SLOP = 8;   // px on screen
const TAP_MS = 600;

function newStrokeId() { return `${socket.id}:${strokeSeq++}`; }
function flushPoints() {
  if (!activeStroke || !strokeStarted || !pendingPoints.length || liveStrokeErased) return;
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
    if (liveStrokeErased) {
      // erased (or canvas cleared) mid-draw — drop it silently instead of
      // resurrecting the ghost on pen-up
      activeStroke = null; strokeStarted = false; liveStrokeErased = false;
      pendingPoints = [];
      dirty = true;
      return;
    }
    if (strokeStarted) {
      flushPoints();
      socket.emit('stroke-end', { id: activeStroke.id });
    }
    strokes.set(activeStroke.id, activeStroke);
    undoStack.push({ kind: 'add', id: activeStroke.id });
    redoStack.length = 0;
    activeStroke = null;
    strokeStarted = false;
    dirty = true;
  }
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { sx: e.clientX, sy: e.clientY });
  // user takes over — stop the open-framing glide
  if (frameTween) { frameTween.kill(); frameTween = null; }

  if (pointers.size === 2) {
    if (gesture && (gesture.kind === 'move-sel' || gesture.kind === 'resize-sel') && gesture.s) finalizeTransform(gesture.s);
    endActiveStroke();
    previewShape = null; shapeStart = null; textBoxPreview = null; gesture = null;
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
        // corner-scale for text needs the pre-gesture geometry
        origText: s.tool === 'text' ? { x: s.x, y: s.y, w: textBoxW(s), size: s.size } : null,
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

  // Tap selects, drag draws: don't decide on touch-down. A tap (lift without
  // moving) hit-tests and selects; a drag runs the tool over the old content.
  if (tool === 'text') {
    // drag to draw the text box (Photoshop-style); a tap on existing text
    // selects it, a tap elsewhere gets a default box
    const hit = hitSelectable(w);
    gesture = { kind: 'text-box', sx: e.clientX, sy: e.clientY, startW: w, hitId: hit ? hit.id : null };
    textBoxPreview = null;
    return;
  }
  if (tool === 'pan') {
    deselect();
    gesture = { kind: 'pan-drag', sx: e.clientX, sy: e.clientY };
    return;
  }
  if (tool === 'eraser') {
    // a real eraser: destroys ink geometrically, no paint strokes
    gesture = { kind: 'erasing', sx: e.clientX, sy: e.clientY, erase: null, deselected: false, lx: e.clientX, ly: e.clientY };
    sendCursor(e.clientX, e.clientY);
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
    liveStrokeErased = false;
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
    // corner-scaling text changes the font size — keep the slider honest
    if (gesture.s.tool === 'text' && gesture.handle.corner !== 'l' && gesture.handle.corner !== 'r')
      $('#inp-size').value = Math.round(gesture.s.size);
    scheduleTransform(gesture.s);
    dirty = true;
    return;
  }
  if (gesture.kind === 'text-box') {
    const moved = Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy);
    if (moved < TAP_SLOP) { textBoxPreview = null; return; }
    if (!gesture.dragged) { gesture.dragged = true; deselect(); }
    const a = gesture.startW;
    textBoxPreview = {
      x: Math.min(a.x, w.x), y: Math.min(a.y, w.y),
      w: Math.abs(w.x - a.x), h: Math.abs(w.y - a.y),
    };
    dirty = true;
    return;
  }
  if (gesture.kind === 'erasing') {
    const moved = Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy);
    if (moved > TAP_SLOP && !gesture.deselected) { gesture.deselected = true; deselect(); }
    const r = eraseRadiusWorld();
    const evts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    let changed = false;
    for (const ev of evts) {
      // skip dabs too close together — splitting is idempotent anyway
      if (Math.hypot(ev.clientX - gesture.lx, ev.clientY - gesture.ly) < r * 0.3) continue;
      gesture.lx = ev.clientX; gesture.ly = ev.clientY;
      const p = screenToWorld(ev.clientX, ev.clientY);
      if (applyEraseDab(p.x, p.y, r, gesture)) changed = true;
    }
    if (changed) dirty = true;
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
    undoStack.push({ kind: 'add', id: s.id }); redoStack.length = 0;
    socket.emit('stroke-add', s);
    previewShape = null; shapeStart = null;
    dirty = true;
    return;
  }
  if (g.kind === 'drawing') {
    endActiveStroke();
    return;
  }
  if (g.kind === 'erasing') {
    if (!g.erase) {
      // a tap with the eraser: single dab where the finger went down
      const w = screenToWorld(g.sx, g.sy);
      if (applyEraseDab(w.x, w.y, eraseRadiusWorld(), g)) dirty = true;
    }
    if (g.erase && (g.erase.removed.size || g.erase.added.size)) {
      undoStack.push({
        kind: 'erase',
        removed: [...g.erase.removed.values()],
        added: [...g.erase.added].map((id) => ({ ...strokes.get(id), points: strokes.get(id).points.slice() })),
      });
      redoStack.length = 0;
    }
    return;
  }
  if (g.kind === 'text-box') {
    const p = textBoxPreview;
    textBoxPreview = null;
    // a clean tap on existing text selects it instead of opening a new box
    if (!p && g.hitId) {
      const hit = strokes.get(g.hitId);
      if (hit) { select(g.hitId); return; }
    }
    deselect();
    const box = p
      ? { x: p.x, y: p.y, w: Math.max(24, p.w) }
      : { x: g.startW.x, y: g.startW.y, w: TEXT_DEFAULT_W };
    dirty = true;
    showTextOverlay(box, e.clientX, e.clientY);
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
      if (liveStrokeErased) { activeStroke = null; liveStrokeErased = false; }
      else {
      const s = { ...activeStroke, points: activeStroke.points.slice() };
      strokes.set(s.id, s);
      undoStack.push({ kind: 'add', id: s.id }); redoStack.length = 0;
      socket.emit('stroke-add', s);
      activeStroke = null;
      dirty = true;
      }
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
let textBox = null; // { x, y, w } world — the box being filled
function showTextOverlay(box, sx, sy) {
  textBox = box;
  const ov = $('#text-overlay');
  ov.classList.remove('hidden');
  const ta = $('#inp-text');
  ta.value = '';
  ta.style.height = 'auto';
  ta.style.fontFamily = FONTS[textFont].css; // the editor previews the chosen font
  ta.style.fontSize = ''; // fixed comfortable typing size (CSS 17px): scaling the
  // font to preview the box's wrapping made narrow boxes unusable (giant font,
  // one word per line). The canvas behind shows the real wrapping on Place.
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(200, ta.scrollHeight) + 'px'; };
  // comfortable fixed-width editor, independent of the canvas box width
  const taW = Math.min(window.innerWidth * 0.78, 360);
  const ow = taW + 28; // overlay padding
  ov.style.width = ow + 'px';
  ov.style.left = Math.max(12, Math.min(sx - 24, window.innerWidth - ow - 12)) + 'px';
  const oh = ov.offsetHeight || 160;
  let y = sy + 18;
  if (y + oh > window.innerHeight - 96) y = sy - oh - 18; // tap low on screen → show above, clear of the keyboard
  ov.style.top = Math.max(12, y) + 'px';
  if (G) G.fromTo(ov, { y: 10, opacity: 0, scale: .96 }, { y: 0, opacity: 1, scale: 1, duration: .35, ease: 'back.out(1.7)', clearProps: 'scale' });
  setTimeout(() => $('#inp-text').focus(), 50);
}
$('#btn-text-cancel').onclick = () => { $('#text-overlay').classList.add('hidden'); textBox = null; };
$('#btn-text-ok').onclick = () => {
  const t = $('#inp-text').value.trim().slice(0, 500);
  $('#text-overlay').classList.add('hidden');
  if (!t || !textBox) { textBox = null; return; }
  const s = { id: newStrokeId(), tool: 'text', color, size: textSize, font: textFont, text: t, x: textBox.x, y: textBox.y, w: textBox.w };
  strokes.set(s.id, s);
  undoStack.push({ kind: 'add', id: s.id }); redoStack.length = 0;
  socket.emit('stroke-add', s);
  textBox = null;
  dirty = true;
};

/* ============ smart tool labels: no permanent labels, zero clutter ============
   - long-press any tool → its name pops up above it (always available)
   - tapping a tool always flashes its name (~2s)
   - the tag button in the top bar opens a sheet with every tool's name
   - one-time hint on first canvas visit */
const toolTipEl = $('#tool-tip');
const toolFlashEl = $('#tool-flash');
let tipBtn = null;
function showToolTip(btn) {
  const r = btn.getBoundingClientRect();
  toolTipEl.textContent = btn.title || btn.dataset.tool;
  toolTipEl.classList.remove('hidden');
  toolTipEl.style.left = (r.left + r.width / 2) + 'px';
  toolTipEl.style.top = (r.top - 10) + 'px';
  if (G) G.fromTo(toolTipEl, { x: '-50%', y: '-100%', scale: .8, opacity: 0 }, { x: '-50%', y: '-100%', scale: 1, opacity: 1, duration: .25, ease: 'back.out(2)' });
  else { toolTipEl.style.transform = 'translate(-50%,-100%)'; toolTipEl.style.opacity = '1'; }
  tipBtn = btn;
}
function hideToolTip() {
  if (!tipBtn) return;
  tipBtn = null;
  if (G) G.to(toolTipEl, { opacity: 0, scale: .85, duration: .18, onComplete: () => toolTipEl.classList.add('hidden') });
  else { toolTipEl.style.opacity = '0'; toolTipEl.classList.add('hidden'); }
}

function flashToolName(btn) {
  // every tap shows the name — no cutoff, no guessing
  toolFlashEl.textContent = btn.title || btn.dataset.tool;
  toolFlashEl.classList.remove('hidden');
  if (G) {
    G.killTweensOf(toolFlashEl);
    G.fromTo(toolFlashEl, { x: '-50%', opacity: 0, y: 8 }, { x: '-50%', opacity: 1, y: 0, duration: .25, ease: 'power2.out' });
    G.to(toolFlashEl, { opacity: 0, y: -6, duration: .3, delay: 1.8, onComplete: () => toolFlashEl.classList.add('hidden') });
  } else {
    toolFlashEl.style.opacity = '1';
    setTimeout(() => { toolFlashEl.style.opacity = '0'; toolFlashEl.classList.add('hidden'); }, 1900);
  }
}

function maybeShowToolHint() {
  let seen = null;
  try { seen = localStorage.getItem('oc-hints-seen'); } catch (_) {}
  if (seen) return false;
  try { localStorage.setItem('oc-hints-seen', '1'); } catch (_) {}
  setTimeout(() => toast('Tip: press & hold any tool to see its name ✨'), 1500);
  return true;
}

/* ============ tools sheet: every tool, named, beautifully ============
   A small tag button in the top bar opens a frosted sheet with all 11 tools
   in a roomy grid — icon + name, staggered entrance. Tapping one selects it
   through the toolbar's own click path, so captions and state stay identical. */
const toolsBackdrop = $('#tools-backdrop');
const toolsSheet = $('#tools-sheet');
const toolsGrid = $('#tools-grid');
let toolsOpen = false, toolsBuilt = false;
function buildToolsSheet() {
  toolsGrid.innerHTML = '';
  document.querySelectorAll('#tools-row .tool').forEach((btn) => {
    const cell = document.createElement('button');
    cell.className = 'tool-cell';
    cell.dataset.tool = btn.dataset.tool;
    const svg = btn.querySelector('svg');
    if (svg) cell.appendChild(svg.cloneNode(true));
    const label = document.createElement('span');
    label.textContent = btn.title || btn.dataset.tool;
    cell.appendChild(label);
    cell.setAttribute('aria-label', label.textContent);
    cell.addEventListener('click', () => {
      const tb = document.querySelector(`#tools-row .tool[data-tool="${cell.dataset.tool}"]`);
      if (tb) tb.click();
      closeToolsSheet();
    });
    toolsGrid.appendChild(cell);
  });
  toolsBuilt = true;
}
function openToolsSheet() {
  if (toolsOpen) return;
  toolsOpen = true;
  if (!toolsBuilt) buildToolsSheet();
  toolsGrid.querySelectorAll('.tool-cell').forEach((c) =>
    c.classList.toggle('active', c.dataset.tool === tool));
  toolsBackdrop.classList.remove('hidden');
  toolsSheet.classList.remove('hidden');
  if (G) {
    G.fromTo(toolsBackdrop, { opacity: 0 }, { opacity: 1, duration: .25, overwrite: true });
    G.fromTo(toolsSheet, { y: 70, opacity: 0 }, { y: 0, opacity: 1, duration: .45, ease: 'back.out(1.5)', overwrite: true });
    G.fromTo('#tools-grid .tool-cell',
      { y: 16, opacity: 0, scale: .85 },
      { y: 0, opacity: 1, scale: 1, duration: .35, ease: 'back.out(1.8)', stagger: .03, delay: .08, clearProps: 'transform', overwrite: true });
  } else {
    toolsBackdrop.style.opacity = '1';
  }
}
function closeToolsSheet() {
  if (!toolsOpen) return;
  toolsOpen = false;
  const done = () => { toolsBackdrop.classList.add('hidden'); toolsSheet.classList.add('hidden'); };
  if (G) {
    G.to(toolsBackdrop, { opacity: 0, duration: .2, overwrite: true });
    G.to(toolsSheet, { y: 50, opacity: 0, duration: .25, ease: 'power2.in', overwrite: true, onComplete: done });
  } else done();
}
$('#btn-tools').onclick = () => (toolsOpen ? closeToolsSheet() : openToolsSheet());
toolsBackdrop.onclick = closeToolsSheet;

/* ================= toolbar ================= */
document.querySelectorAll('.tool').forEach((btn) => {
  let lpTimer = null, lpFired = false;
  btn.addEventListener('pointerdown', () => {
    lpFired = false;
    clearTimeout(lpTimer);
    lpTimer = setTimeout(() => {
      lpFired = true;
      showToolTip(btn);
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch (_) {} }
    }, 450);
  });
  const cancelLp = () => { clearTimeout(lpTimer); hideToolTip(); };
  btn.addEventListener('pointerup', cancelLp);
  btn.addEventListener('pointercancel', cancelLp);
  btn.addEventListener('pointerleave', cancelLp);
  btn.onclick = () => {
    clearTimeout(lpTimer); hideToolTip();
    if (lpFired) { lpFired = false; return; } // was a peek, not a pick
    endActiveStroke();
    previewShape = null; shapeStart = null; textBoxPreview = null; gesture = null;
    document.querySelectorAll('.tool').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    tool = btn.dataset.tool;
    $('#inp-size').value = currentSize();
    updateFontRow();
    canvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
    if (G) G.fromTo(btn, { scale: .8 }, { scale: 1, duration: .38, ease: 'back.out(2.5)', clearProps: 'scale' });
    updateRing();
    flashToolName(btn);
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

/* ---------- font picker: contextual, only for text ---------- */
const fontRow = $('#font-row');
FONT_KEYS.forEach((key) => {
  const b = document.createElement('button');
  b.className = 'font-chip' + (key === textFont ? ' active' : '');
  b.dataset.font = key;
  b.title = FONTS[key].label;
  b.innerHTML = `<span class="ag" style="font-family:${FONTS[key].css}">Ag</span><small>${FONTS[key].label}</small>`;
  b.onclick = () => setFont(key, b);
  fontRow.appendChild(b);
});
function setFont(key, chip) {
  if (!FONTS[key]) return;
  textFont = key;
  syncFontChips();
  const ta = $('#inp-text');
  if (ta) ta.style.fontFamily = FONTS[key].css; // the editor follows, even mid-typing
  if (chip && G) G.fromTo(chip, { scale: .85 }, { scale: 1, duration: .45, ease: 'back.out(3)', clearProps: 'scale' });
  const sel = selectedId ? strokes.get(selectedId) : null;
  if (sel && sel.tool === 'text' && sel.font !== key) {
    sel.font = key;
    sel._fontPop = performance.now();
    finalizeTransform(sel); // broadcast + persist via the server
  }
  dirty = true;
}
function syncFontChips() {
  document.querySelectorAll('.font-chip').forEach((c) => c.classList.toggle('active', c.dataset.font === textFont));
}
function updateFontRow() {
  const sel = selectedId ? strokes.get(selectedId) : null;
  const show = tool === 'text' || (sel && sel.tool === 'text');
  const wasHidden = fontRow.classList.contains('hidden');
  fontRow.classList.toggle('hidden', !show);
  if (show && wasHidden && G)
    G.fromTo(fontRow, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: .32, ease: 'power2.out', clearProps: 'all' });
}

$('#inp-size').oninput = (e) => {
  const v = Number(e.target.value);
  if (tool === 'text') textSize = v; else brushSize = v;
  // handles resize the text box now — the slider is how selected text changes size
  const sel = selectedId ? strokes.get(selectedId) : null;
  if (sel && sel.tool === 'text') {
    sel.size = Math.min(200, Math.max(4, v));
    scheduleTransform(sel);
    dirty = true;
  }
  updateRing();
};
$('#inp-size').onchange = () => {
  const sel = selectedId ? strokes.get(selectedId) : null;
  if (sel && sel.tool === 'text') finalizeTransform(sel);
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
$('#btn-undo').onclick = () => {
  const a = undoStack.pop();
  if (!a) return toast('Nothing to undo');
  if (a.kind === 'erase') {
    // reverse one eraser gesture: drop its fragments, restore the originals
    for (const s of a.added) {
      strokes.delete(s.id);
      socket.emit('stroke-delete', { id: s.id });
      if (selectedId === s.id) deselect();
    }
    for (const s of a.removed) {
      const copy = { ...s, points: s.points.slice() };
      strokes.set(copy.id, copy);
      socket.emit('stroke-add', copy);
    }
    redoStack.push(a);
  } else {
    const s = strokes.get(a.id);
    strokes.delete(a.id);
    if (s) redoStack.push({ kind: 'add', stroke: s });
    socket.emit('stroke-undo', { id: a.id });
    if (selectedId === a.id) deselect();
  }
  dirty = true;
};
$('#btn-redo').onclick = () => {
  const r = redoStack.pop();
  if (!r) return toast('Nothing to redo');
  if (r.kind === 'erase') {
    // re-apply the eraser gesture
    for (const s of r.removed) {
      strokes.delete(s.id);
      socket.emit('stroke-delete', { id: s.id });
      if (selectedId === s.id) deselect();
    }
    for (const s of r.added) {
      const copy = { ...s, points: s.points.slice() };
      strokes.set(copy.id, copy);
      socket.emit('stroke-add', copy);
    }
    undoStack.push(r);
  } else {
    strokes.set(r.stroke.id, r.stroke);
    undoStack.push({ kind: 'add', id: r.stroke.id });
    socket.emit('stroke-add', r.stroke);
  }
  dirty = true;
};
$('#btn-clear').onclick = () => showConfirmClear();
function actuallyClearCanvas() {
  strokes.clear(); undoStack.length = 0; redoStack.length = 0;
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

/* ============ open framing: fit everything, center on last edit ============
   On first load: zoom out to fit all content (never past 1x, never below
   the pinch minimum) and center on the last non-delete edit. Empty canvas
   keeps the default 1x view at the origin. */
let hasFramed = false, frameTween = null;
function contentBounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes.values()) {
    if (s.tool === 'text') {
      const { w, h } = textMetrics(s);
      if (s.x < x0) x0 = s.x; if (s.y < y0) y0 = s.y;
      if (s.x + w > x1) x1 = s.x + w; if (s.y + h > y1) y1 = s.y + h;
    } else if (Array.isArray(s.points) && s.points.length >= 2) {
      const pad = (s.size || 8) / 2;
      for (let i = 0; i + 1 < s.points.length; i += 2) {
        const x = s.points[i], y = s.points[i + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x - pad < x0) x0 = x - pad; if (y - pad < y0) y0 = y - pad;
        if (x + pad > x1) x1 = x + pad; if (y + pad > y1) y1 = y + pad;
      }
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}
function frameOnLoad(lastEdit) {
  const b = contentBounds();
  if (!b) return;
  const w = Math.max(1, b.x1 - b.x0), h = Math.max(1, b.y1 - b.y0);
  const z = Math.min(1, Math.max(0.2, Math.min(cssW / w, cssH / h) * 0.92));
  const ccx = (b.x0 + b.x1) / 2, ccy = (b.y0 + b.y1) / 2;
  if (frameTween) { frameTween.kill(); frameTween = null; }
  // phase 1: show the middle of everything, fit-zoomed, right away
  cam.x = ccx; cam.y = ccy; cam.zoom = z; dirty = true;
  // phase 2: glide over to where the last edit happened
  if (lastEdit && Number.isFinite(lastEdit.x) && Number.isFinite(lastEdit.y)) {
    if (Math.hypot(lastEdit.x - ccx, lastEdit.y - ccy) < 40) return; // already there
    if (G) {
      frameTween = G.to(cam, {
        x: lastEdit.x, y: lastEdit.y, duration: 1, ease: 'power3.inOut',
        onUpdate: () => { dirty = true; },
        onComplete: () => { frameTween = null; dirty = true; },
      });
    } else {
      cam.x = lastEdit.x; cam.y = lastEdit.y; dirty = true;
    }
  }
}

/* ================= socket: tuned for minimum latency ================= */
// reconnect → full page reload: the simplest bulletproof resync.
// the HttpOnly session cookie survives, so we land straight back on the canvas.
function handleReconnect() {
  const now = Date.now();
  const last = Number(sessionStorage.getItem('oc-last-reload') || 0);
  // flapping guard: don't reload-storm on a jittery network —
  // canvas-state already refreshed the data in that case
  if (now - last < 15000) { toast('Back online 💕'); return 'resync'; }
  try { sessionStorage.setItem('oc-last-reload', String(now)); } catch (_) {}
  toast('Back online — refreshing canvas…');
  setTimeout(() => location.reload(), 900);
  return 'reload';
}
function connectSocket() {
  // websocket first (no long-polling handshake delay), polling as fallback
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    setConn('live');
    if (firstConn) { firstConn = false; return; }
    handleReconnect();
  });
  socket.on('disconnect', () => {
    setConn('connecting');
    toast('Connection lost — reconnecting…');
  });
  socket.io.on('reconnect_attempt', () => setConn('connecting'));
  socket.on('connect_error', (err) => {
    const msg = (err && err.message) || '';
    // expired session → back to the lock screen via reload;
    // banned → say so plainly (retrying for 24h is pointless);
    // anything else → socket.io retries on its own, pill shows it,
    // and the loader watchdog explains the wait after 20s
    if (/unauthorized/i.test(msg)) { setTimeout(() => location.reload(), 800); return; }
    if (/banned/i.test(msg)) {
      showLoaderError('This device is temporarily blocked after too many wrong passwords. Try again in 24 hours.');
      setConn('offline');
      return;
    }
    setConn('connecting');
  });
  socket.on('canvas-state', ({ strokes: list, lastEdit, me, peers: peerList }) => {
    hideLoader();
    strokes.clear();
    for (const s of list) strokes.set(s.id, s);
    peers.clear();
    for (const p of peerList) peers.set(p.id, { ...p, x: p.x || 0, y: p.y || 0, tx: p.x || 0, ty: p.y || 0, last: 0 });
    deselect();
    if (!hasFramed) { hasFramed = true; frameOnLoad(lastEdit); }
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
      dropAddUndo(s.id);
      dirty = true;
    }
  });
  socket.on('stroke-remove', ({ id }) => {
    strokes.delete(id);
    dropAddUndo(id);
    if (activeStroke && activeStroke.id === id) liveStrokeErased = true; // erased mid-draw
    if (selectedId === id) deselect();
    dirty = true;
  });
  socket.on('stroke-transform', ({ id, points, x, y, w, size, font }) => {
    const s = strokes.get(id);
    if (!s) return;
    if (points) s.points = points;
    if (x !== undefined) { s.x = x; s.y = y; }
    if (w !== undefined) s.w = w;
    if (size !== undefined) s.size = size;
    if (font !== undefined && FONTS[font]) {
      if (s.font !== font) s._fontPop = performance.now(); // partner sees the pop too
      s.font = font;
    }
    dirty = true;
  });
  socket.on('canvas-clear', () => {
    strokes.clear(); undoStack.length = 0; redoStack.length = 0;
    if (activeStroke) liveStrokeErased = true; // cleared mid-draw — don't resurrect on pen-up
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
const retryBtn = $('#loader-retry');
if (retryBtn) retryBtn.addEventListener('click', () => location.reload());
resize();
render();
boot();
})();
