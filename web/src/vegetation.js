// Végétation : 100 types d'arbres (palmiers, feuillus, bananiers, fougères arborescentes…) et 100 types de buissons,
// générés de façon procédurale, placés par dizaines de milliers, avec niveaux de détail et imposteurs au loin.
import * as THREE from 'three';
import { U, GLSL_COMMON, GeoBuilder, mulberry32, patchMaterial, loadTex, clamp, lerp, smoothstep, hash2, vnoise } from './core.js';

const V3 = THREE.Vector3;
const uvr = (r, s, t) => [r[0] + s * r[2], 1 - (r[1] + t * r[3])];
const sub = (r, x, y, w, h) => [r[0] + x * r[2], r[1] + y * r[3], w * r[2], h * r[3]];

// ---------- primitives ----------
function frameAlong(pts) {
  const n = pts.length, T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, n - 1)];
    T.push(new V3().subVectors(b, a).normalize());
  }
  let ref = Math.abs(T[0].y) < 0.9 ? new V3(0, 1, 0) : new V3(1, 0, 0);
  N.push(new V3().crossVectors(T[0], ref).normalize());
  for (let i = 1; i < n; i++) {
    const nn = N[i - 1].clone().addScaledVector(T[i], -N[i - 1].dot(T[i]));
    if (nn.lengthSq() < 1e-8) nn.crossVectors(T[i], ref);
    N.push(nn.normalize());
  }
  for (let i = 0; i < n; i++) B.push(new V3().crossVectors(T[i], N[i]).normalize());
  return { T, N, B };
}
// Tube texturé (écorce répétée dans sa zone d'atlas, lignes dupliquées aux raccords)
function tube(b, pts, radii, sides, rect, tileLen, opt = {}) {
  const { T, N, B } = frameAlong(pts);
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const rows = [];
  const pushRing = (i, t, v) => rows.push({ i, t, v });
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const t0 = Math.floor(s[i - 1] / tileLen), t1 = Math.floor(s[i] / tileLen);
      for (let k = t0 + 1; k <= t1; k++) {
        const ss = k * tileLen, f = (ss - s[i - 1]) / Math.max(s[i] - s[i - 1], 1e-6);
        if (f > 1e-4 && f < 0.9999) { pushRing(i - 1, f, 1); pushRing(i - 1, f, 0); }
      }
    }
    const v = (s[i] / tileLen) % 1;
    pushRing(i, 0, v);
  }
  const ringStart = [];
  const total = s[s.length - 1] || 1;
  for (const row of rows) {
    const i0 = row.i, i1 = Math.min(row.i + 1, pts.length - 1), f = row.t;
    const P = pts[i0].clone().lerp(pts[i1], f);
    const n = N[i0].clone().lerp(N[i1], f).normalize(), bb = B[i0].clone().lerp(B[i1], f).normalize();
    const r = lerp(radii[i0], radii[i1], f);
    const sAt = lerp(s[i0], s[i1], f) / total;
    const ao = lerp(opt.ao0 ?? 0.55, opt.ao1 ?? 1, Math.min(1, sAt * 3));
    const flex = (opt.flex0 ?? 0) + ((opt.flex1 ?? 0.2) - (opt.flex0 ?? 0)) * sAt;
    ringStart.push(b.count);
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const nx = n.x * c + bb.x * sn, ny = n.y * c + bb.y * sn, nz = n.z * c + bb.z * sn;
      const [u, vv] = uvr(rect, k / sides, row.v);
      b.v(P.x + nx * r, P.y + ny * r, P.z + nz * r, nx, ny, nz, u, vv, ao * (opt.tint ?? 1), flex, opt.phase ?? 0);
    }
  }
  for (let j = 0; j < rows.length - 1; j++) {
    if (rows[j].v === 1 && rows[j + 1].v === 0) continue;
    const a0 = ringStart[j], a1 = ringStart[j + 1];
    for (let k = 0; k < sides; k++) b.quad(a0 + k, a0 + k + 1, a1 + k + 1, a1 + k);
  }
  if (opt.cap) {
    const last = ringStart[ringStart.length - 1], P = pts[pts.length - 1], tt = T[T.length - 1];
    const [u, vv] = uvr(rect, 0.5, 0.5);
    const c = b.v(P.x, P.y, P.z, tt.x, tt.y, tt.z, u, vv, 0.8, opt.flex1 ?? 0.2, opt.phase ?? 0);
    for (let k = 0; k < sides; k++) b.tri(last + k, last + k + 1, c);
  }
}
// Carte de feuillage courbée (bande subdivisée) : base -> pointe le long de `dir`, largeur selon `side`
function bentCard(b, base, dir, side, len, wid, rect, opt = {}) {
  const segs = opt.segs ?? 3, droop = opt.droop ?? 0, up = new V3().crossVectors(side, dir).normalize();
  const center = opt.center, nb = opt.normalBlend ?? 0.55;
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const P = base.clone().addScaledVector(dir, t * len);
    P.y -= droop * t * t * len;
    const tangent = dir.clone().multiplyScalar(len); tangent.y -= 2 * droop * t * len; tangent.normalize();
    const nrm = new V3().crossVectors(side, tangent).normalize();
    if (nrm.y < 0 && !opt.keepNormal) nrm.negate();
    for (let j = 0; j < 2; j++) {
      const sj = j === 0 ? -0.5 : 0.5;
      const Q = P.clone().addScaledVector(side, sj * wid * (opt.taper ? 1 - t * opt.taper : 1));
      let n = nrm.clone();
      if (center) { const rad = Q.clone().sub(center).normalize(); n.lerp(rad, nb).normalize(); }
      const [u, v] = opt.flipUV ? uvr(rect, j, 1 - t) : uvr(rect, opt.alongU ? t : j, opt.alongU ? (j === 0 ? 0 : 1) : 1 - t);
      const ao = opt.aoFn ? opt.aoFn(Q) : 1;
      idx.push(b.v(Q.x, Q.y, Q.z, n.x, n.y, n.z, u, v, ao, (opt.flex0 ?? 0.3) + t * (opt.flexT ?? 0.6), opt.phase ?? 0));
    }
  }
  for (let i = 0; i < segs; i++) b.quad(idx[i * 2], idx[i * 2 + 1], idx[i * 2 + 3], idx[i * 2 + 2]);
  void up;
}
// Grappe de feuilles : deux cartes croisées
function cluster(b, c, size, rect, rnd, crownC, aoFn, phase) {
  const a = rnd() * Math.PI;
  for (let k = 0; k < 2; k++) {
    const ang = a + k * Math.PI / 2;
    const side = new V3(Math.cos(ang), (rnd() - 0.5) * 0.4, Math.sin(ang)).normalize();
    const dir = new V3(-side.z * 0.3, 1, side.x * 0.3).normalize().applyAxisAngle(side, (rnd() - 0.5) * 0.9);
    const base = c.clone().addScaledVector(dir, -size * 0.5);
    bentCard(b, base, dir, side, size, size, rect, { segs: 1, center: crownC, normalBlend: 0.7, aoFn, flex0: 0.5, flexT: 0.4, phase });
  }
}
function icosa(b, c, r, rect, ao, flex, phase) {
  const g = new THREE.IcosahedronGeometry(r, 0);
  const p = g.attributes.position.array, base = b.count;
  for (let i = 0; i < p.length / 3; i++) {
    const n = new V3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).normalize();
    const [u, v] = uvr(rect, 0.5 + n.x * 0.45, 0.5 + n.y * 0.45);
    b.v(c.x + p[i * 3], c.y + p[i * 3 + 1], c.z + p[i * 3 + 2], n.x, n.y, n.z, u, v, ao, flex, phase);
  }
  for (let i = 0; i < p.length / 3; i += 3) b.tri(base + i, base + i + 1, base + i + 2);
}

