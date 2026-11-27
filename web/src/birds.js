// Nuées d'oiseaux lointains : des centaines d'oiseaux en une seule géométrie instanciée.
// Le battement des ailes est animé dans le shader (aucun calcul par oiseau côté processeur hors trajectoire).
import * as THREE from 'three';
import { U, GLSL_COMMON, mulberry32 } from './core.js';

export class BirdFlocks {
  constructor(scene, count = 220) {
    const rnd = mulberry32(99);
    // un oiseau : corps fin + deux ailes en deux segments (l'extrémité bat plus que la base)
    const P = [
      0, 0, -0.18, 0, 0.02, 0.22, 0.05, 0, 0,    -0.05, 0, 0, 0, 0.02, 0.22, 0, 0, -0.18, // corps
      0.04, 0, 0.06, 0.04, 0, -0.08, 0.45, 0, -0.02,   -0.04, 0, -0.08, -0.04, 0, 0.06, -0.45, 0, -0.02, // ailes (base)
      0.45, 0, -0.02, 0.04, 0, -0.08, 0.85, 0, -0.12,  -0.04, 0, -0.08, -0.45, 0, -0.02, -0.85, 0, -0.12, // bouts d'ailes
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    const flap = [];
    for (let i = 0; i < P.length / 3; i++) flap.push(Math.min(Math.abs(P[i * 3]) / 0.85, 1));
    g.setAttribute('aFlap', new THREE.Float32BufferAttribute(flap, 1));
    // par oiseau : centre de la boucle (xyz), rayon, vitesse angulaire, phase, taille
    const n = count, A = new Float32Array(n * 4), B = new Float32Array(n * 4);
    this.flocks = [];
    for (let f = 0; f < 9; f++) this.flocks.push({ ang: rnd() * Math.PI * 2, d: 60 + rnd() * 260, alt: 22 + rnd() * 70, r: 25 + rnd() * 60, dir: rnd() < 0.5 ? 1 : -1 });
    for (let i = 0; i < n; i++) {
      const fl = i % 9;
      A[i * 4] = fl; A[i * 4 + 1] = (rnd() - 0.5) * 18; A[i * 4 + 2] = (rnd() - 0.5) * 8; A[i * 4 + 3] = (rnd() - 0.5) * 18;
      B[i * 4] = rnd() * Math.PI * 2; B[i * 4 + 1] = 0.75 + rnd() * 0.6; B[i * 4 + 2] = 7 + rnd() * 3; B[i * 4 + 3] = rnd() * 6.28;
    }
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = null;
    ig.setAttribute('position', g.attributes.position);
    ig.setAttribute('aFlap', g.attributes.aFlap);
    ig.setAttribute('aA', new THREE.InstancedBufferAttribute(A, 4));
    ig.setAttribute('aB', new THREE.InstancedBufferAttribute(B, 4));
    ig.instanceCount = n;
    this.flockU = { value: Array.from({ length: 9 }, () => new THREE.Vector4()) };
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U, uFlocks: this.flockU },
      vertexShader: /* glsl */`
        ${GLSL_COMMON}
        attribute float aFlap; attribute vec4 aA; attribute vec4 aB;
        uniform vec4 uFlocks[9];
        varying vec3 vWP; varying float vShade;
        void main() {
          vec4 fl = uFlocks[int(aA.x + 0.5)];  // centre x, altitude, centre z, rayon (signé = sens)
          float dir = sign(fl.w), R = abs(fl.w);
          float ang = aB.x + uTime * dir * 9.0 / R * aB.y * 0.12;
          vec3 c = vec3(fl.x + cos(ang) * R, fl.y, fl.z + sin(ang) * R) + aA.yzw;
          c.y += sin(uTime * 0.4 + aB.w) * 3.0;
          vec3 fwd = normalize(vec3(-sin(ang) * dir, 0.0, cos(ang) * dir));
          vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
          // battement : rapide par moments, plané à d'autres
          float glide = smoothstep(-0.2, 0.6, sin(uTime * 0.37 + aB.w));
          float fl2 = sin(uTime * aB.z + aB.w) * mix(0.55, 0.08, glide);
          vec3 p = position;
          p.y += aFlap * fl2 * 0.9 * abs(p.x);
          float s = aB.y * 1.3;
          vec3 wp = c + (rgt * p.x + vec3(0.0, p.y, 0.0) - fwd * p.z) * s;
          // inclinaison dans le virage
          wp.y += p.x * s * 0.35 * dir;
          vWP = wp; vShade = 0.6 + 0.4 * aFlap;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        varying vec3 vWP; varying float vShade;
        void main() {
          vec3 col = vec3(0.05, 0.05, 0.055) * (uSkyAmb * 2.5 + uSunColor * max(uSunDir.y, 0.0) * 0.15) * vShade;
          gl_FragColor = vec4(applyAerial(col, vWP), 1.0);
        }`,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(ig, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  // les nuées suivent le joueur de loin (elles se déplacent lentement autour de lui)
  update(dt, cam) {
    for (let i = 0; i < this.flocks.length; i++) {
      const f = this.flocks[i];
      f.ang += dt * 0.01 * f.dir;
      const tx = cam.x + Math.cos(f.ang) * f.d, tz = cam.z + Math.sin(f.ang) * f.d;
      const v = this.flockU.value[i];
      if (v.w === 0) v.set(tx, f.alt + Math.max(cam.y, 0) * 0.3, tz, f.r * f.dir);
      v.x += (tx - v.x) * Math.min(1, dt * 0.05); v.z += (tz - v.z) * Math.min(1, dt * 0.05);
      v.y += (f.alt + Math.max(cam.y, 0) * 0.3 - v.y) * Math.min(1, dt * 0.1);
    }
  }
}
