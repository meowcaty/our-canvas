// Tests open framing (2026-09-26): on load, zoom out to fit all content
// (never past 1x, never below the 0.2 pinch minimum) and center on the last
// non-delete edit; empty canvas keeps the default view.
// contentBounds + frameOnLoad are extracted VERBATIM from public/client.js.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');
const boundsSrc = src.match(/function contentBounds\(\) \{[\s\S]*?\n\}\n/)[0];
const frameSrc = src.match(/function frameOnLoad\(lastEdit\) \{[\s\S]*?\n\}\n/)[0];

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}
const approx = (a, b) => Math.abs(a - b) < 1e-6;

function makeEnv({ w = 400, h = 800, withG = true } = {}) {
  const tweens = [];
  const G = withG ? {
    to(obj, vars) {
      const tw = { obj, vars, killed: false, kill() { this.killed = true; } };
      tweens.push(tw);
      return tw;
    },
  } : null;
  const env = {
    strokes: new Map(),
    cam: { x: 0, y: 0, zoom: 1 },
    cssW: w, cssH: h,
    textMetrics: () => ({ w: 100, h: 20 }),
    G, _tweens: tweens,
    dirty: false,
  };
  return env;
}

const vm = require('vm');

function loadFns(env) {
  // Run the verbatim client functions in an isolated context, pre-seeded with
  // the module-level state they close over (cam, frameTween, dirty, ...).
  const sandbox = {
    strokes: env.strokes,
    textMetrics: env.textMetrics,
    cssW: env.cssW, cssH: env.cssH,
    cam: env.cam,
    G: env.G,
    frameTween: null,
    dirty: false,
  };
  vm.createContext(sandbox);
  vm.runInContext(boundsSrc + '\n' + frameSrc, sandbox, { filename: 'client-frame-fns' });
  const runTween = () => {
    const tw = env._tweens[env._tweens.length - 1];
    if (!tw || tw.killed) return null;
    for (const k of ['x', 'y', 'zoom']) if (tw.vars[k] !== undefined) tw.obj[k] = tw.vars[k];
    if (tw.vars.onUpdate) tw.vars.onUpdate();
    if (tw.vars.onComplete) tw.vars.onComplete();
    return tw;
  };
  return {
    frameOnLoad: sandbox.frameOnLoad,
    runTween,
    get cam() { return sandbox.cam; },
    get dirty() { return sandbox.dirty; },
    get frameTween() { return sandbox.frameTween; },
    killTween() { // what the canvas pointerdown handler does
      if (sandbox.frameTween) { sandbox.frameTween.kill(); sandbox.frameTween = null; }
    },
  };
}

const rect = (id, pts) => ({ id, tool: 'rect', points: pts, size: 8 });
const pen = (id, pts) => ({ id, tool: 'pen', points: pts, size: 10 });

(async () => {
  // 1. empty canvas → default view untouched
  let env = makeEnv();
  let f = loadFns(env);
  f.frameOnLoad(null);
  check('empty: cam untouched', f.cam.x === 0 && f.cam.y === 0 && f.cam.zoom === 1);
  check('empty: no tween', env._tweens.length === 0);

  // 2. sprawling content + far lastEdit → center shown first, then glide tween
  env = makeEnv();
  env.strokes.set('a', rect('a', [0, 0, 2000, 1000]));
  f = loadFns(env);
  f.frameOnLoad({ x: 1900, y: 900 });
  check('fit: center shown instantly', f.cam.x === 1000 && f.cam.y === 500 && approx(f.cam.zoom, 0.2));
  check('fit: glide tween started', env._tweens.length === 1);
  const tw = env._tweens[0];
  check('fit: glide targets lastEdit (zoom untouched)', tw.vars.x === 1900 && tw.vars.y === 900 && tw.vars.zoom === undefined);
  f.runTween();
  check('fit: tween paints via dirty', f.dirty === true);
  check('fit: cam glides to lastEdit', f.cam.x === 1900 && f.cam.y === 900 && approx(f.cam.zoom, 0.2));

  // 3. no lastEdit → centered on content middle, no glide
  env = makeEnv();
  env.strokes.set('a', rect('a', [0, 0, 1000, 500]));
  f = loadFns(env);
  f.frameOnLoad(undefined);
  check('no-lastEdit: centered on bbox middle, no tween',
    f.cam.x === 500 && f.cam.y === 250 && approx(f.cam.zoom, Math.min(400 / 1008, 800 / 508) * 0.92) && env._tweens.length === 0);

  // 3b. lastEdit already near the center → no pointless glide
  env = makeEnv();
  env.strokes.set('a', rect('a', [0, 0, 1000, 500]));
  f = loadFns(env);
  f.frameOnLoad({ x: 510, y: 260 });
  check('near-center: no glide tween', env._tweens.length === 0 && f.cam.x === 500 && f.cam.y === 250);

  // 4. tiny content → never zoom in past 1x on open (instant, no glide)
  env = makeEnv();
  env.strokes.set('a', rect('a', [0, 0, 100, 100]));
  f = loadFns(env);
  f.frameOnLoad(null);
  check('tiny: zoom capped at 1x', approx(f.cam.zoom, 1) && env._tweens.length === 0);

  // 5. freehand bounds span all points; text uses textMetrics (instant center)
  env = makeEnv({ w: 1000, h: 1000 });
  env.strokes.set('p', pen('p', [0, 0, 400, 0, 400, 300]));
  env.strokes.set('t', { id: 't', tool: 'text', x: 900, y: 900 });
  f = loadFns(env);
  f.frameOnLoad(null);
  // bounds: pen x[-5,405] y[-5,305] (size pad), text [900,1000]x[900,920]
  // → x0=-5,x1=1000,y0=-5,y1=920 → w=1005,h=925 → z=min(1000/1005,1000/925)*.92≈.9155
  check('mixed: zoom fits all', approx(f.cam.zoom, Math.min(1000 / 1005, 1000 / 925) * 0.92));
  check('mixed: centered on bbox middle', approx(f.cam.x, 497.5) && approx(f.cam.y, 457.5));

  // 6. user grabbing canvas kills the glide (simulated via accessor)
  env = makeEnv();
  env.strokes.set('a', rect('a', [0, 0, 2000, 2000]));
  f = loadFns(env);
  f.frameOnLoad({ x: 1900, y: 1900 });
  check('glide: tween active', !!f.frameTween && !env._tweens[0].killed);
  f.killTween(); // what the pointerdown handler does
  check('glide: killed on user input', f.frameTween === null && env._tweens[0].killed);

  // 7. no GSAP → instant set
  env = makeEnv({ withG: false });
  env.strokes.set('a', rect('a', [0, 0, 2000, 1000]));
  f = loadFns(env);
  f.frameOnLoad({ x: 10, y: 20 });
  check('no-GSAP: instant apply', f.cam.x === 10 && f.cam.y === 20 && approx(f.cam.zoom, 0.2) && f.dirty);

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
