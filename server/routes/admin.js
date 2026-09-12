/**
 * Secure admin API. Every mutating call is guarded by requireAdmin,
 * every change is written to the audit log, and every change emits a
 * real-time event so storefront clients update without a rebuild.
 */
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db } = require('../db');
const auth = require('../auth');
const config = require('../config');
const { asyncWrap, requireAdmin, loginLimiter, rateLimit } = require('../middleware');
const { getSettings, setSetting, audit, notify, sendEmail, generateOrderNumber } = require('../settings');
const { emitChange } = require('../events');
const { STATUSES } = require('./orders');

const router = express.Router();

function fmt(n) { return '₦' + Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 }); }

// ---------- 2FA (email code) ---------------------------------------------------
const pending2fa = new Map(); // identifier -> { code, expires }
function issue2fa(identifier) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  pending2fa.set(identifier, { code, expires: Date.now() + 10 * 60 * 1000 });
  return code;
}

// ---------- file upload ----------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z.]/g, '') || '.jpg';
    cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only JPG, PNG, WEBP or GIF images are allowed.'), ok);
  }
});

// ============================ AUTH =============================================
router.post('/login', rateLimit({ windowMs: 60 * 1000, max: 20 }), loginLimiter, asyncWrap(async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) return res.status(400).json({ error: 'Enter your admin email and password.' });
  const user = db.prepare(`SELECT * FROM users WHERE (email = ? OR name = ?) AND role = 'admin'`)
    .get(String(identifier).toLowerCase(), String(identifier));
  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    auth.recordAttempt(String(identifier).toLowerCase(), req.ip);
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  if (user.is_disabled) return res.status(403).json({ error: 'Account disabled.' });
  auth.clearAttempts(String(identifier).toLowerCase(), req.ip);

  if (getSettings().admin2fa) {
    const code = issue2fa(user.email);
    sendEmail(user.email, 'Your admin verification code', `Your one-time code is ${code}. It expires in 10 minutes.`);
    return res.json({
      require2fa: true,
      identifier: user.email,
      devCode: config.NODE_ENV !== 'production' ? code : undefined
    });
  }

  const token = auth.createSession(user, config.SESSION_TTL.admin, req);
  res.json({ token, user: safeAdmin(user) });
}));

