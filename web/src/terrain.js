// Relief : données (hauteurs, masques), échantillonnage CPU, maillage CDLOD et matériau du sol.
import * as THREE from 'three';
import { U, WORLD, patchMaterial, clamp, loadTex, vnoise } from './core.js';

export const GLSL_HEIGHT = /* glsl */`
uniform highp sampler2D uHeight;
uniform float uHN;
float terrainH(vec2 xz) {
  vec2 f = clamp((xz / ${WORLD.toFixed(1)} + 0.5) * uHN - 0.5, vec2(0.0), vec2(uHN - 1.001));
  vec2 i = floor(f);
  vec2 t = f - i;
  ivec2 c = ivec2(i);
  float a = texelFetch(uHeight, c, 0).r;
  float b = texelFetch(uHeight, c + ivec2(1, 0), 0).r;
  float d = texelFetch(uHeight, c + ivec2(0, 1), 0).r;
  float e = texelFetch(uHeight, c + ivec2(1, 1), 0).r;
  return mix(mix(a, b, t.x), mix(d, e, t.x), t.y);
}
`;

export class TerrainData {
  constructor(world, buf) {
    const N = (this.N = world.N), M = (this.M = world.M);
    this.W = world.W;
    this.cell = this.W / N;
    const u16 = new Uint16Array(buf, 0, N * N);
    this.h = new Float32Array(N * N);
    const k = (world.hMax - world.hMin) / 65535;
    for (let i = 0; i < N * N; i++) this.h[i] = world.hMin + u16[i] * k;
    let off = N * N * 2;
    this.ao = new Uint8Array(buf, off, M * M); off += M * M;
    this.path = new Uint8Array(buf, off, M * M); off += M * M;
    this.wet = new Uint8Array(buf, off, M * M); off += M * M;
    this.clear = new Uint8Array(buf, off, M * M);
  }
  height(x, z) {
    const N = this.N;
    const fi = clamp((x / this.W + 0.5) * N - 0.5, 0, N - 1.001), fj = clamp((z / this.W + 0.5) * N - 0.5, 0, N - 1.001);
    const i = fi | 0, j = fj | 0, u = fi - i, v = fj - j, q = j * N + i, h = this.h;
    return (h[q] * (1 - u) + h[q + 1] * u) * (1 - v) + (h[q + N] * (1 - u) + h[q + N + 1] * u) * v;
  }
  normal(x, z, out = new THREE.Vector3(), e = 1.0) {
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    return out.set(-dx, 2 * e, -dz).normalize();
  }
  mask(arr, x, z) {
    const M = this.M;
    const fi = clamp((x / this.W + 0.5) * M - 0.5, 0, M - 1.001), fj = clamp((z / this.W + 0.5) * M - 0.5, 0, M - 1.001);
    const i = fi | 0, j = fj | 0, u = fi - i, v = fj - j, q = j * M + i;
    return ((arr[q] * (1 - u) + arr[q + 1] * u) * (1 - v) + (arr[q + M] * (1 - u) + arr[q + M + 1] * u) * v) / 255;
  }
  slope(x, z) { return 1 - this.normal(x, z, _n, 2).y; }

