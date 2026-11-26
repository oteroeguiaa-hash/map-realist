// Génère l'île : relief, volcan, érosion, lagune, récif, cascade, rivière, piste, routes.
// Sorties : assets/terrain.bin (hauteurs + masques) et assets/world.json (points clés).
import fs from 'node:fs';
import { makePerlin, mulberry32, smoothstep as S, clamp, lerp } from './noise.mjs';

const N = 1024;            // résolution de la heightmap
const W = 2048;            // taille du monde en mètres
const CELL = W / N;        // 2 m par texel
const H_MIN = -64, H_MAX = 448;
const OUT = new URL('../assets/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const P = makePerlin(1337), P2 = makePerlin(4242), P3 = makePerlin(777), P4 = makePerlin(9001);
const rnd = mulberry32(20261126);

const wx = (i) => -W / 2 + (i + 0.5) * CELL;
const wz = (j) => -W / 2 + (j + 0.5) * CELL;
const toI = (x) => (x + W / 2) / CELL - 0.5;
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

const IC = [0, 30];          // centre de l'île
const V = [-70, -120];       // centre du volcan (nord = -z)
const PEAK = 372, VR = 560;  // hauteur et rayon du cône

function coastR(th) {
  const c = Math.cos(th), s = Math.sin(th);
  let r = 690 + 80 * P.noise2(c * 1.5 + 11.3, s * 1.5 - 4.2) + 42 * P.noise2(c * 3.6 - 2.1, s * 3.6 + 8.8) + 16 * P.noise2(c * 9 + 1.7, s * 9 + 3.3);
  r -= 150 * Math.exp(-1 * ((angDiff(th, Math.PI)) / 0.15) ** 2);              // baie ouest (hydravion)
  r += 45 * Math.exp(-1 * ((angDiff(th, Math.PI / 2)) / 0.45) ** 2);           // grande plage sud
  r += 30 * Math.exp(-1 * ((angDiff(th, 0.15)) / 0.35) ** 2);                  // plaine est (piste)
  return r;
}
function polar(x, z) {
  const qx = x + 70 * P.fbm2(x * 0.0016 + 3.3, z * 0.0016 - 1.7, 3);
  const qz = z + 70 * P.fbm2(x * 0.0016 - 7.1, z * 0.0016 + 5.9, 3);
  const dx = qx - IC[0], dz = qz - IC[1];
  return { r: Math.hypot(dx, dz), th: Math.atan2(dz, dx) };
}
// Largeur de plage (côte nord rocheuse plus étroite)
function beachW(th) {
  const north = Math.exp(-1 * ((angDiff(th, -Math.PI / 2)) / 0.7) ** 2);
  return (34 + 20 * P2.noise2(Math.cos(th) * 3 + 2, Math.sin(th) * 3 - 6)) * (1 - 0.7 * north);
}
function lagoonW(th) {
  const north = Math.exp(-1 * ((angDiff(th, -Math.PI / 2)) / 0.8) ** 2);
  return clamp(190 + 110 * P2.noise2(Math.cos(th) * 2.2 - 9, Math.sin(th) * 2.2 + 4), 60, 320) * (1 - 0.65 * north);
}
function volcano(x, z) {
  const dx = x - V[0], dz = z - V[1];
  const r = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
  const rr = r * (1 + 0.09 * P3.noise2(Math.cos(a) * 2 + 3, Math.sin(a) * 2 + 5));
  const t = clamp(1 - rr / VR, 0, 1);
  let h = PEAK * Math.pow(t, 1.6);
  const rc = 64, k = r / rc;
  h += 12 * Math.exp(-1 * ((k - 1) / 0.28) ** 2);          // bourrelet du cratère
  if (k < 1) h -= 58 * Math.pow(1 - k * k, 1.15);        // cratère
  const g = P3.ridged2(Math.cos(a) * 13 + r * 0.005, Math.sin(a) * 13 - r * 0.005, 3);
  h -= g * 26 * S(0.04, 0.35, t) * (1 - S(0.78, 0.96, t)); // ravines radiales
  return Math.max(h, 0);
}

const H = new Float32Array(N * N);
const coastD = new Float32Array(N * N);
console.time('base');
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = wx(i), z = wz(j);
  const { r, th } = polar(x, z);
  const d = coastR(th) - r;           // > 0 : terre
  coastD[j * N + i] = d;
  let h;
  if (d >= 0) {
    const bw = beachW(th);
    const base = 2.3 * S(0, bw, d) + 2.4 * S(bw * 0.8, bw + 70, d);
    const inland = S(bw + 15, bw + 260, d);
    const hills = 40 * P.fbm2(x / 330, z / 330, 5) + 30 * P4.ridged2(x / 520 + 3, z / 520 - 2, 4) - 8;
    h = base + inland * Math.max(hills, -2) + volcano(x, z) * S(-8, 50, d);
  } else {
    const e = -d, lw = lagoonW(th);
    const shelf = 2.4 + 1.5 * P2.fbm2(x / 170, z / 170, 3);
    let hs = -shelf * S(0, Math.max(30, lw * 0.5), e) - 0.25 * S(0, 12, e);
    const bm = P3.fbm2(x / 42 + 100, z / 42 - 50, 3);                    // pâtés de corail
    if (e > 20 && e < lw - 15) hs = Math.min(hs + Math.max(0, bm - 0.2) * 10, -0.7);
    const pass = S(-0.28, 0.02, P2.noise2(Math.cos(th) * 4 + 20, Math.sin(th) * 4 - 7));
    const crest = Math.exp(-1 * ((e - lw) / 15) ** 2) * pass;
    hs = lerp(hs, -0.5 + 0.3 * P3.noise2(x / 22, z / 22), crest);
    hs = lerp(hs, -40 - 10 * P2.fbm2(x / 300, z / 300, 3), S(lw + 10, lw + 170, e));
    hs = lerp(hs, -60, S(lw + 170, lw + 650, e));
    h = hs + volcano(x, z) * 0.0;
  }
  H[j * N + i] = h;
}
console.timeEnd('base');

