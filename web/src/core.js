// Uniformes partagés, fonctions GLSL communes et utilitaires.
import * as THREE from 'three';

export const WORLD = 2048;

export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
  uSunColor: { value: new THREE.Color(1, 1, 1) },     // éclairement solaire au sol (avant ombres)
  uSkyAmb: { value: new THREE.Color(0.3, 0.4, 0.6) }, // éclairement du ciel (irradiance / PI)
  uHazeColor: { value: new THREE.Color(0.5, 0.6, 0.7) },
  uHazeSun: { value: new THREE.Color(0.9, 0.8, 0.6) },
  uFogDensity: { value: 1.3e-4 },
  uFogFalloff: { value: 1 / 700 },
  uCamPos: { value: new THREE.Vector3() },
  uLightTex: { value: null },
  uWorldSize: { value: WORLD },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6) },
  uWind: { value: 0.6 },
  uSigma: { value: new THREE.Vector3(0.42, 0.07, 0.05) }, // absorption de l'eau (1/m)
  uExposure: { value: 1 },
};

export const GLSL_COMMON = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uHazeColor;
uniform vec3 uHazeSun;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform vec3 uCamPos;
uniform sampler2D uLightTex;
uniform float uWorldSize;
uniform vec2 uWindDir;
uniform float uWind;
uniform vec3 uSigma;
vec4 lightAt(vec3 wp) { return texture(uLightTex, wp.xz / uWorldSize + 0.5); }
vec3 underwaterTint() { return (uSunColor * max(uSunDir.y, 0.0) + uSkyAmb * 3.14159) * vec3(0.0006, 0.0075, 0.0105); }
vec3 applyAerial(vec3 col, vec3 wp) {
  vec3 v = wp - uCamPos;
  float d = length(v);
  if (uCamPos.y < 0.0) {
    float pl = d * (wp.y < 0.0 ? 1.0 : clamp(-uCamPos.y / max(wp.y - uCamPos.y, 0.01), 0.0, 1.0));
    vec3 T = exp(-uSigma * pl * 1.15 - 0.018 * pl);
    return col * T + underwaterTint() * (1.0 - T);
  }
  vec3 dir = v / max(d, 1e-3);
  float a = uFogDensity * exp(-max(uCamPos.y, 0.0) * uFogFalloff);
  float b = uFogFalloff * v.y;
  float amt = a * d * (abs(b) > 1e-4 ? (1.0 - exp(-b)) / b : 1.0);
  float f = 1.0 - exp(-amt);
  float s = pow(max(dot(dir, uSunDir), 0.0), 6.0);
  return mix(col, mix(uHazeColor, uHazeSun, s), f);
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
`;

// Branche les uniformes partagés et injecte : position monde, ombres du relief et des nuages,
// occlusion sous la canopée, perspective aérienne. Options : wind, leaf, terrainAO.
export function patchMaterial(mat, opts = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    for (const k in U) shader.uniforms[k] = U[k];
    if (opts.uniforms) Object.assign(shader.uniforms, opts.uniforms);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + '\nvarying vec3 vWP;\n' + (opts.vertexPars || ''));
    if (opts.wind) {
      vs = vs.replace('#include <common>', '#include <common>\nattribute vec2 aWind;\n');
      vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
          mat3 im = mat3(instanceMatrix);
          #else
          mat3 im = mat3(1.0);
          #endif
          float flex = aWind.x;
          float ph = dot(ip.xz, vec2(0.071, 0.093)) + aWind.y * 6.2831;
          float gust = 0.55 + 0.45 * sin(uTime * 0.35 + ip.x * 0.011 + ip.z * 0.007);
          vec3 wd = vec3(uWindDir.x, 0.0, uWindDir.y);
          vec3 lw = transpose(im) * wd;
          lw /= max(dot(lw, lw), 1e-4);
          float sway = (sin(uTime * 1.3 + ph) * 0.55 + gust * 0.9) * flex * flex * uWind;
          transformed += lw * sway * ${opts.windAmp || '0.35'};
          transformed.y -= abs(sway) * 0.04;
          transformed += objectNormal * sin(uTime * 5.3 + ph * 7.0) * flex * 0.035 * uWind;
        }`);
    }
    vs = vs.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      {
        vec4 wq = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        wq = instanceMatrix * wq;
        #endif
        wq = modelMatrix * wq;
        vWP = wq.xyz;
      }`);
    if (opts.vertexMain) vs = vs.replace('#include <fog_vertex>', '#include <fog_vertex>\n' + opts.vertexMain);
    fs = fs.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + '\nvarying vec3 vWP;\nvec3 gSunDirect = vec3(0.0);\nfloat gSunVis = 1.0;\nfloat gCanopy = 0.0;\n' + (opts.fragmentPars || ''));
    fs = fs.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      { vec4 lt = lightAt(vWP); gSunVis = lt.r * lt.b; gCanopy = lt.g; }`);
    fs = fs.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= gSunVis;');
    fs = fs.split('RE_Direct( directLight, geometryPosition').join('gSunDirect = directLight.color; RE_Direct( directLight, geometryPosition');
    if (opts.alphaBoost) {
      fs = fs.replace('#include <alphatest_fragment>', `
        #ifdef USE_ALPHATEST
        {
          vec2 tdx = dFdx(vMapUv * 2048.0), tdy = dFdy(vMapUv * 2048.0);
          float mip = max(0.0, 0.5 * log2(max(dot(tdx, tdx), dot(tdy, tdy))));
          diffuseColor.a *= 1.0 + mip * 0.22;
          if (diffuseColor.a < alphaTest) discard;
        }
        #endif`);
    }
    if (opts.fragmentMain) fs = fs.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + opts.fragmentMain);
    const canopy = opts.canopy ?? 0.55;
    fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      {
        float occ = mix(1.0, 1.0 - ${canopy.toFixed(3)}, gCanopy);
        reflectedLight.indirectDiffuse *= occ;
        reflectedLight.indirectSpecular *= occ;
        ${opts.afterLights || ''}
      }`);
    fs = fs.replace('#include <opaque_fragment>', `${opts.beforeOutput || ''}
      outgoingLight = applyAerial(outgoingLight, vWP);
      #include <opaque_fragment>`);
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    if (prev) prev(shader, renderer);
  };
  mat.customProgramCacheKey = () => (opts.key || 'p') + (opts.wind ? 'w' : '') + (opts.alphaBoost ? 'a' : '');
  return mat;
}

