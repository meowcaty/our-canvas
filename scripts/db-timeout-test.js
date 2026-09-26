// Tests the DB connection timeout (2026-09-26): db.init() must fail fast
// when the database hangs instead of refusing. Without
// connectionTimeoutMillis, node-postgres waits forever, main() never
// finishes, server.listen() never runs, and the client sits on
// "Preparing your canvas…" indefinitely.
const net = require('net');
const path = require('path');
const fs = require('fs');

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

(async () => {
  // blackhole server: accepts TCP but never speaks Postgres, so the
  // connection hangs until the driver's connectionTimeoutMillis fires.
  const server = net.createServer(() => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  process.env.DATABASE_URL = `postgres://u:p@127.0.0.1:${port}/db`;
  process.env.PG_CONNECT_TIMEOUT_MS = '800';
  const db = require(path.join(__dirname, '..', 'db.js'));

  const start = Date.now();
  let threw = null;
  try {
    await db.init();
  } catch (e) {
    threw = e;
  }
  const elapsed = Date.now() - start;
  server.close();

  check('init() rejects on a hanging database', !!threw);
  check(`rejects via timeout (~800ms), not instantly and not forever (${elapsed}ms)`,
    elapsed >= 500 && elapsed < 5000);
  check('default timeout is 15s in source',
    /connectionTimeoutMillis:\s*Number\(process\.env\.PG_CONNECT_TIMEOUT_MS \|\| 15000\)/.test(
      fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8')));

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} db timeout checks passed`);
  process.exit(failed ? 1 : 0);
})();
