# Security Recommendations

The platform ships with a solid security baseline. This document explains what is
already implemented and what you should do in production.

## Built in

- **Password hashing** — `scrypt` with a per-user random salt and constant-time
  comparison (`server/auth.js`). Plaintext is never stored.
- **Signed sessions** — HS256 tokens with expiry (7 days customers, 12 hours admins)
  plus a `sessions` table so logouts and revocations take effect immediately.
- **Role-based access control** — every admin endpoint is behind `requireAdmin`;
  customer endpoints behind `requireAuth` where needed. Anonymous/customer tokens
  against admin routes return 401/403.
- **Brute-force protection** — login attempts are recorded per identifier+IP; after
  10 failures in 15 minutes the account is locked for 15 minutes (survives restarts via
  the `login_attempts` table), plus in-memory rate limiting on auth & sensitive routes.
- **CSRF protection** — state-changing requests must carry the `X-Requested-With:
  XMLHttpRequest` header (cross-site forms cannot set it) and the `Origin` host is
  verified when present. Auth cookies are `SameSite=Strict`.
- **XSS mitigation** — all user/admin-supplied text is HTML-escaped before rendering
  (shared `esc()` helper), plus a strict Content-Security-Policy header.
- **SQL injection** — all queries are parameterized (prepared statements); no string
  concatenation of user input into SQL.
- **Secrets** — API/payment/SMTP keys live in environment variables only; the token
  secret auto-generates to `data/secret.key` (0600) when unset.
- **Security headers** — CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `X-Powered-By` removed.
- **Admin route hiding + auth** — the dashboard is served only at the configured
  `ADMIN_ROUTE` (`/admin.html` and `/admin` 404), and *all* data behind it still
  requires a valid admin session (hiding the URL is not the security control).
- **Audit trail** — every admin change logs who, what, when, and before/after values.
- **Card data** — never stored; the `payments` table keeps only provider/reference.

## Do in production

1. **Change default credentials immediately** — the seeded admin
   (`admin@tobdaniel.ng` / `Admin@2026!`) and demo customer are for testing only.
2. **Enable admin 2FA** — Admin → Settings → Security → “Require 2FA”. This sends a
   6-digit code by email before an admin session is issued.
3. **Set `APP_SECRET`** in the environment so token signing doesn't rely on the
   generated file.
4. **Use a unique `ADMIN_ROUTE`** (e.g. `/panel-x7f2`) and add IP allow-listing at your
   proxy/firewall for extra protection.
5. **TLS everywhere** — terminate HTTPS at your reverse proxy/load balancer.
6. **Never commit `.env` or `data/`** — both are git-ignored; add a `.gitignore` check
   to CI.
7. **Back up the database** — SQLite is a single file; schedule backups and store them
   off-site.
8. **Add email sending** (SMTP) so password resets and notifications are real — in dev
   they are only logged.
9. **Add a WAF / rate-limit at the edge** for volumetric attacks; the in-app limiters
   cover application-level abuse.
10. **Rotate payment keys** and restrict their scope to the required permissions only.
11. **Verify payment webhooks** by signature (Paystack/Flutterwave/Stripe) before
    marking an order paid — the `payments` table + webhook route stub are ready for it.

## Known development-mode conveniences

- In `development`, the 2FA code is returned in the login response (labelled “Dev
  mode”) and emails are logged to the console. Both are disabled by
  `NODE_ENV=production`.
- The CORS posture is same-origin only; if you ever serve the frontend from a different
  domain, add an explicit allow-list rather than `*`.