// ---------- Érosion hydraulique (gouttelettes) ----------
function erode(map, iterations) {
  const inertia = 0.05, capFactor = 4, minCap = 0.01, erodeSpeed = 0.3, depositSpeed = 0.3, evaporate = 0.015, gravity = 4, maxLife = 60, radius = 3;
  const SC = 1 / 400;
  for (let k = 0; k < map.length; k++) map[k] *= SC;
  const bOff = [], bW = [];
  let wsum = 0;
  for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
    const d = Math.hypot(x, y); if (d < radius) { const w = 1 - d / radius; bOff.push([x, y]); bW.push(w); wsum += w; }
  }
  for (let k = 0; k < bW.length; k++) bW[k] /= wsum;
  const hg = (px, py) => {
    const ix = Math.floor(px), iy = Math.floor(py), u = px - ix, v = py - iy, k = iy * N + ix;
    const a = map[k], b = map[k + 1], c = map[k + N], d = map[k + N + 1];
    return { h: a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v, gx: (b - a) * (1 - v) + (d - c) * v, gy: (c - a) * (1 - u) + (d - b) * u };
  };
  const minH = 1.0 * SC;
  for (let it = 0; it < iterations; it++) {
    let px = rnd() * (N - 2), py = rnd() * (N - 2);
    if (map[Math.floor(py) * N + Math.floor(px)] < 3 * SC) continue;
    let dx = 0, dy = 0, speed = 1, water = 1, sed = 0;
    for (let life = 0; life < maxLife; life++) {
      const nx = Math.floor(px), ny = Math.floor(py), ox = px - nx, oy = py - ny;
      const g = hg(px, py);
      dx = dx * inertia - g.gx * (1 - inertia); dy = dy * inertia - g.gy * (1 - inertia);
      const len = Math.hypot(dx, dy); if (len < 1e-9) break; dx /= len; dy /= len;
      px += dx; py += dy;
      if (px < 1 || px >= N - 2 || py < 1 || py >= N - 2) break;
      const nh = hg(px, py).h, dh = nh - g.h;
      if (nh < minH) break;
      const cap = Math.max(-dh * speed * water * capFactor, minCap);
      const k0 = ny * N + nx;
      if (sed > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depositSpeed;
        sed -= amt;
        map[k0] += amt * (1 - ox) * (1 - oy); map[k0 + 1] += amt * ox * (1 - oy);
        map[k0 + N] += amt * (1 - ox) * oy; map[k0 + N + 1] += amt * ox * oy;
      } else {
        const amt = Math.min((cap - sed) * erodeSpeed, -dh);
        for (let b = 0; b < bOff.length; b++) {
          const xx = nx + bOff[b][0], yy = ny + bOff[b][1];
          if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
          const kk = yy * N + xx, we = amt * bW[b];
          const ds = Math.min(we, Math.max(0, map[kk] - minH * 0.5));
          map[kk] -= ds; sed += ds;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * gravity));
      water *= 1 - evaporate;
    }
  }
  for (let k = 0; k < map.length; k++) map[k] /= SC;
}
function blur(src, passes = 1, mask = null) {
  const tmp = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (mask && !mask(k)) { tmp[k] = src[k]; continue; }
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = i + dx, y = j + dy; if (x < 0 || y < 0 || x >= N || y >= N) continue;
        const w = (dx === 0 && dy === 0) ? 4 : (dx === 0 || dy === 0 ? 2 : 1);
        s += src[y * N + x] * w; n += w;
      }
      tmp[k] = s / n;
    }
    src.set(tmp);
  }
}
console.time('erosion');
const land = H.slice();
erode(land, 900000);
for (let k = 0; k < N * N; k++) if (H[k] > 0.5) H[k] = lerp(H[k], land[k], S(0.5, 4, H[k]));
blur(H, 1, (k) => H[k] > 0);
console.timeEnd('erosion');