router.post('/2fa/verify', asyncWrap(async (req, res) => {
  const { identifier, code } = req.body || {};
  const pending = pending2fa.get(String(identifier).toLowerCase());
  if (!pending || pending.expires < Date.now() || pending.code !== String(code)) {
    return res.status(401).json({ error: 'Invalid or expired code.' });
  }
  pending2fa.delete(String(identifier).toLowerCase());
  const user = db.prepare(`SELECT * FROM users WHERE email = ? AND role = 'admin'`).get(String(identifier).toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid request.' });
  const token = auth.createSession(user, config.SESSION_TTL.admin, req);
  res.json({ token, user: safeAdmin(user) });
}));

router.post('/forgot', rateLimit({ windowMs: 60 * 1000, max: 5 }), asyncWrap(async (req, res) => {
  const email = String((req.body || {}).email || '').toLowerCase();
  const user = db.prepare(`SELECT * FROM users WHERE email = ? AND role = 'admin'`).get(email);
  if (user) {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare(`INSERT INTO password_resets (user_id, email, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+1 hour'))`)
      .run(user.id, email, 'admin', auth.sha256(token));
    sendEmail(email, 'Admin password reset', `Reset link: /${config.ADMIN_ROUTE.replace(/^\//, '')}#/reset?token=${token}`);
  }
  res.json({ ok: true, message: 'If that admin email exists, a reset link has been sent.' });
}));

router.post('/reset', asyncWrap(async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || String(password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const row = db.prepare(`SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`).get(auth.sha256(token));
  if (!row) return res.status(400).json({ error: 'Invalid or expired link.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(password), row.user_id);
  db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE id = ?`).run(row.id);
  auth.revokeAllForUser(row.user_id);
  res.json({ ok: true, message: 'Password reset. You can now sign in.' });
}));

router.post('/logout', requireAdmin, (req, res) => {
  auth.revokeToken(req.token);
  res.json({ ok: true });
});

// ============================ OVERVIEW ==========================================
router.get('/overview', requireAdmin, (req, res) => {
  const q = (sql, ...p) => db.prepare(sql).get(...p);
  const sales = q(`SELECT COALESCE(SUM(total),0) AS total FROM orders WHERE status != 'cancelled' AND status != 'refunded'`);
  const orders = q(`SELECT COUNT(*) AS n FROM orders`);
  const statusCounts = {};
  for (const s of STATUSES) statusCounts[s] = q(`SELECT COUNT(*) AS n FROM orders WHERE status = ?`, s).n;
  const customers = q(`SELECT COUNT(*) AS n FROM users WHERE role = 'customer'`);
  const lowStock = db.prepare(`SELECT id, name, sku, stock, price, (SELECT url FROM product_images WHERE product_id = products.id ORDER BY is_primary DESC LIMIT 1) AS image FROM products WHERE is_active = 1 AND stock <= 5 ORDER BY stock ASC LIMIT 8`).all();
  const recentOrders = db.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 8`).all();
  const recentCustomers = db.prepare(`SELECT * FROM users WHERE role = 'customer' ORDER BY created_at DESC LIMIT 6`).all();
  const messages = q(`SELECT COUNT(*) AS n FROM messages WHERE status = 'new'`);
  const today = q(`SELECT COALESCE(SUM(total),0) AS t FROM orders WHERE date(created_at) = date('now') AND status NOT IN ('cancelled','refunded')`).t;
  res.json({ sales: sales.total, orders: orders.n, statusCounts, customers: customers.n, lowStock, recentOrders, recentCustomers, newMessages: messages.n, todaySales: today });
});

router.get('/charts', requireAdmin, (req, res) => {
  const days = Math.min(90, parseInt(req.query.days || '30', 10));
  const since = `date('now', '-${days} days')`;
  const revenue = db.prepare(
    `SELECT date(created_at) AS d, COALESCE(SUM(total),0) AS v FROM orders WHERE status NOT IN ('cancelled','refunded') AND date(created_at) >= ${since} GROUP BY date(created_at) ORDER BY d`
  ).all();
  const ordersByDay = db.prepare(
    `SELECT date(created_at) AS d, COUNT(*) AS v FROM orders WHERE date(created_at) >= ${since} GROUP BY date(created_at) ORDER BY d`
  ).all();
  const byCategory = db.prepare(
    `SELECT c.name AS name, SUM(oi.price * oi.qty) AS v
     FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id
     JOIN orders o ON o.id = oi.order_id WHERE o.status NOT IN ('cancelled','refunded')
     GROUP BY c.name ORDER BY v DESC LIMIT 6`
  ).all();
  const topProducts = db.prepare(
    `SELECT p.name AS name, SUM(oi.qty) AS v FROM order_items oi JOIN products p ON p.id = oi.product_id
     JOIN orders o ON o.id = oi.order_id WHERE o.status NOT IN ('cancelled','refunded')
     GROUP BY p.id ORDER BY v DESC LIMIT 5`
  ).all();
  res.json({ revenue, ordersByDay, byCategory, topProducts });
});

router.get('/activity', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100').all();
  res.json(rows);
});

// ============================ PRODUCTS ===========================================
function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

router.get('/products', requireAdmin, (req, res) => {
  const { search = '', category = '', page = '1', limit = '20' } = req.query;
  const where = ['1=1']; const params = [];
  if (search) { where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.brand LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (category) { where.push('p.category_id = ?'); params.push(category); }
  const pageN = Math.max(1, parseInt(page, 10) || 1);
  const limitN = Math.min(100, parseInt(limit, 10) || 20);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM products p WHERE ${where.join(' AND ')}`).get(...params).n;
  const rows = db.prepare(
    `SELECT p.*, c.name AS category_name,
       (SELECT url FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, position ASC LIMIT 1) AS image
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limitN, (pageN - 1) * limitN);
  res.json({ items: rows, total, page: pageN, pages: Math.max(1, Math.ceil(total / limitN)) });
});

router.get('/products/:id', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  p.images = db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY position').all(p.id);
  p.specs = db.prepare('SELECT * FROM product_specs WHERE product_id = ? ORDER BY position').all(p.id);
  res.json(p);
});

function saveProductImages(productId, images) {
  if (!Array.isArray(images)) return;
  db.prepare('DELETE FROM product_images WHERE product_id = ?').run(productId);
  images.filter(Boolean).slice(0, 8).forEach((img, i) => {
    db.prepare('INSERT INTO product_images (product_id, url, position, is_primary) VALUES (?, ?, ?, ?)')
      .run(productId, String(img.url || img), i, i === 0 ? 1 : 0);
  });
}

function saveProductSpecs(productId, specs) {
  if (!Array.isArray(specs)) return;
  db.prepare('DELETE FROM product_specs WHERE product_id = ?').run(productId);
  specs.filter((s) => s && s.label).slice(0, 40).forEach((s, i) => {
    db.prepare('INSERT INTO product_specs (product_id, label, value, position) VALUES (?, ?, ?, ?)')
      .run(productId, String(s.label).slice(0, 80), String(s.value || '').slice(0, 200), i);
  });
}

function validateProduct(b, isUpdate) {
  const errs = [];
  if (!b.name) errs.push('Name is required.');
  if (!b.sku) errs.push('SKU is required.');
  if (!b.category_id) errs.push('Category is required.');
  if (b.price == null || isNaN(Number(b.price)) || Number(b.price) < 0) errs.push('A valid price is required.');
  if (b.stock == null || isNaN(Number(b.stock)) || Number(b.stock) < 0) errs.push('A valid stock quantity is required.');
  return errs;
}

router.post('/products', requireAdmin, asyncWrap(async (req, res) => {
  const b = req.body || {};
  const errs = validateProduct(b);
  if (errs.length) return res.status(400).json({ error: errs.join(' ') });
  let slug = slugify(b.name);
  if (db.prepare('SELECT id FROM products WHERE slug = ?').get(slug)) slug = slug + '-' + crypto.randomBytes(3).toString('hex');
  const sku = String(b.sku).toUpperCase();
  if (db.prepare('SELECT id FROM products WHERE sku = ?').get(sku)) return res.status(409).json({ error: 'SKU already exists.' });
  const info = db.prepare(
    `INSERT INTO products (name, slug, sku, category_id, brand, description, short_desc, price, compare_at_price, stock,
       is_active, is_featured, is_best_seller, is_new, video_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(String(b.name).slice(0, 200), slug, sku, b.category_id, String(b.brand || '').slice(0, 80),
        String(b.description || ''), String(b.short_desc || '').slice(0, 300), Number(b.price), Number(b.compare_at_price || 0),
        parseInt(b.stock, 10) || 0, b.is_active ? 1 : 0, b.is_featured ? 1 : 0, b.is_best_seller ? 1 : 0, b.is_new ? 1 : 0,
        String(b.video_url || '').slice(0, 300));
  const id = info.lastInsertRowid;
  saveProductImages(id, b.images);
  saveProductSpecs(id, b.specs);
  audit(req, 'product.create', 'product', id, null, { name: b.name, sku, price: b.price });
  emitChange('products', { id });
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
}));

router.put('/products/:id', requireAdmin, asyncWrap(async (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });
  const b = req.body || {};
  const errs = validateProduct(b, true);
  if (errs.length) return res.status(400).json({ error: errs.join(' ') });
  const sku = String(b.sku).toUpperCase();
  const dupe = db.prepare('SELECT id FROM products WHERE sku = ? AND id != ?').get(sku, existing.id);
  if (dupe) return res.status(409).json({ error: 'SKU already exists.' });
  db.prepare(
    `UPDATE products SET name = ?, sku = ?, category_id = ?, brand = ?, description = ?, short_desc = ?, price = ?,
       compare_at_price = ?, stock = ?, is_active = ?, is_featured = ?, is_best_seller = ?, is_new = ?, video_url = ?,
       updated_at = datetime('now') WHERE id = ?`
  ).run(String(b.name).slice(0, 200), sku, b.category_id, String(b.brand || '').slice(0, 80),
        String(b.description || ''), String(b.short_desc || '').slice(0, 300), Number(b.price), Number(b.compare_at_price || 0),
        parseInt(b.stock, 10) || 0, b.is_active ? 1 : 0, b.is_featured ? 1 : 0, b.is_best_seller ? 1 : 0, b.is_new ? 1 : 0,
        String(b.video_url || '').slice(0, 300), existing.id);
  if (Array.isArray(b.images)) saveProductImages(existing.id, b.images);
  if (Array.isArray(b.specs)) saveProductSpecs(existing.id, b.specs);
  audit(req, 'product.update', 'product', existing.id, { price: existing.price, stock: existing.stock, name: existing.name }, { name: b.name, price: b.price, stock: b.stock });
  emitChange('products', { id: existing.id });
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(existing.id));
}));

router.delete('/products/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM product_images WHERE product_id = ?').run(existing.id);
    db.prepare('DELETE FROM product_specs WHERE product_id = ?').run(existing.id);
    db.prepare('DELETE FROM carts WHERE product_id = ?').run(existing.id);
    db.prepare('DELETE FROM wishlists WHERE product_id = ?').run(existing.id);
    db.prepare('DELETE FROM reviews WHERE product_id = ?').run(existing.id);
    db.prepare('DELETE FROM flash_sale_items WHERE product_id = ?').run(existing.id);
    db.prepare('DELETE FROM products WHERE id = ?').run(existing.id);
  });
  tx();
  audit(req, 'product.delete', 'product', existing.id, { name: existing.name, sku: existing.sku }, null);
  emitChange('products', { id: existing.id, deleted: true });
  res.json({ ok: true });
});

router.post('/upload', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  audit(req, 'file.upload', 'file', req.file.filename, null, { original: req.file.originalname, size: req.file.size });
  res.json({ url: '/uploads/' + req.file.filename });
});

// ============================ CATEGORIES ==========================================
router.get('/categories', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all());
});

router.post('/categories', requireAdmin, asyncWrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Category name is required.' });
  let slug = slugify(b.name);
  if (db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug)) slug = slug + '-' + crypto.randomBytes(3).toString('hex');
  const info = db.prepare('INSERT INTO categories (name, slug, parent_id, image_url, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?)')
    .run(String(b.name).slice(0, 80), slug, b.parent_id || null, String(b.image_url || ''), parseInt(b.sort_order || 0, 10), b.is_active === false ? 0 : 1);
  audit(req, 'category.create', 'category', info.lastInsertRowid, null, { name: b.name });
  emitChange('categories', {});
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
}));

router.put('/categories/:id', requireAdmin, asyncWrap(async (req, res) => {
  const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Category not found.' });
  const b = req.body || {};
  db.prepare('UPDATE categories SET name = ?, parent_id = ?, image_url = ?, sort_order = ?, is_active = ? WHERE id = ?')
    .run(String(b.name || c.name).slice(0, 80), b.parent_id === undefined ? c.parent_id : (b.parent_id || null),
         String(b.image_url === undefined ? c.image_url : b.image_url), parseInt(b.sort_order === undefined ? c.sort_order : b.sort_order, 10),
         b.is_active === undefined ? c.is_active : (b.is_active ? 1 : 0), c.id);
  audit(req, 'category.update', 'category', c.id, { name: c.name, is_active: c.is_active }, { name: b.name, is_active: b.is_active });
  emitChange('categories', {});
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(c.id));
}));

router.post('/categories/reorder', requireAdmin, (req, res) => {
  const ids = (req.body || {}).orderedIds;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'orderedIds required.' });
  const tx = db.transaction(() => {
    ids.forEach((id, i) => db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?').run(i, id));
  });
  tx();
  audit(req, 'category.reorder', 'category', '', null, { ids });
  emitChange('categories', {});
  res.json({ ok: true });
});

router.delete('/categories/:id', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Category not found.' });
  const kids = db.prepare('SELECT id FROM categories WHERE parent_id = ?').all(c.id);
  const used = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ?').get(c.id).n;
  if (used > 0 || kids.length) return res.status(400).json({ error: 'Move or delete the products/subcategories in this category first.' });
  db.prepare('DELETE FROM categories WHERE id = ?').run(c.id);
  audit(req, 'category.delete', 'category', c.id, { name: c.name }, null);
  emitChange('categories', {});
  res.json({ ok: true });
});

// ============================ ORDERS =============================================
router.get('/orders', requireAdmin, (req, res) => {
  const { status = '', q = '', page = '1', limit = '20' } = req.query;
  const where = ['1=1']; const params = [];
  if (status) { where.push('o.status = ?'); params.push(status); }
  if (q) { where.push('(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ? OR o.customer_phone LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  const pageN = Math.max(1, parseInt(page, 10) || 1);
  const limitN = Math.min(100, parseInt(limit, 10) || 20);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${where.join(' AND ')}`).get(...params).n;
  const rows = db.prepare(
    `SELECT o.*, (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count
     FROM orders o WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limitN, (pageN - 1) * limitN);
  res.json({ items: rows, total, page: pageN, pages: Math.max(1, Math.ceil(total / limitN)) });
});

router.get('/orders/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Order not found.' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(row.id);
  const events = db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id').all(row.id);
  res.json({ ...row, shipping_address: JSON.parse(row.shipping_address || '{}'), items, events });
});

router.get('/orders/export', requireAdmin, (req, res) => {
  const { status = '' } = req.query;
  const rows = status ? db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC').all(status)
                      : db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  const lines = [['order_number', 'date', 'customer', 'email', 'phone', 'status', 'payment_method', 'subtotal', 'delivery_fee', 'discount', 'total']];
  for (const r of rows) lines.push([r.order_number, r.created_at, r.customer_name, r.customer_email, r.customer_phone, r.status, r.payment_method, r.subtotal, r.delivery_fee, r.discount_amount, r.total]);
  const csv = lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="orders-${Date.now()}.csv"`);
  res.send(csv);
});

router.put('/orders/:id/status', requireAdmin, asyncWrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Order not found.' });
  const { status, trackingNumber, trackingCarrier, note } = req.body || {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE orders SET status = ?, tracking_number = ?, tracking_carrier = ?, status_note = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(status, String(trackingNumber || row.tracking_number || ''), String(trackingCarrier || row.tracking_carrier || ''),
         String(note || '').slice(0, 500), row.id);
    db.prepare('INSERT INTO order_events (order_id, status, note) VALUES (?, ?, ?)').run(row.id, status, note || '');
    if (['cancelled', 'refunded'].includes(status) && !['cancelled', 'refunded'].includes(row.status)) {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(row.id);
      for (const it of items) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(it.qty, it.product_id);
    }
    if (status === 'shipped' && !row.tracking_number && trackingNumber) {
      // optional carrier webhook in production
    }
  });
  tx();

  if (row.user_id) notify(row.user_id, 'Order update', `Order ${row.order_number} is now ${status}.`, '#/account/orders/' + row.id);
  sendEmail(row.customer_email, `Order ${row.order_number} ${status}`, `Your order ${row.order_number} is now ${status}.${note ? ' Note: ' + note : ''}`);
  audit(req, 'order.status', 'order', row.id, { status: row.status }, { status, trackingNumber, note });
  emitChange('orders', { orderId: row.id });
  emitChange('products', {});
  if (row.user_id) emitChange('orders:u' + row.user_id, { orderId: row.id });
  res.json(db.prepare('SELECT * FROM orders WHERE id = ?').get(row.id));
}));

