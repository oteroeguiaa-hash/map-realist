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

// Houle qui atteint la plage : phase commune au relief (sommet), à l'écume et au jet de rive (fragment).
// WS : pulsation des rouleaux (une vague toutes les ~6 s). swashMean : niveau moyen qui respire, identique au
// « sable mouillé » du relief (terrain.js) pour que l'eau reste toujours sur le sable sombre.
const GLSL_SHORE = /* glsl */`
#define WS 1.05
float swashMean(vec2 p) { return 0.11 * sin(uTime * 0.55 + p.x * 0.045 + p.y * 0.031) + 0.05 * sin(uTime * 1.13 + p.x * 0.11 - p.y * 0.07); }
float shorePhase(vec2 p, float d0) { return max(d0, 0.0) * 0.95 + uTime * WS + vnoise(p * 0.018) * 7.0; }
`;
// Pied de la cascade : la nappe tombe sur un segment (centre uImpact, direction uImpactW.xy, demi-largeur uImpactW.z).
const GLSL_IMPACT = /* glsl */`
uniform vec3 uImpact;
uniform vec4 uImpactW;
float impactDist(vec2 p) {
  vec2 d = p - uImpact.xz;
  float s = clamp(dot(d, uImpactW.xy), -uImpactW.z, uImpactW.z);
  return length(d - uImpactW.xy * s);
}
`;
// réseau lumineux des caustiques (lignes où deux bruits animés se croisent)
const GLSL_CAUS = /* glsl */`
float causNet(vec2 p, float t) {
  float a = vnoise(p + vec2(t * 0.45, t * 0.3));
  float b = vnoise(p * 1.37 - vec2(t * 0.38, -t * 0.27) + 5.3);
  return pow(1.0 - abs(a - b), 28.0);
}
`;

const VS = /* glsl */`
${GLSL_COMMON}
${GLSL_HEIGHT}
${GLSL_SHORE}
${GLSL_IMPACT}
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
// rouleaux qui se creusent quand le fond remonte : front raide côté plage, dos allongé côté large
float shoal(vec2 p) {
  float dep = -terrainH(p);
  float sp = shorePhase(p, dep);
  float c = pow(0.5 + 0.5 * sin(sp - 0.55 * cos(sp)), 4.0);
  float H = (0.26 + 0.3 * uWaveAmp) * smoothstep(0.05, 1.4, dep) * (1.0 - smoothstep(3.5, 10.0, dep));
  return c * H + swashMean(p) * (1.0 - smoothstep(1.0, 4.0, dep));
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
  if (depth < 11.0 && cd < 1500.0) {
    // relief des rouleaux près du rivage et sa pente (différences finies) : normales cohérentes avec le déplacement
    float s0 = shoal(wp.xz);
    float sx = shoal(wp.xz + vec2(0.7, 0.0)), sz = shoal(wp.xz + vec2(0.0, 0.7));
    disp.y += s0;
    T.y += (sx - s0) / 0.7;
    B.y += (sz - s0) / 0.7;
  }
  #endif
  #ifdef RIVER
  // remous au pied de la chute : ondes qui partent du point d'impact et bouillonnement
  float ri = impactDist(wp.xz);
  if (ri < 18.0) {
    float boil = 1.0 - smoothstep(2.0, 18.0, ri);
    disp.y += (sin(ri * 0.9 - uTime * 3.2) * 0.1 * exp(-ri * 0.12) + (vnoise(wp.xz * 0.7 + uTime * 0.8) - 0.5) * 0.4 * (1.0 - smoothstep(1.0, 7.0, ri))) * boil;
  }
  #endif
  wp += disp;
  #ifdef OCEAN
  // bande de jet de rive : la surface est posée juste au-dessus du sable pour que le fragment
  // décide pixel par pixel où arrive la pellicule d'eau (la ligne d'eau avance et recule)
  float hS = terrainH(wp.xz);
  if (hS < 0.95 && cd < 460.0) wp.y = max(wp.y, hS + 0.03 + cd * 0.0015);
  #endif
  vN = normalize(cross(B, T));
  vWP = wp;
  vOpen = open;
  vFlow = aFlow;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FS = /* glsl */`
