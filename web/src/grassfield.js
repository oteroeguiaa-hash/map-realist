// Touffes d'herbe partout autour du joueur (modèle grass_medium_01) : posées sur une grille fixe du monde,
// elles suivent le relief, penchent dans le sens de la pente (gravité) et sont couchées par le vent.
// Seule une couronne autour de la caméra est dessinée ; elles rétrécissent au bord pour ne pas « apparaître ».
import * as THREE from 'three';
import { clamp } from './core.js';

const V3 = THREE.Vector3;
const hash = (x, z, k) => { const s = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };

export class GrassField {
  constructor(scene, T, flora, q) {
    this.scene = scene; this.T = T; this.flora = flora;
    this.types = flora.types.filter((t) => t.name === 'grass' || t.name === 'fern');
    this.grassTypes = this.types.filter((t) => t.name === 'grass');
    this.fernTypes = this.types.filter((t) => t.name === 'fern');
    this.setQuality(q);
    this.meshes = [];
    for (const t of this.types) {
      const ms = t.parts.map((p) => {
        const m = new THREE.InstancedMesh(p.geo, p.mat, this.cap);
        m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(m);
        return m;
      });
      // les parties d'un même type partagent la même matrice d'instance
      for (const m of ms) m.instanceMatrix = ms[0].instanceMatrix;
      this.meshes.push({ t, ms, attr: ms[0].instanceMatrix });
    }
    this.last = new V3(1e9, 0, 0);
    this.excl = null; // (x, z) => true pour exclure (constructions…)
  }
  setQuality(q) {
    this.R = [11, 15, 19, 23][q] ?? 15;
    this.step = [1.25, 1.05, 0.95, 0.85][q] ?? 1.05;
    this.cap = Math.ceil((Math.PI * this.R * this.R) / (this.step * this.step) / Math.max(1, 1)) + 64;
    this.last = new V3(1e9, 0, 0);
  }

  update(camera) {
    if (!this.meshes.length) return;
    const c = camera.position;
    if (c.distanceToSquared(this.last) < 1.0) return;
    this.last.copy(c);
    const T = this.T, R = this.R, S = this.step, R2 = R * R;
    const nrm = new V3(), q = new THREE.Quaternion(), qt = new THREE.Quaternion(), m4 = new THREE.Matrix4(), p = new V3(), sc = new V3(), ax = new V3();
    const counts = this.meshes.map(() => 0);
    const i0 = Math.floor((c.x - R) / S), i1 = Math.ceil((c.x + R) / S), j0 = Math.floor((c.z - R) / S), j1 = Math.ceil((c.z + R) / S);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = (i + hash(i, j, 1)) * S, z = (j + hash(i, j, 2)) * S;
      const dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz;
      if (d2 > R2) continue;
      const h = T.height(x, z);
      if (h > 205) continue;                                               // pas sur les cendres
      if (h < 2.6 && (h < 1.7 || hash(i, j, 7) > 0.12)) continue;          // plage : seulement quelques oyats en haut du sable
      if (T.mask(T.path, x, z) > 0.25 || T.mask(T.wet, x, z) > 0.7) continue;
      if (this.excl && this.excl(x, z)) continue;
      T.normal(x, z, nrm, 0.8);
      const slope = 1 - nrm.y;
      if (slope > 0.42) continue;                                          // roche nue
      // sous la jungle : plus de fougères, en terrain ouvert : de l'herbe
      const canopy = T.mask(T.clear, x, z) > 0.3 ? 0 : clamp((h - 8) / 20, 0, 1);
      const useFern = this.fernTypes.length && hash(i, j, 3) < canopy * 0.35;
      const list = useFern ? this.fernTypes : this.grassTypes;
      if (!list.length) continue;
      const t = list[Math.floor(hash(i, j, 4) * list.length)];
      const k = this.meshes.findIndex((g) => g.t === t);
      if (counts[k] >= this.cap) continue;
      // taille : rétrécit au bord du cercle visible
      const d = Math.sqrt(d2), edge = clamp((R - d) / (R * 0.28), 0, 1);
      const s = (useFern ? 0.6 + hash(i, j, 5) * 0.5 : 0.8 + hash(i, j, 5) * 0.6) * (0.25 + 0.75 * edge);
      // gravité : la touffe penche vers le bas de la pente
      const hx = nrm.x, hz = nrm.z, hl = Math.hypot(hx, hz);
      q.setFromAxisAngle(ax.set(0, 1, 0), hash(i, j, 6) * Math.PI * 2);
      if (hl > 1e-3) { qt.setFromAxisAngle(ax.set(hz / hl, 0, -hx / hl), Math.min(slope * 2.2, 0.75)); q.premultiply(qt); }
      m4.compose(p.set(x, h - 0.03, z), q, sc.setScalar(s));
      m4.toArray(this.meshes[k].attr.array, counts[k] * 16);
      counts[k]++;
    }
    this.meshes.forEach((g, k) => {
      g.attr.needsUpdate = true; g.attr.clearUpdateRanges(); g.attr.addUpdateRange(0, counts[k] * 16);
      for (const m of g.ms) m.count = counts[k];
    });
  }
}