  // Relief : dunes et bosses sur le sable, buttes et creux dans l'herbe et sous la jungle.
  // Ajouté aux hauteurs elles-mêmes : le buggy, le joueur et les plantes suivent exactement ce relief.
  addRelief(world) {
    const N = this.N, W = this.W, h = this.h, st = world.strip, sp = world.spawn, pool = world.waterfall.pool;
    const S = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
    const sa = st ? Math.sin(st.angle) : 0, ca = st ? Math.cos(st.angle) : 1;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const q = j * N + i, h0 = h[q];
      if (h0 < -2.5 || h0 > 190) continue;
      const x = (i + 0.5) / N * W - W / 2, z = (j + 0.5) / N * W - W / 2;
      let k = 1;
      k *= 1 - S(0.0, 0.25, this.mask(this.path, x, z));             // routes bien lisses
      k *= 1 - 0.85 * this.mask(this.wet, x, z);                      // lits des rivières
      if (st) { const u = (x - st.x) * sa + (z - st.z) * ca, v = (x - st.x) * ca - (z - st.z) * sa; k *= S(0, 25, Math.max(Math.abs(u) - st.length / 2, Math.abs(v) - st.width / 2)); }
      k *= S(8, 20, Math.hypot(x - sp.x, z - sp.z));                  // point de départ plat
      k *= S(6, 16, Math.hypot(x - pool[0], z - pool[2]) - world.waterfall.poolR);
      if (world.camp) k *= S(4, 12, Math.hypot(x - world.camp.x, z - world.camp.z) - world.camp.r);
      const lip = world.waterfall.lip;
      const kLip = S(30, 70, Math.hypot(x - lip[0], z - lip[2]));
      if (world.ponds) for (const p of world.ponds) { const dp = Math.hypot(x - p.x, z - p.z) - p.r; if (dp < 14) k *= S(2, 14, dp); }
      if (k <= 0.001) continue;
      let d;
      if (h0 < 2.6) {
        // dunes allongées dans le sens du vent + petites bosses
        const ux = x * 0.8 + z * 0.6, uz = -x * 0.6 + z * 0.8;
        d = ((vnoise(ux / 16, uz / 6) - 0.5) * 1.2 + (vnoise(x / 5 + 11, z / 5 - 3) - 0.5) * 0.45) * S(0.1, 1.1, h0);
      } else {
        d = (vnoise(x / 9 - 5, z / 9 + 8) - 0.5) * 0.9 + (vnoise(x / 4.2 + 17, z / 4.2 - 9) - 0.5) * 0.45;
      }
      // montagnes : bruit en crêtes (ridged multifractal) qui découpe arêtes et ravins sur les hauteurs
      if (h0 > 30) {
        let rs = 0, a = 0.5, f = 1, wgt = 1;
        for (let o = 0; o < 4; o++) { let n = 1 - Math.abs(vnoise(x / 95 * f + 13, z / 95 * f - 7) * 2 - 1); n *= n * wgt; wgt = Math.min(Math.max(n * 2, 0), 1); rs += n * a; a *= 0.5; f *= 2.05; }
        d += (rs - 0.35) * 9 * S(30, 90, h0) * (1 - S(225, 270, h0)) * kLip;
      }
      // trous irréguliers, ici et là (pas partout) : petites cuvettes de 0,3 à 0,9 m
      const pit = vnoise(x / 6.5 + 31, z / 6.5 - 17);
      if (pit > 0.74 && h0 > 0.6) d -= Math.pow((pit - 0.74) / 0.26, 1.5) * (0.5 + 0.6 * vnoise(x / 2.1, z / 2.1)) * (h0 < 2.6 ? 0.6 : 1);
      h[q] = h0 + d * k;
    }
  }
  makeTextures() {
    const N = this.N, M = this.M;
    const ht = new THREE.DataTexture(this.h, N, N, THREE.RedFormat, THREE.FloatType);
    ht.minFilter = ht.magFilter = THREE.NearestFilter;
    ht.needsUpdate = true;
    this.heightTex = ht;
    // normales (RGB) calculées depuis les hauteurs
    const nd = new Uint8Array(N * N * 4), h = this.h, c2 = 2 * this.cell;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const l = h[j * N + Math.max(i - 1, 0)], r = h[j * N + Math.min(i + 1, N - 1)];
      const d = h[Math.max(j - 1, 0) * N + i], u = h[Math.min(j + 1, N - 1) * N + i];
      let nx = -(r - l) / c2, ny = 1, nz = -(u - d) / c2;
      const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
      const q = (j * N + i) * 4;
      nd[q] = (nx * 0.5 + 0.5) * 255; nd[q + 1] = (ny * 0.5 + 0.5) * 255; nd[q + 2] = (nz * 0.5 + 0.5) * 255; nd[q + 3] = 255;
    }
    const nt = new THREE.DataTexture(nd, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    nt.minFilter = THREE.LinearMipmapLinearFilter; nt.magFilter = THREE.LinearFilter; nt.generateMipmaps = true;
    nt.needsUpdate = true;
    this.normalTex = nt;
    const md = new Uint8Array(M * M * 4);
    for (let q = 0; q < M * M; q++) { md[q * 4] = this.path[q]; md[q * 4 + 1] = this.wet[q]; md[q * 4 + 2] = this.clear[q]; md[q * 4 + 3] = this.ao[q]; }
    const mt = new THREE.DataTexture(md, M, M, THREE.RGBAFormat, THREE.UnsignedByteType);
    mt.minFilter = THREE.LinearMipmapLinearFilter; mt.magFilter = THREE.LinearFilter; mt.generateMipmaps = true;
    mt.needsUpdate = true;
    this.maskTex = mt;
    // hauteurs demi-résolution filtrables (pour les ombres du relief)
    const lo = new Uint16Array(M * M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const q = 2 * j * N + 2 * i;
      lo[j * M + i] = THREE.DataUtils.toHalfFloat((h[q] + h[q + 1] + h[q + N] + h[q + N + 1]) * 0.25);
    }
    const lt = new THREE.DataTexture(lo, M, M, THREE.RedFormat, THREE.HalfFloatType);
    lt.minFilter = lt.magFilter = THREE.LinearFilter;
    lt.needsUpdate = true;
    this.heightLoTex = lt;
  }
}
const _n = new THREE.Vector3();