router.get('/orders/:id/invoice', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).send('Not found');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(row.id);
  const s = getSettings();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${row.order_number}</title>
<style>
 body{font-family:Georgia,serif;color:#0f1b3d;padding:40px;max-width:760px;margin:auto}
 h1{color:#0a3a8f;font-size:22px;margin:0} .muted{color:#6b7a99}
 .row{display:flex;justify-content:space-between;border-bottom:1px solid #e4ebf7;padding:10px 0}
 .tot{font-size:18px;font-weight:bold} table{width:100%;border-collapse:collapse;margin-top:20px}
 th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #eef2fa} th{color:#0a3a8f;font-size:12px;text-transform:uppercase}
 .badge{display:inline-block;background:#eef4ff;color:#0a3a8f;padding:4px 12px;border-radius:20px;font-size:12px}
 @media print{body{padding:10px}}
</style></head><body>
  <h1>${s.storeName}</h1><div class="muted">INVOICE · ${row.order_number}</div>
  <div class="muted">${row.created_at} · Status: <span class="badge">${row.status}</span></div>
  <div class="row"><span><b>Billed to</b><br>${row.customer_name}<br>${row.customer_email}<br>${row.customer_phone}</span>
    <span style="text-align:right"><b>Payment</b><br>${row.payment_method}<br>${row.payment_status}</span></div>
  <table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>
    ${items.map((i) => `<tr><td>${i.name}<br><span class="muted">${i.sku}</span></td><td>${i.qty}</td><td>${fmt(i.price)}</td><td>${fmt(i.price * i.qty)}</td></tr>`).join('')}
  </tbody></table>
  <div class="row"><span>Subtotal</span><span>${fmt(row.subtotal)}</span></div>
  <div class="row"><span>Delivery</span><span>${fmt(row.delivery_fee)}</span></div>
  <div class="row"><span>Discount</span><span>−${fmt(row.discount_amount)}</span></div>
  <div class="row tot"><span>Total</span><span>${fmt(row.total)}</span></div>
  <p class="muted" style="margin-top:40px">Thank you for your business. · ${s.contact.email} · ${s.contact.phone}</p>
</body></html>`);
});

// ============================ CUSTOMERS ==========================================
router.get('/customers', requireAdmin, (req, res) => {
  const { q = '' } = req.query;
  const rows = q
    ? db.prepare(`SELECT * FROM users WHERE role = 'customer' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?) ORDER BY created_at DESC LIMIT 200`).all(`%${q}%`, `%${q}%`, `%${q}%`)
    : db.prepare(`SELECT * FROM users WHERE role = 'customer' ORDER BY created_at DESC LIMIT 200`).all();
  const out = rows.map((u) => ({
    ...u, password_hash: undefined,
    orders: db.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id = ?').get(u.id).n,
    spent: db.prepare(`SELECT COALESCE(SUM(total),0) AS s FROM orders WHERE user_id = ? AND status NOT IN ('cancelled','refunded')`).get(u.id).s
  }));
  res.json(out);
});

router.get('/customers/:id', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Customer not found.' });
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(u.id);
  const addresses = db.prepare('SELECT * FROM addresses WHERE user_id = ?').all(u.id);
  res.json({ ...u, password_hash: undefined, orders, addresses });
});

router.put('/customers/:id', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Customer not found.' });
  const b = req.body || {};
  db.prepare(`UPDATE users SET is_disabled = ?, updated_at = datetime('now') WHERE id = ?`).run(b.is_disabled ? 1 : 0, u.id);
  if (b.is_disabled) auth.revokeAllForUser(u.id);
  audit(req, 'customer.update', 'customer', u.id, { is_disabled: u.is_disabled }, { is_disabled: b.is_disabled });
  emitChange('customers', {});
  res.json(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id));
});

// ============================ DISCOUNTS ==========================================
router.get('/discounts', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM promo_codes ORDER BY id DESC').all()));

router.post('/discounts', requireAdmin, asyncWrap(async (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Code is required.' });
  if (!['percent', 'fixed', 'freeship'].includes(b.type)) return res.status(400).json({ error: 'Invalid type.' });
  if (db.prepare('SELECT id FROM promo_codes WHERE UPPER(code) = ?').get(code)) return res.status(409).json({ error: 'Code already exists.' });
  const info = db.prepare(
    `INSERT INTO promo_codes (code, type, value, min_order, starts_at, ends_at, usage_limit, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(code, b.type, Number(b.value || 0), Number(b.min_order || 0), b.starts_at || null, b.ends_at || null,
        parseInt(b.usage_limit || 0, 10), b.is_active === false ? 0 : 1);
  audit(req, 'discount.create', 'promo', info.lastInsertRowid, null, { code, type: b.type });
  emitChange('discounts', {});
  res.json(db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(info.lastInsertRowid));
}));

router.put('/discounts/:id', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  db.prepare(`UPDATE promo_codes SET value = ?, min_order = ?, starts_at = ?, ends_at = ?, usage_limit = ?, is_active = ? WHERE id = ?`)
    .run(Number(b.value === undefined ? p.value : b.value), Number(b.min_order === undefined ? p.min_order : b.min_order),
         b.starts_at === undefined ? p.starts_at : b.starts_at, b.ends_at === undefined ? p.ends_at : b.ends_at,
         parseInt(b.usage_limit === undefined ? p.usage_limit : b.usage_limit, 10),
         b.is_active === undefined ? p.is_active : (b.is_active ? 1 : 0), p.id);
  audit(req, 'discount.update', 'promo', p.id, { value: p.value, is_active: p.is_active }, { value: b.value, is_active: b.is_active });
  emitChange('discounts', {});
  res.json(db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(p.id));
});

