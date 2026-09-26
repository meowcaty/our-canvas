// Live-erase ghost test (2026-09-26): if a stroke is erased (or the canvas
// cleared) while its author is still drawing it, pen-up must NOT resurrect it.
// Extracts the real stroke-remove / canvas-clear handlers and endActiveStroke
// VERBATIM from public/client.js and drives them in a vm sandbox.
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
// socket.on('stroke-remove', ({ id }) => { ... }); — grab the arrow fn verbatim
function extractHandler(event) {
  const marker = `socket.on('${event}', `;
  const s = src.indexOf(marker);
  if (s < 0) throw new Error('missing handler ' + event);
  const arrowStart = src.indexOf('=>', s) + 2;
  const bodyStart = src.indexOf('{', arrowStart);
  return src.slice(arrowStart, fnEnd(bodyStart)).trim();
}

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

function makeWorld() {
  const emitted = [];
  const sandbox = {
    console,
    strokes: new Map(),
    socket: { emit: (ev, arg) => emitted.push([ev, arg]) },
    selectedId: null,
    undoStack: [],
    redoStack: [],
    emitted,
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    let activeStroke = null, strokeStarted = false, liveStrokeErased = false;
    let pendingPoints = [], flushTimer = null, dirty = false;
    function dropAddUndo(id) { const i = undoStack.findIndex(e => e.id === id); if (i >= 0) undoStack.splice(i, 1); }
    function deselect() { selectedId = null; }
    function toast() {}
  `, sandbox);
  vm.runInContext(extractFn('flushPoints'), sandbox);
  vm.runInContext(extractFn('endActiveStroke'), sandbox);
  vm.runInContext('__onRemove = ({ id }) => ' + extractHandler('stroke-remove'), sandbox);
  vm.runInContext('__onClear = () => ' + extractHandler('canvas-clear'), sandbox);
  return sandbox;
}
function beginLiveStroke(sb, id) {
  vm.runInContext(`
    activeStroke = { id: '${id}', tool: 'pen', color: '#ffffff', size: 8, points: [0,0,10,0] };
    strokeStarted = true; liveStrokeErased = false; pendingPoints = [20, 0];
  `, sb);
}

// ---- 1. erase mid-draw marks the live stroke ----
{
  const sb = makeWorld();
  beginLiveStroke(sb, 'live1');
  vm.runInContext(`__onRemove({ id: 'live1' })`, sb);
  check('stroke-remove on the live stroke sets liveStrokeErased', vm.runInContext('liveStrokeErased', sb) === true);
}

// ---- 2. pen-up after a mid-draw erase drops the stroke (no ghost) ----
{
  const sb = makeWorld();
  beginLiveStroke(sb, 'live1');
  vm.runInContext(`__onRemove({ id: 'live1' })`, sb);
  vm.runInContext(`endActiveStroke()`, sb);
  check('ghost not resurrected in the stroke map', !sb.strokes.has('live1'));
  check('no undo entry for the dropped stroke', sb.undoStack.length === 0);
  check('no stroke-end emitted for the dropped stroke', !sb.emitted.some(([e]) => e === 'stroke-end'));
  check('flag resets after pen-up', vm.runInContext('liveStrokeErased', sb) === false);
}

// ---- 3. control: normal pen-up still commits the stroke ----
{
  const sb = makeWorld();
  beginLiveStroke(sb, 'live2');
  vm.runInContext(`endActiveStroke()`, sb);
  check('normal pen-up commits the stroke', sb.strokes.has('live2'));
  check('normal pen-up pushes undo', sb.undoStack.length === 1 && sb.undoStack[0].id === 'live2');
  check('normal pen-up emits stroke-end', sb.emitted.some(([e, a]) => e === 'stroke-end' && a.id === 'live2'));
}

// ---- 4. canvas-clear mid-draw also drops the stroke ----
{
  const sb = makeWorld();
  beginLiveStroke(sb, 'live3');
  vm.runInContext(`__onClear()`, sb);
  vm.runInContext(`endActiveStroke()`, sb);
  check('clear mid-draw: no ghost on pen-up', !sb.strokes.has('live3'));
}

// ---- 5. stroke-remove for some OTHER stroke does not affect the live one ----
{
  const sb = makeWorld();
  beginLiveStroke(sb, 'live4');
  sb.strokes.set('other', { id: 'other' });
  vm.runInContext(`__onRemove({ id: 'other' })`, sb);
  check('unrelated remove leaves liveStrokeErased false', vm.runInContext('liveStrokeErased', sb) === false);
  vm.runInContext(`endActiveStroke()`, sb);
  check('unrelated remove: live stroke still commits', sb.strokes.has('live4'));
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
