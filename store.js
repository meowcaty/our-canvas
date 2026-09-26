/* 🖼️ Canvas persistence — debounced whole-document save via db.js. */
const db = require('./db');

async function loadCanvas() {
  try {
    const data = await db.getDoc('canvas', { strokes: [] });
    if (data && Array.isArray(data.strokes)) return data.strokes;
  } catch (e) {
    console.error('canvas load failed:', e.message);
  }
  return [];
}

// lastEdit: {x, y} of the most recent NON-delete change (draw / add / move /
// resize), or null. Deletes never move it — if the last action was a delete,
// it still points at the change before that. Centered on canvas open.
let lastEdit = null;
function setLastEdit(p) {
  lastEdit = p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
}
function getLastEdit() { return lastEdit; }
async function loadLastEdit() {
  try {
    const data = await db.getDoc('canvas', null);
    const p = data && data.lastEdit;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
  } catch (e) {
    console.error('lastEdit load failed:', e.message);
  }
  return null;
}

async function writeDoc(strokes) {
  try {
    await db.setDoc('canvas', { strokes, lastEdit, updatedAt: new Date().toISOString() });
  } catch (e) {
    console.error('canvas save failed:', e.message);
  }
}

let saveTimer = null;
let pendingStrokes = null;
function scheduleSave(strokes) {
  // debounced whole-document save: rapid strokes/erases batch into one write
  // at most ~1.5s after the last change, instead of hammering the database
  pendingStrokes = strokes;
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; flushSave(); }, 1500);
}
// write whatever is pending RIGHT NOW — used on graceful shutdown so a
// redeploy can never eat the last 1.5s of drawing
async function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!pendingStrokes) return;
  const strokes = pendingStrokes;
  pendingStrokes = null;
  await writeDoc(strokes);
}

module.exports = { loadCanvas, loadLastEdit, setLastEdit, getLastEdit, scheduleSave, flushSave };
