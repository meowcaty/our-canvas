const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function roomPath(code) {
  return path.join(DATA_DIR, code + '.json');
}

/* Password hashing: scrypt with a per-room salt. */
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}
function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/* Load persisted room (password + strokes) or null if none. */
function loadRoom(code) {
  try {
    const raw = fs.readFileSync(roomPath(code), 'utf8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.strokes) || !data.passHash) return null;
    return { passHash: data.passHash, salt: data.salt, strokes: data.strokes };
  } catch {
    return null;
  }
}

/* Atomic, debounced save. Callers just call scheduleSave(room). */
const saveTimers = new Map();
function scheduleSave(room) {
  if (saveTimers.has(room.code)) return;
  saveTimers.set(room.code, setTimeout(() => {
    saveTimers.delete(room.code);
    try {
      const tmp = roomPath(room.code) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({
        passHash: room.passHash,
        salt: room.salt,
        strokes: room.strokes,
        updatedAt: new Date().toISOString(),
      }));
      fs.renameSync(tmp, roomPath(room.code));
    } catch (e) {
      console.error('save failed for room', room.code, e.message);
    }
  }, 1500));
}

module.exports = { loadRoom, scheduleSave, hashPassword, newSalt };
