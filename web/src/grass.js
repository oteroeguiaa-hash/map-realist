// Herbe dense autour de la caméra (touffes instanciées, placées et animées dans le shader).
import * as THREE from 'three';
import { patchMaterial, mulberry32 } from './core.js';
import { GLSL_HEIGHT } from './terrain.js';

const Q = [
  { R: 24, n: 5000 }, { R: 31, n: 8500 }, { R: 38, n: 13000 }, { R: 46, n: 19000 },
];

export class Grass {
  constructor(scene, terrain, q) {
    const rnd = mulberry32(99);
    // touffe : 4 brins effilés et courbés
    const pos = [], col = [], wind = [], nrm = [], idx = [];
    for (let k = 0; k < 3; k++) {
      const a = rnd() * Math.PI, ox = (rnd() - 0.5) * 0.12, oz = (rnd() - 0.5) * 0.12;
      const lean = (rnd() - 0.5) * 0.5, h = 0.6 + rnd() * 0.4, w = 0.03 + rnd() * 0.02;
      const dx = Math.cos(a), dz = Math.sin(a), lx = -dz, lz = dx;
      const base = pos.length / 3;
      for (let s = 0; s <= 3; s++) {
        const t = s / 3, ww = w * (1 - t * 0.9), bend = lean * t * t;
        for (const sg of [-1, 1]) {
          pos.push(ox + dx * ww * sg + lx * bend, t * h, oz + dz * ww * sg + lz * bend);
          col.push(0.45 + 0.55 * t, 0.45 + 0.55 * t, 0.45 + 0.55 * t);
          wind.push(t, k * 0.33);
          nrm.push(lx, 0.6, lz);
        }
      }
      for (let s = 0; s < 3; s++) { const a0 = base + s * 2; idx.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2); }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 2));
    g.setIndex(idx);
    const MAXN = Q[3].n;
    const seeds = new Float32Array(MAXN * 3);
    for (let i = 0; i < MAXN; i++) { seeds[i * 3] = rnd(); seeds[i * 3 + 1] = rnd(); seeds[i * 3 + 2] = rnd(); }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = g;
    this.uR = { value: 40 };
    this.uCenter = { value: new THREE.Vector2() };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    patchMaterial(mat, {
      key: 'grass', canopy: 0.45,
      afterLights: 'reflectedLight.indirectSpecular *= 0.12; reflectedLight.directSpecular *= 0.25;',
      uniforms: { uHeight: { value: terrain.heightTex }, uHN: { value: terrain.N }, uMaskTex: { value: terrain.maskTex }, uNormalTex: { value: terrain.normalTex }, uR: this.uR, uCenter: this.uCenter },
      vertexPars: GLSL_HEIGHT + '\nuniform sampler2D uMaskTex; uniform sampler2D uNormalTex; uniform float uR; uniform vec2 uCenter;\nattribute vec3 aSeed; attribute vec2 aWind;\nvarying float vDry;\n',
      fragmentPars: 'varying float vDry;\n',
    });
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, r) => {
      prev(shader, r);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', /* glsl */`
        vec2 S = vec2(uR * 2.0);
        vec2 base = uCenter - S * 0.5;
        vec2 p = base + fract((aSeed.xy * S - base) / S) * S;
        float h = terrainH(p);
        vec2 tuv = p / uWorldSize + 0.5;
        vec4 mk = texture(uMaskTex, tuv);
        vec3 nb = normalize(texture(uNormalTex, tuv).xyz * 2.0 - 1.0);
        float slope = 1.0 - nb.y;
        float beachTop = 1.9 + vnoise(p * 0.045) * 1.3 + vnoise(p * 0.0085 - 7.0) * 0.9;
        float dens = mk.b * 1.1
          + (1.0 - smoothstep(4.0, 11.0, h)) * smoothstep(beachTop + 0.1, beachTop + 1.0, h) * 0.95
          + smoothstep(0.55, 0.85, vnoise(p * 0.0085 - 7.0)) * 0.7
          + 0.22;
        dens *= (1.0 - smoothstep(190.0, 245.0, h) * 0.8) * (1.0 - smoothstep(0.26, 0.42, slope)) * (1.0 - mk.r) * step(beachTop + 0.05, h) * (1.0 - smoothstep(0.45, 0.85, mk.g));
        vec4 lt = lightAt(vec3(p.x, 0.0, p.y));
        dens *= 1.0 - lt.g * 0.65;
        float d = distance(p, uCamPos.xz);
        float sc = (0.35 + aSeed.z * 0.65) * mix(0.55, 1.15, vnoise(p * 0.11)) * (1.0 - smoothstep(uR * 0.72, uR, d));
        sc *= mix(1.0, 0.45, mk.b * smoothstep(0.85, 1.0, nb.y));
        if (aSeed.z > dens) sc = 0.0;
        float ang = aSeed.x * 61.0;
        mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
        vec3 transformed = vec3(0.0, position.y * sc, 0.0);
        transformed.xz = rot * position.xz * (0.7 + sc * 0.6);
        float ph = aSeed.y * 6.28 + uTime * 1.7 + p.x * 0.15;
        float sway = (sin(ph) * 0.5 + 0.6) * uWind * aWind.x * aWind.x * sc;
        transformed.xz += uWindDir * sway * 0.35;
        transformed.y -= sway * sway * 0.1;
        transformed += vec3(p.x, h - 0.02, p.y);
        vDry = vnoise(p * 0.07 + 3.0) * 0.6 + (1.0 - smoothstep(beachTop + 0.3, beachTop + 3.0, h)) * 0.5 + smoothstep(150.0, 230.0, h) * 0.5;
      `);
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), 0.55));');
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec3 gA = vec3(0.045, 0.09, 0.02), gB = vec3(0.13, 0.19, 0.045), gD = vec3(0.24, 0.21, 0.09);
        diffuseColor.rgb = mix(mix(gA, gB, smoothstep(0.3, 1.0, vColor.g)), gD, clamp(vDry - 0.25, 0.0, 1.0) * smoothstep(0.5, 1.0, vColor.g)) * 1.35;`);
    };
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.setQuality(q);
  }
  setQuality(q) { const c = Q[q] || Q[1]; this.uR.value = c.R; this.geo.instanceCount = c.n; }
  update(camera) { this.uCenter.value.set(camera.position.x, camera.position.z); }
}
