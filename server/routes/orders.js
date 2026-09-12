/**
 * Checkout + order lifecycle. Stock is validated and decremented in a single
 * transaction; a unique order number is generated; notifications are sent.
 */
const express = require('express');
const { db } = require('../db');
const { asyncWrap, requireAuth, rateLimit } = require('../middleware');
const { generateOrderNumber, notify, sendEmail, getSettings } = require('../settings');
const { emitChange } = require('../events');

const router = express.Router();

const STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];

function orderPayload(row, userId) {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(row.id);
  const events = db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id').all(row.id);
  const payment = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(row.id);
  let canCancel = false;
  if (userId && row.user_id === userId && ['pending', 'processing'].includes(row.status)) canCancel = true;
  return { ...row, shipping_address: JSON.parse(row.shipping_address || '{}'), items, events, payment, canCancel };
}

// ---------- place order -------------------------------------------------------------
// Checkout requires a signed-in account (guests are redirected to sign in/up first).
router.post('/orders', rateLimit({ windowMs: 60000, max: 10 }), requireAuth, asyncWrap(async (req, res) => {
  const body = req.body || {};
  const settings = getSettings();
  const methods = settings.paymentMethods;
  const pay = require('../config').PAYMENT_KEYS;
  const cardEnabled = !!(pay.paystack.secret || pay.flutterwave.secret || pay.stripe.secret);

  const method = String(body.paymentMethod || '');
  const methodOk =
    (method === 'card' && methods.card && cardEnabled) ||
    (method === 'bankTransfer' && methods.bankTransfer) ||
    (method === 'cashOnDelivery' && methods.cashOnDelivery) ||
    (method === 'mobileMoney' && methods.mobileMoney) ||
    (method === 'payOnDelivery' && methods.payOnDelivery);
  if (!methodOk) return res.status(400).json({ error: 'That payment method is not available. Please choose another.' });

  // --- cart resolution (signed-in user's cart) ---
  const owner = 'u:' + req.user.id;
  const rows = db.prepare(
    `SELECT c.*, p.name, p.slug, p.sku, p.price, p.stock, p.is_active,
       (SELECT url FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, position ASC LIMIT 1) AS image
     FROM carts c JOIN products p ON p.id = c.product_id WHERE c.owner = ? AND c.saved_for_later = 0`
  ).all(owner);
  if (!rows.length) return res.status(400).json({ error: 'Your cart is empty.' });

  // --- flash sale pricing ---
  const flash = db.prepare(`SELECT * FROM flash_sales WHERE is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now')) ORDER BY ends_at ASC LIMIT 1`).get();
  const flashPrices = {};
  if (flash) {
    for (const r of db.prepare('SELECT * FROM flash_sale_items WHERE flash_sale_id = ?').all(flash.id)) {
      flashPrices[r.product_id] = r.sale_price;
    }
  }

  // --- stock validation ---
  for (const r of rows) {
    if (!r.is_active) return res.status(409).json({ error: `"${r.name}" is no longer available.` });
    if (r.stock < r.qty) return res.status(409).json({ error: `Only ${r.stock} unit(s) of "${r.name}" left in stock.` });
  }

  // --- promo ---
  let promo = null;
  if (body.promoCode) {
    promo = db.prepare('SELECT * FROM promo_codes WHERE UPPER(code) = ?').get(String(body.promoCode).toUpperCase());
    const now = new Date();
    if (promo && promo.is_active && promo.usage_limit && promo.used_count >= promo.usage_limit) promo = null;
    if (promo && promo.starts_at && new Date(promo.starts_at.replace(' ', 'T') + 'Z') > now) promo = null;
    if (promo && promo.ends_at && new Date(promo.ends_at.replace(' ', 'T') + 'Z') < now) promo = null;
  }

  // --- totals ---
  let subtotal = 0;
  const items = rows.map((r) => {
    const unit = flashPrices[r.product_id] != null ? flashPrices[r.product_id] : r.price;
    subtotal += unit * r.qty;
    return { ...r, unit };
  });

  const shipping = settings.shipping || { flatFee: 2500, freeThreshold: 100000 };
  const express = body.deliveryMethod === 'express';
  let deliveryFee = express ? shipping.flatFee + 3000 : (subtotal >= (shipping.freeThreshold || Infinity) ? 0 : shipping.flatFee);
  let discount = 0;
  if (promo) {
    if (promo.type === 'percent') discount = Math.round(subtotal * promo.value / 100);
    else if (promo.type === 'fixed') discount = Math.min(promo.value, subtotal);
    else if (promo.type === 'freeship') { discount = deliveryFee; deliveryFee = 0; }
    if (promo.min_order && subtotal < promo.min_order) { promo = null; discount = 0; if (deliveryFee === 0 && body.promoCode) deliveryFee = shipping.flatFee; }
  }
  const total = Math.max(0, subtotal - discount + deliveryFee);

  // --- customer / address ---
  const addr = body.address || {};
  const name = String(body.name || (req.user ? req.user.name : '') || addr.full_name || '').slice(0, 100);
  const email = String(body.email || (req.user ? req.user.email : '') || addr.email || '').toLowerCase();
  const phone = String(body.phone || (req.user ? req.user.phone : '') || addr.phone || '').slice(0, 30);
  if (!name || !email || !phone) return res.status(400).json({ error: 'Please provide your name, email and phone number.' });
  const shipAddress = {
    label: addr.label || 'Delivery address',
    full_name: name, phone, email,
    line1: addr.line1 || '', line2: addr.line2 || '',
    city: addr.city || '', state: addr.state || '',
    note: addr.note || '', method: body.deliveryMethod === 'express' ? 'express' : 'standard'
  };
  if (!shipAddress.line1 || !shipAddress.city || !shipAddress.state) {
    return res.status(400).json({ error: 'Please provide a complete delivery address.' });
  }

  const orderNumber = generateOrderNumber();

  const placeOrder = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO orders (order_number, user_id, status, subtotal, delivery_fee, discount_amount, total, promo_code,
         payment_method, payment_status, customer_name, customer_email, customer_phone, shipping_address)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    ).run(orderNumber, req.user ? req.user.id : null, subtotal, deliveryFee, discount, total,
          promo ? promo.code : '', method, name, email, phone, JSON.stringify(shipAddress));

    const orderId = info.lastInsertRowid;
    for (const it of items) {
      db.prepare(
        `INSERT INTO order_items (order_id, product_id, name, sku, price, qty, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(orderId, it.product_id, it.name, it.sku, it.unit, it.qty, it.image || '');
      db.prepare(`UPDATE products SET stock = stock - ?, sold_count = sold_count + ?, updated_at = datetime('now') WHERE id = ?`)
        .run(it.qty, it.qty, it.product_id);
    }
    db.prepare(`INSERT INTO order_events (order_id, status, note) VALUES (?, 'pending', 'Order placed')`).run(orderId);
    db.prepare(
      `INSERT INTO payments (order_id, method, status, provider, reference, amount) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(orderId, method, method === 'card' ? 'pending' : 'pending', method === 'card' ? 'gateway' : 'manual', 'ref-' + orderNumber, total);
    if (promo) db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?').run(promo.id);
    db.prepare(`DELETE FROM carts WHERE owner = ? AND saved_for_later = 0`).run(owner);
    return orderId;
  });

  const orderId = placeOrder();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

  // --- notifications ---
  if (req.user) notify(req.user.id, 'Order confirmed', `Order ${orderNumber} has been placed successfully.`, '/account/orders/' + order.id);
  const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all();
  admins.forEach((a) => notify(a.id, 'New order', `New order ${orderNumber} — ${items.length} item(s), ${order.total}`, '/admin'));
  sendEmail(email, `Order ${orderNumber} confirmed`, `Thank you for shopping with Tob Daniel Business Enterprise!\nOrder: ${orderNumber}\nTotal: ${total}\nStatus: pending\n\nWe'll notify you when your order ships.`);

  emitChange('orders', { orderId });
  emitChange('products', {});
  emitChange('cart:' + owner, {});
  res.json({ ok: true, order: orderPayload(order, req.user ? req.user.id : null) });
}));

