// Lieux particuliers choisis sur le relief : campement (base), étangs de jungle (crocodiles),
// criques rocheuses (rochers sur le sable, crabes). Tout est déterministe : mêmes lieux à chaque partie.
import { mulberry32, vnoise } from './core.js';

const S = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

export function chooseSites(T, world) {
  const rnd = mulberry32(2024), sp = world.spawn, st = world.strip, pool = world.waterfall.pool;
  const W = T.W;
  const farFrom = (x, z) => Math.hypot(x - pool[0], z - pool[2]) > 60 && (!st || Math.hypot(x - st.x, z - st.z) > st.length * 0.6);
  // --- campement : coin plat et dégagé près du départ, à côté de la route ---
  let camp = null, best = 1e9;
  for (let k = 0; k < 900; k++) {
    const a = rnd() * Math.PI * 2, d = 26 + rnd() * 50;
    const x = sp.x + Math.cos(a) * d, z = sp.z + Math.sin(a) * d, h = T.height(x, z);
    if (h < 2.6 || h > 12 || T.mask(T.path, x, z) > 0.05) continue;
    let mn = 1e9, mx = -1e9;
    for (let q = 0; q < 12; q++) { const b = q / 12 * Math.PI * 2; const hh = T.height(x + Math.cos(b) * 10, z + Math.sin(b) * 10); mn = Math.min(mn, hh); mx = Math.max(mx, hh); }
    const score = (mx - mn) * 4 + d * 0.02;
    if (score < best && mn > 2.2) { best = score; camp = { x, z, r: 9, y: (mn + mx) / 2 }; }
  }
  // --- étangs : creux de basse jungle, loin des routes ---
  const ponds = [];
  for (let k = 0; k < 6000 && ponds.length < 7; k++) {
    const near = ponds.length < 3;
    const a = rnd() * Math.PI * 2, d = near ? 120 + rnd() * 260 : rnd() * W * 0.4;
    const x = (near ? sp.x : 0) + Math.cos(a) * d, z = (near ? sp.z : 0) + Math.sin(a) * d, h = T.height(x, z);
    if (h < 5 || h > 45 || T.slope(x, z) > 0.12 || !farFrom(x, z)) continue;
    if (camp && Math.hypot(x - camp.x, z - camp.z) < 60) continue;
    if (ponds.some((p) => Math.hypot(p.x - x, p.z - z) < 140)) continue;
    let road = 0;
    for (let q = 0; q < 8; q++) { const b = q / 8 * Math.PI * 2; road = Math.max(road, T.mask(T.path, x + Math.cos(b) * 26, z + Math.sin(b) * 26), T.mask(T.wet, x + Math.cos(b) * 20, z + Math.sin(b) * 20)); }
    if (road > 0.05) continue;
    ponds.push({ x, z, r: 11 + rnd() * 7, seed: rnd() * 100 });
  }
  return { camp, ponds };
}

// Creuse les étangs dans les hauteurs (bord irrégulier) et fixe leur niveau d'eau sous la berge la plus basse
export function carvePonds(T, ponds) {
  const N = T.N, W = T.W, h = T.h, cell = W / N;
  for (const p of ponds) {
    // berge : hauteur minimale autour
    let rim = 1e9;
    for (let q = 0; q < 24; q++) { const b = q / 24 * Math.PI * 2; rim = Math.min(rim, T.height(p.x + Math.cos(b) * (p.r + 3), p.z + Math.sin(b) * (p.r + 3))); }
    p.level = rim - 0.35;
    const R = p.r + 6, i0 = Math.floor((p.x - R + W / 2) / cell), i1 = Math.ceil((p.x + R + W / 2) / cell);
    const j0 = Math.floor((p.z - R + W / 2) / cell), j1 = Math.ceil((p.z + R + W / 2) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * cell - W / 2, z = (j + 0.5) * cell - W / 2;
      const ang = Math.atan2(z - p.z, x - p.x), d = Math.hypot(x - p.x, z - p.z);
      const edge = p.r * (0.78 + 0.38 * vnoise(Math.cos(ang) * 1.6 + p.seed, Math.sin(ang) * 1.6 - p.seed));
      const depth = 1.9 * (1 - S(edge * 0.25, edge * 1.05, d)) + 0.5 * S(edge * 1.25, edge * 0.95, d);
      const bed = p.level - depth + (vnoise(x * 0.3, z * 0.3) - 0.5) * 0.35;
      const q = j * N + i;
      // berge en pente douce jusqu'au lit
      const w = S(edge + 5, edge * 0.9, d);
      h[q] = Math.min(h[q], h[q] * (1 - w) + bed * w);
    }
  }
}

// crique rocheuse : grandes zones de plage couvertes de rochers
export const rockyBeach = (x, z) => vnoise(x / 140 + 7, z / 140 - 3) > 0.6;
