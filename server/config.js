/**
 * Central configuration. All secrets come from environment variables
 * (or a generated-on-first-run secret file). Nothing sensitive lives in code.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

// ---- minimal .env loader (no external dependency) --------------------------
(function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
})();

function env(key, def) {
  const v = process.env[key];
  return v === undefined || v === '' ? def : v;
}

const DATA_DIR = path.join(ROOT, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- persistent app secret -------------------------------------------------
const secretFile = path.join(DATA_DIR, 'secret.key');
let SECRET = env('APP_SECRET', '');
if (!SECRET) {
  if (fs.existsSync(secretFile)) {
    SECRET = fs.readFileSync(secretFile, 'utf8').trim();
  } else {
    SECRET = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFile, SECRET, { mode: 0o600 });
  }
}

const UPLOAD_DIR = path.join(ROOT, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = {
  ROOT,
  DATA_DIR,
  PORT: parseInt(env('PORT', '3000'), 10),
  HOST: env('HOST', '0.0.0.0'),
  NODE_ENV: env('NODE_ENV', 'development'),
  // Seed sample data on first boot when the products table is empty
  // (handy for one-click cloud deploys). Safe to leave off locally.
  AUTO_SEED: env('AUTO_SEED', '') !== '',
  SECRET,
  DB_PATH: env('DB_PATH', path.join(DATA_DIR, 'store.db')),
  ADMIN_ROUTE: '/' + env('ADMIN_ROUTE', 'secure-admin-login').replace(/^\/+/, '').replace(/\/+$/, ''),
  UPLOAD_DIR,
  SESSION_TTL: { customer: 60 * 60 * 24 * 7, admin: 60 * 60 * 12 }, // seconds
  PAYMENT_KEYS: {
    paystack: { secret: env('PAYSTACK_SECRET_KEY', ''), public: env('PAYSTACK_PUBLIC_KEY', '') },
    flutterwave: { secret: env('FLUTTERWAVE_SECRET_KEY', '') },
    stripe: { secret: env('STRIPE_SECRET_KEY', '') }
  },
  SMTP: {
    host: env('SMTP_HOST', ''),
    port: parseInt(env('SMTP_PORT', '587'), 10),
    user: env('SMTP_USER', ''),
    pass: env('SMTP_PASS', ''),
    from: env('MAIL_FROM', 'Tob Daniel Business Enterprise <no-reply@tobdaniel.ng>')
  }
};
