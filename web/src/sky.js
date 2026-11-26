// Ciel physique (diffusion Rayleigh/Mie), nuages volumétriques, soleil, éclairage d'ambiance.
import * as THREE from 'three';
import { U, clamp, lerp, smoothstep } from './core.js';

const R_PLANET = 6371e3, R_ATMOS = 6471e3;
const K_RLH = [5.5e-6, 13.0e-6, 22.4e-6], K_MIE = 21e-6, SH_RLH = 8e3, SH_MIE = 1.2e3, G_MIE = 0.758;
export const SUN_I = 20.0;

export const GLSL_ATMOS = /* glsl */`
const float R_PLANET = 6371e3;
const float R_ATMOS = 6471e3;
const vec3 K_RLH = vec3(5.5e-6, 13.0e-6, 22.4e-6);
const float K_MIE = 21e-6;
vec2 rsi(vec3 r0, vec3 rd, float sr) {
  float a = dot(rd, rd), b = 2.0 * dot(rd, r0), c = dot(r0, r0) - sr * sr;
  float d = b * b - 4.0 * a * c;
  if (d < 0.0) return vec2(1e5, -1e5);
  return vec2((-b - sqrt(d)) / (2.0 * a), (-b + sqrt(d)) / (2.0 * a));
}
vec3 atmosphere(vec3 r, vec3 pSun, float iSun) {
  vec3 r0 = vec3(0.0, R_PLANET + 30.0, 0.0);
  vec2 p = rsi(r0, r, R_ATMOS);
  if (p.x > p.y) return vec3(0.0);
  p.y = min(p.y, rsi(r0, r, R_PLANET).x > 0.0 ? rsi(r0, r, R_PLANET).x : p.y);
  const int IS = 12, JS = 4;
  float iStep = (p.y - max(p.x, 0.0)) / float(IS);
  float iTime = max(p.x, 0.0);
  vec3 tR = vec3(0.0), tM = vec3(0.0);
  float oR = 0.0, oM = 0.0;
  float mu = dot(r, pSun), mumu = mu * mu, g = 0.758, gg = g * g;
  float pR = 3.0 / (16.0 * 3.14159265) * (1.0 + mumu);
  float pM = 3.0 / (8.0 * 3.14159265) * ((1.0 - gg) * (mumu + 1.0)) / (pow(1.0 + gg - 2.0 * mu * g, 1.5) * (2.0 + gg));
  for (int i = 0; i < IS; i++) {
    vec3 ip = r0 + r * (iTime + iStep * 0.5);
    float ih = length(ip) - R_PLANET;
    float dR = exp(-ih / 8e3) * iStep, dM = exp(-ih / 1.2e3) * iStep;
    oR += dR; oM += dM;
    float jStep = rsi(ip, pSun, R_ATMOS).y / float(JS);
    float jR = 0.0, jM = 0.0, jt = 0.0;
    for (int j = 0; j < JS; j++) {
      vec3 jp = ip + pSun * (jt + jStep * 0.5);
      float jh = length(jp) - R_PLANET;
      jR += exp(-jh / 8e3) * jStep; jM += exp(-jh / 1.2e3) * jStep;
      jt += jStep;
    }
    vec3 at = exp(-(K_MIE * (oM + jM) + K_RLH * (oR + jR)));
    tR += dR * at; tM += dM * at;
    iTime += iStep;
  }
  return iSun * (pR * K_RLH * tR + pM * K_MIE * tM);
}
`;

