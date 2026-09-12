/**
 * Shopping cart (guest + signed-in), wishlist and promo-code validation.
 * Cart is server-side and merges onto the user's account after login.
 */
const express = require('express');
const { db } = require('../db');
const { asyncWrap, requireAuth } = require('../middleware');
const { emitChange } = require('../events');

const router = express.Router();

function ownerKeyOf(req) {
  return req.user ? 'u' + req.user.id : 'g' + (req.headers['x-guest-id'] || '');
}

function ownerOf(req) {
  if (req.user) return 'u:' + req.user.id;
  let guest = req.headers['x-guest-id'] || '';
  if (!guest) guest = 'anon-' + (req.ip || '').replace(/[^a-zA-Z0-9]/g, '');
  return 'g:' + guest;
}

function cartPayload(owner) {
  const rows = db.prepare(
    `SELECT c.*, p.name, p.slug, p.price, p.compare_at_price, p.stock, p.is_active, p.brand,
       (SELECT url FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, position ASC LIMIT 1) AS image
     FROM carts c JOIN products p ON p.id = c.product_id
     WHERE c.owner = ? ORDER BY c.saved_for_later, c.updated_at DESC`
  ).all(owner);

  let flashSale = null;
  const flash = db.prepare(`SELECT * FROM flash_sales WHERE is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now')) ORDER BY ends_at ASC LIMIT 1`).get();
  if (flash) flashSale = flash;

  const items = rows.map((r) => {
    let unitPrice = r.price;
    let flashPrice = null;
    if (flashSale) {
      const fs = db.prepare('SELECT sale_price FROM flash_sale_items WHERE flash_sale_id = ? AND product_id = ?').get(flashSale.id, r.product_id);
      if (fs) { flashPrice = fs.sale_price; unitPrice = fs.sale_price; }
    }
    return {
      id: r.id, productId: r.product_id, qty: r.qty, savedForLater: !!r.saved_for_later,
      name: r.name, slug: r.slug, brand: r.brand, image: r.image, price: r.price,
      compareAtPrice: r.compare_at_price, flashPrice, unitPrice,
      stock: r.stock, available: r.is_active === 1 && r.stock > 0,
      lineTotal: unitPrice * r.qty
    };
  });

  const cartItems = items.filter((i) => !i.savedForLater);
  const savedItems = items.filter((i) => i.savedForLater);
  const subtotal = cartItems.reduce((s, i) => s + i.lineTotal, 0);
  const count = cartItems.reduce((s, i) => s + i.qty, 0);

  return { items: cartItems, savedItems, subtotal, count };
}

router.get('/cart', (req, res) => {
  const owner = ownerOf(req);
  const cart = cartPayload(owner);
  emitChange('cart:' + owner, {});
  emitChange('c:' + ownerKeyOf(req), {});
  res.json(cart);
});

router.post('/cart', asyncWrap(async (req, res) => {
  const owner = ownerOf(req);
  const productId = parseInt(req.body.productId, 10);
  const qty = Math.max(1, parseInt(req.body.qty, 10) || 1);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!p || !p.is_active) return res.status(404).json({ error: 'Product unavailable.' });
  if (p.stock < 1) return res.status(409).json({ error: 'Sorry, this item is out of stock.' });
  const existing = db.prepare('SELECT * FROM carts WHERE owner = ? AND product_id = ?').get(owner, productId);
  if (existing) {
    const newQty = Math.min(p.stock, existing.qty + qty);
    db.prepare(`UPDATE carts SET qty = ?, saved_for_later = 0, updated_at = datetime('now') WHERE id = ?`).run(newQty, existing.id);
  } else {
    db.prepare('INSERT INTO carts (owner, product_id, qty) VALUES (?, ?, ?)').run(owner, productId, Math.min(p.stock, qty));
  }
  emitChange('cart:' + owner, {});
  emitChange('c:' + ownerKeyOf(req), {});
  res.json(cartPayload(owner));
}));

