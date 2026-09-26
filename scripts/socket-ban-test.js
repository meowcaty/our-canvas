// Tests the socket ban exemption (2026-09-26): a banned IP presenting a
// VALID session must still reach the socket. The 24h ban exists to stop
// password guessing — it must never lock out an authenticated user
// (fat-fingered code, shared Wi-Fi), which surfaced as an infinite
// "Preparing your canvas…" hang: /api/me doesn't check bans, so the page
// loads, but the socket was rejected and the old client retried silently.
process.env.CANVAS_PASSWORD = String(10000000 + Math.floor(Math.random() * 90000000));
const fs = require('fs');
const path = require('path');
const auth = require(path.join(__dirname, '..', 'auth.js'));
auth.initPassword();

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

(async () => {
  auth._reset();
  const bannedIp = '9.9.9.9';
  const cleanIp = '8.8.8.8';

  // ban the IP with 3 wrong password attempts
  auth.recordAttempt(bannedIp, 'TestAgent', false);
  auth.recordAttempt(bannedIp, 'TestAgent', false);
  auth.recordAttempt(bannedIp, 'TestAgent', false);
  check('ip is banned after 3 wrong attempts', auth.isBanned(bannedIp));

  // 1. the actual bug: authenticated user on a banned IP
  const token = auth.createSession();
  check('valid session on banned ip → ok', auth.checkSocketAccess(bannedIp, token) === 'ok');

  // 2. ban still bites strangers (no/invalid session)
  check('no session on banned ip → banned', auth.checkSocketAccess(bannedIp, 'garbage') === 'banned');
  check('missing token on banned ip → banned', auth.checkSocketAccess(bannedIp, undefined) === 'banned');

  // 3. normal unauthenticated socket → unauthorized (not banned)
  check('no session on clean ip → unauthorized', auth.checkSocketAccess(cleanIp, 'garbage') === 'unauthorized');

  // 4. happy path unchanged
  check('valid session on clean ip → ok', auth.checkSocketAccess(cleanIp, token) === 'ok');

  // 5. destroyed session loses the exemption — ban applies again
  auth.destroySession(token);
  check('dead session on banned ip → banned', auth.checkSocketAccess(bannedIp, token) === 'banned');

  // 6. server.js actually wires the middleware through the new gate
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  check('socket middleware uses checkSocketAccess', /auth\.checkSocketAccess\(ip, token\)/.test(serverSrc));
  check('middleware rejects non-ok decisions', /decision !== 'ok'\) return next\(new Error\(decision\)\)/.test(serverSrc));
  check('no blanket ban-before-session in middleware', !/if \(auth\.isBanned\(ip\)\) return next\(new Error\('banned'\)\);/.test(serverSrc));

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} socket ban checks passed`);
  process.exit(failed ? 1 : 0);
})();
