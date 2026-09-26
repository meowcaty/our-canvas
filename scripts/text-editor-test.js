// Client test for the text editor overlay (2026-09-26): the textarea must stay
// a fixed, comfortable typing size no matter how narrow/wide the canvas text
// box is. (Regression: the editor used to scale its font to "preview" the
// box's wrapping, which exploded to ~100px for narrow boxes — one giant word
// per line, unusable.)
// showTextOverlay is extracted VERBATIM from public/client.js and run in a vm
// sandbox with stub DOM.
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
const start = src.indexOf('function showTextOverlay(');
if (start < 0) throw new Error('showTextOverlay not found');
const fnSrc = src.slice(start, fnEnd(start));
// verbatim font helpers (the overlay previews the font)
const fStart = src.indexOf('const FONTS = {');
const fontsSrc = src.slice(fStart, src.indexOf('};', fStart) + 2);
const tfcStart = src.indexOf('function textFontCss(');
const tfcSrc = src.slice(tfcStart, fnEnd(tfcStart));

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

function makeEnv(innerWidth = 390, innerHeight = 844) {
  const ta = { value: 'old', style: {}, oninput: null, focus() {} };
  const ov = { classList: { remove() {} }, style: {}, offsetHeight: 160 };
  const sandbox = {
    $: (sel) => (sel === '#inp-text' ? ta : ov),
    window: { innerWidth, innerHeight },
    G: null,
    textBox: null,
    textFont: 'playfair',
    setTimeout: (fn) => 0,
  };
  vm.createContext(sandbox);
  // the overlay previews the font: seed the sandbox with the verbatim FONTS block
  vm.runInContext(
    fontsSrc + '\nconst DEFAULT_FONT = "playfair";\n' + tfcSrc + '\n' +
    fnSrc + '\nthis.__show = showTextOverlay;',
    sandbox, { filename: 'client-text-editor' });
  return { sandbox, ta, ov };
}

function openBox(boxW, innerWidth) {
  const { sandbox, ta, ov } = makeEnv(innerWidth);
  sandbox.__show({ x: 100, y: 200, w: boxW }, 150, 300);
  return { sandbox, ta, ov };
}

// 1. narrow box must NOT blow up the typing font
{
  const { ta } = openBox(60);
  check('narrow box: editor font stays at CSS default', ta.style.fontSize === '');
}
// 2. wide box: same fixed size
{
  const { ta } = openBox(900);
  check('wide box: editor font stays at CSS default', ta.style.fontSize === '');
}
// 3. default tap box (280): same
{
  const { ta } = openBox(280);
  check('default box: editor font stays at CSS default', ta.style.fontSize === '');
}
// 4. overlay width stays within the viewport with margin
{
  const { ov } = openBox(60, 390);
  const w = parseFloat(ov.style.width);
  check('overlay fits phone viewport', w > 200 && w <= 390 - 24);
}
// 5. editor still targets the dragged box and clears old text
{
  const { sandbox, ta } = openBox(140);
  check('editor targets the dragged box', sandbox.textBox && sandbox.textBox.w === 140);
  check('editor clears previous text', ta.value === '');
}
// 6. typing auto-grow handler installed
{
  const { ta } = openBox(280);
  check('auto-grow oninput installed', typeof ta.oninput === 'function');
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
