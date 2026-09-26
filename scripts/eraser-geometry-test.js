// Eraser geometry test (2026-09-26): the eraser is geometric now — it cuts
// stroke paths instead of painting background-colored cover-up. These tests
// extract the real functions VERBATIM from public/client.js and verify:
//  - splitPolyline cuts / keeps / deletes correctly (incl. the fast-swipe
//    case where a segment crosses the dab but its endpoints don't)
//  - shapes resample to closed paths; text is immune
//  - applyEraseDab rewrites the stroke map, emits delete+add, and records
//    undo bookkeeping (removed originals, added fragments)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');
function fnEnd(from) {
  let i = src.indexOf('{', from), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { if (--depth === 0) return i + 1; }
  }
  throw new Error('unbalanced braces');
}
function extractFn(name) {
  const s = src.indexOf(`function ${name}(`);
  if (s < 0) throw new Error('missing ' + name);
  return src.slice(s, fnEnd(s));
}
function extractConst(name) {
  const m = src.match(new RegExp(`const ${name} = [^;]+;`));
  if (!m) throw new Error('missing const ' + name);
  return m[0];
}

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ---- pure geometry (no DOM needed) ----
{
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(
    extractFn('distToSeg') + '\n' +
    extractConst('ERASABLE') + '\n' +
    'let brushSize = 8;\n' +
    'function eraseRadiusWorld() { return brushSize * 1.1; }\n' +
    extractFn('sampleShapePath') + '\n' +
    extractFn('erasablePoints') + '\n' +
    extractFn('splitPolyline') + '\n' +
    'this.__t = { splitPolyline, sampleShapePath, erasablePoints, eraseRadiusWorld, ERASABLE };',
    sandbox, { filename: 'client-erase-geom' });
  const T = sandbox.__t;

  // 1. dab over the middle of a line → two fragments
  check('dab in middle splits line into 2', eq(
    T.splitPolyline([0, 0, 10, 0, 20, 0, 30, 0, 40, 0], 20, 0, 5),
    [[0, 0, 10, 0], [30, 0, 40, 0]]));

  // 2. dab far away → untouched (null)
  check('distant dab leaves stroke untouched',
    T.splitPolyline([0, 0, 10, 0, 20, 0], 500, 500, 5) === null);

  // 3. dab covering everything → fully erased ([])
  check('dab over whole stroke erases it fully',
    eq(T.splitPolyline([0, 0, 10, 0, 20, 0], 10, 0, 50), []));

  // 4. dots
  check('dot inside dab is erased', eq(T.splitPolyline([7, 7], 7, 7, 5), []));
  check('dot outside dab survives', T.splitPolyline([7, 7], 100, 100, 5) === null);

  // 5. fast swipe: segment crosses the dab, endpoints outside → still cut
  check('segment crossing dab with endpoints outside is cut',
    eq(T.splitPolyline([0, 0, 100, 0], 50, 0, 5), []));

  // 6. dab clipping the end → one fragment
  check('dab on the end leaves one fragment', eq(
    T.splitPolyline([0, 0, 10, 0, 20, 0, 30, 0, 40, 0], 38, 0, 5),
    [[0, 0, 10, 0, 20, 0, 30, 0]]));

  // 7. rect resamples to a closed loop on the perimeter
  {
    const p = T.sampleShapePath({ tool: 'rect', points: [0, 0, 40, 20] });
    const closed = p[0] === p[p.length - 2] && p[1] === p[p.length - 1];
    let onPerim = true;
    for (let i = 0; i < p.length; i += 2) {
      const x = p[i], y = p[i + 1];
      const edge = (y === 0 || y === 20) ? (x >= 0 && x <= 40) : (x === 0 || x === 40) ? (y >= 0 && y <= 20) : false;
      if (!edge) onPerim = false;
    }
    check('rect resamples to a closed perimeter loop', closed && onPerim && p.length > 8);
  }

  // 8. circle resamples to a closed loop at the right radius
  {
    const p = T.sampleShapePath({ tool: 'circle', points: [0, 0, 40, 40] });
    const closed = p[0] === p[p.length - 2] && p[1] === p[p.length - 1];
    let radiusOk = true;
    for (let i = 0; i < p.length; i += 2) {
      const r = Math.hypot(p[i] - 20, p[i + 1] - 20);
      if (Math.abs(r - 20) > 0.01) radiusOk = false;
    }
    check('circle resamples to a closed loop at the right radius', closed && radiusOk);
  }

  // 9. text is immune, pen passes through, circle resamples
  check('text is immune to the eraser',
    T.erasablePoints({ tool: 'text', text: 'hi', x: 0, y: 0, w: 100, points: [] }) === null);
  const penPts = [0, 0, 5, 5];
  check('pen stroke keeps its own points', T.erasablePoints({ tool: 'pen', points: penPts }) === penPts);
  check('circle becomes a sampled path', T.erasablePoints({ tool: 'circle', points: [0, 0, 40, 40] }).length > 4);

  // 10. erase radius matches the old 2.2x paint swath
  check('erase radius = brushSize * 1.1', T.eraseRadiusWorld() === 8 * 1.1);
}