// ---------- Utilitaires ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash2(ix, iy), hash2(ix + 1, iy), u), lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), u), v);
}
export function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f + i * 7.3, y * f - i * 3.1); a *= 0.5; f *= 2; }
  return s / (1 - Math.pow(0.5, oct));
}

const texLoader = new THREE.TextureLoader();
export function loadTex(url, { srgb = true, repeat = false, aniso = 4, flipY = true } = {}) {
  return new Promise((res, rej) => {
    texLoader.load(url, (t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      t.flipY = flipY;
      t.needsUpdate = true;
      res(t);
    }, undefined, () => rej(new Error('Texture introuvable : ' + url)));
  });
}
// Données binaires publiées en JSON base64 (nom.data.json)
export async function fetchBuf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Fichier introuvable : ' + url);
  const j = await r.json();
  const s = atob(j.data), n = s.length, out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}
export async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Fichier introuvable : ' + url);
  return r.json();
}

// Construction de géométrie (positions, normales, uv, couleur = AO, vent)
export class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.w = []; this.idx = []; }
  get count() { return this.p.length / 3; }
  v(px, py, pz, nx, ny, nz, u, vv, ao = 1, flex = 0, ph = 0) {
    this.p.push(px, py, pz); this.n.push(nx, ny, nz); this.uv.push(u, vv); this.c.push(ao, ao, ao); this.w.push(flex, ph);
    return this.count - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  merge(o) {
    const off = this.count;
    this.p.push(...o.p); this.n.push(...o.n); this.uv.push(...o.uv); this.c.push(...o.c); this.w.push(...o.w);
    for (const i of o.idx) this.idx.push(i + off);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.w, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export function mergeGeometries(geos) {
  const b = new GeoBuilder();
  for (const g of geos) {
    const p = g.attributes.position.array, n = g.attributes.normal.array, uv = g.attributes.uv ? g.attributes.uv.array : null;
    const col = g.attributes.color ? g.attributes.color.array : null;
    const off = b.count;
    for (let i = 0; i < p.length / 3; i++) {
      b.p.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); b.n.push(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
      b.uv.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
      if (col) b.c.push(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]); else b.c.push(1, 1, 1);
      b.w.push(0, 0);
    }
    if (g.index) for (const i of g.index.array) b.idx.push(i + off);
    else for (let i = 0; i < p.length / 3; i++) b.idx.push(i + off);
  }
  return b.build();
}
