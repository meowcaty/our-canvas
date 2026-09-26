/* 💾 Storage — Neon Postgres (DATABASE_URL) with local JSON fallback.
   - Set DATABASE_URL to a Neon connection string and everything (canvas,
     sessions, bans) persists durably across Render redeploys.
   - Without it, plain JSON files in ./data are used (local dev). On Render's
     free tier those files are wiped on every redeploy — that's what DATABASE_URL fixes.
   - One tiny table: kv_store(key TEXT PRIMARY KEY, value JSONB).
   - If DATABASE_URL is set but unreachable, init() throws and the app refuses
     to boot — failing loudly beats silently writing to disk that gets wiped. */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const usePg = !!process.env.DATABASE_URL;
let pool = null;

function jsonPath(key) {
  return path.join(DATA_DIR, key + '.json');
}

async function init() {
  if (!usePg) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    return { backend: 'json' };
  }
  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch {
    throw new Error('DATABASE_URL is set but the "pg" module is not installed. Run: npm install pg');
  }
  const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 3,
  });
  // fail fast if the database is unreachable — never boot half-persisted
  await pool.query('SELECT 1');
  await pool.query(`CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`);
  return { backend: 'postgres' };
}

async function getDoc(key, fallback) {
  if (!usePg) {
    try {
      return JSON.parse(fs.readFileSync(jsonPath(key), 'utf8'));
    } catch {
      return fallback;
    }
  }
  const r = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
  return r.rows.length ? r.rows[0].value : fallback;
}

async function setDoc(key, value) {
  if (!usePg) {
    const tmp = jsonPath(key) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, jsonPath(key));
    return;
  }
  await pool.query(
    `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

async function close() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { init, getDoc, setDoc, close, backend: usePg ? 'postgres' : 'json' };
