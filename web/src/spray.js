// Éclaboussures réalistes : fines gouttelettes étirées dans le sens de leur vitesse (traînées),
// nappes d'embruns translucides et brume légère. Simulation sur le processeur (gravité, frottement de l'air),
// affichage en un seul appel de dessin (quads instanciés orientés vers la caméra).
import * as THREE from 'three';
import { U, GLSL_COMMON } from './core.js';

export class Spray {
  constructor(scene, max = 2600) {
    this.max = max; this.n = 0;
    this.P = new Float32Array(max * 3); this.V = new Float32Array(max * 3);
    this.L = new Float32Array(max); this.L0 = new Float32Array(max); this.S = new Float32Array(max); this.K = new Float32Array(max);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aP = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); // position + taille
    this.aV = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); // vitesse + âge relatif (0..1)
    this.aP.setUsage(THREE.DynamicDrawUsage); this.aV.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aP', this.aP); g.setAttribute('aV', this.aV);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U },
      vertexShader: /* glsl */`
        ${GLSL_COMMON}
        attribute vec4 aP; attribute vec4 aV;
        varying vec2 vUv; varying float vA; varying float vKind; varying vec3 vWP;
        void main() {
          float kind = step(0.5, fract(aV.w * 0.0) + floor(aP.w));  // partie entière de la taille = type (0 goutte, 1 brume)
          float size = fract(aP.w) * 2.0;
          vec3 c = aP.xyz;
          vec3 toCam = normalize(uCamPos - c);
          vec3 vel = aV.xyz;
          float sp = length(vel);
          // goutte : quad étiré le long de la vitesse vue de face ; brume : quad rond qui grossit
          vec3 ax = sp > 0.01 ? vel / sp : vec3(0.0, 1.0, 0.0);
          vec3 side = normalize(cross(ax, toCam) + 1e-5);
          float age = aV.w;
          float len = kind < 0.5 ? size * (1.0 + sp * 0.045) : size * (1.0 + age * 2.5);
          float wid = kind < 0.5 ? size * 0.35 : size * (1.0 + age * 2.5);
          vec3 up = kind < 0.5 ? ax : normalize(cross(side, toCam));
          vec3 wp = c + side * position.x * wid + up * position.y * len;
          vUv = position.xy; vKind = kind; vWP = wp;
          vA = kind < 0.5 ? (1.0 - age) : (1.0 - age) * 0.35;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        varying vec2 vUv; varying float vA; varying float vKind; varying vec3 vWP;
        void main() {
          float r = length(vUv);
          // goutte : cœur net et bords doux ; brume : très diffuse
          float a = vKind < 0.5 ? (1.0 - smoothstep(0.35, 1.0, r)) : (1.0 - smoothstep(0.0, 1.0, r)) * (0.6 + 0.4 * vnoise(vWP.xz * 3.0 + vWP.y));
          a *= vA;
          if (a < 0.01) discard;
          vec4 lt = lightAt(vWP);
          vec3 light = uSunColor * max(uSunDir.y, 0.05) * lt.r * lt.b * 0.32 + uSkyAmb * 2.2;
          vec3 col = vec3(0.82, 0.9, 0.95) * light;
          gl_FragColor = vec4(applyAerial(col, vWP), a * (vKind < 0.5 ? 0.85 : 0.5));
        }`,
      transparent: true, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 7;
    scene.add(this.mesh);
  }
  emit(x, y, z, vx, vy, vz, life, size, kind) {
    let i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.P[i * 3] = x; this.P[i * 3 + 1] = y; this.P[i * 3 + 2] = z;
    this.V[i * 3] = vx; this.V[i * 3 + 1] = vy; this.V[i * 3 + 2] = vz;
    this.L[i] = life; this.L0[i] = life; this.S[i] = size; this.K[i] = kind;
  }
  // gerbe d'une roue : éventail de gouttes vers l'arrière et les côtés, nappe d'embruns, un peu de brume
  wheel(p, vel, speed, dt) {
    const R = Math.random, n = Math.min(90, Math.round(speed * speed * 0.09 * dt * 60));
    const vx = vel.x, vz = vel.z, l = Math.hypot(vx, vz) || 1, bx = -vx / l, bz = -vz / l, sx = -bz, sz = bx;
    for (let k = 0; k < n; k++) {
      const side = (R() - 0.5) * 2, back = 0.3 + R() * 0.9, up = 0.6 + R() * 1.4;
      const v = speed * (0.25 + R() * 0.45);
      this.emit(p.x + (R() - 0.5) * 0.3, p.y + 0.05, p.z + (R() - 0.5) * 0.3,
        vx * 0.35 + (bx * back + sx * side * 1.2) * v, up * v * 0.55, vz * 0.35 + (bz * back + sz * side * 1.2) * v,
        0.5 + R() * 0.7, 0.012 + R() * 0.03, 0);
    }
    if (R() < dt * speed * 1.5) this.emit(p.x, p.y + 0.3, p.z, vx * 0.3 + (R() - 0.5), 1 + R() * 1.5, vz * 0.3 + (R() - 0.5), 1.4 + R(), 0.35 + R() * 0.3, 1);
  }
  // éclaboussure d'un pas dans l'eau
  step(p, v) {
    const R = Math.random;
    for (let k = 0; k < 18 + v * 6; k++) {
      const a = R() * Math.PI * 2, s = 0.6 + R() * 1.4 + v * 0.3;
      this.emit(p.x, p.y, p.z, Math.cos(a) * s, 1.2 + R() * 1.8 + v * 0.2, Math.sin(a) * s, 0.35 + R() * 0.35, 0.008 + R() * 0.018, 0);
    }
    this.emit(p.x, p.y + 0.1, p.z, 0, 0.4, 0, 0.9, 0.18, 1);
  }
  update(dt) {
    if (!this.n || dt <= 0) { this.geo.instanceCount = 0; return; }
    const P = this.P, V = this.V, A = this.aP.array, B = this.aV.array;
    let m = 0;
    for (let i = 0; i < this.n; i++) {
      this.L[i] -= dt;
      if (this.L[i] <= 0) continue;
      const kind = this.K[i], drag = kind ? 1.6 : 0.35;
      V[i * 3 + 1] -= (kind ? 0.6 : 9.81) * dt;
      const f = Math.exp(-drag * dt);
      V[i * 3] *= f; V[i * 3 + 1] *= kind ? f : 1; V[i * 3 + 2] *= f;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      if (!kind && P[i * 3 + 1] < -0.05) { this.L[i] = 0; continue; } // la goutte retombe dans l'eau
      A[m * 4] = P[i * 3]; A[m * 4 + 1] = P[i * 3 + 1]; A[m * 4 + 2] = P[i * 3 + 2]; A[m * 4 + 3] = kind + Math.min(this.S[i], 0.99) * 0.5;
      B[m * 4] = V[i * 3]; B[m * 4 + 1] = V[i * 3 + 1]; B[m * 4 + 2] = V[i * 3 + 2]; B[m * 4 + 3] = 1 - this.L[i] / this.L0[i];
      m++;
    }
    // compacte les particules vivantes
    if (m < this.n * 0.6) {
      let w = 0;
      for (let i = 0; i < this.n; i++) if (this.L[i] > 0) {
        if (w !== i) { for (let c = 0; c < 3; c++) { P[w * 3 + c] = P[i * 3 + c]; V[w * 3 + c] = V[i * 3 + c]; } this.L[w] = this.L[i]; this.L0[w] = this.L0[i]; this.S[w] = this.S[i]; this.K[w] = this.K[i]; }
        w++;
      }
      this.n = w;
    }
    this.geo.instanceCount = m;
    this.aP.needsUpdate = true; this.aV.needsUpdate = true;
    this.aP.clearUpdateRanges(); this.aP.addUpdateRange(0, m * 4);
    this.aV.clearUpdateRanges(); this.aV.addUpdateRange(0, m * 4);
  }
}
