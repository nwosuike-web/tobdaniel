/**
 * Authentication primitives — password hashing (scrypt), HS256 JWT signing,
 * session records (for revocation / logout), and a brute-force lockout helper.
 */
const crypto = require('crypto');
const config = require('./config');
const { db } = require('./db');

const SALT_LEN = 16;
const KEY_LEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const hash = crypto.scryptSync(String(password), salt, KEY_LEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [saltHex, hashHex] = String(stored).split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signToken(payload, ttlSeconds) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, jti: crypto.randomBytes(12).toString('hex'), exp: Math.floor(Date.now() / 1000) + ttlSeconds, iat: Math.floor(Date.now() / 1000) }));
  const sig = b64url(crypto.createHmac('sha256', config.SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = b64url(crypto.createHmac('sha256', config.SECRET).update(`${header}.${body}`).digest());
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function createSession(user, ttlSeconds, req) {
  const token = signToken({ sub: user.id, role: user.role }, ttlSeconds);
  db.prepare(
    `INSERT INTO sessions (user_id, token_hash, role, user_agent, ip, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'))`
  ).run(user.id, sha256(token), user.role, req.get('user-agent') || '', req.ip || '', ttlSeconds);
  return token;
}

function sessionIsValid(token) {
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(sha256(token));
  if (!row) return false;
  return new Date(row.expires_at.replace(' ', 'T') + 'Z') > new Date();
}

function revokeToken(token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

function revokeAllForUser(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

// ---- brute-force protection ------------------------------------------------
const LOCK_AFTER = 10;      // attempts
const WINDOW_MIN = 15;      // minutes
const LOCK_MIN = 15;        // minutes

function recordAttempt(identifier, ip) {
  db.prepare('INSERT INTO login_attempts (identifier, ip) VALUES (?, ?)').run(identifier, ip);
}

function isLocked(identifier, ip) {
  const since = `datetime('now', '-${WINDOW_MIN} minutes')`;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n, MAX(attempted_at) AS last
       FROM login_attempts
       WHERE (identifier = ? OR ip = ?) AND attempted_at >= ` + since
    )
    .get(identifier, ip);
  if (row.n < LOCK_AFTER) return false;
  const last = new Date(String(row.last).replace(' ', 'T') + 'Z');
  return (Date.now() - last.getTime()) / 60000 < LOCK_MIN;
}

function clearAttempts(identifier, ip) {
  db.prepare('DELETE FROM login_attempts WHERE identifier = ? OR ip = ?').run(identifier, ip);
}

module.exports = {
  hashPassword,
  verifyPassword,
  sha256,
  signToken,
  verifyToken,
  createSession,
  sessionIsValid,
  revokeToken,
  revokeAllForUser,
  recordAttempt,
  isLocked,
  clearAttempts
};
