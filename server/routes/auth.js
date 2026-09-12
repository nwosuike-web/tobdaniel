/**
 * Customer authentication, profile, addresses and password management.
 */
const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const { asyncWrap, requireAuth, loginLimiter, rateLimit } = require('../middleware');
const { sendEmail } = require('../settings');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- registration --------------------------------------------------------
router.post('/register', loginLimiter, asyncWrap(async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (!EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
  const info = db.prepare('INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)')
    .run(String(name).slice(0, 100), String(email).toLowerCase(), String(phone || '').slice(0, 30), auth.hashPassword(password), 'customer');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  mergeGuestCart(req, user.id);
  const token = auth.createSession(user, 60 * 60 * 24 * 7, req);
  res.json({ token, user: safeUser(user) });
}));

// ---------- login ------------------------------------------------------------------
router.post('/login', loginLimiter, asyncWrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    auth.recordAttempt(String(email).toLowerCase(), req.ip);
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (user.is_disabled) return res.status(403).json({ error: 'This account has been disabled. Contact support.' });
  auth.clearAttempts(String(email).toLowerCase(), req.ip);
  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
  mergeGuestCart(req, user.id);
  const token = auth.createSession(user, 60 * 60 * 24 * 7, req);
  res.json({ token, user: safeUser(user) });
}));

// ---------- me / profile -------------------------------------------------------------
router.get('/me', requireAuth, (req, res) => res.json(safeUser(req.user)));

router.put('/me', requireAuth, asyncWrap(async (req, res) => {
  const { name, phone } = req.body || {};
  db.prepare(`UPDATE users SET name = ?, phone = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(String(name || req.user.name).slice(0, 100), String(phone || req.user.phone).slice(0, 30), req.user.id);
  res.json(safeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
}));

router.put('/me/password', requireAuth, asyncWrap(async (req, res) => {
  const { current, next } = req.body || {};
  if (!auth.verifyPassword(current || '', req.user.password_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (String(next || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(auth.hashPassword(next), req.user.id);
  auth.revokeAllForUser(req.user.id);
  res.json({ ok: true, message: 'Password updated. Please sign in again.' });
}));

// ---------- forgot / reset ------------------------------------------------------------
router.post('/forgot', rateLimit({ windowMs: 60000, max: 5, message: 'Too many reset requests. Try again in a minute.' }), asyncWrap(async (req, res) => {
  const email = String((req.body || {}).email || '').toLowerCase();
  const user = db.prepare(`SELECT * FROM users WHERE email = ? AND role = 'customer'`).get(email);
  // Always respond the same way to avoid account enumeration.
  if (user) {
    const token = require('crypto').randomBytes(24).toString('hex');
    db.prepare(`INSERT INTO password_resets (user_id, email, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+1 hour'))`)
      .run(user.id, email, 'customer', auth.sha256(token));
    sendEmail(email, 'Reset your password', `Use this link to reset your password: /#/reset?token=${token}\n(expires in 1 hour)`);
  }
  res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
}));

router.post('/reset', asyncWrap(async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || String(password).length < 8) return res.status(400).json({ error: 'A valid token and a password of 8+ characters are required.' });
  const row = db.prepare(`SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`).get(auth.sha256(token));
  if (!row) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(password), row.user_id);
  db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE id = ?`).run(row.id);
  auth.revokeAllForUser(row.user_id);
  res.json({ ok: true, message: 'Password reset. Please sign in with your new password.' });
}));

// ---------- logout -----------------------------------------------------------------------
router.post('/logout', (req, res) => {
  const t = req.headers.authorization || (req.cookies || {}).td_token || '';
  if (t.startsWith('Bearer ')) auth.revokeToken(t.slice(7));
  else if (t) auth.revokeToken(t);
  res.json({ ok: true });
});

// ---------- addresses -----------------------------------------------------------------------
router.get('/addresses', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id').all(req.user.id));
});

router.post('/addresses', requireAuth, asyncWrap(async (req, res) => {
  const a = req.body || {};
  if (!a.full_name || !a.phone || !a.line1 || !a.city || !a.state) {
    return res.status(400).json({ error: 'Full name, phone, address, city and state are required.' });
  }
  if (a.is_default) db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
  const info = db.prepare(
    `INSERT INTO addresses (user_id, label, full_name, phone, line1, line2, city, state, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(req.user.id, String(a.label || 'Home').slice(0, 30), String(a.full_name).slice(0, 100), String(a.phone).slice(0, 30),
        String(a.line1).slice(0, 200), String(a.line2 || '').slice(0, 200), String(a.city).slice(0, 60), String(a.state).slice(0, 60),
        a.is_default ? 1 : 0);
  res.json(db.prepare('SELECT * FROM addresses WHERE id = ?').get(info.lastInsertRowid));
}));