${GLSL_COMMON}
${GLSL_HEIGHT}
${GLSL_SHORE}
${GLSL_IMPACT}
${GLSL_CAUS}
uniform samplerCube uSky;
uniform sampler2D uNorm;
uniform float uWaveAmp;
varying vec3 vWP;
varying vec3 vN;
varying float vOpen;
varying vec3 vFlow;
varying float vCrest;
// motif d'écume : réseau de filaments (lignes de niveau d'un bruit) qui se remplit quand la densité d augmente
float foamPat(vec2 q, float d) {
  float w = vnoise(q * 0.31 + 7.7);
  q += (vec2(w, vnoise(q * 0.29 - 3.3)) - 0.5) * 2.6;   // déformation : pas de boucles rondes régulières
  float n = vnoise(q) * 0.62 + vnoise(q * 2.37 + 4.1) * 0.38;
  // filaments cassés en tronçons de longueur variable, bulles plus denses quand d augmente
  float web = (1.0 - smoothstep(0.0, 0.02 + 0.07 * d, abs(n - 0.5))) * min(d * 2.2, 1.0) * smoothstep(0.25, 0.6, w + d * 0.4);
  float fill = smoothstep(1.0 - d * 0.75, 1.12 - d * 0.75, n);
  return clamp(max(web * 0.85, fill), 0.0, 1.0);
}
void main() {
  vec3 toC = uCamPos - vWP;
  float dist = length(toC);
  vec3 V = toC / dist;
  float hT = terrainH(vWP.xz);
  float depth = max(vWP.y - hT, 0.0);
  if (abs(vWP.x) > 1020.0 || abs(vWP.z) > 1020.0) { depth = 60.0; hT = -60.0; }
  float far = smoothstep(120.0, 1400.0, dist);
  float t = uTime;
  // taille d'un pixel au sol (anticrénelage de l'écume, du liseré et des paillettes)
  float fp = max(length(fwidth(vWP.xz)), 1e-3);
  // couverture d'eau (1 = eau ; 0 = sable découvert), sable mouillé brillant, écume
  float cover = 1.0, gloss = 0.0, foam = 0.0, filmC = 0.0;
  #ifdef OCEAN
  float d0 = -hT; // profondeur au repos
  if (d0 > -1.0 && d0 < 3.0 && dist < 460.0) {
    float sp = shorePhase(vWP.xz, d0);
    float cyc = (sp - 1.5708) / 6.28318;
    float ph = fract(cyc);  // 0 : le rouleau vient de passer (ou d'atteindre le rivage) ; croît jusqu'au suivant
    float near = 1.0 - smoothstep(260.0, 440.0, dist);
    // rouleaux qui déferlent : front blanc, écume qui traîne derrière, se forme juste devant
    float brk = smoothstep(0.03, 0.4, d0) * (1.0 - smoothstep(1.4, 2.9, d0)) * clamp(0.4 + 0.35 * uWaveAmp, 0.0, 1.2);
    float bd = brk * max(max(1.0 - smoothstep(0.0, 0.03, ph), exp(-ph * 6.0) * 0.7), smoothstep(0.965, 1.0, ph) * 0.5);
    if (bd > 0.01) foam = foamPat(vWP.xz * 1.9 + vec2(t * 0.05, -t * 0.03), bd);
    if (d0 < 0.9) {
      // jet de rive : chaque vague monte (vite) puis redescend (plus lentement), plus ou moins haut
      float a = mix(0.55, 1.15, hash12(vec2(floor(cyc), 7.3)));
      const float TP = 0.32;
      float f = ph < TP ? 1.0 - (1.0 - ph / TP) * (1.0 - ph / TP) : 1.0 - pow((ph - TP) / (1.0 - TP), 1.6);
      float Rs = 0.12 + 0.11 * uWaveAmp;
      float S = swashMean(vWP.xz);
      float R = (a * Rs * f - 0.07) * near;
      float L = S + R, Lpk = S + (a * Rs - 0.07) * near;
      // ligne d'eau irrégulière (festons, petites anses) et pente locale du sable
      float hTn = hT + (vnoise(vWP.xz * 0.6 + t * 0.03) - 0.5) * 0.05 + (vnoise(vWP.xz * 2.3) - 0.5) * 0.014;
      vec2 gr = vec2(terrainH(vWP.xz + vec2(1.0, 0.0)), terrainH(vWP.xz + vec2(0.0, 1.0))) - hT;
      float slope = max(length(gr), 0.01);
      vec2 up = gr / slope;
      float wt = L - hTn;                 // épaisseur de la pellicule
      float dH = wt / slope;              // distance horizontale à la ligne d'eau (m)
      float fw = max(fp * slope, 0.002);
      cover = smoothstep(-fw, fw, wt);
      depth = mix(max(wt, 0.0), depth, smoothstep(0.35, 0.9, d0));
      // l'écume suit l'eau : elle remonte la pente avec le front puis redescend
      vec2 qs = (vWP.xz - up * clamp(R / slope, -12.0, 12.0) * 0.8) * 2.1;
      float up1 = 1.0 - smoothstep(0.0, TP, ph);
      // front turbulent pendant la montée, liseré fin et cassé au bord, dentelle qui se dissout ensuite
      float sw = up1 * (1.0 - smoothstep(0.0, 0.4 + 1.8 * up1, dH));
      sw = max(sw, (1.0 - smoothstep(0.0, 0.18 + 0.25 * up1, dH)) * 0.6);
      sw = max(sw, pow(1.0 - ph, 2.0) * 0.45 * (1.0 - smoothstep(1.5, 7.0, dH)));
      float fsw = foamPat(qs, sw) * cover;
      // caustiques sous la pellicule : réseau lumineux qui danse sur le sable
      filmC = causNet(vWP.xz * 4.5, t * 1.6) * (1.0 - smoothstep(0.006, 0.03, fp)) * smoothstep(0.003, 0.04, wt) * cover * (1.0 - smoothstep(0.25, 0.6, depth)) * near;
      // sable découvert : brillant juste derrière l'eau qui se retire, liseré d'écume laissé au plus haut
      float dPk = (Lpk - hTn) / slope;
      float rec = step(TP, ph) * step(0.0, dPk) * (1.0 - cover);
      gloss = rec * (1.0 - smoothstep(0.0, max(Lpk - L, 0.01), -wt)) * near;
      float res = rec * (1.0 - smoothstep(0.0, 0.3, dPk)) * exp(-(ph - TP) * 3.5) * 0.7;
      fsw = max(fsw, foamPat(qs * 1.3 + 2.0, res) * (1.0 - cover));
      foam = max(foam * cover, fsw);
      if (cover < 0.002 && gloss < 0.004 && foam < 0.004) discard;
    }
  }
  #endif
  #ifdef RIVER
  // courant : les rides suivent l'eau ; deux phases décalées de 5 s fondues l'une dans l'autre
  // (la texture ne s'étire pas avec le temps là où la vitesse change)
  vec2 fl = vFlow.xz;
  float speed = length(fl);
  float fa = fract(t * 0.2), fb = fract(t * 0.2 + 0.5), wb = abs(fa * 2.0 - 1.0);
  vec2 n1 = mix(texture(uNorm, vWP.xz / 4.0 - fl * fa * 2.75).xy, texture(uNorm, vWP.xz / 4.0 - fl * fb * 2.75 + 0.5).xy, wb) * 2.0 - 1.0;
  vec2 n2 = mix(texture(uNorm, vWP.xz / 7.0 - fl * fa * 1.75 + 0.37).xy, texture(uNorm, vWP.xz / 7.0 - fl * fb * 1.75 + 0.81).xy, wb) * 2.0 - 1.0;
  float riF = impactDist(vWP.xz);
  float boil = 1.0 - smoothstep(1.0, 10.0, riF);
  float nAmp = 0.16 + speed * 0.08 + boil * 0.45;
  #else
  vec2 uv1 = vWP.xz / 9.0 + vec2(uTime * 0.021, uTime * 0.013);
  vec2 uv2 = vWP.xz / 26.0 - vec2(uTime * 0.011, -uTime * 0.017);
  // pellicule très fine : surface presque lisse (miroir du ciel)
  float nAmp = mix(0.2, 0.26, vOpen) * mix(0.35, 1.0, smoothstep(0.0, 0.25, depth));
  vec2 n1 = texture(uNorm, uv1).xy * 2.0 - 1.0;
  vec2 n2 = texture(uNorm, uv2).xy * 2.0 - 1.0;
  #endif
  // la houle trop fine pour un pixel se moyenne : moins de pente apparente, reflet plus flou
  float sub = smoothstep(0.02, 0.3, fp);
  vec2 dn = (n1 + n2 * 0.8) * nAmp * (1.0 - far * 0.8) * (1.0 - 0.6 * sub);
  vec3 N = vN + vec3(dn.x, 0.0, dn.y);
  #ifdef RIVER
  // ondes concentriques du pied de la chute (pente de la sinusoïde du sommet)
  if (riF < 18.0) {
    vec2 dImp = vWP.xz - uImpact.xz;
    vec2 rdir = (dImp - uImpactW.xy * clamp(dot(dImp, uImpactW.xy), -uImpactW.z, uImpactW.z)) / max(riF, 1e-3);
    float slopeR = cos(riF * 0.9 - t * 3.2) * 0.09 * exp(-riF * 0.12) * (1.0 - smoothstep(2.0, 18.0, riF));
    N.xz -= rdir * slopeR;
  }
  #endif
  N = normalize(N);
  if (dot(N, V) < 0.02) N = normalize(N + V * (0.02 - dot(N, V)));
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  // Fresnel de l'eau (n = 1,33) ; en vue rasante, les vagues se masquent entre elles et le reflet plafonne
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  F = min(F, mix(0.75, 0.6, vOpen));
  vec3 R = reflect(-V, N);
  // les facettes tournées vers l'observateur renvoient un ciel plus haut (plus bleu) que l'horizon
  R.y = abs(R.y) + 0.01 + 0.12 * vOpen;
  // reflet du ciel flouté par la houle (plus flou au large et au loin)
  vec3 refl = textureLod(uSky, R, 1.0 + 1.8 * vOpen + 2.0 * sub + 3.0 * far).rgb;
  #ifdef RIVER
  // rives boisées : les reflets rasants renvoient la jungle et les falaises (sombres), pas le ciel
  refl = mix(refl, uSkyAmb * vec3(0.3, 0.45, 0.3), (1.0 - smoothstep(0.1, 0.5, R.y)) * 0.85);
  #endif
  vec4 lt = lightAt(vWP);
  float sunVis = lt.r * lt.b;
  // reflet du soleil (GGX)
  vec3 Hh = normalize(V + uSunDir);
  float NdH = max(dot(N, Hh), 0.0), NdL = max(dot(N, uSunDir), 0.0);
  // rugosité : microrides + ce qu'un pixel ne peut pas résoudre (évite le fourmillement de points blancs)
  float rgh = clamp(0.2 + 0.08 * vOpen + fp * 1.2 + far * 0.15, 0.2, 0.5);
  float a2 = rgh * rgh * rgh * rgh;
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * dd * dd);
  float Fh = 0.02 + 0.98 * pow(1.0 - max(dot(V, Hh), 0.0), 5.0);
  vec3 spec = uSunColor * sunVis * min(D * Fh * NdL / max(4.0 * NdV * NdL, 1e-3), 22.0) * NdL * (1.0 - far * 0.6);
  // absorption et diffusion dans l'eau
  float pathLen = depth / max(V.y, 0.12);
  vec3 Tv = exp(-uSigma * pathLen);
  vec3 Ein = uSunColor * max(uSunDir.y, 0.0) * sunVis + uSkyAmb * 3.14159;
  // diffusion : turquoise lumineux sur fond de sable (particules en suspension), bleu-vert profond au large
  #ifdef RIVER
  // eau douce de la jungle : bleu-vert sombre dans le bassin
  vec3 wcol = mix(vec3(0.0006, 0.0095, 0.0085), vec3(0.0002, 0.0042, 0.0052), smoothstep(1.0, 6.0, depth));
  #else
  vec3 wcol = mix(vec3(0.0012, 0.0135, 0.0145), vec3(0.0005, 0.0085, 0.024), smoothstep(2.0, 18.0, depth));
  #endif
  vec3 Lin = Ein * wcol * (1.0 - Tv);
  #ifdef RIVER
  // traînées d'écume étirées dans le sens du courant, emportées à la vitesse de l'eau
  vec2 fd = fl / max(speed, 1e-3);
  vec2 qf = vec2(dot(vWP.xz, fd), dot(vWP.xz, vec2(-fd.y, fd.x)));
  float str = mix(vnoise(vec2((qf.x - speed * fa * 11.0) * 0.45, qf.y * 2.6)), vnoise(vec2((qf.x - speed * fb * 11.0) * 0.45 + 3.7, qf.y * 2.6 + 1.3)), wb);
  foam = smoothstep(0.6, 0.88, str) * clamp((speed - 0.7) * 0.8, 0.0, 1.0) * 0.55;
  float fn = vnoise(vWP.xz * 2.2 + vec2(t * 0.3, -t * 0.2));
  foam += (1.0 - smoothstep(0.0, 0.12, depth)) * 0.25 * smoothstep(0.4, 0.8, fn);
  // bouillonnement blanc au pied de la chute, dentelle qui s'éloigne avec le courant
  if (boil > 0.0) {
    vec2 qb = vWP.xz * 1.4 + (vec2(vnoise(vWP.xz * 0.5 + t * 0.9), vnoise(vWP.xz * 0.5 - t * 0.7 + 4.0)) - 0.5) * 3.0;
    foam = max(foam, foamPat(qb, boil * 1.15) * 0.95);
  }
  vec3 glint = vec3(0.0);
  #else
  // moutons au large
  if (vCrest > 0.01) foam = max(foam, foamPat(vWP.xz * 0.9 + vec2(t * 0.1, 0.0), vCrest * 1.6) * 0.9);
  // au loin, l'écume se fond en voile (pas de scintillement)
  foam *= 1.0 - far * 0.5;
  // paillettes de soleil : petites facettes aléatoires des vaguelettes qui renvoient le soleil un instant
  float lv = max(ceil(log2(fp * 2.5 / 0.02)), 0.0);   // cellules d'environ 2 à 5 pixels
  float cs = 0.02 * exp2(lv);
  vec2 gc = floor(vWP.xz / cs), gf = fract(vWP.xz / cs) - 0.5;
  float h0 = hash12(gc + lv * 31.7);
  float tq = floor(t * 7.0 + h0 * 7.0);
  float hh = hash12(gc + vec2(tq * 0.731, tq * 1.37));
  float ag = 0.06, a2g = ag * ag;
  float ddg = NdH * NdH * (a2g - 1.0) + 1.0;
  float prob = clamp(a2g / (3.14159 * ddg * ddg) * 0.0025, 0.0, 0.5);
  float spark = step(hh, prob) * (1.0 - smoothstep(0.08, 0.3, length(gf - (vec2(hash12(gc + 3.1), h0) - 0.5) * 0.5)));
  vec3 glint = uSunColor * sunVis * NdL * spark * 26.0 * cover * smoothstep(0.0, 0.1, uSunDir.y);
  #endif
  foam = clamp(foam, 0.0, 0.95);
  vec3 foamCol = 0.85 * (uSunColor * max(dot(vec3(0.0, 1.0, 0.0), uSunDir), 0.0) * sunVis + uSkyAmb * 3.14159) / 3.14159;
  // sable mouillé découvert : reflet d'une surface presque lisse, sable un peu plus sombre
  float cv = max(cover, gloss * 0.6);
  F *= cv; spec *= cv;
  // perspective aérienne
  float a = uFogDensity * exp(-max(uCamPos.y, 0.0) * uFogFalloff);
  float b = uFogFalloff * (vWP.y - uCamPos.y);
  float amt = a * dist * (abs(b) > 1e-4 ? (1.0 - exp(-b)) / b : 1.0);
  float fog = 1.0 - exp(-amt);
  vec3 haze = mix(uHazeColor, uHazeSun, pow(max(dot(-V, uSunDir), 0.0), 6.0));
  #ifdef RIVER
  if (!gl_FrontFacing) discard;
  bool below = false;
  #else
  // caméra sous la surface : on se fie à sa hauteur (les pentes de vagues vues de dessous ne trompent plus)
  bool below = uCamPos.y < -0.6 || (uCamPos.y < 0.6 && !gl_FrontFacing);
  #endif
  if (below) {
    // surface vue de dessous : fenêtre de Snell (ciel réfracté, rides comprises), réflexion totale ailleurs
    vec3 Vd = -V;
    vec3 Nd = -normalize(vec3(N.x * 1.6, N.y, N.z * 1.6));
    float ci = -dot(Vd, Nd);
    float k = 1.0 - 1.769 * (1.0 - ci * ci);          // 1,33² : k < 0 → réflexion totale
    float window = smoothstep(0.0, 0.1, k);
    vec3 Tr = normalize(1.33 * Vd + (1.33 * ci - sqrt(max(k, 0.0))) * Nd);
    vec3 skyc = textureLod(uSky, Tr, 1.5).rgb;
    // soleil vu à travers la fenêtre et liseré clair au bord du cône
    skyc += uSunColor * sunVis * pow(max(dot(Tr, uSunDir), 0.0), 400.0) * 6.0;
    float Fw = 0.02 + 0.98 * pow(1.0 - sqrt(max(k, 0.0)), 5.0);
    vec3 win = skyc * (1.0 - Fw) * 0.9 + underwaterTint() * 2.2 * Fw;
    // hors de la fenêtre : miroir du fond (sable turquoise éclairé à travers l'eau)
    vec3 Td2 = exp(-uSigma * (depth * 2.2 + 0.5));
    vec3 mirror = underwaterTint() * 2.2 + Ein * 0.11 * Td2;
    vec3 under = mix(mirror, win, window);
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
  // sable noyé un peu plus sombre (saturé d'eau) ; sable découvert encore luisant
  vec3 Tm = mix(vec3(1.0), Tv * mix(0.86, 1.0, smoothstep(0.2, 0.8, depth)), cover) * mix(1.0, 0.85, gloss * (1.0 - cover));
  gl_FragColor = vec4(Tm * (1.0 - F) * (1.0 - foam) * (1.0 - fog), 1.0);
  #else
  vec3 surf = Lin * cover * (1.0 - F) * (1.0 - foam) + refl * F + (spec + glint) * (1.0 - foam) + foamCol * foam
    + Ein * (0.09 * filmC) * (1.0 - foam) * (1.0 - F);
  gl_FragColor = vec4(surf * (1.0 - fog) + haze * fog, 1.0);
  #endif
}`;

function waterMaterials(defines, extra) {
  const uniforms = {
    ...U,
    uHeight: { value: null }, uHN: { value: 1024 },
    uSky: { value: null }, uNorm: { value: null },
    uGrid: { value: new THREE.Vector3() }, uWaveAmp: { value: 1 },
    uImpact: { value: new THREE.Vector3(1e5, 0, 1e5) }, uImpactW: { value: new THREE.Vector4(1, 0, 0, 0) },
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
    const FW = fallWidth(world);
    const rb = { p: [], f: [], i: [] };
    const addRibbon = (pts, hw0, hw1, speedBase, lipEnd) => {
      const n = pts.length, base = rb.p.length / 3;
      for (let k = 0; k < n; k++) {
        const a = pts[Math.max(k - 1, 0)], b = pts[Math.min(k + 1, n - 1)];
        let tx = b[0] - a[0], tz = b[2] - a[2];
        const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        let hw = hw0 + (hw1 - hw0) * (k / (n - 1)) + 2.6;
        const slope = Math.max(0, (pts[Math.max(k - 2, 0)][1] - pts[Math.min(k + 2, n - 1)][1]) / 16);
        let sp = speedBase + Math.min(slope * 6, 2.2);
        if (lipEnd) {
          // à l'approche du bord de la chute : le lit s'élargit à la largeur de la nappe et le courant accélère
          const e = smoothstep(n - 5, n - 1, k);
          hw = hw + (FW * 0.5 - hw) * e;
          sp *= 1 + 2.2 * Math.pow(k / (n - 1), 6);
        }
        // l'eau épouse le lit : jamais sous le fond, jamais plus de 1,2 m au-dessus (pas d'eau qui flotte)
        const bed = terrain.height(pts[k][0], pts[k][2]), wy = Math.min(Math.max(pts[k][1], bed + 0.15), bed + 1.2);
        for (const s of [-1, 1]) { rb.p.push(pts[k][0] - tz * hw * s, wy, pts[k][2] + tx * hw * s); rb.f.push(tx * sp, 0, tz * sp); }
      }
      for (let k = 0; k < n - 1; k++) { const a = base + k * 2; rb.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    };
    world.river.forEach((rv, i) => addRibbon(i === 0 ? rv.pts.slice(0, -1) : rv.pts, rv.halfW[0], rv.halfW[1], 0.5, i === 0));
    const pool = world.waterfall.pool, PR = Math.max(world.waterfall.poolR + 7, FW * 0.5 + 8);
    const lip = world.waterfall.lip, dir = world.waterfall.dir;
    const impact = new THREE.Vector3(lip[0] + dir[0] * 6, pool[1], lip[2] + dir[1] * 6);
    {
      // bassin en anneaux (assez de sommets pour les remous) ; le courant s'éloigne du pied de la chute
      const base = rb.p.length / 3, RINGS = 10, SEG = 48;
      const flowAt = (x, z) => {
        const dx = x - impact.x, dz = z - impact.z, d = Math.hypot(dx, dz) || 1;
        const s = 0.3 + 1.8 * Math.exp(-d / 9);
        return [dx / d * s, 0, dz / d * s];
      };
      rb.p.push(pool[0], pool[1], pool[2]); rb.f.push(...flowAt(pool[0], pool[2]));
      for (let k = 1; k <= RINGS; k++) {
        const r = PR * Math.pow(k / RINGS, 1.2);
        for (let s = 0; s < SEG; s++) {
          const a = s / SEG * Math.PI * 2, x = pool[0] + Math.cos(a) * r, z = pool[2] + Math.sin(a) * r;
          rb.p.push(x, pool[1], z); rb.f.push(...flowAt(x, z));
        }
      }
      for (let s = 0; s < SEG; s++) rb.i.push(base, base + 1 + ((s + 1) % SEG), base + 1 + s);
      for (let k = 1; k < RINGS; k++) for (let s = 0; s < SEG; s++) {
        const a = base + 1 + (k - 1) * SEG + s, b = base + 1 + (k - 1) * SEG + ((s + 1) % SEG);
        const c = a + SEG, d = b + SEG;
        rb.i.push(a, b, c, b, d, c);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rb.p, 3));
    rg.setAttribute('aFlow', new THREE.Float32BufferAttribute(rb.f, 3));
    rg.setIndex(rb.i);
    rg.computeBoundingSphere();
    const [rA, rB, rU] = waterMaterials({ RIVER: 1 }, { uImpact: { value: impact }, uImpactW: { value: new THREE.Vector4(-dir[1], dir[0], FW * 0.55, 0) } });
    this.setup(rU, terrain, sky);
    this.river = [new THREE.Mesh(rg, rA), new THREE.Mesh(rg, rB)];
    this.river.forEach((m, i) => { m.renderOrder = 12 + i; scene.add(m); });
    this.impact = impact;
    // cascade (nappe + brume au pied)
    this.fall = makeWaterfall(world);
    scene.add(this.fall);
    // caustiques sur le fond, dessinées seulement quand la caméra est sous l'eau (le relief a déjà les siennes vues d'en haut)
    this.caus = new THREE.Mesh(g, makeCausticMaterial(oU));
    this.caus.frustumCulled = false; this.caus.renderOrder = 9; this.caus.visible = false;
    scene.add(this.caus);
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
    this.caus.visible = camera.position.y < 0.3;
  }
}

// Largeur de la nappe de la cascade (propre à l'eau : 2,5 fois la nappe d'origine)
function fallWidth(world) { return world.waterfall.width * 1.3 * 2.5; }
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Caustiques du fond vues sous l'eau : grille de l'océan posée sur le relief, lumière ajoutée
function makeCausticMaterial(oU) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uHeight: oU.uHeight, uHN: oU.uHN, uGrid: oU.uGrid },
    vertexShader: /* glsl */`
      ${GLSL_HEIGHT}
      uniform vec3 uGrid; uniform vec3 uCamPos;
      varying vec3 vWP; varying float vDep;
      void main() {
        vec3 wp = vec3(position.x + uGrid.x, 0.0, position.z + uGrid.z);
        float h = terrainH(wp.xz);
        wp.y = h + 0.04 + distance(wp, uCamPos) * 0.002;
        vDep = -h; vWP = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_CAUS}
      varying vec3 vWP; varying float vDep;
      void main() {
        float dd = distance(uCamPos, vWP);
        if (vDep < 0.05 || dd > 120.0) discard;
        // deux réseaux superposés, le second plus fin, qui ondulent avec la houle
        float c = causNet(vWP.xz * 0.7, uTime * 1.3) * 0.65 + causNet(vWP.xz * 1.6 + 3.0, uTime * 1.7) * 0.35;
        vec4 lt = lightAt(vWP);
        vec3 Td = exp(-uSigma * vDep / max(uSunDir.y, 0.2));
        vec3 Tu = exp(-uSigma * dd * 1.15 - 0.018 * dd);
        vec3 col = uSunColor * max(uSunDir.y, 0.0) * lt.r * lt.b * Td * Tu * c * 0.16 * smoothstep(0.05, 0.6, vDep) * (1.0 - smoothstep(10.0, 22.0, vDep));
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
}