// ---------- Outils d'échantillonnage ----------
function sampleH(x, z, A = H) {
  const fi = clamp(toI(x), 0, N - 1.001), fj = clamp(toI(z), 0, N - 1.001);
  const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, k = j * N + i;
  return A[k] * (1 - u) * (1 - v) + A[k + 1] * u * (1 - v) + A[k + N] * (1 - u) * v + A[k + N + 1] * u * v;
}
function forEachNear(x0, z0, x1, z1, pad, fn) {
  const i0 = Math.max(0, Math.floor(toI(Math.min(x0, x1) - pad))), i1 = Math.min(N - 1, Math.ceil(toI(Math.max(x0, x1) + pad)));
  const j0 = Math.max(0, Math.floor(toI(Math.min(z0, z1) - pad))), j1 = Math.min(N - 1, Math.ceil(toI(Math.max(z0, z1) + pad)));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(i, j, wx(i), wz(j), j * N + i);
}
function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, wx_ = px - ax, wz_ = pz - az;
  const t = clamp((wx_ * vx + wz_ * vz) / (vx * vx + vz * vz + 1e-9), 0, 1);
  return { d: Math.hypot(px - (ax + vx * t), pz - (az + vz * t)), t };
}

// ---------- Cascade, bassin, rivière ----------
const wet = new Float32Array(N * N);
const dir = (() => { const a = [-0.5, 0.866]; return a; })();
const perp = [-dir[1], dir[0]];
function rayToHeight(target, r0, r1) {
  let best = r0, bd = 1e9;
  for (let r = r0; r <= r1; r += 2) {
    const h = sampleH(V[0] + dir[0] * r, V[1] + dir[1] * r);
    if (Math.abs(h - target) < bd) { bd = Math.abs(h - target); best = r; }
  }
  return best;
}
const rF = rayToHeight(88, 150, 520);
const F = [V[0] + dir[0] * rF, V[1] + dir[1] * rF];
const hF = sampleH(F[0], F[1]);
const rS = rayToHeight(150, 80, rF - 60);
const Sp = [V[0] + dir[0] * rS, V[1] + dir[1] * rS];
// amphithéâtre : tout l'aval proche de la chute est abaissé
const DROP = 26;
forEachNear(F[0] - 260, F[1] - 260, F[0] + 260, F[1] + 260, 0, (i, j, x, z, k) => {
  const u = (x - F[0]) * dir[0] + (z - F[1]) * dir[1];
  const v = (x - F[0]) * perp[0] + (z - F[1]) * perp[1];
  const wide = 34 + Math.max(0, u) * 0.35 + 6 * P4.noise2(u / 20, v / 20);
  const f = S(0.0, 2.6, u) * (1 - S(wide, wide + 22, Math.abs(v))) * (1 - S(80, 230, u));
  H[k] -= DROP * f;
});
const Pc = [F[0] + dir[0] * 13, F[1] + dir[1] * 13];
const poolLevel = Math.min(sampleH(Pc[0], Pc[1]) - 0.8, hF - DROP + 1.0);
const POOL_R = 15;

