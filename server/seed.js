/**
 * Seed the database with sample data for testing.
 *   node server/seed.js            → seeds only if empty
 *   node server/seed.js --reset    → wipes all data and reseeds
 */
const { db } = require('./db');
const auth = require('./auth');
const { setSetting } = require('./settings');

const RESET = process.argv.includes('--reset');

if (RESET) {
  console.log('Resetting database…');
  db.exec(`
    DELETE FROM audit_logs; DELETE FROM notifications; DELETE FROM messages;
    DELETE FROM subscribers; DELETE FROM faqs; DELETE FROM testimonials;
    DELETE FROM banners; DELETE FROM flash_sale_items; DELETE FROM flash_sales;
    DELETE FROM promo_codes; DELETE FROM reviews; DELETE FROM payments;
    DELETE FROM order_events; DELETE FROM order_items; DELETE FROM orders;
    DELETE FROM wishlists; DELETE FROM carts; DELETE FROM product_specs;
    DELETE FROM product_images; DELETE FROM products; DELETE FROM categories;
    DELETE FROM addresses; DELETE FROM password_resets; DELETE FROM login_attempts;
    DELETE FROM sessions; DELETE FROM users; DELETE FROM settings;
  `);
}

const existing = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
if (existing > 0) {
  console.log('Database already seeded. Use --reset to re-seed from scratch.');
  process.exit(0);
}

console.log('Seeding database…');

// ---------- settings -----------------------------------------------------------
setSetting('storeName', 'Tob Daniel Business Enterprise');
setSetting('slogan', 'Quality Products. Trusted Service. Delivered With Excellence.');
setSetting('tagline', 'Nigeria’s trusted online marketplace for electronics, fashion, beauty and home essentials — delivered to your door.');
setSetting('announcement', '🚚 Free delivery on orders above ₦100,000 — nationwide. Pay on delivery available.');
setSetting('contact', {
  phone: '+234 800 123 4567',
  whatsapp: '+2348001234567',
  email: 'hello@tobdaniel.ng',
  address: '12 Admiralty Way, Lekki Phase 1, Lagos, Nigeria',
  hours: 'Mon – Sat: 8:00am – 6:00pm'
});
setSetting('social', {
  facebook: 'https://facebook.com/tobdaniel',
  instagram: 'https://instagram.com/tobdaniel',
  twitter: 'https://x.com/tobdaniel',
  whatsapp: 'https://wa.me/2348001234567'
});
setSetting('shipping', { flatFee: 2500, freeThreshold: 100000, sameCityFee: 1500 });
setSetting('paymentMethods', { card: true, bankTransfer: true, cashOnDelivery: true, mobileMoney: true, payOnDelivery: true });
setSetting('admin2fa', false);
setSetting('maintenance', false);

// ---------- users ----------------------------------------------------------------
const adminId = db.prepare(
  `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'admin')`
).run('Tob Daniel', 'admin@tobdaniel.ng', '+234 800 123 4567', auth.hashPassword('Admin@2026!')).lastInsertRowid;

const demoId = db.prepare(
  `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'customer')`
).run('Demo Customer', 'demo@tobdaniel.ng', '+234 801 234 5678', auth.hashPassword('Demo@1234')).lastInsertRowid;