router.delete('/discounts/:id', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found.' });
  db.prepare('DELETE FROM promo_codes WHERE id = ?').run(p.id);
  audit(req, 'discount.delete', 'promo', p.id, { code: p.code }, null);
  emitChange('discounts', {});
  res.json({ ok: true });
});

// ============================ FLASH SALES ========================================
router.get('/flashsales', requireAdmin, (req, res) => {
  const sales = db.prepare('SELECT * FROM flash_sales ORDER BY id DESC').all();
  const out = sales.map((s) => ({
    ...s,
    items: db.prepare(
      `SELECT fsi.*, p.name, p.price, p.slug FROM flash_sale_items fsi JOIN products p ON p.id = fsi.product_id WHERE fsi.flash_sale_id = ?`
    ).all(s.id)
  }));
  res.json(out);
});

router.post('/flashsales', requireAdmin, asyncWrap(async (req, res) => {
  const b = req.body || {};
  const info = db.prepare('INSERT INTO flash_sales (title, starts_at, ends_at, is_active) VALUES (?, ?, ?, 1)')
    .run(String(b.title || 'Flash Sale').slice(0, 120), b.starts_at || null, b.ends_at || null);
  if (Array.isArray(b.items)) {
    const ins = db.prepare('INSERT INTO flash_sale_items (flash_sale_id, product_id, sale_price) VALUES (?, ?, ?)');
    for (const it of b.items) ins.run(info.lastInsertRowid, it.product_id, it.sale_price);
  }
  audit(req, 'flashsale.create', 'flash_sale', info.lastInsertRowid, null, { title: b.title });
  emitChange('flashsales', {});
  emitChange('products', {});
  res.json({ id: info.lastInsertRowid });
}));

