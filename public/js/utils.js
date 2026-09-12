/* Shared helpers for storefront + admin: API client, formatting, UI primitives. */
(function () {
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmt = (n, cur) => {
    const c = cur || 'NGN';
    try {
      return new Intl.NumberFormat('en-NG', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(Number(n) || 0);
    } catch {
      return '₦' + (Number(n) || 0).toLocaleString();
    }
  };
  const num = (n) => Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 });
  const pctOff = (price, compare) => (price && compare && compare > price) ? Math.round((1 - price / compare) * 100) : 0;

  const timeAgo = (iso) => {
    if (!iso) return '';
    const t = new Date(String(iso).replace(' ', 'T') + (String(iso).includes('Z') ? '' : 'Z')).getTime();
    if (isNaN(t)) return '';
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
    return new Date(t).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const dateFmt = (iso) => {
    const t = new Date(String(iso).replace(' ', 'T') + 'Z');
    return isNaN(t) ? (iso || '') : t.toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* ---------- safe storage (works in sandboxed iframes & private mode) ---------- */
  const store = (() => {
    const mem = {};
    let canUse = false;
    try {
      const k = '__td_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      canUse = true;
    } catch { canUse = false; }
    return {
      get(k) {
        if (canUse) { try { return window.localStorage.getItem(k); } catch { /* fall through */ } }
        return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
      },
      set(k, v) {
        if (canUse) { try { window.localStorage.setItem(k, String(v)); return; } catch { /* fall through */ } }
        mem[k] = String(v);
      },
      remove(k) {
        if (canUse) { try { window.localStorage.removeItem(k); return; } catch { /* fall through */ } }
        delete mem[k];
      },
      jsonGet(k, dflt) {
        try { const v = this.get(k); return v == null ? (dflt === undefined ? null : dflt) : JSON.parse(v); }
        catch { return dflt === undefined ? null : dflt; }
      },
      jsonSet(k, v) { this.set(k, JSON.stringify(v)); }
    };
  })();

  /* ---------- tokens ---------- */
  const tokenKey = 'td_token';
  const getToken = () => store.get(tokenKey) || '';
  const setToken = (t) => { if (t) store.set(tokenKey, t); else store.remove(tokenKey); };
  const guestKey = 'td_guest';
  const guestId = () => { let g = store.get(guestKey); if (!g) { g = 'g' + Math.random().toString(36).slice(2) + Date.now().toString(36); store.set(guestKey, g); } return g; };

  /* ---------- API client ---------- */
  async function api(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const headers = { ...(opts.headers || {}) };
    if (getToken()) headers['Authorization'] = 'Bearer ' + getToken();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers['X-Requested-With'] = 'XMLHttpRequest';
    let body = opts.body;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    if (!opts.noGuest) headers['X-Guest-Id'] = guestId();
    const token = getToken();
    let res;
    try {
      res = await fetch(path, { method, headers, body });
    } catch (e) {
      throw new Error('Network error — please check your connection.');
    }
    // Fallback: if the Authorization header was stripped by a sandboxed proxy,
    // retry once with the token in the URL so the request still authenticates.
    if (res.status === 401 && token && !(body instanceof FormData)) {
      const sep = path.includes('?') ? '&' : '?';
      try {
        res = await fetch(path + sep + 'td_token=' + encodeURIComponent(token), { method, headers, body });
      } catch { /* keep the original 401 below */ }
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await res.json();
    else data = await res.text();
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Something went wrong. Please try again.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ---------- toast ---------- */
  function toast(msg, type = 'success', timeout = 3400) {
    const wrap = $('#toasts');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (type === 'error' ? 'error' : type === 'info' ? 'info' : '');
    const icons = { success: '✓', error: '✕', info: 'i' };
    el.innerHTML = `<span class="t-ico">${icons[type] || '✓'}</span><span>${esc(msg)}</span>`;
    wrap.appendChild(el);
    setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 300); }, timeout);
  }

  /* ---------- confirm modal ---------- */
  function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      const root = $('#modalRoot');
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <h3>${esc(title)}</h3><p>${esc(message)}</p>
          <div class="modal-actions">
            <button class="btn btn-ghost" data-x="no">Cancel</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-x="yes">${esc(confirmText)}</button>
          </div>
        </div>`;
      wrap.addEventListener('click', (e) => {
        const v = e.target.dataset && e.target.dataset.x;
        if (v === 'yes') { cleanup(); resolve(true); }
        else if (v === 'no' || e.target === wrap) { cleanup(); resolve(false); }
      });
      function cleanup() { wrap.remove(); document.removeEventListener('keydown', onKey); }
      function onKey(e) { if (e.key === 'Escape') { cleanup(); resolve(false); } if (e.key === 'Enter') { cleanup(); resolve(true); } }
      document.addEventListener('keydown', onKey);
      root.appendChild(wrap);
      wrap.querySelector('[data-x="yes"]').focus();
    });
  }

  /* ---------- icons ---------- */
  const ICONS = {
    cart: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/><path d="M3 3h2.4l2.4 12.4a1.5 1.5 0 0 0 1.5 1.2h7.9a1.5 1.5 0 0 0 1.5-1.2L21 7H6"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7.5-4.6-10-9.3C.4 7.9 2.6 4 6.2 4c2.2 0 3.7 1.1 4.8 2.7C12.1 5.1 13.6 4 15.8 4c3.6 0 5.8 3.9 4.2 7.7C17.5 16.4 12 21 12 21z"/></svg>',
    heartFill: '<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M12 21s-7.5-4.6-10-9.3C.4 7.9 2.6 4 6.2 4c2.2 0 3.7 1.1 4.8 2.7C12.1 5.1 13.6 4 15.8 4c3.6 0 5.8 3.9 4.2 7.7C17.5 16.4 12 21 12 21z"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    truck: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/></svg>',
    shield: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/></svg>',
    badge: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-2.5L17 22l-1.5-8"/></svg>',
    headset: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="7" rx="1.6"/><rect x="17" y="13" width="4" height="7" rx="1.6"/><path d="M20 20a2 2 0 0 1-2 2h-3"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.6-6.1c-.3-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1-.2.3-.7.8-.8 1-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-2-1.2 7.4 7.4 0 0 1-1.4-1.7c-.1-.3 0-.4.1-.5l.4-.5c.1-.2.2-.3.3-.5s0-.4 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1.1 2.7c.1.2 1.8 2.8 4.4 3.9.6.3 1.1.4 1.5.6.6.2 1.2.2 1.6.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.3z"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2.5 15 9l7 .7-5.2 4.7 1.5 6.9L12 17.9 5.7 21.3l1.5-6.9L2 9.7 9 9z"/></svg>',
    empty: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    box: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>'
  };

  function starsHTML(rating, size = 14) {
    const r = Math.round(Number(rating) || 0);
    let out = '';
    for (let i = 1; i <= 5; i++) {
      out += `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${i <= r ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" style="color:${i <= r ? '#ffb020' : '#cbd5e1'}"><path d="M12 2.5 15 9l7 .7-5.2 4.7 1.5 6.9L12 17.9 5.7 21.3l1.5-6.9L2 9.7 9 9z"/></svg>`;
    }
    return out;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  function skeletonCard() {
    return `<div class="sk-card"><div class="skeleton"></div><div class="sk-lines"><div class="skeleton" style="height:12px"></div><div class="skeleton" style="height:12px;width:60%"></div><div class="skeleton" style="height:16px;width:40%"></div></div></div>`;
  }
  function skeletonGrid(n = 4) {
    return `<div class="product-grid">${Array(n).fill(0).map(skeletonCard).join('')}</div>`;
  }

  function emptyState(title, sub, cta) {
    return `<div class="empty"><div class="ei">${ICONS.box}</div><h3>${esc(title)}</h3><p>${esc(sub || '')}</p>${cta || ''}</div>`;
  }

  window.TD = { $, $$, esc, fmt, num, pctOff, timeAgo, dateFmt, debounce, store, getToken, setToken, guestId, api, toast, confirmDialog, ICONS, starsHTML, sleep, slugify, skeletonCard, skeletonGrid, emptyState };
})();
