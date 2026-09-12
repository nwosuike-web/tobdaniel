# Environment Variables

Copy `.env.example` → `.env` and adjust. Every secret is read at boot from the
environment (or from `.env`); **none are embedded in code or shipped to the browser**.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port the app listens on. |
| `HOST` | `0.0.0.0` | Bind address (keep `0.0.0.0` for containers/preview hosts). |
| `NODE_ENV` | `development` | `development` / `production`. In production, 2FA codes are never echoed back to the client. |
| `APP_SECRET` | *(generated)* | Secret used to sign auth tokens. If empty, a random secret is generated once and stored in `data/secret.key` (mode `0600`). **Set this in production.** |
| `DB_PATH` | `./data/store.db` | SQLite file location. |
| `AUTO_SEED` | *(empty)* | If set to `true`, sample data is seeded automatically on first boot when the products table is empty (for one-click cloud deploys). |
| `ADMIN_ROUTE` | `secure-admin-login` | The admin dashboard path, e.g. `/my-private-panel`. Change it to make the dashboard harder to guess. |

## Payments (optional)

The platform runs fully with Pay-on-Delivery / Bank transfer without these. Card
payments activate automatically once a key is present.

| Variable | Provider |
| --- | --- |
| `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` | Paystack |
| `FLUTTERWAVE_SECRET_KEY` | Flutterwave |
| `STRIPE_SECRET_KEY` | Stripe |

## Email (optional)

Used for order confirmations, notifications and password resets. Without it, emails are
logged to the server console (visible in the process log) — fine for development.

| Variable | Description |
| --- | --- |
| `SMTP_HOST` | SMTP server host |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `MAIL_FROM` | From address, e.g. `Tob Daniel Business Enterprise <no-reply@tobdaniel.ng>` |

## Never expose

- `.env`, `data/` (contains the DB + `secret.key`) — both are git-ignored.
- Payment secret keys and SMTP credentials — these live **server-side only**.
- Admin credentials — create a strong, unique password and rotate it regularly.
