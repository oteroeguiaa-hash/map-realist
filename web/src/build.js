// Construction en rondins avec le bois récolté : murs, planchers et rampes (pour sauter en buggy).
// Les pièces s'alignent sur une grille, se posent sur le relief, bloquent le passage (murs) ou portent
// le joueur et le buggy (planchers, rampes). Elles sont mémorisées et retrouvées au retour.
import * as THREE from 'three';
import { patchMaterial, mergeGeometries } from './core.js';

const V3 = THREE.Vector3;
// coût : bois (arbres abattus) et pierre (rochers cassés à la rivelaine ou à la hache)
export const PIECES = {
  mur: { label: 'Mur en rondins', cost: { wood: 6 }, w: 3, d: 0.5 },
  muret: { label: 'Muret en pierre', cost: { stone: 10 }, w: 3, d: 0.8 },
  plancher: { label: 'Plancher', cost: { wood: 8 }, w: 3, d: 3 },
  rampe: { label: 'Rampe à buggy', cost: { wood: 10 }, w: 3.4, d: 6 },
  projecteur: { label: 'Projecteur 20 000 lm', cost: { wood: 4, stone: 6 }, w: 1.2, d: 1.2, unique: true },
};
const ORDER = ['mur', 'muret', 'plancher', 'rampe', 'projecteur'];
export const costText = (c) => [c.wood ? `${c.wood} bois` : '', c.stone ? `${c.stone} pierres` : ''].filter(Boolean).join(' + ');
export const canPay = (c, res) => (res.wood || 0) >= (c.wood || 0) && (res.stone || 0) >= (c.stone || 0);

function logGeo(len, r, axis, x, y, z, rot = 0) {
  const g = new THREE.CylinderGeometry(r * (0.94 + Math.random() * 0.08), r, len, 10, 1);
  // écorce : la texture fait le tour du rondin et se répète sur la longueur
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len / 1.6);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  if (rot) g.rotateY(rot);
  g.translate(x, y, z);
  return g;
}

