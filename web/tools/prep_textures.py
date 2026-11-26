"""Prépare les textures du jeu à partir des scans Poly Haven (CC0) + dessins procéduraux.

Sorties dans assets/tex :
  t_<couche>_a.jpg  albédo des couches de sol
  t_<couche>_n.jpg  normale (R,G) + relief (B) des couches de sol
  veg_a.webp        atlas végétation (couleur + alpha)
  veg_n.jpg         atlas végétation (normales)
  atlas.json        rectangles de l'atlas (en UV 0..1, origine en haut à gauche)
"""
import json, math, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PH = sys.argv[1] if len(sys.argv) > 1 else 'ph'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'tex')
os.makedirs(OUT, exist_ok=True)
rng = random.Random(7)
LZ = Image.LANCZOS


def ph_tex(i, m):
    return Image.open(f'{PH}/tex/{i}/{m}.jpg')


def ph_mdl_tex(i, kind):
    d = f'{PH}/mdl/{i}/textures'
    for f in os.listdir(d):
        if kind == 'alpha' and f.startswith('alpha'):
            return Image.open(os.path.join(d, f))
        if kind in f and not f.startswith('alpha'):
            return Image.open(os.path.join(d, f))
    raise FileNotFoundError(i + kind)


# ---------------- Couches de sol ----------------
LAYERS = [('sand', 'sand_01'), ('jungle', 'forest_leaves_02'), ('grass', 'leafy_grass'),
          ('rock', 'dark_rock_02'), ('ash', 'burned_ground_01'), ('path', 'brown_mud_leaves_01')]
for name, pid in LAYERS:
    a = ph_tex(pid, 'Diffuse').convert('RGB').resize((1024, 1024), LZ)
    a.save(f'{OUT}/t_{name}_a.jpg', quality=84, optimize=True, progressive=True)
    n = np.asarray(ph_tex(pid, 'nor_gl').convert('RGB').resize((1024, 1024), LZ)).astype(np.float32)
    d = np.asarray(ph_tex(pid, 'Displacement').convert('L').resize((1024, 1024), LZ)).astype(np.float32)
    lo, hi = np.percentile(d, 1), np.percentile(d, 99)
    d = np.clip((d - lo) / max(hi - lo, 1) * 255, 0, 255)
    out = np.dstack([n[..., 0], n[..., 1], d]).astype(np.uint8)
    Image.fromarray(out).save(f'{OUT}/t_{name}_n.jpg', quality=90, optimize=True)
print('couches de sol ok')

# ---------------- Atlas végétation ----------------
A = 2048
atlas = Image.new('RGBA', (A, A), (0, 0, 0, 0))
natlas = Image.new('RGB', (A, A), (128, 128, 255))
rects = {}


def put(name, img, nimg, x, y, w, h, pad=6):
    img = img.convert('RGBA').resize((w - 2 * pad, h - 2 * pad), LZ)
    atlas.paste(img, (x + pad, y + pad))
    if nimg is not None:
        natlas.paste(nimg.convert('RGB').resize((w - 2 * pad, h - 2 * pad), LZ), (x + pad, y + pad))
    rects[name] = [(x + pad) / A, (y + pad) / A, (w - 2 * pad) / A, (h - 2 * pad) / A]


def put_tile(name, img, nimg, x, y, w, h):
    # tuile opaque répétée sur les bords pour limiter les fuites de mipmaps
    img = img.convert('RGB').resize((w, h), LZ)
    big = Image.new('RGB', (w + 16, h + 16))
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            big.paste(img, (8 + dx * w, 8 + dy * h))
    atlas.paste(big.crop((0, 0, w + 16, h + 16)).convert('RGBA'), (x - 8, y - 8))
    if nimg is not None:
        nimg = nimg.convert('RGB').resize((w, h), LZ)
        nb = Image.new('RGB', (w + 16, h + 16))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                nb.paste(nimg, (8 + dx * w, 8 + dy * h))
        natlas.paste(nb, (x - 8, y - 8))
    rects[name] = [x / A, y / A, w / A, h / A]


def height_to_normal(hmap, strength=2.0):
    h = np.asarray(hmap).astype(np.float32) / 255.0
    gy, gx = np.gradient(h)
    nx, ny, nz = -gx * strength * 30, gy * strength * 30, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.dstack([nx / l, ny / l, nz / l]) * 0.5 + 0.5
    return Image.fromarray((n * 255).astype(np.uint8))


