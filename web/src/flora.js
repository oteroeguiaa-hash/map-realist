// Végétation à partir des modèles du joueur (palmier, monsteras, pack de plantes tropicales, grand tronc de jungle),
// complétée par des arbres à feuilles scannées. Instanciation, fondu tramé vers des imposteurs : tout reste visible au loin.
import * as THREE from 'three';
import { U, GLSL_COMMON, GLSL_BAYER, GeoBuilder, mulberry32, patchMaterial, loadTex, clamp, smoothstep, hash2, vnoise } from './core.js';
import { makeBroadleaf, makeTreeFern, makePalm, makeBush, makeDead, tube, cluster } from './vegetation.js';

const V3 = THREE.Vector3;
const QUAL = [
  { tree: 45, bush: 16, shadow: 26, impBush: 110, density: 0.7 },
  { tree: 58, bush: 17, shadow: 28, impBush: 150, density: 0.85 },
  { tree: 90, bush: 32, shadow: 65, impBush: 200, density: 1.0 },
  { tree: 120, bush: 42, shadow: 85, impBush: 260, density: 1.0 },
];
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _ax = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const FADE_TREE = { value: new THREE.Vector2(55, 65) };
const FADE_BUSH = { value: new THREE.Vector2(20, 24) };

// Convertit un matériau GLTF en matériau standard « nature » (vent, fondu, translucidité des feuilles)
const matCache = new Map();
function natureMat(src, cat, opts = {}) {
  const key = src.uuid + cat + (opts.bend ? 'b' : '') + (opts.tint ? 't' : '');
  if (matCache.has(key)) return matCache.get(key);
  const leaf = src.alphaTest > 0 || src.transparent || /leaf|leaves|fern|frond|monstera|palm_b08a|banana_b09a/i.test(src.name);
  const m = new THREE.MeshStandardMaterial({
    map: src.map || null, normalMap: src.normalMap || null, roughnessMap: src.roughnessMap || null, metalnessMap: src.metalnessMap || null,
    color: src.color ? src.color.clone() : new THREE.Color(1, 1, 1), roughness: src.roughness ?? 0.8, metalness: Math.min(src.metalness ?? 0, 0.1),
    alphaTest: leaf ? 0.5 : 0, transparent: false, depthWrite: true, side: THREE.DoubleSide, vertexColors: false,
  });
  if (src.normalScale) m.normalScale.copy(src.normalScale);
  if (leaf) { m.color.multiply(new THREE.Color(0.74, 0.8, 0.62)); m.roughness = Math.max(m.roughness, 0.7); m.alphaToCoverage = true; }
  if (opts.tint) m.color.multiply(opts.tint);
  const uniforms = { uFade: cat === 'tree' ? FADE_TREE : FADE_BUSH };
  if (opts.bend) uniforms.uLeanH = opts.leanH;
  patchMaterial(m, { key: 'nat' + cat, windLean: cat === 'bush' ? '0.32' : '0.0', wind: true, alphaBoost: leaf, fade: true, leaf, bend: !!opts.bend, canopy: 0.35, uniforms, windAmp: cat === 'bush' ? '0.5' : '0.3' });
  matCache.set(key, m);
  return m;
}

// Extrait les maillages d'un objet GLTF dans son repère, remis à l'échelle (hauteur cible), base au sol
const isLeafMat = (src) => src.alphaTest > 0 || src.transparent || /leaf|leaves|fern|frond|monstera|palm_b08a|banana_b09a/i.test(src.name);
// épaissit un tronc autour de sa ligne centrale (tranche par tranche), sans toucher aux feuilles
function thickenTrunk(g, k, H) {
  const pos = g.attributes.position, n = pos.count, B = 24, cx = new Float32Array(B), cz = new Float32Array(B), cn = new Float32Array(B);
  const bin = (y) => Math.max(0, Math.min(B - 1, Math.floor(y / H * B)));
  for (let i = 0; i < n; i++) { const b = bin(pos.getY(i)); cx[b] += pos.getX(i); cz[b] += pos.getZ(i); cn[b]++; }
  for (let b = 0; b < B; b++) if (cn[b]) { cx[b] /= cn[b]; cz[b] /= cn[b]; }
  for (let i = 0; i < n; i++) {
    const b = bin(pos.getY(i)); if (!cn[b]) continue;
    const f = k * (1 - 0.25 * pos.getY(i) / H);
    pos.setX(i, cx[b] + (pos.getX(i) - cx[b]) * f); pos.setZ(i, cz[b] + (pos.getZ(i) - cz[b]) * f);
  }
  pos.needsUpdate = true;
}
function glbParts(obj, height, cat, opts = {}) {
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const raw = [];
  obj.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const g = floatGeo(o.geometry);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    raw.push({ geo: g, src: o.material });
  });
  if (!raw.length) return null;
  const box = new THREE.Box3();
  raw.forEach((p) => { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); });
  const s = height / Math.max(box.max.y - box.min.y, 1e-4), cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const parts = [];
  const total = raw.reduce((a, p) => a + triCount(p.geo), 0);
  for (const p of raw) {
    // plantes trop détaillées pour un téléphone : on garde une fronde sur deux ou trois, réparties tout autour
    if (opts.maxTris && total > opts.maxTris) p.geo = thinCards(p.geo, opts.maxTris / total);
    p.geo.translate(-cx, -box.min.y, -cz);
    p.geo.scale(s, s, s);
    if (opts.thicken && !isLeafMat(p.src)) { p.geo.computeBoundingBox(); thickenTrunk(p.geo, opts.thicken, p.geo.boundingBox.max.y); p.geo.computeVertexNormals(); }
    const H = height;
    const pos = p.geo.attributes.position, n = pos.count, w = new Float32Array(n * 2);
    const ph = Math.random();
    for (let i = 0; i < n; i++) { const t = clamp(pos.getY(i) / H, 0, 1); w[i * 2] = opts.still ? 0 : Math.pow(t, 1.6); w[i * 2 + 1] = ph + pos.getX(i) * 0.05; }
    p.geo.setAttribute('aWind', new THREE.BufferAttribute(w, 2));
    if (!p.geo.attributes.normal) p.geo.computeVertexNormals();
    p.geo.computeBoundingBox(); p.geo.computeBoundingSphere();
    parts.push({ geo: p.geo, mat: natureMat(p.src, cat, opts) });
  }
  const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * s / 2;
  return { parts, h: height, r };
}


