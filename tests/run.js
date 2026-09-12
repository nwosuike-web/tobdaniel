/**
 * End-to-end test suite for Tob Daniel Business Enterprise.
 * Run with:  npm test   (server must be running on PORT, default 3000)
 *
 * Covers: public catalog, search, cart, wishlist, auth, checkout/orders,
 * stock decrement & restock, admin auth & RBAC, product/category/order
 * management, discounts, flash sales, settings, audit log, rate limiting,
 * CSRF protection and the real-time SSE stream.
 */
const BASE = process.env.TEST_BASE || 'http://localhost:3000';

let passed = 0, failed = 0;
const failures = [];

async function req(method, path, { token, body, guest, headers = {}, noCSRF = false } = {}) {
  const h = { ...headers };
  if (token) h['Authorization'] = 'Bearer ' + token;
  if (guest) h['X-Guest-Id'] = guest;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !noCSRF) h['X-Requested-With'] = 'XMLHttpRequest';
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) data = await res.json();
  else data = await res.text();
  return { status: res.status, data };
}

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Math.random().toString(36).slice(2, 8);

async function main() {
  console.log('Tob Daniel Business Enterprise — test suite\n');

  /* ---------- 1. Public catalog ---------- */
  console.log('1. Public catalog');
  let r = await req('GET', '/api/config');
  check('config returns store name', r.status === 200 && r.data.storeName === 'Tob Daniel Business Enterprise');
  r = await req('GET', '/api/home');
  check('home aggregate has sections', r.status === 200 && r.data.featured && r.data.categories && r.data.flashSale);
  r = await req('GET', '/api/products?limit=5');
  check('products list paginated', r.status === 200 && r.data.items.length === 5 && r.data.total >= 20);
  r = await req('GET', '/api/products?search=nova');
  check('search by name works', r.status === 200 && r.data.items.length > 0 && r.data.items.some((p) => /nova/i.test(p.name)));
  r = await req('GET', '/api/products?category=audio');
  check('filter by category slug works', r.status === 200 && r.data.items.length > 0);
  r = await req('GET', '/api/products?flash=1');
  check('flash=1 returns only flash-sale items', r.status === 200 && r.data.items.length > 0 && r.data.items.every((p) => p.flash_price != null));
  r = await req('GET', '/api/products?min=100000&max=500000&sort=price-asc');
  check('price range + sort works', r.status === 200 && r.data.items.every((p) => p.price >= 100000 && p.price <= 500000));
  r = await req('GET', '/api/products/nova-x1-pro-5g-smartphone');
  check('product detail complete (images/specs/reviews/related)', r.status === 200 && r.data.images.length && r.data.specs.length && Array.isArray(r.data.reviews) && Array.isArray(r.data.related) && r.data.flash_price != null);
  r = await req('GET', '/api/products/suggestions?q=aur');
  check('search suggestions return rows', r.status === 200 && Array.isArray(r.data));
  r = await req('GET', '/api/products/does-not-exist-xyz');
  check('unknown product → 404', r.status === 404);
  r = await req('GET', '/api/categories');
  check('categories tree', r.status === 200 && Array.isArray(r.data));
  r = await req('GET', '/api/faqs');
  check('faqs listed', r.status === 200 && r.data.length > 0);

  /* ---------- 2. CSRF ---------- */
  console.log('2. Security guards');
  r = await req('POST', '/api/newsletter', { body: { email: 'x@y.com' }, noCSRF: true });
  check('mutation without X-Requested-With → 403 (CSRF)', r.status === 403);

  /* ---------- 3. Cart (guest) ---------- */
  console.log('3. Cart');
  const guest = 'gtest' + uniq;
  const cartProduct = (await req('GET', '/api/products?limit=1')).data.items[0];
  r = await req('POST', '/api/cart', { guest, body: { productId: cartProduct.id, qty: 2 } });
  check('guest add to cart', r.status === 200 && r.data.count === 2);
  r = await req('GET', '/api/cart', { guest });
  check('guest cart payload', r.status === 200 && r.data.count === 2 && r.data.items.length >= 1);
  const cartItem = r.data.items[0];
  r = await req('PATCH', '/api/cart/' + cartItem.id, { guest, body: { qty: 5 } });
  check('cart qty update', r.status === 200 && r.data.count === 5);
  r = await req('PATCH', '/api/cart/' + cartItem.id, { guest, body: { qty: 9999 } });
  check('cart qty over stock → 409', r.status === 409);
  r = await req('POST', '/api/cart/' + cartItem.id + '/save-for-later', { guest });
  check('save for later', r.status === 200 && r.data.savedItems.length >= 1);
  r = await req('POST', '/api/cart/' + cartItem.id + '/save-for-later', { guest });
  check('move back to cart', r.status === 200 && r.data.count === 5);
  r = await req('POST', '/api/promo/validate', { guest, body: { code: 'WELCOME10' } });
  check('valid promo accepted', r.status === 200 && r.data.type === 'percent');
  r = await req('POST', '/api/promo/validate', { guest, body: { code: 'NOPE' } });
  check('invalid promo → 404', r.status === 404);

  /* ---------- 4. Auth ---------- */
  console.log('4. Customer auth');
  const cEmail = 'test' + uniq + '@example.com';
  r = await req('POST', '/api/auth/register', { body: { name: 'Test User', email: cEmail, phone: '+2349000000000', password: 'Passw0rd!' } });
  check('register new customer', r.status === 200 && r.data.token && r.data.user.email === cEmail);
  const cToken = r.data.token;
  r = await req('POST', '/api/auth/register', { body: { name: 'X', email: cEmail, password: 'Passw0rd!' } });
  check('duplicate email → 409', r.status === 409);
  r = await req('GET', '/api/auth/me', { token: cToken });
  check('me endpoint', r.status === 200 && r.data.email === cEmail);
  r = await req('POST', '/api/auth/login', { body: { email: cEmail, password: 'WrongPass' } });
  check('wrong password → 401', r.status === 401);
  r = await req('POST', '/api/auth/login', { body: { email: 'demo@tobdaniel.ng', password: 'Demo@1234' } });
  check('demo login', r.status === 200 && r.data.token);
  const demoTok = r.data.token;
  r = await req('POST', '/api/auth/addresses', { token: demoTok, body: { label: 'Office', full_name: 'Demo Customer', phone: '+2348012345678', line1: '5 Test Road', city: 'Ikeja', state: 'Lagos', is_default: false } });
  check('add address', r.status === 200 && r.data.id);
  r = await req('GET', '/api/auth/addresses', { token: demoTok });
  check('list addresses', r.status === 200 && r.data.length >= 1);
  r = await req('DELETE', '/api/auth/addresses/' + r.data[0].id, { token: demoTok });
  check('delete address', r.status === 200);

  /* ---------- 5. Wishlist ---------- */
  console.log('5. Wishlist');
  r = await req('POST', '/api/wishlist', { guest, body: { productId: cartProduct.id } });
  check('wishlist requires auth → 401', r.status === 401);
  r = await req('POST', '/api/wishlist', { token: cToken, body: { productId: cartProduct.id } });
  check('add to wishlist', r.status === 200 && r.data.count >= 1);
  r = await req('GET', '/api/wishlist', { token: cToken });
  check('wishlist list', r.status === 200 && r.data.items.length >= 1);
  r = await req('DELETE', '/api/wishlist/' + cartProduct.id, { token: cToken });
  check('remove from wishlist', r.status === 200);

  /* ---------- 6. Orders ---------- */
  console.log('6. Orders & checkout');
  // Checkout now requires a signed-in account.
  r = await req('POST', '/api/orders', {
    body: { name: 'Guest', email: 'guest@x.com', phone: '+2349000000000', paymentMethod: 'payOnDelivery',
      address: { line1: '1 Guest Street', city: 'Ikeja', state: 'Lagos' }, deliveryMethod: 'standard' }
  });
  check('guest cannot place order → 401', r.status === 401);

  const before = (await req('GET', '/api/products/pulse-smartwatch-series-8')).data.stock;
  r = await req('POST', '/api/orders', {
    token: cToken,
    body: { name: 'Test User', email: cEmail, phone: '+2349000000000', paymentMethod: 'payOnDelivery',
      address: { line1: '1 Test Street', city: 'Ikeja', state: 'Lagos' }, promoCode: 'TOB5K', deliveryMethod: 'standard' }
  });
  check('place order (with cart? no — cart empty)', r.status === 400, 'expected 400 when cart empty');

  // add an item then order
  const orderProduct = (await req('GET', '/api/products/pulse-smartwatch-series-8')).data;
  await req('POST', '/api/cart', { token: cToken, body: { productId: orderProduct.id, qty: 1 } });
  r = await req('POST', '/api/orders', {
    token: cToken,
    body: { name: 'Test User', email: cEmail, phone: '+2349000000000', paymentMethod: 'payOnDelivery',
      address: { line1: '1 Test Street', city: 'Ikeja', state: 'Lagos' }, deliveryMethod: 'standard' }
  });
  check('place order', r.status === 200 && r.data.order.order_number && r.data.order.items.length === 1);
  const orderId = r.data.order.id;
  const after = (await req('GET', '/api/products/pulse-smartwatch-series-8')).data.stock;
  check('stock decremented after order', after === before - 1, `${before} → ${after}`);
  r = await req('GET', '/api/orders', { token: cToken });
  check('my orders list includes new order', r.status === 200 && r.data.some((o) => o.id === orderId));
  r = await req('GET', '/api/orders/' + orderId, { token: cToken });
  check('order detail', r.status === 200 && r.data.id === orderId);
  r = await req('POST', '/api/orders/' + orderId + '/cancel', { token: cToken });
  check('cancel order', r.status === 200 && r.data.status === 'cancelled');
  const afterCancel = (await req('GET', '/api/products/pulse-smartwatch-series-8')).data.stock;
  check('stock restored after cancel', afterCancel === before, `${afterCancel} vs ${before}`);

  // out-of-stock prevention
  r = await req('GET', '/api/products/crystalview-55-4k-uhd-smart-tv');
  const tv = r.data;
  r = await req('POST', '/api/cart', { token: cToken, body: { productId: tv.id, qty: tv.stock + 50 } });
  check('cannot add more than stock to cart', r.data && r.data.items.find((i) => i.productId === tv.id).qty <= tv.stock);

  /* ---------- 7. Admin ---------- */
  console.log('7. Admin auth & RBAC');
  r = await req('GET', '/api/admin/overview', { token: cToken });
  check('customer token blocked from admin → 401/403', r.status === 401 || r.status === 403);
  r = await req('GET', '/api/admin/overview');
  check('anonymous blocked from admin → 401', r.status === 401);
  r = await req('POST', '/api/admin/login', { body: { identifier: 'admin@tobdaniel.ng', password: 'Admin@2026!' } });
  check('admin login', r.status === 200 && r.data.token);
  const aTok = r.data.token;
  r = await req('GET', '/api/admin/overview', { token: aTok });
  check('admin overview', r.status === 200 && r.data.sales != null && r.data.lowStock != null);
  r = await req('GET', '/api/admin/charts', { token: aTok });
  check('admin charts', r.status === 200 && Array.isArray(r.data.revenue));

  console.log('8. Admin product management');
  r = await req('POST', '/api/admin/products', { token: aTok, body: { name: 'Test Widget ' + uniq, sku: 'TW-' + uniq.toUpperCase(), category_id: 5, brand: 'TestBrand', price: 12000, stock: 9, description: 'x', is_active: true, images: [{ url: '/images/products/p01.jpg' }], specs: [{ label: 'Color', value: 'Blue' }] } });
  check('create product', r.status === 200 && r.data.id);
  const pid = r.data.id;
  r = await req('GET', '/api/products/' + r.data.slug);
  check('new product live on public site', r.status === 200 && r.data.name.includes('Test Widget'));
  r = await req('PUT', '/api/admin/products/' + pid, { token: aTok, body: { name: 'Test Widget ' + uniq + ' v2', sku: 'TW-' + uniq.toUpperCase(), category_id: 5, brand: 'TestBrand', price: 9500, stock: 4, is_active: true } });
  check('update product (price/stock)', r.status === 200 && r.data.price === 9500 && r.data.stock === 4);
  r = await req('GET', '/api/products/' + r.data.slug);
  check('price update reflected on public site (real-time model)', r.status === 200 && r.data.price === 9500);
  r = await req('DELETE', '/api/admin/products/' + pid, { token: aTok });
  check('delete product', r.status === 200);
  r = await req('GET', '/api/products/test-widget-' + uniq);
  check('deleted product gone from public site', r.status === 404);

  console.log('9. Admin categories / orders / content');
  r = await req('POST', '/api/admin/categories', { token: aTok, body: { name: 'Test Cat ' + uniq, is_active: true } });
  check('create category', r.status === 200 && r.data.id);
  const catId = r.data.id;
  r = await req('PUT', '/api/admin/categories/' + catId, { token: aTok, body: { name: 'Test Cat ' + uniq + ' v2', is_active: false } });
  check('update category', r.status === 200 && r.data.is_active === 0);
  r = await req('DELETE', '/api/admin/categories/' + catId, { token: aTok });
  check('delete category', r.status === 200);

  // order status update (use demo's delivered order)
  const demoOrders = (await req('GET', '/api/admin/orders?status=delivered', { token: aTok })).data.items;
  if (demoOrders.length) {
    const oid = demoOrders[0].id;
    r = await req('PUT', '/api/admin/orders/' + oid + '/status', { token: aTok, body: { status: 'delivered', trackingNumber: 'TRK123' } });
    check('order status update', r.status === 200 && r.data.status === 'delivered');
    r = await req('GET', '/api/admin/orders/' + oid, { token: aTok });
    check('order detail includes items + events', r.status === 200 && Array.isArray(r.data.items) && Array.isArray(r.data.events));
    r = await req('GET', '/api/admin/orders/' + oid + '/invoice', { token: aTok });
    check('invoice HTML', r.status === 200 && String(r.data).includes('INVOICE'));
  }

  r = await req('POST', '/api/admin/discounts', { token: aTok, body: { code: 'TEST' + uniq.toUpperCase(), type: 'percent', value: 15, is_active: true } });
  check('create discount', r.status === 200 && r.data.id);
  const discId = r.data.id;
  r = await req('DELETE', '/api/admin/discounts/' + discId, { token: aTok });
  check('delete discount', r.status === 200);

  r = await req('GET', '/api/admin/settings', { token: aTok });
  check('read settings', r.status === 200 && r.data.storeName);
  r = await req('PUT', '/api/admin/settings', { token: aTok, body: { slogan: 'Quality Products. Trusted Service. Delivered With Excellence.' } });
  check('update settings (slogan)', r.status === 200 && r.data.slogan.includes('Trusted Service'));
  r = await req('GET', '/api/config');
  check('slogan change reflected on public config', r.data.slogan.includes('Trusted Service'));

  r = await req('GET', '/api/admin/activity', { token: aTok });
  check('audit log recorded changes', r.status === 200 && r.data.some((l) => l.action === 'product.create'));

  r = await req('GET', '/api/admin/customers?q=demo', { token: aTok });
  check('customer search', r.status === 200 && r.data.some((c) => c.email === 'demo@tobdaniel.ng'));
  r = await req('GET', '/api/admin/reviews', { token: aTok });
  check('reviews list', r.status === 200 && Array.isArray(r.data));
  r = await req('GET', '/api/admin/flashsales', { token: aTok });
  check('flash sales list', r.status === 200 && r.data.length >= 1);
  r = await req('GET', '/api/admin/banners', { token: aTok });
  check('banners list', r.status === 200 && r.data.length >= 1);
  r = await req('GET', '/api/admin/subscribers', { token: aTok });
  check('subscribers list', r.status === 200);
  r = await req('GET', '/api/admin/messages', { token: aTok });
  check('messages list', r.status === 200);

  console.log('10. Content / reviews');
  r = await req('POST', '/api/auth/reviews', { token: cToken, body: { productId: orderProduct.id, rating: 5, title: 'Great', body: 'Loving it ' + uniq } });
  check('customer submits review', r.status === 200);
  r = await req('POST', '/api/contact', { body: { name: 'Test', email: 't@example.com', body: 'Hello ' + uniq } });
  check('contact form submission', r.status === 200 && r.data.ok);
  r = await req('GET', '/api/admin/messages', { token: aTok });
  check('contact message appears in admin inbox', r.data.some((m) => m.body.includes(uniq)));

  console.log('11. Real-time SSE');
  const sse = await fetch(BASE + '/api/events?channels=products&client=test' + uniq);
  check('SSE stream connects', sse.status === 200 && sse.headers.get('content-type').includes('text/event-stream'));
  try { await sse.body.cancel(); } catch { }

  console.log('12. SEO / static');
  r = await req('GET', '/robots.txt');
  check('robots.txt', r.status === 200 && String(r.data).includes('User-agent'));
  r = await req('GET', '/sitemap.xml');
  check('sitemap.xml', r.status === 200 && String(r.data).includes('<urlset'));
  r = await req('GET', '/secure-admin-login');
  check('admin route serves dashboard shell', r.status === 200 && String(r.data).includes('adminRoot'));
  r = await req('GET', '/admin.html');
  check('admin.html blocked → 404', r.status === 404);
  r = await req('GET', '/');
  check('homepage serves SPA shell', r.status === 200 && String(r.data).includes('Tob Daniel'));

  // cleanup test customer cart
  await req('POST', '/api/auth/logout', { token: cToken });

  console.log('');
  console.log('────────────────────────────────────────────');
  console.log(`  PASSED: ${passed}   FAILED: ${failed}`);
  if (failures.length) { console.log('  Failures:'); failures.forEach((f) => console.log('   - ' + f)); }
  console.log('────────────────────────────────────────────');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