// ---------- générateurs ----------
function makePalm(A, seed, young) {
  const rnd = mulberry32(seed), b = new GeoBuilder();
  const H = young ? 0.2 + rnd() * 1.6 : 7 + rnd() * 15;
  const lean = young ? 0 : 0.05 + rnd() * rnd() * 0.5;
  const curve = (rnd() - 0.3) * 0.5;
  const pts = [], radii = [];
  const NS = young ? 3 : 8;
  const rTop = young ? 0.14 : 0.13 + rnd() * 0.05, rBase = rTop * (1.35 + rnd() * 0.3);
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    const x = Math.sin(lean) * H * (t + curve * t * (1 - t) * 2) * 0.95;
    pts.push(new V3(x, H * t * Math.cos(lean * 0.6) + (young ? 0 : 0), (rnd() - 0.5) * 0.08 * H * t));
    radii.push(lerp(rBase, rTop, Math.pow(t, 0.6)) + rBase * 0.55 * Math.exp(-t * 14));
  }
  pts[0].set(0, -0.3, 0);
  tube(b, pts, radii, young ? 5 : 7, A.palmBark, 0.95, { ao0: 0.45, ao1: 0.95, flex0: 0, flex1: young ? 0.15 : 0.22, tint: 1 });
  const top = pts[pts.length - 1].clone();
  const crownC = top.clone();
  const nF = young ? 6 + Math.floor(rnd() * 5) : 14 + Math.floor(rnd() * 11);
  const L = young ? 1.4 + rnd() * 1.6 : 3.8 + rnd() * 1.9;
  const yellowish = rnd();
  const golden = 2.39996;
  for (let k = 0; k < nF; k++) {
    const age = k / nF; // 0 = jeune (haut), 1 = vieille (bas)
    const az = k * golden + rnd() * 0.3;
    const el = young ? lerp(1.15, 0.35, age) + (rnd() - 0.5) * 0.2 : lerp(1.05, -0.45, age) + (rnd() - 0.5) * 0.25;
    const dir = new V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const len = L * (0.75 + 0.25 * Math.sin(Math.min(1, age * 1.4 + 0.2) * Math.PI)) * (0.9 + rnd() * 0.2);
    const droop = (young ? 0.15 : 0.35 + age * 0.45) * (0.8 + rnd() * 0.5);
    const base = top.clone().addScaledVector(dir, 0.15);
    base.y -= age * 0.35;
    const rect = age > 0.85 && rnd() < 0.5 ? A.frondYellow : yellowish > 0.75 && rnd() < 0.4 ? A.frondYellow : young ? A.frondYoung : A.frondGreen;
    frond(b, base, dir, len, droop, rect, rnd, crownC, k);
  }
  if (!young) {
    const nDead = Math.floor(rnd() * rnd() * 4);
    for (let k = 0; k < nDead; k++) {
      const az = rnd() * Math.PI * 2;
      const dir = new V3(Math.cos(az) * 0.35, -0.9, Math.sin(az) * 0.35).normalize();
      frond(b, top.clone().add(new V3(0, -0.3, 0)), dir, L * 0.8, 0.05, A.frondDead, rnd, crownC, k + 40);
    }
    const nCoco = rnd() < 0.75 ? 2 + Math.floor(rnd() * 7) : 0;
    for (let k = 0; k < nCoco; k++) {
      const az = rnd() * Math.PI * 2, rr = 0.22 + rnd() * 0.16;
      icosa(b, top.clone().add(new V3(Math.cos(az) * rr, -0.35 - rnd() * 0.45, Math.sin(az) * rr)), 0.11 + rnd() * 0.04, A.coconut, 0.7, 0.25, 0);
    }
  }
  return { b, h: H + L * 0.5, trunkR: rBase * 1.1, crownR: young ? L * 0.7 : L * 0.9, kind: young ? 'young' : 'palm' };
}
function frond(b, base, dir, len, droop, rect, rnd, crownC, k) {
  const SEG = 5, vA = 0.35 + rnd() * 0.35, wid = len * 0.24;
  const sp = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const P = base.clone().addScaledVector(dir, t * len);
    P.y -= droop * t * t * len;
    sp.push(P);
  }
  const ph = rnd();
  for (const sgn of [-1, 1]) {
    const idx = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const a = sp[Math.max(i - 1, 0)], c = sp[Math.min(i + 1, SEG)];
      const tg = new V3().subVectors(c, a).normalize();
      const side = new V3().crossVectors(tg, new V3(0, 1, 0));
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize().multiplyScalar(sgn);
      const fu = new V3().crossVectors(side.clone().multiplyScalar(sgn), tg).normalize();
      const off = side.clone().multiplyScalar(Math.cos(vA)).addScaledVector(fu, -Math.sin(vA));
      const w = wid * (t < 0.08 ? t / 0.08 : 1) * (1 - t * 0.25);
      const P = sp[i], Q = P.clone().addScaledVector(off, w);
      const n = fu.clone().lerp(Q.clone().sub(crownC).normalize(), 0.45).normalize();
      const ao = 0.62 + 0.38 * Math.min(1, P.distanceTo(crownC) / (len * 0.8));
      const [u0, v0] = uvr(rect, t, 0.0), [u1, v1] = uvr(rect, t, 1.0);
      const flex = 0.25 + t * 0.75;
      idx.push(b.v(P.x, P.y, P.z, n.x, n.y, n.z, u0, v0, ao, flex, ph), b.v(Q.x, Q.y, Q.z, n.x, n.y, n.z, u1, v1, ao, flex, ph));
    }
    for (let i = 0; i < SEG; i++) b.quad(idx[i * 2], idx[i * 2 + 1], idx[i * 2 + 3], idx[i * 2 + 2]);
  }
  void k;
}

