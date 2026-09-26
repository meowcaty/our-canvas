/* 🎨 Our Canvas — one private infinite canvas for two. */
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { loadCanvas, scheduleSave } = require('./store');
const auth = require('./auth');

auth.initPassword(); // throws if CANVAS_PASSWORD is missing/weak

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy — needed for real client IPs
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

const PORT = process.env.PORT || 3000;
const MAX_STROKES = 20000;
const MAX_POINTS_PER_STROKE = 8000;
const CURSOR_COLORS = ['#ff2d55', '#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff6482'];

const strokes = loadCanvas();
console.log(`🎨 loaded ${strokes.length} strokes from disk`);
const clients = new Map(); // socketId -> {name, color, sessionId}

/* ---------- helpers ---------- */
const isSecureReq = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';

function sanitizeStroke(s, authorId, authorName) {
  if (!s || typeof s !== 'object') return null;
  const tool = String(s.tool || 'pen');
  const validTools = ['pen', 'pencil', 'marker', 'highlighter', 'neon', 'eraser', 'line', 'rect', 'circle', 'text'];
  if (!validTools.includes(tool)) return null;
  const color = /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : '#111111';
  const size = Math.min(120, Math.max(1, Number(s.size) || 8));
  const id = String(s.id || '').slice(0, 64) || `${authorId}:${Date.now()}`;
  const stroke = { id, tool, color, size, author: authorName, authorId, ts: Date.now() };
  if (tool === 'text') {
    stroke.text = String(s.text || '').slice(0, 200);
    const x = Number(s.x), y = Number(s.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    stroke.x = x; stroke.y = y;
  } else {
    const pts = Array.isArray(s.points) ? s.points : [];
    if (tool === 'line' || tool === 'rect' || tool === 'circle') {
      if (pts.length !== 4 || !pts.every(Number.isFinite)) return null;
      stroke.points = pts.map((n) => Math.max(-1e6, Math.min(1e6, n)));
    } else {
      if (pts.length > MAX_POINTS_PER_STROKE * 2) return null;
      const clean = [];
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const x = Number(pts[i]), y = Number(pts[i + 1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        clean.push(Math.max(-1e6, Math.min(1e6, x)), Math.max(-1e6, Math.min(1e6, y)));
      }
      stroke.points = clean;
    }
  }
  return stroke;
}

/* ---------- HTTP auth API ---------- */
app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/login', (req, res) => {
  const ip = auth.getIp(req);
  const ua = req.headers['user-agent'] || '';
  if (auth.isBanned(ip)) {
    const { bannedUntil } = auth.banInfo(ip);
    const hours = Math.max(1, Math.ceil((bannedUntil - Date.now()) / 3600000));
    return res.status(403).json({ ok: false, banned: true, error: `This device is blocked. Try again in ~${hours}h.` });
  }
  if (auth.verifyPassword(req.body && req.body.password)) {
    auth.recordAttempt(ip, ua, true);
    const token = auth.createSession();
    res.setHeader('Set-Cookie', auth.sessionCookie(token, isSecureReq(req)));
    return res.json({ ok: true });
  }
  const info = auth.recordAttempt(ip, ua, false);
  if (info.bannedUntil > Date.now()) {
    return res.status(403).json({ ok: false, banned: true, error: 'Too many wrong attempts. This device is blocked for 24h.' });
  }
  res.status(401).json({ ok: false, error: 'Wrong password', remaining: info.remaining });
});

app.get('/api/me', (req, res) => {
  const token = auth.parseCookies(req.headers.cookie).canvas_session;
  const sess = auth.getSession(token);
  if (!sess) return res.status(401).json({ ok: false });
  res.json({ ok: true, name: sess.name || '' });
});

app.post('/api/name', (req, res) => {
  const token = auth.parseCookies(req.headers.cookie).canvas_session;
  if (!auth.getSession(token)) return res.status(401).json({ ok: false });
  const name = String((req.body && req.body.name) || '').trim().slice(0, 16);
  if (!name) return res.status(400).json({ ok: false, error: 'Enter a name' });
  auth.setSessionName(token, name);
  res.json({ ok: true, name });
});

