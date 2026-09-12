# Tob Daniel Business Enterprise

A premium, fully-responsive e-commerce platform — storefront, secure admin dashboard,
JSON API, and real-time data sync — built for **Tob Daniel Business Enterprise**.

> *“Quality Products. Trusted Service. Delivered With Excellence.”*

![stack](https://img.shields.io/badge/stack-Node.js%20%2B%20Express%20%2B%20SQLite-0a3a8f) ![db](https://img.shields.io/badge/database-embedded%20SQLite%20(WAL)-1c5fc4)

---

## ✨ Highlights

| Area | What you get |
| --- | --- |
| **Storefront** | Home (hero carousel, flash sale with countdown, categories, featured / new / best sellers, promotions, testimonials, newsletter), product listing with full filtering & sorting + grid/list views, product detail with gallery & zoom, cart, checkout, order confirmation, customer account (orders, addresses, wishlist, reviews, security), contact & support with FAQ |
| **Admin** | Secure login (rate-limited, optional 2FA), dashboard analytics & charts, product / category / order / customer / discount / flash-sale / banner / review / testimonial / FAQ / subscriber / message management, settings, and a full **audit log** |
| **Real-time** | Server-Sent Events push every change (price, stock, banner, category, order status, settings…) to open storefront & admin clients — **no rebuild or refresh needed** |
| **Payments** | Card / bank transfer / cash-on-delivery / mobile money / pay-on-delivery. Card payments auto-activate when a provider key is configured (Paystack / Flutterwave / Stripe) — raw card details are never stored |
| **Security** | scrypt password hashing, signed sessions, role-based access, CSRF protection, rate limiting + brute-force lockout, CSP & security headers, audit trail |
| **SEO / perf** | Sitemap, robots.txt, JSON-LD structured data, lazy-loaded images, skeleton loaders, clean hash routes |

---

## 🚀 Quick start

```bash
# 1. Install dependencies
npm install

# 2. (optional) copy environment config
cp .env.example .env

# 3. Seed sample data (creates SQLite DB at ./data/store.db)
npm run seed

# 4. Start the server
npm start          # → http://localhost:3000
```

### Default credentials (sample data)

| Role | URL | Email | Password |
| --- | --- | --- | --- |
| Admin dashboard | `http://localhost:3000/secure-admin-login` | `admin@tobdaniel.ng` | `Admin@2026!` |
| Customer account | storefront → Account | `demo@tobdaniel.ng` | `Demo@1234` |

> **Change these immediately in production.** The admin route is configurable via
> `ADMIN_ROUTE` (see [Environment variables](docs/ENVIRONMENT.md)).

### Run the automated test suite

```bash
npm start     # server must be running
npm test      # 79 end-to-end checks
```

---

## 📁 Project structure

```
tobdaniel/
├── server/
│   ├── index.js          # app wiring, static hosting, SSE, sitemap/robots
│   ├── config.js         # env config + persistent secret
│   ├── db.js             # SQLite schema (all entities, indexes)
│   ├── auth.js           # scrypt hashing, JWT, sessions, lockout
│   ├── middleware.js     # auth guards, rate limits, CSRF, security headers
│   ├── events.js         # SSE real-time hub
│   ├── settings.js       # business settings, audit log, notifications, email stub
│   ├── seed.js           # sample data (products, orders, reviews, banners…)
│   └── routes/
│       ├── public.js     # catalog, home, search, categories, FAQs, contact
│       ├── auth.js       # customer auth, profile, addresses, reviews
│       ├── cart.js       # cart, wishlist, promo validation
│       ├── orders.js     # checkout, order lifecycle, stock control
│       └── admin.js      # secure admin API (full CRUD + analytics)
├── public/               # storefront SPA + admin SPA (plain JS, no build step)
│   ├── index.html        # customer-facing shell
│   ├── admin.html        # admin shell (served only at ADMIN_ROUTE)
│   ├── css/  js/         # app.css / app.js / admin.css / admin.js / utils.js
│   ├── images/           # product photos, hero, banners, logo, favicon
│   └── uploads/          # admin-uploaded media (git-ignored)
├── tests/run.js          # end-to-end test suite
└── docs/                 # ENVIRONMENT, DEPLOYMENT, SECURITY, DATABASE_SCHEMA
```

No bundler or framework is required — the frontend is dependency-free ES6, which keeps
deployments simple and page loads fast.

---

## 🧪 What the test suite verifies

Public catalog & search · filters/sort/flash-sale pricing · product detail · cart
(add/qty/save-for-later/promo) · registration/login · duplicate email · wrong password ·
addresses · wishlist (auth-gated) · checkout & order creation · **automatic stock
decrement** · order cancel & **stock restore** · out-of-stock prevention · admin RBAC
(customer & anonymous blocked) · admin login · product create/update/delete **reflected
live on the public site** · category CRUD · order status updates · invoice · CSV export ·
discounts · flash sales · banners · settings & slogan propagation · audit log · reviews ·
contact → admin inbox · CSRF guard (403) · SSE stream · robots.txt · sitemap · admin route
serving & `/admin.html` blocking.

---

## 💳 Payments (integration structure)

The checkout supports five methods out of the box. **Card payments only appear when a
provider key is present**, so the platform runs fully with cash-on-delivery / bank
transfer / pay-on-delivery until you add credentials:

```bash
# .env
PAYSTACK_SECRET_KEY=sk_live_...
PAYSTACK_PUBLIC_KEY=pk_live_...
# or FLUTTERWAVE_SECRET_KEY / STRIPE_SECRET_KEY
```

Orders are recorded in the `payments` table with a `provider` + `reference` field ready
for webhook confirmation. Wire a provider webhook to
`POST /api/webhooks/:provider` (route stub documented in `server/routes/orders.js`).
**Card details are never stored or logged.**

---

## 🔌 Real-time synchronization

Every admin write emits a Server-Sent Event on a domain channel
(`products`, `orders`, `categories`, `banners`, `settings`, `flashsales`, `discounts`,
`testimonials`, `faqs`, `reviews`, `customers`, `messages`, `subscribers`, `audit`).
The storefront and admin dashboards subscribe to `/api/events` and re-fetch the affected
data instantly, showing a subtle “live update” toast. Cart and order-status changes are
pushed only to the owning client. Offline/reconnect is handled automatically by the
EventSource (with an on-screen “Reconnecting…” indicator in the admin header).

---

## 🗄️ Database

Embedded SQLite (WAL mode) — zero-config, ACID, and trivially replaceable by Postgres
later since the API is the only database surface. See
[docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) for the full schema.

## 📚 More documentation

- [Environment variables](docs/ENVIRONMENT.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Security recommendations](docs/SECURITY.md)
- [Database schema](docs/DATABASE_SCHEMA.md)

---

## 📝 Note on sample images

Product photos for the main catalogue are AI-generated studio images; 11 secondary
products use elegant on-brand placeholder tiles (generate more with
`python3 scripts/make_placeholders.py`). Replace any of them from **Admin → Products →
Edit → upload**, or simply drop new files into `public/images/products/`.
