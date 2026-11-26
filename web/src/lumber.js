// Abattage : 3 coups pour un petit arbre, 8 pour un grand. L'arbre se fend, bascule autour de sa charnière
// sous l'effet de la gravité (pendule inversé), rebondit, puis reste couché au sol. La souche reste aussi.
// Tout est mémorisé (arbres abattus, bois récolté) et retrouvé au retour.
import * as THREE from 'three';
import { clamp } from './core.js';

const V3 = THREE.Vector3;
const NOFADE = { value: new THREE.Vector2(0, 0) };
const UP = new V3(0, 1, 0);

// Sépare un maillage en deux à la hauteur de coupe (triangles affectés selon leur centre)
function splitGeo(geo, hc) {
  const idx = geo.index ? geo.index.array : null, pos = geo.attributes.position;
  const T = idx ? idx.length / 3 : pos.count / 3, vi = (t, c) => (idx ? idx[t * 3 + c] : t * 3 + c);
  const lo = [], hi = [];
  for (let t = 0; t < T; t++) {
    const y = (pos.getY(vi(t, 0)) + pos.getY(vi(t, 1)) + pos.getY(vi(t, 2))) / 3;
    (y < hc ? lo : hi).push(t);
  }
  const build = (tris) => {
    if (!tris.length) return null;
    const g = new THREE.BufferGeometry();
    for (const name in geo.attributes) {
      const a = geo.attributes[name];
      if (a.isInstancedBufferAttribute || name === 'aLean') continue;
      const k = a.itemSize, arr = new Float32Array(tris.length * 3 * k);
      let o = 0;
      for (const t of tris) for (let c = 0; c < 3; c++) { const v = vi(t, c); for (let j = 0; j < k; j++) arr[o++] = a.getComponent(v, j); }
      g.setAttribute(name, new THREE.BufferAttribute(arr, k));
    }
    // plus de vent sur un arbre coupé
    if (g.attributes.aWind) g.attributes.aWind.array.fill(0);
    g.setAttribute('aLean', new THREE.BufferAttribute(new Float32Array(tris.length * 3), 1));
    g.computeBoundingSphere();
    return g;
  };
  return { lo: build(lo), hi: build(hi) };
}

export class Lumber {
  constructor(scene, flora, T, props) {
    this.scene = scene; this.flora = flora; this.T = T; this.props = props;
    this.hits = new Map();
    this.falling = [];
    this.fallen = [];
    this.split = new Map();
    this.mats = new Map();
    this.wood = 0;
    this.onImpact = null; this.onFell = null; this.onChange = null;
  }

  material(m) {
    let o = this.mats.get(m);
    if (!o) {
      o = m.clone();
      const prev = m.onBeforeCompile;
      o.onBeforeCompile = (sh, r) => { prev.call(m, sh, r); sh.uniforms.uFade = NOFADE; };
      o.customProgramCacheKey = m.customProgramCacheKey;
      this.mats.set(m, o);
    }
    return o;
  }
  typeInfo(t) {
    let s = this.split.get(t);
    if (!s) {
      const ty = this.flora.types[t];
      const giant = ty.name === 'grand arbre';
      const hc = giant ? 2.0 : Math.min(0.5, ty.h * 0.08);
      const parts = ty.parts.map((p) => ({ ...splitGeo(p.geo, hc), mat: this.material(p.mat) }));
      s = { hc, parts, ty };
      this.split.set(t, s);
    }
    return s;
  }
  // nombre de coups nécessaires selon la taille réelle de l'arbre
  hitsNeeded(i) {
    const I = this.flora.I, ty = this.flora.types[I.t[i]];
    return ty.h * I.s[i] >= 9 ? 8 : 3;
  }

  // un coup de hache : renvoie le nombre de coups restants (0 = l'arbre tombe)
  hit(i, from) {
    const n = (this.hits.get(i) || 0) + 1;
    const need = this.hitsNeeded(i);
    if (n < need) { this.hits.set(i, n); return need - n; }
    this.hits.delete(i);
    const I = this.flora.I;
    const d = new V3(I.x[i] - from.x, 0, I.z[i] - from.z);
    if (d.lengthSq() < 1e-4) d.set(1, 0, 0);
    d.normalize();
    // un peu de hasard dans la direction de chute
    d.applyAxisAngle(UP, (Math.random() - 0.5) * 0.5);
    this.fell(i, d.x, d.z, null);
    return 0;
  }