export class Builder {
  constructor(scene, T, props) {
    this.scene = scene; this.T = T; this.props = props;
    this.pieces = [];
    this.kind = 'mur';
    this.active = false;
    this.ghost = null;
  }
  async init(bank) {
    // écorce du tronc mort Poly Haven (dead_tree_trunk_02) pour les rondins
    let map = null, nmap = null;
    const g = bank && bank.gltf.trunk2;
    if (g) g.scene.traverse((o) => { if (o.isMesh && !map) { map = o.material.map; nmap = o.material.normalMap; } });
    for (const t of [map, nmap]) if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; }
    // pierre : texture du rocher namaqualand
    const rk = bank && bank.gltf.nboulder2;
    let smap = null, snmap = null;
    if (rk) rk.scene.traverse((o) => { if (o.isMesh && !smap) { smap = o.material.map; snmap = o.material.normalMap; } });
    this.stoneMat = patchMaterial(new THREE.MeshStandardMaterial({ map: smap, normalMap: snmap, roughness: 0.95, color: smap ? 0xffffff : 0x8a8478 }), { key: 'buildStone' });
    this.mat = patchMaterial(new THREE.MeshStandardMaterial({ map, normalMap: nmap, roughness: 0.9, color: map ? 0xffffff : 0x7a5a3a }), { key: 'build' });
    this.ghostOk = new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghostNo = new THREE.MeshBasicMaterial({ color: 0xff6a4a, transparent: true, opacity: 0.35, depthWrite: false });
  }

  // forme d'une pièce posée en (x, z), orientée selon rot (multiple de 90°)
  shape(kind, x, z, rot) {
    const T = this.T, P = PIECES[kind], c = Math.cos(rot), s = Math.sin(rot);
    const corner = (u, v) => [x + u * c + v * s, z - u * s + v * c];
    const hs = [];
    for (const [u, v] of [[-P.w / 2, -P.d / 2], [P.w / 2, -P.d / 2], [-P.w / 2, P.d / 2], [P.w / 2, P.d / 2], [0, 0]]) { const [a, b] = corner(u, v); hs.push(T.height(a, b)); }
    const lo = Math.min(...hs), hi = Math.max(...hs);
    return { kind, x, z, rot, c, s, lo, hi, top: kind === 'plancher' ? hi + 0.45 : kind === 'rampe' ? hs[0] + 0 : lo };
  }

  geometry(sh) {
    const P = PIECES[sh.kind], geos = [];
    const R = 0.17;
    if (sh.kind === 'muret') {
      // pierres sèches empilées : deux rangées irrégulières
      let seed = Math.abs(Math.round(sh.x * 13 + sh.z * 7)) + 1;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let row = 0; row < 3; row++) for (let k = 0; k < 8; k++) {
        const g = new THREE.IcosahedronGeometry(0.24, 1);
        g.scale(1.1 + rnd() * 0.5, 0.75 + rnd() * 0.3, 0.9 + rnd() * 0.4);
        g.rotateY(rnd() * 6.28);
        g.translate(-P.w / 2 + 0.2 + (k + (row % 2) * 0.5) * (P.w - 0.4) / 8, sh.lo + 0.15 + row * 0.32, (rnd() - 0.5) * 0.25);
        const uv = new Float32Array(g.attributes.position.count * 2);
        for (let i = 0; i < uv.length / 2; i++) { uv[i * 2] = g.attributes.position.getX(i) * 0.8; uv[i * 2 + 1] = g.attributes.position.getY(i) * 0.8; }
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geos.push(g);
      }
    } else if (sh.kind === 'projecteur') {
      geos.push(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 4)); // le projecteur lui-même est affiché par le campement
    } else if (sh.kind === 'mur') {
      for (let k = 0; k < 7; k++) geos.push(logGeo(P.w + 0.3, R, 'x', 0, sh.lo - 0.1 + R + k * R * 1.9, 0));
      for (const u of [-P.w / 2, P.w / 2]) geos.push(logGeo(2.9, R * 1.1, 'y', u, sh.lo + 1.2, 0));
    } else if (sh.kind === 'plancher') {
      const n = 9;
      for (let k = 0; k < n; k++) geos.push(logGeo(P.w + 0.2, R, 'x', 0, sh.top - R, -P.d / 2 + R + k * (P.d - 2 * R) / (n - 1)));
      for (const v of [-P.d / 2 + 0.3, P.d / 2 - 0.3]) geos.push(logGeo(P.w, R * 1.1, 'x', 0, sh.top - R * 3, v));
      for (const u of [-P.w / 2 + 0.3, P.w / 2 - 0.3]) for (const v of [-P.d / 2 + 0.3, P.d / 2 - 0.3]) {
        const gy = this.T.height(sh.x + u * sh.c + v * sh.s, sh.z - u * sh.s + v * sh.c);
        const L = sh.top - gy + 0.3;
        geos.push(logGeo(L, R, 'y', u, gy - 0.3 + L / 2, v));
      }
    } else {
      // rampe : planche inclinée de 0 à 1,5 m sur 6 m, posée sur des chevalets
      const H = 1.5, n = 16;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, v = -P.d / 2 + t * P.d;
        geos.push(logGeo(P.w, R, 'x', 0, this.rampY(sh, t) - R * 0.6, v));
      }
      for (const t of [0.5, 0.97]) for (const u of [-P.w / 2 + 0.25, P.w / 2 - 0.25]) {
        const v = -P.d / 2 + t * P.d, gy = this.T.height(sh.x + u * sh.c + v * sh.s, sh.z - u * sh.s + v * sh.c);
        const L = this.rampY(sh, t) - gy + 0.3;
        if (L > 0.3) geos.push(logGeo(L, R, 'y', u, gy - 0.3 + L / 2, v));
      }
      void H;
    }
    const g = mergeGeometries(geos.map((x) => x.toNonIndexed()));
    g.rotateY(sh.rot);
    g.translate(sh.x, 0, sh.z);
    g.computeBoundingSphere();
    return g;
  }
  rampY(sh, t) { return sh.lo + 0.02 + t * 1.5 + (sh.top - sh.lo) * 0; }

  // hauteur du sol construit en (x, z) — -Infinity si aucune pièce
  heightAt(x, z) {
    let best = -Infinity;
    for (const p of this.pieces) {
      if (p.kind === 'mur') continue;
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz > 25) continue;
      const u = dx * p.c - dz * p.s, v = dx * p.s + dz * p.c, P = PIECES[p.kind];
      if (Math.abs(u) > P.w / 2 || Math.abs(v) > P.d / 2) continue;
      const y = p.kind === 'plancher' ? p.top : this.rampY(p, (v + P.d / 2) / P.d);
      if (y > best) best = y;
    }
    return best;
  }

  colliders(sh) {
    const out = [];
    if (sh.kind === 'mur' || sh.kind === 'muret') for (const u of [-1.2, -0.4, 0.4, 1.2]) out.push({ x: sh.x + u * sh.c, z: sh.z - u * sh.s, r: 0.42, top: sh.lo + (sh.kind === 'mur' ? 2.5 : 0.95), build: true });
    return out;
  }

  place(kind, x, z, rot, free = false) {
    const sh = this.shape(kind, x, z, rot);
    const mesh = new THREE.Mesh(this.geometry(sh), kind === 'muret' ? this.stoneMat || this.mat : this.mat);
    if (kind === 'projecteur') { mesh.visible = false; this.onSearchlight && this.onSearchlight(x, z, rot); }
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    sh.mesh = mesh;
    sh.cols = this.colliders(sh);
    this.props.colliders.push(...sh.cols);
    this.pieces.push(sh);
    void free;
    return sh;
  }

  // aperçu de la pièce devant le joueur
  preview(player, res) {
    if (!this.active) { if (this.ghost) this.ghost.visible = false; return null; }
    const P = PIECES[this.kind];
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const dist = this.kind === 'mur' ? 2.6 : this.kind === 'plancher' ? 3.2 : 5;
    const x = Math.round((player.pos.x + fx * dist) * 2) / 2, z = Math.round((player.pos.z + fz * dist) * 2) / 2;
    const rot = Math.round((player.yaw + Math.PI) / (Math.PI / 2)) * (Math.PI / 2);
    const key = `${this.kind}|${x}|${z}|${rot}`;
    if (key !== this.ghostKey) {
      this.ghostKey = key;
      if (this.ghost) { this.scene.remove(this.ghost); this.ghost.geometry.dispose(); }
      const sh = this.shape(this.kind, x, z, rot);
      this.ghost = new THREE.Mesh(this.geometry(sh), this.ghostOk);
      this.ghost.renderOrder = 5;
      this.scene.add(this.ghost);
      this.ghostShape = { kind: this.kind, x, z, rot };
    }
    const taken = P.unique && this.pieces.some((p) => p.kind === this.kind);
    const ok = !taken && canPay(P.cost, res) && this.T.height(x, z) > 0.2;
    this.ghost.material = ok ? this.ghostOk : this.ghostNo;
    this.ghost.visible = true;
    return { ok, taken, label: `Poser : ${P.label} (${costText(P.cost)})` };
  }
  confirm() { const g = this.ghostShape; if (!g) return null; this.ghostKey = null; return this.place(g.kind, g.x, g.z, g.rot); }
  cycle() { this.kind = ORDER[(ORDER.indexOf(this.kind) + 1) % ORDER.length]; this.ghostKey = null; return PIECES[this.kind].label; }
  undo() {
    const p = this.pieces.pop();
    if (!p) return null;
    this.scene.remove(p.mesh);
    for (const c of p.cols) { const k = this.props.colliders.indexOf(c); if (k >= 0) this.props.colliders.splice(k, 1); }
    return p;
  }

  save() { return this.pieces.map((p) => [p.kind, p.x, p.z, +p.rot.toFixed(4)]); }
  load(list) { for (const [k, x, z, r] of list || []) if (PIECES[k]) this.place(k, x, z, r, true); }
}