def lerpc(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


# --- écorces (tuiles opaques) ---
put_tile('palmBark', ph_tex('palm_tree_bark', 'Diffuse'), ph_tex('palm_tree_bark', 'nor_gl'), 8, 8, 496, 1008)
put_tile('treeBark', ph_tex('bark_brown_02', 'Diffuse'), ph_tex('bark_brown_02', 'nor_gl'), 520, 8, 496, 1008)


# --- palme de cocotier (demi-palme : x = base -> pointe, y = nervure -> bout des folioles) ---
def draw_frond(base_col, tip_col, dry=0.0, torn=0.25, seed=1, density=1.0):
    r = random.Random(seed)
    SS = 2
    W, Hh = 1024 * SS, 256 * SS
    img = Image.new('RGBA', (W, Hh), (0, 0, 0, 0))
    hgt = Image.new('L', (W, Hh), 0)
    d, dh = ImageDraw.Draw(img), ImageDraw.Draw(hgt)
    n = int(78 * density)
    for k in range(n):
        t = 0.07 + 0.92 * k / n + r.uniform(-0.003, 0.003)
        env = math.sin(min(1, (t - 0.04) / 0.95) * math.pi) ** 0.55
        L = (0.35 + 0.65 * env) * Hh * r.uniform(0.86, 1.0)
        if r.random() < torn * 0.35:
            L *= r.uniform(0.35, 0.7)
        x0 = t * W
        ang = math.radians(r.uniform(52, 64))
        x1, y1 = x0 + math.cos(ang) * L * 1.15, math.sin(ang) * L
        wid = (5.5 + 3.0 * env) * SS
        cdry = min(1, dry + max(0, r.uniform(-0.6, 0.35)) * (1 if dry > 0 else 0.25))
        col = lerpc(base_col, tip_col, r.uniform(0.0, 0.35))
        col = lerpc(col, (150, 118, 62), cdry)
        tipc = lerpc(col, (196, 172, 92) if dry < 0.5 else (120, 92, 52), 0.55)
        steps = 10
        pts_l, pts_r = [], []
        for s in range(steps + 1):
            u = s / steps
            px, py = x0 + (x1 - x0) * u, y1 * u
            ww = wid * (1 - u ** 1.6) * (0.55 + 0.45 * math.sin(min(1, u * 3) * math.pi / 2))
            nx, ny = -math.sin(ang), math.cos(ang)
            pts_l.append((px + nx * ww, py - ny * ww * 0.3))
            pts_r.append((px - nx * ww, py + ny * ww * 0.3))
        poly = pts_l + pts_r[::-1]
        d.polygon(poly, fill=col + (255,))
        dh.polygon(poly, fill=120)
        # dégradé vers la pointe
        for s in range(5, steps):
            u = s / steps
            seg = pts_l[s:s + 2] + pts_r[s:s + 2][::-1]
            d.polygon(seg, fill=lerpc(col, tipc, (u - 0.5) * 2) + (255,))
        d.line([(x0, 0), (x1, y1)], fill=lerpc(col, (225, 215, 150), 0.35) + (255,), width=max(1, int(1.2 * SS)))
        dh.line([(x0, 0), (x1, y1)], fill=255, width=int(2 * SS))
    # nervure centrale (rachis)
    d.rectangle([0, 0, W, int(7 * SS)], fill=lerpc(base_col, (205, 190, 120), 0.55 if dry < 0.5 else 0.2) + (255,))
    dh.rectangle([0, 0, W, int(7 * SS)], fill=255)
    img = img.resize((1024, 256), LZ)
    hgt = hgt.resize((1024, 256), LZ).filter(ImageFilter.GaussianBlur(1.2))
    return img, height_to_normal(hgt, 1.6)


fronds = [
    ('frondGreen', (52, 92, 30), (96, 128, 40), 0.0, 0.25, 11, 1.0),
    ('frondYellow', (98, 120, 38), (150, 150, 60), 0.05, 0.3, 12, 1.0),
    ('frondDead', (120, 96, 54), (150, 120, 70), 1.0, 0.55, 13, 0.85),
    ('frondYoung', (78, 116, 34), (128, 150, 52), 0.0, 0.1, 14, 1.05),
]
for i, (nm, c0, c1, dry, torn, sd, den) in enumerate(fronds):
    im, nm_ = draw_frond(c0, c1, dry, torn, sd, den)
    put(nm, im, nm_, 1024, i * 256, 1024, 256, pad=4)


# --- grappes de feuilles pour arbres feuillus ---
def draw_cluster(seed, kind):
    r = random.Random(seed)
    SS = 2
    S_ = 512 * SS
    img = Image.new('RGBA', (S_, S_), (0, 0, 0, 0))
    hgt = Image.new('L', (S_, S_), 0)
    d, dh = ImageDraw.Draw(img), ImageDraw.Draw(hgt)
    twigs = [(S_ * r.uniform(0.3, 0.7), S_ * r.uniform(0.55, 0.8)) for _ in range(3)]
    leaves = []
    for _ in range(70 if kind == 'A' else 52):
        tx, ty = r.choice(twigs)
        a = r.uniform(-math.pi, 0.15) if r.random() < 0.85 else r.uniform(0, math.pi)
        dist = r.uniform(0.05, 0.42) * S_
        cx, cy = tx + math.cos(a) * dist, ty + math.sin(a) * dist * 0.9
        L = (r.uniform(70, 115) if kind == 'A' else r.uniform(55, 85)) * SS
        Wd = L * (0.22 if kind == 'A' else 0.42)
        ang = a + r.uniform(-0.6, 0.6)
        leaves.append((cy, cx, cy, L, Wd, ang, tx, ty))
    leaves.sort()
    for (_, cx, cy, L, Wd, ang, tx, ty) in leaves:
        if kind == 'A':
            base = lerpc((38, 70, 26), (70, 104, 34), r.random())
        else:
            base = lerpc((52, 92, 34), (96, 128, 46), r.random())
            if r.random() < 0.08:
                base = lerpc((150, 60, 30), (190, 120, 40), r.random())
        light = lerpc(base, (170, 190, 90), 0.25)
        d.line([(tx, ty), (cx, cy)], fill=(70, 60, 40, 255), width=int(1.5 * SS))
        pts = []
        for s in range(21):
            u = s / 20
            w = math.sin(u * math.pi) ** (0.8 if kind == 'A' else 0.6) * Wd / 2
            pts.append((u * L, w))
        pts += [(p[0], -p[1]) for p in pts[::-1]]
        ca, sa = math.cos(ang), math.sin(ang)
        poly = [(cx + p[0] * ca - p[1] * sa - ca * L * 0.15, cy + p[0] * sa + p[1] * ca - sa * L * 0.15) for p in pts]
        d.polygon(poly, fill=base + (255,))
        half = [poly[i] for i in range(0, 21)] + [(cx + L * 0.85 * ca, cy + L * 0.85 * sa)]
        d.polygon(half, fill=lerpc(base, light, 0.35) + (255,))
        dh.polygon(poly, fill=140)
        d.line([(cx - ca * L * 0.15, cy - sa * L * 0.15), (cx + ca * L * 0.85, cy + sa * L * 0.85)], fill=lerpc(base, (200, 210, 140), 0.4) + (255,), width=int(1.2 * SS))
        dh.line([(cx - ca * L * 0.15, cy - sa * L * 0.15), (cx + ca * L * 0.85, cy + sa * L * 0.85)], fill=230, width=int(2 * SS))
    img = img.resize((512, 512), LZ)
    return img, height_to_normal(hgt.resize((512, 512), LZ).filter(ImageFilter.GaussianBlur(1)), 1.2)


im, nm_ = draw_cluster(21, 'A'); put('clusterA', im, nm_, 0, 1024, 512, 512)
im, nm_ = draw_cluster(22, 'B'); put('clusterB', im, nm_, 512, 1024, 512, 512)


# --- feuilles scannées (Poly Haven) ---
def scanned(pid):
    c = ph_mdl_tex(pid, 'diff').convert('RGB')
    a = ph_mdl_tex(pid, 'alpha').convert('L').resize(c.size, LZ)
    im = c.copy(); im.putalpha(a)
    return im, ph_mdl_tex(pid, 'nor_gl')


im, nm_ = scanned('anthurium_botany_01'); put('anthurium', im, nm_, 1024, 1024, 512, 512, pad=2)
im, nm_ = scanned('calathea_orbifolia_01'); put('calathea', im, nm_, 1536, 1024, 512, 512, pad=2)
im, nm_ = scanned('fern_02'); put('fern', im, nm_, 0, 1536, 512, 512, pad=2)
im, nm_ = scanned('shrub_sorrel_01'); put('sorrel', im, nm_, 1280, 1536, 256, 256, pad=2)


# --- feuille de bananier (x = base -> pointe, nervure au centre) ---
def draw_banana(seed, w=512, h=256, col=(64, 110, 36), tears=14, dry=0.15):
    r = random.Random(seed)
    SS = 2
    W_, H_ = w * SS, h * SS
    mask = Image.new('L', (W_, H_), 0)
    md = ImageDraw.Draw(mask)
    top, bot = [], []
    for s in range(61):
        u = s / 60
        half = (H_ / 2 - 6) * (math.sin(min(1, u * 1.05) * math.pi) ** 0.45) * (1 - 0.15 * u)
        top.append((u * W_, H_ / 2 - half)); bot.append((u * W_, H_ / 2 + half))
    md.polygon(top + bot[::-1], fill=255)
    # déchirures le long des nervures (fentes transparentes depuis le bord)
    for _ in range(tears):
        u = r.uniform(0.12, 0.95); sgn = r.choice((-1, 1)); depth = r.uniform(0.35, 0.95)
        x = u * W_
        x0, y0 = x + 0.18 * H_ * (1 - depth), H_ / 2 + sgn * (H_ / 2) * (1 - depth)
        md.line([(x0, y0), (x + 0.18 * H_, H_ / 2 + sgn * H_ / 2)], fill=0, width=3 * SS)
    colr = Image.new('RGB', (W_, H_), col)
    cd = ImageDraw.Draw(colr)
    hgt = Image.new('L', (W_, H_), 110)
    hd = ImageDraw.Draw(hgt)
    for k in range(150):
        x = k / 150 * W_
        c2 = lerpc(col, (112, 152, 62), r.uniform(0, 0.45))
        for sgn in (-1, 1):
            cd.line([(x, H_ / 2), (x + 0.18 * H_, H_ / 2 + sgn * H_ / 2)], fill=c2, width=SS)
            hd.line([(x, H_ / 2), (x + 0.18 * H_, H_ / 2 + sgn * H_ / 2)], fill=150, width=SS)
    # bords secs brunâtres
    if dry > 0:
        edge = mask.filter(ImageFilter.MaxFilter(9))
        inner = mask.filter(ImageFilter.MinFilter(9))
        band = np.clip(np.asarray(mask).astype(np.float32) - np.asarray(inner).astype(np.float32), 0, 255) / 255.0
        noise = np.asarray(Image.effect_noise((W_, H_), 60).filter(ImageFilter.GaussianBlur(6))).astype(np.float32) / 255.0
        t = np.clip(band * (noise * 1.6) * dry * 3, 0, 1)[..., None]
        arrc = np.asarray(colr).astype(np.float32) * (1 - t) + np.array([150, 125, 70], np.float32) * t
        colr = Image.fromarray(arrc.astype(np.uint8))
        cd = ImageDraw.Draw(colr)
        del edge
    cd.rectangle([0, H_ / 2 - 4 * SS, W_, H_ / 2 + 4 * SS], fill=lerpc(col, (190, 200, 130), 0.5))
    hd.rectangle([0, H_ / 2 - 4 * SS, W_, H_ / 2 + 4 * SS], fill=255)
    img = colr.convert('RGBA'); img.putalpha(mask)
    img = img.resize((w, h), LZ)
    hgt = Image.fromarray((np.asarray(hgt).astype(np.float32) * (np.asarray(mask) > 0)).astype(np.uint8))
    return img, height_to_normal(hgt.resize((w, h), LZ).filter(ImageFilter.GaussianBlur(1)), 1.4)


im, nm_ = draw_banana(31); put('banana', im, nm_, 512, 1536, 512, 256)


# --- héliconia : feuille (gauche) + bractées rouges (droite) ---
def draw_heliconia():
    im = Image.new('RGBA', (512, 256), (0, 0, 0, 0))
    leaf, lnor = draw_banana(41, 256, 256, (46, 100, 34), tears=3, dry=0.0)
    im.paste(leaf, (0, 0))
    SS = 2
    br = Image.new('RGBA', (256 * SS, 256 * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(br)
    cx = 128 * SS
    d.line([(cx, 20 * SS), (cx, 250 * SS)], fill=(120, 140, 60, 255), width=5 * SS)
    for k in range(7):
        y = (40 + k * 30) * SS
        s = 1 if k % 2 == 0 else -1
        L = (95 - k * 6) * SS
        poly = [(cx, y), (cx + s * L, y - 26 * SS), (cx + s * L * 0.82, y - 6 * SS), (cx, y + 14 * SS)]
        d.polygon(poly, fill=(196, 34, 30, 255))
        d.polygon([(cx + s * L, y - 26 * SS), (cx + s * L * 0.7, y - 18 * SS), (cx + s * L * 0.82, y - 6 * SS)], fill=(236, 196, 60, 255))
        d.line([(cx, y + 6 * SS), (cx + s * L * 0.9, y - 20 * SS)], fill=(150, 20, 24, 255), width=2 * SS)
    im.paste(br.resize((256, 256), LZ), (256, 0))
    n = Image.new('RGB', (512, 256), (128, 128, 255)); n.paste(lnor, (0, 0))
    return im, n


im, nm_ = draw_heliconia(); put('heliconia', im, nm_, 512, 1792, 512, 256)


# --- touffes d'herbe (brins verticaux) ---
def draw_grass():
    r = random.Random(51)
    SS = 2
    W_, H_ = 256 * SS, 512 * SS
    im = Image.new('RGBA', (W_, H_), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for k in range(26):
        x0 = r.uniform(0.12, 0.88) * W_
        L = r.uniform(0.55, 0.98) * H_
        bend = r.uniform(-0.35, 0.35) * W_
        col = lerpc((62, 98, 34), (140, 150, 70), r.random() ** 1.5)
        pts_l, pts_r = [], []
        for s in range(13):
            u = s / 12
            x = x0 + bend * u * u
            y = H_ - u * L
            w = (5 * SS) * (1 - u) + 0.6
            pts_l.append((x - w, y)); pts_r.append((x + w, y))
        d.polygon(pts_l + pts_r[::-1], fill=col + (255,))
    return im.resize((256, 512), LZ)


put('grass', draw_grass(), None, 1024, 1536, 256, 512)


# --- fleurs d'hibiscus ---
def draw_flowers():
    SS = 2
    im = Image.new('RGBA', (256 * SS, 256 * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cols = [(210, 30, 40), (236, 110, 140), (245, 200, 50), (240, 120, 40)]
    for q, col in enumerate(cols):
        cx, cy = (64 + (q % 2) * 128) * SS, (64 + (q // 2) * 128) * SS
        for p in range(5):
            a = p / 5 * math.tau
            px, py = cx + math.cos(a) * 30 * SS, cy + math.sin(a) * 30 * SS
            d.ellipse([px - 30 * SS, py - 26 * SS, px + 30 * SS, py + 26 * SS], fill=col + (255,))
        d.ellipse([cx - 14 * SS, cy - 14 * SS, cx + 14 * SS, cy + 14 * SS], fill=lerpc(col, (90, 10, 20), 0.6) + (255,))
        d.line([(cx, cy), (cx + 26 * SS, cy - 30 * SS)], fill=(240, 220, 120, 255), width=3 * SS)
    return im.resize((256, 256), LZ)


put('flowers', draw_flowers(), None, 1280, 1792, 256, 256)


# --- noix de coco (opaque) ---
def draw_coconut():
    r = random.Random(61)
    im = Image.new('RGB', (256, 256), (88, 96, 40))
    d = ImageDraw.Draw(im)
    for _ in range(900):
        x, y = r.uniform(0, 256), r.uniform(0, 256)
        c = lerpc((70, 82, 30), (140, 120, 60), r.random())
        d.line([(x, y), (x + r.uniform(-3, 3), y + r.uniform(6, 16))], fill=c, width=1)
    return im


put_tile('coconut', draw_coconut(), None, 1544, 1544, 240, 240)

# --- dilatation des couleurs dans les zones transparentes (évite les franges sombres) ---
def boxblur(a, r):
    # flou boîte (2r+1) par sommes cumulées, bords répliqués
    p = np.pad(a, [(r + 1, r)] + [(r + 1, r)] + [(0, 0)] * (a.ndim - 2), mode='edge')
    c = p.cumsum(0)
    c = c[2 * r + 1:] - c[:-2 * r - 1]
    c = c.cumsum(1)
    c = c[:, 2 * r + 1:] - c[:, :-2 * r - 1]
    return c / float((2 * r + 1) ** 2)


arr = np.asarray(atlas).astype(np.float32)
rgb, alpha = arr[..., :3], arr[..., 3] / 255.0
mask = alpha > 0.5
filled = np.where(mask[..., None], rgb, 0).astype(np.float32)
cnt = mask.astype(np.float32)
for rad in (2, 4, 8, 16, 32):
    fb = boxblur(filled * cnt[..., None], rad)
    cb = boxblur(cnt, rad)
    upd = (cnt < 0.5) & (cb > 1e-4)
    filled[upd] = fb[upd] / cb[upd][..., None]
    cnt = np.where(upd, 1.0, cnt).astype(np.float32)
out = np.dstack([np.clip(filled, 0, 255), arr[..., 3]]).astype(np.uint8)
Image.fromarray(out, 'RGBA').save(f'{OUT}/veg_a.webp', quality=90, method=6)
natlas.save(f'{OUT}/veg_n.jpg', quality=88, optimize=True)
json.dump(rects, open(f'{OUT}/atlas.json', 'w'), indent=0)
Image.fromarray(out[..., :3]).resize((1024, 1024)).save(os.path.join(HERE, '.atlas_preview.jpg'), quality=80)
print('atlas ok', {k: [round(v * A) for v in r] for k, r in rects.items()})
