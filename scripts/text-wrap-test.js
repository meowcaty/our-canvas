// Regression test for paragraph text (2026-09-26): every text stroke lives in
// a box ({x, y, w}); long text wraps word-by-word within the box width like
// Photoshop; the box auto-grows in height; resizing changes the box (re-wrap),
// never the font size. Legacy strokes without `w` get a box fitted to their
// single line so nothing jumps.
//
// The paragraph-text block + applyResize are extracted VERBATIM from
// public/client.js and evaluated with a stub canvas context.
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
// the whole paragraph-text block: consts + textFontPx + textBoxW + wrapText + textMetrics
const blockStart = src.indexOf('/* ============ paragraph text');
const tmStart = src.indexOf('function textMetrics(s)', blockStart);
const paraSrc = src.slice(blockStart, fnEnd(tmStart));

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

// stub 2d context: average glyph ~0.55em, parsed from the set font
const ctx = {
  font: '',
  measureText(t) {
    const m = /(\d+(\.\d+)?)px/.exec(this.font);
    const fs = m ? Number(m[1]) : 16;
    return { width: String(t).length * fs * 0.55 };
  },
};

eval(paraSrc + '\n' + extractFn('applyResize'));

const T = (over) => ({ tool: 'text', size: 10, text: '', x: 0, y: 0, ...over });
// size 10 → fs 22 → avg char 12.1px

// ---- wrapping ----
check('short text stays one line', JSON.stringify(wrapText(T({ w: 500, text: 'hello world' }))) === '["hello world"]');
check('long text wraps at word boundaries',
  JSON.stringify(wrapText(T({ w: 100, text: 'hello world' }))) === '["hello","world"]');
check('word longer than the box breaks mid-word',
  JSON.stringify(wrapText(T({ w: 50, text: 'abcdefghij' }))) === '["abcd","efgh","ij"]');
check('explicit newlines preserved',
  JSON.stringify(wrapText(T({ w: 500, text: 'a\n\nb' }))) === '["a","","b"]');
check('empty text is one empty line', JSON.stringify(wrapText(T({ w: 500, text: '' }))) === '[""]');
check('multiple spaces survive', wrapText(T({ w: 500, text: 'a  b' }))[0] === 'a  b');

// ---- box width ----
check('explicit w honored', textBoxW(T({ w: 300, text: 'hi' })) === 300);
check('legacy text: box fitted to its line', Math.abs(textBoxW(T({ text: 'hi' })) - 24.2) < 1e-9);
check('legacy box never collapses', textBoxW(T({ text: '' })) >= 12);

// ---- metrics: height auto-grows ----
const m1 = textMetrics(T({ w: 500, text: 'hi' }));
check('metrics: w is the box', m1.w === 500);
check('metrics: single line h = fs*1.2', Math.abs(m1.h - 22 * 1.2) < 1e-9);
const m2 = textMetrics(T({ w: 100, text: 'hello world' }));
check('metrics: two lines → 2× line height', Math.abs(m2.h - 2 * 22 * 1.2) < 1e-9);

// ---- wrap cache ----
const s = T({ w: 100, text: 'hello world' });
const a = wrapText(s), b = wrapText(s);
check('cache: same input → same array', a === b);
s.text = 'hello';
check('cache: edit invalidates', wrapText(s) !== a && wrapText(s)[0] === 'hello');

// ---- resize: handles change the BOX, never the font size ----
const rs = (s2, opp, cur) => { applyResize(s2, { opposite: opp }, cur); return s2; };
let t = rs(T({ x: 100, y: 50, w: 200, size: 18 }), { x: 100, y: 0 }, { x: 350, y: 90 });
check('resize right: width grows, x anchored', t.w === 250 && t.x === 100);
check('resize right: y and size untouched', t.y === 50 && t.size === 18);
t = rs(T({ x: 100, y: 50, w: 200, size: 18 }), { x: 300, y: 0 }, { x: 50, y: 90 });
check('resize left: box grows leftward', t.w === 250 && t.x === 50);
t = rs(T({ x: 100, y: 50, w: 200, size: 18 }), { x: 100, y: 0 }, { x: 105, y: 90 });
check('resize: width floored at 24', t.w === 24);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
