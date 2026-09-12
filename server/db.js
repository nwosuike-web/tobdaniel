/**
 * Database layer — SQLite via better-sqlite3 (embedded, zero-config, ACID).
 * The schema mirrors a cloud-document structure 1:1, so the app can be moved
 * to Postgres/Firebase later without changing the API surface.
 *
 * Real-time: every write that matters flows through `emitChange()`, which
 * fans out Server-Sent Events to connected storefront/admin clients.
 */
const Database = require('better-sqlite3');
const config = require('./config');

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  is_disabled   INTEGER NOT NULL DEFAULT 0,
  email_verified INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL,
  user_agent  TEXT DEFAULT '',
  ip          TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier   TEXT NOT NULL,
  ip           TEXT NOT NULL,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts ON login_attempts(identifier, attempted_at);

CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  email      TEXT NOT NULL,
  purpose    TEXT NOT NULL DEFAULT 'customer',
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS addresses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  label        TEXT DEFAULT 'Home',
  full_name    TEXT NOT NULL,
  phone        TEXT NOT NULL,
  line1        TEXT NOT NULL,
  line2        TEXT DEFAULT '',
  city         TEXT NOT NULL,
  state        TEXT NOT NULL,
  is_default   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_addr_user ON addresses(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  parent_id  INTEGER,
  image_url  TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  sku               TEXT NOT NULL UNIQUE,
  category_id       INTEGER NOT NULL,
  brand             TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  short_desc        TEXT DEFAULT '',
  price             REAL NOT NULL DEFAULT 0,
  compare_at_price  REAL NOT NULL DEFAULT 0,
  stock             INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  is_featured       INTEGER NOT NULL DEFAULT 0,
  is_best_seller    INTEGER NOT NULL DEFAULT 0,
  is_new            INTEGER NOT NULL DEFAULT 0,
  video_url         TEXT DEFAULT '',
  rating_avg        REAL NOT NULL DEFAULT 0,
  rating_count      INTEGER NOT NULL DEFAULT 0,
  sold_count        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prod_slug   ON products(slug);
CREATE INDEX IF NOT EXISTS idx_prod_cat    ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_prod_name   ON products(name);
CREATE INDEX IF NOT EXISTS idx_prod_price  ON products(price);
CREATE INDEX IF NOT EXISTS idx_prod_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_prod_sold   ON products(sold_count);

CREATE TABLE IF NOT EXISTS product_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  url        TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pimg_prod ON product_images(product_id);

CREATE TABLE IF NOT EXISTS product_specs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  label      TEXT NOT NULL,
  value      TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pspec_prod ON product_specs(product_id);

CREATE TABLE IF NOT EXISTS carts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  owner          TEXT NOT NULL,               -- 'u:<id>' or 'g:<guestId>'
  product_id     INTEGER NOT NULL,
  qty            INTEGER NOT NULL DEFAULT 1,
  saved_for_later INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cart_owner ON carts(owner);

CREATE TABLE IF NOT EXISTS wishlists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_wish_user ON wishlists(user_id);

CREATE TABLE IF NOT EXISTS orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number     TEXT NOT NULL UNIQUE,
  user_id          INTEGER,
  status           TEXT NOT NULL DEFAULT 'pending',
  subtotal         REAL NOT NULL DEFAULT 0,
  delivery_fee     REAL NOT NULL DEFAULT 0,
  discount_amount  REAL NOT NULL DEFAULT 0,
  total            REAL NOT NULL DEFAULT 0,
  promo_code       TEXT DEFAULT '',
  payment_method   TEXT NOT NULL DEFAULT 'card',
  payment_status   TEXT NOT NULL DEFAULT 'pending',
  customer_name    TEXT NOT NULL,
  customer_email   TEXT NOT NULL,
  customer_phone   TEXT NOT NULL,
  shipping_address TEXT NOT NULL,              -- JSON
  tracking_number  TEXT DEFAULT '',
  tracking_carrier TEXT DEFAULT '',
  status_note      TEXT DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ord_user   ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_ord_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_ord_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  name       TEXT NOT NULL,
  sku        TEXT DEFAULT '',
  price      REAL NOT NULL,
  qty        INTEGER NOT NULL,
  image_url  TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_oitem_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_oitem_prod  ON order_items(product_id);

CREATE TABLE IF NOT EXISTS order_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL,
  status     TEXT NOT NULL,
  note       TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL,
  method     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  provider   TEXT DEFAULT '',
  reference  TEXT DEFAULT '',
  amount     REAL NOT NULL DEFAULT 0,
  payload    TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  user_id    INTEGER,
  order_id   INTEGER,
  rating     INTEGER NOT NULL,
  title      TEXT DEFAULT '',
  body       TEXT DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'approved',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rev_prod ON reviews(product_id);

CREATE TABLE IF NOT EXISTS promo_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL DEFAULT 'percent' CHECK (type IN ('percent','fixed','freeship')),
  value       REAL NOT NULL DEFAULT 0,
  min_order   REAL NOT NULL DEFAULT 0,
  starts_at   TEXT,
  ends_at     TEXT,
  usage_limit INTEGER NOT NULL DEFAULT 0,
  used_count  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS flash_sales (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  starts_at  TEXT,
  ends_at    TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS flash_sale_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  flash_sale_id INTEGER NOT NULL,
  product_id    INTEGER NOT NULL,
  sale_price    REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS banners (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL DEFAULT '',
  subtitle   TEXT DEFAULT '',
  cta_text   TEXT DEFAULT '',
  cta_link   TEXT DEFAULT '',
  image_url  TEXT DEFAULT '',
  position   TEXT DEFAULT 'home',              -- home | promo
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS testimonials (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  location   TEXT DEFAULT '',
  rating     INTEGER NOT NULL DEFAULT 5,
  body       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS faqs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  category   TEXT DEFAULT 'General',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS subscribers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT DEFAULT '',
  subject    TEXT DEFAULT '',
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new',      -- new | read | replied
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  title      TEXT NOT NULL,
  body       TEXT DEFAULT '',
  link       TEXT DEFAULT '',
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER,
  admin_email TEXT DEFAULT '',
  action      TEXT NOT NULL,
  entity_type TEXT DEFAULT '',
  entity_id   TEXT DEFAULT '',
  prev_value  TEXT DEFAULT '',
  new_value   TEXT DEFAULT '',
  ip          TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`);

module.exports = { db };
