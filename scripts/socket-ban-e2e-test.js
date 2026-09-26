// End-to-end proof for the socket ban exemption (2026-09-26): boots the
// REAL server, bans an IP, then connects a REAL socket.io client with a
// valid session cookie from the banned IP. Must receive canvas-state.
// A second client with no session from the same IP must get 'banned'.
process.env.CANVAS_PASSWORD = String(10000000 + Math.floor(Math.random() * 90000000));
process.env.PORT = '4123';
const net = require('net');
const path = require('path');
const auth = require(path.join(__dirname, '..', 'auth.js'));
require(path.join(__dirname, '..', 'server.js')); // boots the app
const { io } = require('socket.io-client');

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

function waitForPort(port, tries = 50) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.end(); resolve(); });
      s.on('error', () => { s.destroy(); n <= 0 ? reject(new Error('server never listened')) : setTimeout(() => attempt(n - 1), 200); });
    };
    attempt(tries);
  });
}

function once(emitter, ev, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { emitter.removeAllListeners(ev); resolve(null); }, ms);
    emitter.once(ev, (...a) => { clearTimeout(t); resolve(a.length === 1 ? a[0] : a); });
  });
}

(async () => {
  await waitForPort(4123);
  const bannedIp = '9.9.9.9';
  auth.recordAttempt(bannedIp, 'TestAgent', false);
  auth.recordAttempt(bannedIp, 'TestAgent', false);
  auth.recordAttempt(bannedIp, 'TestAgent', false);
  check('test ip is banned', auth.isBanned(bannedIp));

  const token = auth.createSession();

  // 1. banned IP + valid session → canvas-state arrives (the reported bug)
  const s1 = io('http://127.0.0.1:4123', {
    transports: ['polling'],
    extraHeaders: { cookie: `canvas_session=${token}`, 'x-forwarded-for': bannedIp },
  });
  const state = await once(s1, 'canvas-state', 8000);
  check('banned ip + valid session receives canvas-state', !!state && Array.isArray(state.strokes));
  s1.close();

  // 2. banned IP + no session → rejected as banned (protection intact)
  const s2 = io('http://127.0.0.1:4123', {
    transports: ['polling'],
    extraHeaders: { 'x-forwarded-for': bannedIp },
  });
  const err = await once(s2, 'connect_error', 8000);
  check('banned ip + no session → banned error', !!err && /banned/i.test(err.message || ''));
  s2.close();

  // 3. clean IP + no session → unauthorized (not banned)
  const s3 = io('http://127.0.0.1:4123', {
    transports: ['polling'],
    extraHeaders: { 'x-forwarded-for': '8.8.8.8' },
  });
  const err3 = await once(s3, 'connect_error', 8000);
  check('clean ip + no session → unauthorized', !!err3 && /unauthorized/i.test(err3.message || ''));
  s3.close();

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} socket e2e checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('❌ e2e failed:', e.message); process.exit(1); });
