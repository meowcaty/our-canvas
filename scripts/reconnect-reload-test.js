// Tests the reconnect behavior (2026-09-26): after a dropped connection,
// a reconnect triggers a full page reload (simplest bulletproof resync),
// with a guard so a flapping network doesn't cause a reload storm.
// handleReconnect is extracted VERBATIM from public/client.js.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');
const fnSrc = src.match(/function handleReconnect\(\) \{[\s\S]*?\n\}\n/)[0];

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

function makeEnv() {
  const store = new Map();
  const timers = [];
  const toasts = [];
  const env = {
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    location: { reloaded: false, reload() { this.reloaded = true; } },
    toast: (m) => toasts.push(m),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    _store: store, _timers: timers, _toasts: toasts,
  };
  return env;
}

function loadFn(env) {
  // direct eval inside this closure: the function resolves toast/location/
  // sessionStorage/setTimeout through env's locals
  const { sessionStorage, location, toast, setTimeout } = env;
  let fn;
  eval(fnSrc + '\n;fn = handleReconnect;');
  return fn;
}

(async () => {
  // 1. normal reconnect → schedules a reload
  let env = makeEnv();
  let r = loadFn(env)();
  check('reconnect returns reload', r === 'reload');
  check('reload scheduled ~900ms out', env._timers.length === 1 && env._timers[0].ms === 900);
  check('refreshing toast shown', env._toasts.some((m) => /refreshing canvas/i.test(m)));
  check('reload timestamp recorded', Number(env._store.get('oc-last-reload')) > 0);
  env._timers[0].fn();
  check('timer fires location.reload()', env.location.reloaded === true);

  // 2. flapping network (reconnect < 15s after last reload) → no reload
  env = makeEnv();
  env._store.set('oc-last-reload', String(Date.now() - 5000));
  r = loadFn(env)();
  check('flapping reconnect returns resync', r === 'resync');
  check('flapping reconnect schedules no reload', env._timers.length === 0);
  check('flapping reconnect still toasts back-online', env._toasts.some((m) => /back online/i.test(m)));

  // 3. old timestamp (> 15s) → reload again
  env = makeEnv();
  env._store.set('oc-last-reload', String(Date.now() - 60000));
  r = loadFn(env)();
  check('stale timestamp reconnects reload', r === 'reload' && env._timers.length === 1);

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
