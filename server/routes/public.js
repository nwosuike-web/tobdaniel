/**
 * Public catalog + content endpoints (read-only for anonymous visitors).
 */
const express = require('express');
const { db } = require('../db');
const { asyncWrap, csrfProtection } = require('../middleware');
const { publicSettings, notify, sendEmail, getSettings } = require('../settings');

const router = express.Router();
router.use(csrfProtection);

// ---------- helpers -----------------------------------------------------------
function productRow(id) {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) return null;
  p.images = db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY position').all(id);
  p.specs = db.prepare('SELECT * FROM product_specs WHERE product_id = ? ORDER BY position').all(id);
  p.category = db.prepare('SELECT id, name, slug, parent_id FROM categories WHERE id = ?').get(p.category_id);
  return p;
}

function currentFlashSale() {
  const row = db
    .prepare(`SELECT * FROM flash_sales WHERE is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now')) ORDER BY ends_at ASC LIMIT 1`)
    .get();
  return row || null;
}

function listProducts(where, params, sort, limit, offset) {
  const orderMap = {
    newest: 'p.created_at DESC',
    'price-asc': 'p.price ASC',
    'price-desc': 'p.price DESC',
    popular: 'p.sold_count DESC',
    rating: 'p.rating_avg DESC'
  };
  const order = orderMap[sort] || 'p.created_at DESC';
  const sql = `
    SELECT p.*, c.name AS category_name,
           (SELECT url FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, position ASC LIMIT 1) AS image
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    ${where}
    ORDER BY ${order}
    LIMIT ? OFFSET ?`;
  return db.prepare(sql).all(...params, limit, offset);
}

function countProducts(where, params) {
  return db.prepare(`SELECT COUNT(*) AS n FROM products p LEFT JOIN categories c ON c.id = p.category_id ${where}`).get(...params).n;
}

// ---------- store config -------------------------------------------------------
router.get('/config', (req, res) => {
  res.json(publicSettings());
});

// ---------- home aggregate -----------------------------------------------------
router.get('/home', (req, res) => {
  const flash = currentFlashSale();
  let flashProducts = [];
  if (flash) {
    flashProducts = db
      .prepare(
        `SELECT p.*, fsi.sale_price AS flash_price,
          (SELECT url FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, position ASC LIMIT 1) AS image
         FROM flash_sale_items fsi
         JOIN products p ON p.id = fsi.product_id
         WHERE fsi.flash_sale_id = ? AND p.is_active = 1 AND p.stock > 0
         LIMIT 8`
      )
      .all(flash.id);
  }
  const featured = listProducts('WHERE p.is_active = 1 AND p.is_featured = 1 AND p.stock > 0', [], 'popular', 8, 0);
  const newArrivals = listProducts('WHERE p.is_active = 1 AND p.is_new = 1 AND p.stock > 0', [], 'newest', 8, 0);
  const bestSellers = listProducts('WHERE p.is_active = 1 AND p.is_best_seller = 1 AND p.stock > 0', [], 'popular', 8, 0);
  const categories = db
    .prepare(`SELECT * FROM categories WHERE is_active = 1 AND parent_id IS NULL ORDER BY sort_order, name LIMIT 8`)
    .all()
    .map((c) => ({
      ...c,
      count: db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND is_active = 1').get(c.id).n
    }));
  const banners = db
    .prepare(`SELECT * FROM banners WHERE is_active = 1 AND position = 'home' ORDER BY sort_order LIMIT 5`)
    .all();
  const testimonials = db.prepare(`SELECT * FROM testimonials WHERE is_active = 1 ORDER BY id LIMIT 6`).all();

  res.json({
    flashSale: flash ? { id: flash.id, title: flash.title, endsAt: flash.ends_at, products: flashProducts } : null,
    featured,
    newArrivals,
    bestSellers,
    categories,
    banners,
    testimonials
  });
});

// ---------- categories ----------------------------------------------------------
router.get('/categories', (req, res) => {
  const rows = db.prepare(`SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, name`).all();
  const parents = rows.filter((r) => !r.parent_id);
  const tree = parents.map((p) => ({
    ...p,
    children: rows.filter((r) => r.parent_id === p.id)
  }));
  res.json(tree);
});

