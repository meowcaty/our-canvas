// Tests Our Canvas: password auth, 3-strike IP ban, sessions, sync, undo, persistence.
// Run: CANVAS_PASSWORD=<redacted> TEST_PORT=3456 node scripts/simulate.js
process.env.CANVAS_PASSWORD = process.env.CANVAS_PASSWORD || '48261573';
const TEST_PORT = Number(process.env.TEST_PORT || 3456);
process.env.PORT = TEST_PORT;

const auth = require('../auth');
auth.initPassword();
auth._reset();

const results = [];
function check(name, cond) {
  results.push([name, !!cond]);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

/* ---------- auth unit tests ---------- */
check('unit: correct password verifies', auth.verifyPassword(process.env.CANVAS_PASSWORD));
check('unit: wrong password rejected', !auth.verifyPassword('nope-nope-nope'));
check('unit: not banned initially', !auth.isBanned('9.9.9.9'));
auth.recordAttempt('9.9.9.9', 'TestAgent/1.0', false);
auth.recordAttempt('9.9.9.9', 'TestAgent/1.0', false);
check('unit: 2 fails → not banned yet', !auth.isBanned('9.9.9.9'));
const info3 = auth.recordAttempt('9.9.9.9', 'TestAgent/1.0', false);
check('unit: 3rd fail → banned', auth.isBanned('9.9.9.9') && info3.bannedUntil > Date.now());
check('unit: ban info shows 0 remaining', auth.banInfo('9.9.9.9').remaining === 0);
auth._reset();
auth.recordAttempt('9.9.9.9', 'TestAgent/1.0', false);
auth.recordAttempt('9.9.9.9', 'TestAgent/1.0', true);
check('unit: success resets fail count', !auth.isBanned('9.9.9.9') && auth.banInfo('9.9.9.9').remaining === 3);
const tok = auth.createSession();
check('unit: session created & readable', !!auth.getSession(tok));
check('unit: setSessionName works', auth.setSessionName(tok, 'Abi') && auth.getSession(tok).name === 'Abi');
auth.destroySession(tok);
check('unit: destroyed session invalid', !auth.getSession(tok));
auth._reset(); // clean slate for integration

/* ---------- integration tests ---------- */
require('../server.js'); // starts listening on TEST_PORT
const { io } = require('socket.io-client');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function login(password) {
  const res = await fetch(`http://localhost:${TEST_PORT}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, cookie: res.headers.get('set-cookie') };
}
const once = (sock, ev, timeout = 4000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout: ' + ev)), timeout);
    sock.once(ev, (d) => { clearTimeout(t); res(d); });
  });

(async () => {
  await sleep(600);

  // 3-strike ban over HTTP
  const w1 = await login('wrong-1');
  const w2 = await login('wrong-2');
  const w3 = await login('wrong-3');
  check('http: wrong pw → 401', w1.status === 401 && w1.body.remaining === 2);
  check('http: 2nd wrong → 401, 1 left', w2.status === 401 && w2.body.remaining === 1);
  check('http: 3rd wrong → 403 banned', w3.status === 403 && w3.body.banned === true);
  const blocked = await login(process.env.CANVAS_PASSWORD);
  check('http: correct pw while banned → still 403', blocked.status === 403);

  auth._reset(); // lift the test ban

  // happy-path login
  const good = await login(process.env.CANVAS_PASSWORD);
  check('http: correct pw → 200 + session cookie', good.status === 200 && /canvas_session=/.test(good.cookie || ''));
  check('http: session cookie is HttpOnly + SameSite=Strict', /HttpOnly/i.test(good.cookie) && /SameSite=Strict/i.test(good.cookie));
  const cookie = (good.cookie || '').split(';')[0];

  const meAnon = await fetch(`http://localhost:${TEST_PORT}/api/me`);
  check('http: /api/me without cookie → 401', meAnon.status === 401);
  const meRes = await fetch(`http://localhost:${TEST_PORT}/api/me`, { headers: { cookie } });
  const meBody = await meRes.json();
  check('http: /api/me with cookie → ok, no name yet', meRes.status === 200 && meBody.ok && meBody.name === '');

  const nameRes = await fetch(`http://localhost:${TEST_PORT}/api/name`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ name: 'Abi' }),
  });
  const nameBody = await nameRes.json();
  check('http: set name once → ok', nameRes.status === 200 && nameBody.name === 'Abi');

  // confirm-password gate (used before wiping the canvas)
  const cfAnon = await fetch(`http://localhost:${TEST_PORT}/api/confirm-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.CANVAS_PASSWORD }),
  });
  check('http: confirm-password without session → 401', cfAnon.status === 401);
  const cfWrong = await fetch(`http://localhost:${TEST_PORT}/api/confirm-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ password: '00000000' }),
  });
  check('http: confirm-password wrong pw → 401', cfWrong.status === 401);
  const cfOk = await fetch(`http://localhost:${TEST_PORT}/api/confirm-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ password: process.env.CANVAS_PASSWORD }),
  });
  const cfOkBody = await cfOk.json();
  check('http: confirm-password correct pw → ok', cfOk.status === 200 && cfOkBody.ok === true);

  // sockets: authed vs unauthed
  const sockA = io(`http://localhost:${TEST_PORT}`, { extraHeaders: { cookie } });
  const stateA = await once(sockA, 'canvas-state');
  check('socket: authed client gets canvas-state with name', Array.isArray(stateA.strokes) && stateA.me.name === 'Abi');

  const sockBare = io(`http://localhost:${TEST_PORT}`);
  let bareFailed = false;
  sockBare.on('connect_error', () => { bareFailed = true; });
  await sleep(900);
  check('socket: no session → rejected', bareFailed && !sockBare.connected);
  sockBare.close();

  // second user: Percy
  const loginP = await login(process.env.CANVAS_PASSWORD);
  const cookieP = (loginP.cookie || '').split(';')[0];
  await fetch(`http://localhost:${TEST_PORT}/api/name`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookieP },
    body: JSON.stringify({ name: 'Percy' }),
  });
  const sockP = io(`http://localhost:${TEST_PORT}`, { extraHeaders: { cookie: cookieP } });
  const stateP = await once(sockP, 'canvas-state');
  check('socket: second user joins with own name', stateP.me.name === 'Percy');

  // live draw sync Abi → Percy
  const seenByPercy = once(sockP, 'stroke-add');
  const s1 = { id: 't1', tool: 'pen', color: '#ff2d55', size: 8, points: [0, 0, 40, 40] };
  sockA.emit('stroke-add', s1);
  const got = await seenByPercy;
  check('sync: stroke-add reaches partner live', got && got.id === 't1' && got.author === 'Abi');

  // undo: author-only
  sockP.emit('stroke-undo', { id: 't1' }); // Percy's undo of Abi's stroke → must be ignored
  await sleep(500);
  const sockC = io(`http://localhost:${TEST_PORT}`, { extraHeaders: { cookie: cookieP } });
  const stateC = await once(sockC, 'canvas-state');
  check("authz: partner cannot undo your stroke (still present)", stateC.strokes.some((x) => x.id === 't1'));
  sockC.close();
  const removedOnA = once(sockA, 'stroke-remove');
  sockA.emit('stroke-undo', { id: 't1' });
  const removed = await removedOnA;
  check('undo: author undo removes stroke for everyone', removed && removed.id === 't1');

  // persistence
  const s2 = { id: 't2', tool: 'neon', color: '#0a84ff', size: 10, points: [5, 5, 60, 60] };
  sockA.emit('stroke-add', s2);
  await sleep(2200); // debounce window
  const fs = require('fs');
  const saved = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'data', 'canvas.json'), 'utf8'));
  check('persist: strokes saved to disk', saved.strokes.some((x) => x.id === 't2'));

  // transform + delete (shapes): author-only, synced live
  const shape = { id: 't3', tool: 'rect', color: '#30d158', size: 6, points: [10, 10, 90, 60] };
  const seenShape = once(sockP, 'stroke-add');
  sockA.emit('stroke-add', shape);
  await seenShape;

  const movedOnP = once(sockP, 'stroke-transform');
  sockA.emit('stroke-transform', { id: 't3', points: [20, 20, 100, 70] });
  const moved = await movedOnP;
  check('sync: author transform reaches partner', moved && moved.id === 't3' && moved.points[0] === 20);

  // shared canvas: Percy's transform of Abi's shape applies
  const movedByP = once(sockA, 'stroke-transform');
  sockP.emit('stroke-transform', { id: 't3', points: [0, 0, 1, 1] });
  const movedP = await movedByP;
  const sockD = io(`http://localhost:${TEST_PORT}`, { extraHeaders: { cookie: cookie } });
  const stateD = await once(sockD, 'canvas-state');
  const t3 = stateD.strokes.find((x) => x.id === 't3');
  check('shared: partner can transform your shape', movedP && movedP.id === 't3' && t3 && t3.points[0] === 0);
  sockD.close();

  const txt = { id: 't4', tool: 'text', color: '#ffffff', size: 8, text: 'hi', x: 50, y: 50 };
  const seenTxt = once(sockP, 'stroke-add');
  sockA.emit('stroke-add', txt);
  await seenTxt;
  const txtMoved = once(sockP, 'stroke-transform');
  sockA.emit('stroke-transform', { id: 't4', x: 70, y: 80, size: 12 });
  const tm = await txtMoved;
  check('sync: text move/resize reaches partner', tm && tm.id === 't4' && tm.x === 70 && tm.size === 12);

  // shared canvas: partner can move/resize your text
  const txtMovedByP = once(sockA, 'stroke-transform');
  sockP.emit('stroke-transform', { id: 't4', x: 90, y: 100, size: 14 });
  const tmp = await txtMovedByP;
  check('shared: partner can move/resize your text', tmp && tmp.id === 't4' && tmp.x === 90 && tmp.size === 14);

  // shared canvas: partner can delete your shape
  const deletedOnA = once(sockA, 'stroke-remove');
  sockP.emit('stroke-delete', { id: 't4' });
  const pdel = await deletedOnA;
  const sockE = io(`http://localhost:${TEST_PORT}`, { extraHeaders: { cookie: cookie } });
  const stateE = await once(sockE, 'canvas-state');
  check('shared: partner can delete your shape', pdel && pdel.id === 't4' && !stateE.strokes.some((x) => x.id === 't4'));
  sockE.close();

  // transform of a pen stroke is rejected (not selectable)
  const penMoved = once(sockP, 'stroke-transform');
  sockA.emit('stroke-transform', { id: 't2', points: [1, 1, 2, 2] });
  const penRejected = await Promise.race([penMoved.then(() => false), sleep(400).then(() => true)]);
  check('authz: pen strokes cannot be transformed', penRejected);

  // clear
  const clearedOnP = once(sockP, 'canvas-clear');
  sockA.emit('canvas-clear');
  await clearedOnP;
  check('clear: broadcast to partner', true);

  sockA.close(); sockP.close();

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
