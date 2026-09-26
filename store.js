/* 💾 Persistence — one shared canvas, saved atomically + debounced. */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const CANVAS_PATH = path.join(DATA_DIR, 'canvas.json');

function loadCanvas() {
  try {
    const data = JSON.parse(fs.readFileSync(CANVAS_PATH, 'utf8'));
    if (data && Array.isArray(data.strokes)) return data.strokes;
  } catch {}
  return [];
}

let saveTimer = null;
function scheduleSave(strokes) {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const tmp = CANVAS_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ strokes, updatedAt: new Date().toISOString() }));
      fs.renameSync(tmp, CANVAS_PATH);
    } catch (e) {
      console.error('canvas save failed:', e.message);
    }
  }, 1500);
}

module.exports = { loadCanvas, scheduleSave, DATA_DIR };