// ---------- product listing (search + filters + sort + pagination) ---------------
router.get('/products', (req, res) => {
  const {
    search = '', category = '', subcat = '', brand = '', min = '', max = '',
    rating = '', inStock = '', sort = 'newest', page = '1', limit = '12', flash = ''
  } = req.query;

  const where = [];
  const params = [];
  where.push('p.is_active = 1');

  if (flash === '1') {
    const fs = currentFlashSale();
    if (fs) {
      where.push('p.id IN (SELECT product_id FROM flash_sale_items WHERE flash_sale_id = ?)');
      params.push(fs.id);
    } else {
      where.push('0');
    }
  }

  if (search) {
    where.push(`(p.name LIKE ? OR p.brand LIKE ? OR p.sku LIKE ? OR c.name LIKE ? OR p.description LIKE ?)`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  if (category) {
    // `category` may be a category slug or a numeric id; include its subcategories.
    const catRow = /^\d+$/.test(category)
      ? db.prepare('SELECT id FROM categories WHERE id = ?').get(category)
      : db.prepare('SELECT id FROM categories WHERE slug = ?').get(category);
    if (catRow) {
      where.push(`(p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?))`);
      params.push(catRow.id, catRow.id);
    } else {
      where.push('0');
    }
  }
  if (subcat) { where.push('p.category_id = ?'); params.push(subcat); }
  if (brand) { where.push('p.brand = ?'); params.push(brand); }
  if (min !== '') { where.push('p.price >= ?'); params.push(Number(min)); }
  if (max !== '') { where.push('p.price <= ?'); params.push(Number(max)); }
  if (rating !== '') { where.push('p.rating_avg >= ?'); params.push(Number(rating)); }
  if (inStock === '1') { where.push('p.stock > 0'); }

  const whereSql = 'WHERE ' + where.join(' AND ');
  const pageN = Math.max(1, parseInt(page, 10) || 1);
  const limitN = Math.min(60, parseInt(limit, 10) || 12);
  const offset = (pageN - 1) * limitN;

  const total = countProducts(whereSql, params);
  const items = listProducts(whereSql, params, sort, limitN, offset);

  // attach flash-sale price when a sale is running
  const flashSale = currentFlashSale();
  if (flashSale) {
    const map = {};
    db.prepare('SELECT product_id, sale_price FROM flash_sale_items WHERE flash_sale_id = ?').all(flashSale.id)
      .forEach((r) => { map[r.product_id] = r.sale_price; });
    items.forEach((i) => { if (map[i.id] != null) i.flash_price = map[i.id]; });
  }

  // facet data for filters
  const brands = db.prepare(`SELECT DISTINCT brand FROM products WHERE is_active = 1 AND brand != '' ORDER BY brand`).all().map((r) => r.brand);
  const maxPrice = db.prepare(`SELECT MAX(price) AS m FROM products WHERE is_active = 1`).get().m || 0;

  res.json({
    items, total, page: pageN, pages: Math.max(1, Math.ceil(total / limitN)), limit: limitN,
    brands, maxPrice
  });
});

// ---------- search suggestions ---------------------------------------------------
router.get('/products/suggestions', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT name, brand, sku, category_id,
        (SELECT url FROM product_images WHERE product_id = products.id ORDER BY is_primary DESC, position ASC LIMIT 1) AS image
       FROM products WHERE is_active = 1 AND (name LIKE ? OR brand LIKE ? OR sku LIKE ?)
       LIMIT 6`
    )
    .all(like, like, like);
  res.json(rows);
});

// ---------- product detail ---------------------------------------------------------
router.get('/products/:slug', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE slug = ?').get(req.params.slug);
  if (!p || !p.is_active) return res.status(404).json({ error: 'Product not found.' });
  const full = productRow(p.id);

  // flash sale price (if any)
  const flash = currentFlashSale();
  if (flash) {
    const fs = db.prepare('SELECT sale_price FROM flash_sale_items WHERE flash_sale_id = ? AND product_id = ?').get(flash.id, p.id);
    full.flash_price = fs ? fs.sale_price : null;
    full.flash_ends_at = flash.ends_at;
  }

  // related products (same category)
  full.related = listProducts(
    'WHERE p.is_active = 1 AND p.category_id = ? AND p.id != ?',
    [p.category_id, p.id], 'popular', 4, 0
  );

  // frequently bought together (co-purchase frequency from order history)
  const together = db
    .prepare(
      `SELECT p.*, COUNT(*) AS freq,
        (SELECT url FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, position ASC LIMIT 1) AS image
       FROM order_items oi2
       JOIN order_items oi1 ON oi1.order_id = oi2.order_id AND oi1.product_id = ?
       JOIN products p ON p.id = oi2.product_id
       WHERE oi2.product_id != ? AND p.is_active = 1
       GROUP BY p.id ORDER BY freq DESC LIMIT 3`
    )
    .all(p.id, p.id);
  full.frequently_bought = together;

  // approved reviews
  full.reviews = db
    .prepare(
      `SELECT r.*, u.name AS reviewer FROM reviews r LEFT JOIN users u ON u.id = r.user_id
       WHERE r.product_id = ? AND r.status = 'approved' ORDER BY r.created_at DESC LIMIT 20`
    )
    .all(p.id);
  full.review_breakdown = db
    .prepare(`SELECT rating, COUNT(*) AS n FROM reviews WHERE product_id = ? AND status='approved' GROUP BY rating`)
    .all(p.id);

  res.json(full);
});

// ---------- FAQs / testimonials ----------------------------------------------------
router.get('/faqs', (req, res) => {
  res.json(db.prepare(`SELECT * FROM faqs WHERE is_active = 1 ORDER BY sort_order, id`).all());
});

// ---------- contact form -------------------------------------------------------------
router.post('/contact', (req, res) => {
  const { name, email, phone, subject, body } = req.body || {};
  if (!name || !email || !body) return res.status(400).json({ error: 'Please fill your name, email and message.' });
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
  if (!emailOk) return res.status(400).json({ error: 'Please enter a valid email address.' });
  db.prepare('INSERT INTO messages (name, email, phone, subject, body) VALUES (?, ?, ?, ?, ?)')
    .run(String(name).slice(0, 100), String(email).slice(0, 120), String(phone || '').slice(0, 30), String(subject || '').slice(0, 150), String(body).slice(0, 4000));
  const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all();
  admins.forEach((a) => notify(a.id, 'New support message', `Message from ${name}`, '/admin'));
  sendEmail(getSettings().contact.email, `New contact message from ${name}`, body);
  res.json({ ok: true, message: 'Message sent! Our team will get back to you shortly.' });
});

// ---------- newsletter -----------------------------------------------------------------
router.post('/newsletter', (req, res) => {
  const email = String((req.body || {}).email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  db.prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(email);
  res.json({ ok: true, message: 'Subscribed! Welcome to the Tob Daniel family.' });
});

module.exports = router;