app.post('/api/logout', (req, res) => {
  const token = auth.parseCookies(req.headers.cookie).canvas_session;
  auth.destroySession(token);
  res.setHeader('Set-Cookie', 'canvas_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ ok: true });
});

/* ---------- sockets: session required ---------- */
io.use((socket, next) => {
  const ip = auth.getSocketIp(socket.handshake);
  if (auth.isBanned(ip)) return next(new Error('banned'));
  const token = auth.parseCookies(socket.handshake.headers.cookie).canvas_session;
  const sess = auth.getSession(token);
  if (!sess) return next(new Error('unauthorized'));
  socket.data.sessionId = auth.parseCookies(socket.handshake.headers.cookie).canvas_session;
  socket.data.ip = ip;
  next();
});

io.on('connection', (socket) => {
  const token = auth.parseCookies(socket.handshake.headers.cookie).canvas_session;
  const sess = auth.getSession(token);
  const name = (sess && sess.name) || 'Guest';
  const color = CURSOR_COLORS[clients.size % CURSOR_COLORS.length];
  // stable author id from the session token — survives reconnects, so undo keeps working
  const authorId = 'u:' + auth.tokenHash(token).slice(0, 16);
  clients.set(socket.id, { name, color, authorId });

  socket.emit('canvas-state', {
    strokes,
    me: { name, color },
    peers: [...clients.entries()]
      .filter(([id]) => id !== socket.id)
      .map(([id, c]) => ({ id, name: c.name, color: c.color })),
  });
  socket.broadcast.emit('peer-join', { id: socket.id, name, color });

  socket.on('stroke-start', (s) => {
    const c = clients.get(socket.id);
    if (!c) return;
    const stroke = sanitizeStroke(s, c.authorId, c.name);
    if (!stroke || strokes.length >= MAX_STROKES) return;
    if (strokes.some((x) => x.id === stroke.id)) return;
    strokes.push(stroke);
    socket.broadcast.emit('stroke-start', stroke);
  });

  socket.on('stroke-point', ({ id, points }) => {
    const c = clients.get(socket.id);
    if (!c) return;
    const stroke = strokes.find((x) => x.id === id);
    if (!stroke || stroke.authorId !== c.authorId || !Array.isArray(points)) return;
    const clean = [];
    for (let i = 0; i + 1 < points.length && stroke.points.length + clean.length < MAX_POINTS_PER_STROKE * 2; i += 2) {
      const x = Number(points[i]), y = Number(points[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      clean.push(Math.max(-1e6, Math.min(1e6, x)), Math.max(-1e6, Math.min(1e6, y)));
    }
    if (!clean.length) return;
    stroke.points.push(...clean);
    socket.broadcast.emit('stroke-point', { id, points: clean });
  });

  socket.on('stroke-end', ({ id }) => {
    const c = clients.get(socket.id);
    if (!c) return;
    const stroke = strokes.find((x) => x.id === id);
    if (!stroke || stroke.authorId !== c.authorId) return;
    scheduleSave(strokes);
    socket.broadcast.emit('stroke-end', { id });
  });

  socket.on('stroke-add', (s) => {
    const c = clients.get(socket.id);
    if (!c) return;
    const stroke = sanitizeStroke(s, c.authorId, c.name);
    if (!stroke || strokes.length >= MAX_STROKES) return;
    if (strokes.some((x) => x.id === stroke.id)) return;
    strokes.push(stroke);
    scheduleSave(strokes);
    io.emit('stroke-add', stroke);
  });

  socket.on('stroke-undo', ({ id }) => {
    const c = clients.get(socket.id);
    if (!c) return;
    const i = strokes.findIndex((x) => x.id === id);
    if (i < 0 || strokes[i].authorId !== c.authorId) return;
    strokes.splice(i, 1);
    scheduleSave(strokes);
    io.emit('stroke-remove', { id });
  });

  socket.on('canvas-clear', () => {
    if (!clients.get(socket.id)) return;
    strokes.length = 0;
    scheduleSave(strokes);
    io.emit('canvas-clear');
  });

  socket.on('cursor', ({ x, y }) => {
    const c = clients.get(socket.id);
    if (!c || !Number.isFinite(x) || !Number.isFinite(y)) return;
    socket.broadcast.emit('peer-cursor', { id: socket.id, name: c.name, color: c.color, x, y });
  });

  socket.on('disconnect', () => {
    clients.delete(socket.id);
    socket.broadcast.emit('peer-leave', { id: socket.id });
  });
});

server.listen(PORT, () => {
  console.log(`🎨 Our Canvas — http://localhost:${PORT}`);
});
