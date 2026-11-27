// Îles et massifs lointains tout autour, à l'horizon : pics rocheux, volcans éteints, petits archipels.
// Maillages légers (ils sont loin), figés (matrixAutoUpdate = false), voilés par la brume atmosphérique.
import * as THREE from 'three';
import { patchMaterial, mulberry32, vnoise } from './core.js';

// bruit en crêtes (ridged multifractal) + fBm : arêtes découpées et ravins
function ridged(x, z, oct) {
  let s = 0, a = 0.5, f = 1, w = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(vnoise(x * f, z * f) * 2 - 1);
    n *= n * w; w = Math.min(Math.max(n * 2, 0), 1);
    s += n * a; a *= 0.5; f *= 2.03;
  }
  return s;
}
function fbm(x, z, oct) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += (vnoise(x * f, z * f) - 0.5) * a; a *= 0.5; f *= 2.1; } return s; }

export function makeIslands(scene) {
  const rnd = mulberry32(77);
  const group = new THREE.Group();
  const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: false }), { key: 'islands', canopy: 0 });
  const KINDS = ['pic', 'volcan', 'archipel', 'massif'];
  const N = 11;
  for (let k = 0; k < N; k++) {
    const kind = KINDS[k % KINDS.length];
    const ang = (k / N) * Math.PI * 2 + rnd() * 0.4, dist = 9000 + rnd() * 7000; // très loin : de simples silhouettes
    const R = kind === 'archipel' ? 450 + rnd() * 400 : kind === 'volcan' ? 900 + rnd() * 700 : 350 + rnd() * 500;
    const H = kind === 'pic' ? 160 + rnd() * 180 : kind === 'volcan' ? 220 + rnd() * 260 : kind === 'massif' ? 90 + rnd() * 110 : 40 + rnd() * 60;
    const S = 40, g = new THREE.PlaneGeometry(R * 2.6, R * 2.6, S, S);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3), seed = rnd() * 100;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), d = Math.hypot(x, z) / R;
      let h;
      if (kind === 'volcan') {
        const cone = Math.max(0, 1 - d) ** 1.6, crater = Math.max(0, 1 - d / 0.12);
        h = H * (cone - crater * 0.35) + H * 0.25 * ridged(x / 220 + seed, z / 220, 4) * cone;
      } else if (kind === 'archipel') {
        // plusieurs îlots escarpés
        const m = Math.max(0, vnoise(x / 300 + seed, z / 300 - seed) - 0.42) * 2.4 * Math.max(0, 1 - d);
        h = H * m * (0.6 + ridged(x / 120 + seed, z / 120, 4));
      } else {
        const mask = Math.max(0, 1 - d) ** (kind === 'pic' ? 1.3 : 0.8);
        h = H * mask * (0.35 + ridged(x / (kind === 'pic' ? 260 : 380) + seed, z / 330, 5) * 0.9 + fbm(x / 150, z / 150 + seed, 3) * 0.4);
      }
      h = h - 12 * (1 - Math.max(0, 1 - d)); // les bords plongent sous la mer
      pos.setY(i, h);
      // couleurs : sable au ras de l'eau, forêt sur les pentes douces, roche en altitude
      const t = h / H, sand = h < 6 ? 1 : 0, rock = Math.min(1, Math.max(0, (t - 0.45) * 2.2));
      const c = [0.035 + rock * 0.02, 0.045 + rock * 0.02, 0.05 + rock * 0.02]; void sand;
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.position.set(Math.sin(ang) * dist, 0, Math.cos(ang) * dist);
    m.rotation.y = rnd() * Math.PI * 2;
    m.updateMatrix(); m.matrixAutoUpdate = false;
    m.castShadow = false; m.receiveShadow = false;
    group.add(m);
  }
  group.updateMatrixWorld(true);
  group.matrixAutoUpdate = false;
  scene.add(group);
  return group;
}
