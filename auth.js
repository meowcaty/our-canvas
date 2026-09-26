/* 🔐 Auth for Our Canvas — single shared canvas for two people.
   - Password comes from the CANVAS_PASSWORD env var (never in code or the client).
   - Login issues a random session token in an HttpOnly + Secure + SameSite=Strict cookie.
   - 3 wrong passwords from one IP → banned for 24h (IP + user-agent + timestamps logged).
   - Sessions and bans persist to disk so restarts don't reset them. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');
const BANS_PATH = path.join(DATA_DIR, 'bans.json');

const MAX_FAILS = 3;
const BAN_MS = Number(process.env.BAN_HOURS || 24) * 3600 * 1000;
const SESSION_MS = 30 * 24 * 3600 * 1000; // 30 days

/* ---------- password ---------- */
let PASS_HASH = null;
let PASS_SALT = null;

function initPassword() {
  const pw = process.env.CANVAS_PASSWORD;
  if (!pw || pw.length < 8) {
    throw new Error('CANVAS_PASSWORD env var must be set (min 8 characters). ' +
      'Set it in your Render dashboard → Environment, or export CANVAS_PASSWORD=... locally.');
  }
  PASS_SALT = crypto.randomBytes(16);
  PASS_HASH = crypto.scryptSync(pw, PASS_SALT, 32);
}

function verifyPassword(pw) {
  if (!PASS_HASH) return false;
  try {
    const h = crypto.scryptSync(String(pw || ''), PASS_SALT, 32);
    return h.length === PASS_HASH.length && crypto.timingSafeEqual(h, PASS_HASH);
  } catch {
    return false;
  }
}

/* ---------- tiny json persistence ---------- */
function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p, obj) {
  try {
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, p);
  } catch (e) { console.error('auth persist failed:', e.message); }
}

/* ---------- sessions ---------- */
let sessions = readJson(SESSIONS_PATH, {}); // tokenHash -> {name, createdAt, expiresAt}
function pruneSessions() {
  const now = Date.now();
  let changed = false;
  for (const [k, s] of Object.entries(sessions)) {
    if (s.expiresAt < now) { delete sessions[k]; changed = true; }
  }
  if (changed) writeJson(SESSIONS_PATH, sessions);
}
pruneSessions();

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sessions[tokenHash(token)] = { name: '', createdAt: now, expiresAt: now + SESSION_MS };
  writeJson(SESSIONS_PATH, sessions);
  return token;
}

function getSession(token) {
  if (!token) return null;
  const s = sessions[tokenHash(token)];
  if (!s) return null;
  if (s.expiresAt < Date.now()) { delete sessions[tokenHash(token)]; writeJson(SESSIONS_PATH, sessions); return null; }
  return s;
}

function setSessionName(token, name) {
  const s = getSession(token);
  if (!s) return false;
  s.name = String(name || '').trim().slice(0, 16);
  writeJson(SESSIONS_PATH, sessions);
  return true;
}

function destroySession(token) {
  if (!token) return;
  delete sessions[tokenHash(token)];
  writeJson(SESSIONS_PATH, sessions);
}

/* ---------- bans & rate limiting ---------- */
let bans = readJson(BANS_PATH, {}); // ip -> {fails, firstFail, bannedUntil, ua, log: [{t, ua, ok}]}

function getIp(req) {
  // trust proxy is set, so req.ip respects X-Forwarded-For on Render
  return (req.ip || req.connection?.remoteAddress || 'unknown').toString().slice(0, 64);
}
function getSocketIp(handshake) {
  const fwd = handshake.headers['x-forwarded-for'];
  const ip = (typeof fwd === 'string' ? fwd.split(',')[0] : handshake.address || 'unknown').toString().trim();
  return ip.slice(0, 64);
}

function isBanned(ip) {
  const b = bans[ip];
  return !!b && b.bannedUntil && b.bannedUntil > Date.now();
}
function banInfo(ip) {
  const b = bans[ip];
  if (!b) return { fails: 0, remaining: MAX_FAILS, bannedUntil: 0 };
  return { fails: b.fails, remaining: Math.max(0, MAX_FAILS - b.fails), bannedUntil: b.bannedUntil || 0 };
}

function recordAttempt(ip, ua, ok) {
  const now = Date.now();
  let b = bans[ip];
  if (!b) b = bans[ip] = { fails: 0, firstFail: now, bannedUntil: 0, ua: '', log: [] };
  b.ua = String(ua || '').slice(0, 200);
  b.log.push({ t: new Date(now).toISOString(), ua: b.ua, ok: !!ok });
  if (b.log.length > 20) b.log = b.log.slice(-20);
  if (ok) {
    b.fails = 0; b.bannedUntil = 0;
  } else {
    b.fails += 1;
    if (b.fails >= MAX_FAILS && !isBanned(ip)) {
      b.bannedUntil = now + BAN_MS;
      console.log(`🚫 banned ${ip} for ${BAN_MS / 3600000}h after ${b.fails} failed logins (${b.ua})`);
    }
  }
  writeJson(BANS_PATH, bans);
  return banInfo(ip);
}

/* test-only hook */
function _reset() {
  sessions = {}; bans = {};
  try { fs.unlinkSync(SESSIONS_PATH); } catch {}
  try { fs.unlinkSync(BANS_PATH); } catch {}
}

function sessionCookie(token, secure) {
  const parts = [`canvas_session=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${SESSION_MS / 1000}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

module.exports = {
  initPassword, verifyPassword,
  createSession, getSession, setSessionName, destroySession,
  getIp, getSocketIp, isBanned, banInfo, recordAttempt,
  sessionCookie, parseCookies, tokenHash,
  MAX_FAILS, BAN_MS,
  _reset,
};
