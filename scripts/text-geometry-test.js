// Regression test for the text selection-box misalignment (2026-09-26):
// the selection box / tap hit-test / handles / delete button must use the
// same geometry the text is actually drawn with (textBaseline 'top',
// glyphs hanging below (s.x, s.y)). Previously shapeBBox placed the box
// ~0.82*h above the anchor while drawStroke rendered below it.
//
// The functions are extracted VERBATIM from public/client.js and evaluated
// with a stub canvas context, so this tests the shipped code, not a copy.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');

function extract(name) {
  const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  if (!m) throw new Error('could not extract function ' + name);
  return m[0];
}

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

// stub 2d context: fixed 9.7px per char, like a monospace stand-in
const ctx = { font: '', measureText: (t) => ({ width: String(t).length * 9.7 }) };
eval(extract('textMetrics') + '\n' + extract('shapeBBox'));

const m = textMetrics({ size: 18, text: 'hi' });
check('textMetrics: h = size*2.2', m.h === 39.6);
check('textMetrics: w from measureText', Math.abs(m.w - 19.4) < 1e-9);

// THE regression: box top-left must equal the text anchor point
const b = shapeBBox({ tool: 'text', x: 100, y: 200, size: 18, text: 'hi' });
check('text bbox: x starts at anchor x', b.x === 100);
check('text bbox: y starts at anchor y (not above it)', b.y === 200);
check('text bbox: w/h match metrics', Math.abs(b.w - 19.4) < 1e-9 && b.h === 39.6);

// drawStroke must pin the baseline explicitly so render and box agree
const drawStrokeSrc = src.match(/function drawStroke\(s\) \{[\s\S]*?\n\}\n/)[0];
const textBranch = drawStrokeSrc.slice(drawStrokeSrc.indexOf("if (s.tool === 'text')"));
check('drawStroke text branch pins textBaseline=top',
  textBranch.includes("textBaseline = 'top'") && textBranch.indexOf("textBaseline = 'top'") < textBranch.indexOf('fillText'));

// non-text shapes unaffected
const r = shapeBBox({ tool: 'rect', points: [10, 20, 50, 80] });
check('rect bbox unchanged', r.x === 10 && r.y === 20 && r.w === 40 && r.h === 60);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