router.put('/flashsales/:id', requireAdmin, (req, res) => {
  const s = db.prepare('SELECT * FROM flash_sales WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  db.prepare('UPDATE flash_sales SET title = ?, starts_at = ?, ends_at = ?, is_active = ? WHERE id = ?')
    .run(String(b.title || s.title).slice(0, 120), b.starts_at === undefined ? s.starts_at : b.starts_at,
         b.ends_at === undefined ? s.ends_at : b.ends_at, b.is_active === undefined ? s.is_active : (b.is_active ? 1 : 0), s.id);
  if (Array.isArray(b.items)) {
    db.prepare('DELETE FROM flash_sale_items WHERE flash_sale_id = ?').run(s.id);
    const ins = db.prepare('INSERT INTO flash_sale_items (flash_sale_id, product_id, sale_price) VALUES (?, ?, ?)');
    for (const it of b.items) ins.run(s.id, it.product_id, it.sale_price);
  }
  audit(req, 'flashsale.update', 'flash_sale', s.id, { is_active: s.is_active }, { is_active: b.is_active, items: b.items });
  emitChange('flashsales', {});
  emitChange('products', {});
  res.json({ ok: true });
});

router.delete('/flashsales/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM flash_sale_items WHERE flash_sale_id = ?').run(req.params.id);
  db.prepare('DELETE FROM flash_sales WHERE id = ?').run(req.params.id);
  audit(req, 'flashsale.delete', 'flash_sale', req.params.id, null, null);
  emitChange('flashsales', {});
  emitChange('products', {});
  res.json({ ok: true });
});

