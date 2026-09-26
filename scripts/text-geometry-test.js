// Regression test for the text selection-box misalignment (2026-09-26):
// the selection box / tap hit-test / handles / delete button must use the
// same geometry the text is actually drawn with (textBaseline 'top',
// glyphs hanging below (s.x, s.y), wrapped inside the text box).
// Previously shapeBBox placed the box ~0.82*h above the anchor while
// drawStroke rendered below it.
//
// The paragraph-text block + shapeBBox are extracted VERBATIM from
// public/client.js and evaluated with a stub canvas context, so this tests
// the shipped code, not a copy.
const fs = require('fs');
const path = require('path');

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
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('could not extract function ' + name);
  return src.slice(start, fnEnd(start));
}
const blockStart = src.indexOf('/* ============ paragraph text');
const tmStart = src.indexOf('function textMetrics(s)', blockStart);
const paraSrc = src.slice(blockStart, fnEnd(tmStart));

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

// stub 2d context: fixed 9.7px per char, like a monospace stand-in
const ctx = { font: '', measureText: (t) => ({ width: String(t).length * 9.7 }) };
eval(paraSrc + '\n' + extractFn('shapeBBox'));

// size 18 → fs 39.6; legacy 'hi' → box max(24, 19.4) = 24; single line → h = 39.6*1.2
const m = textMetrics({ size: 18, text: 'hi' });
check('textMetrics: h = lines*fs*1.2', Math.abs(m.h - 47.52) < 1e-9);
check('textMetrics: legacy w fitted to line (min 24)', m.w === 24);
const mBox = textMetrics({ size: 18, w: 300, text: 'hi' });
check('textMetrics: explicit box w honored', mBox.w === 300);

// THE regression: box top-left must equal the text anchor point
const b = shapeBBox({ tool: 'text', x: 100, y: 200, size: 18, text: 'hi' });
check('text bbox: x starts at anchor x', b.x === 100);
check('text bbox: y starts at anchor y (not above it)', b.y === 200);
check('text bbox: w/h match metrics', b.w === 24 && Math.abs(b.h - 47.52) < 1e-9);

// wrapped text: the box covers all lines
const bw = shapeBBox({ tool: 'text', x: 10, y: 20, size: 18, w: 50, text: 'aaa bbb ccc' });
// 9.7px/char: 'aaa bbb ccc' = 11 chars = 106.7px > 50 → wraps to 3 lines
check('wrapped bbox: h covers all lines', Math.abs(bw.h - 3 * 39.6 * 1.2) < 1e-9 && bw.w === 50);

// drawStroke must pin the baseline explicitly so render and box agree
const drawStrokeSrc = extractFn('drawStroke');
const textBranch = drawStrokeSrc.slice(drawStrokeSrc.indexOf("if (s.tool === 'text')"));
check('drawStroke text branch pins textBaseline=top',
  textBranch.includes("textBaseline = 'top'") && textBranch.indexOf("textBaseline = 'top'") < textBranch.indexOf('fillText'));
check('drawStroke text branch draws wrapped lines',
  textBranch.includes('wrapText(s)') && textBranch.includes('TEXT_LINE_H'));

// non-text shapes unaffected
const r = shapeBBox({ tool: 'rect', points: [10, 20, 50, 80] });
check('rect bbox unchanged', r.x === 10 && r.y === 20 && r.w === 40 && r.h === 60);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
