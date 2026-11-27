// Routes de terre : la boucle autour de l'île + embranchements (déjà aplanis dans le relief),
// et une nouvelle route qui part de la plage de départ. Rendu : bande de terre battue avec ornières,
// posée sur le relief et fondue sur les bords.
import * as THREE from 'three';
import { patchMaterial, loadTex, clamp, vnoise } from './core.js';

const S = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Route qui relie la plage de départ à la grande boucle
export function spurFromSpawn(world) {
  const sp = world.spawn;
  const ring = world.roads.find((r) => r.closed);
  if (!ring) return null;
  let best = ring.pts[0], bd = 1e9;
  for (const p of ring.pts) { const d = Math.hypot(p[0] - sp.x, p[2] - sp.z); if (d < bd) { bd = d; best = p; } }
  const a = [sp.x + 6, sp.z - 14], b = [best[0], best[2]];
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, sway = Math.sin(t * Math.PI * 2) * 5 * (1 - t);
    pts.push([a[0] + (b[0] - a[0]) * t + sway, 0, a[1] + (b[1] - a[1]) * t]);
  }
  return { closed: false, width: 4.6, pts, spur: true };
}

// Inscrit une route dans le masque « chemin » du terrain (couleur du sol, pas d'arbres ni de rochers dessus)
export function stampRoad(T, road) {
  const M = T.M, W = T.W, hw = road.width / 2, cell = W / M;
  const P = road.pts;
  for (let s = 0; s < P.length - 1; s++) {
    const ax = P[s][0], az = P[s][2], bx = P[s + 1][0], bz = P[s + 1][2];
    const x0 = Math.min(ax, bx) - hw - 3, x1 = Math.max(ax, bx) + hw + 3, z0 = Math.min(az, bz) - hw - 3, z1 = Math.max(az, bz) + hw + 3;
    const i0 = Math.max(0, Math.floor((x0 / W + 0.5) * M)), i1 = Math.min(M - 1, Math.ceil((x1 / W + 0.5) * M));
    const j0 = Math.max(0, Math.floor((z0 / W + 0.5) * M)), j1 = Math.min(M - 1, Math.ceil((z1 / W + 0.5) * M));
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * cell - W / 2, z = (j + 0.5) * cell - W / 2;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      const v = Math.round(255 * (1 - S(hw - 0.6, hw + 1.6, d)));
      const q = j * M + i;
      if (v > T.path[q]) T.path[q] = v;
    }
  }
}

// lissage Catmull-Rom et rééchantillonnage tous les `step` mètres
function resample(pts, closed, step) {
  const P = pts.map((p) => new THREE.Vector3(p[0], 0, p[2]));
  const curve = new THREE.CatmullRomCurve3(P, closed, 'centripetal');
  const n = Math.max(4, Math.round(curve.getLength() / step));
  return curve.getSpacedPoints(n);
}

export class Roads {
  constructor(scene, T, world) {
    this.scene = scene; this.T = T; this.world = world;
    this.chunks = [];
  }
  async init(base, roads) {
    const [map, nmap] = await Promise.all([
      loadTex(`${base}/tex/t_sand_a.jpg`, { srgb: true, repeat: true, aniso: 8 }), // piste de sable clair et tassé
      loadTex(`${base}/tex/t_sand_n.jpg`, { srgb: false, repeat: true, aniso: 8 }),
    ]);
    const mat = patchMaterial(new THREE.MeshStandardMaterial({
      map, normalMap: nmap, normalScale: new THREE.Vector2(1.1, 1.1), vertexColors: true, transparent: true, depthWrite: false,
      roughness: 0.93, color: new THREE.Color(0.92, 0.84, 0.7), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }), { key: 'road', canopy: 0.6 });
    this.mat = mat;
    for (const r of roads) this.build(r);
  }
  build(road) {
    const T = this.T, hw = road.width / 2;
    const pts = resample(road.pts, road.closed, 2);
    // profil en travers : bord fondu, ornières plus sombres et tassées, bande centrale un peu plus claire
    const across = [[-hw - 1.3, 0, 1.0], [-hw, 1, 0.95], [-hw * 0.62, 1, 0.7], [-hw * 0.38, 1, 0.86], [0, 1, 0.97], [hw * 0.38, 1, 0.86], [hw * 0.62, 1, 0.7], [hw, 1, 0.95], [hw + 1.3, 0, 1.0]];
    const K = across.length, CH = 50; // 50 points = morceaux de 100 m
    for (let c0 = 0; c0 < pts.length - 1; c0 += CH) {
      const c1 = Math.min(pts.length - 1, c0 + CH);
      const pos = [], col = [], uv = [], idx = [];
      let dist = c0 * 2;
      for (let i = c0; i <= c1; i++) {
        const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
        const tx = q.x - o.x, tz = q.z - o.z, tl = Math.hypot(tx, tz) || 1, nx = -tz / tl, nz = tx / tl;
        for (const [off, a, shade] of across) {
          const x = p.x + nx * off, z = p.z + nz * off;
          pos.push(x, T.height(x, z) + 0.05, z);
          const n = vnoise(x * 0.35, z * 0.35);
          const edge = a * (0.75 + 0.25 * n);
          col.push(shade * (0.95 + 0.1 * n), shade * (0.93 + 0.1 * n), shade * (0.9 + 0.1 * n), edge);
          uv.push((off + hw + 1.3) / 3.4, dist / 3.4);
        }
        dist += 2;
      }
      const rows = c1 - c0 + 1;
      for (let r = 0; r < rows - 1; r++) for (let k = 0; k < K - 1; k++) {
        const a = r * K + k, b = a + 1, c = a + K, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      // la route regarde vers le haut quel que soit le sens de parcours
      const nrm = g.attributes.normal;
      if (nrm.getY(0) < 0) { idx.reverse(); g.setIndex(idx); g.computeVertexNormals(); }
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.mat);
      m.receiveShadow = true; m.renderOrder = 1;
      this.scene.add(m);
      this.chunks.push(m);
    }
  }
  update(camera) {
    const c = camera.position;
    for (const m of this.chunks) m.visible = m.geometry.boundingSphere.center.distanceTo(c) < 420;
  }
}
