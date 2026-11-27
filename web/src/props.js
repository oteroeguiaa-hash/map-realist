// Rochers scannés, coquillages, bois flotté, ponton, abri, manche à air, avion de brousse et hydravion.
import * as THREE from 'three';
import { patchMaterial, loadTex, fetchBuf, mulberry32, clamp, lerp, vnoise, GeoBuilder, mergeGeometries } from './core.js';
import { floatGeo } from './flora.js';
import { rockyBeach } from './sites.js';

const V3 = THREE.Vector3;

function stdMat(params, key) { return patchMaterial(new THREE.MeshStandardMaterial(params), { key }); }

export class Props {
  constructor(scene, terrain, world, atlas, bank) {
    this.scene = scene; this.T = terrain; this.world = world; this.atlas = atlas; this.bank = bank;
    this.colliders = [];
    this.groups = [];
    this.lastCam = new V3(1e9, 0, 0);
  }
  async init(base) {
    void base;
    this.buildDecorTypes();
    this.placeDecor();
    this.buildPier();
    this.buildStrip();
    this.buildPlanes();
  }

  // Nouveau décor (Poly Haven, tailles réelles en mètres) : chaque maillage devient un type instancié
  buildDecorTypes() {
    this.types = {};
    const names = ['nboulder2', 'nboulder5', 'rockface', 'mossrocks', 'ncliff', 'mountain', 'trunk2', 'sandrocks'];
    for (const name of names) {
      const g = this.bank && this.bank.gltf[name];
      if (!g) continue;
      g.scene.updateMatrixWorld(true);
      let k = 0;
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const geo = floatGeo(o.geometry);
        geo.applyMatrix4(o.matrixWorld);
        geo.computeBoundingBox();
        const b = geo.boundingBox;
        geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
        if (!geo.attributes.normal) geo.computeVertexNormals();
        geo.computeBoundingBox(); geo.computeBoundingSphere();
        const bb = geo.boundingBox, src = o.material;
        const mat = stdMat({ map: src.map || null, normalMap: src.normalMap || null, roughnessMap: src.roughnessMap || null, roughness: 1, metalness: 0 }, 'decor');
        const key = k ? `${name}${k}` : name;
        this.types[key] = { name, geo, mat, size: [bb.max.x - bb.min.x, bb.max.y, bb.max.z - bb.min.z] };
        k++;
      });
    }
  }

  placeDecor() {
    const T = this.T, W = T.W, rnd = mulberry32(777), w = this.world, TY = this.types;
    const lists = {};
    for (const k in TY) lists[k] = [];
    const keys = (...names) => Object.keys(TY).filter((k) => names.includes(TY[k].name));
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const nrm = new V3();
    // taille voulue (plus grande dimension) entre a et b mètres
    const add = (k, x, z, a, b, sink = 0.12, tilt = 0) => {
      const t = TY[k]; if (!t) return;
      const d = Math.max(...t.size), s = (a + rnd() * (b - a)) / d;
      const y = T.height(x, z) - sink * t.size[1] * s;
      const it = { x, y, z, s, rot: rnd() * 6.28, tint: 0.85 + rnd() * 0.25, tilt, k, size: Math.max(...t.size) * s };
      lists[k].push(it);
      if (Math.max(t.size[0], t.size[2]) * s > 1.4 && t.name !== 'sandrocks') { it.col = { x, z, r: Math.min(t.size[0], t.size[2]) * s * 0.45, top: y + t.size[1] * s }; this.colliders.push(it.col); }
    };
    const ROCKS = keys('nboulder2', 'nboulder5', 'mossrocks'), FACES = keys('rockface', 'ncliff'), MOUNT = keys('mountain', 'ncliff');
    for (let i = 0; i < 26000; i++) {
      const x = (rnd() - 0.5) * W * 0.85, z = (rnd() - 0.5) * W * 0.85;
      const h = T.height(x, z);
      if (h < -1.2 || h > 330) continue;
      if (T.mask(T.path, x, z) > 0.15 || T.mask(T.clear, x, z) > 0.3) continue;
      if (Math.hypot(x - w.spawn.x, z - w.spawn.z) < 25) continue;
      if (w.camp && Math.hypot(x - w.camp.x, z - w.camp.z) < w.camp.r + 4) continue;
      if ((w.ponds || []).some((p) => Math.hypot(x - p.x, z - p.z) < p.r * 1.3)) continue;
      T.normal(x, z, nrm, 2);
      const slope = 1 - nrm.y, u = rnd();
      if (h > -0.6 && h < 3.2 && rockyBeach(x, z) && u < 0.5) {                                 // criques rocheuses : rochers sur le sable
        if (u < 0.32) add(pick(keys('sandrocks')), x, z, 3, 5, 0.06); else add(pick(ROCKS), x, z, 1.5, 4.5, 0.25);
      }
      else if (h < 5 && slope > 0.15 && u < 0.45) add(pick(ROCKS), x, z, 2, 5, 0.2);              // rochers de la côte
      else if (h > 0.3 && h < 1.8 && u < 0.004) add(pick(keys('sandrocks')), x, z, 3, 5, 0.05); // galets sur le sable
      else if (h > 0.6 && h < 2.2 && u < 0.003) add(pick(keys('trunk2')), x, z, 3.5, 5, 0.15);  // bois flotté
      else if (slope > 0.45 && h > 8 && u < 0.12) add(pick(FACES), x, z, 4, 9, 0.3);          // parois rocheuses
      else if (h > 12 && h < 200 && u < 0.02) add(pick(ROCKS), x, z, 2, 5, 0.25);             // rochers moussus en forêt
      else if (h > 12 && h < 160 && u < 0.035) add(pick(keys('trunk2')), x, z, 3.5, 5, 0.12); // troncs tombés
      else if (h >= 180 && u < 0.05) add(pick(MOUNT), x, z, 8, 18, 0.3);                       // flancs du volcan
    }
    // criques rocheuses : beaucoup de rochers posés sur le sable (et des crabes autour)
    for (let i = 0; i < 90000; i++) {
      const x = (rnd() - 0.5) * W * 0.9, z = (rnd() - 0.5) * W * 0.9;
      if (!rockyBeach(x, z)) continue;
      const h = T.height(x, z);
      if (h < -0.8 || h > 3.0 || T.mask(T.path, x, z) > 0.1 || Math.hypot(x - w.spawn.x, z - w.spawn.z) < 30) continue;
      const u = rnd();
      if (u < 0.08) add(pick(keys('sandrocks')), x, z, 3, 5, 0.06);
      else if (u < 0.2) add(pick(ROCKS), x, z, 0.8, 4.5, 0.3);
    }
    // cascade : falaises autour de l'amphithéâtre et rochers au bord du bassin
    const lip = w.waterfall.lip, dir = w.waterfall.dir, pool = w.waterfall.pool, perp = [-dir[1], dir[0]];
    const CL = keys('ncliff', 'rockface');
    for (let k = -5; k <= 5; k++) {
      if (Math.abs(k) < 1) continue;
      const v = k * 6.5 + (rnd() - 0.5) * 2, u = -2 + Math.abs(k) * (0.9 + Math.abs(k) * 0.35);
      const x = lip[0] + perp[0] * v + dir[0] * u, z = lip[2] + perp[1] * v + dir[1] * u;
      if (CL.length) add(pick(CL), x, z, 7, 10, 0.25);
    }
    for (let k = 0; k < 22; k++) {
      const a = rnd() * Math.PI * 2, r = w.waterfall.poolR + 2 + rnd() * 9;
      add(pick(ROCKS), pool[0] + Math.cos(a) * r, pool[2] + Math.sin(a) * r, 2, 5, 0.3);
    }
    void dir;
    this.lists = lists;
    this.inst = {};
    for (const k of Object.keys(lists)) {
      const t = TY[k], cap = Math.max(1, lists[k].length);
      const im = new THREE.InstancedMesh(t.geo, t.mat, cap);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = t.name !== 'sandrocks'; im.receiveShadow = true;
      im.frustumCulled = false;
      im.count = 0;
      im.userData.R = t.name === 'sandrocks' ? 50 : Math.max(...t.size) > 6 ? 1200 : 120;
      // ombres : seulement les rochers proches (les instances sont triées par distance)
      im.userData.sc = 0;
      im.onBeforeShadow = function () { this._c = this.count; this.count = Math.min(this.count, this.userData.sc); };
      im.onAfterShadow = function () { this.count = this._c; };
      this.scene.add(im);
      this.inst[k] = im;
    }
  }

  // rocher cassable le plus proche devant le joueur (ni falaise, ni montagne, ni bois)
  rockAt(x, z, dx, dz, reach = 1.6) {
    let best = null, bd = 1e9;
    for (const [k, list] of Object.entries(this.lists || {})) {
      const name = this.types[k].name;
      if (!['nboulder2', 'nboulder5', 'mossrocks', 'rockface', 'sandrocks'].includes(name)) continue;
      for (const it of list) {
        if (it.dead || it.size > 6) continue;
        const ex = it.x - x, ez = it.z - z, d = Math.hypot(ex, ez) - it.size * 0.4;
        if (d > reach || d > bd) continue;
        if ((ex * dx + ez * dz) / Math.max(Math.hypot(ex, ez), 0.01) < 0.3) continue;
        bd = d; best = it;
      }
    }
    return best;
  }
  // le rocher se brise : il disparaît, son obstacle aussi ; renvoie le nombre de pierres récoltées
  breakRock(it) {
    it.dead = true;
    if (it.col) { const i = this.colliders.indexOf(it.col); if (i >= 0) this.colliders.splice(i, 1); }
    this.dirty = true;
    return Math.max(2, Math.round(it.size * 2.2));
  }
  // noix de coco tombées au pied des palmiers (une seule géométrie instanciée, ~80 triangles)
  addCoconuts(flora) {
    const I = flora.I, rnd = mulberry32(31), T = this.T, list = [];
    for (let i = 0; i < I.n && list.length < 2500; i++) {
      if (flora.types[I.t[i]].name !== 'palmier' || rnd() > 0.55) continue;
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2, d = 0.4 + rnd() * 1.6, x = I.x[i] + Math.cos(a) * d, z = I.z[i] + Math.sin(a) * d;
        list.push([x, T.height(x, z) + 0.07, z, rnd() * 6.28, 0.85 + rnd() * 0.35]);
      }
    }
    const g = new THREE.IcosahedronGeometry(0.11, 1); g.scale(1, 0.85, 1.1);
    const mat = stdMat({ color: 0x4a3420, roughness: 0.85 }, 'coconut');
    const im = new THREE.InstancedMesh(g, mat, Math.max(1, list.length));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new V3(), p = new V3();
    list.forEach(([x, y, z, r, s], k) => { q.setFromEuler(e.set(r * 0.7, r, 0)); im.setMatrixAt(k, m4.compose(p.set(x, y, z), q, sc.setScalar(s))); });
    im.count = list.length; im.castShadow = false; im.receiveShadow = true;
    im.computeBoundingSphere();
    this.scene.add(im);
    this.coconuts = im;
  }

  buildPier() {
    const p = this.world.pier, T = this.T;
    const dx = p.x1 - p.x0, dz = p.z1 - p.z0, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, vx = -uz, vz = ux;
    // bois du ponton : écorce du nouveau tronc mort (dead_tree_trunk_02)
    const wood = this.types.trunk2 ? this.types.trunk2.mat : null;
    const mat = stdMat({ map: wood ? wood.map : null, normalMap: wood ? wood.normalMap : null, roughness: 0.85, color: wood ? 0xd8cfc0 : 0x8a6a4a }, 'pier');
    const geos = [];
    const box = (cx, cy, cz, sx, sy, sz, rot) => {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      g.rotateY(rot);
      g.translate(cx, cy, cz);
      geos.push(g);
    };
    const rot = Math.atan2(ux, uz);
    for (let s = 0; s < L; s += 0.28) {
      const x = p.x0 + ux * s, z = p.z0 + uz * s;
      box(x, p.deckY + (Math.random() - 0.5) * 0.02, z, 2.6, 0.06, 0.25, rot);
    }
    for (let s = 0; s <= L; s += 3) for (const side of [-1, 1]) {
      const x = p.x0 + ux * s + vx * 1.2 * side, z = p.z0 + uz * s + vz * 1.2 * side;
      const bed = T.height(x, z);
      const g = new THREE.CylinderGeometry(0.12, 0.14, p.deckY + 0.6 - bed + 0.5, 8);
      g.translate(x, (p.deckY + 0.6 + bed - 0.5) / 2, z);
      geos.push(g);
    }
    for (const side of [-1, 1]) box(p.x0 + ux * L / 2 + vx * 1.2 * side, p.deckY - 0.12, p.z0 + uz * L / 2 + vz * 1.2 * side, 0.15, 0.2, L, rot);
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.pierEnd = new V3(p.x1, p.deckY, p.z1);
    this.pierDir = new V3(ux, 0, uz);
  }

  buildStrip() {
    const s = this.world.strip; if (!s) return;
    const ux = Math.sin(s.angle), uz = Math.cos(s.angle), vx = uz, vz = -ux;
    // abri en tôle au bout de la piste
    const cx = s.x - ux * (s.length / 2 - 40) + vx * 28, cz = s.z - uz * (s.length / 2 - 40) + vz * 28;
    const y = this.T.height(cx, cz);
    const g = [];
    const rot = Math.atan2(ux, uz);
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const c = new THREE.CylinderGeometry(0.12, 0.12, 5, 8);
      c.translate(cx + vx * 7 * a + ux * 9 * b, y + 2.5, cz + vz * 7 * a + uz * 9 * b);
      g.push(c);
      this.colliders.push({ x: cx + vx * 7 * a + ux * 9 * b, z: cz + vz * 7 * a + uz * 9 * b, r: 0.3 });
    }
    const roof = new THREE.BoxGeometry(16, 0.08, 21, 24, 1, 1);
    const rp = roof.attributes.position;
    for (let i = 0; i < rp.count; i++) rp.setY(i, rp.getY(i) + Math.sin(rp.getX(i) * 6) * 0.04 + rp.getX(i) * 0.06);
    roof.computeVertexNormals();
    roof.rotateY(rot);
    roof.translate(cx, y + 5.1, cz);
    g.push(roof);
    const metal = stdMat({ color: 0x9a9a94, roughness: 0.55, metalness: 0.65 }, 'metal');
    const shed = new THREE.Mesh(mergeGeometries(g), metal);
    shed.castShadow = shed.receiveShadow = true;
    this.scene.add(shed);
    // manche à air
    const wx = s.x + ux * 60 + vx * 26, wz = s.z + uz * 60 + vz * 26, wy = this.T.height(wx, wz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 6, 6), metal);
    pole.position.set(wx, wy + 3, wz);
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.18, 2.2, 12, 4, true), stdMat({ color: 0xff6a1a, roughness: 0.8, side: THREE.DoubleSide }, 'sock'));
    sock.rotation.z = Math.PI / 2;
    const sockG = new THREE.Group(); sockG.add(sock); sock.position.x = 1.1;
    sockG.position.set(wx, wy + 5.8, wz);
    this.scene.add(pole, sockG);
    this.sock = sockG;
    this.stripShelter = new V3(cx, y, cz);
  }

  buildPlanes() {
    const s = this.world.strip;
    const glbPlane = this.bank && this.bank.has('plane') ? this.bank.instance('plane') : null;
    const bush = glbPlane || makePlane(false);
    if (s) {
      const ux = Math.sin(s.angle), uz = Math.cos(s.angle);
      const x = s.x - ux * (s.length / 2 - 25), z = s.z - uz * (s.length / 2 - 25);
      bush.position.set(x, this.T.height(x, z), z);
      const hd = s.angle + 0.35;
      bush.rotation.y = hd + (glbPlane ? Math.PI : 0); // le modèle du joueur a le nez vers -z
      const fx = Math.sin(hd), fz = Math.cos(hd);
      this.colliders.push({ x, z, r: 2.2 }, { x: x - fx * 3.2, z: z - fz * 3.2, r: 1.2 });
      if (glbPlane) for (const w of [-3.9, -2.6, 2.6, 3.9]) this.colliders.push({ x: x + fz * w + fx * 0.6, z: z - fx * w + fz * 0.6, r: 0.55 });
      this.scene.add(bush);
    }
    this.planes = [bush];
    if (!glbPlane) {
      const sea = makePlane(true);
      const e = this.pierEnd, d = this.pierDir;
      sea.position.set(e.x - d.x * 9 + d.z * 4.6, 0, e.z - d.z * 9 - d.x * 4.6);
      sea.rotation.y = Math.atan2(d.x, d.z) + Math.PI;
      this.scene.add(sea);
      this.seaplane = sea;
      this.planes.push(sea);
    }
    // matériaux du modèle : ombres, lumière du monde et perspective aérienne
    if (glbPlane) glbPlane.traverse((o) => { if (o.isMesh) o.material = patchMaterial(o.material, { key: 'plane' + o.material.type }); });
  }

  update(camera, dt) {
    const t = performance.now() / 1000;
    if (this.seaplane) {
      this.seaplane.position.y = -0.12 + Math.sin(t * 0.8) * 0.06;
      this.seaplane.rotation.z = Math.sin(t * 0.6) * 0.02;
      this.seaplane.rotation.x = Math.sin(t * 0.7 + 1) * 0.012;
    }
    if (this.sock) this.sock.rotation.y = Math.atan2(-0.6, 0.8) + Math.sin(t * 0.9) * 0.15;
    const cam = camera.position;
    if (cam.distanceToSquared(this.lastCam) < 16 && !this.dirty) return;
    this.dirty = false;
    this.lastCam.copy(cam);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new V3(), p = new V3();
    for (const [name, list] of Object.entries(this.lists)) {
      const im = this.inst[name], R = im.userData.R;
      let n = 0, shc = 0;
      const near = [];
      for (const it of list) {
        if (it.dead) continue;
        const dx = it.x - cam.x, dz = it.z - cam.z, d2 = dx * dx + dz * dz;
        if (d2 <= R * R) near.push([d2, it]);
      }
      near.sort((a, b) => a[0] - b[0]);
      for (const [d2, it] of near) {
        if (d2 < 60 * 60) shc = n + 1;
        e.set(it.tilt, it.rot, it.tilt * 0.5);
        q.setFromEuler(e);
        sc.setScalar(it.s);
        m4.compose(p.set(it.x, it.y, it.z), q, sc);
        im.setMatrixAt(n, m4);
        im.instanceColor.setXYZ(n, it.tint, it.tint, it.tint * 0.97);
        n++;
      }
      im.count = n;
      im.userData.sc = shc;
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
    }
    void dt;
  }
}

