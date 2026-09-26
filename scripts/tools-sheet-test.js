// Tests the tools sheet (2026-09-26): the top-bar tag button opens a frosted
// sheet listing every tool with its name; tapping a cell selects through the
// toolbar's own click path and dismisses; backdrop/button toggles it.
// The sheet block is extracted VERBATIM from public/client.js and run in a vm
// context with a fake DOM.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');
const sheetSrc = src.match(/const toolsBackdrop = \$\('#tools-backdrop'\);[\s\S]*?toolsBackdrop\.onclick = closeToolsSheet;\n/)[0];

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

/* ---------- fake DOM ---------- */
function fakeClassList() {
  const s = new Set(['hidden']);
  return {
    add: (c) => s.add(c), remove: (c) => s.delete(c),
    toggle: (c, f) => {
      if (f === undefined) { if (s.has(c)) s.delete(c); else s.add(c); }
      else if (f) s.add(c); else s.delete(c);
    },
    contains: (c) => s.has(c),
  };
}
function fakeEl() {
  const el = {
    classList: fakeClassList(), style: {}, dataset: {},
    textContent: '', children: [], _handlers: {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, fn) { this._handlers[t] = fn; },
    setAttribute() {}, click() {},
  };
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => _html,
    set: (v) => { _html = v; if (v === '') el.children.length = 0; }, // like a real DOM
  });
  return el;
}
function fakeSvg() { return { cloneNode: () => fakeSvg() }; }

const TOOL_DEFS = [
  ['pan', 'Move'], ['pen', 'Pen'], ['pencil', 'Pencil'], ['marker', 'Marker'],
  ['highlighter', 'Highlighter'], ['neon', 'Neon'], ['eraser', 'Eraser'],
  ['line', 'Line'], ['rect', 'Rectangle'], ['circle', 'Circle'], ['text', 'Text'],
];
const toolbarBtns = TOOL_DEFS.map(([id, title]) => {
  const b = fakeEl();
  b.dataset.tool = id; b.title = title;
  b.querySelector = (sel) => (sel === 'svg' ? fakeSvg() : null);
  b._clicked = false;
  b.click = () => { b._clicked = true; };
  return b;
});

const backdrop = fakeEl(), sheet = fakeEl(), grid = fakeEl(), toolsBtn = fakeEl();
grid.querySelectorAll = (sel) => (sel === '.tool-cell' ? grid.children.slice() : []);
const document = {
  createElement: () => fakeEl(),
  querySelectorAll: (sel) => (sel === '#tools-row .tool' ? toolbarBtns.slice() : []),
  querySelector: (sel) => {
    const m = sel.match(/#tools-row \.tool\[data-tool="([^"]+)"\]/);
    return m ? toolbarBtns.find((b) => b.dataset.tool === m[1]) || null : null;
  },
};
const bySel = { '#tools-backdrop': backdrop, '#tools-sheet': sheet, '#tools-grid': grid, '#btn-tools': toolsBtn };
const $ = (sel) => bySel[sel] || fakeEl();

function makeG() {
  const calls = [];
  return {
    _calls: calls,
    fromTo: (t, a, b) => calls.push({ kind: 'fromTo', t, a, b }),
    to: (t, v) => calls.push({ kind: 'to', t, v }),
  };
}

function loadSheet(currentTool) {
  const G = makeG();
  const sandbox = { $, document, G, tool: currentTool };
  vm.createContext(sandbox);
  vm.runInContext(sheetSrc, sandbox, { filename: 'client-tools-sheet' });
  return { sandbox, G };
}

(async () => {
  // 1. open builds the grid from the toolbar: 11 named cells
  let { sandbox, G } = loadSheet('pen');
  sandbox.openToolsSheet();
  check('open: backdrop & sheet shown', !backdrop.classList.contains('hidden') && !sheet.classList.contains('hidden'));
  check('open: 11 cells built', grid.children.length === 11);
  check('open: every cell named', grid.children.every((c, i) => {
    const label = c.children.find((x) => x.textContent === TOOL_DEFS[i][1]);
    return !!label && c.dataset.tool === TOOL_DEFS[i][0];
  }));
  check('open: current tool marked active',
    grid.children.find((c) => c.dataset.tool === 'pen').classList.contains('active'));
  check('open: backdrop fades in', G._calls.some((c) => c.kind === 'fromTo' && c.t === backdrop));
  check('open: sheet springs up', G._calls.some((c) => c.kind === 'fromTo' && c.t === sheet && /back\.out/.test(c.b.ease || '')));
  check('open: cells stagger in', G._calls.some((c) => c.kind === 'fromTo' && typeof c.t === 'string' && c.b.stagger > 0));

  // 2. tapping a cell selects through the toolbar button, then dismisses
  const eraserCell = grid.children.find((c) => c.dataset.tool === 'eraser');
  eraserCell._handlers.click();
  const eraserBtn = toolbarBtns.find((b) => b.dataset.tool === 'eraser');
  check('cell tap: toolbar button clicked', eraserBtn._clicked === true);
  const closeCall = G._calls.filter((c) => c.kind === 'to' && c.t === sheet).pop();
  check('cell tap: sheet dismisses', !!closeCall);
  closeCall.v.onComplete();
  check('dismiss: hidden after animation', sheet.classList.contains('hidden') && backdrop.classList.contains('hidden'));

  // 3. button toggles, backdrop closes
  ({ sandbox, G } = loadSheet('neon'));
  check('toggle: opens via top-bar button', (() => {
    toolsBtn.onclick();
    return !sheet.classList.contains('hidden');
  })());
  check('toggle: second tap closes', (() => {
    toolsBtn.onclick();
    return G._calls.some((x) => x.kind === 'to' && x.t === sheet);
  })());
  // reopen, then backdrop tap
  toolsBtn.onclick();
  check('backdrop tap closes sheet', (() => {
    backdrop.onclick();
    return G._calls.some((x) => x.kind === 'to' && x.t === sheet);
  })());

  // 4. reopening re-marks the active tool, no rebuild
  ({ sandbox, G } = loadSheet('text'));
  const before = grid.children.length;
  sandbox.openToolsSheet();
  check('reopen: grid not rebuilt', grid.children.length === before && before === 11);
  check('reopen: active follows current tool',
    grid.children.find((c) => c.dataset.tool === 'text').classList.contains('active'));

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