// ============================ BANNERS ============================================
router.get('/banners', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM banners ORDER BY sort_order').all()));

router.post('/banners', requireAdmin, asyncWrap(async (req, res) => {
  const b = req.body || {};
  const info = db.prepare('INSERT INTO banners (title, subtitle, cta_text, cta_link, image_url, position, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
    .run(String(b.title || '').slice(0, 150), String(b.subtitle || '').slice(0, 300), String(b.cta_text || '').slice(0, 60),
         String(b.cta_link || '').slice(0, 200), String(b.image_url || ''), String(b.position || 'home'), parseInt(b.sort_order || 0, 10));
  audit(req, 'banner.create', 'banner', info.lastInsertRowid, null, { title: b.title });
  emitChange('banners', {});
  res.json(db.prepare('SELECT * FROM banners WHERE id = ?').get(info.lastInsertRowid));
}));

router.put('/banners/:id', requireAdmin, (req, res) => {
  const b0 = db.prepare('SELECT * FROM banners WHERE id = ?').get(req.params.id);
  if (!b0) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  db.prepare('UPDATE banners SET title = ?, subtitle = ?, cta_text = ?, cta_link = ?, image_url = ?, position = ?, sort_order = ?, is_active = ? WHERE id = ?')
    .run(String(b.title === undefined ? b0.title : b.title).slice(0, 150), String(b.subtitle === undefined ? b0.subtitle : b.subtitle).slice(0, 300),
         String(b.cta_text === undefined ? b0.cta_text : b.cta_text).slice(0, 60), String(b.cta_link === undefined ? b0.cta_link : b.cta_link).slice(0, 200),
         String(b.image_url === undefined ? b0.image_url : b.image_url), String(b.position === undefined ? b0.position : b.position),
         parseInt(b.sort_order === undefined ? b0.sort_order : b.sort_order, 10), b.is_active === undefined ? b0.is_active : (b.is_active ? 1 : 0), b0.id);
  audit(req, 'banner.update', 'banner', b0.id, { is_active: b0.is_active }, { is_active: b.is_active });
  emitChange('banners', {});
  res.json(db.prepare('SELECT * FROM banners WHERE id = ?').get(b0.id));
});

router.delete('/banners/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM banners WHERE id = ?').run(req.params.id);
  audit(req, 'banner.delete', 'banner', req.params.id, null, null);
  emitChange('banners', {});
  res.json({ ok: true });
});