router.put('/addresses/:id', requireAuth, asyncWrap(async (req, res) => {
  const a = req.body || {};
  const existing = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Address not found.' });
  if (a.is_default) db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
  db.prepare(
    `UPDATE addresses SET label = ?, full_name = ?, phone = ?, line1 = ?, line2 = ?, city = ?, state = ?, is_default = ? WHERE id = ?`
  ).run(String(a.label || existing.label).slice(0, 30), String(a.full_name || existing.full_name).slice(0, 100),
        String(a.phone || existing.phone).slice(0, 30), String(a.line1 || existing.line1).slice(0, 200),
        String(a.line2 || existing.line2).slice(0, 200), String(a.city || existing.city).slice(0, 60),
        String(a.state || existing.state).slice(0, 60), a.is_default ? 1 : 0, existing.id);
  res.json(db.prepare('SELECT * FROM addresses WHERE id = ?').get(existing.id));
}));

router.delete('/addresses/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- reviews ---------------------------------------------------------------------
router.post('/reviews', requireAuth, asyncWrap(async (req, res) => {
  const { productId, rating, title, body } = req.body || {};
  const r = parseInt(rating, 10);
  if (!productId || !r || r < 1 || r > 5) return res.status(400).json({ error: 'Please select a rating from 1 to 5 stars.' });
  const p = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  db.prepare('INSERT INTO reviews (product_id, user_id, rating, title, body, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(productId, req.user.id, r, String(title || '').slice(0, 150), String(body || '').slice(0, 1000), 'approved');
  const agg = db.prepare(`SELECT AVG(rating) AS a, COUNT(*) AS n FROM reviews WHERE product_id = ? AND status='approved'`).get(productId);
  db.prepare('UPDATE products SET rating_avg = ?, rating_count = ? WHERE id = ?').run(agg.a || 0, agg.n || 0, productId);
  res.json({ ok: true, message: 'Thanks for your review!' });
}));

router.get('/reviews/mine', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT r.*, p.name AS product_name, p.slug,
       (SELECT url FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC LIMIT 1) AS image
     FROM reviews r LEFT JOIN products p ON p.id = r.product_id WHERE r.user_id = ? ORDER BY r.created_at DESC`
  ).all(req.user.id);
  res.json(rows);
});

function safeUser(u) {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, createdAt: u.created_at };
}

// merge the guest's cart into the newly signed-in user's cart
function mergeGuestCart(req, userId) {
  const guest = req.headers['x-guest-id'];
  if (!guest) return;
  const guestOwner = 'g:' + guest;
  const userOwner = 'u:' + userId;
  const rows = db.prepare('SELECT * FROM carts WHERE owner = ?').all(guestOwner);
  if (!rows.length) return;
  for (const r of rows) {
    const ex = db.prepare('SELECT * FROM carts WHERE owner = ? AND product_id = ? AND saved_for_later = ?')
      .get(userOwner, r.product_id, r.saved_for_later);
    if (ex) db.prepare(`UPDATE carts SET qty = qty + ?, updated_at = datetime('now') WHERE id = ?`).run(r.qty, ex.id);
    else db.prepare('INSERT INTO carts (owner, product_id, qty, saved_for_later) VALUES (?, ?, ?, ?)')
      .run(userOwner, r.product_id, r.qty, r.saved_for_later);
  }
  db.prepare('DELETE FROM carts WHERE owner = ?').run(guestOwner);
  require('../events').emitChange('c:' + (userId ? 'u' + userId : 'g' + guest), {});
}

module.exports = router;