function makePath(a, b, step, wiggle, seed) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.ceil(L / step));
  const px = -(b[1] - a[1]) / L, pz = (b[0] - a[0]) / L, pts = [];
  for (let s = 0; s <= n; s++) {
    const t = s / n, w = Math.sin(t * Math.PI) * wiggle * P4.noise2(t * 3.3 + seed, seed * 1.7);
    pts.push([lerp(a[0], b[0], t) + px * w, lerp(a[1], b[1], t) + pz * w]);
  }
  return pts;
}
// rivière amont (source -> bord de la chute)
const up = makePath(Sp, F, 4, 14, 3.1);
// rivière aval (bassin -> mer)
let mouthR = rF + 20;
while (mouthR < 1100 && sampleH(V[0] + dir[0] * mouthR, V[1] + dir[1] * mouthR) > -0.8) mouthR += 4;
const M = [V[0] + dir[0] * (mouthR + 25), V[1] + dir[1] * (mouthR + 25)];
const down = makePath(Pc, M, 4, 26, 7.9);

function bedProfile(path, startBed, endMax, depth) {
  const raw = path.map((p) => sampleH(p[0], p[1]));
  const sm = raw.map((_, i) => { let s = 0, n = 0; for (let k = -4; k <= 4; k++) { const q = raw[clamp(i + k, 0, raw.length - 1)]; s += q; n++; } return s / n; });
  const bed = []; let cur = startBed;
  for (let i = 0; i < path.length; i++) {
    const lin = lerp(startBed, endMax, i / (path.length - 1));
    cur = Math.min(cur, Math.min(sm[i] - depth, Math.max(lin, sm[i] - depth - 3)));
    bed.push(cur);
  }
  return bed;
}
const upBed = bedProfile(up, sampleH(Sp[0], Sp[1]) - 1.8, hF - 1.0, 1.6);
upBed[upBed.length - 1] = Math.min(upBed[upBed.length - 1], hF - 1.0);
const downBed = bedProfile(down, poolLevel - 0.7, -1.2, 1.4);

function carve(path, bed, halfW0, halfW1, skip = null) {
  for (let s = 0; s < path.length - 1; s++) {
    const [ax, az] = path[s], [bx, bz] = path[s + 1];
    const hw = lerp(halfW0, halfW1, s / (path.length - 1));
    forEachNear(ax, az, bx, bz, hw + 30, (i, j, x, z, k) => {
      if (skip && skip(x, z)) return;
      const { d, t } = segDist(x, z, ax, az, bx, bz);
      const b = lerp(bed[s], bed[s + 1], t);
      const prof = b + Math.max(0, d - hw) * 0.85 + (d < hw ? -0.35 * (1 - (d / hw) ** 2) : 0);
      if (prof < H[k]) H[k] = prof;
      wet[k] = Math.max(wet[k], 1 - S(hw + 1, hw + 6, d));
    });
  }
}
carve(up, upBed, 3.0, 3.6);
carve(down, downBed, 4.2, 6.5, (x, z) => (x - F[0]) * dir[0] + (z - F[1]) * dir[1] < 2.2);
// bassin
forEachNear(Pc[0], Pc[1], Pc[0], Pc[1], POOL_R + 30, (i, j, x, z, k) => {
  const r = Math.hypot(x - Pc[0], z - Pc[1]);
  if ((x - F[0]) * dir[0] + (z - F[1]) * dir[1] < 2.2) return; // ne pas entamer la falaise
  const prof = r < POOL_R ? poolLevel - 4.5 * (1 - (r / POOL_R) ** 2) - 0.3 : poolLevel - 0.3 + (r - POOL_R) * 0.7;
  if (prof < H[k]) H[k] = prof;
  wet[k] = Math.max(wet[k], 1 - S(POOL_R + 6, POOL_R + 26, r));
});
// zone d'embruns au pied de la chute
forEachNear(F[0], F[1], F[0], F[1], 40, (i, j, x, z, k) => {
  const r = Math.hypot(x - Pc[0], z - Pc[1]);
  wet[k] = Math.max(wet[k], 1 - S(18, 40, r));
});