// ---------- Maillage CDLOD ----------
const GRID = 32;
const LEVELS = 7; // 32 m … 2048 m

export class TerrainMesh {
  constructor(data, tex, quality) {
    this.data = data;
    this.setQuality(quality);
    // grille partagée 33×33
    const pos = [], idx = [];
    for (let z = 0; z <= GRID; z++) for (let x = 0; x <= GRID; x++) pos.push(x, 0, z);
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const a = z * (GRID + 1) + x, b = a + 1, c = a + GRID + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    this.nodeAttr = new THREE.InstancedBufferAttribute(new Float32Array(1024 * 4), 4);
    this.nodeAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aNode', this.nodeAttr);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = g;
    // min/max par nœud
    this.mm = [];
    const N = data.N, h = data.h;
    for (let L = 0; L < LEVELS; L++) {
      const n = 64 >> L, arr = new Float32Array(n * n * 2);
      if (L === 0) {
        for (let nz = 0; nz < n; nz++) for (let nx = 0; nx < n; nx++) {
          let mn = 1e9, mx = -1e9;
          for (let j = nz * 16; j <= Math.min(nz * 16 + 16, N - 1); j++) for (let i = nx * 16; i <= Math.min(nx * 16 + 16, N - 1); i++) {
            const v = h[j * N + i]; if (v < mn) mn = v; if (v > mx) mx = v;
          }
          arr[(nz * n + nx) * 2] = mn; arr[(nz * n + nx) * 2 + 1] = mx;
        }
      } else {
        const p = this.mm[L - 1], pn = n * 2;
        for (let nz = 0; nz < n; nz++) for (let nx = 0; nx < n; nx++) {
          let mn = 1e9, mx = -1e9;
          for (let c = 0; c < 4; c++) {
            const q = ((nz * 2 + (c >> 1)) * pn + nx * 2 + (c & 1)) * 2;
            mn = Math.min(mn, p[q]); mx = Math.max(mx, p[q + 1]);
          }
          arr[(nz * n + nx) * 2] = mn; arr[(nz * n + nx) * 2 + 1] = mx;
        }
      }
      this.mm.push(arr);
    }
    this.material = makeTerrainMaterial(data, tex);
    this.material.onBeforeCompile = ((orig) => (shader, r) => {
      shader.uniforms.uMorph = this.morphU;
      orig(shader, r);
    })(this.material.onBeforeCompile);
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this._box = new THREE.Box3();
    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
  }
  setQuality(q) {
    const base = [44, 56, 68, 84][q] || 56;
    this.ranges = [];
    for (let L = 0; L < LEVELS; L++) this.ranges.push(base * Math.pow(2, L));
    this.ranges[LEVELS - 1] = 1e6;
    if (!this.morphU) this.morphU = { value: Array.from({ length: 8 }, () => new THREE.Vector4()) };
    for (let L = 0; L < LEVELS; L++) {
      const prev = L ? this.ranges[L - 1] : 0, r = Math.min(this.ranges[L], 1e5);
      this.morphU.value[L].set(prev + (r - prev) * 0.62, r * 0.96, 0, 0);
    }
  }
  update(camera) {
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    this.cam = camera.position;
    this.count = 0;
    this._sel(LEVELS - 1, 0, 0);
    this.geo.instanceCount = this.count;
    this.nodeAttr.needsUpdate = true;
    this.nodeAttr.addUpdateRange(0, this.count * 4);
  }
  _add(x, z, s, L) {
    if (this.count >= 1024) return;
    const a = this.nodeAttr.array, q = this.count * 4;
    a[q] = x; a[q + 1] = z; a[q + 2] = s; a[q + 3] = L;
    this.count++;
  }
  _inRange(box, r) {
    const c = this.cam;
    const dx = Math.max(box.min.x - c.x, 0, c.x - box.max.x), dy = Math.max(box.min.y - c.y, 0, c.y - box.max.y), dz = Math.max(box.min.z - c.z, 0, c.z - box.max.z);
    return dx * dx + dy * dy + dz * dz <= r * r;
  }
  _sel(L, ix, iz) {
    const size = 32 << L, x0 = -WORLD / 2 + ix * size, z0 = -WORLD / 2 + iz * size;
    const n = 64 >> L, mm = this.mm[L], q = (iz * n + ix) * 2;
    const box = this._box;
    box.min.set(x0, mm[q] - 2, z0); box.max.set(x0 + size, mm[q + 1] + 2, z0 + size);
    if (!this._inRange(box, this.ranges[L])) return false;
    if (!this._frustum.intersectsBox(box)) return true;
    if (L === 0) { this._add(x0, z0, size, 0); return true; }
    if (!this._inRange(box, this.ranges[L - 1])) { this._add(x0, z0, size, L); return true; }
    for (let c = 0; c < 4; c++) {
      const cx = ix * 2 + (c & 1), cz = iz * 2 + (c >> 1);
      if (!this._sel(L - 1, cx, cz)) {
        const cs = size / 2;
        // zone de l'enfant hors de sa portée : rendue au niveau courant (grille fine entièrement « morphée »)
        const cmm = this.mm[L - 1], cq = (cz * (n * 2) + cx) * 2;
        box.min.set(x0 + (c & 1) * cs, cmm[cq] - 2, z0 + (c >> 1) * cs); box.max.set(box.min.x + cs, cmm[cq + 1] + 2, box.min.z + cs);
        if (this._frustum.intersectsBox(box)) this._add(box.min.x, box.min.z, cs, L - 1);
      }
    }
    return true;
  }
}