// ============================ REVIEWS ============================================
router.get('/reviews', requireAdmin, (req, res) => {
  const rows = db.prepare(
    `SELECT r.*, p.name AS product_name, u.name AS reviewer FROM reviews r
     LEFT JOIN products p ON p.id = r.product_id LEFT JOIN users u ON u.id = r.user_id
     ORDER BY r.created_at DESC LIMIT 300`
  ).all();
  res.json(rows);
});

router.put('/reviews/:id', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found.' });
  const status = ['approved', 'hidden'].includes(req.body.status) ? req.body.status : r.status;
  db.prepare('UPDATE reviews SET status = ? WHERE id = ?').run(status, r.id);
  refreshRating(r.product_id);
  audit(req, 'review.update', 'review', r.id, { status: r.status }, { status });
  emitChange('products', { id: r.product_id });
  res.json({ ok: true });
});

router.delete('/reviews/:id', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (r) {
    db.prepare('DELETE FROM reviews WHERE id = ?').run(r.id);
    refreshRating(r.product_id);
    emitChange('products', { id: r.product_id });
  }
  res.json({ ok: true });
});

function refreshRating(productId) {
  const agg = db.prepare(`SELECT AVG(rating) AS a, COUNT(*) AS n FROM reviews WHERE product_id = ? AND status = 'approved'`).get(productId);
  db.prepare('UPDATE products SET rating_avg = ?, rating_count = ? WHERE id = ?').run(agg.a || 0, agg.n || 0, productId);
}