// Feuillus : tronc + branches récursives + grappes de feuilles
function makeBroadleaf(A, seed, arch) {
  const rnd = mulberry32(seed), b = new GeoBuilder();
  const P = {
    almond: { h: [5, 9], r: [0.18, 0.28], crownR: [4, 7], flat: 0.55, tiers: true, leaf: A.clusterB, csize: [1.4, 2.0], n: 34 },
    mango: { h: [3, 5], r: [0.25, 0.4], crownR: [5, 7.5], flat: 0.8, leaf: A.clusterA, csize: [1.6, 2.3], n: 52 },
    breadfruit: { h: [4, 7], r: [0.2, 0.32], crownR: [3.5, 5.5], flat: 0.9, leaf: A.anthurium, csize: [1.6, 2.2], n: 30 },
    banyan: { h: [3.5, 5], r: [0.45, 0.7], crownR: [7, 10], flat: 0.5, leaf: A.clusterA, csize: [1.8, 2.6], n: 64, roots: true },
    flame: { h: [3.5, 5.5], r: [0.2, 0.3], crownR: [5, 7.5], flat: 0.38, leaf: A.clusterC || A.fern, csize: [1.6, 2.2], n: 40, flowers: true },
    hibiscusT: { h: [1.5, 2.5], r: [0.1, 0.16], crownR: [2.2, 3.2], flat: 0.85, leaf: A.clusterB, csize: [1.0, 1.5], n: 22, flowers: true },
  }[arch];
  const H = lerp(P.h[0], P.h[1], rnd()), R0 = lerp(P.r[0], P.r[1], rnd()), CR = lerp(P.crownR[0], P.crownR[1], rnd());
  const crownY = H + CR * P.flat * 0.75;
  const crownC = new V3(0, crownY, 0);
  const trunk = [], tr = [];
  const lx = (rnd() - 0.5) * 0.6, lz = (rnd() - 0.5) * 0.6;
  for (let i = 0; i <= 6; i++) { const t = i / 6; trunk.push(new V3(lx * t * t * H * 0.3, -0.3 + t * (H + 0.3), lz * t * t * H * 0.3)); tr.push(R0 * (1 - t * 0.35) + R0 * 0.7 * Math.exp(-t * 10)); }
  tube(b, trunk, tr, 6, A.treeBark, 1.6, { ao0: 0.4, ao1: 0.85, flex0: 0, flex1: 0.08 });
  const top = trunk[trunk.length - 1];
  const leaves = [];
  const branch = (start, dir, len, rad, depth, ph) => {
    const pts = [], rr = [];
    const bend = new V3((rnd() - 0.5) * 0.4, 0.15 + rnd() * 0.2, (rnd() - 0.5) * 0.4);
    const nseg = depth === 0 ? 3 : 2;
    for (let i = 0; i <= nseg; i++) {
      const t = i / nseg;
      pts.push(start.clone().addScaledVector(dir, t * len).addScaledVector(bend, t * t * len * 0.35));
      rr.push(rad * (1 - t * 0.6));
    }
    tube(b, pts, rr, depth === 0 ? 5 : 3, A.treeBark, 1.6, { ao0: 0.55, ao1: 0.9, flex0: 0.08 + depth * 0.15, flex1: 0.25 + depth * 0.2, phase: ph });
    const end = pts[pts.length - 1];
    if (depth < 2) {
      const nc = 2 + (rnd() < 0.5 ? 1 : 0);
      for (let c = 0; c < nc; c++) {
        const d2 = dir.clone().add(new V3((rnd() - 0.5) * 1.3, (rnd() - 0.2) * 0.7, (rnd() - 0.5) * 1.3)).normalize();
        branch(end, d2, len * (0.55 + rnd() * 0.2), rad * 0.55, depth + 1, ph + c * 0.13);
      }
    } else leaves.push({ p: end, ph });
  };
  const nb = 3 + Math.floor(rnd() * 3);
  for (let k = 0; k < nb; k++) {
    const az = (k / nb) * Math.PI * 2 + rnd() * 0.5;
    const el = P.tiers ? 0.12 + rnd() * 0.15 : 0.45 + rnd() * 0.35;
    const dir = new V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const start = P.tiers ? trunk[3 + (k % 3)].clone() : top.clone();
    branch(start, dir, CR * (P.tiers ? 0.6 : 0.5), R0 * 0.55, 0, rnd());
  }
  // racines aériennes (banian)
  if (P.roots) {
    for (let k = 0; k < 9; k++) {
      const az = rnd() * Math.PI * 2, rr = CR * (0.35 + rnd() * 0.5);
      const x = Math.cos(az) * rr, z = Math.sin(az) * rr;
      tube(b, [new V3(x, -0.2, z), new V3(x * 0.98, H * 0.6, z * 0.98), new V3(x * 0.95, H + CR * 0.2, z * 0.95)], [0.07, 0.05, 0.04], 4, A.treeBark, 1.6, { ao0: 0.5, ao1: 0.7, flex0: 0, flex1: 0.05 });
    }
  }
  // feuillage : grappes aux extrémités + remplissage de la couronne
  const aoFn = (q) => 0.5 + 0.5 * clamp(q.distanceTo(crownC) / CR, 0, 1);
  const cs = () => lerp(P.csize[0], P.csize[1], rnd());
  for (const l of leaves) cluster(b, l.p, cs(), P.leaf, rnd, crownC, aoFn, l.ph);
  for (let k = 0; k < P.n - leaves.length; k++) {
    const u = rnd() * Math.PI * 2, v = Math.acos(rnd() * 2 - 1), r = Math.pow(rnd(), 0.4);
    const q = new V3(Math.sin(v) * Math.cos(u) * CR * r, Math.cos(v) * CR * P.flat * r, Math.sin(v) * Math.sin(u) * CR * r).add(crownC);
    if (q.y < H * 0.85) q.y = H * 0.85 + rnd() * 0.5;
    cluster(b, q, cs(), P.leaf, rnd, crownC, aoFn, rnd());
  }
  if (P.flowers) {
    const fr = A.flowers, qd = Math.floor(rnd() * 4);
    const frect = sub(fr, (qd % 2) * 0.5, Math.floor(qd / 2) * 0.5, 0.5, 0.5);
    for (let k = 0; k < (arch === 'flame' ? 26 : 12); k++) {
      const u = rnd() * Math.PI * 2, r = CR * (0.5 + rnd() * 0.5);
      const q = new V3(Math.cos(u) * r, crownY + CR * P.flat * (0.2 + rnd() * 0.5), Math.sin(u) * r);
      cluster(b, q, arch === 'flame' ? 0.9 : 0.5, frect, rnd, crownC, () => 1, rnd());
    }
  }
  return { b, h: crownY + CR * P.flat, trunkR: R0 * 1.3, crownR: CR, kind: 'tree' };
}
function makePandanus(A, seed) {
  const rnd = mulberry32(seed), b = new GeoBuilder();
  const H = 3 + rnd() * 4, R0 = 0.11 + rnd() * 0.05;
  const lean = (rnd() - 0.5) * 0.5;
  const base = new V3(0, 1.2 + rnd() * 0.6, 0);
  const trunk = [base.clone(), new V3(lean * H * 0.3, H * 0.6, 0), new V3(lean * H * 0.5, H, 0)];
  tube(b, trunk, [R0, R0 * 0.9, R0 * 0.8], 6, A.treeBark, 1.4, { ao0: 0.5, ao1: 0.9, flex1: 0.1, tint: 0.9 });
  for (let k = 0; k < 5 + Math.floor(rnd() * 4); k++) {
    const az = rnd() * Math.PI * 2, rr = 0.6 + rnd() * 0.9;
    tube(b, [base.clone().add(new V3(0, rnd() * 0.5, 0)), new V3(Math.cos(az) * rr * 0.6, base.y * 0.5, Math.sin(az) * rr * 0.6), new V3(Math.cos(az) * rr, -0.2, Math.sin(az) * rr)], [0.05, 0.045, 0.04], 4, A.treeBark, 1.4, { ao0: 0.6, ao1: 0.7 });
  }
  const tops = [trunk[2]];
  for (let k = 0; k < Math.floor(rnd() * 3); k++) {
    const az = rnd() * Math.PI * 2;
    const e = trunk[2].clone().add(new V3(Math.cos(az) * 1.3, 0.9, Math.sin(az) * 1.3));
    tube(b, [trunk[1].clone().lerp(trunk[2], 0.6), e], [R0 * 0.7, R0 * 0.5], 5, A.treeBark, 1.4, { ao0: 0.7, ao1: 0.9, flex0: 0.1, flex1: 0.25 });
    tops.push(e);
  }
  const crownC = trunk[2].clone();
  for (const t of tops) {
    for (let k = 0; k < 9; k++) {
      const az = (k / 9) * Math.PI * 2 + rnd() * 0.4, el = 0.2 + rnd() * 0.9;
      const dir = new V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      const side = new V3(-Math.sin(az), 0, Math.cos(az));
      bentCard(b, t.clone(), dir, side, 1.4 + rnd() * 0.6, 0.55, A.grass, { segs: 3, droop: 0.35, center: crownC, flex0: 0.3, flexT: 0.6, phase: rnd(), alongU: false });
    }
  }
  return { b, h: H + 1.5, trunkR: 0.5, crownR: 2.6, kind: 'tree' };
}
function makeTreeFern(A, seed) {
  const rnd = mulberry32(seed), b = new GeoBuilder();
  const H = 2.5 + rnd() * 4.5, R0 = 0.1 + rnd() * 0.05;
  const pts = [], rr = [];
  for (let i = 0; i <= 5; i++) { const t = i / 5; pts.push(new V3((rnd() - 0.5) * 0.15 * t, -0.2 + t * (H + 0.2), (rnd() - 0.5) * 0.15 * t)); rr.push(R0 * (1.25 - t * 0.3)); }
  tube(b, pts, rr, 6, A.treeBark, 1.2, { ao0: 0.4, ao1: 0.6, flex1: 0.15, tint: 0.7 });
  const top = pts[5];
  const n = 10 + Math.floor(rnd() * 6);
  for (let k = 0; k < n; k++) {
    const az = k / n * Math.PI * 2 + rnd() * 0.3, el = 0.55 + rnd() * 0.5;
    const dir = new V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const side = new V3(-Math.sin(az), 0, Math.cos(az));
    bentCard(b, top.clone(), dir, side, 2.2 + rnd() * 1.0, 1.1, A.fern, { segs: 4, droop: 0.55, center: top, flex0: 0.3, flexT: 0.7, phase: rnd() });
  }
  return { b, h: H + 1.5, trunkR: R0 * 1.4, crownR: 2.4, kind: 'tree' };
}
function makeBanana(A, seed, scale = 1) {
  const rnd = mulberry32(seed), b = new GeoBuilder();
  const H = (2.2 + rnd() * 2.2) * scale, R0 = (0.13 + rnd() * 0.05) * scale;
  const pts = [new V3(0, -0.2, 0), new V3(0, H * 0.5, 0), new V3(0, H, 0)];
  tube(b, pts, [R0 * 1.2, R0, R0 * 0.8], 7, A.palmBark, 0.9, { ao0: 0.5, ao1: 0.8, flex1: 0.12, tint: 0.85 });
  const top = pts[2];
  const n = 6 + Math.floor(rnd() * 5);
  for (let k = 0; k < n; k++) {
    const az = k * 2.4 + rnd() * 0.3, el = 0.9 - (k / n) * 0.8 + rnd() * 0.15;
    const dir = new V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const side = new V3(-Math.sin(az), 0, Math.cos(az));
    const len = (1.6 + rnd() * 1.2) * scale;
    bentCard(b, top.clone().addScaledVector(dir, 0.2 * scale), dir, side, len, len * 0.42, A.banana, { segs: 5, droop: 0.45, center: top, flex0: 0.3, flexT: 0.7, phase: rnd(), alongU: true });
  }
  return { b, h: H + 1.4 * scale, trunkR: R0 * 1.5, crownR: 1.8 * scale, kind: 'tree' };
}
function makeDead(A, seed) {
  const rnd = mulberry32(seed), b = new GeoBuilder();
  const H = 5 + rnd() * 6, R0 = 0.2 + rnd() * 0.15;
  const pts = [], rr = [];
  for (let i = 0; i <= 5; i++) { const t = i / 5; pts.push(new V3((rnd() - 0.5) * 0.6 * t, -0.2 + t * H, (rnd() - 0.5) * 0.6 * t)); rr.push(R0 * (1 - t * 0.6)); }
  tube(b, pts, rr, 6, A.treeBark, 1.6, { ao0: 0.5, ao1: 0.9, tint: 1.25 });
  for (let k = 0; k < 4 + Math.floor(rnd() * 4); k++) {
    const s = pts[2 + Math.floor(rnd() * 3)].clone(), az = rnd() * Math.PI * 2;
    const e = s.clone().add(new V3(Math.cos(az) * (1.5 + rnd() * 2), 0.8 + rnd() * 1.6, Math.sin(az) * (1.5 + rnd() * 2)));
    tube(b, [s, s.clone().lerp(e, 0.5).add(new V3(0, 0.3, 0)), e], [R0 * 0.4, R0 * 0.3, R0 * 0.12], 4, A.treeBark, 1.6, { ao0: 0.8, ao1: 1, tint: 1.25, flex1: 0.1 });
  }
  return { b, h: H + 1, trunkR: R0 * 1.3, crownR: 2, kind: 'tree' };
}

