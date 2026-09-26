// Tests the smart tool labels (2026-09-26):
// - long-press peek and first-run hint need a real browser; not covered here
// - flashToolName: tapping a tool flashes its name until used 3 times, then stops
// - maybeShowToolHint: one-time hint, then never again
// Both functions are extracted VERBATIM from public/client.js and driven
// with fakes, so this tests the shipped code, not a copy.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');
const flashSrc = src.match(/function flashToolName\(btn\) \{[\s\S]*?\n\}\n/)[0];
const hintSrc = src.match(/function maybeShowToolHint\(\) \{[\s\S]*?\n\}\n/)[0];

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

function fakeEl() {
  const s = new Set(['hidden']);
  return {
    textContent: '',
    style: {},
    classList: {
      add: (c) => s.add(c),
      remove: (c) => s.delete(c),
      contains: (c) => s.has(c),
    },
    isHidden: () => s.has('hidden'),
    reset() { s.add('hidden'); this.textContent = ''; },
  };
}
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    _map: m,
  };
}
function makeG() {
  const tos = [];
  return { _tos: tos, killTweensOf() {}, fromTo() {}, to(el, vars) { tos.push({ el, vars }); } };
}

function loadFns(env) {
  const { localStorage, toast, setTimeout, G } = env;
  const toolFlashEl = env.toolFlashEl; // single element; reset between taps
  let toolSeenCounts = {};
  try { toolSeenCounts = JSON.parse(localStorage.getItem('oc-tool-seen') || '{}'); } catch (_) { toolSeenCounts = {}; }
  let f1, f2;
  eval(flashSrc + '\n;f1 = flashToolName;');
  eval(hintSrc + '\n;f2 = maybeShowToolHint;');
  return { flashToolName: f1, maybeShowToolHint: f2 };
}

function penBtn() { return { dataset: { tool: 'pen' }, title: 'Pen' }; }

(async () => {
  // ---- flashToolName: teaches, then gets out of the way ----
  const storage = fakeStorage();
  const G = makeG();
  const env = { localStorage: storage, toolFlashEl: fakeEl(), G, toast: () => {}, setTimeout: (fn) => 0 };
  const { flashToolName } = loadFns(env);

  for (let i = 1; i <= 3; i++) {
    env.toolFlashEl.reset();
    flashToolName(penBtn());
    check(`tap ${i}: name caption shown`, !env.toolFlashEl.isHidden() && env.toolFlashEl.textContent === 'Pen');
  }
  check('counts persisted per tool', JSON.parse(storage.getItem('oc-tool-seen')).pen === 3);

  env.toolFlashEl.reset();
  flashToolName(penBtn()); // 4th tap
  check('tap 4: caption no longer shown', env.toolFlashEl.isHidden() && env.toolFlashEl.textContent === '');

  // a different tool still teaches
  env.toolFlashEl.reset();
  flashToolName({ dataset: { tool: 'eraser' }, title: 'Eraser' });
  check('other tool still flashes its name', !env.toolFlashEl.isHidden() && env.toolFlashEl.textContent === 'Eraser');

  // fade-out is scheduled and re-hides
  const fade = [...G._tos].reverse().find((t) => t.el === env.toolFlashEl);
  check('fade-out scheduled after caption', !!fade && fade.vars.delay === 1.1);
  fade.vars.onComplete();
  check('fade-out re-hides caption', env.toolFlashEl.isHidden());

  // fallback to title-less buttons
  env.toolFlashEl.reset();
  flashToolName({ dataset: { tool: 'neon' }, title: '' });
  check('falls back to tool id when no title', env.toolFlashEl.textContent === 'neon');

  // ---- maybeShowToolHint: once, then never ----
  const timers = [];
  const toasts = [];
  const env2 = {
    localStorage: fakeStorage(),
    toast: (m) => toasts.push(m),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    toolFlashEl: fakeEl(), G: makeG(),
  };
  const { maybeShowToolHint } = loadFns(env2);
  check('first visit: hint scheduled', maybeShowToolHint() === true);
  check('hint flag persisted', env2.localStorage.getItem('oc-hints-seen') === '1');
  check('hint toast delayed, not instant', timers.length === 1 && timers[0].ms === 1500);
  timers[0].fn();
  check('hint mentions press & hold', toasts.some((m) => /press & hold/i.test(m)));
  check('second visit: no hint', maybeShowToolHint() === false && timers.length === 1);

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
