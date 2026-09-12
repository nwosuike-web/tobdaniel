/* ============================================================
   Tob Daniel Business Enterprise — storefront application
   Hash-routed SPA with real-time sync, cart, checkout, account.
   ============================================================ */
(function () {
  const TD = window.TD;
  const { $, $$, esc, fmt, num, pctOff, timeAgo, dateFmt, debounce, store, api, toast, confirmDialog, ICONS, starsHTML, sleep, slugify, skeletonGrid, emptyState, getToken, setToken, guestId } = TD;

  const state = {
    config: null,
    user: null,
    cart: { count: 0 },
    promo: null,
    wishlistCount: 0,
    route: { path: '/', query: new URLSearchParams(), params: {} },
    lastOrder: null,
    es: null,
    offline: false
  };

  const $app = $('#app');

  /* ============================================================
     BOOT
     ============================================================ */
  async function boot() {
    await loadConfig();
    await loadUser();
    bindChrome();
    bindLinks();
    connectSSE();
    window.addEventListener('popstate', route);
    window.addEventListener('online', () => { state.offline = false; toast('You are back online.', 'info'); });
    window.addEventListener('offline', () => { state.offline = true; toast('You are offline — showing saved data.', 'error'); });
    route();
    $('#year').textContent = new Date().getFullYear();
    revealOnScroll();
  }

  async function loadConfig() {
    try { state.config = await api('/api/config'); } catch { /* keep defaults */ }
    if (!state.config) state.config = { storeName: 'Tob Daniel Business Enterprise', slogan: 'Quality Products. Trusted Service. Delivered With Excellence.', paymentMethods: { payOnDelivery: true }, shipping: { flatFee: 2500, freeThreshold: 100000 } };
    applyChrome();
  }

  async function loadUser() {
    try {
      state.user = await api('/api/auth/me');
    } catch { state.user = null; }
    updateBadges();
  }

  function applyChrome() {
    const c = state.config;
    document.title = `${c.storeName} — ${c.slogan}`;
    const ann = $('#announceBar');
    if (c.announcement) { ann.hidden = false; $('#announceText').textContent = c.announcement; } else ann.hidden = true;
    $('#footerSlogan').textContent = c.slogan;
    $('#footerAddress').textContent = c.contact ? c.contact.address : '';
    const fp = $('#footerPhone'), fe = $('#footerEmail');
    if (fp) { fp.textContent = c.contact.phone; fp.href = 'tel:' + String(c.contact.phone).replace(/[^+\d]/g, ''); }
    if (fe) { fe.textContent = c.contact.email; fe.href = 'mailto:' + c.contact.email; }
    const wa = c.contact.whatsapp ? String(c.contact.whatsapp).replace(/[^\d]/g, '') : '';
    const waUrl = 'https://wa.me/' + wa;
    const dw = $('#drawerWa'); if (dw) dw.href = waUrl;
    const soc = $('#footerSocials');
    if (soc && c.social) {
      const map = [['facebook', 'Facebook', 'M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z'], ['instagram', 'Instagram', 'M12 2.2c3.2 0 3.6 0 4.9.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.9.1s-3.6 0-4.8-.1c-3.3-.1-4.8-1.7-4.9-4.9-.1-1.3-.1-1.6-.1-4.8s0-3.6.1-4.8C2.4 4 4 2.4 7.2 2.3 8.4 2.2 8.8 2.2 12 2.2zm0 3.7a6.1 6.1 0 1 0 0 12.2 6.1 6.1 0 0 0 0-12.2zm0 10a3.9 3.9 0 1 1 0-7.8 3.9 3.9 0 0 1 0 7.8zm6.3-10.2a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z'], ['twitter', 'X', 'M18.9 2H22l-6.8 7.8L23.3 22h-6.3l-4.9-6.4L6.5 22H3.4l7.3-8.3L2.4 2h6.4l4.4 5.9L18.9 2zm-1.1 18h1.7L7.9 3.9H6.1L17.8 20z'], ['whatsapp', 'WhatsApp', ICONS.whatsapp.replace('width="20"', 'width="20"').replace('height="20"', 'height="20"')]];
      soc.innerHTML = map.map(([k, label, d]) => {
        const url = c.social[k];
        if (!url) return '';
        return `<a href="${esc(url)}" target="_blank" rel="noopener" aria-label="${label}"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="${d}"/></svg></a>`;
      }).join('');
    }
  }

  function bindChrome() {
    // search
    const doSearch = (term) => {
      const t = String(term || '').trim();
      if (!t) return;
      pushRecent(t);
      closeOverlay();
      go('/shop?search=' + encodeURIComponent(t));
    };
    $('#searchBtn').addEventListener('click', () => doSearch($('#searchInput').value));
    $('#searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(e.target.value); });
    $('#searchOpen').addEventListener('click', () => openOverlay());
    $('#searchInput').addEventListener('focus', () => { if (innerWidth > 980) showOverlaySuggestions(); });
    $('#overlayClose').addEventListener('click', () => closeOverlay());
    $('#overlayInput').addEventListener('input', debounce((e) => showOverlaySuggestions(e.target.value), 200));
    $('#overlayInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(e.target.value); });
    $('#searchOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeOverlay(); });

    // drawer
    const drawer = $('#drawer'), backdrop = $('#drawerBackdrop');
    $('#menuBtn').addEventListener('click', () => openDrawer());
    $('#drawerClose').addEventListener('click', () => closeDrawer());
    backdrop.addEventListener('click', closeDrawer);
    function openDrawer() { drawer.classList.add('open'); backdrop.hidden = false; requestAnimationFrame(() => backdrop.classList.add('open')); }
    function closeDrawer() { drawer.classList.remove('open'); backdrop.classList.remove('open'); setTimeout(() => { backdrop.hidden = true; }, 300); }
    drawer.addEventListener('click', (e) => { if (e.target.closest('a')) closeDrawer(); });

    // newsletter
    $('#newsletterForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      try {
        await api('/api/newsletter', { method: 'POST', body: { email: $('#nlEmail').value } });
        toast('Subscribed! Welcome to the family.');
        e.target.reset();
      } catch (err) { toast(err.message, 'error'); }
    });

    // global clicks (wishlist + quick add on cards)
    document.addEventListener('click', async (e) => {
      const wish = e.target.closest('[data-wish]');
      if (wish) { e.preventDefault(); e.stopPropagation(); await toggleWishlist(wish.dataset.wish, wish); return; }
      const quick = e.target.closest('[data-quick]');
      if (quick) { e.preventDefault(); e.stopPropagation(); await quickAdd(quick.dataset.quick); }
    });
  }

  function openOverlay() {
    const o = $('#searchOverlay');
    o.hidden = false;
    o.style.display = 'flex';
    $('#overlayInput').value = '';
    showOverlaySuggestions('');
    setTimeout(() => $('#overlayInput').focus(), 60);
  }

  function closeOverlay() {
    const o = $('#searchOverlay');
    o.hidden = true;
    o.style.display = 'none';
  }

  async function showOverlaySuggestions(q) {
    const box = $('#overlayResults');
    const term = String(q || '').trim();
    if (!term) {
      const recent = getRecent();
      if (recent.length) {
        box.innerHTML = `<div class="sugg-empty">Recent searches:</div>` + recent.map((r) => `<div class="sugg-item" data-go="${esc(r)}"><div style="color:var(--muted)">↺</div><div><div class="sugg-name">${esc(r)}</div></div></div>`).join('');
        bindSuggClicks(box);
      } else box.innerHTML = `<div class="sugg-empty">Start typing to search products, brands and SKUs…</div>`;
      return;
    }
    try {
      const res = await api('/api/products/suggestions?q=' + encodeURIComponent(term));
      if (!res.length) {
        box.innerHTML = `<div class="sugg-empty">No matches for “${esc(term)}”. Try another word.</div>`;
        return;
      }
      box.innerHTML = res.map((r) => `<div class="sugg-item" data-go="${esc(r.name)}">
        <img src="${esc(r.image || '/images/favicon.svg')}" alt="${esc(r.name)}" onerror="this.src='/images/favicon.svg'">
        <div><div class="sugg-name">${esc(r.name)}</div><div class="sugg-sub">${esc(r.brand || '')} · ${esc(r.sku)}</div></div></div>`).join('');
      bindSuggClicks(box);
    } catch { box.innerHTML = `<div class="sugg-empty">Search unavailable.</div>`; }
  }

  function bindSuggClicks(box) {
    box.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => {
      const t = el.dataset.go;
      pushRecent(t);
      closeOverlay();
      go('/shop?search=' + encodeURIComponent(t));
    }));
  }

  const pushRecent = (t) => {
    let r = getRecent(); r = [t, ...r.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 6);
    store.jsonSet('td_recent', r);
  };
  const getRecent = () => store.jsonGet('td_recent', []) || [];

  /* ============================================================
     CART / WISHLIST ACTIONS + BADGES
     ============================================================ */
  async function refreshCart() {
    try {
      const c = await api('/api/cart');
      state.cart = c;
      updateBadges();
      return c;
    } catch (err) {
      if (err.status !== 401) console.warn('cart', err.message);
      return null;
    }
  }
  async function refreshWishlist() {
    if (!state.user) { state.wishlistCount = 0; updateBadges(); return; }
    try { const w = await api('/api/wishlist'); state.wishlistCount = w.items.length; updateBadges(); } catch { }
  }
  function updateBadges() {
    const n = state.cart.count || 0;
    const cb = $('#cartBadge'), cb2 = $('#cartBadge2');
    [cb, cb2].forEach((el) => { if (!el) return; el.hidden = n === 0; el.textContent = n; });
    const wb = $('#wishBadge');
    if (wb) { wb.hidden = state.wishlistCount === 0; wb.textContent = state.wishlistCount; }
  }

  async function addToCart(productId, qty = 1, opts = {}) {
    try {
      await api('/api/cart', { method: 'POST', body: { productId, qty } });
      await refreshCart();
      toast(opts.quiet ? 'Cart updated' : 'Added to cart ✓');
      return true;
    } catch (err) { toast(err.message, 'error'); return false; }
  }
  async function quickAdd(slug) {
    const p = await api('/api/products/' + slug).catch(() => null);
    if (!p) return toast('Product not found.', 'error');
    if (p.stock < 1) return toast('Out of stock.', 'error');
    addToCart(p.id, 1);
  }
  async function toggleWishlist(productId, btn) {
    if (!state.user) { toast('Please sign in to save wishlist items.', 'info'); go('/login?next=' + encodeURIComponent(location.pathname + location.search)); return; }
    try {
      const res = await api('/api/wishlist', { method: 'POST', body: { productId } });
      state.wishlistCount = res.count; updateBadges();
      if (btn) btn.classList.add('liked');
      toast('Saved to wishlist ♥');
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ============================================================
     REAL-TIME (SSE)
     ============================================================ */
  function clientId() { return state.user ? 'u' + state.user.id : 'g' + guestId(); }

  function connectSSE() {
    try { if (state.es) state.es.close(); } catch { }
    const channels = ['products', 'categories', 'banners', 'settings', 'flashsales', 'testimonials', 'faqs'];
    if (state.user) channels.push('orders:u' + state.user.id, 'notifications:u' + state.user.id);
    let cid;
    try { cid = clientId(); } catch { cid = 'anon' + Date.now().toString(36); }
    let es;
    try { es = new EventSource('/api/events?channels=' + channels.join(',') + '&client=' + encodeURIComponent(cid)); }
    catch { return; }
    state.es = es;

    const softReload = debounce(() => {
      const p = state.route.path;
      if (p === '/' || p === '/shop') loadRouteData(p);
      else if (p === '/product') loadRouteData(p);
    }, 400);

    ['products', 'categories', 'banners', 'settings', 'flashsales', 'testimonials', 'faqs'].forEach((ch) =>
      es.addEventListener(ch, (e) => {
        toast('Live update received — refreshing…', 'info', 2000);
        softReload();
      })
    );
    es.addEventListener('c:' + clientId(), () => {
      refreshCart();
      if (state.route.path === '/cart' || state.route.path === '/checkout') loadRouteData(state.route.path);
    });
    es.addEventListener('orders:u' + (state.user ? state.user.id : 0), () => {
      if (state.route.path === '/account') loadRouteData('/account');
    });
    es.onopen = () => { if (state.offline) { state.offline = false; toast('Connection restored.', 'info'); } };
    es.onerror = () => { state.offline = true; };
  }

  function loadRouteData(path) {
    if (path === '/') initHome(true);
    else if (path === '/shop') initShop(true);
    else if (path === '/product') initProduct(state.route.params.slug, true);
    else if (path === '/cart') initCart(true);
    else if (path === '/checkout') initCheckout(true);
  }

  /* ============================================================
     ROUTER — real URLs (path-based, back/forward button aware)
     ============================================================ */
  function parsePath() {
    const path = location.pathname || '/';
    const query = new URLSearchParams(location.search || '');
    return { path, query };
  }

  // Navigate to an internal path (updates the URL + renders), or follow external links.
  function go(url) {
    let u;
    try { u = new URL(url, location.origin); } catch { return; }
    if (u.origin !== location.origin) { location.assign(url); return; }
    if (u.pathname === location.pathname && u.search === location.search && u.hash === location.hash) { route(); return; }
    try { history.pushState({}, '', u.pathname + u.search + u.hash); } catch { location.assign(url); return; }
    route();
  }

  // Intercept internal links so navigation is instant while URLs stay real.
  function bindLinks() {
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!href || a.target === '_blank' || a.hasAttribute('download')) return;
      if (href.startsWith('#')) { if (href.startsWith('#/')) { e.preventDefault(); go(href.slice(1)); } return; }
      if (/^(https?:|mailto:|tel:|javascript:)/i.test(href) || href.startsWith('//')) return;
      e.preventDefault();
      go(href);
    });
  }

  function route() {
    const { path, query } = parsePath();
    state.route.query = query;
    state.route.params = {};
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    updateActiveNav(path);

    let page;
    if (path === '/' || path === '') page = pageHome();
    else if (path === '/shop') page = pageShop();
    else if (path.startsWith('/product/')) { state.route.params.slug = path.split('/')[2]; page = pageProduct(); }
    else if (path === '/cart') page = pageCart();
    else if (path === '/checkout') page = pageCheckout();
    else if (path.startsWith('/order/')) page = pageOrderConfirm();
    else if (path === '/contact') page = pageContact();
    else if (path === '/login') page = pageAuth('login');
    else if (path === '/register') page = pageAuth('register');
    else if (path === '/forgot') page = pageAuth('forgot');
    else if (path === '/reset') page = pageAuth('reset');
    else if (path.startsWith('/account')) page = pageAccount();
    else page = pageNotFound();

    state.route.path = page.key || path;
    $app.innerHTML = page.html;
    if (page.init) page.init();
  }

  function updateActiveNav(path) {
    let key = path;
    if (path.startsWith('/product')) key = '/shop';
    if (path.startsWith('/account')) key = '/account';
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key.slice(1) || (key === '/' && a.dataset.nav === 'home') || (key === '/shop' && a.dataset.nav === 'shop')));
  }

  /* ============================================================
     PRODUCT CARD + SECTION HELPERS
     ============================================================ */
  function productCardHTML(p) {
    const price = p.flash_price != null ? p.flash_price : p.price;
    const off = pctOff(price, p.compare_at_price || p.price);
    const oos = p.stock <= 0;
    const flags = [];
    if (off > 0) flags.push(`<span class="sale-flag">-${off}%</span>`);
    if (p.is_new) flags.push(`<span class="sale-flag new">NEW</span>`);
    if (p.is_best_seller && !p.is_new) flags.push(`<span class="sale-flag best">Best seller</span>`);
    if (oos) flags.push(`<span class="sale-flag oos">Out of stock</span>`);
    return `<a class="product-card ${oos ? 'p-oos' : ''}" href="/product/${esc(p.slug)}">
      <div class="p-media">
        ${flags.join('')}
        <img src="${esc(p.image || '/images/favicon.svg')}" alt="${esc(p.name)}" loading="lazy" onerror="this.src='/images/favicon.svg'">
        <div class="p-actions">
          <button data-wish="${p.id}" aria-label="Add ${esc(p.name)} to wishlist">${ICONS.heart}</button>
          <button data-quick="${esc(p.slug)}" aria-label="Add ${esc(p.name)} to cart" ${oos ? 'disabled' : ''}>${ICONS.cart}</button>
        </div>
      </div>
      <div class="p-body">
        <div class="p-brand">${esc(p.brand || 'Tob Daniel')}</div>
        <div class="p-name">${esc(p.name)}</div>
        <div class="p-price">${fmt(price)} ${p.flash_price != null ? `<span class="old">${fmt(p.price)}</span>` : (p.compare_at_price > p.price ? `<span class="old">${fmt(p.compare_at_price)}</span>` : '')}</div>
        <div class="p-rating">${starsHTML(p.rating_avg, 12)}<span>(${p.rating_count || 0})</span></div>
      </div>
    </a>`;
  }

  function sectionGrid(id, cls = 'product-grid') {
    return `<div id="${id}" class="${cls}">${Array(4).fill(0).map(() => `<div class="sk-card"><div class="skeleton"></div><div class="sk-lines"><div class="skeleton" style="height:12px"></div><div class="skeleton" style="height:12px;width:60%"></div></div></div>`).join('')}</div>`;
  }

  /* ============================================================
     HOME
     ============================================================ */
  function pageHome() {
    return {
      key: '/',
      html: `
      <div class="container mt2">
        <section class="hero" id="hero" aria-label="Featured banner">
          <div class="hero-slide active" style="background:linear-gradient(120deg,#0a3a8f,#1c5fc4 55%,#3fa9f5)"></div>
          <div class="hero-content">
            <span class="hero-kicker">✨ ${esc(state.config ? state.config.storeName : 'Tob Daniel Business Enterprise')}</span>
            <h1 id="heroTitle">Quality Products.<br>Trusted Service.</h1>
            <p id="heroSub">Delivered with excellence across Nigeria.</p>
            <div class="hero-search">
              <input id="heroSearch" type="search" placeholder="What are you looking for today?" aria-label="Search products">
              <button class="btn btn-gold" id="heroSearchBtn">Search</button>
            </div>
          </div>
          <div class="hero-dots" id="heroDots"></div>
        </section>
      </div>
      <div class="container section">
        <div class="benefits">
          <div class="benefit"><div class="bi">${ICONS.truck}</div><div><b>Fast delivery</b><span>Nationwide in 1–5 days</span></div></div>
          <div class="benefit"><div class="bi">${ICONS.badge}</div><div><b>100% genuine</b><span>Verified products & warranty</span></div></div>
          <div class="benefit"><div class="bi">${ICONS.shield}</div><div><b>Secure payments</b><span>Card, transfer & pay on delivery</span></div></div>
          <div class="benefit"><div class="bi">${ICONS.headset}</div><div><b>24/7 support</b><span>Phone, email & WhatsApp</span></div></div>
        </div>
      </div>
      <div class="container section" id="flashWrap"></div>
      <div class="container section">
        <div class="section-head"><div><h2>Shop by category</h2><div class="sub">Everything you need, one trusted store</div></div></div>
        <div class="cats" id="homeCats">${Array(8).fill(0).map(() => `<div class="skeleton" style="height:130px"></div>`).join('')}</div>
      </div>
      <div class="container section">
        <div class="section-head"><div><h2>Featured products</h2><div class="sub">Hand-picked premium picks</div></div><a href="/shop">View all →</a></div>
        ${sectionGrid('homeFeatured')}
      </div>
      <div class="container section" id="homePromo"></div>
      <div class="container section">
        <div class="section-head"><div><h2>New arrivals</h2><div class="sub">Fresh in store this week</div></div><a href="/shop?sort=newest">View all →</a></div>
        ${sectionGrid('homeNew')}
      </div>
      <div class="container section">
        <div class="section-head"><div><h2>Best sellers</h2><div class="sub">Most loved by our customers</div></div><a href="/shop?sort=popular">View all →</a></div>
        ${sectionGrid('homeBest')}
      </div>
      <div class="container section">
        <div class="section-head"><div><h2>What our customers say</h2><div class="sub">Real reviews from real shoppers</div></div></div>
        <div class="testi-grid" id="homeTesti">${Array(3).fill(0).map(() => `<div class="skeleton" style="height:150px"></div>`).join('')}</div>
      </div>
      <div class="container section">
        <div class="newsletter-band">
          <h3>Get exclusive deals in your inbox</h3>
          <p>Join the Tob Daniel family and be first to know about flash sales and new arrivals.</p>
          <div class="nl-row"><input id="nlBandEmail" type="email" placeholder="you@email.com"><button class="btn btn-gold" id="nlBandBtn">Subscribe</button></div>
        </div>
      </div>`,
      init() {
        initHome(false);
        $('#heroSearchBtn').addEventListener('click', () => { const t = $('#heroSearch').value.trim(); if (t) { pushRecent(t); go('/shop?search=' + encodeURIComponent(t)); } });
        $('#heroSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const t = e.target.value.trim(); if (t) { pushRecent(t); go('/shop?search=' + encodeURIComponent(t)); } } });
        $('#nlBandBtn').addEventListener('click', async () => {
          const em = $('#nlBandEmail').value;
          try { await api('/api/newsletter', { method: 'POST', body: { email: em } }); toast('Subscribed! Welcome to the family.'); $('#nlBandEmail').value = ''; } catch (e) { toast(e.message, 'error'); }
        });
      }
    };
  }

  let heroTimer = null, heroIndex = 0, heroSlides = [];
  async function initHome(silent) {
    try {
      const d = await api('/api/home');
      renderHome(d);
    } catch (err) {
      if (!silent) toast(err.message, 'error');
    }
  }

  function renderHome(d) {
    // hero
    const slides = (d.banners && d.banners.length) ? d.banners : [{ title: 'Quality Products. Trusted Service.', subtitle: d.banners ? '' : 'Delivered with excellence.', image_url: '/images/hero.jpg' }];
    heroSlides = slides;
    const hero = $('#hero');
    if (hero) {
      hero.innerHTML = slides.map((b, i) => `<div class="hero-slide ${i === 0 ? 'active' : ''}" style="background-image:url('${esc(b.image_url || '/images/hero.jpg')}')"></div>`).join('') +
        `<div class="hero-content">
          <span class="hero-kicker">✨ ${esc(state.config.storeName)}</span>
          <h1>${esc(slides[0].title || 'Quality Products.<br>Trusted Service.')}</h1>
          <p>${esc(slides[0].subtitle || state.config.slogan)}</p>
          <div class="hero-search"><input id="heroSearch" type="search" placeholder="What are you looking for today?"><button class="btn btn-gold" id="heroSearchBtn">Search</button></div>
        </div>
        <div class="hero-float f1">🚚 Free delivery over ${fmt(state.config.shipping.freeThreshold)}</div>
        <div class="hero-float f2">⚡ Pay on delivery available</div>
        <div class="hero-dots" id="heroDots">${slides.map((_, i) => `<button class="${i === 0 ? 'active' : ''}" data-i="${i}" aria-label="Banner ${i + 1}"></button>`).join('')}</div>`;
      const input = $('#heroSearch'); if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const t = e.target.value.trim(); if (t) { pushRecent(t); go('/shop?search=' + encodeURIComponent(t)); } } });
      const btn = $('#heroSearchBtn'); if (btn) btn.addEventListener('click', () => { const t = $('#heroSearch').value.trim(); if (t) { pushRecent(t); go('/shop?search=' + encodeURIComponent(t)); } });
      $('#heroDots').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => showHeroSlide(+b.dataset.i)));
      clearInterval(heroTimer);
      heroIndex = 0;
      if (slides.length > 1) heroTimer = setInterval(() => showHeroSlide(heroIndex + 1), 6000);
    }

    // flash sale
    const fw = $('#flashWrap');
    if (fw) {
      if (d.flashSale && d.flashSale.products.length) {
        const fs = d.flashSale;
        fw.innerHTML = `
          <div class="flash">
            <div class="flash-head">
              <h2>⚡ ${esc(fs.title || 'Flash Sale')}</h2>
              <div class="flash-timer" id="flashTimer"><span class="t">--</span><span class="sep">:</span><span class="t">--</span><span class="sep">:</span><span class="t">--</span><span class="sep">:</span><span class="t">--</span></div>
              <a href="/shop?flash=1" style="color:#fff;margin-left:auto;font-weight:700">See all →</a>
            </div>
            <div class="flash-grid">${fs.products.map(productCardHTML).join('')}</div>
          </div>`;
        startCountdown($('#flashTimer'), fs.endsAt);
      } else fw.innerHTML = '';
    }

    // categories
    const cc = $('#homeCats');
    if (cc) {
      const icons = ['📱', '💻', '🎧', '📺', '👟', '💄', '🍳', '📷'];
      cc.innerHTML = (d.categories || []).map((c, i) => `
        <a class="cat-card" href="/shop?category=${esc(c.slug)}">
          <div class="ci" style="font-size:26px">${icons[i % icons.length]}</div>
          <b>${esc(c.name)}</b><span>${c.count || 0} items</span>
        </a>`).join('');
    }

    $('#homeFeatured').innerHTML = d.featured.length ? d.featured.map(productCardHTML).join('') : emptyState('No featured products yet', '');
    $('#homeNew').innerHTML = d.newArrivals.length ? d.newArrivals.map(productCardHTML).join('') : emptyState('New arrivals coming soon', '');
    $('#homeBest').innerHTML = d.bestSellers.length ? d.bestSellers.map(productCardHTML).join('') : emptyState('Best sellers coming soon', '');

    const promo = $('#homePromo');
    if (promo) {
      const b = (d.banners || []).find((x) => x.position === 'promo') || (d.banners || [])[2];
      if (b) promo.innerHTML = `<div class="promo-banner"><img src="${esc(b.image_url)}" alt="${esc(b.title)}"><div class="pb-content"><h3>${esc(b.title)}</h3><p>${esc(b.subtitle || '')}</p><a class="btn btn-gold" href="${esc(b.cta_link || '/shop')}">${esc(b.cta_text || 'Shop now')}</a></div></div>`;
    }

    const tt = $('#homeTesti');
    if (tt) tt.innerHTML = (d.testimonials || []).map((t) => `
      <div class="testi"><div class="stars">${'★'.repeat(t.rating || 5)}</div><p>“${esc(t.body)}”</p>
        <div class="who"><div class="avatar">${esc((t.name || '?')[0])}</div><div><b>${esc(t.name)}</b><span>${esc(t.location || '')}</span></div></div></div>`).join('');

    revealOnScroll();
  }

  function showHeroSlide(i) {
    if (!heroSlides.length) return;
    heroIndex = (i + heroSlides.length) % heroSlides.length;
    const hero = $('#hero'); if (!hero) return;
    const slides = $$('.hero-slide', hero);
    slides.forEach((s, idx) => s.classList.toggle('active', idx === heroIndex));
    const title = heroSlides[heroIndex].title || '';
    const sub = heroSlides[heroIndex].subtitle || '';
    const h1 = $('#heroTitle'), hp = $('#heroSub');
    if (h1) h1.innerHTML = esc(title).replace(/\n/g, '<br>');
    if (hp) hp.textContent = sub;
    $$('#heroDots button').forEach((b, idx) => b.classList.toggle('active', idx === heroIndex));
  }

  function startCountdown(el, endsAt) {
    const end = endsAt ? new Date(String(endsAt).replace(' ', 'T') + 'Z').getTime() : Date.now() + 86400000;
    const tick = () => {
      let diff = Math.max(0, end - Date.now());
      const d = Math.floor(diff / 86400000); diff -= d * 86400000;
      const h = Math.floor(diff / 3600000); diff -= h * 3600000;
      const m = Math.floor(diff / 60000); diff -= m * 60000;
      const s = Math.floor(diff / 1000);
      const pad = (n) => String(n).padStart(2, '0');
      el.querySelectorAll('.t').forEach((t, i) => { t.textContent = [pad(d), pad(h), pad(m), pad(s)][i]; });
      if (d === 0 && h === 0 && m === 0 && s === 0) clearInterval(tick._i);
    };
    tick(); tick._i = setInterval(tick, 1000);
  }

  /* ============================================================
     SHOP / LISTING
     ============================================================ */
  function pageShop() {
    return {
      key: '/shop',
      html: `
      <div class="container mt3">
        <h1 class="fade-in" id="shopTitle" style="font-size:24px;font-weight:800;margin-bottom:4px">Shop</h1>
        <div class="sub muted small" id="shopSub">Browse our full catalogue</div>
        <div class="shop-layout mt3">
          <aside class="filters" id="filtersPanel" aria-label="Filters"></aside>
          <div>
            <div class="shop-toolbar">
              <span class="result-count" id="resultCount">Loading…</span>
              <button class="btn btn-outline btn-sm filters-toggle" id="filtersToggle">☰ Filters</button>
              <label class="sr-only" for="sortSel">Sort</label>
              <select id="sortSel" aria-label="Sort products">
                <option value="newest">Newest</option>
                <option value="popular">Most popular</option>
                <option value="rating">Top rated</option>
                <option value="price-asc">Price: low → high</option>
                <option value="price-desc">Price: high → low</option>
              </select>
              <div class="view-toggle" role="group" aria-label="View mode">
                <button id="viewGrid" aria-label="Grid view">▦</button>
                <button id="viewList" aria-label="List view">☰</button>
              </div>
            </div>
            <div id="shopGrid" class="product-grid">${Array(8).fill(0).map(() => `<div class="sk-card"><div class="skeleton"></div><div class="sk-lines"><div class="skeleton" style="height:12px"></div><div class="skeleton" style="height:12px;width:60%"></div></div></div>`).join('')}</div>
            <div class="pager" id="pager"></div>
          </div>
        </div>
      </div>`,
      init() { initShop(false); }
    };
  }

  function shopParams() {
    const q = state.route.query;
    return {
      search: q.get('search') || '', category: q.get('category') || '', brand: q.get('brand') || '',
      min: q.get('min') || '', max: q.get('max') || '', rating: q.get('rating') || '',
      inStock: q.get('inStock') || '', sort: q.get('sort') || 'newest', page: parseInt(q.get('page') || '1', 10),
      flash: q.get('flash') || '', view: store.get('td_view') || 'grid'
    };
  }

  async function initShop(silent) {
    const p = shopParams();
    const grid = $('#shopGrid');
    const title = $('#shopTitle'), sub = $('#shopSub');
    if (p.flash === '1') { title.textContent = '⚡ Flash deals'; sub.textContent = 'Limited-time prices — while stocks last'; }
    else if (p.search) { title.textContent = `Results for “${p.search}”`; sub.textContent = 'Search across products, brands and SKUs'; }
    else if (p.category) { title.textContent = 'Category'; sub.textContent = 'Browse products in this category'; }

    // sort + view controls
    $('#sortSel').value = p.sort;
    $('#sortSel').onchange = (e) => goShop({ sort: e.target.value, page: 1 });
    const vg = $('#viewGrid'), vl = $('#viewList');
    vg.classList.toggle('active', p.view !== 'list'); vl.classList.toggle('active', p.view === 'list');
    vg.onclick = () => { store.set('td_view', 'grid'); grid.classList.remove('list'); vg.classList.add('active'); vl.classList.remove('active'); };
    vl.onclick = () => { store.set('td_view', 'list'); grid.classList.add('list'); vl.classList.add('active'); vg.classList.remove('active'); };
    if (p.view === 'list') grid.classList.add('list');

    // filters sidebar
    await renderFilters(p);

    // data
    const qs = new URLSearchParams();
    ['search', 'category', 'brand', 'min', 'max', 'rating', 'inStock', 'sort', 'flash'].forEach((k) => { if (p[k]) qs.set(k, p[k]); });
    qs.set('page', p.page); qs.set('limit', 12);
    try {
      const d = await api('/api/products?' + qs.toString());
      $('#resultCount').textContent = `${d.total} product${d.total === 1 ? '' : 's'} found`;
      if (!d.items.length) {
        const popular = await api('/api/products?sort=popular&limit=4').catch(() => ({ items: [] }));
        grid.innerHTML = emptyState('No products found', 'Try adjusting your filters or search term.', `<a class="btn btn-primary" href="/shop" style="margin-top:14px">Clear filters</a>`) +
          (popular.items.length ? `<h3 class="mt4" style="margin-bottom:14px">You might like these</h3><div class="product-grid" style="margin-top:0">${popular.items.map(productCardHTML).join('')}</div>` : '');
        $('#pager').innerHTML = '';
        return;
      }
      grid.innerHTML = d.items.map(productCardHTML).join('');
      renderPager(d.page, d.pages);
      revealOnScroll();
    } catch (err) {
      if (!silent) toast(err.message, 'error');
      grid.innerHTML = emptyState('Something went wrong', err.message);
    }
  }

  function goShop(overrides) {
    const p = shopParams();
    const next = { ...p, ...overrides };
    const qs = new URLSearchParams();
    Object.keys(next).forEach((k) => { if (next[k] && k !== 'view') qs.set(k, next[k]); });
    go('/shop' + (qs.toString() ? '?' + qs.toString() : ''));
  }

  async function renderFilters(p) {
    const panel = $('#filtersPanel');
    if (!panel) return;
    let cats = [];
    try { cats = await api('/api/categories'); } catch { }
    let brands = []; let maxPrice = 0;
    try { const d = await api('/api/products?limit=1'); brands = d.brands; maxPrice = d.maxPrice; } catch { }

    const catTree = (list, depth = 0) => list.map((c) => `
      <a href="/shop?category=${esc(c.slug)}" class="${depth ? 'sub' : ''} ${p.category === c.slug ? 'active' : ''}">${esc(c.name)}</a>
      ${(c.children && c.children.length) ? catTree(c.children, 1) : ''}`).join('');

    panel.innerHTML = `
      <div class="between center-y"><h3 style="margin:0">Filters</h3><button class="icon-btn" id="filtersClose" aria-label="Close filters">✕</button></div>
      <div class="filter-group"><summary style="font-weight:700;font-size:13.5px;padding:4px 0">Categories</summary>
        <div class="fg-body cat-tree mt2">${catTree(cats)}</div>
      </div>
      <div class="filter-group"><summary>Price range</summary>
        <div class="fg-body">
          <div class="price-inputs">
            <input id="priceMin" type="number" placeholder="Min" value="${esc(p.min)}" inputmode="numeric">
            <input id="priceMax" type="number" placeholder="Max" value="${esc(p.max)}" inputmode="numeric">
          </div>
          <button class="btn btn-outline btn-sm" id="applyPrice">Apply</button>
          <div class="small muted">Up to ${fmt(maxPrice)}</div>
        </div>
      </div>
      <div class="filter-group"><summary>Brand</summary>
        <div class="fg-body" id="brandList">
          ${brands.map((b) => `<label><input type="checkbox" data-brand="${esc(b)}" ${p.brand.split(',').includes(b) ? 'checked' : ''}> ${esc(b)}</label>`).join('')}
        </div>
      </div>
      <div class="filter-group"><summary>Rating</summary>
        <div class="fg-body" id="ratingList">
          ${[4, 3, 2].map((r) => `<label><input type="radio" name="rating" value="${r}" ${p.rating === String(r) ? 'checked' : ''}> ${r}+ stars</label>`).join('')}
          <label><input type="radio" name="rating" value="" ${!p.rating ? 'checked' : ''}> Any rating</label>
        </div>
      </div>
      <div class="filter-group"><summary>Availability</summary>
        <div class="fg-body">
          <label><input type="checkbox" id="inStockChk" ${p.inStock === '1' ? 'checked' : ''}> In stock only</label>
        </div>
      </div>
      <button class="btn btn-outline btn-block mt2" id="clearFilters">Clear all filters</button>`;

    const close = $('#filtersClose'); if (close) close.onclick = () => panel.classList.remove('open');
    $('#applyPrice').onclick = () => goShop({ min: $('#priceMin').value, max: $('#priceMax').value, page: 1 });
    $('#priceMin').onkeydown = (e) => { if (e.key === 'Enter') goShop({ min: e.target.value, max: $('#priceMax').value, page: 1 }); };
    $('#priceMax').onkeydown = (e) => { if (e.key === 'Enter') goShop({ max: e.target.value, min: $('#priceMin').value, page: 1 }); };
    $('#inStockChk').onchange = (e) => goShop({ inStock: e.target.checked ? '1' : '', page: 1 });
    $('#clearFilters').onclick = () => { go('/shop'); };
    $('#brandList').addEventListener('change', () => {
      const sel = $$('#brandList input:checked').map((x) => x.dataset.brand);
      goShop({ brand: sel.join(','), page: 1 });
    });
    $('#ratingList').addEventListener('change', (e) => goShop({ rating: e.target.value, page: 1 }));
    const ft = $('#filtersToggle'); if (ft) ft.onclick = () => panel.classList.add('open');
  }

  function renderPager(page, pages) {
    const pager = $('#pager');
    if (pages <= 1) { pager.innerHTML = ''; return; }
    let btns = `<button data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button>`;
    for (let i = 1; i <= pages; i++) {
      if (pages > 9 && i > 2 && i < pages - 1 && Math.abs(i - page) > 1) { if (i === 3 || i === pages - 2) btns += `<button disabled>…</button>`; continue; }
      btns += `<button data-p="${i}" class="${i === page ? 'active' : ''}">${i}</button>`;
    }
    btns += `<button data-p="${page + 1}" ${page >= pages ? 'disabled' : ''}>›</button>`;
    pager.innerHTML = btns;
    pager.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => goShop({ page: +b.dataset.p })));
  }

  /* ============================================================
     PRODUCT DETAIL
     ============================================================ */
  function pageProduct() {
    return {
      key: '/product',
      html: `
      <div class="container mt3">
        <div class="pdp" id="pdpRoot">
          ${Array(2).fill(0).map(() => `<div class="sk-card"><div class="skeleton"></div><div class="sk-lines"><div class="skeleton" style="height:20px"></div><div class="skeleton" style="height:20px;width:70%"></div><div class="skeleton" style="height:14px"></div></div></div>`).join('')}
        </div>
      </div>`,
      init() { initProduct(state.route.params.slug, false); }
    };
  }

  async function initProduct(slug, silent) {
    const root = $('#pdpRoot'); if (!root) return;
    try {
      const p = await api('/api/products/' + slug);
      document.title = `${p.name} — ${state.config.storeName}`;
      injectProductSchema(p);
      renderProduct(p);
    } catch (err) {
      if (!silent) toast(err.message, 'error');
      root.innerHTML = emptyState('Product not found', 'This product may have been removed.', `<a class="btn btn-primary" href="/shop" style="margin-top:14px">Back to shop</a>`);
    }
  }

  function injectProductSchema(p) {
    const el = document.getElementById('product-jsonld');
    if (el) el.remove();
    const s = document.createElement('script');
    s.type = 'application/ld+json'; s.id = 'product-jsonld';
    const price = p.flash_price != null ? p.flash_price : p.price;
    s.textContent = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Product',
      name: p.name, sku: p.sku, brand: { '@type': 'Brand', name: p.brand }, description: (p.short_desc || p.description || '').slice(0, 300),
      image: (p.images || []).map((i) => 'https://' + location.host + i.url),
      offers: { '@type': 'Offer', priceCurrency: 'NGN', price: price, availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' },
      aggregateRating: p.rating_count ? { '@type': 'AggregateRating', ratingValue: p.rating_avg, reviewCount: p.rating_count } : undefined
    });
    document.head.appendChild(s);
  }

  let pdpCurrent = null;
  function renderProduct(p) {
    pdpCurrent = p;
    const root = $('#pdpRoot');
    const price = p.flash_price != null ? p.flash_price : p.price;
    const off = pctOff(price, p.compare_at_price || p.price);
    const imgs = p.images && p.images.length ? p.images : [{ url: '/images/favicon.svg' }];
    const stockCls = p.stock <= 0 ? 'out' : (p.stock <= 5 ? 'low' : 'in');
    const stockTxt = p.stock <= 0 ? 'Out of stock' : (p.stock <= 5 ? `Only ${p.stock} left in stock` : 'In stock');
    const cat = p.category ? p.category.name : '';

    const breakdown = {};
    (p.review_breakdown || []).forEach((r) => { breakdown[r.rating] = r.n; });
    const totalReviews = p.rating_count || 0;

    root.innerHTML = `
    <div class="gallery">
      <div class="gallery-main" id="gMain"><img src="${esc(imgs[0].url)}" alt="${esc(p.name)}" id="gMainImg"></div>
      ${imgs.length > 1 ? `<div class="gallery-thumbs">${imgs.map((im, i) => `<button class="${i === 0 ? 'active' : ''}" data-url="${esc(im.url)}"><img src="${esc(im.url)}" alt="${esc(p.name)} thumbnail ${i + 1}" loading="lazy"></button>`).join('')}</div>` : ''}
    </div>
    <div class="pdp-info">
      <div class="pdp-brand">${esc(p.brand || 'Tob Daniel')}</div>
      <h1>${esc(p.name)}</h1>
      <div class="pdp-rating">${starsHTML(p.rating_avg, 15)} <span>${(p.rating_avg || 0).toFixed(1)} · ${totalReviews} review${totalReviews === 1 ? '' : 's'}</span> · <a href="#reviews" style="color:var(--royal);font-weight:700">Read reviews</a></div>
      <div class="pdp-price">
        <span class="now">${fmt(price)}</span>
        ${p.flash_price != null || p.compare_at_price > p.price ? `<span class="old">${fmt(p.flash_price != null ? p.price : p.compare_at_price)}</span>` : ''}
        ${off > 0 ? `<span class="save">Save ${off}%</span>` : ''}
      </div>
      ${p.flash_price != null ? `<div style="background:var(--danger-soft);color:var(--danger);border-radius:10px;padding:9px 14px;font-size:13px;font-weight:700;margin-bottom:12px">⚡ Flash sale price — limited time only</div>` : ''}
      <div class="stock-line"><span class="dot ${stockCls}"></span> ${stockTxt}</div>
      <div class="pdp-buy">
        <div class="qty"><button id="qMinus" aria-label="Decrease quantity">−</button><input id="qtyInput" type="number" value="1" min="1" max="${p.stock || 1}" aria-label="Quantity"><button id="qPlus" aria-label="Increase quantity">+</button></div>
        <div class="pdp-actions">
          <button class="btn btn-primary btn-lg" id="addToCartBtn" ${p.stock <= 0 ? 'disabled' : ''}>${ICONS.cart} Add to cart</button>
          <button class="btn btn-gold btn-lg" id="buyNowBtn" ${p.stock <= 0 ? 'disabled' : ''}>Buy now</button>
          <button class="wish-btn" id="wishBtn" aria-label="Add to wishlist" aria-pressed="false">${ICONS.heart}</button>
        </div>
      </div>
      <div class="pdp-meta">
        <div><b>SKU</b>${esc(p.sku)}</div>
        <div><b>Category</b>${esc(cat)}</div>
        <div><b>Brand</b>${esc(p.brand || '—')}</div>
        <div><b>Delivery</b>${state.config.shipping && state.config.shipping.freeThreshold ? `Free over ${fmt(state.config.shipping.freeThreshold)}` : 'Nationwide'}</div>
      </div>
      <div class="pdp-tabs">
        <div class="tab-head">
          <button class="active" data-tab="desc">Description</button>
          <button data-tab="specs">Specifications</button>
          <button data-tab="reviews" id="reviewsTab">Reviews (${totalReviews})</button>
        </div>
        <div class="tab-panel" id="tabDesc">${esc(p.description || 'No description yet.')}</div>
        <div class="tab-panel" id="tabSpecs" hidden>
          ${p.specs && p.specs.length ? `<table class="spec-table">${p.specs.map((s) => `<tr><td>${esc(s.label)}</td><td>${esc(s.value)}</td></tr>`).join('')}</table>` : '<p class="muted">No specifications listed.</p>'}
        </div>
        <div class="tab-panel" id="tabReviews" hidden>
          <div class="rating-summary">
            <div class="big">${(p.rating_avg || 0).toFixed(1)}</div>
            <div style="min-width:120px">${starsHTML(p.rating_avg, 18)}<div class="small muted mt1">${totalReviews} reviews</div></div>
            <div class="rating-bars">${[5, 4, 3, 2, 1].map((r) => { const n = breakdown[r] || 0; const w = totalReviews ? Math.round(n / totalReviews * 100) : 0; return `<div class="rb-row"><span>${r}★</span><div class="bar"><i style="width:${w}%"></i></div><span>${n}</span></div>`; }).join('')}</div>
          </div>
          <div id="reviewList">${renderReviews(p.reviews || [])}</div>
          <div id="reviewFormWrap" class="mt2">
            ${state.user ? reviewFormHTML(p.id) : `<div class="auth-card" style="box-shadow:none;border:1px dashed var(--line)"><p class="muted">Sign in to write a review.</p><a class="btn btn-outline btn-sm mt1" href="/login?next=${encodeURIComponent('/product/' + p.slug)}">Sign in</a></div>`}
          </div>
        </div>
      </div>
    </div>
    <div style="grid-column:1/-1" class="mt2">
      ${p.frequently_bought && p.frequently_bought.length ? `
      <div class="section-head mt3"><div><h2>Frequently bought together</h2><div class="sub">Customers also added these</div></div></div>
      <div class="bundle">
        <div class="product-card" style="max-width:210px">${productCardHTML(p)}</div>
        <span style="align-self:center;font-size:26px;color:var(--muted)">+</span>
        ${p.frequently_bought.map((x) => `<div class="product-card" style="max-width:210px">${productCardHTML(x)}</div>`).join('')}
      </div>` : ''}
      ${p.related && p.related.length ? `
      <div class="section-head mt3"><div><h2>Related products</h2><div class="sub">You might also like</div></div></div>
      <div class="product-grid">${p.related.map(productCardHTML).join('')}</div>` : ''}
    </div>`;

    // gallery interactions
    const gMain = $('#gMain'), gImg = $('#gMainImg');
    gMain.addEventListener('mousemove', (e) => {
      if (!gMain.classList.contains('zoomed')) return;
      const r = gMain.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 100, y = ((e.clientY - r.top) / r.height) * 100;
      gImg.style.transformOrigin = `${x}% ${y}%`;
    });
    gMain.addEventListener('click', () => gMain.classList.toggle('zoomed'));
    $$('.gallery-thumbs button').forEach((b) => b.addEventListener('click', () => {
      $$('.gallery-thumbs button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active'); gImg.src = b.dataset.url;
    }));

    // qty
    const qty = $('#qtyInput');
    $('#qMinus').onclick = () => qty.value = Math.max(1, (+qty.value || 1) - 1);
    $('#qPlus').onclick = () => qty.value = Math.min(p.stock || 1, (+qty.value || 1) + 1);
    qty.onchange = () => { qty.value = Math.max(1, Math.min(p.stock || 1, +qty.value || 1)); };

    // actions
    $('#addToCartBtn').onclick = () => addToCart(p.id, +qty.value);
    $('#buyNowBtn').onclick = async () => {
      const ok = await addToCart(p.id, +qty.value, { quiet: true });
      if (!ok) return;
      if (!state.user) { toast('Please sign in to checkout.', 'info'); go('/login?next=%2Fcheckout'); }
      else go('/checkout');
    };
    const wishBtn = $('#wishBtn');
    wishBtn.onclick = () => toggleWishlist(p.id, wishBtn);

    // tabs
    $$('.tab-head button').forEach((b) => b.addEventListener('click', () => {
      $$('.tab-head button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const t = b.dataset.tab;
      ['desc', 'specs', 'reviews'].forEach((k) => { const el = $('#tab' + k[0].toUpperCase() + k.slice(1)); if (el) el.hidden = k !== t; });
    }));

    bindReviewForm(p.id);
    revealOnScroll();
  }

  function renderReviews(list) {
    if (!list || !list.length) return `<p class="muted">No reviews yet — be the first to review this product.</p>`;
    return list.map((r) => `
      <div class="review">
        <div class="avatar">${esc((r.reviewer || 'Anonymous')[0].toUpperCase())}</div>
        <div><div class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>
        <b>${esc(r.title || 'Verified purchase')}</b>
        <p>${esc(r.body)}</p>
        <div class="date">${esc(r.reviewer || 'Anonymous')} · ${timeAgo(r.created_at)}</div></div>
      </div>`).join('');
  }

  function reviewFormHTML(productId) {
    return `<div class="co-card" style="margin-bottom:0"><h3>Write a review</h3>
      <div class="field full"><label>Your rating</label><div id="rateStars" style="font-size:26px;color:#cbd5e1;cursor:pointer">★★★★★</div></div>
      <div class="field full"><label for="rvTitle">Title</label><input id="rvTitle" placeholder="Sum it up"></div>
      <div class="field full"><label for="rvBody">Review</label><textarea id="rvBody" rows="3" placeholder="What did you like or dislike?"></textarea></div>
      <button class="btn btn-primary mt2" id="submitReview" data-pid="${productId}">Submit review</button></div>`;
  }

  function bindReviewForm(productId) {
    const form = $('#submitReview');
    if (!form) return;
    let rating = 5;
    const stars = $('#rateStars');
    stars.addEventListener('click', (e) => {
      const rect = stars.getBoundingClientRect();
      rating = Math.ceil((e.clientX - rect.left) / rect.width * 5);
      renderStars();
    });
    function renderStars() { stars.innerHTML = '★★★★★'.split('').map((c, i) => `<span style="color:${i < rating ? '#ffb020' : '#cbd5e1'}">★</span>`).join(''); }
    renderStars();
    form.onclick = async () => {
      const body = $('#rvBody').value.trim(), title = $('#rvTitle').value.trim();
      if (!body) return toast('Please write a short review.', 'error');
      try {
        await api('/api/auth/reviews', { method: 'POST', body: { productId, rating, title, body } });
        toast('Thanks for your review!');
        initProduct(state.route.params.slug, true);
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  /* ============================================================
     CART
     ============================================================ */
  function pageCart() {
    return { key: '/cart', html: `<div class="container mt3"><h1 style="font-size:24px;font-weight:800;margin-bottom:18px">Shopping cart</h1><div class="cart-layout"><div class="cart-lines" id="cartLines"><div class="skeleton" style="height:120px;margin:16px"></div></div><div id="cartSummary"></div></div></div>`, init() { initCart(false); } };
  }

  async function initCart(silent) {
    const c = await refreshCart();
    renderCart(c);
  }

  function renderCart(c) {
    const lines = $('#cartLines'), sum = $('#cartSummary');
    if (!lines) return;
    if (!c) { if (lines) lines.innerHTML = emptyState('Your cart is empty', 'Browse the shop and add something you love.', `<a class="btn btn-primary" href="/shop" style="margin-top:14px">Start shopping</a>`); if (sum) sum.innerHTML = ''; return; }
    const items = c.items || [];
    if (!items.length && !(c.savedItems || []).length) {
      lines.innerHTML = emptyState('Your cart is empty', 'Browse the shop and add something you love.', `<a class="btn btn-primary" href="/shop" style="margin-top:14px">Start shopping</a>`);
      sum.innerHTML = ''; return;
    }
    lines.innerHTML = items.map((i) => `
      <div class="cart-line" data-id="${i.id}">
        <a href="/product/${esc(i.slug)}"><img src="${esc(i.image || '/images/favicon.svg')}" alt="${esc(i.name)}" onerror="this.src='/images/favicon.svg'"></a>
        <div class="cl-info">
          <a href="/product/${esc(i.slug)}" class="cl-name">${esc(i.name)}</a>
          <div class="cl-price">${fmt(i.unitPrice)} ${i.compareAtPrice > i.unitPrice || i.flashPrice ? `<span class="cl-old">${fmt(i.price)}</span>` : ''}</div>
          ${!i.available ? `<div style="color:var(--danger);font-size:12.5px;font-weight:700">Out of stock</div>` : ''}
          <div class="cl-controls">
            <div class="qty" style="height:38px"><button data-q="-1" aria-label="Decrease">−</button><input type="number" value="${i.qty}" min="1" max="${i.stock}" aria-label="Quantity"><button data-q="1" aria-label="Increase">+</button></div>
            <button class="cl-remove" data-remove="1">Remove</button>
            <button class="cl-save" data-save="1">Save for later</button>
          </div>
        </div>
        <div style="font-weight:800;color:var(--royal)">${fmt(i.lineTotal)}</div>
      </div>`).join('') || emptyState('Your cart is empty', 'Add products to get started.');

    if (c.savedItems && c.savedItems.length) {
      lines.innerHTML += `<div style="padding:14px 18px;font-weight:700;font-size:13.5px;color:var(--muted)">Saved for later</div>` + c.savedItems.map((i) => `
        <div class="cart-line" data-id="${i.id}" style="opacity:.8">
          <img src="${esc(i.image || '/images/favicon.svg')}" alt="${esc(i.name)}">
          <div class="cl-info"><div class="cl-name">${esc(i.name)}</div><div class="cl-price">${fmt(i.unitPrice)}</div>
          <div class="cl-controls"><button class="cl-save" data-save="1">Move to cart</button><button class="cl-remove" data-remove="1">Remove</button></div></div>
        </div>`).join('');
    }

    const shipping = state.config.shipping || { flatFee: 2500, freeThreshold: 100000 };
    const freeShip = c.subtotal >= shipping.freeThreshold;
    const delivery = freeShip ? 0 : shipping.flatFee;
    const discount = state.promo ? state.promo.discount : 0;
    const total = c.subtotal - discount + delivery;

    sum.innerHTML = `
      <div class="summary">
        <h3>Order summary</h3>
        <div class="promo-row"><input id="promoInput" placeholder="Promo code" value="${esc(state.promo ? state.promo.code : '')}"><button class="btn btn-outline btn-sm" id="applyPromo">Apply</button></div>
        ${state.promo ? `<div class="promo-applied">${esc(state.promo.code)} applied <button id="removePromo" style="color:var(--success);font-weight:800">✕</button></div>` : ''}
        <div class="sum-row"><span>Subtotal</span><span>${fmt(c.subtotal)}</span></div>
        <div class="sum-row"><span>Delivery</span><span>${delivery === 0 ? '<span class="discount">FREE</span>' : fmt(delivery)}</span></div>
        ${discount ? `<div class="sum-row"><span>Discount</span><span class="discount">−${fmt(discount)}</span></div>` : ''}
        <div class="sum-row total"><span>Total</span><span>${fmt(total)}</span></div>
        ${!freeShip && shipping.freeThreshold ? `<div class="free-ship-note">Add ${fmt(shipping.freeThreshold - c.subtotal)} more for free delivery 🚚</div>` : ''}
        ${!state.user
          ? `<a class="btn btn-gold btn-block btn-lg mt2" href="/login?next=%2Fcheckout" ${!items.length ? 'disabled' : ''}>Sign in to checkout →</a>`
          : `<a class="btn btn-gold btn-block btn-lg mt2" href="/checkout" ${!items.length ? 'disabled' : ''}>Proceed to checkout →</a>`}
        <a class="btn btn-ghost btn-block mt1" href="/shop">Continue shopping</a>
      </div>`;

    // events
    lines.querySelectorAll('.cart-line').forEach((row) => {
      const id = row.dataset.id;
      row.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', async () => {
        const input = row.querySelector('input');
        const cur = +input.value;
        const next = cur + +b.dataset.q;
        if (next < 1) return;
        try {
          await api('/api/cart/' + id, { method: 'PATCH', body: { qty: next } });
          renderCart(await refreshCart());
        } catch (e) { toast(e.message, 'error'); }
      }));
      row.querySelector('[data-remove]').addEventListener('click', async () => {
        if (await confirmDialog({ title: 'Remove item?', message: 'This will remove the item from your cart.', confirmText: 'Remove', danger: true })) {
          await api('/api/cart/' + id, { method: 'DELETE' }); const c2 = await refreshCart(); renderCart(c2);
        }
      });
      row.querySelector('[data-save]').addEventListener('click', async () => {
        await api('/api/cart/' + id + '/save-for-later', { method: 'POST' }); const c2 = await refreshCart(); renderCart(c2);
      });
    });

    const apply = $('#applyPromo');
    if (apply) apply.onclick = async () => {
      const code = $('#promoInput').value.trim();
      if (!code) return toast('Enter a promo code.', 'error');
      try {
        const promo = await api('/api/promo/validate', { method: 'POST', body: { code } });
        const discount = promo.type === 'percent' ? Math.round(c.subtotal * promo.value / 100) : promo.type === 'fixed' ? Math.min(promo.value, c.subtotal) : 0;
        state.promo = { code: promo.code, discount };
        renderCart(c);
        toast(promo.message);
      } catch (e) { toast(e.message, 'error'); }
    };
    const rm = $('#removePromo'); if (rm) rm.onclick = () => { state.promo = null; renderCart(c); };
  }

  /* ============================================================
     CHECKOUT
     ============================================================ */
  function pageCheckout() {
    return {
      key: '/checkout',
      html: `<div class="container mt3"><h1 style="font-size:24px;font-weight:800;margin-bottom:18px">Checkout</h1>
      <div class="checkout-layout">
        <div>
          <div class="co-card"><h3><span class="co-step">1</span> Customer information</h3>
            <div class="form-grid">
              <div class="field full"><label for="coName">Full name *</label><input id="coName" placeholder="e.g. Ada Obi"><div class="err">Required</div></div>
              <div class="field"><label for="coEmail">Email *</label><input id="coEmail" type="email" placeholder="you@email.com"><div class="err">Required</div></div>
              <div class="field"><label for="coPhone">Phone *</label><input id="coPhone" placeholder="+234…"><div class="err">Required</div></div>
            </div>
          </div>
          <div class="co-card"><h3><span class="co-step">2</span> Delivery address</h3>
            <div class="form-grid">
              <div class="field full"><label for="coLine1">Street address *</label><input id="coLine1" placeholder="House number & street"><div class="err">Required</div></div>
              <div class="field full"><label for="coLine2">Landmark / area (optional)</label><input id="coLine2" placeholder="e.g. Near the market"></div>
              <div class="field"><label for="coCity">City *</label><input id="coCity" placeholder="Lagos"><div class="err">Required</div></div>
              <div class="field"><label for="coState">State *</label><input id="coState" placeholder="Lagos"><div class="err">Required</div></div>
            </div>
            <div class="mt2" id="savedAddresses"></div>
          </div>
          <div class="co-card"><h3><span class="co-step">3</span> Delivery & payment</h3>
            <div class="field full"><label for="coMethod">Delivery method</label>
              <select id="coMethod"><option value="standard">Standard delivery</option><option value="express">Express delivery</option></select></div>
            <div id="payMethods" class="mt2"></div>
          </div>
        </div>
        <div id="coSummary"></div>
      </div></div>`,
      init() { initCheckout(false); }
    };
  }

  async function initCheckout(silent) {
    // Checkout requires a signed-in account.
    if (!state.user) {
      const layout = document.querySelector('.checkout-layout');
      if (layout) {
        layout.innerHTML = `<div class="co-card" style="text-align:center;padding:44px 26px">
          <div style="font-size:46px">🔐</div>
          <h2 style="margin-top:12px;font-size:22px">Sign in to checkout</h2>
          <p class="sub" style="max-width:360px;margin:8px auto 0">You need an account to place your order. Sign in or create an account to continue — your cart is saved.</p>
          <a class="btn btn-primary btn-block btn-lg mt3" href="/login?next=%2Fcheckout">Sign in</a>
          <a class="btn btn-outline btn-block mt1" href="/register?next=%2Fcheckout">Create an account</a>
          <a class="btn btn-ghost btn-block mt1" href="/shop">← Continue shopping</a>
        </div>`;
      }
      return;
    }
    const c = await refreshCart();
    if (!c || !c.items.length) {
      toast('Your cart is empty.', 'info');
      go('/shop'); return;
    }
    renderCheckoutSummary(c);
    renderPayMethods();
    // prefill
    if (state.user) {
      $('#coName').value = state.user.name || '';
      $('#coEmail').value = state.user.email || '';
      $('#coPhone').value = state.user.phone || '';
      try {
        const addrs = await api('/api/auth/addresses');
        if (addrs.length) {
          const d = addrs.find((a) => a.is_default) || addrs[0];
          $('#coLine1').value = d.line1; $('#coLine2').value = d.line2; $('#coCity').value = d.city; $('#coState').value = d.state;
          $('#coName').value = d.full_name || $('#coName').value; $('#coPhone').value = d.phone || $('#coPhone').value;
          $('#savedAddresses').innerHTML = `<div class="small muted">Using your saved address: ${esc(d.line1)}, ${esc(d.city)}, ${esc(d.state)}</div>`;
        }
      } catch { }
    }
    $('#placeOrderBtn').addEventListener('click', placeOrder);
  }

  function renderCheckoutSummary(c) {
    const shipping = state.config.shipping || { flatFee: 2500, freeThreshold: 100000 };
    const freeShip = c.subtotal >= shipping.freeThreshold;
    let delivery = freeShip ? 0 : shipping.flatFee;
    let discount = state.promo ? state.promo.discount : 0;
    if (state.promo && state.promo.code === 'FREESHIP') { discount = delivery; delivery = 0; }
    const total = c.subtotal - discount + delivery;
    const sum = $('#coSummary');
    if (!sum) return;
    sum.innerHTML = `
      <div class="summary"><h3>Order summary</h3>
        ${c.items.map((i) => `<div class="sum-row"><span>${esc(i.name)} × ${i.qty}</span><span>${fmt(i.lineTotal)}</span></div>`).join('')}
        <div class="sum-row"><span>Subtotal</span><span>${fmt(c.subtotal)}</span></div>
        <div class="sum-row"><span>Delivery</span><span id="sumDelivery">${delivery === 0 ? 'FREE' : fmt(delivery)}</span></div>
        ${discount ? `<div class="sum-row"><span>Discount</span><span class="discount">−${fmt(discount)}</span></div>` : ''}
        <div class="sum-row total"><span>Total</span><span id="sumTotal">${fmt(total)}</span></div>
        <button class="btn btn-gold btn-block btn-lg mt2" id="placeOrderBtn">Place order</button>
        <div class="small muted center mt1" style="font-size:12px">🔒 Your information is secure and encrypted</div>
      </div>`;
    // update on method change
    $('#coMethod').addEventListener('change', () => {
      const express = $('#coMethod').value === 'express';
      delivery = express ? (shipping.flatFee + 3000) : (freeShip ? 0 : shipping.flatFee);
      const t2 = c.subtotal - discount + delivery;
      $('#sumDelivery').textContent = delivery === 0 ? 'FREE' : fmt(delivery);
      $('#sumTotal').textContent = fmt(t2);
      state.checkoutDelivery = delivery;
    });
    $('#coMethod').dispatchEvent(new Event('change'));
  }

  function renderPayMethods() {
    const pm = state.config.paymentMethods || {};
    const opts = [
      ['card', '💳', 'Pay with card', 'Visa, Mastercard, Verve (via secure gateway)'],
      ['bankTransfer', '🏦', 'Bank transfer', 'Transfer to our account — details after order'],
      ['cashOnDelivery', '💵', 'Cash on delivery', 'Pay in cash when your order arrives'],
      ['mobileMoney', '📱', 'Mobile money', 'Opay, PalmPay, M-Pesa & more'],
      ['payOnDelivery', '🚚', 'Pay on delivery', 'Card or transfer at your door']
    ].filter(([k]) => pm[k]);
    const box = $('#payMethods');
    box.innerHTML = opts.map(([k, icon, title, sub], i) => `
      <label class="pay-option ${i === 0 ? 'selected' : ''}">
        <input type="radio" name="payMethod" value="${k}" ${i === 0 ? 'checked' : ''}>
        <div><div style="font-weight:700;font-size:14.5px">${icon} ${title}</div><div class="pi">${sub}</div></div>
      </label>`).join('');
    box.addEventListener('change', () => box.querySelectorAll('.pay-option').forEach((o) => o.classList.toggle('selected', o.querySelector('input').checked)));
  }

  function validateField(sel) {
    const f = $(sel).closest('.field');
    const ok = $(sel).value.trim().length > 0;
    f.classList.toggle('invalid', !ok);
    return ok;
  }

  async function placeOrder() {
    const btn = $('#placeOrderBtn');
    const req = ['coName', 'coEmail', 'coPhone', 'coLine1', 'coCity', 'coState'];
    let ok = true;
    req.forEach((id) => { if (!validateField('#' + id)) ok = false; });
    const email = $('#coEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('#coEmail').closest('.field').classList.add('invalid'); ok = false; }
    if (!ok) { toast('Please complete the highlighted fields.', 'error'); return; }

    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Placing order…';
    try {
      const paymentMethod = document.querySelector('input[name="payMethod"]:checked').value;
      const res = await api('/api/orders', {
        method: 'POST',
        body: {
          name: $('#coName').value.trim(), email, phone: $('#coPhone').value.trim(),
          address: { line1: $('#coLine1').value.trim(), line2: $('#coLine2').value.trim(), city: $('#coCity').value.trim(), state: $('#coState').value.trim() },
          paymentMethod, deliveryMethod: $('#coMethod').value, promoCode: state.promo ? state.promo.code : ''
        }
      });
      state.lastOrder = res.order; state.promo = null;
      await refreshCart();
      go('/order/' + res.order.id);
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Place order';
    }
  }

  /* ============================================================
     ORDER CONFIRMATION
     ============================================================ */
  function pageOrderConfirm() {
    return {
      key: '/order',
      html: `<div class="container mt3" id="confirmWrap"><div class="skeleton" style="height:220px"></div></div>`,
      init() {
        const m = location.pathname.match(/\/order\/(\d+)/);
        renderConfirmation(m ? m[1] : null);
      }
    };
  }

  async function renderConfirmation(orderId) {
    const wrap = $('#confirmWrap');
    let order = null;
    if (state.lastOrder && String(state.lastOrder.id) === String(orderId)) order = state.lastOrder;
    else {
      try { order = await api('/api/orders/' + orderId); } catch { }
    }
    if (!order) { wrap.innerHTML = emptyState('Order not found', 'This order may have been removed.'); return; }
    document.title = `Order ${order.order_number} confirmed — ${state.config.storeName}`;
    wrap.innerHTML = `
      <div class="confirm-hero">
        <div class="tick">${ICONS.badge.replace('width="22"', 'width="44"').replace('height="22"', 'height="44"')}</div>
        <h1>Order placed successfully! 🎉</h1>
        <p>Order <b>${esc(order.order_number)}</b> · ${esc(order.customer_name)}<br>We've sent a confirmation to ${esc(order.customer_email)}.</p>
      </div>
      <div class="checkout-layout mt3" style="grid-template-columns:1fr 380px">
        <div class="co-card">
          <h3>Order timeline</h3>
          <div class="order-timeline">${orderTimelineHTML(order)}</div>
          <h3 class="mt2">Items</h3>
          ${(order.items || []).map((i) => `<div class="sum-row"><span>${esc(i.name)} × ${i.qty}</span><span>${fmt(i.price * i.qty)}</span></div>`).join('')}
        </div>
        <div class="summary">
          <h3>Summary</h3>
          <div class="sum-row"><span>Subtotal</span><span>${fmt(order.subtotal)}</span></div>
          <div class="sum-row"><span>Delivery</span><span>${order.delivery_fee ? fmt(order.delivery_fee) : 'FREE'}</span></div>
          ${order.discount_amount ? `<div class="sum-row"><span>Discount</span><span class="discount">−${fmt(order.discount_amount)}</span></div>` : ''}
          <div class="sum-row total"><span>Total</span><span>${fmt(order.total)}</span></div>
          <div class="small muted mt1">Payment: ${esc(order.payment_method)} · Status: <span class="status-pill st-${esc(order.status)}">${esc(order.status)}</span></div>
          <a class="btn btn-primary btn-block mt2" href="/shop">Continue shopping</a>
          ${state.user ? `<a class="btn btn-ghost btn-block mt1" href="/account/orders/${order.id}">View in my orders</a>` : ''}
        </div>
      </div>`;
  }

  function orderTimelineHTML(order) {
    const steps = ['pending', 'processing', 'shipped', 'delivered'];
    const evs = order.events || [{ status: order.status, created_at: order.created_at, note: '' }];
    const idx = steps.indexOf(order.status);
    return steps.map((s, i) => {
      const found = evs.find((e) => e.status === s);
      const cls = i <= idx ? 'done' : '';
      return `<div class="ot-step ${cls} ${i === idx ? 'current' : ''}">
        <div class="ot-dot">${i < idx ? '✓' : (i === idx ? '•' : '')}</div>
        <div><b style="text-transform:capitalize">${s}</b>
        <div class="ot-date">${found ? dateFmt(found.created_at) : ''}</div>
        ${found && found.note ? `<div class="ot-note">${esc(found.note)}</div>` : ''}</div>
      </div>`;
    }).join('');
  }

  /* ============================================================
     ACCOUNT
     ============================================================ */
  function pageAccount() {
    const parts = location.pathname.split('/').filter(Boolean);
    const tab = parts[1] || 'overview';
    const orderId = parts[1] === 'orders' && parts[2] ? parts[2] : null;
    if (!state.user) {
      return {
        key: '/account',
        html: `<div class="container mt3"><div class="auth-wrap"><div class="auth-card center">
          <div style="font-size:44px">🔐</div><h1 style="margin-top:8px">Welcome to your account</h1>
          <p class="sub">Sign in to track orders, manage addresses, wishlist and more.</p>
          <a class="btn btn-primary btn-block btn-lg" href="/login?next=%23%2Faccount">Sign in</a>
          <a class="btn btn-outline btn-block mt1" href="/register">Create an account</a></div></div></div>`,
        init() { }
      };
    }
    return {
      key: '/account',
      html: accountShellHTML(tab, orderId),
      init() { initAccount(tab, orderId); }
    };
  }

  function accountShellHTML(tab, orderId) {
    if (orderId) tab = 'orders';
    const tabs = [
      ['overview', 'Overview', '👤'], ['orders', 'My orders', '📦'], ['addresses', 'Addresses', '📍'],
      ['wishlist', 'Wishlist', '❤️'], ['reviews', 'My reviews', '⭐'], ['security', 'Security', '🔒']
    ];
    return `<div class="container mt3"><div class="account-layout">
      <aside class="acct-nav">
        <div class="acct-head" style="padding:8px"><div class="avatar">${esc((state.user.name || '?')[0].toUpperCase())}</div><div><b>${esc(state.user.name)}</b><div class="small muted">${esc(state.user.email)}</div></div></div>
        ${tabs.map(([k, label, icon]) => `<a href="/account/${k === 'overview' ? '' : k}" class="${tab === k ? 'active' : ''}"><span>${icon}</span> ${label}</a>`).join('')}
        <a href="#" id="logoutLink" style="color:var(--danger)"><span>↪️</span> Sign out</a>
      </aside>
      <div id="acctContent"><div class="skeleton" style="height:200px"></div></div>
    </div></div>`;
  }

  async function initAccount(tab, orderId) {
    $('#logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });
    const box = $('#acctContent');
    if (orderId) { await renderOrderDetail(box, orderId); return; }
    if (tab === 'overview') await renderAccountOverview(box);
    else if (tab === 'orders') await renderOrders(box);
    else if (tab === 'addresses') await renderAddresses(box);
    else if (tab === 'wishlist') await renderWishlist(box);
    else if (tab === 'reviews') await renderMyReviews(box);
    else if (tab === 'security') renderSecurity(box);
  }

  async function renderAccountOverview(box) {
    try {
      const orders = await api('/api/orders');
      const stats = { total: orders.length, pending: orders.filter((o) => ['pending', 'processing'].includes(o.status)).length, delivered: orders.filter((o) => o.status === 'delivered').length };
      box.innerHTML = `
        ${state.user && state.user.role === 'admin' ? `<a class="acct-card admin-banner" href="${esc((state.config && state.config.adminRoute) || '/secure-admin-login')}" style="display:flex;align-items:center;gap:14px;background:var(--grad);color:#fff;margin-bottom:14px">
          <div style="font-size:28px">🛠️</div>
          <div style="flex:1"><b style="font-size:16px">Store admin</b><div class="small" style="opacity:.9">You are signed in as an administrator</div></div>
          <span class="btn btn-gold btn-sm">Open admin dashboard →</span></a>` : ''}
        <div class="acct-card"><h3 style="margin-bottom:16px">Hi ${esc(state.user.name.split(' ')[0])} 👋</h3>
          <div class="benefits" style="grid-template-columns:repeat(3,1fr)">
            <div class="benefit"><div class="bi">📦</div><div><b>${stats.total}</b><span>Total orders</span></div></div>
            <div class="benefit"><div class="bi">⏳</div><div><b>${stats.pending}</b><span>In progress</span></div></div>
            <div class="benefit"><div class="bi">✅</div><div><b>${stats.delivered}</b><span>Delivered</span></div></div>
          </div></div>
        <div class="acct-card mt2"><div class="between center-y"><h3 style="margin:0">Recent orders</h3><a href="/account/orders" style="color:var(--royal);font-weight:700;font-size:14px">View all →</a></div>
          ${orders.length ? orders.slice(0, 4).map(orderRowHTML).join('') : emptyState('No orders yet', 'Start shopping and your orders will appear here.')}</div>`;
    } catch (e) { box.innerHTML = emptyState('Something went wrong', e.message); }
  }

  function orderRowHTML(o) {
    return `<a class="order-row" href="/account/orders/${o.id}">
      <div class="thumb">${(o.items || []).slice(0, 3).map((i) => `<img src="${esc(i.image_url || '/images/favicon.svg')}" alt="${esc(i.name)}" onerror="this.src='/images/favicon.svg'">`).join('')}</div>
      <div class="or-info"><div class="or-num">${esc(o.order_number)}</div><div class="or-date">${dateFmt(o.created_at)}</div><span class="status-pill st-${esc(o.status)}">${esc(o.status)}</span></div>
      <div class="or-total">${fmt(o.total)}</div>
    </a>`;
  }

  async function renderOrders(box) {
    try {
      const orders = await api('/api/orders');
      box.innerHTML = `<div class="acct-card"><h3 style="margin-bottom:16px">My orders</h3>${orders.length ? orders.map(orderRowHTML).join('') : emptyState('No orders yet', 'Start shopping!')}</div>`;
    } catch (e) { box.innerHTML = emptyState('Something went wrong', e.message); }
  }

  async function renderOrderDetail(box, orderId) {
    try {
      const o = await api('/api/orders/' + orderId);
      document.title = `Order ${o.order_number} — ${state.config.storeName}`;
      box.innerHTML = `
        <div class="acct-card"><div class="between center-y wrap"><div><h3>Order ${esc(o.order_number)}</h3><div class="small muted">${dateFmt(o.created_at)}</div></div><span class="status-pill st-${esc(o.status)}">${esc(o.status)}</span></div>
          ${o.tracking_number ? `<div class="free-ship-note mt2">🚚 Tracking: <b>${esc(o.tracking_number)}</b>${o.tracking_carrier ? ' via ' + esc(o.tracking_carrier) : ''}</div>` : ''}
          <div class="order-timeline mt3">${orderTimelineHTML(o)}</div>
          <h3 class="mt2">Items</h3>
          ${(o.items || []).map((i) => `<div class="cart-line" style="padding:12px 0"><img src="${esc(i.image_url || '/images/favicon.svg')}" alt="${esc(i.name)}" style="width:64px;height:64px"><div class="cl-info"><div class="cl-name">${esc(i.name)}</div><div class="small muted">SKU: ${esc(i.sku)}</div></div><div><b>${fmt(i.price * i.qty)}</b><div class="small muted">× ${i.qty}</div></div></div>`).join('')}
          <div class="sum-row"><span>Subtotal</span><span>${fmt(o.subtotal)}</span></div>
          <div class="sum-row"><span>Delivery</span><span>${o.delivery_fee ? fmt(o.delivery_fee) : 'FREE'}</span></div>
          ${o.discount_amount ? `<div class="sum-row"><span>Discount</span><span class="discount">−${fmt(o.discount_amount)}</span></div>` : ''}
          <div class="sum-row total"><span>Total</span><span>${fmt(o.total)}</span></div>
          <h3 class="mt2">Delivery address</h3>
          <p class="small muted">${esc((o.shipping_address || {}).line1 || '')}, ${esc((o.shipping_address || {}).city || '')}, ${esc((o.shipping_address || {}).state || '')}</p>
          ${o.canCancel ? `<button class="btn btn-danger mt2" id="cancelOrder">Cancel order</button>` : ''}
          <a class="btn btn-ghost mt2" href="/account/orders">← Back to orders</a>
        </div>`;
      const c = $('#cancelOrder');
      if (c) c.onclick = async () => {
        if (await confirmDialog({ title: 'Cancel this order?', message: 'Stock will be restored and you can reorder anytime.', confirmText: 'Yes, cancel', danger: true })) {
          try { await api('/api/orders/' + orderId + '/cancel', { method: 'POST' }); toast('Order cancelled.'); renderOrderDetail(box, orderId); } catch (e) { toast(e.message, 'error'); }
        }
      };
    } catch (e) { box.innerHTML = emptyState('Order not found', ''); }
  }

  async function renderAddresses(box) {
    try {
      const addrs = await api('/api/auth/addresses');
      box.innerHTML = `<div class="acct-card"><div class="between center-y"><h3 style="margin:0">Saved addresses</h3><button class="btn btn-primary btn-sm" id="addAddr">+ Add address</button></div>
        <div class="mt2">${addrs.map((a) => `
          <div class="address-card"><b>${esc(a.full_name)}</b> <span class="small muted">${esc(a.label)}</span>
            ${a.is_default ? '<span class="default">Default</span>' : ''}
            <div class="small muted">${esc(a.line1)}${a.line2 ? ', ' + esc(a.line2) : ''}</div>
            <div class="small muted">${esc(a.city)}, ${esc(a.state)} · ${esc(a.phone)}</div>
            <div class="mt1"><button class="cl-save" data-del="${a.id}">Delete</button></div>
          </div>`).join('') || emptyState('No saved addresses', 'Add a delivery address for faster checkout.')}
        </div></div>`;
      $('#addAddr').onclick = () => showAddressForm(box, null, addrs);
      box.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        if (await confirmDialog({ title: 'Delete address?', confirmText: 'Delete', danger: true })) {
          await api('/api/auth/addresses/' + b.dataset.del, { method: 'DELETE' }); renderAddresses(box);
        }
      });
    } catch (e) { box.innerHTML = emptyState('Sign in required', ''); }
  }

  function showAddressForm(box, addr, all) {
    const a = addr || {};
    box.innerHTML = `<div class="acct-card"><h3>${addr ? 'Edit address' : 'Add address'}</h3>
      <div class="form-grid mt2">
        <div class="field"><label>Label</label><input id="aLab" value="${esc(a.label || 'Home')}"></div>
        <div class="field"><label>Full name *</label><input id="aName" value="${esc(a.full_name || '')}"></div>
        <div class="field"><label>Phone *</label><input id="aPhone" value="${esc(a.phone || '')}"></div>
        <div class="field"><label>Street *</label><input id="aLine1" value="${esc(a.line1 || '')}"></div>
        <div class="field"><label>Landmark</label><input id="aLine2" value="${esc(a.line2 || '')}"></div>
        <div class="field"><label>City *</label><input id="aCity" value="${esc(a.city || '')}"></div>
        <div class="field"><label>State *</label><input id="aState" value="${esc(a.state || '')}"></div>
        <div class="field center-y"><label style="flex-direction:row;gap:8px;display:flex;align-items:center"><input type="checkbox" id="aDefault" ${a.is_default ? 'checked' : ''} style="width:16px;height:16px"> Default</label></div>
      </div>
      <div class="mt2 flex gap"><button class="btn btn-primary" id="saveAddr">Save</button><button class="btn btn-ghost" id="cancelAddr">Cancel</button></div></div>`;
    $('#cancelAddr').onclick = () => renderAddresses(box);
    $('#saveAddr').onclick = async () => {
      const body = { label: $('#aLab').value, full_name: $('#aName').value, phone: $('#aPhone').value, line1: $('#aLine1').value, line2: $('#aLine2').value, city: $('#aCity').value, state: $('#aState').value, is_default: $('#aDefault').checked };
      if (!body.full_name || !body.phone || !body.line1 || !body.city || !body.state) return toast('Fill the required fields.', 'error');
      try {
        if (addr) await api('/api/auth/addresses/' + addr.id, { method: 'PUT', body });
        else await api('/api/auth/addresses', { method: 'POST', body });
        toast('Address saved.'); renderAddresses(box);
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  async function renderWishlist(box) {
    try {
      const w = await api('/api/wishlist');
      state.wishlistCount = w.items.length; updateBadges();
      box.innerHTML = `<div class="acct-card"><h3 style="margin-bottom:16px">My wishlist</h3>
        ${w.items.length ? `<div class="product-grid">${w.items.map((p) => productCardHTML({ ...p, id: p.product_id })).join('')}</div>` : emptyState('Your wishlist is empty', 'Tap the ♥ on any product to save it here.')}
        </div>`;
      box.querySelectorAll('[data-wish]').forEach((b) => b.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        await api('/api/wishlist/' + b.dataset.wish, { method: 'DELETE' });
        renderWishlist(box);
      });
    } catch (e) { box.innerHTML = emptyState('Sign in required', ''); }
  }

  async function renderMyReviews(box) {
    try {
      const r = await api('/api/auth/reviews/mine');
      box.innerHTML = `<div class="acct-card"><h3 style="margin-bottom:16px">My reviews</h3>
        ${r.length ? r.map((x) => `<div class="review"><div class="avatar">${esc((x.product_name || 'P')[0])}</div><div><div class="stars">${'★'.repeat(x.rating)}${'☆'.repeat(5 - x.rating)}</div><b>${esc(x.product_name || 'Product')}</b><p>${esc(x.body)}</p><div class="date">${timeAgo(x.created_at)}</div></div></div>`).join('') : emptyState('No reviews yet', 'Reviews you write will appear here.')}
        </div>`;
    } catch (e) { box.innerHTML = emptyState('Sign in required', ''); }
  }

  function renderSecurity(box) {
    box.innerHTML = `<div class="acct-card" style="max-width:440px"><h3>Change password</h3>
      <div class="form-grid mt2">
        <div class="field full"><label>Current password</label><input id="pwCur" type="password"></div>
        <div class="field full"><label>New password (8+ chars)</label><input id="pwNew" type="password"></div>
        <div class="field full"><label>Confirm new password</label><input id="pwNew2" type="password"></div>
      </div>
      <button class="btn btn-primary mt2" id="savePw">Update password</button></div>`;
    $('#savePw').onclick = async () => {
      const cur = $('#pwCur').value, next = $('#pwNew').value, next2 = $('#pwNew2').value;
      if (next !== next2) return toast('Passwords do not match.', 'error');
      try {
        await api('/api/auth/me/password', { method: 'PUT', body: { current: cur, next } });
        toast('Password updated. Please sign in again.');
        logout();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  function logout() {
    api('/api/auth/logout', { method: 'POST', noGuest: true }).catch(() => { });
    setToken(null); state.user = null; state.cart = { count: 0 };
    updateBadges(); connectSSE();
    go('/');
    toast('Signed out.', 'info');
  }

  /* ============================================================
     CONTACT
     ============================================================ */
  function pageContact() {
    return {
      key: '/contact',
      html: `<div class="container mt3">
        <h1 style="font-size:26px;font-weight:800">Contact & support</h1>
        <p class="muted">We're here to help — reach us any way you like.</p>
        <div class="checkout-layout mt3" style="grid-template-columns:1fr 360px">
          <div>
            <div class="co-card"><h3>Send us a message</h3>
              <div class="form-grid">
                <div class="field"><label for="ctName">Name *</label><input id="ctName"></div>
                <div class="field"><label for="ctEmail">Email *</label><input id="ctEmail" type="email"></div>
                <div class="field"><label for="ctPhone">Phone</label><input id="ctPhone"></div>
                <div class="field"><label for="ctSubject">Subject</label><input id="ctSubject"></div>
                <div class="field full"><label for="ctBody">Message *</label><textarea id="ctBody" rows="5"></textarea></div>
              </div>
              <button class="btn btn-primary mt2" id="sendContact">Send message</button>
            </div>
            <div class="co-card"><h3>Frequently asked questions</h3><div id="faqList"><div class="skeleton" style="height:80px"></div></div></div>
          </div>
          <div>
            <div class="summary">
              <h3>Get in touch</h3>
              <div class="sum-row"><span>📞 Phone</span><span id="ctPhoneVal">—</span></div>
              <div class="sum-row"><span>✉️ Email</span><span id="ctEmailVal">—</span></div>
              <div class="sum-row"><span>📍 Address</span><span id="ctAddrVal" style="text-align:right">—</span></div>
              <div class="sum-row"><span>🕒 Hours</span><span id="ctHoursVal">—</span></div>
              <a class="btn btn-whatsapp btn-block mt2" id="ctWa" target="_blank" rel="noopener">${ICONS.whatsapp} Chat on WhatsApp</a>
            </div>
          </div>
        </div>
      </div>`,
      init() {
        const c = state.config.contact || {};
        $('#ctPhoneVal').textContent = c.phone || '—'; $('#ctEmailVal').textContent = c.email || '—';
        $('#ctAddrVal').textContent = c.address || '—'; $('#ctHoursVal').textContent = c.hours || '—';
        const wa = c.whatsapp ? String(c.whatsapp).replace(/[^\d]/g, '') : '';
        $('#ctWa').href = 'https://wa.me/' + wa;
        $('#sendContact').onclick = async () => {
          const name = $('#ctName').value.trim(), email = $('#ctEmail').value.trim(), body = $('#ctBody').value.trim();
          if (!name || !email || !body) return toast('Please fill your name, email and message.', 'error');
          try {
            await api('/api/contact', { method: 'POST', body: { name, email, phone: $('#ctPhone').value, subject: $('#ctSubject').value, body } });
            toast('Message sent! We will get back to you shortly.');
            ['ctName', 'ctEmail', 'ctPhone', 'ctSubject', 'ctBody'].forEach((id) => { $('#' + id).value = ''; });
          } catch (e) { toast(e.message, 'error'); }
        };
        api('/api/faqs').then((faqs) => {
          $('#faqList').innerHTML = faqs.map((f, i) => `
            <details class="filter-group" ${i === 0 ? 'open' : ''}><summary>${esc(f.question)}</summary><div class="fg-body" style="padding-top:10px;font-size:14px;color:var(--charcoal)">${esc(f.answer)}</div></details>`).join('') || '<p class="muted">No FAQs yet.</p>';
        }).catch(() => { });
      }
    };
  }

  /* ============================================================
     AUTH PAGES
     ============================================================ */
  function pageAuth(mode) {
    const next = state.route.query.get('next') || '/account';
    const titles = { login: ['Welcome back', 'Sign in to your account'], register: ['Create your account', 'Join the Tob Daniel family'], forgot: ['Reset your password', 'We will email you a reset link'], reset: ['Set a new password', 'Choose a strong new password'] };
    const [title, sub] = titles[mode];
    const token = state.route.query.get('token') || '';
    return {
      key: '/' + mode,
      html: `<div class="container"><div class="auth-wrap"><div class="auth-card">
        <img src="/images/logo.svg" alt="Tob Daniel Business Enterprise" width="170" height="34" style="margin-bottom:18px">
        <h1>${title}</h1><p class="sub">${sub}</p>
        ${mode === 'login' ? `
          <div class="form-grid" style="grid-template-columns:1fr">
            <div class="field full"><label for="auEmail">Email</label><input id="auEmail" type="email" autocomplete="email"></div>
            <div class="field full"><label for="auPass">Password</label><input id="auPass" type="password" autocomplete="current-password"></div>
          </div>
          <div class="between center-y mt1"><a href="/forgot" style="color:var(--royal);font-weight:700;font-size:13px">Forgot password?</a></div>
          <button class="btn btn-primary btn-block btn-lg mt2" id="auSubmit">Sign in</button>
          <div class="auth-alt">New here? <a href="/register">Create an account</a></div>` : ''}
        ${mode === 'register' ? `
          <div class="form-grid" style="grid-template-columns:1fr">
            <div class="field full"><label for="auName">Full name</label><input id="auName" autocomplete="name"></div>
            <div class="field full"><label for="auEmail">Email</label><input id="auEmail" type="email" autocomplete="email"></div>
            <div class="field full"><label for="auPhone">Phone (optional)</label><input id="auPhone"></div>
            <div class="field full"><label for="auPass">Password (8+ characters)</label><input id="auPass" type="password" autocomplete="new-password"></div>
          </div>
          <button class="btn btn-primary btn-block btn-lg mt2" id="auSubmit">Create account</button>
          <div class="auth-alt">Already have an account? <a href="/login">Sign in</a></div>` : ''}
        ${mode === 'forgot' ? `
          <div class="field full"><label for="auEmail">Email</label><input id="auEmail" type="email"></div>
          <button class="btn btn-primary btn-block btn-lg mt2" id="auSubmit">Send reset link</button>
          <div class="auth-alt"><a href="/login">← Back to sign in</a></div>` : ''}
        ${mode === 'reset' ? `
          <div class="field full"><label for="auPass">New password</label><input id="auPass" type="password" autocomplete="new-password"></div>
          <div class="field full mt1"><label for="auPass2">Confirm password</label><input id="auPass2" type="password"></div>
          <button class="btn btn-primary btn-block btn-lg mt2" id="auSubmit">Reset password</button>` : ''}
      </div></div></div>`,
      init() {
        const btn = $('#auSubmit');
        btn.addEventListener('click', async () => {
          btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Please wait…';
          try {
            if (mode === 'login') {
              const res = await api('/api/auth/login', { method: 'POST', noGuest: true, body: { email: $('#auEmail').value, password: $('#auPass').value } });
              setToken(res.token); await loadUser(); connectSSE();
              toast('Welcome back, ' + res.user.name.split(' ')[0] + '!');
              go(next);
            } else if (mode === 'register') {
              const res = await api('/api/auth/register', { method: 'POST', noGuest: true, body: { name: $('#auName').value, email: $('#auEmail').value, phone: $('#auPhone').value, password: $('#auPass').value } });
              setToken(res.token); await loadUser(); connectSSE();
              toast('Account created — welcome!');
              go('/account');
            } else if (mode === 'forgot') {
              const res = await api('/api/auth/forgot', { method: 'POST', noGuest: true, body: { email: $('#auEmail').value } });
              toast(res.message, 'info');
              btn.disabled = false; btn.textContent = 'Send reset link';
            } else if (mode === 'reset') {
              if ($('#auPass').value !== $('#auPass2').value) { toast('Passwords do not match.', 'error'); btn.disabled = false; btn.textContent = 'Reset password'; return; }
              const res = await api('/api/auth/reset', { method: 'POST', noGuest: true, body: { token, password: $('#auPass').value } });
              toast(res.message);
              go('/login');
            }
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false; btn.textContent = { login: 'Sign in', register: 'Create account', forgot: 'Send reset link', reset: 'Reset password' }[mode];
          }
        });
        const pass = $('#auPass');
        if (pass) pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
      }
    };
  }

  /* ============================================================
     404
     ============================================================ */
  function pageNotFound() {
    return { key: '/404', html: `<div class="container mt4">${emptyState('Page not found', 'The page you are looking for does not exist.', `<a class="btn btn-primary" href="/" style="margin-top:14px">Go home</a>`)}</div>`, init() { } };
  }

  /* ============================================================
     REVEAL ON SCROLL
     ============================================================ */
  function revealOnScroll() {
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.08 });
    $$('#app .product-card, #app .benefit, #app .cat-card, #app .testi, #app .section-head').forEach((el) => {
      if (!el.classList.contains('reveal')) { el.classList.add('reveal'); io.observe(el); }
    });
  }

  // Surface any unexpected error instead of failing silently.
  window.addEventListener('error', (e) => { try { console.error('[storefront]', e.message); } catch { } });
  window.addEventListener('unhandledrejection', (e) => { try { console.error('[storefront]', e.reason && e.reason.message); } catch { } });

  boot().catch((err) => {
    console.error('[storefront] boot failed:', err);
    try {
      if ($app && !$app.innerHTML.trim()) {
        $app.innerHTML = `<div class="container mt4">${emptyState('We hit a snag', 'The store could not start. Please refresh the page to try again.', '<button class="btn btn-primary" style="margin-top:14px" onclick="location.reload()">Refresh</button>')}</div>`;
      }
    } catch { }
  });
})();