// ---------- grands arbres de la jungle ----------
// Fût tortueux évasé à la base (contreforts), grosses branches qui partent en biais puis se redressent,
// couronne faite de dômes de feuillage au bout des branches : des gerbes de rameaux qui rayonnent vers
// l'extérieur (vues d'en dessous, elles ferment la voûte) et, sur les bords, des rameaux qui retombent.
// Les styles « penchés » (lean > 0) ont leur couronne décalée vers +X : au bord des pistes, ils forment un tunnel.
// r : rayon du fût, fork : hauteur de la fourche, limbs : maîtresses branches, el : écart à la verticale (rad),
// len : longueur des branches, sub : rameaux secondaires par branche, cr : rayon d'un dôme de feuillage
export const GIANT_STYLES = [
  { name: 'parasol', r: 0.6, fork: 4.6, limbs: 3, el: [0.85, 1.1], len: [7, 8.5], sub: 2, cr: 3.2, lean: 0 },
  { name: 'fourche', r: 0.56, fork: 6.5, limbs: 2, el: [0.5, 0.72], len: [8, 9.5], sub: 3, cr: 3.1, lean: 0 },
  { name: 'banian', r: 0.4, fork: 5.2, limbs: 2, el: [0.6, 0.95], len: [6, 7.2], sub: 2, cr: 2.9, lean: 0, stems: 3 },
  { name: 'émergent', r: 0.5, fork: 10, limbs: 4, el: [0.75, 1.0], len: [5.5, 6.5], sub: 2, cr: 3.0, lean: 0 },
  { name: 'penché', r: 0.52, fork: 4.4, limbs: 3, el: [0.9, 1.2], len: [6.5, 8], sub: 2, cr: 3.1, lean: 0.4 },
  { name: 'arche', r: 0.5, fork: 3.6, limbs: 3, el: [1.0, 1.3], len: [7.5, 9], sub: 2, cr: 3.1, lean: 0.55 },
];
// Ligne tortueuse : part de p0 vers d0, se redresse (rise > 0) peu à peu, avec des coudes aléatoires
function gnarl(rnd, p0, d0, len, n, rise, kink) {
  const pts = [p0.clone()], d = d0.clone().normalize(), p = p0.clone();
  for (let i = 1; i <= n; i++) {
    d.x += (rnd() - 0.5) * kink; d.z += (rnd() - 0.5) * kink; d.y += rise + (rnd() - 0.5) * kink * 0.4;
    d.normalize();
    p.addScaledVector(d, len / n);
    pts.push(p.clone());
  }
  return pts;
}
function makeGiant(A, seed, style) {
  const S = GIANT_STYLES[style % GIANT_STYLES.length];
  const rnd = mulberry32(seed), b = new GeoBuilder();
  const bark = A.treeBark, r = S.r * (0.92 + rnd() * 0.16);
  const tips = []; // bouts de branches : centres des dômes de feuillage
  const dirAt = (pts, i) => pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
  // maîtresse branche + rameaux secondaires ; az : direction (rad), el : écart à la verticale
  const limb = (start, az, el, len, rl, ph) => {
    const d = new V3(Math.cos(az) * Math.sin(el), Math.cos(el), Math.sin(az) * Math.sin(el));
    const pts = gnarl(rnd, start, d, len, 3, 0.1, 0.32);
    tube(b, pts, [rl, rl * 0.78, rl * 0.58, rl * 0.4], 6, bark, 2.8, { ao0: 0.62, ao1: 0.9, flex0: 0.04, flex1: 0.16, phase: ph });
    tips.push({ p: pts[3], k: 0.9 });
    // dôme à mi-branche (pas trop bas au-dessus d'une piste pour les arbres penchés)
    if (!S.lean || pts[2].y > 6.8) tips.push({ p: pts[2], k: 0.8 });
    for (let s = 0; s < S.sub; s++) {
      const i = s === 0 ? 3 : 2, p0 = pts[i - 1].clone().lerp(pts[i], 0.7), dd = dirAt(pts, i);
      const a2 = Math.atan2(dd.z, dd.x) + (s % 2 ? 1 : -1) * (0.6 + rnd() * 0.5);
      const e2 = clamp(Math.acos(clamp(dd.y, -1, 1)) + (rnd() - 0.6) * 0.5, 0.35, 1.35);
      const d2 = new V3(Math.cos(a2) * Math.sin(e2), Math.cos(e2), Math.sin(a2) * Math.sin(e2));
      const q = gnarl(rnd, p0, d2, len * (0.42 + rnd() * 0.15), 2, 0.12, 0.35);
      tube(b, q, [rl * 0.42, rl * 0.28, rl * 0.12], 4, bark, 2.8, { ao0: 0.75, ao1: 0.95, flex0: 0.14, flex1: 0.3, phase: ph + 0.3 * s });
      if (!S.lean || q[2].y > 6) tips.push({ p: q[2], k: 1 });
    }
  };
  // fût(s) : du sol à la fourche, évasé à la base, penché vers +X pour les styles « penchés »
  const nStems = S.stems || 1, forks = [];
  for (let st = 0; st < nStems; st++) {
    const a0 = (st / nStems) * Math.PI * 2 + rnd() * 0.5, off = nStems > 1 ? r * 0.9 : 0;
    const tilt = S.lean ? S.lean : nStems > 1 ? 0.18 + rnd() * 0.12 : rnd() * 0.12;
    const az = S.lean ? (rnd() - 0.5) * 0.3 : nStems > 1 ? a0 : rnd() * Math.PI * 2;
    const d0 = new V3(Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt));
    const base = new V3(Math.cos(a0) * off, 0.5, Math.sin(a0) * off);
    const L = S.fork * (0.9 + rnd() * 0.2) / Math.cos(tilt * 0.7);
    const pts = [new V3(base.x * 0.6, -0.5, base.z * 0.6), ...gnarl(rnd, base, d0, L, 4, S.lean ? 0.05 : 0.02, nStems > 1 ? 0.3 : 0.22)];
    const rr = nStems > 1 ? [r * 1.9, r * 1.35, r * 1.1, r, r * 0.95, r * 0.9] : [r * 2.1, r * 1.45, r * 1.15, r * 1.02, r * 0.95, r * 0.88];
    tube(b, pts, rr, nStems > 1 ? 7 : 9, bark, 3.0, { ao0: 0.45, ao1: 0.88, flex1: 0.03 });
    forks.push({ p: pts[pts.length - 1], q: pts[pts.length - 2], a0 });
  }
  // contreforts : racines plates qui partent du fût et plongent dans le sol
  const rB = nStems > 1 ? r * 1.6 : r, nR = 3 + Math.floor(rnd() * 3);
  for (let q = 0; q < nR; q++) {
    const a = (q / nR) * Math.PI * 2 + rnd() * 0.7, ca = Math.cos(a), sa = Math.sin(a), L = 1.5 + rnd() * 1.4;
    tube(b, [new V3(ca * rB * 0.5, 1.6 + rnd() * 0.7, sa * rB * 0.5), new V3(ca * (rB + L * 0.45), 0.45, sa * (rB + L * 0.45)), new V3(ca * (rB + L), -0.3, sa * (rB + L))],
      [rB * 0.42, rB * 0.27, rB * 0.09], 5, bark, 1.6, { ao0: 0.5, ao1: 0.72 });
  }
  // maîtresses branches : en biais depuis la fourche ; vers la piste (+X) pour les arbres penchés
  for (const f of forks) {
    const nL = S.limbs, rl = r * (nL === 2 ? 0.74 : 0.62) * (nStems > 1 ? 0.9 : 1);
    const start = f.q.clone().lerp(f.p, 0.75);
    for (let k = 0; k < nL; k++) {
      let az = nStems > 1 ? f.a0 + (k - (nL - 1) / 2) * 1.3 + (rnd() - 0.5) * 0.5 : (k / nL) * Math.PI * 2 + rnd() * 0.8;
      let el = lerp(S.el[0], S.el[1], rnd());
      // arbre penché : toutes les branches vont vers +X sauf une, plus courte, qui équilibre vers l'arrière
      if (S.lean) { az = k === nL - 1 ? Math.PI + (rnd() - 0.5) * 0.8 : (k - (nL - 2) / 2) * 1.1 + (rnd() - 0.5) * 0.4; if (k === nL - 1) el *= 0.6; }
      const len = lerp(S.len[0], S.len[1], rnd()) * (S.lean && k === nL - 1 ? 0.5 : 1);
      limb(start, az, el, len, rl, rnd());
    }
  }
  // racines aériennes du banian
  if (nStems > 1) for (let k = 0; k < 3; k++) {
    const t = tips[Math.floor(rnd() * tips.length)].p, x = t.x * (0.45 + rnd() * 0.3), z = t.z * (0.45 + rnd() * 0.3);
    tube(b, [new V3(x * 1.08, -0.3, z * 1.08), new V3(x + (rnd() - 0.5) * 0.6, t.y * 0.4, z + (rnd() - 0.5) * 0.6), new V3(x * 0.97, t.y * 0.78, z * 0.97)], [0.09, 0.05, 0.04], 4, bark, 2.8, { ao0: 0.55, ao1: 0.7 });
  }
  // couronne : centre, rayon, puis dômes de feuillage
  const crownC = new V3();
  for (const t of tips) crownC.add(t.p);
  crownC.multiplyScalar(1 / tips.length);
  // deux dômes au centre pour fermer la voûte au-dessus de la fourche
  for (let k = 0; k < 3; k++) tips.push({ p: crownC.clone().add(new V3((rnd() - 0.5) * 4, 1.2 + rnd() * 1.4, (rnd() - 0.5) * 4)), k: 0.95 });
  let CR = 0, yMin = 1e9, yMax = -1e9;
  for (const t of tips) { CR = Math.max(CR, Math.hypot(t.p.x - crownC.x, t.p.z - crownC.z)); yMin = Math.min(yMin, t.p.y); yMax = Math.max(yMax, t.p.y); }
  CR += S.cr;
  const aoFn = (q) => {
    const rad = clamp(Math.hypot(q.x - crownC.x, q.z - crownC.z) / CR, 0, 1), up = clamp((q.y - yMin + S.cr) / (yMax - yMin + S.cr * 2), 0, 1);
    return 0.52 + 0.48 * clamp(rad * 0.55 + up * 0.6, 0, 1);
  };
  const main = rnd() < 0.6 ? A.clusterA : A.clusterB, other = main === A.clusterA ? A.clusterB : A.clusterA;
  const HUES = [[1, 1, 1], [1.08, 1.05, 0.78], [0.95, 1.02, 0.85], [1.02, 1.04, 0.9]];
  for (const t of tips) {
    const c = t.p.clone(), cr = S.cr * t.k * (0.9 + rnd() * 0.25);
    c.y += cr * 0.25;
    const out = c.clone().sub(crownC); out.y = 0;
    if (out.lengthSq() < 0.01) out.set(rnd() - 0.5, 0, rnd() - 0.5);
    out.normalize();
    const nrmC = c.clone().lerp(crownC, 0.5);
    const v0 = b.count, ph = rnd(), N = 10;
    // arbre penché : les dômes bas (au-dessus de la piste) ne retombent pas, pour laisser passer le buggy
    const eMin = S.lean && c.y < 9 ? 0.05 : -0.45;
    for (let k = 0; k < N; k++) {
      // gerbes réparties sur un dôme, plutôt vers l'extérieur de la couronne ; les plus basses retombent
      const az = (k / N) * Math.PI * 2 + rnd() * 0.7, e = k === 0 ? 1.35 : lerp(eMin, 1.1, rnd());
      const d = new V3(Math.cos(az) * Math.cos(e), Math.sin(e), Math.sin(az) * Math.cos(e)).addScaledVector(out, 0.55).normalize();
      const low = d.y < 0.15;
      const side = Math.abs(d.y) > 0.97 ? new V3(Math.cos(az), 0, Math.sin(az)) : new V3(-d.z, 0, d.x).normalize();
      side.applyAxisAngle(d, (rnd() - 0.5) * 1.5); // roulis : de « à plat » à « de chant »
      const len = cr * (1.45 + rnd() * 0.35);
      bentCard(b, c.clone().addScaledVector(d, -cr * 0.3), d, side, len, len * (0.95 + rnd() * 0.15), rnd() < 0.78 ? main : other,
        { segs: low ? 2 : 1, droop: low ? 0.3 + rnd() * 0.25 : 0, center: nrmC, normalBlend: 0.6, aoFn, flex0: 0.35, flexT: 0.55, phase: ph });
    }
    // teinte du dôme : vert profond, olive ou jaune-vert (variété naturelle, jamais fluo)
    const hue = HUES[Math.floor(rnd() * HUES.length)];
    for (let i = v0; i < b.count; i++) { b.c[i * 3] *= hue[0]; b.c[i * 3 + 1] *= hue[1]; b.c[i * 3 + 2] *= hue[2]; }
  }
  let h = 0;
  for (let i = 1; i < b.p.length; i += 3) h = Math.max(h, b.p[i]);
  return { b, h, trunkR: nStems > 1 ? r * 2.2 : r * 1.35, crownR: CR, off: S.lean ? crownC.x : 0, crownC, kind: 'tree' };
}