function makeWaterfall(world) {
  const lip = world.waterfall.lip, dir = world.waterfall.dir, pool = world.waterfall.pool;
  const drop = lip[1] - pool[1];
  const W = fallWidth(world), ROWS = 30, COLS = 28;
  const px = -dir[1], pz = dir[0];
  const pos = [], uv = [], idx = [];
  for (let r = 0; r <= ROWS; r++) {
    const t = r / ROWS;
    const y = lip[1] + 0.25 - (drop + 0.25) * t;
    const out = -0.8 + Math.sqrt(t) * 6.4;
    const w = W * (1 + t * 0.2);
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
    uniforms: { ...U, uDrop: { value: drop }, uW: { value: W } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vWP; varying vec3 vNrm;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; vNrm = normal; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      uniform float uDrop; uniform float uW;
      varying vec2 vUv; varying vec3 vWP; varying vec3 vNrm;
      void main() {
        float t = vUv.y;
        // temps de chute écoulé depuis le bord : les motifs suivent l'eau qui accélère (et s'étirent en stries)
        float tau = sqrt(t * uDrop / 4.9 + 0.04);
        float xm = (vUv.x - 0.5) * uW;
        float s1 = vnoise(vec2(xm * 1.1, (tau - uTime) * 7.0));
        float s2 = vnoise(vec2(xm * 3.4 + 7.0, (tau - uTime) * 14.0));
        float s3 = vnoise(vec2(xm * 0.35 + 3.0, (tau - uTime) * 2.6));
        float strands = s1 * 0.5 + s2 * 0.3 + s3 * 0.2;
        // bords effilochés et plus transparents, cœur blanc presque opaque
        float rag = (vnoise(vec2((tau - uTime) * 3.0, xm * 0.15)) - 0.5) * 0.16;
        float cx = abs(vUv.x - 0.5) * 2.0 + rag;
        float edge = 1.0 - smoothstep(0.72, 1.0, cx);
        float core = 1.0 - smoothstep(0.2, 0.85, cx);
        float white = smoothstep(0.01, 0.2, t);                 // lisse et vitreuse au départ, puis blanche
        float dens = mix(mix(0.35, 0.75, smoothstep(0.3, 0.7, strands)), mix(0.85, 1.0, strands), core);
        float alpha = mix(0.7, dens, white) * edge * smoothstep(0.0, 0.015, t);
        vec4 lt = lightAt(vWP);
        float sv = lt.r * lt.b;
        vec3 light = uSunColor * sv * (0.4 + 0.6 * max(dot(normalize(vNrm), uSunDir), 0.0)) + uSkyAmb * 3.14159;
        vec3 glass = uSkyAmb * vec3(0.35, 0.6, 0.55) + uSunColor * sv * 0.03;
        vec3 col = mix(glass, light * mix(0.6, 0.92, strands) / 3.14159, white);
        col = applyAerial(col, vWP);
        gl_FragColor = vec4(col * alpha, alpha);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 20;
  m.add(makeMist(world, W, drop));
  return m;
}

// Brume au pied de la chute : quelques grands panneaux doux tournés vers la caméra, qui montent et s'élargissent
function makeMist(world, W, drop) {
  const lip = world.waterfall.lip, dir = world.waterfall.dir, pool = world.waterfall.pool;
  const N = 10, rnd = mulberry32(77);
  const px = -dir[1], pz = dir[0];
  const pos = [], cor = [], seed = [], idx = [];
  for (let i = 0; i < N; i++) {
    const s = (i / (N - 1) - 0.5) * W * 0.85 + (rnd() - 0.5) * 2.0, o = 5.5 + rnd() * 4.0;
    const cx = lip[0] + dir[0] * o + px * s, cz = lip[2] + dir[1] * o + pz * s;
    const sd = (i * 0.618) % 1;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(cx, pool[1], cz); cor.push(u, v); seed.push(sd); }
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(cor, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(pool[0], pool[1] + drop * 0.3, pool[2]), W + drop);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uBase: { value: pool[1] }, uR: { value: Math.min(7 + W * 0.25, 14) }, uRise: { value: drop * 0.5 } },
    vertexShader: /* glsl */`
      uniform float uTime; uniform vec3 uCamPos; uniform float uR; uniform float uRise;
      attribute vec2 aCorner; attribute float aSeed;
      varying vec2 vC; varying float vA; varying vec3 vWP; varying float vS;
      void main() {
        float life = fract(uTime * 0.04 + aSeed);
        vec3 c = position + vec3(sin(aSeed * 40.0 + uTime * 0.2) * 1.5, 1.5 + life * uRise, cos(aSeed * 31.0 + uTime * 0.17) * 1.5);
        float rad = uR * (0.6 + 0.8 * life);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 wp = c + (right * aCorner.x + up * aCorner.y) * rad;
        vC = aCorner; vS = aSeed; vWP = wp;
        // apparaît, grossit, se dissout ; s'efface quand la caméra est dedans
        vA = sin(life * 3.14159) * smoothstep(rad * 0.3, rad * 1.2, distance(uCamPos, c));
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      uniform float uBase;
      varying vec2 vC; varying float vA; varying vec3 vWP; varying float vS;
      void main() {
        float n = vnoise(vC * 2.2 + vS * 17.0 + uTime * 0.12) * 0.65 + vnoise(vC * 5.3 - uTime * 0.2 + vS * 5.0) * 0.35;
        float a = (1.0 - smoothstep(0.15, 1.0, length(vC) + (n - 0.5) * 0.6)) * vA * 0.42;
        a *= smoothstep(uBase - 0.3, uBase + 2.5, vWP.y);    // pas d'arête dure contre l'eau du bassin
        if (a < 0.004) discard;
        vec4 lt = lightAt(vWP);
        vec3 col = (uSunColor * lt.r * lt.b * 0.55 + uSkyAmb * 3.14159) * 0.92 / 3.14159;
        col = applyAerial(col, vWP);
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 21;
  m.frustumCulled = false;
  return m;
}

export { WORLD };
// shaders exportés pour les essais (rechargement à chaud dans tools/test.mjs)
export { VS as WATER_VS, FS as WATER_FS, makeWaterfall };
