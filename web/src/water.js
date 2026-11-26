// Eau : océan et lagon (vagues de Gerstner, transparence selon la profondeur, écume, reflets),
// rivière, bassin et cascade. Rendu en deux passes : absorption (multiplication) puis lumière (addition).
import * as THREE from 'three';
import { U, GLSL_COMMON, mulberry32, WORLD } from './core.js';
import { GLSL_HEIGHT } from './terrain.js';

function makeNormalMap(size = 256, seed = 9) {
  const rnd = mulberry32(seed);
  const waves = [];
  for (let i = 0; i < 48; i++) {
    let kx, ky;
    do { kx = Math.round((rnd() * 2 - 1) * 12); ky = Math.round((rnd() * 2 - 1) * 12); } while (kx === 0 && ky === 0);
    const k = Math.hypot(kx, ky);
    waves.push({ kx, ky, a: 1 / Math.pow(k, 1.6), ph: rnd() * Math.PI * 2 });
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let dx = 0, dy = 0;
    for (const w of waves) {
      const c = Math.cos(2 * Math.PI * (w.kx * u + w.ky * v) + w.ph) * w.a * 2 * Math.PI;
      dx += c * w.kx; dy += c * w.ky;
    }
    const s = 0.035;
    let nx = -dx * s, ny = -dy * s, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const q = (y * size + x) * 4;
    data[q] = (nx * 0.5 + 0.5) * 255; data[q + 1] = (ny * 0.5 + 0.5) * 255; data[q + 2] = (nz * 0.5 + 0.5) * 255; data[q + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

const VS = /* glsl */`
${GLSL_COMMON}
${GLSL_HEIGHT}
uniform vec3 uGrid;
uniform float uWaveAmp;
attribute vec3 aFlow;
varying vec3 vWP;
varying vec3 vN;
varying float vOpen;
varying vec3 vFlow;
varying float vCrest;
void gerstner(vec2 p, vec2 d, float L, float A, inout vec3 disp, inout vec3 T, inout vec3 B) {
  float k = 6.28318 / L, c = sqrt(9.8 / k);
  float f = k * (dot(d, p) - c * uTime);
  float Q = min(0.8, 0.22 / max(k * A, 1e-4));
  float S = sin(f), C = cos(f), WA = k * A;
  disp += vec3(Q * A * d.x * C, A * S, Q * A * d.y * C);
  T += vec3(-Q * d.x * d.x * WA * S, d.x * WA * C, -Q * d.x * d.y * WA * S);
  B += vec3(-Q * d.x * d.y * WA * S, d.y * WA * C, -Q * d.y * d.y * WA * S);
}
void main() {
  vec3 wp;
  #ifdef OCEAN
  wp = vec3(position.x + uGrid.x, 0.0, position.z + uGrid.z);
  #else
  wp = (modelMatrix * vec4(position, 1.0)).xyz;
  #endif
  float depth = wp.y - terrainH(wp.xz);
  if (abs(wp.x) > 1020.0 || abs(wp.z) > 1020.0) depth = 60.0;
  vec3 T = vec3(1.0, 0.0, 0.0), B = vec3(0.0, 0.0, 1.0), disp = vec3(0.0);
  vCrest = 0.0;
  float open = smoothstep(1.5, 14.0, depth);
  #ifdef OCEAN
  float cd = distance(uCamPos.xz, wp.xz);
  float amp = mix(0.1, 0.62, open) * uWaveAmp * (1.0 - smoothstep(500.0, 3000.0, cd));
  gerstner(wp.xz, normalize(vec2(1.0, 0.35)), 41.0, amp * 0.55, disp, T, B);
  gerstner(wp.xz, normalize(vec2(0.62, 0.85)), 23.0, amp * 0.3, disp, T, B);
  gerstner(wp.xz, normalize(vec2(-0.3, 1.0)), 12.0, amp * 0.16, disp, T, B);
  gerstner(wp.xz, normalize(vec2(0.95, -0.42)), 7.0, amp * 0.09, disp, T, B);
  // moutons au large : écume au sommet des vagues les plus hautes
  vCrest = smoothstep(0.5, 0.95, disp.y / (amp * 1.05 + 1e-3)) * 0.35 * clamp(uWaveAmp - 0.6, 0.0, 1.5);
  // rouleaux qui arrivent vers la plage : ils se creusent quand le fond remonte, puis déferlent
  float sp = depth * 0.95 + uTime * 1.5 + vnoise(wp.xz * 0.018) * 7.0;
  float crest = pow(0.5 + 0.5 * sin(sp), 5.0);
  float H = (0.35 + 0.35 * uWaveAmp) * smoothstep(0.05, 1.4, depth) * (1.0 - smoothstep(3.5, 10.0, depth));
  disp.y += crest * H + 0.05 * sin(uTime * 1.13 + wp.x * 0.11 - wp.z * 0.07) * (1.0 - smoothstep(0.0, 2.5, depth));
  vCrest = max(vCrest, crest * smoothstep(0.15, 0.9, depth) * (1.0 - smoothstep(2.2, 5.0, depth)));
  #endif
  wp += disp;
  vN = normalize(cross(B, T));
  vWP = wp;
  vOpen = open;
  vFlow = aFlow;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FS = /* glsl */`
${GLSL_COMMON}
${GLSL_HEIGHT}
uniform samplerCube uSky;
uniform sampler2D uNorm;
uniform vec3 uImpact;
varying vec3 vWP;
varying vec3 vN;
varying float vOpen;
varying vec3 vFlow;
varying float vCrest;
void main() {
  vec3 toC = uCamPos - vWP;
  float dist = length(toC);
  vec3 V = toC / dist;
  float depth = max(vWP.y - terrainH(vWP.xz), 0.0);
  if (abs(vWP.x) > 1020.0 || abs(vWP.z) > 1020.0) depth = 60.0;
  float far = smoothstep(120.0, 1400.0, dist);
  #ifdef RIVER
  vec2 fl = vFlow.xz;
  vec2 uv1 = vWP.xz / 4.0 - fl * uTime * 0.55;
  vec2 uv2 = vWP.xz / 7.0 - fl * uTime * 0.35 + 0.37;
  float nAmp = 0.16 + length(fl) * 0.08;
  #else
  vec2 uv1 = vWP.xz / 9.0 + vec2(uTime * 0.021, uTime * 0.013);
  vec2 uv2 = vWP.xz / 26.0 - vec2(uTime * 0.011, -uTime * 0.017);
  float nAmp = mix(0.22, 0.42, vOpen);
  #endif
  vec2 n1 = texture(uNorm, uv1).xy * 2.0 - 1.0;
  vec2 n2 = texture(uNorm, uv2).xy * 2.0 - 1.0;
  vec2 dn = (n1 + n2 * 0.8) * nAmp * (1.0 - far * 0.8);
  vec3 N = normalize(vN + vec3(dn.x, 0.0, dn.y));
  if (dot(N, V) < 0.02) N = normalize(N + V * (0.02 - dot(N, V)));
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.01;
  vec3 refl = textureLod(uSky, R, 1.0 + 3.0 * far).rgb * mix(1.0, 0.6, vOpen * (1.0 - smoothstep(0.88, 0.99, 1.0 - NdV)));
  vec4 lt = lightAt(vWP);
  float sunVis = lt.r * lt.b;
  // reflet du soleil (GGX)
  vec3 Hh = normalize(V + uSunDir);
  float NdH = max(dot(N, Hh), 0.0), NdL = max(dot(N, uSunDir), 0.0);
  float rgh = mix(0.07, 0.16, far);
  float a2 = rgh * rgh * rgh * rgh;
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * dd * dd);
  float Fh = 0.02 + 0.98 * pow(1.0 - max(dot(V, Hh), 0.0), 5.0);
  vec3 spec = uSunColor * sunVis * min(D * Fh * NdL / max(4.0 * NdV * NdL, 1e-3), 22.0) * NdL * (1.0 - far * 0.6);
  // absorption et diffusion dans l'eau
  float pathLen = depth / max(V.y, 0.12);
  vec3 Tv = exp(-uSigma * pathLen);
  vec3 Ein = uSunColor * max(uSunDir.y, 0.0) * sunVis + uSkyAmb * 3.14159;
  vec3 wcol = mix(vec3(0.0003, 0.0058, 0.0115), vec3(0.0002, 0.0048, 0.022), smoothstep(4.0, 25.0, depth));
  vec3 Lin = Ein * wcol * (1.0 - Tv);
  // écume
  float t = uTime;
  float fn = vnoise(vWP.xz * 2.2 + vec2(t * 0.3, -t * 0.2)) * vnoise(vWP.xz * 0.8 - t * 0.13);
  float foam = 0.0;
  #ifdef RIVER
  float speed = length(vFlow.xz);
  foam = smoothstep(0.62, 0.95, fn) * clamp(speed - 0.9, 0.0, 1.0) * 0.55;
  foam += (1.0 - smoothstep(0.0, 0.12, depth)) * 0.25 * smoothstep(0.4, 0.8, fn);
  float ri = distance(vWP.xz, uImpact.xz);
  foam += (1.0 - smoothstep(1.5, 8.0, ri)) * smoothstep(0.25, 0.6, fn + 0.15) * 0.8;
  #else
  float shoreF = 1.0 - smoothstep(0.0, 1.5, depth);
  float bands = sin(depth * 6.5 - t * 1.35 + vnoise(vWP.xz * 0.22) * 6.0) * 0.5 + 0.5;
  // écume fine et filandreuse : sur la crête des rouleaux, puis traînées qui s'étalent sur le sable mouillé
  float fs = vnoise(vWP.xz * 5.5 + vec2(t * 0.4, -t * 0.25)) * vnoise(vWP.xz * 1.6 - t * 0.11);
  foam = vCrest * smoothstep(0.12, 0.42, fs + 0.12) * 0.95;
  foam += shoreF * smoothstep(0.72, 0.97, bands) * smoothstep(0.22, 0.5, fs) * 0.5;
  foam += (1.0 - smoothstep(0.0, 0.1, depth)) * 0.55 * smoothstep(0.18, 0.45, fs);
  foam *= 1.0 - far * 0.5;
  #endif
  foam = clamp(foam, 0.0, 0.95);
  vec3 foamCol = 0.85 * (uSunColor * max(dot(vec3(0.0, 1.0, 0.0), uSunDir), 0.0) * sunVis + uSkyAmb * 3.14159) / 3.14159;
  // perspective aérienne
  float a = uFogDensity * exp(-max(uCamPos.y, 0.0) * uFogFalloff);
  float b = uFogFalloff * (vWP.y - uCamPos.y);
  float amt = a * dist * (abs(b) > 1e-4 ? (1.0 - exp(-b)) / b : 1.0);
  float fog = 1.0 - exp(-amt);
  vec3 haze = mix(uHazeColor, uHazeSun, pow(max(dot(-V, uSunDir), 0.0), 6.0));
  #ifdef RIVER
  if (!gl_FrontFacing) discard;
  #endif
  if (!gl_FrontFacing) {
    // sous l'eau : fenêtre de Snell vers le ciel, réflexion totale ailleurs
    vec3 Vd = normalize(vWP - uCamPos);
    float cosI = max(Vd.y, 0.0);
    float window = smoothstep(0.62, 0.7, cosI);
    vec3 skyc = textureLod(uSky, normalize(vec3(Vd.x, Vd.y * 1.5 + 0.2, Vd.z)), 2.0).rgb;
    vec3 under = mix(underwaterTint() * 2.2, skyc * 0.9, window);
    float dd = distance(uCamPos, vWP);
    vec3 Tu = exp(-uSigma * dd * 1.15 - 0.018 * dd);
    under = under * Tu + underwaterTint() * (1.0 - Tu);
    #ifdef PASS_A
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    #else
    gl_FragColor = vec4(under, 1.0);
    #endif
    return;
  }
  #ifdef PASS_A
  gl_FragColor = vec4(Tv * (1.0 - F) * (1.0 - foam) * (1.0 - fog), 1.0);
  #else
  vec3 surf = Lin * (1.0 - F) * (1.0 - foam) + refl * F + spec * (1.0 - foam) + foamCol * foam;
  gl_FragColor = vec4(surf * (1.0 - fog) + haze * fog, 1.0);
  #endif
}`;

function waterMaterials(defines, extra) {
  const uniforms = {
    ...U,
    uHeight: { value: null }, uHN: { value: 1024 },
    uSky: { value: null }, uNorm: { value: null },
    uGrid: { value: new THREE.Vector3() }, uWaveAmp: { value: 1 },
    uImpact: { value: new THREE.Vector3(1e5, 0, 1e5) },
    ...extra,
  };
  const A = new THREE.ShaderMaterial({
    uniforms, vertexShader: VS, fragmentShader: FS, defines: { ...defines, PASS_A: 1 },
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, side: THREE.DoubleSide,
    blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
  });
  const B = new THREE.ShaderMaterial({
    uniforms, vertexShader: VS, fragmentShader: FS, defines: { ...defines },
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, side: THREE.DoubleSide,
    blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  return [A, B, uniforms];
}

export class Water {
  constructor(scene, terrain, world, sky) {
    this.normTex = makeNormalMap();
    // grille radiale de l'océan
    const pos = [], idx = [], SEG = 128, rings = [0];
    let r = 1.0;
    while (r < 40000) { rings.push(r); r = r * 1.085 + 0.6; }
    for (let i = 0; i < rings.length; i++) for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      pos.push(Math.cos(a) * rings[i], 0, Math.sin(a) * rings[i]);
    }
    for (let i = 0; i < rings.length - 1; i++) for (let s = 0; s < SEG; s++) {
      const a = i * SEG + s, b = i * SEG + ((s + 1) % SEG), c = (i + 1) * SEG + s, d = (i + 1) * SEG + ((s + 1) % SEG);
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
    g.setIndex(idx);
    const [oA, oB, oU] = waterMaterials({ OCEAN: 1 });
    this.oceanU = oU;
    this.setup(oU, terrain, sky);
    this.ocean = [new THREE.Mesh(g, oA), new THREE.Mesh(g, oB)];
    this.ocean.forEach((m, i) => { m.frustumCulled = false; m.renderOrder = 10 + i; scene.add(m); });
    // rivière + bassin
    const rb = { p: [], f: [], i: [] };
    const addRibbon = (pts, hw0, hw1, speedBase) => {
      const n = pts.length, base = rb.p.length / 3;
      for (let k = 0; k < n; k++) {
        const a = pts[Math.max(k - 1, 0)], b = pts[Math.min(k + 1, n - 1)];
        let tx = b[0] - a[0], tz = b[2] - a[2];
        const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const hw = hw0 + (hw1 - hw0) * (k / (n - 1)) + 2.6;
        const slope = Math.max(0, (pts[Math.max(k - 2, 0)][1] - pts[Math.min(k + 2, n - 1)][1]) / 16);
        const sp = speedBase + Math.min(slope * 6, 2.2);
        // l'eau épouse le lit : jamais sous le fond, jamais plus de 1,2 m au-dessus (pas d'eau qui flotte)
        const bed = terrain.height(pts[k][0], pts[k][2]), wy = Math.min(Math.max(pts[k][1], bed + 0.15), bed + 1.2);
        for (const s of [-1, 1]) { rb.p.push(pts[k][0] - tz * hw * s, wy, pts[k][2] + tx * hw * s); rb.f.push(tx * sp, 0, tz * sp); }
      }
      for (let k = 0; k < n - 1; k++) { const a = base + k * 2; rb.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    };
    world.river.forEach((rv, i) => addRibbon(i === 0 ? rv.pts.slice(0, -1) : rv.pts, rv.halfW[0], rv.halfW[1], 0.5));
    const pool = world.waterfall.pool, PR = world.waterfall.poolR + 7;
    {
      const base = rb.p.length / 3;
      rb.p.push(pool[0], pool[1], pool[2]); rb.f.push(0, 0, 0);
      for (let s = 0; s <= 40; s++) { const a = s / 40 * Math.PI * 2; rb.p.push(pool[0] + Math.cos(a) * PR, pool[1], pool[2] + Math.sin(a) * PR); rb.f.push(0, 0, 0); }
      for (let s = 0; s < 40; s++) rb.i.push(base, base + s + 2, base + s + 1);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rb.p, 3));
    rg.setAttribute('aFlow', new THREE.Float32BufferAttribute(rb.f, 3));
    rg.setIndex(rb.i);
    rg.computeBoundingSphere();
    const lip = world.waterfall.lip, dir = world.waterfall.dir;
    const impact = new THREE.Vector3(lip[0] + dir[0] * 6, pool[1], lip[2] + dir[1] * 6);
    const [rA, rB, rU] = waterMaterials({ RIVER: 1 }, { uImpact: { value: impact } });
    this.setup(rU, terrain, sky);
    this.river = [new THREE.Mesh(rg, rA), new THREE.Mesh(rg, rB)];
    this.river.forEach((m, i) => { m.renderOrder = 12 + i; scene.add(m); });
    this.impact = impact;
    // cascade
    this.fall = makeWaterfall(world);
    scene.add(this.fall);
  }
  setup(u, terrain, sky) {
    u.uHeight.value = terrain.heightTex;
    u.uHN.value = terrain.N;
    u.uSky.value = sky.cubeRT.texture;
    u.uNorm.value = this.normTex;
  }
  update(camera, weather) {
    const g = this.oceanU.uGrid.value;
    g.set(Math.round(camera.position.x / 4) * 4, 0, Math.round(camera.position.z / 4) * 4);
    this.oceanU.uWaveAmp.value = 0.8 + weather * 1.6;
  }
}

function makeWaterfall(world) {
  const lip = world.waterfall.lip, dir = world.waterfall.dir, pool = world.waterfall.pool;
  const drop = lip[1] - pool[1];
  const W = world.waterfall.width * 1.3, ROWS = 22, COLS = 10;
  const px = -dir[1], pz = dir[0];
  const pos = [], uv = [], idx = [];
  for (let r = 0; r <= ROWS; r++) {
    const t = r / ROWS;
    const y = lip[1] + 0.25 - (drop + 0.25) * t;
    const out = -0.8 + Math.sqrt(t) * 6.4;
    const w = W * (1 + t * 0.45);
    for (let c = 0; c <= COLS; c++) {
      const s = c / COLS - 0.5;
      const bow = (1 - Math.abs(s * 2) ** 2) * 0.6 * Math.sqrt(t);
      pos.push(lip[0] + dir[0] * (out + bow) + px * s * w, y, lip[2] + dir[1] * (out + bow) + pz * s * w);
      uv.push(c / COLS, t);
    }
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const a = r * (COLS + 1) + c, b = a + 1, d = a + COLS + 1, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uDrop: { value: drop } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vWP; varying vec3 vNrm;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; vNrm = normal; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      uniform float uDrop;
      varying vec2 vUv; varying vec3 vWP; varying vec3 vNrm;
      void main() {
        float t = vUv.y;
        float sx = vUv.x * 14.0;
        float flow = uTime * 1.6 / max(0.25, sqrt(t + 0.05));
        float strands = vnoise(vec2(sx, vUv.y * 4.0 - flow * 3.0)) * 0.55 + vnoise(vec2(sx * 3.1, vUv.y * 9.0 - flow * 6.0)) * 0.3 + vnoise(vec2(sx * 7.3, vUv.y * 2.0 - flow * 2.0)) * 0.15;
        float rag = vnoise(vec2(vUv.y * 6.0 - flow, 3.0)) * 0.12;
        float edge = smoothstep(0.0 + rag, 0.16 + rag, vUv.x) * smoothstep(1.0 - rag, 0.84 - rag, vUv.x);
        float white = smoothstep(0.03, 0.4, t);
        float alpha = mix(0.88, smoothstep(0.3, 0.8, strands) * mix(0.92, 0.55, t), white) * edge;
        alpha *= smoothstep(0.0, 0.03, t);
        vec4 lt = lightAt(vWP);
        vec3 light = uSunColor * lt.r * lt.b * (0.35 + 0.65 * max(dot(normalize(vNrm), uSunDir), 0.0)) + uSkyAmb * 3.14159;
        vec3 glass = uSkyAmb * vec3(0.55, 0.85, 0.9) + uSunColor * lt.r * lt.b * 0.02;
        vec3 col = mix(glass, light * mix(0.62, 0.9, strands) / 3.14159, white);
        col = applyAerial(col, vWP);
        gl_FragColor = vec4(col * alpha, alpha);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 20;
  return m;
}

export { WORLD };