// ---------- Piste d'aviation ----------
const clear = new Float32Array(N * N);
let strip = null;
{
  let best = null;
  for (let cx = 260; cx <= 620; cx += 20) for (let cz = -260; cz <= 340; cz += 20) for (let ang = -40; ang <= 40; ang += 8) {
    const a = ang * Math.PI / 180, ux = Math.sin(a), uz = Math.cos(a), vx = uz, vz = -ux;
    let s = 0, s2 = 0, n = 0, ok = true;
    for (let l = -190; l <= 190 && ok; l += 10) for (let w = -20; w <= 20; w += 10) {
      const x = cx + ux * l + vx * w, z = cz + uz * l + vz * w, h = sampleH(x, z);
      if (h < 3.5 || h > 40) { ok = false; break; }
      s += h; s2 += h * h; n++;
    }
    if (!ok) continue;
    const mean = s / n, varr = s2 / n - mean * mean;
    if (!best || varr < best.varr) best = { cx, cz, a, mean, varr };
  }
  if (best) {
    const ux = Math.sin(best.a), uz = Math.cos(best.a), vx = uz, vz = -ux;
    const LEN = 190, HW = 16;
    forEachNear(best.cx - 260, best.cz - 260, best.cx + 260, best.cz + 260, 0, (i, j, x, z, k) => {
      const l = (x - best.cx) * ux + (z - best.cz) * uz, w = (x - best.cx) * vx + (z - best.cz) * vz;
      const dOut = Math.max(Math.abs(l) - LEN, 0) + Math.max(Math.abs(w) - HW, 0) * 1.0;
      const dRect = Math.hypot(Math.max(Math.abs(l) - LEN, 0), Math.max(Math.abs(w) - HW, 0));
      const f = 1 - S(0, 28, dRect);
      H[k] = lerp(H[k], best.mean + 0.4 * P4.noise2(x / 30, z / 30), f);
      clear[k] = Math.max(clear[k], 1 - S(10, 32, dRect));
      void dOut;
    });
    strip = { x: best.cx, z: best.cz, y: best.mean, angle: best.a, length: LEN * 2, width: HW * 2 };
  }
}
// clairières
const clearings = [];
for (let tries = 0; clearings.length < 4 && tries < 400; tries++) {
  const x = (rnd() - 0.5) * 1300, z = (rnd() - 0.5) * 1300, h = sampleH(x, z);
  if (h < 12 || h > 90) continue;
  if (Math.hypot(x - F[0], z - F[1]) < 160) continue;
  if (strip && Math.hypot(x - strip.x, z - strip.z) < 300) continue;
  if (clearings.some((c) => Math.hypot(c.x - x, c.z - z) < 300)) continue;
  const r = 30 + rnd() * 28;
  clearings.push({ x, z, r });
  forEachNear(x, z, x, z, r + 30, (i, j, xx, zz, k) => {
    const d = Math.hypot(xx - x, zz - z) * (1 + 0.25 * P4.noise2(xx / 25, zz / 25));
    clear[k] = Math.max(clear[k], 1 - S(r * 0.6, r + 18, d));
  });
}

