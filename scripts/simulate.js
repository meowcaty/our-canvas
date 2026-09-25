// Tests the collab canvas server: auth, sync, undo, persistence.
// Run: (PORT=3456 node server.js &) && TEST_PORT=3456 node scripts/simulate.js
const { io } = require('socket.io-client');
const { loadRoom } = require('../store');

const PORT = process.env.TEST_PORT || 3456;
const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function once(sock, ev, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ' + ev)), timeoutMs);
    sock.once(ev, (d) => { clearTimeout(t); resolve(d); });
  });
}
const emitAck = (sock, ev, data) => new Promise((res) => sock.emit(ev, data, res));

(async () => {
  const results = [];
  const check = (name, cond) => { results.push(!!cond); console.log((cond ? '  ✅ ' : '  ❌ ') + name); };

  const a = io(URL), b = io(URL);
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);
  check('both clients connect', true);

  // create room with password
  const created = await emitAck(a, 'create-room', { name: 'Percy', password: 'secret123' });
  check('create-room returns code', created.ok && /^[A-Z0-9]{4}$/.test(created.code));
  const code = created.code;

  // wrong password rejected
  const badJoin = await emitAck(b, 'join-room', { code, name: 'Abi', password: 'nope' });
  check('wrong password rejected', !badJoin.ok);

  // right password works, empty canvas
  const stateP = once(b, 'canvas-state');
  const joined = await emitAck(b, 'join-room', { code, name: 'Abi', password: 'secret123' });
  const state = await stateP;
  check('correct password joins', joined.ok);
  check('new room canvas is empty', Array.isArray(state.strokes) && state.strokes.length === 0);

  // live stroke sync: a draws, b receives start/point/end
  const stroke = { id: 's1', tool: 'neon', color: '#ff5d8f', size: 10, points: [] };
  const startP = once(b, 'stroke-start');
  a.emit('stroke-start', stroke);
  const gotStart = await startP;
  check('stroke-start syncs', gotStart.id === 's1' && gotStart.tool === 'neon');

  const pointP = once(b, 'stroke-point');
  a.emit('stroke-point', { id: 's1', points: [0, 0, 10, 10, 20, 5] });
  const gotPoints = await pointP;
  check('stroke-point syncs', gotPoints.id === 's1' && gotPoints.points.length === 6);

  const endP = once(b, 'stroke-end');
  a.emit('stroke-end', { id: 's1' });
  await endP;
  check('stroke-end syncs', true);

  // shape via stroke-add
  const addP = once(b, 'stroke-add');
  a.emit('stroke-add', { id: 's2', tool: 'circle', color: '#4da3ff', size: 6, points: [0, 0, 100, 100] });
  const gotAdd = await addP;
  check('shape stroke-add syncs', gotAdd.id === 's2' && gotAdd.tool === 'circle');

  // undo by non-author is ignored
  b.emit('stroke-undo', { id: 's1' });
  await sleep(300);
  const c = io(URL);
  await once(c, 'connect');
  const cStateP = once(c, 'canvas-state');
  await emitAck(c, 'join-room', { code, name: 'Maya', password: 'secret123' });
  const cState = await cStateP;
  check('non-author undo ignored', cState.strokes.some((s) => s.id === 's1'));

  // undo by author removes for everyone
  const remP = once(b, 'stroke-remove');
  a.emit('stroke-undo', { id: 's1' });
  const removed = await remP;
  check('author undo removes stroke', removed.id === 's1');

  // persistence: strokes hit disk
  await sleep(2200); // debounced save
  const saved = loadRoom(code);
  check('room persisted to disk', !!saved && saved.strokes.some((s) => s.id === 's2') && !saved.strokes.some((s) => s.id === 's1'));
  check('password stored hashed', !!saved && saved.passHash !== 'secret123' && saved.passHash.length === 64);

  // clear canvas
  const clearP = once(b, 'canvas-clear');
  a.emit('canvas-clear');
  await clearP;
  check('canvas-clear syncs', true);
  await sleep(2200);
  check('clear persisted', loadRoom(code).strokes.length === 0);

  // short password rejected
  const d = io(URL);
  await once(d, 'connect');
  const weak = await emitAck(d, 'create-room', { name: 'X', password: 'abc' });
  check('short password rejected', !weak.ok);

  [a, b, c, d].forEach((s) => s.disconnect());
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
