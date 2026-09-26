// Tests the debounced-save + shutdown-flush path (2026-09-26):
// scheduleSave() batches rapid changes into one write ~1.5s later;
// flushSave() writes whatever is pending immediately (used on SIGTERM/SIGINT
// so a redeploy never eats the last moments of drawing).
// Runs against the JSON backend; backs up and restores data/canvas.json.
const fs = require('fs');
const path = require('path');

const results = [];
function check(name, cond) {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

(async () => {
  const db = require('../db');
  const store = require('../store');
  await db.init(); // json backend (no DATABASE_URL in test env)

  const f = path.join(__dirname, '..', 'data', 'canvas.json');
  const backup = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  try {
    // 1. debounced save eventually persists
    store.scheduleSave([{ id: 'debounced', tool: 'text', text: 'slow' }]);
    let doc = await db.getDoc('canvas', null);
    check('debounced: not written instantly', !doc || !doc.strokes.some((s) => s.id === 'debounced'));
    await new Promise((r) => setTimeout(r, 1800));
    doc = await db.getDoc('canvas', null);
    check('debounced: written ~1.5s later', !!doc && doc.strokes.some((s) => s.id === 'debounced'));

    // 2. flushSave writes pending changes immediately
    store.scheduleSave([{ id: 'flushed', tool: 'text', text: 'fast' }]);
    await store.flushSave();
    doc = await db.getDoc('canvas', null);
    check('flushSave: pending canvas written immediately', !!doc && doc.strokes.some((s) => s.id === 'flushed'));

    // 3. flushSave with nothing pending is a harmless no-op
    await store.flushSave();
    check('flushSave: no-op when nothing pending', true);

    // 4. rapid changes batch: last write wins, single document
    store.scheduleSave([{ id: 'batch-a', tool: 'text', text: 'a' }]);
    store.scheduleSave([{ id: 'batch-b', tool: 'text', text: 'b' }]);
    await new Promise((r) => setTimeout(r, 1800));
    doc = await db.getDoc('canvas', null);
    check('batching: latest state wins', !!doc && doc.strokes.some((s) => s.id === 'batch-b') && !doc.strokes.some((s) => s.id === 'batch-a'));
  } finally {
    if (backup === null) { try { fs.unlinkSync(f); } catch {} }
    else fs.writeFileSync(f, backup);
    await db.close();
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