  fell(i, dx, dz, restTheta) {
    const F = this.flora, I = F.I, info = this.typeInfo(I.t[i]);
    F.dead[i] = 1;
    F.refresh();
    const s = I.s[i], lean = I.l[i];
    const base = new V3(I.x[i], I.y[i], I.z[i]);
    const make = (geoKey) => {
      const grp = new THREE.Group();
      for (const p of info.parts) {
        const g0 = p[geoKey];
        if (!g0) continue;
        const g = g0.clone();
        g.attributes.aLean.array.fill(lean);
        const m = new THREE.Mesh(g, p.mat);
        m.castShadow = true; m.receiveShadow = true;
        grp.add(m);
      }
      grp.rotation.y = I.r[i];
      grp.scale.setScalar(s);
      return grp;
    };
    // souche : reste en place
    const stump = make('lo');
    stump.position.copy(base);
    this.scene.add(stump);
    // fût + couronne : pivote autour de la charnière de coupe
    const pivot = new THREE.Group();
    pivot.position.copy(base).add(new V3(0, info.hc * s, 0));
    const log = make('hi');
    log.position.set(0, -info.hc * s, 0);
    pivot.add(log);
    this.scene.add(pivot);
    const dir = new V3(dx, 0, dz).normalize();
    const L = Math.max((info.ty.h - info.hc) * s, 1);
    const rec = {
      i, x: I.x[i], z: I.z[i], dir, axis: new V3().crossVectors(UP, dir).normalize().negate(), pivot, stump, L, s,
      r: (info.ty.trunkR || 0.25) * s, crown: (info.ty.crownR || 2) * s, theta: restTheta ?? 0.03, w: restTheta == null ? 0.12 : 0, bounces: 0,
      wood: this.hitsNeeded(i) === 8 ? 8 : 3,
    };
    this.pose(rec);
    if (restTheta == null) { this.falling.push(rec); this.onFell && this.onFell(rec); }
    else this.settle(rec, false);
    this.fallen.push(rec);
    return rec;
  }

  pose(rec) {
    rec.pivot.quaternion.setFromAxisAngle(rec.axis, -rec.theta);
  }
  // hauteur d'un point du tronc couché (distance u depuis la charnière)
  pointAt(rec, u, out) {
    const st = Math.sin(rec.theta), ct = Math.cos(rec.theta);
    return out.copy(rec.pivot.position).addScaledVector(rec.dir, u * st).addScaledVector(UP, u * ct);
  }
  // l'arbre touche-t-il le sol ? (tronc et couronne)
  contact(rec) {
    const p = this._p || (this._p = new V3());
    let pen = -1e9;
    for (let k = 1; k <= 8; k++) {
      const u = rec.L * k / 8;
      this.pointAt(rec, u, p);
      const rad = k >= 7 ? rec.crown * 0.3 : rec.r;
      pen = Math.max(pen, this.T.height(p.x, p.z) + rad - p.y);
    }
    return pen;
  }

  update(dt) {
    if (!this.falling.length) return;
    const steps = Math.ceil(dt / 0.004), h = dt / steps;
    for (let k = this.falling.length - 1; k >= 0; k--) {
      const rec = this.falling[k];
      for (let s = 0; s < steps && !rec.done; s++) {
        // pendule inversé : moment de la gravité sur le centre de masse (à 55 % de la hauteur)
        const acc = 1.65 * 9.81 * Math.sin(rec.theta) / rec.L;
        rec.w += acc * h;
        rec.w *= 1 - 0.05 * h;
        rec.theta += rec.w * h;
        if (rec.theta > 1.9) { rec.theta = 1.9; rec.w = 0; }
        const pen = this.contact(rec);
        if (pen > 0 && rec.theta > 0.25) {
          // choc : on remonte jusqu'au contact, petit rebond puis repos
          while (this.contact(rec) > 0 && rec.theta > 0.25) rec.theta -= 0.004;
          const speed = rec.w * rec.L;
          this.onImpact && this.onImpact(rec, speed, rec.bounces === 0);
          if (rec.w > 0.35 && rec.bounces < 2) { rec.w = -rec.w * 0.16; rec.bounces++; }
          else { rec.done = true; }
        }
      }
      this.pose(rec);
      if (rec.done) { this.falling.splice(k, 1); this.settle(rec, true); }
    }
  }

  // au repos : le tronc couché devient un obstacle, le bois est compté, la sauvegarde est mise à jour
  settle(rec, fresh) {
    rec.done = true;
    this.pose(rec);
    const p = new V3();
    for (let k = 1; k <= 6; k++) {
      this.pointAt(rec, rec.L * k / 7, p);
      if (p.y - this.T.height(p.x, p.z) < 2.5) this.props.colliders.push({ x: p.x, z: p.z, r: Math.max(rec.r, 0.25), top: p.y + rec.r, log: true });
    }
    if (fresh) { this.wood += rec.wood; this.onChange && this.onChange(); }
  }

  save() {
    return { wood: this.wood, felled: this.fallen.filter((r) => r.done).map((r) => [+r.x.toFixed(2), +r.z.toFixed(2), +r.dir.x.toFixed(3), +r.dir.z.toFixed(3), +r.theta.toFixed(3)]) };
  }
  load(data) {
    if (!data) return;
    this.wood = data.wood || 0;
    for (const [x, z, dx, dz, th] of data.felled || []) {
      const i = this.flora.treeAt(x, z);
      if (i >= 0) this.fell(i, dx, dz, clamp(th, 0.3, 1.9));
    }
  }
}
