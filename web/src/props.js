// Rochers scannés, coquillages, bois flotté, ponton, abri, manche à air, avion de brousse et hydravion.
import * as THREE from 'three';
import { patchMaterial, loadTex, fetchBuf, mulberry32, clamp, lerp, vnoise, GeoBuilder, mergeGeometries } from './core.js';
import { floatGeo } from './flora.js';

const V3 = THREE.Vector3;

async function loadModel(base, name, aniso) {
  const [buf, a, n] = await Promise.all([
    fetchBuf(`${base}/mdl/${name}.data.json`), loadTex(`${base}/mdl/${name}_a.jpg`, { aniso }), loadTex(`${base}/mdl/${name}_n.jpg`, { srgb: false, aniso }),
  ]);
  const h = new Uint32Array(buf, 0, 2), nv = h[0], ni = h[1];
  let o = 8;
  const bb = new Float32Array(buf, o, 6); o += 24;
  const P = new Float32Array(buf, o, nv * 3); o += nv * 12;
  const N = new Float32Array(buf, o, nv * 3); o += nv * 12;
  const UV = new Float32Array(buf, o, nv * 2); o += nv * 8;
  const I = nv > 65535 ? new Uint32Array(buf, o, ni) : new Uint16Array(buf, o, ni);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  g.computeBoundingSphere();
  a.flipY = false; n.flipY = false; a.needsUpdate = n.needsUpdate = true;
  return { geo: g, map: a, nmap: n, size: [bb[3] - bb[0], bb[4], bb[5] - bb[2]] };
}

function stdMat(params, key) { return patchMaterial(new THREE.MeshStandardMaterial(params), { key }); }

export class Props {
  constructor(scene, terrain, world, atlas, bank) {
    this.scene = scene; this.T = terrain; this.world = world; this.atlas = atlas; this.bank = bank;
    this.colliders = [];
    this.groups = [];
    this.lastCam = new V3(1e9, 0, 0);
  }
  async init(base) {
    const aniso = 4;
    const names = ['rock_a', 'rock_b', 'rock_c', 'cliff', 'shell', 'log'];
    const models = await Promise.all(names.map((n) => loadModel(base, n, aniso)));
    this.models = {};
    names.forEach((n, i) => { this.models[n] = models[i]; });
    if (this.bank && this.bank.gltf.rocks) this.useGlbRocks(this.bank.gltf.rocks);
    this.placeScatter();
    this.buildPier();
    this.buildStrip();
    this.buildPlanes();
  }