// Fourré de bord de piste : mur de feuillage de 3 à 4 m (dômes de rameaux) et grandes feuilles au pied.
// Très peu de triangles (des cartes), posé serré le long des routes pour une lisière nette et touffue.
function makeThicket(A, seed) {
  const rnd = mulberry32(seed), b = new GeoBuilder();
  const H = 3.4, R = 1.9, C = new V3(0, H * 0.55, 0);
  const aoFn = (q) => 0.45 + 0.55 * clamp(q.y / H, 0, 1) * (0.7 + 0.3 * clamp(Math.hypot(q.x, q.z) / R, 0, 1));
  const HUES = [[1, 1, 1], [1.04, 1.02, 0.82], [0.9, 0.97, 0.88]];
  // dômes : un au centre en hauteur, quatre autour plus bas
  const domes = [new V3(0, H * 0.72, 0)];
  for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + rnd() * 0.8, d = R * (0.45 + rnd() * 0.25); domes.push(new V3(Math.cos(a) * d, H * (0.38 + rnd() * 0.15), Math.sin(a) * d)); }
  for (const c of domes) {
    const v0 = b.count, N = 5, cr = 1.15 + rnd() * 0.3, out = new V3(c.x, 0, c.z);
    if (out.lengthSq() < 0.01) out.set(0, 1, 0); else out.normalize();
    for (let k = 0; k < N; k++) {
      const az = (k / N) * Math.PI * 2 + rnd() * 0.8, e = lerp(-0.3, 1.2, rnd());
      const d = new V3(Math.cos(az) * Math.cos(e), Math.sin(e), Math.sin(az) * Math.cos(e)).addScaledVector(out, 0.5).normalize();
      const side = Math.abs(d.y) > 0.97 ? new V3(Math.cos(az), 0, Math.sin(az)) : new V3(-d.z, 0, d.x).normalize();
      side.applyAxisAngle(d, (rnd() - 0.5) * 1.6);
      const len = cr * (1.35 + rnd() * 0.3);
      bentCard(b, c.clone().addScaledVector(d, -cr * 0.3), d, side, len, len, rnd() < 0.6 ? A.clusterA : A.clusterB,
        { segs: 1, center: C, normalBlend: 0.6, aoFn, flex0: 0.3, flexT: 0.5, phase: rnd() });
    }
    const hue = HUES[Math.floor(rnd() * HUES.length)];
    for (let i = v0; i < b.count; i++) { b.c[i * 3] *= hue[0]; b.c[i * 3 + 1] *= hue[1]; b.c[i * 3 + 2] *= hue[2]; }
  }
  // grandes feuilles (bananier, anthurium) qui débordent au pied du fourré
  for (let k = 0; k < 5; k++) {
    const az = (k / 5) * Math.PI * 2 + rnd() * 0.7, el = 0.35 + rnd() * 0.5;
    const dir = new V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const side = new V3(-Math.sin(az), 0, Math.cos(az)), big = k < 3;
    const len = big ? 1.5 + rnd() * 0.6 : 0.9 + rnd() * 0.3;
    bentCard(b, new V3(Math.cos(az) * R * 0.35, 0.05, Math.sin(az) * R * 0.35), dir, side, len, big ? len * 0.42 : len * 0.9, big ? A.banana : A.anthurium,
      { segs: 2, droop: 0.4, center: new V3(0, 0.6, 0), normalBlend: 0.4, flex0: 0.15, flexT: 0.6, phase: rnd(), alongU: big, aoFn: (q) => 0.55 + 0.45 * clamp(q.y / 1.5, 0, 1) });
  }
  return { b, h: H + 0.6, r: R + 0.6, kind: 'bush' };
}

// ---------- buissons ----------
function radialCards(b, rnd, n, rect, len, wid, el0, el1, droop, segs, opts = {}) {
  const c = new V3(0, len * 0.35, 0);
  for (let k = 0; k < n; k++) {
    const az = k / n * Math.PI * 2 + rnd() * 0.6, el = lerp(el0, el1, rnd());
    const dir = new V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const side = new V3(-Math.sin(az), 0, Math.cos(az));
    const l = len * (0.7 + rnd() * 0.45);
    bentCard(b, new V3((rnd() - 0.5) * 0.15, opts.y0 ?? 0.02, (rnd() - 0.5) * 0.15), dir, side, l, wid * (0.8 + rnd() * 0.3), rect,
      { segs, droop, center: c, normalBlend: 0.5, flex0: 0.1, flexT: 0.7, phase: rnd(), alongU: opts.alongU, aoFn: (q) => 0.55 + 0.45 * clamp(q.y / (len * 0.8), 0, 1) });
  }
}
function makeBush(A, seed, arch) {
  const rnd = mulberry32(seed), b = new GeoBuilder();
  let h = 1, r = 1;
  switch (arch) {
    case 'fern': { const L = 0.7 + rnd() * 0.9; radialCards(b, rnd, 7 + Math.floor(rnd() * 7), A.fern, L, L * 0.55, 0.45, 1.1, 0.45, 3); h = L; r = L * 0.8; break; }
    case 'anthurium': { const L = 0.6 + rnd() * 0.8; radialCards(b, rnd, 4 + Math.floor(rnd() * 4), A.anthurium, L, L * 0.95, 0.5, 1.2, 0.2, 2); h = L; r = L * 0.7; break; }
    case 'calathea': { const L = 0.5 + rnd() * 0.5; radialCards(b, rnd, 4 + Math.floor(rnd() * 3), sub(A.calathea, 0, 0, 0.9, 0.9), L, L * 0.95, 0.6, 1.3, 0.15, 2); h = L; r = L * 0.6; break; }
    case 'heliconia': {
      const L = 1.2 + rnd() * 1.4;
      radialCards(b, rnd, 5 + Math.floor(rnd() * 4), sub(A.heliconia, 0, 0, 0.5, 1), L, L * 0.38, 1.0, 1.4, 0.25, 3, { alongU: true });
      for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) {
        const az = rnd() * Math.PI * 2;
        bentCard(b, new V3(Math.cos(az) * 0.2, L * 0.55, Math.sin(az) * 0.2), new V3(0, 1, 0), new V3(Math.cos(az), 0, Math.sin(az)), 0.55, 0.5, sub(A.heliconia, 0.5, 0, 0.5, 1), { segs: 1, flex0: 0.5, flexT: 0.2 });
      }
      h = L; r = 0.9; break;
    }
    case 'grass': { const L = 0.45 + rnd() * 1.0; radialCards(b, rnd, 4 + Math.floor(rnd() * 3), A.grass, L, L * 0.6, 1.2, 1.5, 0.05, 2); h = L; r = 0.5; break; }
    case 'shrub': case 'hibiscus': {
      const R = 0.6 + rnd() * 0.8, c = new V3(0, R * 0.9, 0);
      for (let k = 0; k < 3; k++) tube(b, [new V3(0, -0.1, 0), new V3((rnd() - 0.5) * R, R * 0.8, (rnd() - 0.5) * R)], [0.04, 0.025], 4, A.treeBark, 1, { ao0: 0.5, ao1: 0.8, flex1: 0.3 });
      const leaf = rnd() < 0.5 ? A.clusterA : A.clusterB;
      const n = 6 + Math.floor(rnd() * 6);
      for (let k = 0; k < n; k++) {
        const u = rnd() * Math.PI * 2, v = rnd() * 1.3;
        const q = new V3(Math.cos(u) * Math.sin(v) * R, R * 0.9 + Math.cos(v) * R * 0.6, Math.sin(u) * Math.sin(v) * R);
        cluster(b, q, R * 1.1, leaf, rnd, c, (qq) => 0.55 + 0.45 * clamp(qq.distanceTo(c) / R, 0, 1), rnd());
      }
      if (arch === 'hibiscus') {
        const qd = Math.floor(rnd() * 4), fr = sub(A.flowers, (qd % 2) * 0.5, Math.floor(qd / 2) * 0.5, 0.5, 0.5);
        for (let k = 0; k < 8; k++) { const u = rnd() * Math.PI * 2; cluster(b, new V3(Math.cos(u) * R, R * (0.8 + rnd() * 0.8), Math.sin(u) * R), 0.22, fr, rnd, c, () => 1, rnd()); }
      }
      h = R * 2; r = R; break;
    }
    case 'sorrel': { const L = 0.25 + rnd() * 0.25; radialCards(b, rnd, 5, A.sorrel ? sub(A.sorrel, 0, 0, 0.78, 0.7) : A.weed, L, L, 0.05, 0.35, 0.05, 1); h = L * 0.5; r = L; break; }
    case 'seedling': { const p = makePalm(A, seed, true); return { b: p.b, h: p.h, r: 1, kind: 'bush' }; }
    case 'bananaY': { const p = makeBanana(A, seed, 0.45); return { b: p.b, h: p.h, r: 1, kind: 'bush' }; }
  }
  return { b, h, r, kind: 'bush' };
}

