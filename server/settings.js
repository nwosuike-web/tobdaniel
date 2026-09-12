/**
 * Business settings (stored as JSON rows in the `settings` table) plus small
 * shared helpers (audit logging, order-number generation, email stub).
 */
const { db } = require('./db');
const { emitChange } = require('./events');
const config = require('./config');

const DEFAULT_SETTINGS = {
  storeName: 'Tob Daniel Business Enterprise',
  slogan: 'Quality Products. Trusted Service. Delivered With Excellence.',
  tagline: 'Nigeria’s trusted online marketplace for electronics, fashion, home essentials and more.',
  currency: 'NGN',
  announcement: 'Free delivery on orders above ₦100,000 — nationwide. 🚚',
  contact: {
    phone: '+234 800 000 0000',
    whatsapp: '+2348000000000',
    email: 'hello@tobdaniel.ng',
    address: '12 Admiralty Way, Lekki Phase 1, Lagos, Nigeria',
    hours: 'Mon – Sat: 8:00am – 6:00pm'
  },
  social: {
    facebook: 'https://facebook.com/tobdaniel',
    instagram: 'https://instagram.com/tobdaniel',
    twitter: 'https://x.com/tobdaniel',
    whatsapp: 'https://wa.me/2348000000000'
  },
  shipping: { flatFee: 2500, freeThreshold: 100000, sameCityFee: 1500 },
  paymentMethods: {
    card: true,
    bankTransfer: true,
    cashOnDelivery: true,
    mobileMoney: true,
    payOnDelivery: true
  },
  seo: { title: 'Tob Daniel Business Enterprise — Quality Products, Trusted Service', description: 'Shop electronics, fashion, beauty and home essentials with fast delivery across Nigeria.' },
  maintenance: false
};

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value));
}

function publicSettings() {
  const s = getSettings();
  const pay = config.PAYMENT_KEYS;
  const methods = { ...s.paymentMethods };
  // Card payments only light up when a provider is configured.
  if (!(pay.paystack.secret || pay.flutterwave.secret || pay.stripe.secret)) methods.card = false;
  return {
    storeName: s.storeName,
    slogan: s.slogan,
    tagline: s.tagline,
    announcement: s.announcement,
    currency: s.currency,
    contact: s.contact,
    social: s.social,
    shipping: s.shipping,
    paymentMethods: methods,
    maintenance: !!s.maintenance,
    adminRoute: config.ADMIN_ROUTE
  };
}

// ---------- audit logging -----------------------------------------------------
function audit(req, action, entityType, entityId, prevValue, newValue) {
  try {
    db.prepare(
      `INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, prev_value, new_value, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.user ? req.user.id : null,
      req.user ? req.user.email : '',
      action,
      entityType,
      entityId == null ? '' : String(entityId),
      prevValue == null ? '' : JSON.stringify(prevValue),
      newValue == null ? '' : JSON.stringify(newValue),
      req.ip || ''
    );
    emitChange('audit', {});
  } catch (e) {
    console.error('audit log failed', e.message);
  }
}

// ---------- order numbers -----------------------------------------------------
function generateOrderNumber() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TD-${ymd}-${rand}`;
}

// ---------- notifications -----------------------------------------------------
function notify(userId, title, body, link) {
  db.prepare('INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)').run(userId || null, title, body, link || '');
  emitChange('notifications:' + (userId || 'all'), {});
  emitChange('notifications', {});
}

// ---------- email (stub) -------------------------------------------------------
function sendEmail(to, subject, text) {
  if (config.SMTP.host) {
    // In production wire nodemailer/SendGrid here. Never log credentials.
    console.log(`[mail] -> ${to} | ${subject}`);
    return;
  }
  console.log(`[mail:stub] to=${to} subject="${subject}"\n${text}\n----`);
}

module.exports = {
  DEFAULT_SETTINGS,
  getSettings,
  setSetting,
  publicSettings,
  audit,
  generateOrderNumber,
  notify,
  sendEmail
};
