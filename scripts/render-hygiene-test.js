// Renderer state-hygiene test (2026-09-26): every drawStroke() call must leave
// the 2d context exactly as it found it (balanced save/restore, no leaked
// composite/alpha/blur). A leak here would corrupt everything drawn after —
// e.g. the eraser painting at a wrong transform or with a wrong composite.
// drawStroke + tracePath are extracted VERBATIM from public/client.js.
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

// mock 2d context: tracks the save stack and all mutable state
function mockCtx() {
  const stack = [];
  const state = {
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    shadowBlur: 0, shadowColor: 'transparent',
    lineWidth: 1, strokeStyle: '#000', fillStyle: '#000',
    lineCap: 'butt', lineJoin: 'miter', textBaseline: 'alphabetic', font: '',
  };
  const ops = [];
  return {
    _depth: () => stack.length,
    _state: state, _ops: ops,
    save() { stack.push({ ...state }); },
    restore() {
      if (!stack.length) throw new Error('restore() with empty stack — UNBALANCED');
      Object.assign(state, stack.pop());
    },
    set globalAlpha(v) { state.globalAlpha = v; }, get globalAlpha() { return state.globalAlpha; },
    set globalCompositeOperation(v) { state.globalCompositeOperation = v; },
    get globalCompositeOperation() { return state.globalCompositeOperation; },
    set shadowBlur(v) { state.shadowBlur = v; }, get shadowBlur() { return state.shadowBlur; },
    set shadowColor(v) { state.shadowColor = v; }, get shadowColor() { return state.shadowColor; },
    set lineWidth(v) { state.lineWidth = v; }, get lineWidth() { return state.lineWidth; },
    set strokeStyle(v) { state.strokeStyle = v; }, get strokeStyle() { return state.strokeStyle; },
    set fillStyle(v) { state.fillStyle = v; }, get fillStyle() { return state.fillStyle; },
    set lineCap(v) { state.lineCap = v; }, get lineCap() { return state.lineCap; },
    set lineJoin(v) { state.lineJoin = v; }, get lineJoin() { return state.lineJoin; },
    set textBaseline(v) { state.textBaseline = v; }, get textBaseline() { return state.textBaseline; },
    set font(v) { state.font = v; }, get font() { return state.font; },
    beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, rect() {}, ellipse() {},
    translate() {}, scale() {},
    stroke() { ops.push(['stroke', state.strokeStyle, state.lineWidth, state.globalAlpha, state.globalCompositeOperation]); },
    fill() { ops.push(['fill', state.fillStyle, state.globalAlpha]); },
    fillText() {}, measureText: () => ({ width: 10 }),
  };
}

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

const sandbox = {
  themeColors: { bg: '#0b0b10', dot: '#333' },
  TEXT_LINE_H: 1.2,
  textFontPx: () => 20,
  textFontCss: () => 'serif',
  wrapText: () => ['hello'],
  performance: { now: () => 0 },
  fontAnimActive: false,
  console,
};
sandbox.ctx = mockCtx();
vm.createContext(sandbox);
vm.runInContext(extractFn('tracePath') + '\n' + extractFn('drawStroke') +
  '\nthis.__draw = drawStroke;', sandbox, { filename: 'client-drawstroke' });
const draw = sandbox.__draw;

const strokes = [
  { tool: 'pen', color: '#ff0000', size: 8, points: [0, 0, 50, 50, 100, 20] },
  { tool: 'neon', color: '#0a84ff', size: 10, points: [0, 0, 50, 50, 100, 20] },
  { tool: 'neon', color: '#0a84ff', size: 10, points: [5, 5] },          // neon tap-dot
  { tool: 'eraser', color: '#000000', size: 12, points: [0, 0, 50, 50, 100, 20] },
  { tool: 'eraser', color: '#000000', size: 12, points: [7, 7] },        // eraser tap-dot
  { tool: 'text', color: '#ffffff', size: 18, x: 10, y: 10, w: 200, text: 'hi' },
  { tool: 'rect', color: '#00ff00', size: 6, points: [0, 0, 40, 40] },
  { tool: 'highlighter', color: '#ffff00', size: 10, points: [0, 0, 30, 30] },
];

let balanced = true;
for (const s of strokes) {
  const before = sandbox.ctx._depth();
  try { draw(s); } catch (e) { balanced = false; console.log('❌ threw for', s.tool, e.message); }
  if (sandbox.ctx._depth() !== before) { balanced = false; console.log(`❌ stack leak after ${s.tool}`); }
}
check('save/restore balanced for every tool (incl. neon + eraser)', balanced);
const st = sandbox.ctx._state;
check('composite back to source-over', st.globalCompositeOperation === 'source-over');
check('alpha back to 1', st.globalAlpha === 1);
check('shadowBlur back to 0', st.shadowBlur === 0);

// the eraser must paint the THEME BG (not the stroke color), wide (2.2x)
const eraserOps = sandbox.ctx._ops.filter((o) => o[0] === 'stroke' && o[1] === '#0b0b10');
check('eraser stroke paints theme bg color', eraserOps.length > 0);
check('eraser stroke is 2.2x wide', eraserOps.some((o) => Math.abs(o[2] - 12 * 2.2) < 1e-9));
const neonOps = sandbox.ctx._ops.filter((o) => o[0] === 'stroke' && o[4] === 'lighter');
check('neon halo passes use additive blending', neonOps.length === 2); // polyline: 2 passes (tap-dot needs none)

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