// ---------- avion de brousse / hydravion (modèle procédural original) ----------
function loft(stations, segs, colorFn) {
  // stations : [z, largeur, hauteur, yCentre] ; section en super-ellipse
  const b = new GeoBuilder();
  const rows = [];
  for (const [z, w, h, yc] of stations) {
    const row = [];
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const se = (v) => Math.sign(v) * Math.pow(Math.abs(v), 0.6);
      const x = se(c) * w / 2, y = yc + se(s) * h / 2;
      const col = colorFn ? colorFn(y, z, yc, h) : 1;
      row.push(b.v(x, y, z, c, s, 0, k / segs, 0, col));
    }
    rows.push(row);
  }
  for (let r = 0; r < rows.length - 1; r++) for (let k = 0; k < segs; k++) b.quad(rows[r][k], rows[r + 1][k], rows[r + 1][k + 1], rows[r][k + 1]);
  // bouchons
  for (const [ri, dirn] of [[0, 1], [rows.length - 1, -1]]) {
    const st = stations[ri];
    const c = b.v(0, st[3], st[0], 0, 0, dirn, 0.5, 0.5, 1);
    for (let k = 0; k < segs; k++) dirn > 0 ? b.tri(rows[ri][k + 1], rows[ri][k], c) : b.tri(rows[ri][k], rows[ri][k + 1], c);
  }
  const g = b.build();
  g.deleteAttribute('aWind');
  g.computeVertexNormals();
  return g;
}
function wingGeo(span, chord, thick, sweep = 0, dihedral = 0, vertical = false) {
  // profil d'aile (approximation NACA)
  const prof = [];
  for (let i = 0; i <= 12; i++) { const x = 1 - i / 12; prof.push([x, 0.6 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4) / 0.12]); }
  for (let i = 1; i < 12; i++) { const x = i / 12; prof.push([x, -0.5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4) / 0.12]); }
  const pos = [], idx = [];
  const n = prof.length, ST = 8;
  for (let s = 0; s <= ST; s++) {
    const t = s / ST - (vertical ? 0 : 0.5), sp = t * span;
    const ch = chord * (1 - Math.abs(t) * 0.15);
    for (const [x, y] of prof) {
      const zx = -x * ch + Math.abs(sp) * sweep;
      if (vertical) pos.push(0, sp + y * 0, zx + 0); else pos.push(sp, y * ch + Math.abs(sp) * dihedral, zx);
      if (vertical) { pos[pos.length - 3] = y * ch; }
    }
  }
  for (let s = 0; s < ST; s++) for (let i = 0; i < n; i++) {
    const a = s * n + i, b = s * n + (i + 1) % n, c = a + n, d = b + n;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function tireGeo(r, w) {
  const pts = [];
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI; pts.push(new THREE.Vector2(r * 0.55 + Math.sin(a) * r * 0.45, (0.5 - i / 16) * w)); }
  const g = new THREE.LatheGeometry(pts, 28);
  g.rotateZ(Math.PI / 2);
  return g;
}
export function makePlane(floats) {
  const G = new THREE.Group();
  const accent = floats ? new THREE.Color(0x1d4f8c) : new THREE.Color(0xb3261e);
  const body = floats ? new THREE.Color(0xf2c230) : new THREE.Color(0xf4f2ee);
  const colorFn = (y, z, yc, h) => {
    const band = Math.abs(y - (yc - h * 0.08)) < h * 0.07 && z < 1.2;
    return band ? 0 : 1;
  };
  const fus = loft([
    [2.25, 0.5, 0.5, 1.6], [2.05, 0.95, 0.95, 1.58], [1.2, 1.12, 1.18, 1.6], [0.2, 1.14, 1.36, 1.68], [-1.4, 1.1, 1.3, 1.66],
    [-2.6, 0.86, 1.0, 1.66], [-3.9, 0.46, 0.62, 1.76], [-5.0, 0.12, 0.32, 1.9],
  ], 20, colorFn);
  // couleur : 1 = carrosserie, 0 = bande décorative
  const col = fus.attributes.color;
  for (let i = 0; i < col.count; i++) {
    const t = col.getX(i);
    const c = body.clone().lerp(accent, 1 - t);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  const paint = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05 }), { key: 'paint' });
  const paintPlain = patchMaterial(new THREE.MeshStandardMaterial({ color: body, roughness: 0.35, metalness: 0.05 }), { key: 'paintP' });
  const paintAcc = patchMaterial(new THREE.MeshStandardMaterial({ color: accent, roughness: 0.35, metalness: 0.05 }), { key: 'paintA' });
  const glass = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x0c1418, roughness: 0.04, metalness: 0.2 }), { key: 'glass' });
  const metal = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.28, metalness: 0.9 }), { key: 'metalP' });
  const rubber = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }), { key: 'rubber' });
  const add = (g, m, cast = true) => { const mesh = new THREE.Mesh(g, m); mesh.castShadow = cast; mesh.receiveShadow = true; G.add(mesh); return mesh; };
  add(fus, paint);
  // vitres
  for (const sx of [-1, 1]) {
    const w = new THREE.BoxGeometry(0.02, 0.5, 1.5); w.translate(sx * 0.575, 1.95, -0.25); add(w, glass, false);
    const w2 = new THREE.BoxGeometry(0.02, 0.4, 0.7); w2.translate(sx * 0.55, 1.95, -1.4); add(w2, glass, false);
  }
  const ws = new THREE.BoxGeometry(0.98, 0.04, 0.7); ws.rotateX(-0.95); ws.translate(0, 2.12, 0.78); add(ws, glass, false);
  // aile haute, haubans
  const wing = wingGeo(11.4, 1.65, 0.2, 0, 0.03); wing.translate(0, 2.42, 0.55); add(wing, paintPlain);
  for (const sx of [-1, 1]) {
    const tip = wingGeo(0.7, 1.4, 0.2, 0, 0); tip.translate(sx * 5.55, 2.42 + 0.17, 0.48); add(tip, paintAcc);
    const strut = new THREE.CylinderGeometry(0.035, 0.035, 3.3, 6);
    strut.rotateZ(sx * -0.95); strut.translate(sx * 1.85, 1.75, 0.05); add(strut, metal);
  }
  // empennage
  const hs = wingGeo(3.6, 0.85, 0.12); hs.translate(0, 1.92, -4.55); add(hs, paintPlain);
  const vs = wingGeo(1.45, 1.05, 0.12, 0.45, 0, true); vs.translate(0, 1.95, -4.35); add(vs, paintAcc);
  // capot moteur, cône d'hélice, hélice
  const spinner = new THREE.ConeGeometry(0.2, 0.42, 16); spinner.rotateX(Math.PI / 2); spinner.translate(0, 1.6, 2.45); add(spinner, metal);
  const prop = new THREE.Group();
  for (const sgn of [-1, 1]) {
    const blade = new THREE.BoxGeometry(0.11, 0.95, 0.025); blade.translate(0, sgn * 0.5, 0); blade.rotateY(0.3 * sgn);
    const bm = new THREE.Mesh(blade, patchMaterial(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }), { key: 'blade' }));
    bm.castShadow = true;
    prop.add(bm);
  }
  prop.position.set(0, 1.6, 2.3); prop.rotation.z = 0.7;
  G.add(prop);
  if (!floats) {
    for (const sx of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.04, 0.05, 1.35, 6); leg.rotateZ(sx * 0.62); leg.translate(sx * 0.62, 0.95, 0.9); add(leg, metal);
      const tire = tireGeo(0.42, 0.32); tire.translate(sx * 1.05, 0.42, 0.9); add(tire, rubber);
    }
    const tw = tireGeo(0.13, 0.08); tw.translate(0, 0.13, -4.9); add(tw, rubber);
    const tl = new THREE.CylinderGeometry(0.02, 0.02, 1.6, 6); tl.translate(0, 0.9, -4.9); add(tl, metal);
  } else {
    for (const sx of [-1, 1]) {
      const fl = loft([[3.2, 0.12, 0.12, 0.25], [2.6, 0.55, 0.5, 0.3], [0.5, 0.62, 0.58, 0.28], [-1.8, 0.55, 0.5, 0.3], [-3.3, 0.18, 0.2, 0.42]], 14);
      const c = fl.attributes.color; for (let i = 0; i < c.count; i++) c.setXYZ(i, 0.92, 0.92, 0.9);
      fl.translate(sx * 1.35, 0, 0);
      add(fl, paint);
      for (const z of [1.2, -1.0]) { const st = new THREE.CylinderGeometry(0.035, 0.035, 1.25, 6); st.rotateZ(sx * 0.55); st.translate(sx * 1.0, 1.0, z); add(st, metal); }
    }
  }
  G.userData.prop = prop;
  return G;
}

export { lerp, clamp, vnoise };
