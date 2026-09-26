// Text fonts + corner-scale handles (2026-09-26):
// - 4 fonts (vintage Playfair default), sanitized + persisted + broadcast
// - corner handles scale the type about the opposite corner; edge handles reflow
// Client/server functions are extracted VERBATIM and run in vm sandboxes.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function fnEnd(src, from) {
  let i = src.indexOf('{', from), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { if (--depth === 0) return i + 1; }
  }
  throw new Error('unbalanced braces');
}
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('could not extract function ' + name);
  return src.slice(start, fnEnd(src, start));
}

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

/* ---- client: fonts ---- */
{
  const from = clientSrc.indexOf('const FONTS = {');
  const fontsSrc = clientSrc.slice(from, clientSrc.indexOf('};', from) + 2);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    fontsSrc +
    '\nconst DEFAULT_FONT = "playfair";\n' +
    extractFn(clientSrc, 'textFontCss') +
    '\nthis.__tfc = textFontCss; this.__FONTS = FONTS;',
    sandbox, { filename: 'client-fonts' });
  const tfc = sandbox.__tfc;
  check('legacy text (no font) → vintage Playfair default', tfc({}).includes('Playfair Display'));
  check('bogus font → Playfair default', tfc({ font: 'comic-sans' }).includes('Playfair Display'));
  for (const [key, frag] of [['playfair', 'Playfair'], ['typewriter', 'Special Elite'], ['script', 'Pinyon Script'], ['classic', 'SF Pro Text']])
    check(`font "${key}" resolves to ${frag}`, tfc({ font: key }).includes(frag));
}

/* ---- client: oppositeCorner + applyResize ---- */
{
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    extractFn(clientSrc, 'oppositeCorner') + '\n' + extractFn(clientSrc, 'applyResize') +
    '\nthis.__oc = oppositeCorner; this.__ar = applyResize;',
    sandbox, { filename: 'client-resize' });
  const oc = sandbox.__oc, ar = sandbox.__ar;
  const b = { x: 100, y: 100, w: 200, h: 120 };
  check("edge 'l' opposite = right midpoint", JSON.stringify(oc(b, 'l')) === '{"x":300,"y":160}');
  check("edge 'r' opposite = left midpoint", JSON.stringify(oc(b, 'r')) === '{"x":100,"y":160}');

  // corner 'br' scale: 1.5x about the fixed top-left corner
  let s = { tool: 'text', x: 100, y: 100, w: 200, size: 20 };
  ar(s, { handle: { corner: 'br' }, startW: { x: 300, y: 220 }, opposite: { x: 100, y: 100 },
          origText: { x: 100, y: 100, w: 200, size: 20 } }, { x: 400, y: 280 });
  check('corner drag scales font size 20 → 30', s.size === 30);
  check('corner drag scales box width 200 → 300', s.w === 300);
  check('opposite corner stays anchored', s.x === 100 && s.y === 100);

  // size clamps at 200, box tracks the clamped size
  s = { tool: 'text', x: 100, y: 100, w: 200, size: 20 };
  ar(s, { handle: { corner: 'br' }, startW: { x: 300, y: 220 }, opposite: { x: 100, y: 100 },
          origText: { x: 100, y: 100, w: 200, size: 20 } }, { x: 3000, y: 2200 });
  check('corner scale clamps font at 200', s.size === 200);
  check('box width tracks clamped size (2000)', s.w === 2000);

  // edge 'l': reflow only, size untouched
  s = { tool: 'text', x: 100, y: 100, w: 200, size: 20 };
  ar(s, { handle: { corner: 'l' }, startW: { x: 100, y: 160 }, opposite: { x: 300, y: 160 },
          origText: { x: 100, y: 100, w: 200, size: 20 } }, { x: 50, y: 160 });
  check("edge 'l' widens box 200 → 250", s.x === 50 && s.w === 250);
  check("edge 'l' leaves font size alone", s.size === 20);

  // edge 'r': reflow only
  s = { tool: 'text', x: 100, y: 100, w: 200, size: 20 };
  ar(s, { handle: { corner: 'r' }, startW: { x: 300, y: 160 }, opposite: { x: 100, y: 160 },
          origText: { x: 100, y: 100, w: 200, size: 20 } }, { x: 350, y: 160 });
  check("edge 'r' widens box, anchor fixed", s.x === 100 && s.w === 250);
  check("edge 'r' leaves font size alone", s.size === 20);
}

/* ---- server: sanitize + transform patch ---- */
{
  const sandbox = { MAX_POINTS_PER_STROKE: 8000 };
  vm.createContext(sandbox);
  vm.runInContext(
    extractFn(serverSrc, 'sanitizeStroke') + '\n' + extractFn(serverSrc, 'strokeCenter') +
    '\nthis.__san = sanitizeStroke;',
    sandbox, { filename: 'server-font' });
  const san = sandbox.__san;
  const base = { tool: 'text', color: '#ff0000', size: 18, id: 't1', text: 'hello', x: 100, y: 200, w: 280 };
  let st = san({ ...base, font: 'script' }, 'a1', 'Abi');
  check('valid font survives sanitize', st.font === 'script');
  st = san({ ...base, font: 'wingdings' }, 'a1', 'Abi');
  check('bogus font → playfair default', st.font === 'playfair');
  st = san({ ...base }, 'a1', 'Abi');
  check('missing font → playfair default', st.font === 'playfair');

  // transform patch path: extract the inline socket handler body
  const onIdx = serverSrc.indexOf("socket.on('stroke-transform'");
  const arrow = serverSrc.indexOf('=>', onIdx);
  const body = serverSrc.slice(arrow + 2, fnEnd(serverSrc, arrow));
  const strokes = [{ id: 't1', tool: 'text', x: 100, y: 200, w: 280, size: 18, font: 'playfair' }];
  const emitted = [];
  const sb2 = {
    clients: new Map([['sock1', {}]]),
    strokes,
    store: { setLastEdit() {}, scheduleSave() {} },
    socket: { id: 'sock1', broadcast: { emit: (ev, msg) => emitted.push([ev, msg]) } },
  };
  vm.createContext(sb2);
  vm.runInContext(
    extractFn(serverSrc, 'strokeCenter') +
    `\nthis.__h = (payload) => { const socket = this.__socket; const clients = this.__clients;` +
    `\nconst strokes = this.__strokes; const store = this.__store;` +
    `\nconst { id, points, x, y, w, size, font } = payload;` + body + `\n};` +
    `\nthis.__socket = ${'null'};`,
    sb2, { filename: 'server-transform' });
  // wire the captured refs (the handler closes over the sandbox's own names)
  sb2.__socket = sb2.socket; sb2.__clients = sb2.clients; sb2.__strokes = sb2.strokes; sb2.__store = sb2.store;
  sb2.__h({ id: 't1', font: 'typewriter' });
  check('transform applies font patch', strokes[0].font === 'typewriter');
  check('transform broadcasts font', emitted.length === 1 && emitted[0][1].font === 'typewriter');
  sb2.__h({ id: 't1', font: 'hacker-font' });
  check('transform rejects bogus font', strokes[0].font === 'typewriter');
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