// ---------- Route côtière (courbe de niveau) + embranchements ----------
function contour(A, level) {
  const segs = [];
  const interp = (x0, z0, v0, x1, z1, v1) => { const t = (level - v0) / (v1 - v0); return [lerp(x0, x1, t), lerp(z0, z1, t)]; };
  const ST = 2; // pas de 2 texels (4 m)
  for (let j = 0; j < N - ST; j += ST) for (let i = 0; i < N - ST; i += ST) {
    const a = A[j * N + i], b = A[j * N + i + ST], c = A[(j + ST) * N + i + ST], d = A[(j + ST) * N + i];
    const x0 = wx(i), z0 = wz(j), x1 = wx(i + ST), z1 = wz(j + ST);
    const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
    if (code === 0 || code === 15) continue;
    const top = () => interp(x0, z0, a, x1, z0, b), right = () => interp(x1, z0, b, x1, z1, c);
    const bottom = () => interp(x0, z1, d, x1, z1, c), left = () => interp(x0, z0, a, x0, z1, d);
    const add = (p, q) => segs.push([p, q]);
    switch (code) {
      case 1: case 14: add(left(), bottom()); break;
      case 2: case 13: add(bottom(), right()); break;
      case 3: case 12: add(left(), right()); break;
      case 4: case 11: add(top(), right()); break;
      case 6: case 9: add(top(), bottom()); break;
      case 7: case 8: add(left(), top()); break;
      case 5: add(left(), top()); add(bottom(), right()); break;
      case 10: add(top(), right()); add(left(), bottom()); break;
    }
  }
  const key = (p) => `${Math.round(p[0] * 8)},${Math.round(p[1] * 8)}`;
  const adj = new Map();
  segs.forEach((s, idx) => { for (const p of s) { const kk = key(p); if (!adj.has(kk)) adj.set(kk, []); adj.get(kk).push(idx); } });
  const used = new Uint8Array(segs.length), lines = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const line = [segs[s0][0], segs[s0][1]];
    for (const end of [1, 0]) {
      for (;;) {
        const tip = end ? line[line.length - 1] : line[0];
        const cand = (adj.get(key(tip)) || []).find((q) => !used[q]);
        if (cand === undefined) break;
        used[cand] = 1;
        const s = segs[cand], nxt = key(s[0]) === key(tip) ? s[1] : s[0];
        if (end) line.push(nxt); else line.unshift(nxt);
      }
    }
    lines.push(line);
  }
  return lines;
}
function resample(line, step, closed) {
  const out = [line[0]];
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = step - acc;
    while (t <= L) { out.push([lerp(a[0], b[0], t / L), lerp(a[1], b[1], t / L)]); t += step; }
    acc = L - (t - step);
  }
  if (closed) out.push(out[0]);
  return out;
}
function smoothLine(pts, iters, closed) {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    p = p.map((q, i) => {
      if (!closed && (i === 0 || i === p.length - 1)) return q;
      const a = p[(i - 1 + p.length) % p.length], b = p[(i + 1) % p.length];
      return [(a[0] + 2 * q[0] + b[0]) / 4, (a[1] + 2 * q[1] + b[1]) / 4];
    });
  }
  return p;
}
const Hb = H.slice(); blur(Hb, 6);
const lines = contour(Hb, 7.5).filter((l) => l.length > 50);
lines.sort((a, b) => b.length - a.length);
let ring = lines.length ? resample(lines[0], 6, true) : [];
ring = smoothLine(ring, 12, true);
const roads = [];
if (ring.length > 10) roads.push({ pts: ring, closed: true, width: 5.2 });
function nearestOn(poly, p) {
  let best = 0, bd = 1e9;
  poly.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i; } });
  return poly[best];
}
// embranchement vers la cascade (s'arrête au bord du bassin)
if (ring.length) {
  const target = [Pc[0] + dir[0] * (POOL_R + 26) + perp[0] * 14, Pc[1] + dir[1] * (POOL_R + 26) + perp[1] * 14];
  const start = nearestOn(ring, target);
  roads.push({ pts: smoothLine(makePath(start, target, 6, 30, 2.2), 3, false), closed: false, width: 4.2 });
}
// embranchement vers la piste d'aviation
if (ring.length && strip) {
  const ux = Math.sin(strip.angle), uz = Math.cos(strip.angle);
  const end = [strip.x - ux * (strip.length / 2 - 20), strip.z - uz * (strip.length / 2 - 20)];
  const start = nearestOn(ring, end);
  if (Math.hypot(start[0] - end[0], start[1] - end[1]) > 20) roads.push({ pts: smoothLine(makePath(start, end, 6, 20, 5.5), 3, false), closed: false, width: 4.6 });
}
const path = new Float32Array(N * N);
for (const road of roads) {
  const pts = road.pts, hw = road.width / 2;
  const raw = pts.map((p) => sampleH(p[0], p[1]));
  const n = raw.length, win = 7;
  let rh = raw.map((_, i) => { let s = 0, c = 0; for (let k = -win; k <= win; k++) { let q = i + k; if (road.closed) q = (q + n) % n; else q = clamp(q, 0, n - 1); s += raw[q]; c++; } return s / c; });
  rh = rh.map((h) => Math.max(h, 0.8));
  const dist = new Float32Array(N * N).fill(1e9), tgt = new Float32Array(N * N);
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
    forEachNear(ax, az, bx, bz, hw + 12, (i, j, x, z, k) => {
      const { d, t } = segDist(x, z, ax, az, bx, bz);
      if (d < dist[k]) { dist[k] = d; tgt[k] = lerp(rh[s], rh[s + 1], t); }
    });
  }
  for (let k = 0; k < N * N; k++) {
    if (dist[k] > hw + 12) continue;
    const f = 1 - S(hw + 0.5, hw + 10, dist[k]);
    if (wet[k] > 0.3) { H[k] = Math.min(H[k], lerp(H[k], tgt[k], f)); }
    else H[k] = lerp(H[k], tgt[k] - 0.15, f);
    path[k] = Math.max(path[k], 1 - S(hw - 0.6, hw + 1.6, dist[k]));
  }
  road.heights = rh;
}

