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
function scheduleSave(strokes) {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await db.setDoc('canvas', { strokes, updatedAt: new Date().toISOString() });
    } catch (e) {
      console.error('canvas save failed:', e.message);
    }
  }, 1500);
}

module.exports = { loadCanvas, scheduleSave };
