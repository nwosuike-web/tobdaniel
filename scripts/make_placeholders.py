#!/usr/bin/env python3
"""Generate on-brand placeholder product tiles + banner slides for seed data.
Idempotent: skips files that already exist."""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..')
PROD = os.path.join(ROOT, 'public', 'images', 'products')
BAN = os.path.join(ROOT, 'public', 'images', 'banners')
os.makedirs(PROD, exist_ok=True)
os.makedirs(BAN, exist_ok=True)

ROYAL = (10, 58, 143)
ROYAL2 = (28, 95, 196)
SKY = (63, 169, 245)
NAVY = (15, 27, 61)
CHARCOAL = (52, 64, 84)
LIGHT1 = (246, 250, 255)
LIGHT2 = (220, 235, 253)

FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
]
def font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def vgrad(w, h, c1, c2):
    base = Image.new('RGB', (w, h), c1)
    top = Image.new('RGB', (w, h), c2)
    mask = Image.new('L', (w, h))
    for y in range(h):
        mask.paste(255 - int(255 * y / h), (0, y, w, y + 1))
    base.paste(top, (0, 0), mask)
    return base

def monogram(name):
    words = name.split()
    if len(words) == 1:
        w = words[0]
        return (w[:2] if len(w) > 1 else w).upper()
    return (words[0][0] + words[1][0]).upper()

PRODUCTS = [
    ('p10', 'Milano Leather Handbag', 'Fashion'),
    ('p11', 'Regal Heritage Wristwatch', 'Fashion'),
    ('p12', 'Élan Noir Eau de Parfum', 'Beauty'),
    ('p13', 'GlowLab Skincare Trio Set', 'Beauty'),
    ('p14', 'PowerMix Pro Blender', 'Home & Kitchen'),
    ('p15', 'CrispAir Digital Air Fryer', 'Home & Kitchen'),
    ('p16', 'PureBoil Electric Kettle', 'Home & Kitchen'),
    ('p17', 'SoundMax 2.1 Soundbar', 'Audio'),
    ('p18', 'Voyager Canvas Backpack', 'Fashion'),
    ('p19', 'Aura Polarized Sunglasses', 'Fashion'),
    ('p20', 'FocusCam 4K Action Camera', 'Cameras'),
]

for pid, name, cat in PRODUCTS:
    path = os.path.join(PROD, pid + '.jpg')
    if os.path.exists(path):
        continue
    W = H = 800
    img = vgrad(W, H, LIGHT1, LIGHT2).convert('RGBA')
    d = ImageDraw.Draw(img)
    # soft glow behind the coin
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([250, 150, 550, 450], fill=(63, 169, 245, 60))
    glow = glow.filter(ImageFilter.GaussianBlur(40))
    img = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img)
    # coin
    d.ellipse([260, 160, 540, 440], fill=(ROYAL2[0], ROYAL2[1], ROYAL2[2], 255))
    coin = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    cd = ImageDraw.Draw(coin)
    cd.ellipse([260, 160, 540, 440], fill=(ROYAL[0], ROYAL[1], ROYAL[2], 255))
    # gradient overlay top-light
    coin2 = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    cd2 = ImageDraw.Draw(coin2)
    cd2.ellipse([260, 160, 540, 440], fill=(63, 169, 245, 90))
    img = Image.alpha_composite(img, coin)
    img = Image.alpha_composite(img, coin2)
    d = ImageDraw.Draw(img)
    d.ellipse([260, 160, 540, 440], outline=(255, 255, 255, 120), width=4)
    # monogram
    mg = monogram(name)
    f = font(150 if len(mg) <= 2 else 110)
    bbox = d.textbbox((0, 0), mg, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((W - tw) / 2 - bbox[0], (H - th) / 2 - bbox[1] - 2), mg, font=f, fill=(255, 255, 255, 255))
    # name label
    fn = font(34)
    short = name
    for b in d.textbbox((0, 0), short, font=fn):
        pass
    bb = d.textbbox((0, 0), short, font=fn)
    tw2 = bb[2] - bb[0]
    if tw2 > 700:
        short = short.split(' ')[0] + ' ' + short.split(' ')[1]
        bb = d.textbbox((0, 0), short, font=fn)
        tw2 = bb[2] - bb[0]
    d.text(((W - tw2) / 2 - bb[0], 520), short, font=fn, fill=NAVY)
    fc = font(26)
    bb = d.textbbox((0, 0), cat.upper(), font=fc)
    d.text(((W - (bb[2] - bb[0])) / 2 - bb[0], 590), cat.upper(), font=fc, fill=CHARCOAL)
    img.convert('RGB').save(path, 'JPEG', quality=88)
    print('created', path)

BANNERS = [
    ('banner2', 'MEGA TECH DEALS', 'Up to 40% off top gadgets — for a limited time', 'SHOP THE SALE'),
    ('banner3', 'FASHION WEEK', 'Fresh styles for the whole family, delivered fast', 'EXPLORE FASHION'),
]
for pid, title, sub, cta in BANNERS:
    path = os.path.join(BAN, pid + '.jpg')
    if os.path.exists(path):
        continue
    W, H = 1600, 640
    img = vgrad(W, H, ROYAL, SKY).convert('RGBA')
    d = ImageDraw.Draw(img)
    # decorative circles
    d.ellipse([1150, -160, 1750, 440], fill=(255, 255, 255, 30))
    d.ellipse([1260, 60, 1620, 420], fill=(255, 255, 255, 26))
    f1 = font(96)
    bb = d.textbbox((0, 0), title, font=f1)
    d.text((110, 200), title, font=f1, fill=(255, 255, 255, 255))
    f2 = font(40)
    d.text((114, 360), sub, font=f2, fill=(230, 240, 255, 255))
    f3 = font(36)
    bb3 = d.textbbox((0, 0), cta, font=f3)
    tw3 = bb3[2] - bb3[0]
    d.rounded_rectangle([110, 470, 150 + tw3 + 80, 545], radius=38, fill=(255, 165, 0, 255))
    d.text((150, 485), cta, font=f3, fill=(15, 27, 61, 255))
    img.convert('RGB').save(path, 'JPEG', quality=90)
    print('created', path)

print('placeholders done')