// ---------- my orders ------------------------------------------------------------
router.get('/orders', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows.map((r) => {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(r.id);
    return { ...r, items };
  }));
});

router.get('/orders/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Order not found.' });
  if (row.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied.' });
  res.json(orderPayload(row, req.user.id));
});

router.post('/orders/:id/cancel', requireAuth, asyncWrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: 'Order not found.' });
  if (!['pending', 'processing'].includes(row.status)) return res.status(400).json({ error: 'This order can no longer be cancelled.' });
  const tx = db.transaction(() => {
    db.prepare(`UPDATE orders SET status = 'cancelled', status_note = 'Cancelled by customer', updated_at = datetime('now') WHERE id = ?`).run(row.id);
    db.prepare(`INSERT INTO order_events (order_id, status, note) VALUES (?, 'cancelled', 'Cancelled by customer')`).run(row.id);
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(row.id);
    for (const it of items) db.prepare(`UPDATE products SET stock = stock + ?, updated_at = datetime('now') WHERE id = ?`).run(it.qty, it.product_id);
  });
  tx();
  notify(row.user_id, 'Order cancelled', `Order ${row.order_number} was cancelled.`, '#/account/orders/' + row.id);
  emitChange('orders', { orderId: row.id });
  emitChange('products', {});
  res.json(orderPayload(db.prepare('SELECT * FROM orders WHERE id = ?').get(row.id), req.user.id));
}));

module.exports = { router, STATUSES, orderPayload };