// ============================ TESTIMONIALS / FAQS ================================
router.get('/testimonials', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM testimonials ORDER BY id DESC').all()));
router.post('/testimonials', requireAdmin, (req, res) => {
  const b = req.body || {};
  const info = db.prepare('INSERT INTO testimonials (name, location, rating, body, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(String(b.name || '').slice(0, 80), String(b.location || '').slice(0, 80), parseInt(b.rating || 5, 10), String(b.body || '').slice(0, 600));
  audit(req, 'testimonial.create', 'testimonial', info.lastInsertRowid, null, { name: b.name });
  emitChange('testimonials', {});
  res.json({ id: info.lastInsertRowid });
});
router.put('/testimonials/:id', requireAdmin, (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE testimonials SET name = ?, location = ?, rating = ?, body = ?, is_active = ? WHERE id = ?')
    .run(String(b.name || '').slice(0, 80), String(b.location || '').slice(0, 80), parseInt(b.rating || 5, 10), String(b.body || '').slice(0, 600), b.is_active ? 1 : 0, req.params.id);
  emitChange('testimonials', {});
  res.json({ ok: true });
});
router.delete('/testimonials/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM testimonials WHERE id = ?').run(req.params.id);
  emitChange('testimonials', {});
  res.json({ ok: true });
});

router.get('/faqs', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM faqs ORDER BY sort_order, id').all()));
router.post('/faqs', requireAdmin, (req, res) => {
  const b = req.body || {};
  const info = db.prepare('INSERT INTO faqs (question, answer, category, sort_order, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(String(b.question || '').slice(0, 300), String(b.answer || '').slice(0, 1000), String(b.category || 'General').slice(0, 60), parseInt(b.sort_order || 0, 10));
  audit(req, 'faq.create', 'faq', info.lastInsertRowid, null, { question: b.question });
  emitChange('faqs', {});
  res.json({ id: info.lastInsertRowid });
});
router.put('/faqs/:id', requireAdmin, (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE faqs SET question = ?, answer = ?, category = ?, sort_order = ?, is_active = ? WHERE id = ?')
    .run(String(b.question || '').slice(0, 300), String(b.answer || '').slice(0, 1000), String(b.category || 'General').slice(0, 60), parseInt(b.sort_order || 0, 10), b.is_active ? 1 : 0, req.params.id);
  emitChange('faqs', {});
  res.json({ ok: true });
});
router.delete('/faqs/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM faqs WHERE id = ?').run(req.params.id);
  emitChange('faqs', {});
  res.json({ ok: true });
});

// ============================ SUBSCRIBERS / MESSAGES =============================
router.get('/subscribers', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM subscribers ORDER BY id DESC LIMIT 500').all()));
router.delete('/subscribers/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM subscribers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/messages', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 300').all()));
router.put('/messages/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(['new', 'read', 'replied'].includes(req.body.status) ? req.body.status : 'read', req.params.id);
  res.json({ ok: true });
});

// ============================ SETTINGS ===========================================
router.get('/settings', requireAdmin, (req, res) => {
  const s = getSettings();
  const pay = config.PAYMENT_KEYS;
  res.json({ ...s, admin2fa: !!s.admin2fa, paymentConfigured: { paystack: !!pay.paystack.secret, flutterwave: !!pay.flutterwave.secret, stripe: !!pay.stripe.secret } });
});

router.put('/settings', requireAdmin, asyncWrap(async (req, res) => {
  const b = req.body || {};
  const s = getSettings();
  const prev = { storeName: s.storeName, slogan: s.slogan };
  const allowed = ['storeName', 'slogan', 'tagline', 'announcement', 'contact', 'social', 'shipping', 'paymentMethods', 'admin2fa', 'maintenance'];
  for (const k of allowed) {
    if (b[k] !== undefined) setSetting(k, b[k]);
  }
  audit(req, 'settings.update', 'settings', 'store', prev, { storeName: b.storeName, slogan: b.slogan });
  emitChange('settings', {});
  res.json(getSettings());
}));

// ============================ ADMIN PROFILE =======================================
router.put('/me/password', requireAdmin, asyncWrap(async (req, res) => {
  const { current, next } = req.body || {};
  if (!auth.verifyPassword(current || '', req.user.password_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (String(next || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(next), req.user.id);
  auth.revokeAllForUser(req.user.id);
  audit(req, 'admin.password_change', 'user', req.user.id, null, null);
  res.json({ ok: true });
}));

function safeAdmin(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

module.exports = router;
