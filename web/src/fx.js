// Particules : panache du volcan, brume et embruns de la cascade, sable et éclaboussures du buggy, pluie.
import * as THREE from 'three';
import { U, GLSL_COMMON, mulberry32, clamp, lerp } from './core.js';

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

class Particles {
  constructor(scene, max, tex, opts = {}) {
    this.max = max;
    this.n = 0;
    this.P = new Float32Array(max * 3); this.Vv = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max);
    this.col = new Float32Array(max * 3); this.rot = new Float32Array(max);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aP = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aR = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aP', this.aP); g.setAttribute('aC', this.aC); g.setAttribute('aR', this.aR);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U, tPuff: { value: tex }, uLit: { value: opts.lit ?? 1 }, uDensity: { value: opts.density ?? 1 } },
      vertexShader: /* glsl */`
        ${GLSL_COMMON}
        attribute vec4 aP; attribute vec4 aC; attribute float aR;
        varying vec2 vUv; varying vec4 vC; varying vec3 vWP; varying vec3 vRight; varying vec3 vUp; varying float vNear;
        void main() {
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float c = cos(aR), s = sin(aR);
          vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
          vec3 wp = aP.xyz + (right * q.x + up * q.y) * aP.w;
          vUv = position.xy + 0.5; vC = aC; vWP = wp; vRight = right; vUp = up;
          vNear = smoothstep(0.5, 3.0, distance(wp, uCamPos));
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        uniform sampler2D tPuff; uniform float uLit; uniform float uDensity;
        varying vec2 vUv; varying vec4 vC; varying vec3 vWP; varying vec3 vRight; varying vec3 vUp; varying float vNear;
        void main() {
          float a = texture2D(tPuff, vUv).a * vC.a * vNear * uDensity;
          if (a < 0.004) discard;
          vec2 q = vUv * 2.0 - 1.0;
          float z = sqrt(max(0.0, 1.0 - dot(q, q)));
          vec3 toC = normalize(uCamPos - vWP);
          vec3 n = normalize(vRight * q.x + vUp * q.y + toC * z);
          vec4 lt = lightAt(vWP);
          float sv = mix(1.0, lt.r * lt.b, step(-900.0, vWP.y));
          float ndl = max(dot(n, uSunDir) * 0.6 + 0.4, 0.0);
          float fwd = pow(max(dot(-toC, uSunDir), 0.0), 6.0);
          vec3 light = uSunColor * sv * (ndl + fwd * 1.5) / 3.14159 + uSkyAmb * (0.6 + 0.4 * n.y);
          vec3 col = mix(vC.rgb, vC.rgb * light, uLit);
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
  }
  update(dt, cam, fn) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) continue;
      if (w !== i) {
        for (let k = 0; k < 3; k++) { this.P[w * 3 + k] = this.P[i * 3 + k]; this.Vv[w * 3 + k] = this.Vv[i * 3 + k]; this.col[w * 3 + k] = this.col[i * 3 + k]; }
        this.life[w] = this.life[i]; this.maxLife[w] = this.maxLife[i]; this.s0[w] = this.s0[i]; this.s1[w] = this.s1[i]; this.a0[w] = this.a0[i]; this.rot[w] = this.rot[i];
      }
      fn(w, dt);
      w++;
    }
    this.n = w;
    let order = null;
    if (this.sort) {
      order = Array.from({ length: w }, (_, i) => i);
      const d = order.map((i) => (this.P[i * 3] - cam.x) ** 2 + (this.P[i * 3 + 1] - cam.y) ** 2 + (this.P[i * 3 + 2] - cam.z) ** 2);
      order.sort((a, b) => d[b] - d[a]);
    }
    const A = this.aP.array, C = this.aC.array, R = this.aR.array;
    for (let k = 0; k < w; k++) {
      const i = order ? order[k] : k, t = this.life[i] / this.maxLife[i];
      A[k * 4] = this.P[i * 3]; A[k * 4 + 1] = this.P[i * 3 + 1]; A[k * 4 + 2] = this.P[i * 3 + 2];
      A[k * 4 + 3] = lerp(this.s0[i], this.s1[i], Math.sqrt(t));
      C[k * 4] = this.col[i * 3]; C[k * 4 + 1] = this.col[i * 3 + 1]; C[k * 4 + 2] = this.col[i * 3 + 2];
      C[k * 4 + 3] = this.a0[i] * Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
      R[k] = this.rot[i] + t * 0.6;
    }
    this.geo.instanceCount = w;
    this.aP.needsUpdate = this.aC.needsUpdate = this.aR.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, terrain, world) {
    this.T = terrain; this.world = world;
    const tex = puffTexture();
    this.smoke = new Particles(scene, 90, tex, { sort: true, order: 31 });
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
    // pré-remplissage du panache
    for (let k = 0; k < 70; k++) { this.emitSmoke(); this.smoke.life[this.smoke.n - 1] = k * 0.9; this.advance(this.smoke.n - 1, k * 0.9); }
  }
  emitSmoke() {
    const r = this.rnd, c = this.crater;
    const g = 0.78 + r() * 0.12;
    this.smoke.emit(c.x + (r() - 0.5) * 50, c.y, c.z + (r() - 0.5) * 50, (r() - 0.5) * 1.5, 3.2 + r() * 2.2, (r() - 0.5) * 1.5, 60 + r() * 25, 28 + r() * 16, 120 + r() * 60, 0.55, g, g * 0.99, g * 0.97);
  }
  advance(i, t) {
    const P = this.smoke.P, Vv = this.smoke.Vv;
    const wd = U.uWindDir.value;
    P[i * 3] += (Vv[i * 3] + wd.x * 4.5) * t; P[i * 3 + 1] += Vv[i * 3 + 1] * t * 0.8; P[i * 3 + 2] += (Vv[i * 3 + 2] + wd.y * 4.5) * t;
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
  splash(p, vel, dt) {
    const r = this.rnd;
    const n = Math.min(4, vel.length() * dt * 8);
    for (let k = 0; k < n; k++) this.spray.emit(p.x + (r() - 0.5) * 0.5, 0.05, p.z + (r() - 0.5) * 0.5, vel.x * 0.3 + (r() - 0.5) * 2, 1.5 + r() * 2.5, vel.z * 0.3 + (r() - 0.5) * 2, 0.6 + r() * 0.5, 0.12, 0.55, 0.7, 0.92, 0.95, 0.97);
  }
  update(dt, camera, sky) {
    const r = this.rnd;
    if (dt <= 0) return;
    this.tSmoke += dt;
    while (this.tSmoke > 0.9) { this.tSmoke -= 0.9; this.emitSmoke(); }
    this.smoke.update(dt, camera.position, (i, h) => this.advance(i, h));
    // cascade : brume et gouttes (seulement si assez proche)
    const dImp = camera.position.distanceTo(this.impact);
    if (dImp < 900) {
      this.tMist += dt;
      while (this.tMist > 0.12) {
        this.tMist -= 0.12;
        const a = r() * 6.28;
        this.mist.emit(this.impact.x + Math.cos(a) * 2, this.impact.y + 0.5, this.impact.z + Math.sin(a) * 2, Math.cos(a) * 2.5, 1.2 + r() * 1.5, Math.sin(a) * 2.5, 5 + r() * 3, 3, 13 + r() * 6, 0.22, 0.95, 0.97, 1.0);
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