// ---------- Ponton (baie ouest) & point d'apparition (plage sud) ----------
function marchToShore(dx, dz) {
  let r = 100; while (r < 1000 && sampleH(IC[0] + dx * r, IC[1] + dz * r) > 0) r += 1; return r;
}
const rW = marchToShore(-1, 0);
let pierEnd = rW;
while (pierEnd < rW + 70 && sampleH(IC[0] - pierEnd, IC[1]) > -2.2) pierEnd += 1;
const pier = { x0: IC[0] - (rW - 6), z0: IC[1], x1: IC[0] - Math.min(pierEnd, rW + 60), z1: IC[1], deckY: 1.4 };
const rSo = marchToShore(0.12, 1);
let spR = rSo; while (spR > 0 && sampleH(IC[0] + 0.12 * spR, IC[1] + spR) < 1.3) spR -= 1;
spR -= 4;
const spawn = { x: IC[0] + 0.12 * spR, z: IC[1] + spR };
{
  const e = 2, gx = sampleH(spawn.x + e, spawn.z) - sampleH(spawn.x - e, spawn.z), gz = sampleH(spawn.x, spawn.z + e) - sampleH(spawn.x, spawn.z - e);
  let tx = -gz, tz = gx; if (tx < 0) { tx = -tx; tz = -tz; }
  spawn.heading = Math.atan2(tx, tz); // angle autour de Y : 0 = +z
}

// ---------- Nettoyage final ----------
for (let k = 0; k < N * N; k++) H[k] = clamp(H[k], H_MIN + 0.01, H_MAX - 0.01);

