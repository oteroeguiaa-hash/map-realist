// Vie du lagon : bancs de poissons tropicaux, herbiers et coraux.
import * as THREE from 'three';
import { patchMaterial, mulberry32, clamp, lerp, vnoise } from './core.js';
import { GLSL_HEIGHT } from './terrain.js';

const V3 = THREE.Vector3;
// couleur de base, couleur des bandes, fréquence des bandes
const SPECIES = [
  [[0.95, 0.78, 0.06], [0.95, 0.85, 0.2], 0], [[0.1, 0.32, 0.85], [0.03, 0.05, 0.12], 2.2], [[0.75, 0.78, 0.7], [0.12, 0.12, 0.14], 5.0],
  [[0.15, 0.7, 0.6], [0.6, 0.3, 0.7], 1.2], [[0.95, 0.42, 0.08], [0.98, 0.98, 0.95], 3.0], [[0.85, 0.3, 0.32], [0.95, 0.75, 0.7], 0.8],
  [[0.55, 0.62, 0.68], [0.25, 0.28, 0.3], 0.4], [[0.9, 0.9, 0.2], [0.1, 0.1, 0.12], 6.5],
];

function fishGeometry() {
  const pos = [], idx = [], side = [];
  const prof = [[0.5, 0], [0.42, 0.11], [0.25, 0.2], [0.05, 0.22], [-0.15, 0.17], [-0.32, 0.08], [-0.4, 0.04]];
  const SEG = 10, base = [];
  for (const [z, r] of prof) {
    const row = [];
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      row.push(pos.length / 3);
      pos.push(Math.cos(a) * r * 0.38, Math.sin(a) * r, z);
      side.push(Math.sin(a));
    }
    base.push(row);
  }
  for (let r = 0; r < base.length - 1; r++) for (let k = 0; k < SEG; k++) {
    const a = base[r][k], b = base[r][(k + 1) % SEG], c = base[r + 1][k], d = base[r + 1][(k + 1) % SEG];
    idx.push(a, c, b, b, c, d);
  }
  const t0 = pos.length / 3;
  pos.push(0, 0.03, -0.38, 0, 0.2, -0.6, 0, -0.2, -0.6, 0, 0.18, 0.1, 0, 0.32, -0.1, 0, 0.16, -0.25);
  side.push(0, 0, 0, 0, 0, 0);
  idx.push(t0, t0 + 1, t0 + 2, t0 + 3, t0 + 4, t0 + 5);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class Sea {
  constructor(scene, terrain, world) {
    this.T = terrain;
    const rnd = mulberry32(17);
    this.schools = [];
    const sp = world.spawn;
    for (let tries = 0; tries < 4000 && this.schools.length < 26; tries++) {
      const near = this.schools.length < 12;
      const x = near ? sp.x + (rnd() - 0.5) * 360 : (rnd() - 0.5) * 1900, z = near ? sp.z + rnd() * 200 - 20 : (rnd() - 0.5) * 1900;
      const h = terrain.height(x, z);
      if (h > -1.4 || h < -7) continue;
      this.schools.push({ c: new V3(x, 0, z), r: 8 + rnd() * 18, w: (0.08 + rnd() * 0.12) * (rnd() < 0.5 ? -1 : 1), ph: rnd() * 6.28, sp: Math.floor(rnd() * SPECIES.length), n: 10 + Math.floor(rnd() * 14), size: 0.18 + rnd() * 0.3, offs: [] });
    }
    for (const s of this.schools) for (let k = 0; k < s.n; k++) s.offs.push(new V3((rnd() - 0.5) * 4, (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 4).multiplyScalar(0.6 + s.size * 2));
    const total = this.schools.reduce((a, s) => a + s.n, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.15, side: THREE.DoubleSide });
    patchMaterial(mat, {
      key: 'fish', canopy: 0,
      vertexPars: 'attribute float aSide; attribute vec3 aStripe; varying float vSide; varying vec3 vLocal; varying vec3 vStripe;\n',
      fragmentPars: 'varying float vSide; varying vec3 vLocal; varying vec3 vStripe;\n',
    });
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 1.7;
        float tail = smoothstep(0.2, -0.6, position.z);
        transformed.x += sin(uTime * 9.0 + ph - position.z * 5.0) * 0.12 * tail;
        vSide = aSide; vLocal = position; vStripe = aStripe;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        {
          float bands = vStripe.z > 0.01 ? step(0.5, fract(vLocal.z * vStripe.z * 2.0 + 0.25)) : 0.0;
          vec3 base = vColor.rgb;
          vec3 c = mix(base, vec3(vStripe.xy, vStripe.x * 0.5 + vStripe.y * 0.5), bands * 0.85);
          c = mix(c, c * 1.25 + 0.08, smoothstep(0.0, -0.9, vSide) * 0.6);
          diffuseColor.rgb = c;
        }`);
    };
    const geo = fishGeometry();
    const stripe = new Float32Array(total * 3);
    geo.setAttribute('aStripe', new THREE.InstancedBufferAttribute(stripe, 3));
    this.fish = new THREE.InstancedMesh(geo, mat, total);
    this.fish.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3);
    let k = 0;
    for (const s of this.schools) {
      const [c, st, f] = SPECIES[s.sp];
      for (let i = 0; i < s.n; i++, k++) {
        this.fish.instanceColor.setXYZ(k, c[0], c[1], c[2]);
        stripe[k * 3] = st[0]; stripe[k * 3 + 1] = st[1]; stripe[k * 3 + 2] = f;
      }
    }
    this.fish.frustumCulled = false;
    this.fish.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fish.count = 0;
    scene.add(this.fish);
    this.t = 0;
    this.buildCorals(scene, terrain, rnd);
    this.buildSeagrass(scene, terrain);
  }

  buildCorals(scene, T, rnd) {
    const kinds = [];
    // corail cerveau
    { const g = new THREE.IcosahedronGeometry(0.5, 1); const p = g.attributes.position; const col = [];
      for (let i = 0; i < p.count; i++) { const v = new V3().fromBufferAttribute(p, i); const n = 1 + 0.12 * Math.sin(v.x * 22) * Math.sin(v.z * 22 + v.y * 9); v.multiplyScalar(n); v.y = Math.max(v.y, -0.05) * 0.75; p.setXYZ(i, v.x, v.y, v.z); const g2 = 0.75 + 0.25 * Math.sin(v.x * 22) * Math.sin(v.z * 22 + v.y * 9); col.push(g2, g2, g2); }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); kinds.push(g); }
    // corail branchu
    { const geos = []; const r2 = mulberry32(8);
      const br = (p, d, L, r, lvl) => { const e = p.clone().addScaledVector(d, L); const c = new THREE.CylinderGeometry(r * 0.7, r, L, 4); c.translate(0, L / 2, 0); c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d)); c.translate(p.x, p.y, p.z); geos.push(c);
        if (lvl < 2) for (let k = 0; k < 2; k++) br(e, d.clone().add(new V3((r2() - 0.5) * 1.2, 0.3, (r2() - 0.5) * 1.2)).normalize(), L * 0.75, r * 0.7, lvl + 1); };
      for (let k = 0; k < 4; k++) br(new V3((r2() - 0.5) * 0.3, 0, (r2() - 0.5) * 0.3), new V3((r2() - 0.5) * 0.8, 1, (r2() - 0.5) * 0.8).normalize(), 0.35, 0.05, 0);
      const m = mergeSimple(geos); kinds.push(m); }
    // corail table
    { const g = new THREE.CylinderGeometry(0.9, 0.7, 0.08, 18, 1); g.translate(0, 0.45, 0); const st = new THREE.CylinderGeometry(0.08, 0.12, 0.45, 6); st.translate(0, 0.22, 0); kinds.push(mergeSimple([g, st])); }
    const cols = [[0.75, 0.42, 0.62], [0.9, 0.55, 0.32], [0.62, 0.6, 0.4], [0.45, 0.62, 0.5], [0.85, 0.75, 0.5], [0.55, 0.45, 0.75]];
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true }), { key: 'coral', canopy: 0 });
    this.corals = kinds.map((g) => {
      if (!g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
      const m = new THREE.InstancedMesh(g, mat, 700);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(700 * 3), 3);
      m.frustumCulled = false; m.count = 0; m.receiveShadow = true;
      scene.add(m); return m;
    });
    this.coralList = [];
    for (let i = 0; i < 60000 && this.coralList.length < 5000; i++) {
      const x = (rnd() - 0.5) * 2000, z = (rnd() - 0.5) * 2000, h = T.height(x, z);
      if (h > -0.6 || h < -5) continue;
      const patch = vnoise(x * 0.05, z * 0.05);
      if (patch < 0.55 && h < -2) continue;
      const kind = Math.floor(rnd() * 3), c = cols[Math.floor(rnd() * cols.length)];
      this.coralList.push({ x, y: h - 0.1, z, s: kind === 2 ? 0.35 + rnd() * 0.5 : 0.5 + rnd() * 1.4, r: rnd() * 6.28, kind, c: kind === 2 ? [0.55, 0.48, 0.38] : c });
    }
    this.lastC = new V3(1e9, 0, 0);
  }

  buildSeagrass(scene, T) {
    const rnd = mulberry32(31), pos = [], wind = [], idx = [];
    for (let k = 0; k < 3; k++) {
      const a = rnd() * Math.PI, ox = (rnd() - 0.5) * 0.1, oz = (rnd() - 0.5) * 0.1, dx = Math.cos(a), dz = Math.sin(a);
      const base = pos.length / 3;
      for (let s = 0; s <= 3; s++) { const t = s / 3; for (const sg of [-1, 1]) { pos.push(ox + dx * 0.025 * sg, t * 0.7, oz + dz * 0.025 * sg); wind.push(t, k); } }
      for (let s = 0; s < 3; s++) { const a0 = base + s * 2; idx.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2); }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 2));
    g.setIndex(idx);
    const N = 6000, seeds = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) seeds[i] = rnd();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    g.instanceCount = N;
    this.sgCenter = { value: new THREE.Vector2() };
    const mat = new THREE.MeshStandardMaterial({ color: 0x6f8a3a, roughness: 0.8, side: THREE.DoubleSide });
    patchMaterial(mat, { key: 'seagrass', canopy: 0, uniforms: { uHeight: { value: T.heightTex }, uHN: { value: T.N }, uC: this.sgCenter }, vertexPars: GLSL_HEIGHT + '\nattribute vec3 aSeed; attribute vec2 aWind; uniform vec2 uC;\n' });
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `
        vec2 S = vec2(70.0), base = uC - S * 0.5;
        vec2 p = base + fract((aSeed.xy * S - base) / S) * S;
        float h = terrainH(p);
        float dens = smoothstep(-0.7, -1.2, h) * (1.0 - smoothstep(-3.5, -5.0, h)) * smoothstep(0.45, 0.7, vnoise(p * 0.06));
        float sc = (0.4 + aSeed.z * 0.8) * step(aSeed.z, dens) * (1.0 - smoothstep(28.0, 35.0, distance(p, uCamPos.xz)));
        float ang = aSeed.x * 40.0;
        vec3 transformed = vec3(cos(ang) * position.x - sin(ang) * position.z, position.y * sc, sin(ang) * position.x + cos(ang) * position.z);
        transformed.x += sin(uTime * 1.3 + p.x * 0.4 + aWind.y) * 0.18 * aWind.x * aWind.x * sc;
        transformed += vec3(p.x, h, p.y);`);
    };
    this.seagrass = new THREE.Mesh(g, mat);
    this.seagrass.frustumCulled = false;
    scene.add(this.seagrass);
  }

  update(dt, camera) {
    this.t += dt;
    const cam = camera.position, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new V3(), p = new V3();
    let k = 0, n = 0;
    for (const s of this.schools) {
      const far = s.c.distanceToSquared(cam) > 220 * 220;
      if (far) { k += s.n; continue; }
      const a = s.ph + this.t * s.w;
      const cx = s.c.x + Math.cos(a) * s.r, cz = s.c.z + Math.sin(a) * s.r;
      const vx = -Math.sin(a) * Math.sign(s.w), vz = Math.cos(a) * Math.sign(s.w);
      const yaw = Math.atan2(vx, vz);
      for (let i = 0; i < s.n; i++, k++) {
        const o = s.offs[i];
        const wob = Math.sin(this.t * 1.3 + i * 1.7) * 0.6;
        const x = cx + o.x + Math.cos(yaw) * wob, z = cz + o.z - Math.sin(yaw) * wob;
        const bed = this.T.height(x, z);
        const y = clamp(lerp(bed, 0, 0.45) + o.y * 0.5, bed + 0.35, -0.3);
        q.setFromAxisAngle(new V3(0, 1, 0), yaw + Math.sin(this.t * 2 + i) * 0.25);
        m4.compose(p.set(x, y, z), q, s3.setScalar(s.size * (0.8 + (i % 5) * 0.08)));
        this.fish.setMatrixAt(n, m4);
        this.fish.instanceColor.setXYZ(n, ...SPECIES[s.sp][0]);
        const st = this.fish.geometry.attributes.aStripe;
        st.setXYZ(n, SPECIES[s.sp][1][0], SPECIES[s.sp][1][1], SPECIES[s.sp][2]);
        n++;
      }
    }
    void k;
    this.fish.count = n;
    this.fish.instanceMatrix.needsUpdate = true;
    this.fish.instanceColor.needsUpdate = true;
    this.fish.geometry.attributes.aStripe.needsUpdate = true;
    this.sgCenter.value.set(cam.x, cam.z);
    const hc = this.T.height(cam.x, cam.z);
    this.seagrass.visible = cam.y < 45 && hc < 6;
    if (cam.distanceToSquared(this.lastC) > 64) {
      this.lastC.copy(cam);
      const cnt = [0, 0, 0];
      for (const c of this.coralList) {
        const dx = c.x - cam.x, dz = c.z - cam.z;
        if (dx * dx + dz * dz > 120 * 120 || cam.y > 160) continue;
        const m = this.corals[c.kind], i = cnt[c.kind]++;
        if (i >= 700) continue;
        q.setFromAxisAngle(new V3(0, 1, 0), c.r);
        m4.compose(p.set(c.x, c.y, c.z), q, s3.setScalar(c.s));
        m.setMatrixAt(i, m4);
        m.instanceColor.setXYZ(i, c.c[0], c.c[1], c.c[2]);
      }
      this.corals.forEach((m, i) => { m.count = Math.min(cnt[i], 700); m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; });
    }
  }
}

function mergeSimple(geos) {
  const pos = [], nrm = [], idx = [];
  for (const g0 of geos) {
    const g = g0.index ? g0 : g0;
    const off = pos.length / 3;
    pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array);
    if (g.index) for (const i of g.index.array) idx.push(i + off);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}