router.patch('/cart/:id', asyncWrap(async (req, res) => {
  const owner = ownerOf(req);
  const row = db.prepare('SELECT * FROM carts WHERE id = ? AND owner = ?').get(req.params.id, owner);
  if (!row) return res.status(404).json({ error: 'Item not found.' });
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(row.product_id);
  const qty = parseInt(req.body.qty, 10);
  if (!qty || qty < 1) return res.status(400).json({ error: 'Invalid quantity.' });
  if (qty > p.stock) return res.status(409).json({ error: `Only ${p.stock} left in stock.` });
  db.prepare(`UPDATE carts SET qty = ?, updated_at = datetime('now') WHERE id = ?`).run(qty, row.id);
  emitChange('cart:' + owner, {});
  emitChange('c:' + ownerKeyOf(req), {});
  res.json(cartPayload(owner));
}));

router.post('/cart/:id/save-for-later', asyncWrap(async (req, res) => {
  const owner = ownerOf(req);
  const row = db.prepare('SELECT * FROM carts WHERE id = ? AND owner = ?').get(req.params.id, owner);
  if (!row) return res.status(404).json({ error: 'Item not found.' });
  db.prepare('UPDATE carts SET saved_for_later = ? WHERE id = ?').run(row.saved_for_later ? 0 : 1, row.id);
  emitChange('cart:' + owner, {});
  emitChange('c:' + ownerKeyOf(req), {});
  res.json(cartPayload(owner));
}));

router.delete('/cart/:id', (req, res) => {
  const owner = ownerOf(req);
  db.prepare('DELETE FROM carts WHERE id = ? AND owner = ?').run(req.params.id, owner);
  emitChange('cart:' + owner, {});
  emitChange('c:' + ownerKeyOf(req), {});
  res.json(cartPayload(owner));
});

// ---------- wishlist (signed-in) -------------------------------------------------
router.get('/wishlist', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT w.id, w.product_id, w.created_at, p.name, p.slug, p.price, p.compare_at_price, p.stock, p.is_active,
       (SELECT url FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, position ASC LIMIT 1) AS image
     FROM wishlists w JOIN products p ON p.id = w.product_id WHERE w.user_id = ? ORDER BY w.id DESC`
  ).all(req.user.id);
  res.json({ items: rows });
});

router.post('/wishlist', requireAuth, (req, res) => {
  const productId = parseInt(req.body.productId, 10);
  db.prepare('INSERT OR IGNORE INTO wishlists (user_id, product_id) VALUES (?, ?)').run(req.user.id, productId);
  res.json({ ok: true, count: db.prepare('SELECT COUNT(*) AS n FROM wishlists WHERE user_id = ?').get(req.user.id).n });
});

router.delete('/wishlist/:productId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM wishlists WHERE user_id = ? AND product_id = ?').run(req.user.id, req.params.productId);
  res.json({ ok: true, count: db.prepare('SELECT COUNT(*) AS n FROM wishlists WHERE user_id = ?').get(req.user.id).n });
});

// ---------- promo validation --------------------------------------------------------
router.post('/promo/validate', (req, res) => {
  const code = String((req.body || {}).code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Enter a promo code.' });
  const promo = db.prepare('SELECT * FROM promo_codes WHERE UPPER(code) = ?').get(code);
  if (!promo || !promo.is_active) return res.status(404).json({ error: 'This promo code is not valid.' });
  const now = new Date();
  if (promo.starts_at && new Date(promo.starts_at.replace(' ', 'T') + 'Z') > now) return res.status(400).json({ error: 'This promo code is not active yet.' });
  if (promo.ends_at && new Date(promo.ends_at.replace(' ', 'T') + 'Z') < now) return res.status(400).json({ error: 'This promo code has expired.' });
  if (promo.usage_limit && promo.used_count >= promo.usage_limit) return res.status(400).json({ error: 'This promo code has been fully redeemed.' });
  res.json({
    code: promo.code, type: promo.type, value: promo.value, minOrder: promo.min_order,
    endsAt: promo.ends_at, message: promo.type === 'freeship' ? 'Free delivery applied!' : 'Promo applied!'
  });
});

module.exports = router;
