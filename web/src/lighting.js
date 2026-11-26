// Texture d'éclairage du monde (512²) : R = ombre du relief, G = canopée, B = ombre des nuages.
import * as THREE from 'three';
import { U, WORLD } from './core.js';
import { GLSL_CLOUDS } from './sky.js';

export class WorldLight {
  constructor(renderer, terrain, sky) {
    this.renderer = renderer;
    this.terrain = terrain;
    const S = 512;
    const opts = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
    this.sunRT = new THREE.WebGLRenderTarget(S, S, opts);
    this.lightRT = new THREE.WebGLRenderTarget(S, S, opts);
    this.canopy = new THREE.DataTexture(new Uint8Array(S * S), S, S, THREE.RedFormat, THREE.UnsignedByteType);
    this.canopy.minFilter = this.canopy.magFilter = THREE.LinearFilter;
    this.canopy.unpackAlignment = 1;
    this.canopy.needsUpdate = true;
    U.uLightTex.value = this.lightRT.texture;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = (mat) => { const s = new THREE.Scene(); const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; s.add(m); return s; };
    this.sunScene = quad(new THREE.ShaderMaterial({
      uniforms: { uH: { value: terrain.heightLoTex }, uSunDir: U.uSunDir },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uH; uniform vec3 uSunDir; varying vec2 vUv;
        float H(vec2 xz) { return texture(uH, xz / ${WORLD.toFixed(1)} + 0.5).r; }
        void main() {
          vec2 xz = (vUv - 0.5) * ${WORLD.toFixed(1)};
          float h0 = H(xz) + 1.5;
          vec3 sd = normalize(uSunDir + vec3(0.0, 0.015, 0.0));
          vec2 dir = normalize(sd.xz + 1e-5);
          float tanA = sd.y / max(length(sd.xz), 1e-4);
          float vis = 1.0, t = 3.0;
          for (int i = 0; i < 44; i++) {
            vec2 p = xz + dir * t;
            if (abs(p.x) > 1024.0 || abs(p.y) > 1024.0) break;
            float rayH = h0 + t * tanA;
            if (rayH > 460.0) break;
            float d = rayH - H(p);
            vis = min(vis, clamp(d / (t * 0.035) + 0.5, 0.0, 1.0));
            t *= 1.12; t += 2.0;
          }
          vis *= smoothstep(-0.03, 0.05, uSunDir.y);
          gl_FragColor = vec4(vis, 0.0, 0.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    }));
    this.lightScene = quad(new THREE.ShaderMaterial({
      uniforms: { ...sky.cloudU, uSun: { value: this.sunRT.texture }, uCanopy: { value: this.canopy }, uSunDir: U.uSunDir, uTime: U.uTime },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uSun; uniform sampler2D uCanopy; uniform vec3 uSunDir; uniform float uTime;
        varying vec2 vUv;
        ${GLSL_CLOUDS}
        void main() {
          vec2 xz = (vUv - 0.5) * ${WORLD.toFixed(1)};
          float od = 0.0;
          vec3 sd = normalize(uSunDir + vec3(0.0, 0.05, 0.0));
          for (int i = 0; i < 4; i++) {
            float hh = mix(uCBot, uCTop, (float(i) + 0.5) / 4.0);
            vec2 p = xz + sd.xz / sd.y * hh;
            od += cloudDensity(vec3(p.x, hh - uCBot, p.y), (float(i) + 0.5) / 4.0, false);
          }
          float cs = exp(-od * (uCTop - uCBot) * 0.25 * 0.045 * 0.55);
          cs = mix(0.08, 1.0, cs);
          gl_FragColor = vec4(texture(uSun, vUv).r, texture(uCanopy, vUv).r, cs, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    }));
    this.timer = 0;
    this.sunDirty = true;
  }
  // Densité de canopée calculée depuis les arbres placés (x, z, rayon)
  setCanopy(trees) {
    const S = 512, a = new Float32Array(S * S), cell = WORLD / S;
    for (const t of trees) {
      const r = t.r / cell, cx = (t.x / WORLD + 0.5) * S, cz = (t.z / WORLD + 0.5) * S;
      const i0 = Math.max(0, Math.floor(cx - r)), i1 = Math.min(S - 1, Math.ceil(cx + r));
      const j0 = Math.max(0, Math.floor(cz - r)), j1 = Math.min(S - 1, Math.ceil(cz + r));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cz) / r;
        if (d < 1) a[j * S + i] += (1 - d * d) * 0.55;
      }
    }
    const d = this.canopy.image.data;
    for (let q = 0; q < S * S; q++) d[q] = Math.min(255, a[q] * 255);
    this.canopy.needsUpdate = true;
    this.timer = 1e9;
  }
  update(dt, sunMoved) {
    const r = this.renderer, prev = r.getRenderTarget();
    if (sunMoved || this.sunDirty) {
      r.setRenderTarget(this.sunRT); r.render(this.sunScene, this.cam);
      this.sunDirty = false;
      this.timer = 1e9;
    }
    this.timer += dt;
    if (this.timer > 0.25) {
      this.timer = 0;
      r.setRenderTarget(this.lightRT); r.render(this.lightScene, this.cam);
    }
    r.setRenderTarget(prev);
  }
}