  // Rochers calcaires du joueur : chaque rocher devient un modèle instancié (le socle de terrain est écarté)
  useGlbRocks(gltf) {
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const pieces = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = floatGeo(o.geometry);
      g.applyMatrix4(o.matrixWorld);
      g.computeBoundingBox();
      const b = g.boundingBox, sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
      if (sy < 0.14 * Math.max(sx, sz)) return; // socle plat
      pieces.push({ g, mat: o.material, vol: sx * sy * sz });
    });
    if (!pieces.length) return;
    pieces.sort((a, b) => b.vol - a.vol);
    const assign = { cliff: 0, rock_a: Math.min(1, pieces.length - 1), rock_b: Math.min(2, pieces.length - 1), rock_c: Math.min(3, pieces.length - 1) };
    for (const [name, k] of Object.entries(assign)) {
      const ref = this.models[name].size, pc = pieces[k];
      const g = pc.g.clone();
      g.computeBoundingBox();
      const b = g.boundingBox, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      const sc = Math.max(ref[0], ref[2]) / Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
      g.translate(-cx, -b.min.y, -cz); g.scale(sc, sc, sc);
      g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
      const bb = g.boundingBox;
      this.models[name] = { geo: g, map: pc.mat.map, nmap: pc.mat.normalMap, size: [bb.max.x - bb.min.x, bb.max.y, bb.max.z - bb.min.z], glb: true };
    }
  }

  placeScatter() {
    const T = this.T, W = T.W, rnd = mulberry32(777), w = this.world;
    const lists = { rock_a: [], rock_b: [], rock_c: [], cliff: [], shell: [], log: [] };
    const nrm = new V3();
    const add = (m, x, z, s, rot, tint, sink = 0.15, tilt = 0) => {
      // rochers : entre 2 et 5 m, jamais de blocs géants étirés
      if (m.startsWith('rock')) { const d = Math.max(...this.models[m].size); s = clamp(s, 2 / d, 5 / d); }
      const y = T.height(x, z) - sink * this.models[m].size[1] * s;
      lists[m].push({ x, y, z, s, rot, tint, tilt });
      if (this.models[m].size[0] * s > 1.4 && m !== 'log') this.colliders.push({ x, z, r: Math.min(this.models[m].size[0], this.models[m].size[2]) * s * 0.45 });
    };
    // rochers côtiers et de jungle
    for (let i = 0; i < 26000; i++) {
      const x = (rnd() - 0.5) * W * 0.85, z = (rnd() - 0.5) * W * 0.85;
      const h = T.height(x, z);
      if (h < -1.2 || h > 330) continue;
      T.normal(x, z, nrm, 2);
      const slope = 1 - nrm.y, path = T.mask(T.path, x, z);
      if (path > 0.2 || T.mask(T.clear, x, z) > 0.3) continue;
      if (Math.hypot(x - w.spawn.x, z - w.spawn.z) < 25) continue;
      const u = rnd();
      if (h < 5 && slope > 0.18 && u < 0.5) add(rnd() < 0.6 ? 'rock_c' : 'rock_a', x, z, 8 + rnd() * 22, rnd() * 6.28, 0.42 + rnd() * 0.15, 0.25);
      else if (h < 2.5 && u < 0.012) add('rock_a', x, z, 5 + rnd() * 9, rnd() * 6.28, 0.55, 0.3);
      else if (h > 12 && h < 210 && u < 0.03) add(rnd() < 0.5 ? 'rock_a' : 'rock_b', x, z, (rnd() < 0.5 ? 8 : 18) + rnd() * 22, rnd() * 6.28, 0.7 + rnd() * 0.2, 0.35);
      else if (h >= 200 && u < 0.07) add('rock_c', x, z, 6 + rnd() * 18, rnd() * 6.28, 0.38, 0.3);
    }
    // falaise et rochers autour de la cascade
    const lip = w.waterfall.lip, dir = w.waterfall.dir, pool = w.waterfall.pool, perp = [-dir[1], dir[0]];
    void lip; void perp;
    for (let k = 0; k < 22; k++) {
      const a = rnd() * Math.PI * 2, r = w.waterfall.poolR + 2 + rnd() * 9;
      add(rnd() < 0.5 ? 'rock_a' : 'rock_b', pool[0] + Math.cos(a) * r, pool[2] + Math.sin(a) * r, 10 + rnd() * 18, rnd() * 6.28, 0.6, 0.4);
    }
    // coquillages et bois flotté sur les plages
    for (let i = 0; i < 9000 && lists.shell.length < 160; i++) {
      const near = i < 3000;
      const x = near ? w.spawn.x + (rnd() - 0.5) * 220 : (rnd() - 0.5) * W * 0.8, z = near ? w.spawn.z + (rnd() - 0.5) * 80 : (rnd() - 0.5) * W * 0.8;
      const h = T.height(x, z);
      if (h < 0.4 || h > 1.9) continue;
      lists.shell.push({ x, y: h - 0.01, z, s: 0.9 + rnd() * 0.8, rot: rnd() * 6.28, tint: 1, tilt: (rnd() - 0.5) * 0.6 });
    }
    for (let i = 0; i < 30000 && lists.log.length < 70; i++) {
      const x = (rnd() - 0.5) * W * 0.8, z = (rnd() - 0.5) * W * 0.8;
      const h = T.height(x, z);
      const beach = h > 0.6 && h < 2.2 && rnd() < 0.5, jungle = h > 15 && h < 150 && rnd() < 0.02;
      if (!beach && !jungle) continue;
      if (T.mask(T.path, x, z) > 0.2) continue;
      lists.log.push({ x, y: h - 0.08, z, s: 1.2 + rnd() * 1.4, rot: rnd() * 6.28, tint: beach ? 1.35 : 0.7, tilt: 0 });
    }
    this.lists = lists;
    this.inst = {};
    for (const m of Object.keys(lists)) {
      const md = this.models[m];
      const mat = stdMat({ map: md.map, normalMap: md.nmap || null, roughness: m === 'shell' ? 0.45 : 0.92, metalness: 0 }, 'rock_' + m);
      const im = new THREE.InstancedMesh(md.geo, mat, Math.max(1, lists[m].length));
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, lists[m].length) * 3), 3);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = m !== 'shell'; im.receiveShadow = true;
      im.frustumCulled = false;
      im.count = 0;
      this.scene.add(im);
      this.inst[m] = im;
    }
  }

  buildPier() {
    const p = this.world.pier, T = this.T;
    const dx = p.x1 - p.x0, dz = p.z1 - p.z0, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, vx = -uz, vz = ux;
    const wood = this.models.log;
    const mat = stdMat({ map: wood.map, normalMap: wood.nmap, roughness: 0.85, color: 0xd8cfc0 }, 'pier');
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
    if (cam.distanceToSquared(this.lastCam) < 16) return;
    this.lastCam.copy(cam);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new V3(), p = new V3();
    for (const [name, list] of Object.entries(this.lists)) {
      const im = this.inst[name], R = name === 'shell' ? 50 : name === 'cliff' ? 3000 : 260;
      let n = 0;
      for (const it of list) {
        const dx = it.x - cam.x, dz = it.z - cam.z;
        if (dx * dx + dz * dz > R * R) continue;
        e.set(it.tilt, it.rot, it.tilt * 0.5);
        q.setFromEuler(e);
        sc.setScalar(it.s);
        m4.compose(p.set(it.x, it.y, it.z), q, sc);
        im.setMatrixAt(n, m4);
        im.instanceColor.setXYZ(n, it.tint, it.tint * (name === 'rock_a' || name === 'rock_b' ? 1.04 : 1), it.tint * 0.96);
        n++;
      }
      im.count = n;
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
