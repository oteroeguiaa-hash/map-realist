// Étangs de jungle : eau thé/ambre façon Amazonie, plus sombre avec la profondeur, petites vagues
// poussées par le vent, reflet du ciel. L'eau est découpée exactement par le relief : elle ne dépasse jamais du sol.
import * as THREE from 'three';
import { U, GLSL_COMMON } from './core.js';

export class Ponds {
  constructor(scene, T, ponds) {
    this.list = [];
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U, uHeight: { value: T.heightTex }, uN: { value: T.N } },
      vertexShader: /* glsl */`
        varying vec3 vWP;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        uniform sampler2D uHeight; uniform float uN;
        varying vec3 vWP;
        float hAt(vec2 xz) {
          vec2 f = (xz / uWorldSize + 0.5) * uN - 0.5;
          vec2 i = floor(f), t = f - i;
          float a = texelFetch(uHeight, ivec2(i), 0).r, b = texelFetch(uHeight, ivec2(i) + ivec2(1, 0), 0).r;
          float c = texelFetch(uHeight, ivec2(i) + ivec2(0, 1), 0).r, d = texelFetch(uHeight, ivec2(i) + ivec2(1, 1), 0).r;
          return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
        }
        float fade = 1.0;
        float wave(vec2 p) {
          vec2 w = uWindDir * uTime * 0.6;
          return vnoise(p * 1.7 + w) * 0.55 + vnoise(p * 3.9 - w * 1.7 + 11.0) * 0.3 + vnoise(p * 7.0 + w * 2.3 - 5.0) * 0.15 * fade;
        }
        void main() {
          float depth = vWP.y - hAt(vWP.xz);
          if (depth < 0.0) discard;
          // petites vagues : normale par différences finies
          fade = 1.0 - smoothstep(10.0, 40.0, distance(uCamPos, vWP));
          float e = 0.08, h0 = wave(vWP.xz), hx = wave(vWP.xz + vec2(e, 0.0)), hz = wave(vWP.xz + vec2(0.0, e));
          float amp = (0.03 + 0.05 * uWind) * (0.4 + 0.6 * fade);
          vec3 n = normalize(vec3(-(hx - h0) / e * amp, 1.0, -(hz - h0) / e * amp));
          vec3 v = normalize(uCamPos - vWP);
          float fres = 0.02 + 0.6 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
          vec4 lt = lightAt(vWP);
          float sv = lt.r * lt.b * mix(1.0, 0.55, lt.g);
          // couleur de l'eau : ambre clair au bord (on voit le fond), thé foncé au milieu
          vec3 shallow = vec3(0.42, 0.31, 0.15), mid = vec3(0.2, 0.13, 0.05), deep = vec3(0.07, 0.045, 0.018);
          vec3 body = mix(shallow, mid, smoothstep(0.0, 0.7, depth));
          body = mix(body, deep, smoothstep(0.6, 2.0, depth));
          // un peu de vert d'algues par endroits
          body = mix(body, body * vec3(0.8, 1.15, 0.75), vnoise(vWP.xz * 0.15) * 0.6);
          vec3 lit = body * (uSunColor * max(uSunDir.y, 0.0) * sv * 0.35 + vec3(dot(uSkyAmb, vec3(0.33))) * 1.5);
          vec3 refl = uSkyAmb * 1.6 * mix(1.0, 0.45, lt.g) * vec3(0.95, 0.9, 0.8);
          vec3 h = normalize(v + uSunDir);
          float spec = pow(max(dot(n, h), 0.0), 220.0) * 6.0 * sv;
          vec3 col = mix(lit, refl, fres) + uSunColor * spec;
          // liseré humide au bord
          col = mix(col * 0.7, col, smoothstep(0.0, 0.08, depth));
          float a = clamp(0.8 + depth * 0.2, 0.8, 0.97) * smoothstep(0.0, 0.04, depth);
          gl_FragColor = vec4(applyAerial(col, vWP), max(a, fres));
        }`,
      transparent: true, depthWrite: false,
    });
    for (const p of ponds) {
      const g = new THREE.CircleGeometry(p.r * 1.9, 48, 0, Math.PI * 2);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(p.x, p.level, p.z);
      m.renderOrder = 2;
      scene.add(m);
      this.list.push(m);
    }
  }
}

// niveau d'eau en (x, z) si l'on est dans un étang, sinon null
export function pondLevel(ponds, T, x, z) {
  for (const p of ponds || []) if (Math.hypot(x - p.x, z - p.z) < p.r * 1.9 && T.height(x, z) < p.level) return p.level;
  return null;
}