const TREE_ARCH = [
  ...Array.from({ length: 32 }, () => 'palm'), ...Array.from({ length: 8 }, () => 'youngPalm'),
  ...Array.from({ length: 8 }, () => 'almond'), ...Array.from({ length: 8 }, () => 'mango'), ...Array.from({ length: 6 }, () => 'breadfruit'),
  ...Array.from({ length: 5 }, () => 'banyan'), ...Array.from({ length: 6 }, () => 'flame'), ...Array.from({ length: 7 }, () => 'pandanus'),
  ...Array.from({ length: 8 }, () => 'treefern'), ...Array.from({ length: 7 }, () => 'banana'), ...Array.from({ length: 3 }, () => 'hibiscusT'), ...Array.from({ length: 2 }, () => 'dead'),
];
const BUSH_ARCH = [
  ...Array.from({ length: 16 }, () => 'fern'), ...Array.from({ length: 13 }, () => 'anthurium'), ...Array.from({ length: 11 }, () => 'calathea'),
  ...Array.from({ length: 10 }, () => 'heliconia'), ...Array.from({ length: 14 }, () => 'grass'), ...Array.from({ length: 12 }, () => 'shrub'),
  ...Array.from({ length: 8 }, () => 'hibiscus'), ...Array.from({ length: 6 }, () => 'sorrel'), ...Array.from({ length: 6 }, () => 'seedling'), ...Array.from({ length: 4 }, () => 'bananaY'),
];

const NEAR = [
  { tree: 85, bush: 30, shadow: 45, density: 0.7 },
  { tree: 100, bush: 35, shadow: 55, density: 0.85 },
  { tree: 150, bush: 52, shadow: 80, density: 1.0 },
  { tree: 190, bush: 66, shadow: 100, density: 1.0 },
];

export class Vegetation {
  constructor(renderer, scene, terrain, world, rects, q) {
    this.renderer = renderer; this.scene = scene; this.T = terrain; this.world = world; this.rects = rects;
    this.q = NEAR[q] || NEAR[1];
    this.lastCam = new V3(1e9, 0, 0);
    this.lastQ = new THREE.Quaternion();
  }
  setQuality(q) { this.q = NEAR[q] || NEAR[1]; this.lastCam.set(1e9, 0, 0); }

  async init(base, progress) {
    const [map, nmap] = await Promise.all([
      loadTex(`${base}/tex/veg_a.webp`, { srgb: true, aniso: 4 }),
      loadTex(`${base}/tex/veg_n.jpg`, { srgb: false, aniso: 4 }),
    ]);
    this.atlas = { map, nmap, rects: this.rects };
    const mat = new THREE.MeshStandardMaterial({ map, normalMap: nmap, normalScale: new THREE.Vector2(0.8, 0.8), alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, roughness: 0.72, metalness: 0 });
    patchMaterial(mat, {
      key: 'veg', wind: true, alphaBoost: true, canopy: 0.35,
      afterLights: /* glsl */`
        {
          vec3 vdir = normalize(vWP - uCamPos);
          float bl = pow(max(dot(vdir, uSunDir), 0.0), 3.0);
          float leaf = 1.0 - step(vMapUv.x, 0.5) * step(0.5, vMapUv.y);
          reflectedLight.directDiffuse += diffuseColor.rgb * gSunDirect * (0.08 + bl * 0.55) * leaf * RECIPROCAL_PI * 3.0;
        }`,
    });
    this.mat = mat;
    progress(0.05, 'Génération des 100 types d’arbres et de palmiers…');
    await tick();
    const A = this.rects;
    this.types = [];
    for (let i = 0; i < TREE_ARCH.length; i++) {
      const a = TREE_ARCH[i], seed = 1000 + i * 77;
      let t;
      if (a === 'palm') t = makePalm(A, seed, false);
      else if (a === 'youngPalm') t = makePalm(A, seed, true);
      else if (a === 'pandanus') t = makePandanus(A, seed);
      else if (a === 'treefern') t = makeTreeFern(A, seed);
      else if (a === 'banana') t = makeBanana(A, seed);
      else if (a === 'dead') t = makeDead(A, seed);
      else t = makeBroadleaf(A, seed, a);
      this.types.push({ arch: a, cat: 'tree', geo: t.b.build(), h: t.h, trunkR: t.trunkR, crownR: t.crownR, kind: t.kind });
      if (i % 10 === 9) { progress(0.05 + (i / 100) * 0.35, `Arbres et palmiers : ${i + 1} / 100`); await tick(); }
    }
    for (let i = 0; i < BUSH_ARCH.length; i++) {
      const a = BUSH_ARCH[i], t = makeBush(A, 5000 + i * 131, a);
      this.types.push({ arch: a, cat: 'bush', geo: t.b.build(), h: t.h, crownR: t.r, kind: 'bush' });
      if (i % 20 === 19) { progress(0.4 + (i / 100) * 0.25, `Buissons et plantes : ${i + 1} / 100`); await tick(); }
    }
    progress(0.68, 'Placement de la végétation sur l’île…');
    await tick();
    this.place();
    progress(0.85, 'Imposteurs pour la végétation lointaine…');
    await tick();
    this.buildMeshes();
    this.buildImpostors();
    progress(1, `${this.count.trees.toLocaleString('fr-FR')} arbres et ${this.count.bushes.toLocaleString('fr-FR')} buissons placés`);
  }

