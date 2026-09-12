/**
 * Shared middleware: authentication guards, role checks, rate limiting,
 * CSRF protection, security headers, and a consistent error handler.
 */
const { db } = require('./db');
const auth = require('./auth');

// ---------- token extraction ------------------------------------------------
function getToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  const c = req.cookies || {};
  if (c.td_token) return c.td_token;
  // Fallback: some sandboxed preview proxies strip the Authorization header,
  // so the client retries with the token in the URL.
  return (req.query && req.query.td_token) || '';
}

function currentUser(req) {
  const token = getToken(req);
  if (!token) return null;
  const payload = auth.verifyToken(token);
  if (!payload || !auth.sessionIsValid(token)) return null;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!user || user.is_disabled) return null;
  req.token = token;
  return user;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in to continue.' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized.' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access only.' });
  req.user = user;
  next();
}

// ---------- rate limiting (in-memory sliding window) ------------------------
const buckets = new Map();
function rateLimit(opts = {}) {
  const { windowMs = 60000, max = 100, key = (req) => req.ip, message = 'Too many requests. Please try again shortly.' } = opts;
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    const arr = (buckets.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: message });
    arr.push(now);
    buckets.set(k, arr);
    next();
  };
}

const loginLimiter = (req, res, next) => {
  const identifier = (req.body && (req.body.email || req.body.identifier)) || 'unknown';
  if (auth.isLocked(identifier, req.ip)) {
    return res.status(429).json({ error: 'Too many failed attempts. Your account is temporarily locked — try again in 15 minutes.' });
  }
  next();
};

// ---------- CSRF protection -------------------------------------------------
// State-changing requests must come from our own frontend: we require the
// custom X-Requested-With header (cross-origin <form> posts cannot set it)
// and verify the Origin host when present. Auth cookies are SameSite=Strict.
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
function csrfProtection(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    return res.status(403).json({ error: 'Invalid request origin.' });
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      const oh = new URL(origin).host;
      const hh = req.headers.host;
      if (oh !== hh) return res.status(403).json({ error: 'Invalid request origin.' });
    } catch {
      return res.status(403).json({ error: 'Invalid request origin.' });
    }
  }
  next();
}

// ---------- security headers ------------------------------------------------
// NOTE: X-Frame-Options / frame-ancestors are intentionally NOT set so the app
// can be embedded in the Arena preview iframe. Re-enable clickjacking protection
// (e.g. `res.setHeader('X-Frame-Options', 'SAMEORIGIN')` + `frame-ancestors 'self'`)
// when deploying standalone behind your own domain. `https:` sources are included
// so same-host assets still load if the preview iframe runs with an opaque origin.
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' https: data:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https: wss:; object-src 'none'; base-uri 'self'; form-action 'self' https:"
  );
  next();
}

// ---------- error handling ---------------------------------------------------
function notFound(req, res) {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).send('Not found');
}

function errorHandler(err, req, res, next) {
  console.error('[error]', err.message, req.method, req.originalUrl);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong. Please try again.' });
}

function asyncWrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = {
  getToken,
  currentUser,
  requireAuth,
  requireAdmin,
  rateLimit,
  loginLimiter,
  csrfProtection,
  securityHeaders,
  notFound,
  errorHandler,
  asyncWrap
};
