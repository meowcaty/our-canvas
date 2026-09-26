// Tests the OTP digit-masking + eye toggle logic (2026-09-26).
// wireOtpBoxes is extracted VERBATIM from public/client.js and driven with
// a minimal fake DOM, so this tests the shipped code, not a copy.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');
// const-declared via eval stays scoped to the eval, so read the number directly
const MASK_DELAY = Number(src.match(/const MASK_DELAY = (\d+);/)[1]);
const wireSrc = src.match(/function wireOtpBoxes\(container, onComplete\) \{[\s\S]*?\n\}\n/)[0];
eval(wireSrc);

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeClassList() {
  const s = new Set();
  return {
    add: (c) => s.add(c), remove: (c) => s.delete(c),
    toggle: (c, f) => { if (f === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (f) s.add(c); else s.delete(c); },
    contains: (c) => s.has(c),
  };
}
function fakeInput() {
  const handlers = {};
  return {
    value: '', dataset: {}, classList: fakeClassList(), offsetWidth: 0,
    addEventListener(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    setAttribute() {}, select() {}, focus() { this._focused = true; },
    fire(ev, e = {}) {
      const evt = { target: this, preventDefault() { evt._pd = true; }, clipboardData: { getData: () => '' }, ...e };
      (handlers[ev] || []).forEach((fn) => fn(evt));
      return evt;
    },
  };
}
function fakeEye() {
  const handlers = {};
  const icons = { '.ic-eye': { classList: fakeClassList() }, '.ic-eye-off': { classList: fakeClassList() } };
  return {
    classList: fakeClassList(), _attrs: {},
    querySelector: (sel) => icons[sel],
    setAttribute(k, v) { this._attrs[k] = v; },
    addEventListener(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    click() { (handlers.click || []).forEach((fn) => fn()); },
  };
}
function fakeContainer(withEye) {
  const inputs = Array.from({ length: 8 }, fakeInput);
  const eye = withEye ? fakeEye() : null;
  return {
    inputs, eye,
    querySelectorAll: () => inputs,
    parentElement: { querySelector: () => eye },
  };
}
function typeDigit(inp, ch) { inp.value = ch; inp.fire('input'); }

(async () => {
  // --- masking behavior (no eye button) ---
  let completed = null;
  const c1 = fakeContainer(false);
  const box = wireOtpBoxes(c1, (pw) => { completed = pw; });

  typeDigit(c1.inputs[0], '5');
  check('typed digit shows immediately', c1.inputs[0].value === '5');
  check('value() reads the digit', box.value() === '5');
  await sleep(MASK_DELAY + 150);
  check('digit masks to • after a beat', c1.inputs[0].value === '•');
  check('dataset keeps the digit while masked', c1.inputs[0].dataset.d === '5' && box.value() === '5');

  // backspace on a masked box clears the digit (stays put)
  c1.inputs[0].fire('keydown', { key: 'Backspace' });
  check('backspace clears masked digit', !c1.inputs[0].dataset.d && c1.inputs[0].value === '' && box.value() === '');

  // fill all 8 → auto-submit with the real value, everything masked at once
  '12345678'.split('').forEach((ch, i) => typeDigit(c1.inputs[i], ch));
  check('auto-submit fires with full password', completed === '12345678');
  check('all boxes masked on submit', c1.inputs.every((inp) => inp.value === '•'));

  box.clear(false);
  check('clear() empties digits and display', box.value() === '' && c1.inputs.every((i) => i.value === '' && !i.dataset.d));

  // backspace on empty box steps back and clears the previous one
  typeDigit(c1.inputs[0], '9');
  typeDigit(c1.inputs[1], '8');
  c1.inputs[2].fire('keydown', { key: 'Backspace' });
  check('backspace on empty steps back + clears', !c1.inputs[1].dataset.d && c1.inputs[1]._focused && c1.inputs[0].dataset.d === '9');

  // paste fills boxes and submits
  completed = null;
  box.clear(false);
  c1.inputs[0].fire('paste', { clipboardData: { getData: () => '11223344' } });
  check('paste fills + auto-submits', completed === '11223344');

  // --- eye toggle ---
  const c2 = fakeContainer(true);
  let completed2 = null;
  const box2 = wireOtpBoxes(c2, (pw) => { completed2 = pw; });
  check('eye starts in masked mode', c2.eye._attrs['aria-pressed'] === 'false');
  typeDigit(c2.inputs[0], '7');
  await sleep(MASK_DELAY + 150);
  check('masked before reveal', c2.inputs[0].value === '•');
  c2.eye.click();
  check('eye reveals digits as numbers', c2.inputs[0].value === '7' && c2.eye._attrs['aria-pressed'] === 'true');
  typeDigit(c2.inputs[1], '3');
  await sleep(MASK_DELAY + 150);
  check('no masking while revealed', c2.inputs[1].value === '3');
  c2.eye.click();
  check('eye hides digits again', c2.inputs[0].value === '•' && c2.inputs[1].value === '•');
  check('submit still uses real digits after eye games',
    (typeDigit(c2.inputs[2], '1'), typeDigit(c2.inputs[3], '2'), typeDigit(c2.inputs[4], '3'),
     typeDigit(c2.inputs[5], '4'), typeDigit(c2.inputs[6], '5'), typeDigit(c2.inputs[7], '6'),
     completed2 === '73123456'));

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
