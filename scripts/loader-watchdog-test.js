// Tests the loader watchdog (2026-09-26): "Preparing your canvas…" must never
// hang silently. If canvas-state doesn't arrive within 20s, the loader shows
// an explanation + retry button instead of spinning forever. A ban is
// surfaced immediately with a plain message.
// resetLoaderState / showLoaderError / armLoaderWatchdog are extracted
// VERBATIM from public/client.js.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');
function extract(name, args) {
  const m = src.match(new RegExp('function ' + name + '\\(' + args + '\\) \\{[\\s\\S]*?\\n\\}\\n'));
  if (!m) throw new Error('could not extract ' + name);
  return m[0];
}
const block = 'let loaderTimer = null;\n'
  + extract('resetLoaderState', '')
  + extract('showLoaderError', 'msg')
  + extract('armLoaderWatchdog', '');

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

function makeEl(hidden) {
  const classes = new Set(hidden ? ['hidden'] : []);
  return {
    textContent: '',
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    hidden: () => classes.has('hidden'),
  };
}

function makeEnv() {
  const els = {
    '#canvas-loader': makeEl(false),
    '.loader-dots': makeEl(false),
    '.loader-text': makeEl(false),
    '#loader-error': makeEl(true),
    '#loader-retry': makeEl(true),
  };
  els['.loader-text'].textContent = 'Preparing your canvas…';
  const timers = [];
  const cleared = [];
  const $ = (s) => els[s] || null;
  const setTimeout = (fn, ms) => { timers.push({ fn, ms, id: timers.length + 1 }); return timers.length; };
  const clearTimeout = (id) => { cleared.push(id); };
  let api;
  eval(block + '\n;api = { resetLoaderState, showLoaderError, armLoaderWatchdog };');
  return { els, timers, cleared, api };
}

(async () => {
  // 1. arming schedules a ~20s watchdog
  let env = makeEnv();
  env.api.armLoaderWatchdog();
  check('watchdog arms one timer', env.timers.length === 1);
  check('watchdog fires at 20s', env.timers[0].ms === 20000);

  // 2. timer fires while loader visible → error state, not a silent spin
  env.timers[0].fn();
  check('dots hidden on timeout', env.els['.loader-dots'].hidden());
  check('title switches to taking-longer', env.els['.loader-text'].textContent === 'Taking longer than usual…');
  check('error message shown', !env.els['#loader-error'].hidden() && /isn.t responding/.test(env.els['#loader-error'].textContent));
  check('error mentions wake-up wait', /wake up/.test(env.els['#loader-error'].textContent));
  check('retry button shown', !env.els['#loader-retry'].hidden());

  // 3. reset restores the pristine loader and disarms the timer
  env = makeEnv();
  env.api.armLoaderWatchdog();
  env.timers[0].fn();
  env.api.resetLoaderState();
  check('reset clears the timer', env.cleared.length === 1);
  check('reset restores dots', !env.els['.loader-dots'].hidden());
  check('reset restores title', env.els['.loader-text'].textContent === 'Preparing your canvas…');
  check('reset hides error', env.els['#loader-error'].hidden());
  check('reset hides retry', env.els['#loader-retry'].hidden());

  // 4. re-arming replaces the old timer (no double watchdogs)
  env = makeEnv();
  env.api.armLoaderWatchdog();
  env.api.armLoaderWatchdog();
  check('re-arm clears previous timer', env.cleared.length === 1 && env.timers.length === 2);

  // 5. timer firing after the loader was dismissed → stays silent
  env = makeEnv();
  env.api.armLoaderWatchdog();
  env.els['#canvas-loader'].classList.add('hidden'); // e.g. canvas-state won the race
  env.timers[0].fn();
  check('no error UI when loader already hidden', env.els['#loader-error'].hidden() && env.els['#loader-retry'].hidden());

  // 6. banned message surfaces verbatim (connect_error calls showLoaderError)
  env = makeEnv();
  env.api.showLoaderError('This device is temporarily blocked after too many wrong passwords. Try again in 24 hours.');
  check('ban message shown plainly', !env.els['#loader-error'].hidden() && /blocked/.test(env.els['#loader-error'].textContent));

  // 7. wiring checks against the real source
  check('hideLoader resets loader state', /function hideLoader\(\) \{\n  resetLoaderState\(\);/.test(src));
  check('enterCanvas arms the watchdog', /connectSocket\(\);\n    armLoaderWatchdog\(\);/.test(src));
  check('connect_error handles banned explicitly', /connect_error[\s\S]*?\/banned\/i\.test\(msg\)[\s\S]*?showLoaderError/.test(src));
  check('retry button reloads the page', /\$\('#loader-retry'\)[\s\S]*?addEventListener\('click', \(\) => location\.reload\(\)\)/.test(src));
  check('loader markup has error + retry nodes', src.includes('id="loader-error"') === false // client.js shouldn't hardcode markup
    && fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').includes('id="loader-retry"'));

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} loader watchdog checks passed`);
  process.exit(failed ? 1 : 0);
})();