// Densité des nuages (partagée avec le calcul des ombres de nuages)
export const GLSL_CLOUDS = /* glsl */`
precision highp sampler3D;
uniform sampler3D uShape;
uniform sampler3D uDetail;
uniform sampler2D uWeather;
uniform float uCoverage;
uniform float uCloudDens;
uniform vec2 uWindOff;
uniform float uCBot;
uniform float uCTop;
float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
float cloudDensity(vec3 p, float hf, bool detail) {
  vec2 wuv = (p.xz + uWindOff) / 26000.0;
  vec2 wm = texture(uWeather, wuv).rg;
  float cov = clamp(wm.r + (uCoverage - 0.5) * 1.15, 0.0, 1.0);
  float top = mix(0.42, 1.0, wm.g * (0.4 + uCoverage * 0.8));
  float hg = smoothstep(0.0, 0.1, hf) * (1.0 - smoothstep(top * 0.55, top, hf));
  vec3 sp = (p + vec3(uWindOff.x, 0.0, uWindOff.y)) / 5200.0;
  vec2 sn = texture(uShape, sp).rg;
  float shape = sn.r * 0.75 + sn.g * 0.25;
  float base = remap(shape * hg, 1.0 - cov, 1.0, 0.0, 1.0) * cov;
  if (base <= 0.0) return 0.0;
  if (detail) {
    float dn = texture(uDetail, p / 1100.0 + vec3(uTime * 0.002)).r;
    float dm = mix(dn, 1.0 - dn, clamp(hf * 4.0, 0.0, 1.0));
    base = remap(base, dm * 0.32, 1.0, 0.0, 1.0);
  }
  return max(base, 0.0) * uCloudDens;
}
`;

function rsi(r0, rd, sr) {
  const a = rd[0] * rd[0] + rd[1] * rd[1] + rd[2] * rd[2];
  const b = 2 * (rd[0] * r0[0] + rd[1] * r0[1] + rd[2] * r0[2]);
  const c = r0[0] * r0[0] + r0[1] * r0[1] + r0[2] * r0[2] - sr * sr;
  const d = b * b - 4 * a * c;
  if (d < 0) return [1e5, -1e5];
  return [(-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a)];
}
// Transmittance du soleil depuis le sol
function sunTransmittance(sun) {
  const r0 = [0, R_PLANET + 30, 0];
  const t = rsi(r0, sun, R_ATMOS)[1];
  if (sun[1] < -0.08) return [0, 0, 0];
  const n = 40, st = t / n;
  let oR = 0, oM = 0;
  for (let i = 0; i < n; i++) {
    const p = [r0[0] + sun[0] * st * (i + 0.5), r0[1] + sun[1] * st * (i + 0.5), r0[2] + sun[2] * st * (i + 0.5)];
    const h = Math.hypot(p[0], p[1], p[2]) - R_PLANET;
    if (h < 0) return [0, 0, 0];
    oR += Math.exp(-h / SH_RLH) * st; oM += Math.exp(-h / SH_MIE) * st;
  }
  return K_RLH.map((k) => Math.exp(-(k * oR + K_MIE * 1.1 * oM)));
}
// Même modèle que le GLSL, pour calculer quelques couleurs côté CPU
function atmosphere(r, sun, iSun) {
  const r0 = [0, R_PLANET + 30, 0];
  const p = rsi(r0, r, R_ATMOS);
  const g = rsi(r0, r, R_PLANET);
  let end = p[1];
  if (g[0] > 0) end = Math.min(end, g[0]);
  const IS = 16, JS = 6, st = end / IS;
  let oR = 0, oM = 0; const tR = [0, 0, 0], tM = [0, 0, 0];
  const mu = r[0] * sun[0] + r[1] * sun[1] + r[2] * sun[2], gg = G_MIE * G_MIE;
  const pR = 3 / (16 * Math.PI) * (1 + mu * mu);
  const pM = 3 / (8 * Math.PI) * ((1 - gg) * (mu * mu + 1)) / (Math.pow(1 + gg - 2 * mu * G_MIE, 1.5) * (2 + gg));
  for (let i = 0; i < IS; i++) {
    const ip = [r0[0] + r[0] * st * (i + 0.5), r0[1] + r[1] * st * (i + 0.5), r0[2] + r[2] * st * (i + 0.5)];
    const ih = Math.hypot(ip[0], ip[1], ip[2]) - R_PLANET;
    const dR = Math.exp(-ih / SH_RLH) * st, dM = Math.exp(-ih / SH_MIE) * st;
    oR += dR; oM += dM;
    const js = rsi(ip, sun, R_ATMOS)[1] / JS;
    let jR = 0, jM = 0;
    for (let j = 0; j < JS; j++) {
      const jp = [ip[0] + sun[0] * js * (j + 0.5), ip[1] + sun[1] * js * (j + 0.5), ip[2] + sun[2] * js * (j + 0.5)];
      const jh = Math.hypot(jp[0], jp[1], jp[2]) - R_PLANET;
      jR += Math.exp(-jh / SH_RLH) * js; jM += Math.exp(-jh / SH_MIE) * js;
    }
    for (let c = 0; c < 3; c++) {
      const at = Math.exp(-(K_MIE * (oM + jM) + K_RLH[c] * (oR + jR)));
      tR[c] += dR * at; tM[c] += dM * at;
    }
  }
  return [0, 1, 2].map((c) => iSun * (pR * K_RLH[c] * tR[c] + pM * K_MIE * tM[c]));
}