function makeTerrainMaterial(data, tex) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  const uniforms = {
    uHeight: { value: data.heightTex }, uHN: { value: data.N },
    uNormalTex: { value: data.normalTex }, uMaskTex: { value: data.maskTex },
    tSandA: { value: tex.sandA }, tSandN: { value: tex.sandN },
    tJungA: { value: tex.jungleA }, tJungN: { value: tex.jungleN },
    tGrassA: { value: tex.grassA }, tRockA: { value: tex.rockA }, tRockN: { value: tex.rockN },
    tPathA: { value: tex.pathA }, tPathN: { value: tex.pathN }, tPebA: { value: tex.pebA },
  };
  patchMaterial(mat, {
    key: 'terrain',
    uniforms,
    canopy: 0.6,
    vertexPars: GLSL_HEIGHT + '\nuniform vec4 uMorph[8];\nattribute vec4 aNode;\n',
    fragmentPars: /* glsl */`
      uniform sampler2D uNormalTex; uniform sampler2D uMaskTex;
      uniform sampler2D tSandA; uniform sampler2D tSandN; uniform sampler2D tJungA; uniform sampler2D tJungN;
      uniform sampler2D tGrassA; uniform sampler2D tRockA; uniform sampler2D tRockN;
      uniform sampler2D tPathA; uniform sampler2D tPathN; uniform sampler2D tPebA;
      vec3 decN(vec4 t) { vec2 xy = t.xy * 2.0 - 1.0; return vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0))); }
      float hblend(float w, float hA, float hB) {
        float a = 1.0 - w, b = w;
        float ma = max(hA + a, hB + b) - 0.3;
        float ba = max(hA + a - ma, 0.0), bb = max(hB + b - ma, 0.0);
        return bb / max(ba + bb, 1e-4);
      }
      float swash(vec2 p) { return 0.11 * sin(uTime * 0.55 + p.x * 0.045 + p.y * 0.031) + 0.05 * sin(uTime * 1.13 + p.x * 0.11 - p.y * 0.07); }
      float caustic(vec2 uv, float time) {
        vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
        vec2 i = p;
        float c = 1.0;
        for (int n = 0; n < 4; n++) {
          float t = time * (1.0 - (3.5 / float(n + 1)));
          i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
          c += 1.0 / length(vec2(p.x / (sin(i.x + t) / 0.005), p.y / (cos(i.y + t) / 0.005)));
        }
        c /= 4.0;
        c = 1.17 - pow(c, 1.4);
        return pow(abs(c), 8.0);
      }
      float tAO = 1.0; float tRough = 0.9; vec3 tN = vec3(0.0, 1.0, 0.0);
    `,
  });
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev(shader, r);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = vs.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(1.0, 0.0, 0.0);\n#endif');
    vs = vs.replace('#include <begin_vertex>', /* glsl */`
      vec2 gp = position.xz;
      float nsz = aNode.z;
      vec2 wxz = aNode.xy + gp * (nsz / 32.0);
      float h0 = terrainH(wxz);
      float dist = distance(uCamPos, vec3(wxz.x, h0, wxz.y));
      vec4 mr = uMorph[int(aNode.w + 0.5)];
      float mk = clamp((dist - mr.x) / (mr.y - mr.x), 0.0, 1.0);
      vec2 fr = fract(gp * 0.5) * 2.0;
      wxz -= fr * (nsz / 32.0) * mk;
      vec3 transformed = vec3(wxz.x, terrainH(wxz), wxz.y);
    `);
    fs = fs.replace('#include <map_fragment>', /* glsl */`
      vec2 tuv = vWP.xz / uWorldSize + 0.5;
      vec3 Nb = normalize(texture(uNormalTex, tuv).xyz * 2.0 - 1.0);
      vec4 mk = texture(uMaskTex, tuv);
      float hgt = vWP.y;
      float slope = 1.0 - Nb.y;
      float n1 = vnoise(vWP.xz * 0.045), n2 = vnoise(vWP.xz * 0.21 + 13.0), n3 = vnoise(vWP.xz * 0.0085 - 7.0);
      float camD = distance(uCamPos, vWP);
      // couche de base : sol de jungle
      vec2 uvJ = vWP.xz / 3.0;
      vec3 alb = texture(tJungA, uvJ).rgb * vec3(0.95, 1.0, 0.9);
      vec4 jn = texture(tJungN, uvJ);
      vec3 nT = decN(jn); float hL = jn.b; float rough = 0.95;
      // herbe (clairières, ceinture côtière)
      float wGrass = clamp(mk.b * 1.3 + smoothstep(0.55, 0.85, n3) * 0.7 + (1.0 - smoothstep(3.5, 7.0, hgt)) * 0.6, 0.0, 1.0) * (1.0 - smoothstep(0.22, 0.38, slope));
      if (wGrass > 0.01) {
        vec3 ga = texture(tGrassA, vWP.xz / 2.6).rgb;
        float b = hblend(wGrass, hL, 0.55 + n2 * 0.2);
        alb = mix(alb, ga * vec3(0.4, 0.62, 0.28), b); hL = mix(hL, 0.6, b);
      }
      // terre nue (Farm Soil) par plaques sous la jungle, là où les feuilles mortes manquent
      float wSoil = smoothstep(0.58, 0.78, n2 * 0.6 + n1 * 0.4) * smoothstep(6.0, 14.0, hgt) * (1.0 - wGrass);
      if (wSoil > 0.01) {
        vec2 uvF = vWP.xz / 2.8;
        vec4 fn = texture(tPathN, uvF);
        float b = hblend(wSoil, hL, fn.b);
        alb = mix(alb, texture(tPathA, uvF).rgb * vec3(0.92, 0.88, 0.82), b); nT = normalize(mix(nT, decN(fn), b)); hL = mix(hL, fn.b, b);
      }
      // cendres volcaniques
      float wAsh = smoothstep(185.0, 250.0, hgt + (n1 - 0.5) * 60.0);
      if (wAsh > 0.01) {
        vec3 aa = texture(tRockA, vWP.xz / 9.0 + 0.37).rgb; // cendres : texture de roche, désaturée (une texture de moins pour le téléphone)
        aa = mix(aa, vec3(dot(aa, vec3(0.33))), 0.6) * vec3(0.78, 0.74, 0.72);
        vec4 an = texture(tRockN, vWP.xz / 5.5);
        float b = hblend(wAsh, hL, an.b);
        alb = mix(alb, aa, b); nT = normalize(mix(nT, decN(an), b)); hL = mix(hL, an.b, b); rough = mix(rough, 0.95, b);
      }
      // sable (plage et fonds lagunaires)
      float beachTop = 1.9 + n1 * 1.3 + n3 * 0.9;
      float wSand = 1.0 - smoothstep(beachTop - 0.5, beachTop + 0.7, hgt);
      if (wSand > 0.01) {
        vec2 uvS = vWP.xz / 3.4;
        vec3 sa = texture(tSandA, uvS).rgb;
        sa = mix(sa, sa * 0.55 + vec3(0.3, 0.27, 0.21), 0.5) * vec3(0.98, 0.91, 0.8); // sable beige chaud (pas blanc)
        vec4 sn = texture(tSandN, uvS);
        float b = hblend(wSand, hL, sn.b * 0.8 + 0.2);
        alb = mix(alb, sa, b); nT = normalize(mix(nT, decN(sn), b)); hL = mix(hL, sn.b, b); rough = mix(rough, 0.88, b);
      }
      // galets de rivière (Dry River Pebbles) : lits et rives des rivières, bord du bassin, criques rocheuses
      float wPeb = clamp(mk.g * 1.4 * smoothstep(1.5, 4.0, hgt) + smoothstep(0.16, 0.3, slope) * (1.0 - smoothstep(2.5, 6.0, hgt)) * step(0.4, hgt) * 0.9, 0.0, 1.0);
      if (wPeb > 0.01) {
        vec2 uvG = vWP.xz / 2.2;
        vec3 ga = texture(tPebA, uvG).rgb;
        float hg = dot(ga, vec3(0.33)) * 1.6;
        float b = hblend(wPeb, hL, hg);
        alb = mix(alb, ga * vec3(1.02, 0.98, 0.92), b); nT = normalize(mix(nT, vec3(0.0, 0.0, 1.0), b * 0.5)); hL = mix(hL, hg, b); rough = mix(rough, 0.85, b);
      }
      // roche (pentes fortes, falaises) en projection double
      float wRock = smoothstep(0.36, 0.56, slope + (n2 - 0.5) * 0.18);
      wRock = max(wRock, smoothstep(0.24, 0.4, slope) * wAsh);
      if (wRock > 0.01) {
        vec2 uvTop = vWP.xz / 7.0;
        // projection triplanaire complète : plus de texture étirée sur les falaises
        vec3 tw = pow(abs(Nb), vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
        vec2 uvX = vWP.zy / 7.0, uvZ = vWP.xy / 7.0;
        vec3 ra = texture(tRockA, uvTop).rgb * tw.y + texture(tRockA, uvX).rgb * tw.x + texture(tRockA, uvZ).rgb * tw.z;
        vec4 rn = texture(tRockN, uvTop) * tw.y + texture(tRockN, uvX) * tw.x + texture(tRockN, uvZ) * tw.z;
        ra *= mix(vec3(1.0), vec3(0.85, 0.82, 0.8), wAsh);
        float b = hblend(wRock, hL, rn.b);
        alb = mix(alb, ra * 1.15, b); nT = normalize(mix(nT, decN(rn), b)); hL = mix(hL, rn.b, b); rough = mix(rough, 0.8, b);
      }
      // pistes de terre
      float wPath = mk.r * (1.0 - wRock * 0.6);
      if (wPath > 0.01) {
        vec2 uvP = vWP.xz / 3.2;
        // piste de sable tassé (comme les photos de référence), un peu de terre dans les ornières
        vec3 pa = mix(texture(tSandA, vWP.xz / 3.4).rgb * vec3(0.92, 0.84, 0.7), texture(tPathA, uvP).rgb, 0.25);
        vec4 pn = texture(tPathN, uvP);
        float b = hblend(wPath, hL, pn.b);
        alb = mix(alb, pa, b); nT = normalize(mix(nT, decN(pn), b)); rough = mix(rough, 0.9, b);
      }
      // mousse : sur les pentes douces, à l'ombre de la jungle et près de l'eau
      float wMoss = smoothstep(0.08, 0.2, slope) * (1.0 - smoothstep(0.32, 0.45, slope)) * clamp(gCanopy * 1.2 + mk.g, 0.0, 1.0) * smoothstep(0.45, 0.7, n2) * (1.0 - wSand);
      alb = mix(alb, vec3(dot(alb, vec3(0.33))) * vec3(0.55, 0.85, 0.35) * 1.1, wMoss * 0.7); rough = mix(rough, 0.97, wMoss);
      // variation à grande échelle
      alb *= 0.82 + 0.36 * n3 + 0.12 * (n1 - 0.5);
      // sous la canopée : sol sombre et verdâtre ; au loin, la jungle se lit comme une masse verte
      alb = mix(alb, alb * vec3(0.5, 0.58, 0.4), gCanopy * 0.75);
      alb = mix(alb, vec3(0.045, 0.075, 0.03), clamp(gCanopy * 1.4, 0.0, 1.0) * smoothstep(110.0, 420.0, camD) * (1.0 - wRock));
      // humidité : rives, bassin, embruns de la cascade, laisse de mer
      float wetSand = (1.0 - smoothstep(0.02, 0.55, hgt - swash(vWP.xz))) * step(-1.0, hgt);
      float wet = max(mk.g * 0.85, wetSand);
      alb = mix(alb, alb * vec3(0.58, 0.6, 0.6), wet);
      alb = mix(alb, alb * vec3(0.7, 0.9, 0.55), mk.g * smoothstep(0.3, 0.6, slope) * 0.6);
      rough = mix(rough, 0.28, wet);
      nT.xy *= mix(1.0, 0.35, wetSand);
      if (hgt < 0.0) alb *= mix(vec3(1.0), vec3(0.82, 0.92, 0.9), smoothstep(0.0, 3.0, -hgt));
      // détail estompé au loin
      nT.xy *= 1.0 - smoothstep(60.0, 220.0, camD) * 0.8;
      vec3 Tt = normalize(vec3(Nb.y, -Nb.x, 0.0));
      vec3 Bt = cross(Tt, Nb);
      tN = normalize(Tt * nT.x + Bt * nT.y + Nb * nT.z);
      tRough = rough;
      tAO = mix(1.0, mk.a, 0.85);
      diffuseColor.rgb *= alb;
    `);
    fs = fs.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;');
    fs = fs.replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);');
    fs = fs.replace('#include <lights_fragment_end>', /* glsl */`#include <lights_fragment_end>
      reflectedLight.indirectDiffuse *= tAO;
      reflectedLight.indirectSpecular *= tAO;
      if (vWP.y < 0.0) {
        float dep = -vWP.y;
        vec3 Td = exp(-uSigma * dep / max(uSunDir.y, 0.2));
        vec3 Ta = exp(-uSigma * dep * 1.3);
        reflectedLight.directDiffuse *= Td;
        reflectedLight.directSpecular *= Td * 0.2;
        reflectedLight.indirectDiffuse *= Ta;
        reflectedLight.indirectSpecular *= Ta;
        float cz = caustic(vWP.xz * 0.16, uTime * 0.55);
        float ndl = max(dot(tN, uSunDir), 0.0);
        reflectedLight.directDiffuse += diffuseColor.rgb * RECIPROCAL_PI * gSunDirect * Td * ndl * cz * 2.2 * smoothstep(0.05, 0.6, dep) * (1.0 - smoothstep(5.0, 16.0, dep));
      }`);
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  return mat;
}

export async function loadTerrainTextures(base, aniso) {
  const L = (n, srgb) => loadTex(`${base}/tex/t_${n}.jpg`, { srgb, repeat: true, aniso });
  const [sandA, sandN, jungleA, jungleN, grassA, rockA, rockN, ashA, pathA, pathN, pebA] = await Promise.all([
    L('sand_a', true), L('sand_n', false), L('jungle_a', true), L('jungle_n', false), L('grass_a', true),
    L('rock_a', true), L('rock_n', false), Promise.resolve(null), L('path_a', true), L('path_n', false), L('peb_a', true),
  ]);
  return { sandA, sandN, jungleA, jungleN, grassA, rockA, rockN, ashA, pathA, pathN, pebA };
}
