const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { loadRoom, scheduleSave, hashPassword, newSalt } = require('./store');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_STROKES = 20000;
const MAX_POINTS_PER_STROKE = 8000;
const CURSOR_COLORS = ['#ff5d8f', '#4da3ff', '#ffb84d', '#7dde92', '#c792ea', '#ff7a59'];

/* room.code -> { code, passHash, salt, strokes: [], clients: Map<socketId, {name,color}> } */
const rooms = new Map();

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function getRoom(code) {
  code = String(code || '').trim().toUpperCase();
  let room = rooms.get(code);
  if (room) return room;
  const saved = loadRoom(code);
  if (!saved) return null;
  room = { code, passHash: saved.passHash, salt: saved.salt, strokes: saved.strokes, clients: new Map() };
  rooms.set(code, room);
  return room;
}

function checkPassword(room, password) {
  if (!password) return false;
  const h = hashPassword(password, room.salt);
  return h.length === room.passHash.length &&
    require('crypto').timingSafeEqual(Buffer.from(h), Buffer.from(room.passHash));
}

function cleanName(name) {
  return String(name || '').trim().slice(0, 16);
}

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
      stroke.points = pts.map(n => Math.max(-1e6, Math.min(1e6, n)));
    } else {
      if (pts.length > MAX_POINTS_PER_STROKE * 2) return null;
      const clean = [];
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const x = Number(pts[i]), y = Number(pts[i + 1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        clean.push(Math.max(-1e6, Math.min(1e6, x)), Math.max(-1e6, Math.min(1e6, y)));
      }
      stroke.points = clean; // may be empty at stroke-start; points stream in after
    }
  }
  return stroke;
}

io.on('connection', (socket) => {
  let room = null;

  const authed = () => room && room.clients.has(socket.id);

  socket.on('create-room', ({ name, password }, cb) => {
    const clean = cleanName(name);
    if (!clean) return cb({ ok: false, error: 'Enter your name first 🎨' });
    if (!password || String(password).length < 4) return cb({ ok: false, error: 'Password needs at least 4 characters 🔐' });
    const code = makeCode();
    const salt = newSalt();
    room = {
      code,
      passHash: hashPassword(password, salt),
      salt,
      strokes: [],
      clients: new Map(),
    };
    rooms.set(code, room);
    joinRoomSocket(room, clean);
    scheduleSave(room);
    cb({ ok: true, code });
  });

  socket.on('join-room', ({ code, name, password }, cb) => {
    const clean = cleanName(name);
    if (!clean) return cb({ ok: false, error: 'Enter your name first 🎨' });
    const r = getRoom(code);
    if (!r) return cb({ ok: false, error: 'Room not found 💔' });
    if (!checkPassword(r, password)) {
      setTimeout(() => cb({ ok: false, error: 'Wrong password 🔐' }), 600); // slow down guessing
      return;
    }
    room = r;
    joinRoomSocket(room, clean);
    cb({ ok: true, code: room.code });
  });

  function joinRoomSocket(r, name) {
    const color = CURSOR_COLORS[r.clients.size % CURSOR_COLORS.length];
    r.clients.set(socket.id, { name, color });
    socket.join(r.code);
    socket.data.roomCode = r.code;
    socket.emit('canvas-state', {
      strokes: r.strokes,
      peers: [...r.clients.entries()]
        .filter(([id]) => id !== socket.id)
        .map(([id, c]) => ({ id, name: c.name, color: c.color })),
    });
    socket.to(r.code).emit('peer-join', { id: socket.id, name, color });
  }

  /* ---------- live drawing ---------- */
  socket.on('stroke-start', (s) => {
    if (!authed()) return;
    const me = room.clients.get(socket.id);
    const stroke = sanitizeStroke(s, socket.id, me.name);
    if (!stroke || room.strokes.length >= MAX_STROKES) return;
    if (room.strokes.some(x => x.id === stroke.id)) return;
    room.strokes.push(stroke);
    socket.to(room.code).emit('stroke-start', stroke);
  });

  socket.on('stroke-point', ({ id, points }) => {
    if (!authed()) return;
    const stroke = room.strokes.find(x => x.id === id);
    if (!stroke || stroke.authorId !== socket.id || !Array.isArray(points)) return;
    const clean = [];
    for (let i = 0; i + 1 < points.length && stroke.points.length + clean.length < MAX_POINTS_PER_STROKE * 2; i += 2) {
      const x = Number(points[i]), y = Number(points[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      clean.push(Math.max(-1e6, Math.min(1e6, x)), Math.max(-1e6, Math.min(1e6, y)));
    }
    if (!clean.length) return;
    stroke.points.push(...clean);
    socket.to(room.code).emit('stroke-point', { id, points: clean });
  });

  socket.on('stroke-end', ({ id }) => {
    if (!authed()) return;
    const stroke = room.strokes.find(x => x.id === id);
    if (!stroke || stroke.authorId !== socket.id) return;
    scheduleSave(room);
    socket.to(room.code).emit('stroke-end', { id });
  });

  /* re-add a stroke (redo) */
  socket.on('stroke-add', (s) => {
    if (!authed()) return;
    const me = room.clients.get(socket.id);
    const stroke = sanitizeStroke(s, socket.id, me.name);
    if (!stroke || room.strokes.length >= MAX_STROKES) return;
    if (room.strokes.some(x => x.id === stroke.id)) return;
    room.strokes.push(stroke);
    scheduleSave(room);
    io.to(room.code).emit('stroke-add', stroke);
  });

  socket.on('stroke-undo', ({ id }) => {
    if (!authed()) return;
    const i = room.strokes.findIndex(x => x.id === id);
    if (i < 0 || room.strokes[i].authorId !== socket.id) return;
    room.strokes.splice(i, 1);
    scheduleSave(room);
    io.to(room.code).emit('stroke-remove', { id });
  });

  socket.on('canvas-clear', () => {
    if (!authed()) return;
    room.strokes = [];
    scheduleSave(room);
    io.to(room.code).emit('canvas-clear');
  });

  /* partner's live cursor */
  socket.on('cursor', ({ x, y }) => {
    if (!authed()) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const me = room.clients.get(socket.id);
    socket.to(room.code).emit('peer-cursor', { id: socket.id, name: me.name, color: me.color, x, y });
  });

  socket.on('disconnect', () => {
    if (room) {
      room.clients.delete(socket.id);
      socket.to(room.code).emit('peer-leave', { id: socket.id });
      if (room.clients.size === 0) rooms.delete(room.code); // strokes stay on disk
    }
  });
});

server.listen(PORT, () => {
  console.log(`🎨 Collab Canvas — http://localhost:${PORT}`);
});
