/**
 * Tob Daniel Business Enterprise — application server.
 * Serves the storefront SPA, the admin dashboard (at a configurable route),
 * the JSON API, real-time SSE stream, sitemap/robots and uploaded media.
 */
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { db } = require('./db');
const { securityHeaders, csrfProtection, currentUser, notFound, errorHandler } = require('./middleware');
const { subscribe, unsubscribe } = require('./events');
const { publicSettings } = require('./settings');

const publicRouter = require('./routes/public');
const authRouter = require('./routes/auth');
const cartRouter = require('./routes/cart');
const { router: ordersRouter } = require('./routes/orders');
const adminRouter = require('./routes/admin');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use(securityHeaders);
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

// ---- CORS (preview-host / cross-origin compatibility) -------------------------
// The storefront uses Bearer tokens (not cookies), so a wildcard origin is safe.
// This also lets the API and SSE stream work when the preview iframe runs with an
// opaque origin (sandbox without allow-same-origin).
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With, X-Guest-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---- real-time SSE stream ----------------------------------------------------
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  const channels = new Set(String(req.query.channels || '').split(',').filter(Boolean));
  const client = String(req.query.client || 'anon');
  channels.add('c:' + client);
  channels.add('ping');
  for (const ch of channels) subscribe(ch, res);

  const heartbeat = setInterval(() => {
    try { res.write(':hb\n\n'); } catch { /* ignore */ }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    for (const ch of channels) unsubscribe(ch, res);
  });
});

// ---- API -----------------------------------------------------------------------
app.use('/api', csrfProtection);
// Attach the signed-in user (when a valid token is present) so cart/order routes
// can resolve the correct owner without requiring auth on every endpoint.
app.use('/api', (req, res, next) => {
  const u = currentUser(req);
  if (u) req.user = u;
  next();
});
app.use('/api', publicRouter);
app.use('/api/auth', authRouter);
app.use('/api', cartRouter);
app.use('/api', ordersRouter);
app.use('/api/admin', adminRouter);

// ---- SEO endpoints ---------------------------------------------------------------
app.get('/robots.txt', (req, res) => {
  const disallow = config.ADMIN_ROUTE;
  res.type('text/plain').send(
    `User-agent: *\nDisallow: ${disallow}\nDisallow: /api/\n\nSitemap: ${req.protocol}://${req.get('host')}/sitemap.xml\n`
  );
});

app.get('/sitemap.xml', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const products = db.prepare('SELECT slug, updated_at FROM products WHERE is_active = 1').all();
  const categories = db.prepare('SELECT slug FROM categories WHERE is_active = 1').all();
  const urls = [
    `${base}/`,
    `${base}/shop`,
    `${base}/contact`,
    ...categories.map((c) => `${base}/shop?category=${encodeURIComponent(c.slug)}`),
    ...products.map((p) => `${base}/product/${encodeURIComponent(p.slug)}`)
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') + `\n</urlset>`;
  res.type('application/xml').send(xml);
});

// ---- static + SPA ---------------------------------------------------------------
const PUBLIC = path.join(config.ROOT, 'public');
// Keep the admin shell reachable ONLY through the configured admin route.
app.get('/admin.html', (req, res) => res.status(404).send('Not found'));
app.use(express.static(PUBLIC, { index: false, maxAge: config.NODE_ENV === 'production' ? '7d' : 0, setHeaders: (res, p) => {
  if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
} }));

// HTML shells must never be cached (so updated asset versions are always seen).
function sendHtml(file) {
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(PUBLIC, file));
  };
}

app.get('/', sendHtml('index.html'));

// Admin dashboard is served ONLY at the configured (secret-ish) route.
app.get(config.ADMIN_ROUTE, sendHtml('admin.html'));
app.get(config.ADMIN_ROUTE + '/', sendHtml('admin.html'));
app.get('/admin', (req, res) => res.status(404).send('Not found'));

// SPA fallback for clean client-side routes
app.get(/^\/(?!api\/|uploads\/|images\/|css\/|js\/|favicon|manifest|robots|sitemap).*$/, sendHtml('index.html'));

// maintenance flag helper used by frontend via /api/config
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

app.use(notFound);
app.use(errorHandler);

if (require.main === module) {
  // First-boot convenience for cloud deploys: seed sample data if the store is empty.
  if (config.AUTO_SEED) {
    try {
      const n = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
      if (n === 0) {
        const { execFileSync } = require('child_process');
        console.log('[boot] Empty database — running seed…');
        execFileSync(process.execPath, [path.join(__dirname, 'seed.js')], { stdio: 'inherit' });
      }
    } catch (err) {
      console.error('[boot] auto-seed skipped:', err.message);
    }
  }

  app.listen(config.PORT, config.HOST, () => {
    console.log('');
    console.log('  Tob Daniel Business Enterprise');
    console.log('  ────────────────────────────────────────────');
    console.log(`  Storefront : http://localhost:${config.PORT}/`);
    console.log(`  Admin      : http://localhost:${config.PORT}${config.ADMIN_ROUTE}`);
    console.log('  ────────────────────────────────────────────');
  });
}

module.exports = app;