const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
// Allège une plante faite de frondes/feuilles séparées : garde une fraction des pièces, réparties en angle
function thinCards(g, keep) {
  if (keep >= 0.95) return g;
  const pos = g.attributes.position, n = pos.count;
  let idx = g.index ? g.index.array : null;
  // sommets soudés par position (les maillages non indexés ont des sommets dupliqués)
  const id = new Int32Array(n), h = new Map();
  for (let i = 0; i < n; i++) { const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`; let v = h.get(k); if (v === undefined) { v = h.size; h.set(k, v); } id[i] = v; }
  const par = new Int32Array(h.size).map((_, i) => i);
  const f = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  const T = idx ? idx.length / 3 : n / 3, vi = (t, c) => (idx ? idx[t * 3 + c] : t * 3 + c);
  for (let t = 0; t < T; t++) { const a = f(id[vi(t, 0)]); par[f(id[vi(t, 1)])] = a; par[f(id[vi(t, 2)])] = a; }
  const comps = new Map();
  for (let t = 0; t < T; t++) { const r = f(id[vi(t, 0)]); let c = comps.get(r); if (!c) { c = { tris: [], x: 0, z: 0 }; comps.set(r, c); } c.tris.push(t); const v = vi(t, 0); c.x += pos.getX(v); c.z += pos.getZ(v); }
  const list = [...comps.values()];
  if (list.length < 6) return g; // pas assez de pièces séparées : on n'y touche pas
  list.forEach((c) => { c.a = Math.atan2(c.z, c.x); });
  list.sort((a, b) => a.a - b.a);
  const step = 1 / keep, kept = [];
  for (let k = 0; k < list.length; k += step) kept.push(list[Math.floor(k)]);
  const tris = kept.flatMap((c) => c.tris);
  const out = new THREE.BufferGeometry();
  for (const name in g.attributes) {
    const a = g.attributes[name], k = a.itemSize, arr = new Float32Array(tris.length * 3 * k);
    let o = 0;
    for (const t of tris) for (let c = 0; c < 3; c++) { const v = vi(t, c); for (let j = 0; j < k; j++) arr[o++] = a.array[v * k + j]; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, k));
  }
  return out;
}

// Copie de géométrie en Float32 (les modèles compressés utilisent des attributs quantifiés)
export function floatGeo(src) {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const a = src.attributes[name];
    if (!a) continue;
    const n = a.count, k = a.itemSize, out = new Float32Array(n * k);
    for (let i = 0; i < n; i++) { out[i * k] = a.getX(i); if (k > 1) out[i * k + 1] = a.getY(i); if (k > 2) out[i * k + 2] = a.getZ(i); if (k > 3) out[i * k + 3] = a.getW(i); }
    g.setAttribute(name, new THREE.BufferAttribute(out, k));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(src.index.array.slice(), 1));
  return g;
}

// Couronne de grand arbre (branches + grappes de vraies feuilles) posée sur le tronc scanné
function makeCanopy(A, seed, baseY, CR, b = new GeoBuilder()) {
  const rnd = mulberry32(seed);
  const top = new V3(0, baseY, 0);
  tube(b, [new V3(0, baseY - 1.5, 0), new V3((rnd() - 0.5) * 0.6, baseY + 2.5, (rnd() - 0.5) * 0.6), new V3((rnd() - 0.5), baseY + 5.5, (rnd() - 0.5))], [0.55, 0.42, 0.28], 7, A.treeBark, 2.2, { ao0: 0.6, ao1: 0.85, flex1: 0.06 });
  const crownC = new V3(0, baseY + 5.5 + CR * 0.35, 0);
  const tips = [];
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2 + rnd() * 0.5, el = 0.25 + rnd() * 0.35;
    const s0 = new V3(0, baseY + 3 + rnd() * 2.5, 0), d = new V3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
    const e = s0.clone().addScaledVector(d, CR * 0.85);
    tube(b, [s0, s0.clone().lerp(e, 0.5).add(new V3(0, 0.6, 0)), e], [0.26, 0.17, 0.08], 5, A.treeBark, 2.2, { ao0: 0.7, ao1: 0.9, flex0: 0.05, flex1: 0.25, phase: rnd() });
    tips.push(e);
  }
  const aoFn = (q) => 0.5 + 0.5 * clamp(q.distanceTo(crownC) / CR, 0, 1);
  for (let k = 0; k < 70; k++) {
    const u = rnd() * Math.PI * 2, v = Math.acos(rnd() * 2 - 1), r = Math.pow(rnd(), 0.45);
    const q = new V3(Math.sin(v) * Math.cos(u) * CR * r, Math.cos(v) * CR * 0.45 * r, Math.sin(v) * Math.sin(u) * CR * r).add(crownC);
    cluster(b, q, 2.2 + rnd() * 1.2, rnd() < 0.7 ? A.clusterA : A.clusterB, rnd, crownC, aoFn, rnd());
  }
  for (const t of tips) cluster(b, t, 2.6, A.clusterA, rnd, crownC, aoFn, rnd());
  return b.build();
}

export class Flora {
  constructor(renderer, scene, terrain, world, rects, q) {
    this.renderer = renderer; this.scene = scene; this.T = terrain; this.world = world; this.rects = rects;
    this.lastCam = new V3(1e9, 0, 0); this.lastQ = new THREE.Quaternion();
    this.wobbles = new Map();
    this.setQuality(q);
    this.types = [];
  }
  setQuality(q) {
    this.q = QUAL[q] || QUAL[1];
    FADE_TREE.value.set(this.q.tree * 0.93, this.q.tree);
    FADE_BUSH.value.set(this.q.bush * 0.9, this.q.bush);
    this.lastCam.set(1e9, 0, 0);
  }

  async init(base, bank, progress) {
    const [map, nmap] = await Promise.all([
      loadTex(`${base}/tex/veg_a.webp`, { srgb: true, aniso: 4 }),
      loadTex(`${base}/tex/veg_n.jpg`, { srgb: false, aniso: 4 }),
    ]);
    const atlasMat = (cat) => patchMaterial(new THREE.MeshStandardMaterial({ map, normalMap: nmap, normalScale: new THREE.Vector2(0.8, 0.8), alphaTest: 0.5, alphaToCoverage: true, transparent: false, depthWrite: true, side: THREE.DoubleSide, vertexColors: true, roughness: 0.72 }), {
      key: 'atlas', wind: true, alphaBoost: true, fade: true, canopy: 0.35, uniforms: { uFade: cat === 'tree' ? FADE_TREE : FADE_BUSH },
      afterLights: `{ vec3 vdir = normalize(vWP - uCamPos); float bl = pow(max(dot(vdir, uSunDir), 0.0), 3.0);
        float leaf = 1.0 - step(vMapUv.x, 0.5) * step(0.5, vMapUv.y);
        reflectedLight.directDiffuse += diffuseColor.rgb * gSunDirect * (0.08 + bl * 0.55) * leaf * RECIPROCAL_PI * 3.0; }`,
    });
    this.atlasTree = atlasMat('tree'); this.atlasBush = atlasMat('bush');
    const A = this.rects;
    const add = (t) => { this.types.push(t); return this.types.length - 1; };
    const glb = (name) => bank.gltf[name] ? bank.gltf[name].scene : null;
    this.arch = {};
    const reg = (arch, idx) => { (this.arch[arch] = this.arch[arch] || []).push(idx); };

    progress(0.1, 'Palmiers et plantes (tes modèles)…');
    // --- palmier du joueur : 3 variantes de hauteur, inclinaison par instance ---
    const palm = glb('palm');
    if (palm) {
      for (const hgt of [8.5, 10, 11.5]) {
        const p = glbParts(palm, hgt, 'tree', { bend: true, leanH: { value: hgt }, thicken: 1.5 });
        if (p) reg('palm', add({ cat: 'tree', name: 'palmier', parts: p.parts, h: p.h, trunkR: 0.3, crownR: p.r, lean: true }));
      }
    }
    // --- pack de plantes : séparation plante par plante ---
    const pack = glb('plants');
    if (pack) {
      const groups = new Map();
      pack.traverse((o) => {
        if (!o.isMesh) return;
        const key = o.name.replace(/_MI_.*$/, '').replace(/^tree\.\d+/, '');
        if (/Circle_BG/i.test(key)) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(o);
      });
      for (const [key, meshes] of groups) {
        const g = new THREE.Group();
        pack.updateMatrixWorld(true);
        for (const m of meshes) { const c = m.clone(); c.matrixAutoUpdate = false; c.matrix.copy(m.matrixWorld); g.add(c); }
        const kind = /Palm/i.test(key) ? 'ppalm' : /Banana/i.test(key) ? 'gbanana' : /Fern/i.test(key) ? 'gfern' : 'gmonst';
        if (kind !== 'ppalm') continue; // seuls les arbres de l'ancien décor sont gardés
        const hgt = kind === 'ppalm' ? 4.2 : kind === 'gbanana' ? 3.0 : kind === 'gfern' ? 1.1 : 1.3;
        const cat = kind === 'ppalm' ? 'tree' : 'bush';
        const p = glbParts(g, hgt, cat, { maxTris: cat === 'bush' ? 1300 : 2600, thicken: kind === 'ppalm' ? 1.4 : 0 });
        if (p) reg(kind, add({ cat, name: key, parts: p.parts, h: p.h, trunkR: 0.12, crownR: p.r }));
      }
    }
    // nouveau sous-bois (Poly Haven, tailles réelles) : fougères, touffes d'herbe, othonna, racines
    const realParts = (scene, filter, k, kind, opts = {}) => {
      if (!scene) return;
      scene.updateMatrixWorld(true);
      scene.traverse((o) => {
        if (!o.isMesh || (filter && !filter(o.name))) return;
        const g = new THREE.Group(); const c = o.clone(); c.matrixAutoUpdate = false; c.matrix.copy(o.matrixWorld); g.add(c);
        const bb = new THREE.Box3().setFromObject(c);
        const p = glbParts(g, (bb.max.y - bb.min.y) * k, 'bush', opts);
        if (p) reg(kind, add({ cat: 'bush', name: kind, parts: p.parts, h: p.h, crownR: p.r }));
      });
    };
    realParts(glb('fern2'), null, 3.2, 'fern', { maxTris: 1200 });
    realParts(glb('grass2'), (n) => /(mid|large|tall)/.test(n), 3.0, 'grass', { maxTris: 900 });
    realParts(glb('othonna'), null, 1.0, 'othonna', { maxTris: 1600 });
    realParts(glb('roots'), null, 1.0, 'roots', { still: true });
    progress(0.3, 'Grands arbres de la jungle…');
    // --- grand tronc scanné + couronne de vraies feuilles ---
    // grands arbres : un seul fût d'écorce continu du sol à la couronne (évasé à la base, contreforts),
    // plus de pied scanné qui faisait des cassures dans le tronc
    for (let k = 0; k < 4; k++) {
      const rnd = mulberry32(950 + k * 13), b = new GeoBuilder();
      const r = 0.5 + k * 0.06, top = 14 + k * 1.6, CR = 7 + k * 0.7;
      const lean = [(rnd() - 0.5) * 1.4, (rnd() - 0.5) * 1.4];
      tube(b, [new V3(0, -0.4, 0), new V3(0, 0.6, 0), new V3(lean[0] * 0.15, 2.2, lean[1] * 0.15), new V3(lean[0] * 0.5, top * 0.45, lean[1] * 0.5), new V3(lean[0] * 0.8, top * 0.8, lean[1] * 0.8), new V3(lean[0], top, lean[1])],
        [r * 2.1, r * 1.55, r * 1.12, r * 0.95, r * 0.78, r * 0.6], 12, A.treeBark, 2.4, { ao0: 0.5, ao1: 0.9, flex1: 0.03 });
      // contreforts : racines plates qui partent du tronc et plongent dans le sol
      const nR = 4 + (k % 2);
      for (let q = 0; q < nR; q++) {
        const a = (q / nR) * Math.PI * 2 + rnd() * 0.6, ca = Math.cos(a), sa = Math.sin(a), L = 1.6 + rnd() * 1.2;
        tube(b, [new V3(ca * r * 0.6, 1.8 + rnd() * 0.6, sa * r * 0.6), new V3(ca * (r + L * 0.45), 0.5, sa * (r + L * 0.45)), new V3(ca * (r + L), -0.25, sa * (r + L))],
          [r * 0.42, r * 0.28, r * 0.1], 6, A.treeBark, 1.6, { ao0: 0.55, ao1: 0.75 });
      }
      const geo = makeCanopy(A, 900 + k, top - 0.5, CR, b);
      reg('giant', add({ cat: 'tree', name: 'grand arbre', parts: [{ geo, mat: this.atlasTree }], h: top + CR * 0.8, trunkR: r * 1.3, crownR: CR + 1 }));
    }
    // Seuls les modèles .glb du joueur sont affichés. Les versions générées ne servent que de secours
    // si un modèle n'a pas pu être chargé (sinon l'île serait vide).
    let seed = 3000;
    if (!this.arch.giant) for (const a of ['mango', 'almond', 'banyan']) { const t = makeBroadleaf(A, seed += 71, a); reg('giant', add({ cat: 'tree', name: a, parts: [{ geo: t.b.build(), mat: this.atlasTree }], h: t.h, trunkR: t.trunkR, crownR: t.crownR })); }
    if (!this.arch.palm) for (let k = 0; k < 4; k++) { const t = makePalm(A, 1000 + k * 77, false); reg('palm', add({ cat: 'tree', name: 'palmier', parts: [{ geo: t.b.build(), mat: this.atlasTree }], h: t.h, trunkR: t.trunkR, crownR: t.crownR })); }
    if (!this.arch.ppalm) for (let k = 0; k < 3; k++) { const t = makePalm(A, 1500 + k * 77, true); reg('ppalm', add({ cat: 'tree', name: 'jeune palmier', parts: [{ geo: t.b.build(), mat: this.atlasTree }], h: t.h, trunkR: t.trunkR, crownR: t.crownR })); }
    progress(0.55, 'Placement de la végétation sur l’île…');
    await tick();
    this.place();
    progress(0.8, 'Végétation lointaine…');
    await tick();
    this.buildMeshes();
    this.buildImpostors();
    progress(1, `${this.count.trees.toLocaleString('fr-FR')} arbres et ${this.count.bushes.toLocaleString('fr-FR')} plantes placés`);
  }

  place() {
    const T = this.T, W = T.W, rnd = mulberry32(4242), A = this.arch;
    const pick = (arch) => { const l = A[arch] || A.palm; return l[Math.floor(rnd() * l.length)]; };
    const spawn = this.world.spawn, pier = this.world.pier;
    const nearPier = (x, z) => { const dx = pier.x1 - pier.x0, dz = pier.z1 - pier.z0, L2 = dx * dx + dz * dz; const t = clamp(((x - pier.x0) * dx + (z - pier.z0) * dz) / L2, -0.6, 1); return Math.hypot(x - pier.x0 - dx * t, z - pier.z0 - dz * t) < 14; };
    const choose = (all) => { const list = all.filter((e) => A[e[0]] && e[1] > 0); if (!list.length) return null; const tot = list.reduce((a, b) => a + b[1], 0); let u = rnd() * tot; for (const [k, w] of list) { u -= w; if (u <= 0) return k; } return list[0][0]; };
    const I = { x: [], y: [], z: [], r: [], s: [], t: [], c: [], l: [], ta: [], ax: [], az: [] };
    // campement et étangs : rien n'y pousse (sauf les berges)
    const camp = this.world.camp, ponds = this.world.ponds || [];
    const blocked = (x, z) => (camp && Math.hypot(x - camp.x, z - camp.z) < camp.r + 3) || ponds.some((p) => T.height(x, z) < p.level + 0.1 && Math.hypot(x - p.x, z - p.z) < p.r * 1.6);
    const nrm = new V3();
    let trees = 0, bushes = 0;
    const TC = 4.6;
    for (let gz = -W / 2; gz < W / 2; gz += TC) for (let gx = -W / 2; gx < W / 2; gx += TC) {
      const x = gx + rnd() * TC, z = gz + rnd() * TC, h = T.height(x, z);
      if (h < 0.9 || h > 285) continue;
      if (T.mask(T.path, x, z) > 0.2 || T.mask(T.clear, x, z) > 0.3 || Math.hypot(x - spawn.x, z - spawn.z) < 16 || nearPier(x, z) || blocked(x, z)) continue;
      const wet = T.mask(T.wet, x, z);
      T.normal(x, z, nrm, 2);
      const slope = 1 - nrm.y, nz = vnoise(x * 0.012, z * 0.012), nz2 = vnoise(x * 0.05 + 9, z * 0.05 - 3);
      const beach = 1.7 + vnoise(x * 0.045, z * 0.045) * 1.3;
      let p, list;
      if (h < beach) { p = 0.05; list = [['palm', 1]]; }
      else if (h < 10) { p = 0.42; list = [['palm', 7], ['ppalm', 1.5], ['giant', 0.5]]; }
      else if (h < 175) { p = 0.5 * (0.75 + nz * 0.5); list = [['giant', 2.4], ['palm', 2.2], ['ppalm', 2.0]]; }
      else { p = 0.2 * (1 - smoothstep(220, 285, h)); list = [['ppalm', 1.2], ['palm', 0.6], ['giant', 0.4]]; }
      if (wet > 0.55) p *= 0.12;
      if (h > 3 && Math.max(T.mask(T.path, x + 5, z), T.mask(T.path, x - 5, z), T.mask(T.path, x, z + 5), T.mask(T.path, x, z - 5)) > 0.3) p = Math.max(p, 0.7);
      if (slope > 0.5) p *= 0.2;
      p *= 0.75 + nz2 * 0.5;
      if (rnd() > p * this.q.density) continue;
      const arch = choose(list);
      if (!arch) continue;
      const type = pick(arch);
      let rot = rnd() * Math.PI * 2, lean = 0;
      if (arch === 'palm') {
        // chaque palmier a sa propre direction ; seuls ceux du bord de mer penchent plutôt vers l'eau
        lean = h < 5 ? 0.2 + rnd() * 0.55 : rnd() * 0.35;
        if (h < 5 && rnd() < 0.6) { const dx = -nrm.x, dz = -nrm.z, l = Math.hypot(dx, dz); if (l > 0.01) rot = Math.atan2(-dz / l, dx / l) + (rnd() - 0.5) * 2.2; }
      }
      I.ta.push(0); I.ax.push(0); I.az.push(0);
      I.x.push(x); I.y.push(h - 0.08); I.z.push(z); I.r.push(rot); I.s.push(0.82 + rnd() * 0.36); I.t.push(type); I.c.push(0.84 + rnd() * 0.28); I.l.push(lean);
      trees++;
    }
    const BC = 1.8;
    // proximité d'une route : bordure de végétation dense, nette, comme un vrai chemin dans la jungle
    const nearRoad = (x, z) => Math.max(T.mask(T.path, x + 3.2, z), T.mask(T.path, x - 3.2, z), T.mask(T.path, x, z + 3.2), T.mask(T.path, x, z - 3.2));
    for (let gz = -W / 2; gz < W / 2; gz += BC) for (let gx = -W / 2; gx < W / 2; gx += BC) {
      const x = gx + rnd() * BC, z = gz + rnd() * BC, h = T.height(x, z);
      if (h < 0.7 || h > 270) continue;
      if (T.mask(T.path, x, z) > 0.2 || Math.hypot(x - spawn.x, z - spawn.z) < 9 || nearPier(x, z) || blocked(x, z)) continue;
      const edge = nearRoad(x, z) > 0.3;
      const clear = T.mask(T.clear, x, z), wet = T.mask(T.wet, x, z);
      T.normal(x, z, nrm, 2);
      const slope = 1 - nrm.y, nz = vnoise(x * 0.03 + 4, z * 0.03 - 8);
      const beach = 1.7 + vnoise(x * 0.045, z * 0.045) * 1.3;
      let p, list;
      if (h < beach) continue; // plage nette : pas de touffes plantées dans le sable
      if (h < 10) { p = 0.75 * (0.7 + nz * 0.6); list = [['grass', 3], ['othonna', 0.8], ['fern', 1.2]]; }
      else if (h < 190) { p = 0.98 * (0.7 + nz * 0.5); list = [['fern', 6], ['grass', 2], ['roots', wet > 0.05 ? 0.5 : 0.18], ['othonna', 0.15]]; }
      else { p = 0.4; list = [['othonna', 2], ['grass', 2]]; }
      if (clear > 0.3) { p = 0.85; list = [['grass', 4], ['fern', 0.5]]; }
      if (edge && h > beach + 0.3) { p = 1.2; list = [['fern', 3], ['grass', 2]]; }
      if (wet > 0.75) p *= 0.3;
      if (slope > 0.55) p *= 0.3;
      if (rnd() > p * this.q.density) continue;
      const arch = choose(list);
      if (!arch) continue;
      { const hl = Math.hypot(nrm.x, nrm.z); I.ta.push(hl > 1e-3 ? Math.min(slope * 2.2, 0.75) : 0); I.ax.push(hl > 1e-3 ? nrm.z / hl : 0); I.az.push(hl > 1e-3 ? -nrm.x / hl : 0); }
      I.x.push(x); I.y.push(h - 0.04); I.z.push(z); I.r.push(rnd() * Math.PI * 2); I.s.push(edge ? 1.0 + rnd() * 0.6 : 0.75 + rnd() * 0.55); I.t.push(pick(arch)); I.c.push(0.82 + rnd() * 0.32); I.l.push(0);
      bushes++;
    }
    this.count = { trees, bushes };
    const n = I.x.length;
    this.dead = new Uint8Array(I.x.length);
    this.I = { ta: new Float32Array(I.ta), ax: new Float32Array(I.ax), az: new Float32Array(I.az), x: new Float32Array(I.x), y: new Float32Array(I.y), z: new Float32Array(I.z), r: new Float32Array(I.r), s: new Float32Array(I.s), t: new Uint16Array(I.t), c: new Float32Array(I.c), l: new Float32Array(I.l), n };
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

  refresh() { this.lastCam.set(1e9, 0, 0); this._t = 1; }
  // arbre debout le plus proche d'un point (sert à retrouver les arbres abattus d'une sauvegarde)
  treeAt(x, z, maxD = 0.8) {
    const W = this.T.W, GC = this.GC, GN = this.GN, I = this.I;
    const cx = clamp(Math.floor((x + W / 2) / GC), 0, GN - 1), cz = clamp(Math.floor((z + W / 2) / GC), 0, GN - 1);
    let best = -1, bd = maxD;
    for (const i of this.cells[cz * GN + cx]) {
      if (this.types[I.t[i]].cat !== 'tree' || this.dead[i]) continue;
      const d = Math.hypot(I.x[i] - x, I.z[i] - z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  canopyList() {
    const out = [], I = this.I;
    for (let i = 0; i < I.n; i++) { const t = this.types[I.t[i]]; if (t.cat === 'tree' && !this.dead[i]) out.push({ x: I.x[i], z: I.z[i], r: t.crownR * I.s[i] * 0.95 }); }
    return out;
  }
  // Couronnes de palmiers proches d'un point (perchoirs pour les oiseaux)
  palmTops(n, near, rnd) {
    const out = [], I = this.I;
    for (let tries = 0; tries < 20000 && out.length < n; tries++) {
      const i = Math.floor(rnd() * I.n), t = this.types[I.t[i]];
      if (t.name !== 'palmier' || (near && Math.hypot(I.x[i] - near.x, I.z[i] - near.z) > near.r)) continue;
      out.push(new V3(I.x[i] + Math.cos(I.r[i]) * I.l[i] * t.h * 0.33 * I.s[i], I.y[i] + t.h * I.s[i] * 0.93, I.z[i] - Math.sin(I.r[i]) * I.l[i] * t.h * 0.33 * I.s[i]));
    }
    return out;
  }
  trunksNear(x, z, r, out) {
    out.length = 0;
    const W = this.T.W, GC = this.GC, GN = this.GN, I = this.I;
    const c0x = clamp(Math.floor((x - r + W / 2) / GC), 0, GN - 1), c1x = clamp(Math.floor((x + r + W / 2) / GC), 0, GN - 1);
    const c0z = clamp(Math.floor((z - r + W / 2) / GC), 0, GN - 1), c1z = clamp(Math.floor((z + r + W / 2) / GC), 0, GN - 1);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) for (const i of this.cells[cz * GN + cx]) {
      const t = this.types[I.t[i]];
      if (t.cat !== 'tree' || !t.trunkR || this.dead[i]) continue;
      const dx = I.x[i] - x, dz = I.z[i] - z;
      if (dx * dx + dz * dz < r * r) out.push({ x: I.x[i], z: I.z[i], r: t.trunkR * I.s[i] + 0.1, i });
    }
    return out;
  }

  buildMeshes() {
    const counts = new Array(this.types.length).fill(0);
    for (let i = 0; i < this.I.n; i++) counts[this.I.t[i]]++;
    this.groups = this.types.map((t, k) => {
      const cap = Math.max(1, Math.min(counts[k], t.cat === 'tree' ? 500 : 700));
      const meshes = [];
      let matAttr = null, colAttr = null, leanAttr = null;
      if (t.lean) { leanAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); leanAttr.setUsage(THREE.DynamicDrawUsage); }
      for (const part of t.parts) {
        if (leanAttr) part.geo.setAttribute('aLean', leanAttr);
        const m = new THREE.InstancedMesh(part.geo, part.mat, cap);
        if (!matAttr) { matAttr = m.instanceMatrix; matAttr.setUsage(THREE.DynamicDrawUsage); colAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); colAttr.setUsage(THREE.DynamicDrawUsage); }
        m.instanceMatrix = matAttr;
        m.instanceColor = colAttr;
        m.count = 0;
        m.name = t.name;
        m.frustumCulled = false;
        m.castShadow = t.cat === 'tree';
        m.receiveShadow = true;
        m.shadowCount = 0;
        m.onBeforeShadow = function () { this._c = this.count; this.count = this.shadowCount; };
        m.onAfterShadow = function () { this.count = this._c; };
        this.scene.add(m);
        meshes.push(m);
      }
      return { meshes, matAttr, colAttr, leanAttr, cap, d: [] };
    });
  }

  // Imposteurs : chaque type est rendu dans un atlas (couleur + normales) puis affiché en panneaux au loin
  buildImpostors() {
    const r = this.renderer, TILE = 128, GRIDN = 10, S = TILE * GRIDN;
    const mk = () => new THREE.WebGLRenderTarget(S, S, { type: THREE.UnsignedByteType, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true });
    this.impA = mk(); this.impN = mk();
    const capMats = new Map();
    const capMat = (mat, mode) => {
      const key = mat.uuid + mode;
      if (capMats.has(key)) return capMats.get(key);
      const m = new THREE.ShaderMaterial({
        uniforms: { map: { value: mat.map }, uColor: { value: mat.color || new THREE.Color(1, 1, 1) }, uAT: { value: mat.alphaTest || 0 } },
        defines: { HAS_MAP: mat.map ? 1 : 0, VC: mat.vertexColors ? 1 : 0 },
        vertexShader: 'attribute vec3 color;\nvarying vec2 vUv; varying vec3 vN; varying vec3 vC;\nvoid main(){ vUv = uv; vN = normal;\n#if VC\n vC = color;\n#else\n vC = vec3(1.0);\n#endif\n gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D map; uniform vec3 uColor; uniform float uAT; varying vec2 vUv; varying vec3 vN; varying vec3 vC;
          void main(){ vec4 c = vec4(uColor, 1.0);
          #if HAS_MAP
          c *= texture2D(map, vUv);
          #endif
          if (uAT > 0.0 && c.a < max(uAT, 0.4)) discard;
          ${mode === 0 ? 'gl_FragColor = vec4(sqrt(clamp(c.rgb * vC, 0.0, 1.0)), 1.0);' : 'vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0); gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);'} }`,
        side: THREE.DoubleSide,
      });
      capMats.set(key, m);
      return m;
    };
    const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 200);
    const prev = r.getRenderTarget(), pc = r.getClearColor(new THREE.Color()), pa = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    this.impInfo = [];
    for (const [rt, mode] of [[this.impA, 0], [this.impN, 1]]) {
      r.setRenderTarget(rt); r.clear();
      let tile = 0;
      this.types.forEach((t, k) => {
        if (tile >= GRIDN * GRIDN) return;
        sc.clear();
        const box = new THREE.Box3();
        for (const p of t.parts) { const m = new THREE.Mesh(p.geo, capMat(p.mat, mode)); sc.add(m); p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
        const hw = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) * 1.02;
        const top = box.max.y * 1.02, bot = Math.max(box.min.y, -0.3), half = Math.max(hw, (top - bot) / 2);
        cam.left = -half; cam.right = half; cam.bottom = (top + bot) / 2 - half; cam.top = (top + bot) / 2 + half;
        cam.updateProjectionMatrix();
        const tx = tile % GRIDN, ty = Math.floor(tile / GRIDN);
        rt.viewport.set(tx * TILE, ty * TILE, TILE, TILE); rt.scissor.set(tx * TILE, ty * TILE, TILE, TILE); rt.scissorTest = true;
        r.setRenderTarget(rt);
        r.render(sc, cam);
        if (mode === 0) this.impInfo[k] = { tile, size: half * 2, yMin: (top + bot) / 2 - half };
        tile++;
      });
      rt.scissorTest = false; rt.viewport.set(0, 0, S, S);
    }
    sc.clear();
    r.setRenderTarget(prev); r.setClearColor(pc, pa);
    const mkLayer = (cap, fade, order) => {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const a1 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const a2 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aI', a1); g.setAttribute('aT', a2);
      g.instanceCount = 0;
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...U, tA: { value: this.impA.texture }, tN: { value: this.impN.texture }, uFade: fade },
        vertexShader: /* glsl */`
          ${GLSL_COMMON}
          attribute vec4 aI; attribute vec2 aT; uniform vec2 uFade;
          varying vec2 vUv; varying vec3 vWP; varying vec3 vR; varying vec3 vF; varying vec3 vUpB; varying float vTint; varying float vD;
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
            vUv = (vec2(mod(aT.x, 10.0), floor(aT.x / 10.0)) + vec2(position.x + 0.5, position.y)) / 10.0;
            vWP = p; vR = r; vF = normalize(cross(r, up)); vUpB = up; vTint = aT.y;
            vD = distance(uCamPos, aI.xyz);
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */`
          ${GLSL_COMMON}
          ${GLSL_BAYER}
          uniform sampler2D tA; uniform sampler2D tN; uniform vec2 uFade;
          varying vec2 vUv; varying vec3 vWP; varying vec3 vR; varying vec3 vF; varying vec3 vUpB; varying float vTint; varying float vD;
          void main() {
            vec4 a = texture2D(tA, vUv);
            if (a.a < 0.32) discard;
            float fin = smoothstep(uFade.x, uFade.y, vD);
            if (fin < bayer4(gl_FragCoord.xy)) discard;
            vec3 alb = a.rgb * a.rgb * vTint;
            vec3 nn = texture2D(tN, vUv).xyz * 2.0 - 1.0;
            vec3 n = normalize(vR * nn.x + vUpB * nn.y + vF * nn.z);
            vec4 lt = lightAt(vWP);
            float sv = lt.r * lt.b;
            float ndl = max(dot(n, uSunDir), 0.0) * 0.8 + 0.2 * max(dot(-vF, uSunDir), 0.0);
            vec3 col = alb * (uSunColor * ndl * sv / 3.14159 + uSkyAmb * (0.55 + 0.45 * n.y) * mix(1.0, 0.6, lt.g));
            gl_FragColor = vec4(applyAerial(col, vWP), 1.0);
          }`,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false; mesh.renderOrder = order;
      this.scene.add(mesh);
      return { g, a1, a2, mesh };
    };
    this.impTree = mkLayer(this.count.trees + 16, FADE_TREE, 0);
    this.impBush = mkLayer(Math.min(this.count.bushes, 60000) + 16, FADE_BUSH, 0);
  }

  // un arbre percuté oscille puis se stabilise
  wobble(i, dx, dz, amp) { const l = Math.hypot(dx, dz) || 1; this.wobbles.set(i, { t: 0, x: dz / l, z: -dx / l, amp, a: 0 }); }
  // buissons et fougères sous le buggy : arrachés
  bushesNear(x, z, r) {
    const W = this.T.W, GC = this.GC, GN = this.GN, I = this.I, out = [];
    const cx = clamp(Math.floor((x + W / 2) / GC), 0, GN - 1), cz = clamp(Math.floor((z + W / 2) / GC), 0, GN - 1);
    for (let j = Math.max(0, cz - 1); j <= Math.min(GN - 1, cz + 1); j++) for (let k = Math.max(0, cx - 1); k <= Math.min(GN - 1, cx + 1); k++) for (const i of this.cells[j * GN + k]) {
      if (this.dead[i] || this.types[I.t[i]].cat !== 'bush') continue;
      if (Math.hypot(I.x[i] - x, I.z[i] - z) < r) out.push(i);
    }
    return out;
  }
  update(camera, dt) {
    const cam = camera.position;
    const moved = cam.distanceToSquared(this.lastCam) > 4 || camera.quaternion.angleTo(this.lastQ) > 0.1;
    this._t = (this._t || 0) + dt;
    for (const [i, w] of this.wobbles) { w.t += dt; w.a = w.amp * Math.exp(-w.t * 2.2) * Math.cos(w.t * 8); if (w.t > 3) this.wobbles.delete(i); }
    if (!moved && this._t < 0.5 && !this.wobbles.size) return;
    this._t = 0;
    this.lastCam.copy(cam); this.lastQ.copy(camera.quaternion);
    const q = this.q, I = this.I, W = this.T.W, GC = this.GC, GN = this.GN;
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const box = new THREE.Box3();
    for (const g of this.groups) g.d.length = 0;
    const RT = q.tree, RB = q.bush, RIB = q.impBush;
    const RT2 = RT * RT, RB2 = RB * RB, RIB2 = RIB * RIB, RTin = (RT * 0.93) ** 2, RBin = (RB * 0.9) ** 2;
    let nT = 0, nB = 0;
    const tA = this.impTree.a1.array, tB = this.impTree.a2.array, bA = this.impBush.a1.array, bB = this.impBush.a2.array;
    const capB = bA.length / 4;
    for (let cz = 0; cz < GN; cz++) for (let cx = 0; cx < GN; cx++) {
      const c = cz * GN + cx;
      if (!this.cells[c].length) continue;
      box.min.set(-W / 2 + cx * GC - 14, this.cellH[c * 2], -W / 2 + cz * GC - 14);
      box.max.set(box.min.x + GC + 28, this.cellH[c * 2 + 1] + 2, box.min.z + GC + 28);
      if (!fr.intersectsBox(box)) continue;
      const dx = Math.max(box.min.x - cam.x, 0, cam.x - box.max.x), dz = Math.max(box.min.z - cam.z, 0, cam.z - box.max.z);
      const cd2 = dx * dx + dz * dz;
      if (cd2 > 7e6) continue;
      const isTreeOnly = cd2 > RIB2 * 1.1;
      for (const i of this.cells[c]) {
        if (this.dead[i]) continue;
        const t = I.t[i], ty = this.types[t];
        if (isTreeOnly && ty.cat !== 'tree') continue;
        const ex = I.x[i] - cam.x, ez = I.z[i] - cam.z, ey = I.y[i] - cam.y, d2 = ex * ex + ez * ez + ey * ey;
        const info = this.impInfo[t];
        if (ty.cat === 'tree') {
          if (d2 < RT2) { const g = this.groups[t]; if (g.d.length / 2 < g.cap) g.d.push(d2, i); }
          if (d2 > RTin && info) {
            const s = I.s[i];
            tA[nT * 4] = I.x[i]; tA[nT * 4 + 1] = I.y[i] + info.yMin * s; tA[nT * 4 + 2] = I.z[i]; tA[nT * 4 + 3] = info.size * s;
            tB[nT * 2] = info.tile; tB[nT * 2 + 1] = I.c[i]; nT++;
          }
        } else {
          if (d2 < RB2) { const g = this.groups[t]; if (g.d.length / 2 < g.cap) g.d.push(d2, i); }
          if (d2 > RBin && d2 < RIB2 && info && nB < capB) {
            const s = I.s[i];
            bA[nB * 4] = I.x[i]; bA[nB * 4 + 1] = I.y[i] + info.yMin * s; bA[nB * 4 + 2] = I.z[i]; bA[nB * 4 + 3] = info.size * s;
            bB[nB * 2] = info.tile; bB[nB * 2 + 1] = I.c[i]; nB++;
          }
        }
      }
    }
    const SR2 = q.shadow * q.shadow;
    this.groups.forEach((g, t) => {
      const d = g.d, n = d.length / 2;
      if (!n) { for (const m of g.meshes) { m.count = 0; m.shadowCount = 0; } return; }
      const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => d[a * 2] - d[b * 2]);
      const A = g.matAttr.array, C = g.colAttr.array, L = g.leanAttr ? g.leanAttr.array : null;
      let sc = 0;
      for (let k = 0; k < n; k++) {
        const i = d[order[k] * 2 + 1], s = I.s[i], r = I.r[i], cs = Math.cos(r) * s, sn = Math.sin(r) * s, o = k * 16;
        const wb = this.wobbles.size ? this.wobbles.get(i) : null;
        const ta = wb ? wb.a : I.ta[i];
        if (Math.abs(ta) > 0.002) {
          _q.setFromAxisAngle(wb ? _ax.set(wb.x, 0, wb.z) : _ax.set(I.ax[i], 0, I.az[i]), ta).multiply(_q2.setFromAxisAngle(_up, r));
          _m.compose(_p.set(I.x[i], I.y[i], I.z[i]), _q, _s.setScalar(s)).toArray(A, o);
        } else {
        A[o] = cs; A[o + 1] = 0; A[o + 2] = -sn; A[o + 3] = 0; A[o + 4] = 0; A[o + 5] = s; A[o + 6] = 0; A[o + 7] = 0;
        A[o + 8] = sn; A[o + 9] = 0; A[o + 10] = cs; A[o + 11] = 0; A[o + 12] = I.x[i]; A[o + 13] = I.y[i]; A[o + 14] = I.z[i]; A[o + 15] = 1;
        }
        const tint = I.c[i];
        C[k * 3] = tint * (0.96 + (tint - 1) * 0.3); C[k * 3 + 1] = tint; C[k * 3 + 2] = tint * 0.93;
        if (L) L[k] = I.l[i];
        if (d[order[k] * 2] < SR2) sc = k + 1;
      }
      g.matAttr.needsUpdate = true; g.matAttr.clearUpdateRanges(); g.matAttr.addUpdateRange(0, n * 16);
      g.colAttr.needsUpdate = true; g.colAttr.clearUpdateRanges(); g.colAttr.addUpdateRange(0, n * 3);
      if (g.leanAttr) { g.leanAttr.needsUpdate = true; }
      for (const m of g.meshes) { m.count = n; m.shadowCount = sc; }
    });
    for (const [layer, n] of [[this.impTree, nT], [this.impBush, nB]]) {
      layer.g.instanceCount = n;
      layer.a1.needsUpdate = true; layer.a1.clearUpdateRanges(); layer.a1.addUpdateRange(0, n * 4);
      layer.a2.needsUpdate = true; layer.a2.clearUpdateRanges(); layer.a2.addUpdateRange(0, n * 2);
    }
  }
}

function tick() { return new Promise((r) => setTimeout(r, 0)); }
export { hash2 };