  place() {
    const T = this.T, W = T.W, rnd = mulberry32(4242);
    const byArch = {};
    this.types.forEach((t, i) => { (byArch[t.arch] = byArch[t.arch] || []).push(i); });
    const pick = (arch, h) => { const l = byArch[arch]; return l[Math.floor(hash2(h * 1e6, 17) * l.length) % l.length]; };
    const spawn = this.world.spawn, pier = this.world.pier;
    const nearPier = (x, z) => { const dx = pier.x1 - pier.x0, dz = pier.z1 - pier.z0, L2 = dx * dx + dz * dz; const t = clamp(((x - pier.x0) * dx + (z - pier.z0) * dz) / L2, -0.6, 1); return Math.hypot(x - pier.x0 - dx * t, z - pier.z0 - dz * t) < 14; };
    const inst = { x: [], y: [], z: [], r: [], s: [], t: [], c: [] };
    const add = (x, y, z, rot, s, type, tint) => { inst.x.push(x); inst.y.push(y); inst.z.push(z); inst.r.push(rot); inst.s.push(s); inst.t.push(type); inst.c.push(tint); };
    const nrm = new V3();
    const choose = (list, u) => { let acc = 0; const tot = list.reduce((a, b) => a + b[1], 0); for (const [k, w] of list) { acc += w / tot; if (u <= acc) return k; } return list[list.length - 1][0]; };
    // arbres
    const TC = 4.6;
    let trees = 0;
    for (let gz = -W / 2; gz < W / 2; gz += TC) for (let gx = -W / 2; gx < W / 2; gx += TC) {
      const x = gx + rnd() * TC, z = gz + rnd() * TC;
      const h = T.height(x, z);
      if (h < 0.9 || h > 285) continue;
      const path = T.mask(T.path, x, z), clear = T.mask(T.clear, x, z), wet = T.mask(T.wet, x, z);
      T.normal(x, z, nrm, 2);
      const slope = 1 - nrm.y;
      if (path > 0.2 || clear > 0.3) continue;
      if (Math.hypot(x - spawn.x, z - spawn.z) < 16 || nearPier(x, z)) continue;
      const nz = vnoise(x * 0.012, z * 0.012), nz2 = vnoise(x * 0.05 + 9, z * 0.05 - 3);
      let p = 0, list;
      const beach = 1.7 + vnoise(x * 0.045, z * 0.045) * 1.3;
      if (h < beach) { p = 0.045; list = [['palm', 1]]; }
      else if (h < 10) { p = 0.42; list = [['palm', 6], ['almond', 1], ['pandanus', 1.5], ['hibiscusT', 0.4], ['youngPalm', 1]]; }
      else if (h < 175) { p = 0.62 * (0.75 + nz * 0.5); list = [['mango', 2], ['breadfruit', 1.4], ['almond', 1], ['banyan', 0.45], ['flame', 0.6], ['palm', 1.3], ['youngPalm', 0.7], ['treefern', h > 70 ? 1.4 : 0.2], ['banana', wet > 0.05 ? 3 : 0.35], ['pandanus', 0.3], ['dead', 0.06]]; }
      else { p = 0.26 * (1 - smoothstep(220, 285, h)); list = [['treefern', 2], ['mango', 0.6], ['dead', 0.5], ['hibiscusT', 0.6]]; }
      if (wet > 0.55) p *= 0.12;
      if (slope > 0.5) p *= 0.2;
      p *= 0.75 + nz2 * 0.5;
      if (rnd() > p * this.q.density + 0.0) continue;
      const arch = choose(list, rnd());
      const type = pick(arch, rnd());
      let rot = rnd() * Math.PI * 2;
      if (arch === 'palm' && h < 12) { // les cocotiers penchent vers la mer
        const dx = -nrm.x, dz = -nrm.z, l = Math.hypot(dx, dz);
        if (l > 0.01) rot = Math.atan2(-dz / l, dx / l) + (rnd() - 0.5) * 0.8;
      }
      const s = 0.78 + rnd() * 0.45;
      add(x, h - 0.05, z, rot, s, type, 0.82 + rnd() * 0.3);
      trees++;
    }
    // buissons
    const BC = 2.1;
    let bushes = 0;
    for (let gz = -W / 2; gz < W / 2; gz += BC) for (let gx = -W / 2; gx < W / 2; gx += BC) {
      const x = gx + rnd() * BC, z = gz + rnd() * BC;
      const h = T.height(x, z);
      if (h < 0.7 || h > 270) continue;
      const path = T.mask(T.path, x, z);
      if (path > 0.3) continue;
      const clear = T.mask(T.clear, x, z), wet = T.mask(T.wet, x, z);
      T.normal(x, z, nrm, 2);
      const slope = 1 - nrm.y;
      if (Math.hypot(x - spawn.x, z - spawn.z) < 9 || nearPier(x, z)) continue;
      const nz = vnoise(x * 0.03 + 4, z * 0.03 - 8);
      const beach = 1.7 + vnoise(x * 0.045, z * 0.045) * 1.3;
      let p, list;
      if (h < beach) { p = 0.03; list = [['sorrel', 2], ['grass', 1]]; }
      else if (h < 10) { p = 0.3; list = [['grass', 3], ['fern', 1], ['shrub', 2], ['hibiscus', 0.8], ['heliconia', 0.5], ['seedling', 1], ['sorrel', 0.8]]; }
      else if (h < 190) { p = 0.62 * (0.6 + nz * 0.7); list = [['fern', 4], ['anthurium', 2.6], ['calathea', 1.8], ['heliconia', wet > 0.05 ? 3 : 1.2], ['shrub', 2], ['bananaY', 0.6], ['seedling', 0.8], ['grass', 0.6], ['hibiscus', 0.3]]; }
      else { p = 0.18; list = [['grass', 3], ['fern', 1], ['shrub', 0.6]]; }
      if (clear > 0.3) { p *= 0.12; list = [['grass', 2], ['sorrel', 1]]; }
      if (wet > 0.75) p *= 0.3;
      if (slope > 0.55) p *= 0.3;
      if (rnd() > p * this.q.density) continue;
      const type = pick(choose(list, rnd()), rnd());
      add(x, h - 0.04, z, rnd() * Math.PI * 2, 0.75 + rnd() * 0.55, type, 0.8 + rnd() * 0.35);
      bushes++;
    }
    this.count = { trees, bushes };
    const n = inst.x.length;
    this.I = { x: new Float32Array(inst.x), y: new Float32Array(inst.y), z: new Float32Array(inst.z), r: new Float32Array(inst.r), s: new Float32Array(inst.s), t: new Uint16Array(inst.t), c: new Float32Array(inst.c), n };
    // grille spatiale (32 m)
    const GC = 32, GN = W / GC;
    this.GC = GC; this.GN = GN;
    const cells = Array.from({ length: GN * GN }, () => []);
    for (let i = 0; i < n; i++) {
      const cx = clamp(Math.floor((this.I.x[i] + W / 2) / GC), 0, GN - 1), cz = clamp(Math.floor((this.I.z[i] + W / 2) / GC), 0, GN - 1);
      cells[cz * GN + cx].push(i);
    }
    this.cells = cells.map((c) => Uint32Array.from(c));
    this.cellH = new Float32Array(GN * GN * 2);
    for (let c = 0; c < GN * GN; c++) {
      let mn = 1e9, mx = -1e9;
      for (const i of this.cells[c]) { const t = this.types[this.I.t[i]]; mn = Math.min(mn, this.I.y[i]); mx = Math.max(mx, this.I.y[i] + t.h * this.I.s[i]); }
      this.cellH[c * 2] = mn; this.cellH[c * 2 + 1] = mx;
    }
  }

