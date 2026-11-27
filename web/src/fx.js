// Particules : panache du volcan, brume et embruns de la cascade, sable et éclaboussures du buggy, pluie.
import * as THREE from 'three';
import { U, GLSL_COMMON, mulberry32, clamp, lerp, smoothstep } from './core.js';

function puffTexture() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S), d = img.data, rnd = mulberry32(5);
  const blobs = Array.from({ length: 22 }, () => ({ x: 0.5 + (rnd() - 0.5) * 0.5, y: 0.5 + (rnd() - 0.5) * 0.5, r: 0.12 + rnd() * 0.2 }));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    let a = 0;
    for (const b of blobs) { const dd = Math.hypot(u - b.x, v - b.y) / b.r; a += Math.max(0, 1 - dd * dd) * 0.35; }
    const edge = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 2);
    a = clamp(a * edge * 1.6, 0, 1);
    const q = (y * S + x) * 4;
    d[q] = d[q + 1] = d[q + 2] = 255; d[q + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Bouffée de fumée « chou-fleur » : alpha (A) + pente du relief (R, G) pour éclairer les bourrelets.
// Relief = union de demi-sphères (max), comme les volutes d'un panache volcanique.
function smokeTexture() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S), d = img.data, rnd = mulberry32(11);
  const blobs = [];
  for (let k = 0; k < 34; k++) {
    const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 0.27;
    const rad = 0.09 + rnd() * 0.13 * (1 - r * 1.6);
    blobs.push({ x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r, r: rad });
  }
  const H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S, v = (y + 0.5) / S;
    let h = 0;
    for (const b of blobs) { const q = 1 - ((u - b.x) ** 2 + (v - b.y) ** 2) / (b.r * b.r); if (q > 0) h = Math.max(h, Math.sqrt(q) * b.r + 0.6 * b.r); }
    // grain fin (petites volutes)
    h += (Math.sin(u * 61 + Math.sin(v * 37) * 2) * Math.sin(v * 53 + Math.sin(u * 29) * 2)) * 0.006 * Math.min(1, h * 12);
    H[y * S + x] = h;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const h = H[y * S + x];
    const hx = H[y * S + Math.min(S - 1, x + 1)] - H[y * S + Math.max(0, x - 1)];
    const hy = H[Math.min(S - 1, y + 1) * S + x] - H[Math.max(0, y - 1) * S + x];
    const u = (x + 0.5) / S - 0.5, v = (y + 0.5) / S - 0.5;
    // bord très doux : fondu radial + seuil progressif du relief
    const a = clamp(smoothstep(0.0, 0.16, h) * (1 - smoothstep(0.3, 0.5, Math.hypot(u, v))), 0, 1);
    const q = (y * S + x) * 4;
    // normale du relief dans le repère du sprite (x vers la droite, y vers le haut : la toile est retournée)
    d[q] = clamp(128 - hx * S * 0.55 * 127, 0, 255);
    d[q + 1] = clamp(128 + hy * S * 0.55 * 127, 0, 255);
    d[q + 2] = 255; d[q + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const SMOKE_DT = 0.92; // une bouffée de fumée toutes les 0,92 s (≈ 87 en vie)

class Particles {
  constructor(scene, max, tex, opts = {}) {
    this.max = max;
    this.n = 0;
    this.P = new Float32Array(max * 3); this.Vv = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max);
    this.col = new Float32Array(max * 3); this.rot = new Float32Array(max);
    this.sh = new Float32Array(max * 2).fill(1); // fumée : ombre propre (soleil), occlusion (ciel)
    this.smoke = !!opts.smoke;
    this.fadeIn = opts.fadeIn ?? 8;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aP = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aR = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aP', this.aP); g.setAttribute('aC', this.aC); g.setAttribute('aR', this.aR);
    if (this.smoke) { this.aS = new THREE.InstancedBufferAttribute(new Float32Array(max * 2).fill(1), 2).setUsage(THREE.DynamicDrawUsage); g.setAttribute('aS', this.aS); }
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      defines: this.smoke ? { SMOKE: 1 } : {},
      uniforms: { ...U, tPuff: { value: tex }, uLit: { value: opts.lit ?? 1 }, uDensity: { value: opts.density ?? 1 } },
      vertexShader: /* glsl */`
        ${GLSL_COMMON}
        attribute vec4 aP; attribute vec4 aC; attribute float aR;
        varying vec2 vUv; varying vec4 vC; varying vec3 vWP; varying vec3 vRight; varying vec3 vUp; varying float vNear;
        #ifdef SMOKE
        attribute vec2 aS; varying vec2 vS;
        #endif
        void main() {
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float c = cos(aR), s = sin(aR);
          vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
          vec3 wp = aP.xyz + (right * q.x + up * q.y) * aP.w;
          // axes du sprite tourné (l'éclairage suit la vraie orientation de la bouffée)
          vUv = position.xy + 0.5; vC = aC; vWP = wp; vRight = right * c + up * s; vUp = up * c - right * s;
          vNear = smoothstep(0.5, 3.0, distance(wp, uCamPos));
          #ifdef SMOKE
          vS = aS;
          // fondu quand la caméra entre dans une bouffée
          vNear = smoothstep(0.15, 0.6, distance(wp, uCamPos) / aP.w);
          #endif
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        uniform sampler2D tPuff; uniform float uLit; uniform float uDensity;
        varying vec2 vUv; varying vec4 vC; varying vec3 vWP; varying vec3 vRight; varying vec3 vUp; varying float vNear;
        #ifdef SMOKE
        varying vec2 vS;
        #endif
        void main() {
          vec4 tx = texture2D(tPuff, vUv);
          float a = tx.a * vC.a * vNear * uDensity;
          if (a < 0.004) discard;
          vec2 q = vUv * 2.0 - 1.0;
          float z = sqrt(max(0.0, 1.0 - dot(q, q)));
          vec3 toC = normalize(uCamPos - vWP);
          #ifdef SMOKE
          // panache : boule + relief des volutes, ombre propre calculée sur le processeur (vS.x),
          // occlusion du ciel au cœur du panache (vS.y), diffusion vers l'avant sur les bords minces
          vec2 gr = (tx.rg - 0.5) * 2.0;
          vec3 n = normalize(vRight * (q.x * 0.55 + gr.x) + vUp * (q.y * 0.55 + gr.y) + toC * (z * 0.7 + 0.3));
          float w = clamp(dot(n, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
          float ndl = w * w * 1.5;
          float fwd = pow(max(dot(-toC, uSunDir), 0.0), 5.0) * (1.2 - a);
          float sunVis = vS.x * mix(0.35, 1.0, w);
          vec3 light = uSunColor * sunVis * (ndl + fwd * 1.6) / 3.14159
                     + uSkyAmb * vS.y * (0.55 + 0.45 * n.y) * 1.15
                     + uSunColor * max(uSunDir.y, 0.0) * 0.012 * (1.0 - n.y); // rebond du sol sous le panache
          vec3 col = vC.rgb * light;
          #else
          vec3 n = normalize(vRight * q.x + vUp * q.y + toC * z);
          vec4 lt = lightAt(vWP);
          float sv = mix(1.0, lt.r * lt.b, step(-900.0, vWP.y));
          float ndl = max(dot(n, uSunDir) * 0.6 + 0.4, 0.0);
          float fwd = pow(max(dot(-toC, uSunDir), 0.0), 6.0);
          vec3 light = uSunColor * sv * (ndl + fwd * 1.5) / 3.14159 + uSkyAmb * (0.6 + 0.4 * n.y);
          vec3 col = mix(vC.rgb, vC.rgb * light, uLit);
          #endif
          col = applyAerial(col, vWP);
          gl_FragColor = vec4(col * a, a);
        }`,
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.order ?? 30;
    this.sort = !!opts.sort;
    scene.add(this.mesh);
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, a0, r, g, b) {
    let i = this.n < this.max ? this.n++ : (this.cursor = ((this.cursor || 0) + 1) % this.max);
    this.P[i * 3] = x; this.P[i * 3 + 1] = y; this.P[i * 3 + 2] = z;
    this.Vv[i * 3] = vx; this.Vv[i * 3 + 1] = vy; this.Vv[i * 3 + 2] = vz;
    this.life[i] = 0; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b; this.rot[i] = Math.random() * 6.28;
    this.sh[i * 2] = 0.8; this.sh[i * 2 + 1] = 0.8;
    return i;
  }
  // taille et opacité courantes d'une particule (t = âge / durée de vie)
  size(i) { return lerp(this.s0[i], this.s1[i], Math.sqrt(this.life[i] / this.maxLife[i])); }
  alpha(i) {
    const t = this.life[i] / this.maxLife[i];
    // fumée : opaque longtemps puis se dissipe doucement en s'étalant
    return this.smoke ? this.a0[i] * Math.min(1, t * this.fadeIn) * (1 - smoothstep(0.35, 1, t)) * (1 - 0.25 * t)
      : this.a0[i] * Math.min(1, t * this.fadeIn) * (1 - t) * (1 - t * 0.3);
  }
  update(dt, cam, fn) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) continue;
      if (w !== i) {
        for (let k = 0; k < 3; k++) { this.P[w * 3 + k] = this.P[i * 3 + k]; this.Vv[w * 3 + k] = this.Vv[i * 3 + k]; this.col[w * 3 + k] = this.col[i * 3 + k]; }
        this.life[w] = this.life[i]; this.maxLife[w] = this.maxLife[i]; this.s0[w] = this.s0[i]; this.s1[w] = this.s1[i]; this.a0[w] = this.a0[i]; this.rot[w] = this.rot[i];
        this.sh[w * 2] = this.sh[i * 2]; this.sh[w * 2 + 1] = this.sh[i * 2 + 1];
      }
      fn(w, dt);
      w++;
    }
    this.n = w;
    if (this.onShade) this.onShade(w);
    let order = null;
    if (this.sort) {
      order = Array.from({ length: w }, (_, i) => i);
      const d = order.map((i) => (this.P[i * 3] - cam.x) ** 2 + (this.P[i * 3 + 1] - cam.y) ** 2 + (this.P[i * 3 + 2] - cam.z) ** 2);
      order.sort((a, b) => d[b] - d[a]);
    }
    const A = this.aP.array, C = this.aC.array, R = this.aR.array, S = this.aS ? this.aS.array : null;
    for (let k = 0; k < w; k++) {
      const i = order ? order[k] : k, t = this.life[i] / this.maxLife[i];
      A[k * 4] = this.P[i * 3]; A[k * 4 + 1] = this.P[i * 3 + 1]; A[k * 4 + 2] = this.P[i * 3 + 2];
      A[k * 4 + 3] = this.size(i);
      C[k * 4] = this.col[i * 3]; C[k * 4 + 1] = this.col[i * 3 + 1]; C[k * 4 + 2] = this.col[i * 3 + 2];
      C[k * 4 + 3] = this.alpha(i);
      R[k] = this.rot[i] + t * (this.smoke ? 0.25 : 0.6);
      if (S) { S[k * 2] = this.sh[i * 2]; S[k * 2 + 1] = this.sh[i * 2 + 1]; }
    }
    this.geo.instanceCount = w;
    this.aP.needsUpdate = this.aC.needsUpdate = this.aR.needsUpdate = true;
    if (this.aS) this.aS.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, terrain, world) {
    this.T = terrain; this.world = world;
    const tex = puffTexture();
    // panache : même nombre de particules, mais grosses bouffées éclairées (ombre propre, relief des volutes)
    this.smoke = new Particles(scene, 90, smokeTexture(), { sort: true, order: 31, smoke: true, fadeIn: 40 });
    this.smoke.onShade = (n) => this.shadeSmoke(n);
    this.shadeT = 0;
    this.mist = new Particles(scene, 70, tex, { sort: true, order: 32 });
    this.spray = new Particles(scene, 260, tex, { order: 33 });
    this.sandP = new Particles(scene, 500, tex, { order: 34 });
    this.rain = new Particles(scene, 700, tex, { order: 35, lit: 0.6 });
    const v = world.volcano;
    this.crater = new THREE.Vector3(v.x, terrain.height(v.x, v.z) + 6, v.z);
    const lip = world.waterfall.lip, pool = world.waterfall.pool, dir = world.waterfall.dir;
    this.impact = new THREE.Vector3(lip[0] + dir[0] * 6.2, pool[1], lip[2] + dir[1] * 6.2);
    this.rnd = mulberry32(3);
    this.tSmoke = 0; this.tMist = 0;
    this.smokeT = 0;
    // pré-remplissage du panache (du plus vieux au plus jeune)
    for (let k = 86; k >= 0; k--) { const i = this.emitSmoke(); this.smoke.life[i] = k * SMOKE_DT; this.advance(i, k * SMOKE_DT); }
    this.shadeSmoke(this.smoke.n, true);
  }
  emitSmoke() {
    const r = this.rnd, c = this.crater;
    // vapeur et cendres : gris clair, un peu plus sombre par bouffées
    const g = (r() < 0.2 ? 0.72 : 0.88) + r() * 0.08;
    // la colonne serpente lentement
    const sway = Math.sin(this.smokeT * 0.07) * 1.2, sway2 = Math.cos(this.smokeT * 0.05) * 1.2;
    return this.smoke.emit(c.x + (r() - 0.5) * 24, c.y, c.z + (r() - 0.5) * 24, (r() - 0.5) * 2.2 + sway, 9 + r() * 4, (r() - 0.5) * 2.2 + sway2,
      70 + r() * 20, 48 + r() * 18, 230 + r() * 80, 0.62 + r() * 0.2, g, g * 0.985, g * 0.965);
  }
  // Mouvement du panache : poussée qui s'essouffle avec l'altitude (la colonne monte droit),
  // puis le vent l'emporte de plus en plus fort et le couche à l'horizontale.
  advance(i, t) {
    const P = this.smoke.P, Vv = this.smoke.Vv, c = this.crater;
    const wd = U.uWindDir.value;
    while (t > 1e-4) {
      const h = Math.min(t, 0.5); t -= h;
      const z = Math.max(0, P[i * 3 + 1] - c.y);
      const lift = Math.exp(-z / 170);
      const wind = 0.8 + 6.8 * smoothstep(40, 260, z);
      P[i * 3] += (Vv[i * 3] * lift + wd.x * wind) * h;
      P[i * 3 + 1] += (Vv[i * 3 + 1] * lift + 0.35) * h;
      P[i * 3 + 2] += (Vv[i * 3 + 2] * lift + wd.y * wind) * h;
    }
  }
  // Ombre propre du panache (bouffées situées entre la particule et le soleil) et occlusion du ciel
  // au cœur du panache. O(n²) sur ≤ 90 particules, recalculé ~6 fois par seconde.
  shadeSmoke(n, force) {
    if (!force && (this.shadeT -= 1) > 0) return;
    this.shadeT = 9;
    const sm = this.smoke, P = sm.P, sd = U.uSunDir.value;
    const S = this._sz || (this._sz = new Float32Array(sm.max)), A = this._al || (this._al = new Float32Array(sm.max));
    for (let i = 0; i < n; i++) { S[i] = sm.size(i); A[i] = sm.alpha(i); }
    for (let i = 0; i < n; i++) {
      let od = 0, occ = 0;
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dx = P[j * 3] - x, dy = P[j * 3 + 1] - y, dz = P[j * 3 + 2] - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const t = dx * sd.x + dy * sd.y + dz * sd.z;
        const rj = S[j] * 0.4;
        if (t > 0) { const p2 = d2 - t * t; if (p2 < rj * rj) od += A[j] * (1 - p2 / (rj * rj)); }
        const rr = (S[i] + S[j]) * 0.3;
        if (d2 < rr * rr) occ += A[j] * (1 - d2 / (rr * rr));
      }
      sm.sh[i * 2] = 0.12 + 0.88 * Math.exp(-od * 0.45);
      sm.sh[i * 2 + 1] = clamp(Math.exp(-occ * 0.08), 0.55, 1);
    }
  }
  sand(p, vel, amount, surface) {
    const r = this.rnd;
    let n = amount;
    const col = surface === 5 ? [0.32, 0.31, 0.3] : surface === 2 ? [0.42, 0.3, 0.2] : surface === 1 ? [0.5, 0.45, 0.36] : [0.72, 0.65, 0.52];
    while (n > 0) {
      if (r() > n) break;
      n -= 1;
      this.sandP.emit(p.x + (r() - 0.5) * 0.3, p.y + 0.1, p.z + (r() - 0.5) * 0.3, -vel.x * 0.25 + (r() - 0.5) * 1.8, 1.2 + r() * 2.2, -vel.z * 0.25 + (r() - 0.5) * 1.8, 0.7 + r() * 0.9, 0.18, 0.9 + r() * 0.8, 0.55, col[0], col[1], col[2]);
    }
  }
  // gerbe de particules : copeaux de bois, feuilles, poussière (chute d'un arbre)
  burst(p, n, col, spread = 2, up = 2, size = 0.12, life = 1.2) {
    const r = this.rnd;
    for (let k = 0; k < n; k++) {
      const v = 0.85 + r() * 0.3;
      this.sandP.emit(p.x + (r() - 0.5) * spread * 0.4, p.y + r() * 0.3, p.z + (r() - 0.5) * spread * 0.4,
        (r() - 0.5) * spread, up * (0.4 + r()), (r() - 0.5) * spread, life * (0.6 + r() * 0.8), size, size * (1.5 + r()), 0.85, col[0] * v, col[1] * v, col[2] * v);
    }
  }
  splash(p, vel, dt) {
    const r = this.rnd;
    const n = Math.min(4, vel.length() * dt * 8);
    for (let k = 0; k < n; k++) this.spray.emit(p.x + (r() - 0.5) * 0.5, 0.05, p.z + (r() - 0.5) * 0.5, vel.x * 0.3 + (r() - 0.5) * 2, 1.5 + r() * 2.5, vel.z * 0.3 + (r() - 0.5) * 2, 0.6 + r() * 0.5, 0.12, 0.55, 0.7, 0.92, 0.95, 0.97);
  }
  update(dt, camera, sky) {
    const r = this.rnd;
    if (dt <= 0) return;
    this.tSmoke += dt;
    this.smokeT += dt;
    while (this.tSmoke > SMOKE_DT) { this.tSmoke -= SMOKE_DT; this.emitSmoke(); }
    this.smoke.update(dt, camera.position, (i, h) => this.advance(i, h));
    // cascade : brume et gouttes (seulement si assez proche)
    const dImp = camera.position.distanceTo(this.impact);
    if (dImp < 900) {
      this.tMist += dt;
      while (this.tMist > 0.12) {
        this.tMist -= 0.12;
        const a = r() * 6.28;
        this.mist.emit(this.impact.x + Math.cos(a) * 2, this.impact.y + 0.5, this.impact.z + Math.sin(a) * 2, Math.cos(a) * 2.5, 1.2 + r() * 1.5, Math.sin(a) * 2.5, 5 + r() * 3, 3, 11 + r() * 5, 0.11, 0.86, 0.9, 0.93);
        for (let k = 0; k < 3; k++) { const b = r() * 6.28; this.spray.emit(this.impact.x + Math.cos(b) * 1.5, this.impact.y + 0.3, this.impact.z + Math.sin(b) * 1.5, Math.cos(b) * (2 + r() * 4), 3 + r() * 5, Math.sin(b) * (2 + r() * 4), 1 + r() * 0.6, 0.15, 0.4, 0.6, 0.95, 0.97, 1.0); }
      }
    }
    this.mist.update(dt, camera.position, (i, h) => { const P = this.mist.P, V = this.mist.Vv; P[i * 3] += V[i * 3] * h; P[i * 3 + 1] += V[i * 3 + 1] * h; P[i * 3 + 2] += V[i * 3 + 2] * h; V[i * 3] *= 1 - h * 0.4; V[i * 3 + 2] *= 1 - h * 0.4; });
    const grav = (sys, g, drag) => (i, h) => { const P = sys.P, V = sys.Vv; V[i * 3 + 1] -= g * h; V[i * 3] *= 1 - drag * h; V[i * 3 + 2] *= 1 - drag * h; P[i * 3] += V[i * 3] * h; P[i * 3 + 1] += V[i * 3 + 1] * h; P[i * 3 + 2] += V[i * 3 + 2] * h; };
    this.spray.update(dt, camera.position, grav(this.spray, 9.8, 0.3));
    this.sandP.update(dt, camera.position, grav(this.sandP, 3.5, 1.6));
    // pluie (orage)
    const rain = sky.rain || 0;
    if (rain > 0.01) {
      const c = camera.position;
      for (let k = 0; k < rain * 40 * dt * 60 / 4; k++) this.rain.emit(c.x + (r() - 0.5) * 60, c.y + 12 + r() * 10, c.z + (r() - 0.5) * 60, 1.5, -14, 0.8, 1.6, 0.05, 0.05, 0.5 * rain, 0.75, 0.78, 0.82);
    }
    this.rain.update(dt, camera.position, (i, h) => { const P = this.rain.P, V = this.rain.Vv; P[i * 3] += V[i * 3] * h; P[i * 3 + 1] += V[i * 3 + 1] * h; P[i * 3 + 2] += V[i * 3 + 2] * h; });
  }
}