// Position du soleil (latitude 17° S, fin novembre)
export function sunDirection(hour) {
  const lat = -17 * Math.PI / 180, dec = -20 * Math.PI / 180, H = (hour - 12) * 15 * Math.PI / 180;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(sinAlt);
  // vecteur dans le repère local : est (x), nord (-z), haut (y)
  const east = -Math.cos(dec) * Math.sin(H);
  const north = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(H);
  const v = new THREE.Vector3(east, sinAlt, -north);
  v.y = sinAlt; const horiz = Math.hypot(east, north) || 1;
  v.x = east / horiz * Math.cos(alt); v.z = -north / horiz * Math.cos(alt);
  return v.normalize();
}

export class Sky {
  constructor(renderer, cloudBuf, quality) {
    this.renderer = renderer;
    this.hour = 16.2;
    this.weather = 0.35;
    this.windOff = new THREE.Vector2();
    this.faceIdx = 0;
    this.pmremTimer = 0;
    this.dirty = true;
    const size = [192, 256, 320, 384][quality] || 256;
    this.cubeRT = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    // textures de bruit
    const b = new Uint8Array(cloudBuf);
    const S = 64, D = 32, WM = 256;
    const shape = new THREE.Data3DTexture(b.slice(0, S * S * S * 2), S, S, S);
    shape.format = THREE.RGFormat; shape.type = THREE.UnsignedByteType;
    const detail = new THREE.Data3DTexture(b.slice(S * S * S * 2, S * S * S * 2 + D * D * D), D, D, D);
    detail.format = THREE.RedFormat; detail.type = THREE.UnsignedByteType;
    for (const t of [shape, detail]) {
      t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.needsUpdate = true;
    }
    const wo = S * S * S * 2 + D * D * D;
    const weather = new THREE.DataTexture(b.slice(wo, wo + WM * WM * 2), WM, WM, THREE.RGFormat, THREE.UnsignedByteType);
    weather.wrapS = weather.wrapT = THREE.RepeatWrapping; weather.minFilter = weather.magFilter = THREE.LinearFilter; weather.unpackAlignment = 1; weather.needsUpdate = true;
    this.cloudU = {
      uShape: { value: shape }, uDetail: { value: detail }, uWeather: { value: weather },
      uCoverage: { value: 0.4 }, uCloudDens: { value: 1 }, uWindOff: { value: this.windOff },
      uCBot: { value: 1500 }, uCTop: { value: 3800 },
    };
    this.faceU = {
      uFace: { value: 0 }, uSize: { value: size }, uSunI: { value: SUN_I },
      uSunCloud: { value: new THREE.Color() }, uAmbTop: { value: new THREE.Color() }, uAmbBot: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() }, uSteps: { value: [24, 32, 40, 48][quality] || 32 },
    };
    const faceMat = new THREE.ShaderMaterial({
      uniforms: { ...this.faceU, ...this.cloudU, uSunDir: U.uSunDir, uCamPos: U.uCamPos, uTime: U.uTime },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        precision highp float;
        uniform int uFace; uniform float uSize; uniform float uSunI; uniform vec3 uSunDir; uniform vec3 uCamPos; uniform float uTime;
        uniform vec3 uSunCloud; uniform vec3 uAmbTop; uniform vec3 uAmbBot; uniform vec3 uGround; uniform float uSteps;
        ${GLSL_ATMOS}
        ${GLSL_CLOUDS}
        float hg(float c, float g) { float gg = g * g; return (1.0 - gg) / (4.0 * 3.14159 * pow(1.0 + gg - 2.0 * g * c, 1.5)); }
        float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        vec3 faceDir(vec2 fc) {
          vec2 st = fc / uSize * 2.0 - 1.0;
          float s = st.x, t = st.y;
          if (uFace == 0) return vec3(1.0, -t, -s);
          if (uFace == 1) return vec3(-1.0, -t, s);
          if (uFace == 2) return vec3(s, 1.0, t);
          if (uFace == 3) return vec3(s, -1.0, -t);
          if (uFace == 4) return vec3(s, -t, 1.0);
          return vec3(-s, -t, -1.0);
        }
        void main() {
          vec3 d = normalize(faceDir(gl_FragCoord.xy));
          vec3 sky;
          if (d.y > 0.03) {
            sky = atmosphere(d, uSunDir, uSunI);
          } else {
            // près et sous l'horizon : brume claire puis mer (utile pour l'éclairage indirect)
            vec3 hz = atmosphere(normalize(vec3(d.x, 0.03, d.z)), uSunDir, uSunI);
            sky = mix(hz, uGround, smoothstep(0.0, -0.3, d.y));
          }
          float T = 1.0;
          vec3 L = vec3(0.0);
          if (d.y > 0.0 && uCoverage > 0.02) {
            vec3 o = vec3(0.0, 6360e3 + max(uCamPos.y, 0.0), 0.0);
            vec2 a = rsi(o, d, 6360e3 + uCBot), b = rsi(o, d, 6360e3 + uCTop);
            float t0 = a.y, t1 = min(b.y, t0 + 30000.0);
            if (t0 < 90000.0) {
              float steps = uSteps * mix(1.0, 0.6, smoothstep(0.0, 0.4, d.y));
              float dt = (t1 - t0) / steps;
              float t = t0 + dt * ign(gl_FragCoord.xy);
              float cosT = dot(d, uSunDir);
              float ph = mix(hg(cosT, 0.75), hg(cosT, -0.2), 0.35) * 4.0 * 3.14159;
              float firstHit = -1.0;
              for (int i = 0; i < 64; i++) {
                if (float(i) >= steps || T < 0.03) break;
                vec3 q = o + d * t;
                float hf = (length(q) - 6360e3 - uCBot) / (uCTop - uCBot);
                vec3 pw = vec3(q.x + uCamPos.x, 0.0, q.z + uCamPos.z);
                float dens = cloudDensity(vec3(pw.x, hf * (uCTop - uCBot), pw.z), hf, true);
                if (dens > 0.003) {
                  if (firstHit < 0.0) firstHit = t;
                  // marche vers le soleil
                  float od = 0.0, ls = 90.0;
                  vec3 lp = vec3(pw.x, hf * (uCTop - uCBot), pw.z);
                  for (int j = 0; j < 5; j++) {
                    lp += uSunDir * ls;
                    float lh = lp.y / (uCTop - uCBot);
                    if (lh > 1.0) break;
                    od += cloudDensity(lp, lh, j < 2) * ls;
                    ls *= 1.7;
                  }
                  float sig = 0.045;
                  float Ts = exp(-od * sig) + 0.4 * exp(-od * sig * 0.22) + 0.15 * exp(-od * sig * 0.06);
                  float powder = 1.0 - exp(-dens * sig * 320.0);
                  vec3 sunL = uSunCloud * Ts * ph * mix(0.55, 1.0, powder);
                  vec3 amb = mix(uAmbBot, uAmbTop, clamp(hf, 0.0, 1.0)) * mix(0.8, 1.0, powder);
                  vec3 S = (sunL + amb) * 0.92;
                  float se = dens * sig;
                  float Tst = exp(-se * dt);
                  L += T * (S - S * Tst);
                  T *= Tst;
                }
                t += dt;
              }
              if (firstHit > 0.0) {
                float fade = clamp(exp(-(firstHit - 2000.0) / 38000.0), 0.0, 1.0);
                L *= fade;
                T = mix(1.0, T, fade);
              }
            }
          }
          gl_FragColor = vec4(sky * T + L, T);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.faceScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), faceMat);
    quad.frustumCulled = false;
    this.faceScene.add(quad);
    this.faceCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // dôme
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
      uniforms: { uCube: { value: this.cubeRT.texture }, uSunDir: U.uSunDir, uSunColor: U.uSunColor, uCamPos: U.uCamPos, uSkyAmb: U.uSkyAmb },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
      fragmentShader: /* glsl */`
        uniform samplerCube uCube; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uCamPos; uniform vec3 uSkyAmb;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec4 c = textureLod(uCube, d, 0.0);
          float ca = dot(d, uSunDir);
          float r = 0.0062;
          float disk = smoothstep(cos(r), cos(r * 0.8), ca);
          float limb = 0.6 + 0.4 * sqrt(max(0.0, 1.0 - (1.0 - ca) / (1.0 - cos(r))));
          vec3 col = c.rgb + uSunColor * c.a * (disk * limb * 2200.0 + pow(max(ca, 0.0), 1500.0) * 6.0 + pow(max(ca, 0.0), 60.0) * 0.04) * step(-0.01, d.y);
          if (uCamPos.y < 0.0) col = (uSunColor * max(uSunDir.y, 0.0) + uSkyAmb * 3.14159) * vec3(0.0006, 0.0075, 0.0105);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    }));
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.dome.scale.setScalar(1000);
    this.dome.onBeforeRender = (r, s, cam) => { this.dome.position.copy(cam.position); };
    this.sunLightColor = new THREE.Color();
    this.sunIntensity = 1;
  }

  setHour(h) { this.hour = h; this.dirty = true; }
  setWeather(w) { this.weather = w; this.dirty = true; }

  // Met à jour soleil, couleurs d'ambiance, brume et paramètres des nuages
  computeLighting() {
    const sd = sunDirection(this.hour);
    U.uSunDir.value.copy(sd);
    const s = [sd.x, Math.max(sd.y, -0.05), sd.z];
    const T = sunTransmittance(s);
    const w = this.weather;
    // nuages
    const cov = lerp(0.12, 0.98, smoothstep(0, 1, w));
    this.cloudU.uCoverage.value = cov;
    this.cloudU.uCloudDens.value = lerp(0.9, 1.6, smoothstep(0.5, 1, w));
    this.cloudU.uCBot.value = lerp(1500, 900, smoothstep(0.55, 1, w));
    this.cloudU.uCTop.value = lerp(3600, 5200, smoothstep(0.3, 0.9, w));
    const dayF = smoothstep(-0.06, 0.08, sd.y);
    const E = T.map((t) => t * SUN_I * dayF);
    U.uSunColor.value.setRGB(E[0], E[1], E[2]);
    // éclairement du ciel (moyenne sur l'hémisphère)
    const amb = [0, 0, 0];
    let wsum = 0;
    for (let i = 0; i < 18; i++) {
      const el = (i % 3) * 0.33 + 0.12, az = (Math.floor(i / 3) / 6) * Math.PI * 2;
      const dir = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
      const L = atmosphere(dir, s, SUN_I);
      const wgt = Math.sin(el) * Math.cos(el);
      for (let c = 0; c < 3; c++) amb[c] += L[c] * wgt;
      wsum += wgt;
    }
    for (let c = 0; c < 3; c++) amb[c] /= wsum;
    // ciel couvert : ambiance plus grise
    const gray = (amb[0] + amb[1] + amb[2]) / 3;
    const ovc = smoothstep(0.45, 1, w);
    for (let c = 0; c < 3; c++) amb[c] = lerp(amb[c], gray * 1.05 + E[c] * 0.012, ovc * 0.7);
    U.uSkyAmb.value.setRGB(amb[0], amb[1], amb[2]);
    // brume : horizon côté soleil / opposé
    let hx = s[0], hzz = s[2];
    const hl = Math.hypot(hx, hzz);
    if (hl < 1e-3) { hx = 1; hzz = 0; } else { hx /= hl; hzz /= hl; }
    const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const hz1 = atmosphere(nrm([hx, 0.035, hzz]), s, SUN_I);
    const hz2 = atmosphere(nrm([-hx, 0.035, -hzz]), s, SUN_I);
    U.uHazeSun.value.setRGB(lerp(hz1[0], gray, ovc * 0.6), lerp(hz1[1], gray, ovc * 0.6), lerp(hz1[2], gray, ovc * 0.6));
    U.uHazeColor.value.setRGB(lerp(hz2[0], gray, ovc * 0.6), lerp(hz2[1], gray, ovc * 0.6), lerp(hz2[2], gray, ovc * 0.6));
    U.uFogDensity.value = lerp(1.1e-4, 3.2e-4, smoothstep(0.55, 1, w));
    // couleurs pour les nuages
    const Tc = sunTransmittance([s[0], Math.max(s[1], 0.02) + 0.02, s[2]]);
    this.faceU.uSunCloud.value.setRGB(Tc[0] * SUN_I * dayF, Tc[1] * SUN_I * dayF, Tc[2] * SUN_I * dayF);
    this.faceU.uAmbTop.value.setRGB(amb[0] * 1.1, amb[1] * 1.1, amb[2] * 1.15);
    const gb = 0.08 * Math.max(sd.y, 0);
    this.faceU.uAmbBot.value.setRGB(E[0] * gb * 0.7 + amb[0] * 0.25, E[1] * gb * 0.8 + amb[1] * 0.3, E[2] * gb * 0.8 + amb[2] * 0.3);
    this.faceU.uGround.value.setRGB(E[0] * 0.006 * Math.max(sd.y, 0) + amb[0] * 0.08, E[1] * 0.012 * Math.max(sd.y, 0) + amb[1] * 0.14, E[2] * 0.014 * Math.max(sd.y, 0) + amb[2] * 0.18);
    // lumière directionnelle
    const sum = Math.max(E[0], E[1], E[2], 1e-4);
    this.sunLightColor.setRGB(E[0] / sum, E[1] / sum, E[2] / sum);
    this.sunIntensity = sum;
    this.rain = smoothstep(0.8, 0.95, w);
  }

  renderFace(i) {
    const r = this.renderer;
    this.faceU.uFace.value = i;
    const prevRT = r.getRenderTarget();
    r.setRenderTarget(this.cubeRT, i);
    r.render(this.faceScene, this.faceCam);
    r.setRenderTarget(prevRT);
  }

  update(dt, scene) {
    this.windOff.x += dt * 9 * (1 + this.weather);
    this.windOff.y += dt * 4;
    if (this.dirty) {
      this.computeLighting();
      for (let i = 0; i < 6; i++) this.renderFace(i);
      this.regenEnv(scene);
      this.dirty = false;
      return true;
    }
    this.renderFace(this.faceIdx);
    this.faceIdx = (this.faceIdx + 1) % 6;
    this.pmremTimer += dt;
    if (this.pmremTimer > 4) this.regenEnv(scene);
    return false;
  }

  regenEnv(scene) {
    this.pmremTimer = 0;
    const rt = this.pmrem.fromCubemap(this.cubeRT.texture, this.envRT || undefined);
    if (this.envRT && this.envRT !== rt) this.envRT.dispose();
    this.envRT = rt;
    scene.environment = rt.texture;
  }
}

export { clamp };
