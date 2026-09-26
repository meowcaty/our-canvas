// Client test for incoming stroke-transform (2026-09-26): when the partner
// resizes a text box, the server broadcasts { id, w } and the local client
// must apply w to its copy of the stroke so the box reflows live.
// The socket.on('stroke-transform') handler is extracted VERBATIM from
// public/client.js and run in a vm sandbox with stub socket/state.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');

function extractSocketOn(event) {
  const marker = `socket.on('${event}',`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('handler not found: ' + event);
  let i = start + 'socket.on'.length;
  while (src[i] !== '(') i++; // skip to the call's opening paren
  let pDepth = 0, bDepth = 0, brDepth = 0, inStr = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === inStr && src[i - 1] !== '\\') inStr = null;
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c;
    } else if (c === '(') {
      pDepth++;
    } else if (c === '{') {
      bDepth++;
    } else if (c === '[') {
      brDepth++;
    } else if (c === ')') {
      pDepth--;
      if (pDepth === 0 && bDepth === 0 && brDepth === 0) return src.slice(start, i + 1) + ';';
    } else if (c === '}') {
      bDepth--;
    } else if (c === ']') {
      brDepth--;
    }
  }
  throw new Error('unbalanced handler for ' + event);
}

const handlerSrc = extractSocketOn('stroke-transform');

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

function makeEnv() {
  const handlers = {};
  const strokes = new Map();
  const sandbox = {
    socket: { on: (ev, fn) => { handlers[ev] = fn; } },
    strokes,
    myStrokeIds: [],
    selectedId: null,
    deselect: () => {},
    dirty: false,
  };
  vm.createContext(sandbox);
  vm.runInContext(handlerSrc, sandbox, { filename: 'client-transform-handler' });
  return { handlers, strokes, sandbox };
}

// 1. w-only patch applies to a text stroke, other fields untouched
{
  const { handlers, strokes } = makeEnv();
  strokes.set('t1', { id: 't1', tool: 'text', text: 'hello world', x: 100, y: 200, w: 280, size: 24, color: '#fff' });
  handlers['stroke-transform']({ id: 't1', w: 400 });
  const s = strokes.get('t1');
  check('incoming w resizes the text box', s.w === 400);
  check('w-only patch keeps x/y/size/text', s.x === 100 && s.y === 200 && s.size === 24 && s.text === 'hello world');
}

// 2. patch without w leaves the box width alone
{
  const { handlers, strokes } = makeEnv();
  strokes.set('t2', { id: 't2', tool: 'text', text: 'hi', x: 10, y: 20, w: 280, size: 24 });
  handlers['stroke-transform']({ id: 't2', x: 50, y: 60 });
  const s = strokes.get('t2');
  check('move without w keeps box width', s.w === 280 && s.x === 50 && s.y === 60);
}

// 3. full patch applies every field (pre-existing behavior intact)
{
  const { handlers, strokes } = makeEnv();
  strokes.set('r1', { id: 'r1', tool: 'rect', x: 0, y: 0, size: 8, points: [0, 0, 10, 10] });
  handlers['stroke-transform']({ id: 'r1', points: [5, 5, 60, 40], x: 5, y: 5, size: 12 });
  const s = strokes.get('r1');
  check(
    'points/x/y/size still applied',
    JSON.stringify(s.points) === '[5,5,60,40]' && s.x === 5 && s.y === 5 && s.size === 12
  );
}

// 4. unknown id is ignored without throwing
{
  const { handlers, strokes } = makeEnv();
  let threw = false;
  try { handlers['stroke-transform']({ id: 'nope', w: 500 }); } catch { threw = true; }
  check('unknown id ignored safely', !threw && strokes.size === 0);
}

// 5. w applies to non-text strokes too (generic field)
{
  const { handlers, strokes } = makeEnv();
  strokes.set('c1', { id: 'c1', tool: 'circle', x: 0, y: 0, w: 100, size: 8 });
  handlers['stroke-transform']({ id: 'c1', w: 150 });
  check('w applies generically', strokes.get('c1').w === 150);
}

// 6. handler marks the frame dirty so the reflow repaints
{
  const { handlers, strokes, sandbox } = makeEnv();
  strokes.set('t3', { id: 't3', tool: 'text', text: 'x', x: 0, y: 0, w: 280, size: 24 });
  handlers['stroke-transform']({ id: 't3', w: 300 });
  check('incoming transform dirties the frame', sandbox.dirty === true);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