  canopyList() {
    const out = [], I = this.I;
    for (let i = 0; i < I.n; i++) {
      const t = this.types[I.t[i]];
      if (t.cat === 'tree') out.push({ x: I.x[i], z: I.z[i], r: t.crownR * I.s[i] * 0.95 });
    }
    return out;
  }
  // Troncs proches (pour les collisions du buggy)
  trunksNear(x, z, r, out) {
    out.length = 0;
    const W = this.T.W, GC = this.GC, GN = this.GN, I = this.I;
    const c0x = clamp(Math.floor((x - r + W / 2) / GC), 0, GN - 1), c1x = clamp(Math.floor((x + r + W / 2) / GC), 0, GN - 1);
    const c0z = clamp(Math.floor((z - r + W / 2) / GC), 0, GN - 1), c1z = clamp(Math.floor((z + r + W / 2) / GC), 0, GN - 1);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      for (const i of this.cells[cz * GN + cx]) {
        const t = this.types[I.t[i]];
        if (t.cat !== 'tree' || t.kind === 'young') continue;
        const dx = I.x[i] - x, dz = I.z[i] - z;
        if (dx * dx + dz * dz < r * r) out.push({ x: I.x[i], z: I.z[i], r: t.trunkR * I.s[i] + 0.1 });
      }
    }
    return out;
  }

  buildMeshes() {
    const counts = new Array(this.types.length).fill(0);
    for (let i = 0; i < this.I.n; i++) counts[this.I.t[i]]++;
    this.meshes = this.types.map((t, k) => {
      const cap = Math.max(1, Math.min(counts[k], t.cat === 'tree' ? 700 : 900));
      const m = new THREE.InstancedMesh(t.geo, this.mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = t.cat === 'tree' && t.kind !== 'young';
      m.receiveShadow = true;
      m.shadowCount = 0;
      m.onBeforeShadow = function () { this._c = this.count; this.count = this.shadowCount; };
      m.onAfterShadow = function () { this.count = this._c; };
      m.cap = cap;
      this.scene.add(m);
      return m;
    });
  }

  // Rendu de chaque type d'arbre dans un atlas (couleur + normales) pour les arbres lointains
  buildImpostors() {
    const r = this.renderer, TILE = 128, GRIDN = 10, S = TILE * GRIDN;
    const mk = () => new THREE.WebGLRenderTarget(S, S, { type: THREE.UnsignedByteType, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true });
    this.impA = mk(); this.impN = mk();
    const capMat = (mode) => new THREE.ShaderMaterial({
      uniforms: { map: { value: this.atlas.map } },
      vertexShader: 'attribute vec3 color; varying vec2 vUv; varying vec3 vN; varying vec3 vC; void main(){ vUv = uv; vN = normal; vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec3 vN; varying vec3 vC;
        void main(){ vec4 c = texture2D(map, vUv); if (c.a < 0.5) discard;
          ${mode === 0 ? 'gl_FragColor = vec4(sqrt(c.rgb * vC), 1.0);' : 'vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0); gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);'} }`,
      side: THREE.DoubleSide,
    });
    const mA = capMat(0), mN = capMat(1);
    const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
    const mesh = new THREE.Mesh(this.types[0].geo, mA);
    sc.add(mesh);
    const prev = r.getRenderTarget(), prevClear = r.getClearColor(new THREE.Color()), prevA = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    this.impInfo = [];
    for (const [rt, m] of [[this.impA, mA], [this.impN, mN]]) {
      r.setRenderTarget(rt); r.clear();
      mesh.material = m;
      let tile = 0;
      this.types.forEach((t, k) => {
        if (t.cat !== 'tree') return;
        const bb = t.geo.boundingBox;
        const hw = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z)) * 1.02;
        const top = bb.max.y * 1.02, bot = Math.max(bb.min.y, -0.3);
        const half = Math.max(hw, (top - bot) / 2);
        cam.left = -half; cam.right = half; cam.bottom = (top + bot) / 2 - half; cam.top = (top + bot) / 2 + half;
        cam.updateProjectionMatrix();
        mesh.geometry = t.geo;
        const tx = tile % GRIDN, ty = Math.floor(tile / GRIDN);
        rt.viewport.set(tx * TILE, ty * TILE, TILE, TILE);
        rt.scissor.set(tx * TILE, ty * TILE, TILE, TILE);
        rt.scissorTest = true;
        r.setRenderTarget(rt);
        r.render(sc, cam);
        if (m === mA) this.impInfo[k] = { tile, size: half * 2, yMin: (top + bot) / 2 - half };
        tile++;
      });
      rt.scissorTest = false;
      rt.viewport.set(0, 0, S, S);
    }
    r.setRenderTarget(prev);
    r.setClearColor(prevClear, prevA);
    // maillage d'imposteurs instanciés
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const cap = this.count.trees + 16;
    this.impAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // x, y, z, taille
    this.impAttr2 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2); // tuile, teinte
    this.impAttr.setUsage(THREE.DynamicDrawUsage); this.impAttr2.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aI', this.impAttr); g.setAttribute('aT', this.impAttr2);
    g.instanceCount = 0;
    this.impGeo = g;
    const impMat = new THREE.ShaderMaterial({
      uniforms: { ...U, tA: { value: this.impA.texture }, tN: { value: this.impN.texture }, uNear: { value: 100 } },
      vertexShader: /* glsl */`
        ${GLSL_COMMON}
        attribute vec4 aI; attribute vec2 aT; uniform float uNear;
        varying vec2 vUv; varying vec3 vWP; varying vec3 vR; varying vec3 vF; varying vec3 vUpB; varying float vTint; varying float vFade;
        void main() {
          vec3 toC = normalize(uCamPos - aI.xyz);
          vec3 fh = normalize(vec3(toC.x, 0.0, toC.z) + vec3(1e-4, 0.0, 0.0));
          float k = smoothstep(0.18, 0.7, toC.y);
          vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), camUp, k));
          vec3 f = normalize(mix(fh, toC, k));
          vec3 r = normalize(cross(up, f));
          float sway = sin(uTime * 1.2 + aI.x * 0.07) * 0.03 * uWind * position.y;
          vec3 pivot = aI.xyz + vec3(0.0, 0.5 * aI.w * k, 0.0) - up * 0.5 * aI.w * k;
          vec3 p = pivot + r * (position.x + sway) * aI.w + up * position.y * aI.w;
          float tile = aT.x;
          vUv = (vec2(mod(tile, 10.0), floor(tile / 10.0)) + vec2(position.x + 0.5, position.y)) / 10.0;
          vWP = p; vR = r; vF = normalize(cross(r, up)); vUpB = up; vTint = aT.y;
          vFade = smoothstep(uNear * 0.92, uNear * 1.04, length(uCamPos - aI.xyz));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        uniform sampler2D tA; uniform sampler2D tN;
        varying vec2 vUv; varying vec3 vWP; varying vec3 vR; varying vec3 vF; varying vec3 vUpB; varying float vTint; varying float vFade;
        void main() {
          vec4 a = texture2D(tA, vUv);
          if (a.a < 0.32) discard;
          vec3 alb = a.rgb * a.rgb * vTint;
          vec3 nn = texture2D(tN, vUv).xyz * 2.0 - 1.0;
          vec3 n = normalize(vR * nn.x + vUpB * nn.y + vF * nn.z);
          vec4 lt = lightAt(vWP);
          float sv = lt.r * lt.b;
          float ndl = max(dot(n, uSunDir), 0.0) * 0.8 + 0.2 * max(dot(-vF, uSunDir), 0.0);
          vec3 col = alb * (uSunColor * ndl * sv / 3.14159 + uSkyAmb * (0.55 + 0.45 * n.y) * mix(1.0, 0.6, lt.g));
          col = applyAerial(col, vWP);
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.DoubleSide,
    });
    this.impMat = impMat;
    this.imp = new THREE.Mesh(g, impMat);
    this.imp.frustumCulled = false;
    this.scene.add(this.imp);
  }

  update(camera, dt) {
    const cam = camera.position;
    const moved = cam.distanceToSquared(this.lastCam) > 9 || camera.quaternion.angleTo(this.lastQ) > 0.12;
    this._t = (this._t || 0) + dt;
    if (!moved && this._t < 0.6) return;
    this._t = 0;
    this.lastCam.copy(cam); this.lastQ.copy(camera.quaternion);
    const q = this.q, I = this.I, W = this.T.W, GC = this.GC, GN = this.GN;
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const box = new THREE.Box3();
    for (const m of this.meshes) { m.count = 0; m._d = m._d || []; m._d.length = 0; }
    let impN = 0;
    const ia = this.impAttr.array, ib = this.impAttr2.array;
    const RT = q.tree, RB = q.bush, RT2 = RT * RT, RB2 = RB * RB;
    this.impMat.uniforms.uNear.value = RT;
    for (let cz = 0; cz < GN; cz++) for (let cx = 0; cx < GN; cx++) {
      const c = cz * GN + cx;
      if (!this.cells[c].length) continue;
      box.min.set(-W / 2 + cx * GC - 12, this.cellH[c * 2], -W / 2 + cz * GC - 12);
      box.max.set(box.min.x + GC + 24, this.cellH[c * 2 + 1] + 2, box.min.z + GC + 24);
      if (!fr.intersectsBox(box)) continue;
      const dx = Math.max(box.min.x - cam.x, 0, cam.x - box.max.x), dz = Math.max(box.min.z - cam.z, 0, cam.z - box.max.z);
      const cd2 = dx * dx + dz * dz;
      if (cd2 > 9e6) continue;
      for (const i of this.cells[c]) {
        const t = I.t[i], ty = this.types[t];
        const ex = I.x[i] - cam.x, ez = I.z[i] - cam.z, ey = I.y[i] - cam.y, d2 = ex * ex + ez * ez + ey * ey * 0.3;
        if (ty.cat === 'tree') {
          if (d2 < RT2) {
            const m = this.meshes[t];
            if (m.count < m.cap) { m._d.push(d2, i); m.count++; }
          } else if (this.impInfo[t] && d2 < 6.25e6) {
            const info = this.impInfo[t], s = I.s[i];
            ia[impN * 4] = I.x[i]; ia[impN * 4 + 1] = I.y[i] + info.yMin * s; ia[impN * 4 + 2] = I.z[i]; ia[impN * 4 + 3] = info.size * s;
            ib[impN * 2] = info.tile; ib[impN * 2 + 1] = I.c[i];
            impN++;
          }
        } else if (d2 < RB2 * (0.6 + ty.h * 0.35)) {
          const m = this.meshes[t];
          if (m.count < m.cap) { m._d.push(d2, i); m.count++; }
        }
      }
    }
    // remplissage des matrices (tri par distance pour limiter les ombres aux plus proches)
    const SR2 = q.shadow * q.shadow;
    for (const m of this.meshes) {
      if (!m.count) { m.shadowCount = 0; continue; }
      const d = m._d, n = d.length / 2;
      const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => d[a * 2] - d[b * 2]);
      const A = m.instanceMatrix.array, C = m.instanceColor.array;
      let sc = 0;
      for (let k = 0; k < n; k++) {
        const i = d[order[k] * 2 + 1], s = I.s[i], r = I.r[i], cs = Math.cos(r) * s, sn = Math.sin(r) * s, o = k * 16;
        A[o] = cs; A[o + 1] = 0; A[o + 2] = -sn; A[o + 3] = 0;
        A[o + 4] = 0; A[o + 5] = s; A[o + 6] = 0; A[o + 7] = 0;
        A[o + 8] = sn; A[o + 9] = 0; A[o + 10] = cs; A[o + 11] = 0;
        A[o + 12] = I.x[i]; A[o + 13] = I.y[i]; A[o + 14] = I.z[i]; A[o + 15] = 1;
        const tint = I.c[i];
        C[k * 3] = tint * (0.96 + (tint - 1) * 0.3); C[k * 3 + 1] = tint; C[k * 3 + 2] = tint * 0.92;
        if (d[order[k] * 2] < SR2) sc = k + 1;
      }
      m.shadowCount = sc;
      m.instanceMatrix.needsUpdate = true;
      m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, n * 16);
      m.instanceColor.needsUpdate = true;
      m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, n * 3);
    }
    this.impGeo.instanceCount = impN;
    this.impAttr.needsUpdate = true; this.impAttr.clearUpdateRanges(); this.impAttr.addUpdateRange(0, impN * 4);
    this.impAttr2.needsUpdate = true; this.impAttr2.clearUpdateRanges(); this.impAttr2.addUpdateRange(0, impN * 2);
  }
}

function tick() { return new Promise((r) => setTimeout(r, 0)); }
export { lerp, makeGiant, makeThicket, makePalm, makeBroadleaf, makeTreeFern, makeBanana, makeBush, makePandanus, makeDead, tube, cluster, bentCard, uvr, sub };