db.prepare('INSERT INTO addresses (user_id, label, full_name, phone, line1, city, state, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
  .run(demoId, 'Home', 'Demo Customer', '+234 801 234 5678', '14 Adeola Odeku Street, Victoria Island', 'Lagos', 'Lagos');

// ---------- categories ------------------------------------------------------------
const cat = {};
const catDefs = [
  ['phones-tablets', 'Phones & Tablets', null, 1],
  ['computers', 'Computers & Laptops', null, 2],
  ['audio', 'Audio & Wearables', null, 3],
  ['tv-entertainment', 'TV & Home Entertainment', null, 4],
  ['fashion', 'Fashion', null, 5],
  ['beauty', 'Beauty & Health', null, 6],
  ['home-kitchen', 'Home & Kitchen', null, 7],
  ['cameras', 'Cameras & Accessories', null, 8]
];
for (const [slug, name, parent, sort] of catDefs) {
  cat[slug] = db.prepare('INSERT INTO categories (name, slug, parent_id, sort_order) VALUES (?, ?, ?, ?)')
    .run(name, slug, parent, sort).lastInsertRowid;
}

// ---------- products ----------------------------------------------------------------
function addProduct(p) {
  const id = db.prepare(
    `INSERT INTO products (name, slug, sku, category_id, brand, description, short_desc, price, compare_at_price, stock,
       is_active, is_featured, is_best_seller, is_new, video_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(p.name, p.slug, p.sku, p.category, p.brand, p.description, p.short, p.price, p.compare, p.stock,
        1, p.featured ? 1 : 0, p.best ? 1 : 0, p.new ? 1 : 0, p.video || '').lastInsertRowid;
  db.prepare('INSERT INTO product_images (product_id, url, position, is_primary) VALUES (?, ?, 0, 1)')
    .run(id, `/images/products/${p.img}.jpg`);
  if (p.gallery) {
    p.gallery.filter((g) => g !== p.img).slice(0, 7).forEach((g, i) => db.prepare('INSERT INTO product_images (product_id, url, position, is_primary) VALUES (?, ?, ?, 0)')
      .run(id, `/images/products/${g}.jpg`, i + 1));
  }
  (p.specs || []).forEach(([label, value], i) => {
    db.prepare('INSERT INTO product_specs (product_id, label, value, position) VALUES (?, ?, ?, ?)').run(id, label, value, i);
  });
  return id;
}

const productIds = {};
productIds.p01 = addProduct({
  name: 'Nova X1 Pro 5G Smartphone 6.7" 256GB', slug: 'nova-x1-pro-5g-smartphone', sku: 'NT-X1PRO-256',
  category: cat['phones-tablets'], brand: 'NovaTech', img: 'p01', gallery: ['p01'],
  price: 485000, compare: 545000, stock: 24, featured: true, best: true,
  short: 'Flagship 6.7" AMOLED display, 256GB storage and a 108MP triple camera.',
  description: 'The Nova X1 Pro is our flagship performer: a stunning 6.7-inch AMOLED display with 120Hz refresh, a blazing-fast octa-core chipset, 8GB RAM and 256GB of storage. The 108MP triple camera captures crisp, vibrant photos even in low light, while the 5000mAh battery with 65W fast charge keeps you going all day.',
  specs: [['Display', '6.7" AMOLED, 120Hz'], ['Storage', '256GB'], ['RAM', '8GB'], ['Camera', '108MP + 12MP + 5MP'], ['Battery', '5000mAh, 65W fast charge'], ['OS', 'Android 14'], ['Warranty', '12 months']]
});
productIds.p02 = addProduct({
  name: 'Aura S2 Smartphone 6.5" 128GB', slug: 'aura-s2-smartphone', sku: 'AU-S2-128',
  category: cat['phones-tablets'], brand: 'Aura Mobile', img: 'p02', gallery: ['p02'],
  price: 218000, compare: 245000, stock: 40, new: true,
  short: 'Big 6.5" display, 128GB storage and a 50MP AI camera at an unbeatable price.',
  description: 'Aura S2 delivers flagship essentials for less: a vivid 6.5-inch display, 128GB storage, dual SIM, a 50MP AI camera and a long-lasting 5000mAh battery. Perfect for everyday use, streaming and photography on the go.',
  specs: [['Display', '6.5" IPS, 90Hz'], ['Storage', '128GB'], ['RAM', '6GB'], ['Camera', '50MP + 2MP'], ['Battery', '5000mAh'], ['Warranty', '12 months']]
});
productIds.p06 = addProduct({
  name: 'SwiftBook Air 14 Ultrabook 512GB SSD', slug: 'swiftbook-air-14-ultrabook', sku: 'SW-AIR14-512',
  category: cat['computers'], brand: 'SwiftBook', img: 'p06', gallery: ['p06'],
  price: 745000, compare: 810000, stock: 12, featured: true, best: true,
  short: 'Ultra-light 14" laptop with 16GB RAM, 512GB SSD and all-day battery.',
  description: 'The SwiftBook Air 14 weighs just 1.2kg yet packs serious power: a 14-inch 2.5K display, 16GB RAM, 512GB NVMe SSD, and up to 18 hours of battery life. Ideal for professionals, students and creators who need performance anywhere.',
  specs: [['Display', '14" 2.5K IPS'], ['Processor', 'Octa-core, up to 4.4GHz'], ['RAM', '16GB'], ['Storage', '512GB NVMe SSD'], ['Battery', 'Up to 18 hours'], ['Weight', '1.2kg'], ['Warranty', '24 months']]
});
productIds.p03 = addProduct({
  name: 'Nova AirBuds Pro True Wireless Earbuds', slug: 'nova-airbuds-pro-earbuds', sku: 'NT-ABP-01',
  category: cat['audio'], brand: 'NovaTech', img: 'p03', gallery: ['p03'],
  price: 38500, compare: 52000, stock: 120, featured: true,
  short: 'Active noise cancelling, 30-hour battery and wireless charging case.',
  description: 'Nova AirBuds Pro bring studio-quality sound to your pocket. Active noise cancellation, transparency mode, touch controls and a compact case with wireless charging. Up to 30 hours of total playtime.',
  specs: [['Type', 'True wireless in-ear'], ['ANC', 'Active noise cancelling'], ['Battery', '30 hours with case'], ['Water resistance', 'IPX5'], ['Bluetooth', '5.3'], ['Warranty', '12 months']]
});
productIds.p04 = addProduct({
  name: 'Bassline Studio Over-Ear Headphones', slug: 'bassline-studio-over-ear-headphones', sku: 'BL-ST-01',
  category: cat['audio'], brand: 'Bassline', img: 'p04', gallery: ['p04'],
  price: 64000, compare: 82000, stock: 60, best: true,
  short: 'Deep bass, plush memory-foam earcups and 40-hour battery life.',
  description: 'Bassline Studio headphones deliver powerful, balanced sound with deep bass. Memory-foam earcups and a lightweight frame keep you comfortable for hours. 40-hour battery, quick charge, and dual-device pairing.',
  specs: [['Driver', '40mm dynamic'], ['Battery', '40 hours'], ['Connection', 'Bluetooth 5.2 + AUX'], ['Weight', '260g'], ['Warranty', '12 months']]
});
productIds.p05 = addProduct({
  name: 'Pulse Smartwatch Series 8', slug: 'pulse-smartwatch-series-8', sku: 'PU-SW8-01',
  category: cat['audio'], brand: 'Pulse', img: 'p05', gallery: ['p05'],
  price: 92000, compare: 115000, stock: 35, new: true,
  short: 'AMOLED display, heart-rate & SpO2 tracking, 10-day battery.',
  description: 'Track your health and stay connected with the Pulse Smartwatch Series 8. Bright AMOLED display, heart-rate and SpO2 monitoring, 100+ sport modes, and a 10-day battery. Works with Android and iOS.',
  specs: [['Display', '1.43" AMOLED'], ['Battery', '10 days'], ['Sensors', 'Heart rate, SpO2, GPS'], ['Water resistance', '5ATM'], ['Compatibility', 'Android & iOS'], ['Warranty', '12 months']]
});
productIds.p08 = addProduct({
  name: 'Pulse Portable Bluetooth Speaker', slug: 'pulse-portable-bluetooth-speaker', sku: 'PU-BS-01',
  category: cat['audio'], brand: 'Pulse', img: 'p08', gallery: ['p08'],
  price: 45000, compare: 55000, stock: 75, new: true,
  short: '360° sound, IPX7 waterproof and 24-hour playtime.',
  description: 'Take the party anywhere with the Pulse Portable Speaker. 360° room-filling sound, deep bass radiators, IPX7 waterproofing and a 24-hour battery. Pairs instantly and supports stereo pairing of two units.',
  specs: [['Output', '30W, 360° sound'], ['Battery', '24 hours'], ['Waterproof', 'IPX7'], ['Bluetooth', '5.3'], ['Warranty', '12 months']]
});
productIds.p17 = addProduct({
  name: 'SoundMax 2.1 Channel Soundbar', slug: 'soundmax-21-channel-soundbar', sku: 'SM-SB21-01',
  category: cat['audio'], brand: 'SoundMax', img: 'p17', gallery: ['p17'],
  price: 128000, compare: 150000, stock: 18,
  short: 'Cinematic 2.1 sound with wireless subwoofer and HDMI ARC.',
  description: 'Upgrade your TV audio with the SoundMax 2.1 soundbar. A dedicated wireless subwoofer delivers thunderous bass, while HDMI ARC, optical and Bluetooth inputs make setup effortless. Includes a slim remote.',
  specs: [['Channels', '2.1 with wireless sub'], ['Total power', '240W'], ['Inputs', 'HDMI ARC, Optical, Bluetooth'], ['Dolby', 'Dolby Audio'], ['Warranty', '12 months']]
});
productIds.p07 = addProduct({
  name: 'CrystalView 55" 4K UHD Smart TV', slug: 'crystalview-55-4k-uhd-smart-tv', sku: 'CV-55UHD-01',
  category: cat['tv-entertainment'], brand: 'CrystalView', img: 'p07', gallery: ['p07'],
  price: 685000, compare: 760000, stock: 8, featured: true,
  short: '55" 4K UHD with HDR10+, built-in streaming apps and voice remote.',
  description: 'The CrystalView 55" brings the cinema home. 4K UHD resolution with HDR10+ and Dolby Vision, a slim bezel-less design, and all your favourite streaming apps built in. Voice remote and three HDMI ports included.',
  specs: [['Screen', '55" 4K UHD'], ['HDR', 'HDR10+, Dolby Vision'], ['HDMI', '3 ports'], ['Smart OS', 'Built-in streaming apps'], ['Sound', '20W speakers'], ['Warranty', '24 months']]
});
productIds.p09 = addProduct({
  name: 'Stride Air Running Sneakers', slug: 'stride-air-running-sneakers', sku: 'ST-AIR-01',
  category: cat['fashion'], brand: 'Stride', img: 'p09', gallery: ['p09'],
  price: 54000, compare: 68000, stock: 50, best: true,
  short: 'Feather-light knit upper with responsive Air cushioning.',
  description: 'Stride Air running sneakers combine a breathable knit upper with responsive cushioning for all-day comfort. The grippy outsole keeps you stable on any surface. Available in UK sizes 40–46.',
  specs: [['Upper', 'Engineered knit'], ['Cushioning', 'Air-responsive midsole'], ['Outsole', 'High-grip rubber'], ['Sizes', 'UK 40–46'], ['Warranty', '6 months']]
});
productIds.p10 = addProduct({
  name: 'Milano Leather Handbag', slug: 'milano-leather-handbag', sku: 'ML-HB-01',
  category: cat['fashion'], brand: 'Milano', img: 'p10', gallery: ['p10'],
  price: 86000, compare: 110000, stock: 20, new: true,
  short: 'Premium tan leather with gold hardware and detachable strap.',
  description: 'The Milano handbag is crafted from premium leather with gold-tone hardware. A spacious interior with zip and slip pockets keeps you organised, while the detachable strap lets you wear it two ways.',
  specs: [['Material', 'Premium leather'], ['Hardware', 'Gold-tone'], ['Dimensions', '30 × 22 × 12cm'], ['Straps', 'Hand + detachable shoulder'], ['Warranty', '6 months']]
});
productIds.p11 = addProduct({
  name: 'Regal Heritage Wristwatch', slug: 'regal-heritage-wristwatch', sku: 'RG-HW-01',
  category: cat['fashion'], brand: 'Regal', img: 'p11', gallery: ['p11'],
  price: 145000, compare: 175000, stock: 15, featured: true,
  short: 'Stainless steel case, deep blue dial and genuine leather strap.',
  description: 'The Regal Heritage pairs a polished stainless-steel case with a rich blue dial and a genuine leather strap. Water-resistant to 5ATM with Japanese quartz movement — timeless style for every occasion.',
  specs: [['Movement', 'Japanese quartz'], ['Case', 'Stainless steel, 42mm'], ['Strap', 'Genuine leather'], ['Water resistance', '5ATM'], ['Warranty', '24 months']]
});
productIds.p18 = addProduct({
  name: 'Voyager Canvas Backpack', slug: 'voyager-canvas-backpack', sku: 'VG-BP-01',
  category: cat['fashion'], brand: 'Voyager', img: 'p18', gallery: ['p18'],
  price: 38000, compare: 45000, stock: 45,
  short: 'Water-resistant canvas with a padded 15.6" laptop compartment.',
  description: 'The Voyager backpack blends style with utility: water-resistant canvas, a padded 15.6" laptop sleeve, anti-theft rear pocket and ergonomic straps. Built for campus, commute and travel.',
  specs: [['Material', 'Water-resistant canvas'], ['Capacity', '28L'], ['Laptop sleeve', 'Up to 15.6"'], ['Pockets', '6 compartments'], ['Warranty', '6 months']]
});
productIds.p19 = addProduct({
  name: 'Aura Polarized Sunglasses', slug: 'aura-polarized-sunglasses', sku: 'AU-PS-01',
  category: cat['fashion'], brand: 'Aura', img: 'p19', gallery: ['p19'],
  price: 26000, compare: 34000, stock: 60,
  short: 'UV400 polarized lenses in a matte black frame.',
  description: 'Aura polarized sunglasses cut glare and protect your eyes with UV400 lenses. The matte black frame is lightweight and durable, with a premium case and cleaning cloth included.',
  specs: [['Lens', 'Polarized UV400'], ['Frame', 'Matte black'], ['Weight', '24g'], ['Included', 'Case + cloth'], ['Warranty', '6 months']]
});
productIds.p12 = addProduct({
  name: 'Élan Noir Eau de Parfum 100ml', slug: 'elan-noir-eau-de-parfum', sku: 'EN-EDP-100',
  category: cat['beauty'], brand: 'Élan', img: 'p12', gallery: ['p12'],
  price: 58000, compare: 72000, stock: 30, featured: true,
  short: 'Warm amber and oud with a long-lasting signature finish.',
  description: 'Élan Noir is an unforgettable blend of warm amber, oud and soft spice. A single spray lasts all day, making it the perfect signature scent for evenings and special occasions.',
  specs: [['Size', '100ml'], ['Fragrance family', 'Amber, Oud'], ['Longevity', '8–12 hours'], ['Type', 'Eau de Parfum'], ['Warranty', 'N/A']]
});
productIds.p13 = addProduct({
  name: 'GlowLab Skincare Trio Set', slug: 'glowlab-skincare-trio-set', sku: 'GL-ST-01',
  category: cat['beauty'], brand: 'GlowLab', img: 'p13', gallery: ['p13'],
  price: 42000, compare: 54000, stock: 25, new: true,
  short: 'Cleanser, serum and moisturiser for radiant, healthy skin.',
  description: 'GlowLab’s complete three-step routine: a gentle foaming cleanser, a brightening vitamin-C serum and a hydrating moisturiser. Dermatologist tested, suitable for all skin types.',
  specs: [['Includes', 'Cleanser 150ml + Serum 30ml + Moisturiser 100ml'], ['Key actives', 'Vitamin C, hyaluronic acid'], ['Skin type', 'All skin types'], ['Dermatologist tested', 'Yes'], ['Warranty', 'N/A']]
});
productIds.p14 = addProduct({
  name: 'PowerMix Pro Blender 1.8L', slug: 'powermix-pro-blender', sku: 'HC-BL-01',
  category: cat['home-kitchen'], brand: 'HomeChef', img: 'p14', gallery: ['p14'],
  price: 55000, compare: 68000, stock: 22,
  short: '1200W motor, 6 stainless blades and a 1.8L glass jar.',
  description: 'The PowerMix Pro crushes ice, blends smoothies and grinds grains with ease. A 1200W motor powers six stainless-steel blades inside a 1.8L glass jar with easy-clean design.',
  specs: [['Power', '1200W'], ['Capacity', '1.8L glass jar'], ['Blades', '6 stainless steel'], ['Speeds', 'Variable + pulse'], ['Warranty', '12 months']]
});
productIds.p15 = addProduct({
  name: 'CrispAir Digital Air Fryer 5.5L', slug: 'crispair-digital-air-fryer', sku: 'CA-AF-55',
  category: cat['home-kitchen'], brand: 'CrispAir', img: 'p15', gallery: ['p15'],
  price: 88000, compare: 105000, stock: 18, best: true,
  short: 'Healthy frying with 85% less oil — touchscreen and 8 presets.',
  description: 'Enjoy crispy, golden results with up to 85% less oil. The CrispAir 5.5L air fryer features a touchscreen with 8 presets, rapid 360° air circulation and dishwasher-safe parts.',
  specs: [['Capacity', '5.5L'], ['Presets', '8 one-touch programs'], ['Power', '1800W'], ['Temperature', '80–200°C'], ['Cleaning', 'Dishwasher-safe basket'], ['Warranty', '12 months']]
});
productIds.p16 = addProduct({
  name: 'PureBoil Electric Kettle 1.7L', slug: 'pureboil-electric-kettle', sku: 'HC-KT-01',
  category: cat['home-kitchen'], brand: 'HomeChef', img: 'p16', gallery: ['p16'],
  price: 24000, compare: 29000, stock: 55,
  short: 'Fast-boil stainless steel kettle with auto shut-off.',
  description: 'The PureBoil kettle brings 1.7L of water to the boil in minutes. Stainless-steel body, cool-touch handle, boil-dry protection and auto shut-off for peace of mind.',
  specs: [['Capacity', '1.7L'], ['Power', '2200W'], ['Body', 'Stainless steel'], ['Safety', 'Auto shut-off, boil-dry protection'], ['Warranty', '12 months']]
});
productIds.p20 = addProduct({
  name: 'FocusCam 4K Action Camera', slug: 'focuscam-4k-action-camera', sku: 'FC-4K-01',
  category: cat['cameras'], brand: 'FocusCam', img: 'p20', gallery: ['p20'],
  price: 145000, compare: 170000, stock: 14, new: true,
  short: '4K60 video, waterproof housing and image stabilisation.',
  description: 'Capture every adventure in stunning 4K60. The FocusCam is waterproof to 40m with its included housing, features electronic image stabilisation, a front screen for vlogging, and Wi-Fi transfer to your phone.',
  specs: [['Video', '4K60 / 1080p120'], ['Photo', '20MP'], ['Waterproof', '40m with housing'], ['Stabilisation', 'Electronic (EIS)'], ['Screen', 'Front + rear touch'], ['Warranty', '12 months']]
});

// ---------- reviews -------------------------------------------------------------------
function addReview(product, userId, orderId, rating, title, body, daysAgo, status = 'approved') {
  db.prepare(
    `INSERT INTO reviews (product_id, user_id, order_id, rating, title, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '-' || ? || ' days'))`
  ).run(product, userId, orderId, rating, title, body, status, daysAgo);
}
addReview(productIds.p03, demoId, null, 5, 'Superb sound for the price', 'The noise cancelling is way better than I expected. Battery lasts me almost a week of commutes.', 3);
addReview(productIds.p09, demoId, null, 4, 'Comfortable and light', 'Great for daily runs. Slightly narrow fit, but very comfortable after breaking in.', 5);
addReview(productIds.p01, demoId, null, 5, 'Flagship feel', 'Fast, beautiful screen, camera is outstanding. Delivery from Tob Daniel was quick too.', 9);
addReview(productIds.p15, demoId, null, 4, 'Crispy results', 'Makes amazing chips with almost no oil. A bit bulky on the counter but worth it.', 12);
addReview(productIds.p04, null, null, 5, 'Bass heads will love this', 'Deep, clean bass and the battery genuinely lasts 40 hours.', 6);
addReview(productIds.p07, null, null, 5, 'Cinema at home', 'Picture quality is stunning for the price. Setup took 5 minutes.', 7);
addReview(productIds.p12, null, null, 5, 'My new signature scent', 'Long lasting and gets compliments every time. Elegant packaging too.', 4);
addReview(productIds.p14, null, null, 4, 'Powerful blender', 'Handles frozen fruit and ice with no struggle. Easy to clean.', 10);

// recompute ratings
for (const [k, id] of Object.entries(productIds)) {
  const agg = db.prepare(`SELECT AVG(rating) AS a, COUNT(*) AS n FROM reviews WHERE product_id = ? AND status='approved'`).get(id);
  db.prepare('UPDATE products SET rating_avg = ?, rating_count = ? WHERE id = ?').run(agg.a || 0, agg.n || 0, id);
}

// ---------- promo codes -----------------------------------------------------------------
db.prepare(`INSERT INTO promo_codes (code, type, value, min_order, starts_at, ends_at, usage_limit, is_active) VALUES ('WELCOME10', 'percent', 10, 0, NULL, datetime('now', '+60 days'), 0, 1)`).run();
db.prepare(`INSERT INTO promo_codes (code, type, value, min_order, starts_at, ends_at, usage_limit, is_active) VALUES ('TOB5K', 'fixed', 5000, 50000, NULL, datetime('now', '+30 days'), 500, 1)`).run();
db.prepare(`INSERT INTO promo_codes (code, type, value, min_order, starts_at, ends_at, usage_limit, is_active) VALUES ('FREESHIP', 'freeship', 0, 0, NULL, datetime('now', '+90 days'), 0, 1)`).run();

// ---------- flash sale --------------------------------------------------------------------
const flashId = db.prepare(`INSERT INTO flash_sales (title, starts_at, ends_at, is_active) VALUES ('Deal of the Day', datetime('now'), datetime('now', '+2 days'), 1)`).run().lastInsertRowid;
const flashItems = [
  [productIds.p01, 455000], [productIds.p03, 32500], [productIds.p07, 615000], [productIds.p14, 42000]
];
const fi = db.prepare('INSERT INTO flash_sale_items (flash_sale_id, product_id, sale_price) VALUES (?, ?, ?)');
for (const [pid, price] of flashItems) fi.run(flashId, pid, price);

// ---------- banners -------------------------------------------------------------------------
db.prepare(`INSERT INTO banners (title, subtitle, cta_text, cta_link, image_url, position, sort_order, is_active)
  VALUES ('Shop the Future Today', 'Premium gadgets, fashion and home essentials — delivered to your door across Nigeria.', 'Shop Now', '/shop', '/images/hero.jpg', 'home', 0, 1)`).run();
db.prepare(`INSERT INTO banners (title, subtitle, cta_text, cta_link, image_url, position, sort_order, is_active)
  VALUES ('Mega Tech Deals', 'Up to 40% off top gadgets — for a limited time only.', 'Shop the Sale', '/shop?flash=1', '/images/banners/banner2.jpg', 'home', 1, 1)`).run();
db.prepare(`INSERT INTO banners (title, subtitle, cta_text, cta_link, image_url, position, sort_order, is_active)
  VALUES ('Fashion Week', 'Fresh styles for the whole family, delivered fast.', 'Explore Fashion', '/shop?category=fashion', '/images/banners/banner3.jpg', 'home', 2, 1)`).run();

// ---------- testimonials -----------------------------------------------------------------------
db.prepare(`INSERT INTO testimonials (name, location, rating, body, is_active) VALUES ('Chidinma O.', 'Lekki, Lagos', 5, 'Ordered a phone on Monday and it arrived by Wednesday. Genuine product, sealed and with a warranty. Tob Daniel has earned a loyal customer.', 1)`).run();
db.prepare(`INSERT INTO testimonials (name, location, rating, body, is_active) VALUES ('Ibrahim A.', 'Abuja', 5, 'Their delivery is fast and the customer support on WhatsApp actually responds. Best online shopping experience I have had in Nigeria.', 1)`).run();
db.prepare(`INSERT INTO testimonials (name, location, rating, body, is_active) VALUES ('Funke A.', 'Ibadan', 4, 'Great prices and quality products. I love that I can pay on delivery. Will definitely shop here again.', 1)`).run();

// ---------- FAQs -----------------------------------------------------------------------------------
const faqs = [
  ['How long does delivery take?', 'Orders within Lagos are typically delivered within 1–2 business days. Nationwide delivery takes 2–5 business days depending on your location.', 'Delivery', 1],
  ['What payment methods do you accept?', 'We accept card payments, bank transfer, mobile money, and cash/payment on delivery (where enabled). You choose your preferred method at checkout.', 'Payments', 2],
  ['How do I track my order?', 'Sign in to your account and open “My Orders”. You will see the live status and any tracking number once your order ships. You will also receive updates by email and in-app notification.', 'Orders', 3],
  ['What is your return policy?', 'You can return most items within 7 days of delivery if they are unused and in original packaging. Contact support to start a return.', 'Returns', 4],
  ['Are your products genuine?', 'Yes. Every product we sell is sourced from authorised distributors and comes with its manufacturer warranty where applicable.', 'Products', 5],
  ['How do I contact customer support?', 'You can reach us via the contact form, by phone, or on WhatsApp. Our team is available Monday to Saturday, 8am–6pm.', 'Support', 6]
];
const fiq = db.prepare('INSERT INTO faqs (question, answer, category, sort_order, is_active) VALUES (?, ?, ?, ?, 1)');
for (const [q, a, c, s] of faqs) fiq.run(q, a, c, s);

// ---------- subscribers ------------------------------------------------------------------------------
db.prepare('INSERT INTO subscribers (email) VALUES (?)').run('chioma@example.com');
db.prepare('INSERT INTO subscribers (email) VALUES (?)').run('dayo@example.com');

// ---------- demo orders --------------------------------------------------------------------------------
function placeOrder(daysAgo, status, items, extra = {}) {
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const delivery = subtotal >= 100000 ? 0 : 2500;
  const total = subtotal + delivery - (extra.discount || 0);
  const num = 'TD-' + (2000 + Math.floor(Math.random() * 8000)) + '-' + (1000 + Math.floor(Math.random() * 9000));
  const info = db.prepare(
    `INSERT INTO orders (order_number, user_id, status, subtotal, delivery_fee, discount_amount, total, promo_code,
       payment_method, payment_status, customer_name, customer_email, customer_phone, shipping_address, tracking_number, tracking_carrier, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'card', 'paid', ?, ?, ?, ?, ?, ?, datetime('now', '-' || ? || ' days'), datetime('now', '-' || ? || ' days'))`
  ).run(num, demoId, status, subtotal, delivery, extra.discount || 0, total, extra.promo || '',
        'Demo Customer', 'demo@tobdaniel.ng', '+234 801 234 5678',
        JSON.stringify({ full_name: 'Demo Customer', phone: '+234 801 234 5678', line1: '14 Adeola Odeku Street', city: 'Lagos', state: 'Lagos' }),
        status === 'delivered' || status === 'shipped' ? 'TRK-' + Math.floor(100000 + Math.random() * 900000) : '',
        status === 'delivered' || status === 'shipped' ? 'SwiftShip' : '', daysAgo, daysAgo);
  const orderId = info.lastInsertRowid;
  for (const it of items) {
    db.prepare('INSERT INTO order_items (order_id, product_id, name, sku, price, qty, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(orderId, it.id, it.name, it.sku, it.price, it.qty, it.image);
    db.prepare('UPDATE products SET sold_count = sold_count + ? WHERE id = ?').run(it.qty, it.id);
  }
  db.prepare(`INSERT INTO order_events (order_id, status, note, created_at) VALUES (?, ?, ?, datetime('now', '-' || ? || ' days'))`).run(orderId, 'pending', 'Order placed', daysAgo);
  if (status !== 'pending') {
    db.prepare(`INSERT INTO order_events (order_id, status, note, created_at) VALUES (?, ?, ?, datetime('now', '-' || ? || ' days', '-1 hours'))`).run(orderId, status, 'Updated by admin', Math.max(1, daysAgo - 1));
  }
  db.prepare(`INSERT INTO payments (order_id, method, status, provider, reference, amount) VALUES (?, 'card', 'paid', 'gateway', ?, ?)`).run(orderId, 'ref-' + num, total);
  return { orderId, num };
}

placeOrder(9, 'delivered', [
  { id: productIds.p03, name: 'Nova AirBuds Pro True Wireless Earbuds', sku: 'NT-ABP-01', price: 38500, qty: 1, image: '/images/products/p03.jpg' },
  { id: productIds.p09, name: 'Stride Air Running Sneakers', sku: 'ST-AIR-01', price: 54000, qty: 1, image: '/images/products/p09.jpg' }
]);
placeOrder(3, 'shipped', [
  { id: productIds.p01, name: 'Nova X1 Pro 5G Smartphone 6.7" 256GB', sku: 'NT-X1PRO-256', price: 485000, qty: 1, image: '/images/products/p01.jpg' }
]);
placeOrder(0, 'pending', [
  { id: productIds.p15, name: 'CrispAir Digital Air Fryer 5.5L', sku: 'CA-AF-55', price: 88000, qty: 1, image: '/images/products/p15.jpg' }
]);

// seed sold_count from seeded order items (already incremented above)

// ---------- notifications -----------------------------------------------------------------------------------
db.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, 'Order update', 'Your order is now shipped. Track it in My Orders.', '#/account/orders', datetime('now', '-3 days'))`).run(demoId);
db.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, 'New order', 'A new order was placed on your store.', '/admin', datetime('now', '-1 hours'))`).run(adminId);

console.log('');
console.log('Seed complete ✔');
console.log('────────────────────────────────────────────');
console.log('  Admin login   : admin@tobdaniel.ng  /  Admin@2026!');
console.log('  Customer login: demo@tobdaniel.ng   /  Demo@1234');
console.log('  Admin route   : /secure-admin-login');
console.log('────────────────────────────────────────────');
