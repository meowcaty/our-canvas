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
  try {
    await db.setDoc('canvas', { strokes, updatedAt: new Date().toISOString() });
  } catch (e) {
    console.error('canvas save failed:', e.message);
  }
}

module.exports = { loadCanvas, scheduleSave, flushSave };
