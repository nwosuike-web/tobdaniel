# Database Schema

SQLite (WAL mode) with `foreign_keys = ON`. The schema mirrors a cloud-document
structure 1:1, so migrating to Postgres/Firebase later only means swapping the storage
driver behind `server/db.js` — the API surface stays identical.

All timestamps are ISO-8601 UTC text (`datetime('now')`). Monetary values are stored as
`REAL` (naira, ₦).

## Entity relationship overview

```
users 1─∞ sessions
users 1─∞ addresses
users 1─∞ orders ─∞ order_items
users 1─∞ orders ─∞ order_events
users 1─∞ reviews
users 1─∞ notifications
orders 1─∞ payments
categories 1─∞ categories (parent_id, self-referencing)
categories 1─∞ products ─∞ product_images
products 1─∞ product_specs
products 1─∞ reviews
products 1─∞ wishlists
products 1─∞ flash_sale_items ─1 flash_sales
carts (owner = 'u:<id>' or 'g:<guestId>')
promo_codes, banners, testimonials, faqs, subscribers, messages
settings (key/value), audit_logs
```

## Core tables

### `users`
| column | type | notes |
| --- | --- | --- |
| id | INTEGER PK | |
| name, email, phone | TEXT | email UNIQUE |
| password_hash | TEXT | scrypt + salt |
| role | TEXT | `customer` \| `admin` (CHECK) |
| is_disabled | INTEGER | 0/1 — admin can disable accounts |
| email_verified | INTEGER | reserved |
| last_login_at, created_at, updated_at | TEXT | |

### `sessions`
Signed-token registry so logouts/revocations take effect immediately.
`token_hash` UNIQUE (SHA-256 of the issued token), `role`, `user_agent`, `ip`,
`expires_at`.

### `login_attempts`
`identifier` + `ip` + `attempted_at` — feeds the brute-force lockout (10 fails/15 min).

### `password_resets`
`user_id`, `email`, `purpose` (`customer`|`admin`), `token_hash`, `expires_at`, `used_at`.

### `addresses`
`user_id`, `label`, `full_name`, `phone`, `line1`, `line2`, `city`, `state`, `is_default`.

### `categories`
`name`, `slug` UNIQUE, `parent_id` (self-reference for subcategories), `image_url`,
`sort_order`, `is_active`.

### `products`
| column | notes |
| --- | --- |
| name, slug UNIQUE, sku UNIQUE | searchable |
| category_id | FK → categories |
| brand, description, short_desc | |
| price, compare_at_price | ₦ REAL |
| stock | auto-decremented on order, restored on cancel |
| is_active, is_featured, is_best_seller, is_new | merchandising flags |
| video_url | optional product video |
| rating_avg, rating_count, sold_count | denormalized aggregates |
| created_at, updated_at | |

Indexes: slug, category_id, name, price, is_active, sold_count (powers “best sellers”).

### `product_images`
`product_id`, `url`, `position`, `is_primary`.

### `product_specs`
`product_id`, `label`, `value`, `position` (e.g. “Screen → 6.7” AMOLED”).

### `carts`
`owner` TEXT — `u:<userId>` when signed in, `g:<guestId>` for guests (guest carts merge
into the user cart on login/register). `product_id`, `qty`, `saved_for_later`.

### `wishlists`
`user_id` + `product_id` with `UNIQUE(user_id, product_id)`.

### `orders`
| column | notes |
| --- | --- |
| order_number | UNIQUE, format `TD-YYYYMMDD-XXXX` |
| user_id | nullable (guest checkout) |
| status | `pending`→`processing`→`shipped`→`delivered` (+`cancelled`/`refunded`) |
| subtotal, delivery_fee, discount_amount, total | ₦ |
| promo_code | applied code |
| payment_method | `card` \| `bankTransfer` \| `payOnDelivery` \| `mobileMoney` |
| payment_status | `pending` \| `paid` \| `failed` |
| customer_name/email/phone | denormalized from checkout |
| shipping_address | JSON (incl. `method`: standard/express) |
| tracking_number, tracking_carrier, status_note | set on status updates |
| created_at, updated_at | |

Indexes: user_id, status, created_at.

### `order_items`
Snapshot of each line item at purchase time (`name`, `sku`, `price`, `qty`, `image_url`)
so historical orders stay intact even if the product changes later.

### `order_events`
Immutable status timeline: `order_id`, `status`, `note`, `created_at`.

### `payments`
`order_id`, `method`, `status`, `provider` (`paystack`/`flutterwave`/`stripe`), `reference`,
`amount`, `payload` (JSON of provider response — **never** card numbers).

### `reviews`
`product_id`, `user_id`, `order_id`, `rating`, `title`, `body`, `status`
(`pending`/`approved`), `created_at`.

### `promo_codes`
`code` UNIQUE, `type` (`percent`|`fixed`|`freeship`), `value`, `min_order`, `starts_at`,
`ends_at`, `usage_limit`, `used_count`, `is_active`.

### `flash_sales` + `flash_sale_items`
A flash sale is a collection of product→sale_price pairs with an active window.

### Content tables
- `banners` — `title`, `subtitle`, `cta_text`, `cta_link`, `image_url`, `position`
  (`home`|`promo`), `sort_order`, `is_active`.
- `testimonials` — `name`, `location`, `rating`, `body`, `is_active`.
- `faqs` — `question`, `answer`, `category`, `sort_order`, `is_active`.
- `subscribers` — `email` UNIQUE (newsletter).
- `messages` — contact/support inbox: `name`, `email`, `phone`, `subject`, `body`,
  `status` (`new`|`read`|`replied`).

### `notifications`
Per-user (nullable `user_id` for broadcast) `title`, `body`, `link`, `is_read`.

### `settings`
Key/value store for business info, slogan, contact details, shipping config, payment
method toggles, 2FA requirement flag, SEO defaults, etc.

### `audit_logs`
`admin_id`, `admin_email`, `action`, `entity_type`, `entity_id`, `prev_value`,
`new_value` (JSON), `ip`, `created_at`. Every admin mutation is recorded here.

## Integrity & performance notes

- `foreign_keys = ON` and WAL journaling; `synchronous = NORMAL`.
- Write-heavy hot columns (product search, order lookup, sold_count, slug) are indexed.
- Order placement runs in a **transaction**: validate stock → decrement stock →
  create order/items/payment/event → commit; on any failure it rolls back. Stock is
  restored when an order is cancelled.
- Out-of-stock prevention is enforced server-side (409) — the cart quantity can never
  exceed available stock.