// ---- applyEraseDab against a stubbed stroke map ----
{
  const emitted = [];
  let seq = 0;
  const sandbox = {
    console,
    strokes: new Map(),
    socket: { emit: (ev, data) => emitted.push([ev, data]) },
    selectedId: null,
    deselectCalls: 0,
    deselect() { sandbox.deselectCalls++; },
    newStrokeId() { return 'me:' + (++seq); },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    extractFn('distToSeg') + '\n' +
    extractConst('ERASABLE') + '\n' +
    extractFn('sampleShapePath') + '\n' +
    extractFn('erasablePoints') + '\n' +
    extractFn('splitPolyline') + '\n' +
    extractFn('applyEraseDab') + '\n' +
    'this.__apply = applyEraseDab;',
    sandbox, { filename: 'client-erase-apply' });
  const apply = sandbox.__apply;
  const newGesture = () => ({ erase: null });

  // 11. erasing the middle of a pen stroke: original removed, 2 fragments added
  const longLine = [];
  for (let x = 0; x <= 100; x += 10) longLine.push(x, 0);
  sandbox.strokes.set('s1', { id: 's1', tool: 'pen', color: '#111111', size: 8, points: longLine.slice() });
  const g1 = newGesture();
  check('dab splits a pen stroke', apply(50, 0, 5, g1) === true);
  check('original stroke removed from map', !sandbox.strokes.has('s1'));
  check('two fragments in map', sandbox.strokes.size === 2);
  check('emitted 1 delete + 2 adds',
    emitted.filter((e) => e[0] === 'stroke-delete').length === 1 &&
    emitted.filter((e) => e[0] === 'stroke-add').length === 2);
  check('undo bookkeeping: removed has the original',
    g1.erase.removed.has('s1') && eq(g1.erase.removed.get('s1').points, longLine));
  check('undo bookkeeping: added has the 2 fragments', g1.erase.added.size === 2);

  // 12. second dab splitting a fragment: bookkeeping tracks first-touch original + final fragments
  emitted.length = 0;
  const fragId = [...g1.erase.added][0];
  const g2 = { erase: g1.erase };
  apply(20, 0, 5, g2); // bites the first fragment again → it splits in two
  check('re-split fragment superseded in added set',
    !g2.erase.added.has(fragId) && g2.erase.added.size === 3);
  check('removed still holds only the original', g2.erase.removed.size === 1 && g2.erase.removed.has('s1'));

  // 13. text is immune even when the dab covers it
  sandbox.strokes.clear(); emitted.length = 0;
  sandbox.strokes.set('t1', { id: 't1', tool: 'text', text: 'hello', x: 0, y: 0, w: 200, size: 18, points: [] });
  const g3 = newGesture();
  check('dab over text changes nothing', apply(50, 10, 60, g3) === false && sandbox.strokes.has('t1'));
  check('no undo entry for immune text', g3.erase === null);

  // 14. biting a circle: fragments become plain pen ink (shape-ness is gone)
  sandbox.strokes.clear(); emitted.length = 0;
  sandbox.strokes.set('c1', { id: 'c1', tool: 'circle', color: '#ff0000', size: 6, points: [0, 0, 40, 40] });
  const g4 = newGesture();
  check('dab bites the circle', apply(40, 20, 8, g4) === true);
  const fragTools = [...sandbox.strokes.values()].map((s) => s.tool);
  check('bitten circle fragments are pen ink', fragTools.length > 0 && fragTools.every((t) => t === 'pen'));
  check('fragments keep the original color/size',
    [...sandbox.strokes.values()].every((s) => s.color === '#ff0000' && s.size === 6));

  // 15. erasing the selected stroke deselects it
  sandbox.strokes.clear(); emitted.length = 0; sandbox.deselectCalls = 0;
  sandbox.selectedId = 's9';
  sandbox.strokes.set('s9', { id: 's9', tool: 'pen', color: '#111111', size: 8, points: [0, 0, 100, 0] });
  apply(50, 0, 60, newGesture());
  check('erasing the selected stroke deselects', sandbox.deselectCalls === 1);

  // 16. erasing neon: the stroke (and its glow) is really gone — moving can't heal it
  sandbox.strokes.clear(); emitted.length = 0;
  sandbox.strokes.set('n1', { id: 'n1', tool: 'neon', color: '#ffe600', size: 10, points: [0, 0, 10, 0, 20, 0, 30, 0, 40, 0] });
  const g6 = newGesture();
  apply(20, 0, 11, g6);
  const left = [...sandbox.strokes.values()];
  const inkLeftNear = left.some((s) => s.points.some((_, i) => i % 2 === 0 &&
    Math.hypot(s.points[i] - 20, s.points[i + 1]) < 11));
  check('erased neon region holds no ink (no ghost glow possible)', !inkLeftNear && !sandbox.strokes.has('n1'));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} eraser geometry checks passed`);
process.exit(failed ? 1 : 0);
