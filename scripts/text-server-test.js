// Server-side text-box plumbing (2026-09-26): sanitizeStroke keeps the box
// width `w` on text strokes (default 280), allows longer paragraphs, and
// strokeCenter anchors the last-edit point on the box's horizontal center.
// Extracted VERBATIM from server.js.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function fnEnd(from) {
  let i = src.indexOf('{', from), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { if (--depth === 0) return i + 1; }
  }
  throw new Error('unbalanced braces');
}
function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('could not extract function ' + name);
  return src.slice(start, fnEnd(start));
}

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

const MAX_POINTS_PER_STROKE = 8000;
eval(extractFn('sanitizeStroke') + '\n' + extractFn('strokeCenter'));

const base = { tool: 'text', color: '#ff0000', size: 18, id: 't1', text: 'hello', x: 100, y: 200 };

// ---- sanitizeStroke ----
let s = sanitizeStroke({ ...base }, 'a1', 'Abi');
check('missing w → default 280', s.w === 280);
s = sanitizeStroke({ ...base, w: 420 }, 'a1', 'Abi');
check('text keeps explicit w=420', s.w === 420);
s = sanitizeStroke({ ...base, w: -50 }, 'a1', 'Abi');
check('negative w clamped to 24', s.w === 24);
s = sanitizeStroke({ ...base, w: 'junk' }, 'a1', 'Abi');
check('non-numeric w → default 280', s.w === 280);
s = sanitizeStroke({ ...base, w: 1e9 }, 'a1', 'Abi');
check('huge w clamped to 1e6', s.w === 1e6);
s = sanitizeStroke({ ...base, text: 'x'.repeat(600) }, 'a1', 'Abi');
check('paragraph text up to 500 chars', s.text.length === 500);
s = sanitizeStroke({ tool: 'text', color: '#ff0000', size: 18, id: 't2', text: 'x' }, 'a1', 'Abi');
check('text without x/y rejected', s === null);

// ---- strokeCenter ----
check('center on box middle-x', JSON.stringify(strokeCenter({ tool: 'text', x: 100, y: 200, w: 300 })) === '{"x":250,"y":200}');
check('legacy text centers on anchor', JSON.stringify(strokeCenter({ tool: 'text', x: 100, y: 200 })) === '{"x":100,"y":200}');
check('bad coords → null', strokeCenter({ tool: 'text', x: NaN, y: 200 }) === null);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
