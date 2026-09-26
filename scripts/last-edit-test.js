// Tests the "last edit" viewport anchor (2026-09-26):
// - unit: strokeCenter() extracted VERBATIM from server.js
// - store: setLastEdit / flushSave / loadLastEdit round-trip on the JSON backend
// - integration: real server — stroke-add/transform move the anchor, deletes
//   don't, clear resets it, and canvas-state carries it to newly joined clients
//
// NOTE: the test password is generated at runtime (never hardcoded) because
// CANVAS_PASSWORD must be exactly 8 digits and must never be a real secret.
process.env.CANVAS_PASSWORD = String(10000000 + Math.floor(Math.random() * 90000000));
const fs = require('fs');
const path = require('path');

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- unit: strokeCenter ---------- */
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const centerSrc = serverSrc.match(/function strokeCenter\(s\) \{[\s\S]*?\n\}\n/)[0];
const strokeCenter = new Function(centerSrc + '\n;return strokeCenter;')();

check('center: text → its x,y', JSON.stringify(strokeCenter({ tool: 'text', x: 500, y: 600 })) === '{"x":500,"y":600}');
check('center: rect points → middle', JSON.stringify(strokeCenter({ tool: 'rect', points: [100, 100, 300, 200] })) === '{"x":200,"y":150}');
check('center: freehand points → bbox middle',
  JSON.stringify(strokeCenter({ tool: 'pen', points: [0, 0, 10, 40, 20, 10] })) === '{"x":10,"y":20}');
check('center: garbage → null', strokeCenter({ tool: 'pen', points: [1] }) === null && strokeCenter(null) === null);
check('center: non-finite text coords → null', strokeCenter({ tool: 'text', x: NaN, y: 1 }) === null);

(async () => {
  /* ---------- store round-trip ---------- */
  const db = require('../db');
  const store = require('../store');
  await db.init();
  const f = path.join(__dirname, '..', 'data', 'canvas.json');
  const backup = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  try {
    store.setLastEdit({ x: 11, y: 22 });
    store.scheduleSave([{ id: 'le', tool: 'text', text: 'x', x: 1, y: 2 }]);
    await store.flushSave();
    const le = await store.loadLastEdit();
    check('store: lastEdit round-trips', le && le.x === 11 && le.y === 22);
    const doc = await db.getDoc('canvas', null);
    check('store: doc carries lastEdit', !!doc && !!doc.lastEdit && doc.lastEdit.x === 11);

    store.setLastEdit(null);
    store.scheduleSave([{ id: 'le2', tool: 'text', text: 'y', x: 3, y: 4 }]);
    await store.flushSave();
    check('store: clear resets to null', (await store.loadLastEdit()) === null);

    store.setLastEdit({ x: NaN, y: 1 });
    check('store: invalid input → null', store.getLastEdit() === null);
  } finally {
    if (backup === null) { try { fs.unlinkSync(f); } catch (_) {} }
    else fs.writeFileSync(f, backup);
  }
  await db.close();

  /* ---------- integration: real server ---------- */
  const TEST_PORT = 3457;
  process.env.PORT = TEST_PORT;
  const auth = require('../auth');
  auth.initPassword();
  auth._reset();
  require('../server.js');
  const { io } = require('socket.io-client');
  const once = (sock, ev, timeout = 4000) =>
    new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout: ' + ev)), timeout);
      sock.once(ev, (d) => { clearTimeout(t); res(d); });
    });

  await sleep(600);
  const login = await fetch(`http://localhost:${TEST_PORT}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.CANVAS_PASSWORD }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  check('integration: login ok', login.status === 200 && /canvas_session=/.test(cookie));

  const sockA = io(`http://localhost:${TEST_PORT}`, { extraHeaders: { cookie } });
  await once(sockA, 'canvas-state');
  const joinState = async () => {
    const s = io(`http://localhost:${TEST_PORT}`, { extraHeaders: { cookie } });
    const st = await once(s, 'canvas-state');
    s.close();
    return st.lastEdit;
  };

  // add a rect → anchor becomes its center
  const addP = once(sockA, 'stroke-add');
  sockA.emit('stroke-add', { id: 'le-rect', tool: 'rect', color: '#ff2d55', size: 8, points: [100, 100, 300, 200] });
  await addP;
  let leNow = await joinState();
  check('integration: add moves anchor to rect center', leNow && leNow.x === 200 && leNow.y === 150);

  // delete it → anchor stays (change before the delete)
  const delP = once(sockA, 'stroke-remove');
  sockA.emit('stroke-delete', { id: 'le-rect' });
  await delP;
  leNow = await joinState();
  check('integration: delete does not move anchor', leNow && leNow.x === 200 && leNow.y === 150);

  // add text, then move it → anchor follows the move
  const addT = once(sockA, 'stroke-add');
  sockA.emit('stroke-add', { id: 'le-text', tool: 'text', color: '#111111', size: 24, text: 'hi', x: 500, y: 600 });
  await addT;
  leNow = await joinState();
  check('integration: text add moves anchor', leNow && leNow.x === 500 && leNow.y === 600);
  sockA.emit('stroke-transform', { id: 'le-text', x: 700, y: 800, size: 24 });
  await sleep(400);
  leNow = await joinState();
  check('integration: transform moves anchor', leNow && leNow.x === 700 && leNow.y === 800);

  // clear → anchor resets
  const clrP = once(sockA, 'canvas-clear');
  sockA.emit('canvas-clear');
  await clrP;
  leNow = await joinState();
  check('integration: clear resets anchor', leNow === null || leNow === undefined);
  sockA.close();

  // force any pending debounced save, THEN restore the canvas file the
  // integration writes touched (a late timer must not resurrect test data)
  await store.flushSave();
  if (backup === null) { try { fs.unlinkSync(f); } catch (_) {} }
  else fs.writeFileSync(f, backup);

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