// ---------- Occlusion ambiante (horizon) ----------
console.time('ao');
const M2 = N / 2, AO = new Float32Array(M2 * M2);
{
  const dirs = 12, dists = [3, 6, 10, 16, 25, 38, 56, 82, 120, 175, 250];
  for (let j = 0; j < M2; j++) for (let i = 0; i < M2; i++) {
    const x = -W / 2 + (i + 0.5) * CELL * 2, z = -W / 2 + (j + 0.5) * CELL * 2;
    const h0 = sampleH(x, z) + 0.5;
    let occ = 0;
    for (let d = 0; d < dirs; d++) {
      const a = (d / dirs) * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
      let mx = 0;
      for (const r of dists) { const s = (sampleH(x + cx * r, z + cz * r) - h0) / r; if (s > mx) mx = s; }
      occ += mx / Math.sqrt(1 + mx * mx);
    }
    AO[j * M2 + i] = clamp(1 - occ / dirs * 1.1, 0, 1);
  }
}
console.timeEnd('ao');

// ---------- Export ----------
function down2(A) { const out = new Uint8Array(M2 * M2); for (let j = 0; j < M2; j++) for (let i = 0; i < M2; i++) { const k = 2 * j * N + 2 * i; out[j * M2 + i] = Math.round(clamp((A[k] + A[k + 1] + A[k + N] + A[k + N + 1]) / 4, 0, 1) * 255); } return out; }
const hBytes = new Uint16Array(N * N);
for (let k = 0; k < N * N; k++) hBytes[k] = Math.round((H[k] - H_MIN) / (H_MAX - H_MIN) * 65535);
const ao8 = new Uint8Array(M2 * M2); for (let k = 0; k < ao8.length; k++) ao8[k] = Math.round(AO[k] * 255);
const parts = [Buffer.from(hBytes.buffer), Buffer.from(ao8), Buffer.from(down2(path)), Buffer.from(down2(wet)), Buffer.from(down2(clear))];
fs.writeFileSync(OUT + 'terrain.bin', Buffer.concat(parts));

const r2 = (v) => Math.round(v * 100) / 100;
const world = {
  N, W, M: M2, hMin: H_MIN, hMax: H_MAX,
  layout: 'height u16[N*N] (ligne = z), puis u8[M*M] ao, chemin, humide, clairière',
  spawn: { x: r2(spawn.x), y: r2(sampleH(spawn.x, spawn.z)), z: r2(spawn.z), heading: r2(spawn.heading) },
  volcano: { x: V[0], z: V[1], peak: r2(sampleH(V[0] + 60, V[1])), crater: r2(sampleH(V[0], V[1])) },
  waterfall: { lip: [r2(F[0]), r2(upBed[upBed.length - 1] + 0.55), r2(F[1])], dir, width: 6.2, pool: [r2(Pc[0]), r2(poolLevel), r2(Pc[1])], poolR: POOL_R },
  river: [
    { pts: up.map((p, i) => [r2(p[0]), r2(upBed[i] + 0.55), r2(p[1])]), halfW: [3.0, 3.6] },
    { pts: down.map((p, i) => [r2(p[0]), r2(Math.max(downBed[i] + 0.5, i > down.length - 6 ? 0 : -9)), r2(p[1])]), halfW: [4.2, 6.5] },
  ],
  strip: strip && { x: r2(strip.x), y: r2(strip.y), z: r2(strip.z), angle: r2(strip.angle), length: strip.length, width: strip.width },
  pier: { x0: r2(pier.x0), z0: r2(pier.z0), x1: r2(pier.x1), z1: r2(pier.z1), deckY: pier.deckY },
  clearings: clearings.map((c) => ({ x: r2(c.x), z: r2(c.z), r: r2(c.r) })),
  roads: roads.map((r) => ({ closed: r.closed, width: r.width, pts: r.pts.map((p, i) => [r2(p[0]), r2(r.heights[i]), r2(p[1])]) })),
};
fs.writeFileSync(OUT + 'world.json', JSON.stringify(world));
// aperçu (pour vérification)
fs.writeFileSync(OUT + '../tools/.preview_height.f32', Buffer.from(H.buffer));
console.log('spawn', world.spawn, 'waterfall', world.waterfall.lip, 'pool', world.waterfall.pool, 'strip', world.strip, 'pier', world.pier, 'roads', roads.map((r) => r.pts.length));
