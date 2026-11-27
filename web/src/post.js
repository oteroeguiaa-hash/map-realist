// Chaîne d'effets officielle de three.js : EffectComposer → RenderPass → rayons de soleil → étalonnage → UnrealBloomPass → OutputPass.
// L'OutputPass applique le tonemapping ACES Filmic (renderer.toneMappingExposure) et la conversion sRGB.
//
// Rayons de soleil (god rays), méthode « flou radial » bon marché :
//  1. masque : seuls les pixels de CIEL (profondeur au fond) très lumineux et proches du soleil à l'écran,
//     à résolution réduite (demi-résolution au plus, ≤ 480 px de large) ;
//  2. flou radial vers la position du soleil en deux passes de 12 échantillons (≈ 144 effectifs) ;
//  3. le résultat est ajouté à l'image dans la passe d'étalonnage (avant le bloom), seulement devant les
//     objets (profondeur pleine résolution) : le ciel reste net, les faisceaux se découpent sur le feuillage.
// Sous l'eau : faisceaux procéduraux (aucune texture) qui descendent de la surface, calculés dans la passe
// d'étalonnage à pleine résolution, animés, plus visibles avec l'épaisseur d'eau traversée.
// La profondeur vient d'une DepthTexture attachée à la cible du RenderPass (la profondeur y était déjà
// résolue avec le MSAA). Aucune texture n'est ajoutée aux matériaux de la scène.
//
// API :
//  post.setSun(screenPos, visible, strength)
//    screenPos : THREE.Vector2, position du soleil à l'écran en 0..1 (origine en bas à gauche, peut sortir
//                de l'écran) ; visible : faux = rayons coupés (aucune passe en plus) ;
//    strength  : intensité 0..1.
//  post.updateSun(camera, sunDir)
//    raccourci appelé à chaque image : calcule screenPos, la visibilité (soleil devant la caméra, au-dessus
//    de l'horizon, caméra hors de l'eau) et l'intensité d'après la hauteur du soleil, puis appelle setSun ;
//    caméra sous l'eau (y < 0) : appelle setUnderwater avec le point de fuite du soleil réfracté.
//  post.setUnderwater(on, screenPos, strength)
//    faisceaux sous l'eau : on (booléen), point de fuite à l'écran 0..1, intensité 0..1.
//  post.rays.enabled = false coupe complètement l'effet ; post.rays.gain règle l'intensité globale.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { U } from './core.js';

// Étalonnage : exposition automatique (ciel physique) ramenée à l'exposition fixe de l'OutputPass,
// légère saturation, vignettage, grain anti-bandes, ajout des rayons de soleil.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uExpo: { value: 1 }, uVig: { value: 0.2 }, uTime: { value: 0 }, uTexel: { value: new THREE.Vector2(1e-3, 1e-3) }, uSharp: { value: 0.2 },
    tRays: { value: null }, uRayK: { value: 0 }, tDepth: { value: null }, uNearFar: { value: new THREE.Vector2(0.3, 45000) },
    uUW: { value: 0 }, uUWSun: { value: new THREE.Vector2(0.5, 1.5) }, uUWCol: { value: new THREE.Color() }, uAspect: { value: 2 }, uRayTime: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uExpo; uniform float uVig; uniform float uTime; uniform vec2 uTexel; uniform float uSharp;
    uniform sampler2D tRays; uniform float uRayK; uniform sampler2D tDepth; uniform vec2 uNearFar;
    uniform float uUW; uniform vec2 uUWSun; uniform vec3 uUWCol; uniform float uAspect; uniform float uRayTime;
    varying vec2 vUv;
    // bruit 1D périodique (période 64) pour les faisceaux sous l'eau
    float h1(float i) { return fract(sin(mod(i, 64.0) * 127.1) * 43758.5453); }
    float n1(float x) { float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // netteté adaptative (compense la résolution réduite sur téléphone)
      vec3 n = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb
             + texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
      vec3 mx = max(c, n * 0.25 + 0.001);
      c = max(c + (c - n * 0.25) * uSharp * clamp(0.25 / dot(mx, vec3(0.33)), 0.0, 1.0), vec3(0.0));
      c = min(c, vec3(30000.0));
      if (uRayK > 0.0 || uUW > 0.0) {
        float dz = texture2D(tDepth, vUv).r;
        float dist = uNearFar.x * uNearFar.y / (uNearFar.y - dz * (uNearFar.y - uNearFar.x));
        // rayons de soleil (même unité que l'image : lumière du ciel diffusée dans l'air), posés seulement
        // devant les objets et proportionnellement à l'épaisseur d'air traversée : le ciel et les objets
        // proches restent nets, sans voile laiteux
        if (uRayK > 0.0) c += texture2D(tRays, vUv).rgb * (uRayK * (1.0 - 0.85 * step(0.9999995, dz)) * (1.0 - exp(-dist * 0.03)));
        // sous l'eau : faisceaux qui descendent de la surface (droites parallèles au soleil réfracté,
        // donc rayonnant depuis son point de fuite à l'écran), lents et ondulants, calculés à pleine
        // résolution (nets), plus visibles avec la distance d'eau traversée
        if (uUW > 0.0) {
          vec2 q = (vUv - uUWSun) * vec2(uAspect, 1.0);
          float r = length(q);
          float x = atan(q.y, q.x) * (64.0 / 6.2831853);
          float s = n1(x * 1.0 + 7.0 + uRayTime * 0.23) * 0.6 + n1(x * 2.0 + 31.0 - uRayTime * 0.37) * 0.4;
          s = smoothstep(0.45, 0.95, s);
          s *= 0.75 + 0.25 * sin(r * 9.0 - uRayTime * 1.3 + x * 0.7);
          float scat = 1.0 - exp(-dist * 0.06);
          c += uUWCol * (s * scat * smoothstep(0.03, 0.3, r) * exp(-r * 0.7) * uUW);
        }
      }
      c *= uExpo;
      // étalonnage photo : couleurs naturelles (un peu moins saturées), contraste doux autour du gris moyen
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = max(mix(vec3(l), c, 0.9), vec3(0.0));
      c = pow(c / 0.18 + 1e-5, vec3(1.07)) * 0.18;
      vec2 q = vUv - 0.5;
      c *= 1.0 - uVig * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
      float dn = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      c += (dn - 0.5) * 0.002 * (l + 0.05);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// Masque : ciel lumineux autour du soleil (4 échantillons : masque stable malgré la basse résolution)
const RayMaskShader = {
  uniforms: { tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 2 }, uExpo: { value: 1 }, uTexel: { value: new THREE.Vector2(1e-3, 1e-3) } },
  vertexShader: QUAD_VS,
  fragmentShader: /* glsl */`
    uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uSun; uniform float uAspect; uniform float uExpo; uniform vec2 uTexel;
    varying vec2 vUv;
    vec3 tap(vec2 uv) {
      // profondeur au fond = ciel (le dôme n'écrit pas la profondeur)
      float sky = step(0.9999995, texture2D(tDepth, uv).r);
      vec3 c = min(texture2D(tColor, uv).rgb, vec3(30000.0));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722)) * uExpo;
      // seuil doux : seul le ciel très lumineux (halo du soleil, trouées dans la canopée) produit des rayons ;
      // plafond pour que le disque solaire ne sature pas tout
      return c * (sky * smoothstep(1.2, 3.5, l) * min(1.0, 2.5 / max(l, 1e-4)));
    }
    void main() {
      vec2 o = uTexel;
      vec3 m = (tap(vUv + vec2(-o.x, -o.y)) + tap(vUv + vec2(o.x, -o.y)) + tap(vUv + vec2(-o.x, o.y)) + tap(vUv + vec2(o.x, o.y))) * 0.25;
      vec2 dv = (vUv - uSun) * vec2(uAspect, 1.0);
      m *= exp(-dot(dv, dv) * 3.5);
      gl_FragColor = vec4(m, 1.0);
    }`,
};

// Flou radial vers le soleil : 12 échantillons, décroissance exponentielle
const RayBlurShader = {
  uniforms: { tMask: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uLen: { value: 1 }, uDecay: { value: 0.95 }, uJit: { value: 1 } },
  vertexShader: QUAD_VS,
  fragmentShader: /* glsl */`
    uniform sampler2D tMask; uniform vec2 uSun; uniform float uLen; uniform float uDecay; uniform float uJit;
    varying vec2 vUv;
    void main() {
      vec2 d = (vUv - uSun) * (uLen / 12.0);
      // léger décalage par pixel : casse les bandes entre échantillons
      float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      vec2 uv = vUv - d * j * uJit;
      vec3 acc = vec3(0.0);
      float w = 1.0, ws = 0.0;
      for (int i = 0; i < 12; i++) {
        acc += texture2D(tMask, uv).rgb * w;
        ws += w; w *= uDecay; uv -= d;
      }
      gl_FragColor = vec4(acc / ws, 1.0);
    }`,
};

// Passe des rayons : lit la sortie du RenderPass (couleur + profondeur), n'écrit que dans ses petites cibles.
class SunRaysPass extends Pass {
  constructor(grade) {
    super();
    this.needsSwap = false;
    this.grade = grade;
    const opt = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(16, 16, opt);
    this.rtB = new THREE.WebGLRenderTarget(16, 16, opt);
    const mat = (S) => new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(S.uniforms), vertexShader: S.vertexShader, fragmentShader: S.fragmentShader, depthTest: false, depthWrite: false });
    this.mask = new FullScreenQuad(mat(RayMaskShader));
    this.blur = new FullScreenQuad(mat(RayBlurShader));
    this.sun = new THREE.Vector2(0.5, 0.5);
    this.visible = false;
    this.strength = 0;
    this.expo = 1;
    this.aspect = 2;
    this.gain = 0.28; // intensité globale des rayons (discrète : pas d'image délavée face au soleil)
    this.uw = 0; // intensité des faisceaux sous l'eau
  }
  setSize(w, h) {
    // au plus demi-résolution, et ≤ 480 px de large
    const div = Math.max(2, w / 480);
    const W = Math.max(32, Math.round(w / div)), H = Math.max(16, Math.round(h / div));
    this.rtA.setSize(W, H); this.rtB.setSize(W, H);
    this.mask.material.uniforms.uTexel.value.set(0.5 / W, 0.5 / H);
    this.aspect = w / Math.max(h, 1);
  }
  render(renderer, writeBuffer, readBuffer) {
    const g = this.grade.uniforms;
    // profondeur nécessaire : attachée à la cible du RenderPass la première fois (effet dès l'image suivante)
    if (!readBuffer.depthTexture) {
      readBuffer.depthTexture = new THREE.DepthTexture(readBuffer.width, readBuffer.height);
      g.uRayK.value = 0; g.uUW.value = 0;
      return;
    }
    g.tDepth.value = readBuffer.depthTexture;
    g.uAspect.value = this.aspect;
    g.uUW.value = this.uw;
    if (!this.visible || this.strength < 0.01) { g.uRayK.value = 0; return; }
    const mu = this.mask.material.uniforms, bu = this.blur.material.uniforms;
    mu.tColor.value = readBuffer.texture; mu.tDepth.value = readBuffer.depthTexture;
    mu.uSun.value.copy(this.sun); mu.uAspect.value = this.aspect; mu.uExpo.value = this.expo;
    renderer.setRenderTarget(this.rtA);
    this.mask.render(renderer);
    // passe 1 : grands pas (rayons longs) ; passe 2 : pas 12 fois plus fins (comble les trous entre échantillons)
    bu.uSun.value.copy(this.sun);
    bu.tMask.value = this.rtA.texture; bu.uLen.value = 0.9; bu.uDecay.value = 0.88; bu.uJit.value = 1;
    renderer.setRenderTarget(this.rtB);
    this.blur.render(renderer);
    bu.tMask.value = this.rtB.texture; bu.uLen.value = 0.9 / 12; bu.uDecay.value = 0.99; bu.uJit.value = 0;
    renderer.setRenderTarget(this.rtA);
    this.blur.render(renderer);
    g.tRays.value = this.rtA.texture;
    g.uRayK.value = this.strength * this.gain;
  }
  dispose() { this.rtA.dispose(); this.rtB.dispose(); this.mask.material.dispose(); this.blur.material.dispose(); }
}

export const OUTPUT_EXPOSURE = 1.15;

export class Post {
  constructor(renderer, scene, camera, msaa) {
    this.renderer = renderer;
    this.msaa = msaa;
    const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.grade = new ShaderPass(GradeShader);
    this.rays = new SunRaysPass(this.grade);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.25, 0.6, 0.85);
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.rays);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.expo = 1;
    this._v = new THREE.Vector3(); this._f = new THREE.Vector3(); this._r = new THREE.Vector3(); this._s = new THREE.Vector2();
  }
  // Rayons de soleil : position écran (0..1), visibilité, intensité 0..1
  setSun(screenPos, visible, strength) {
    this.rays.sun.copy(screenPos);
    this.rays.visible = !!visible;
    this.rays.strength = visible ? strength : 0;
  }
  // Calcule les paramètres des rayons depuis la caméra et la direction (unitaire) du soleil
  updateSun(camera, sunDir) {
    camera.getWorldDirection(this._f);
    const facing = this._f.dot(sunDir);
    const p = this._v.copy(sunDir).multiplyScalar(1000).add(camera.position).project(camera);
    this._s.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    // nul derrière la caméra (fondu quand le soleil sort du champ), plus fort soleil bas, nul la nuit et sous l'eau
    const y = sunDir.y, S = THREE.MathUtils.smoothstep;
    const k = S(facing, 0.05, 0.45) * S(y, -0.03, 0.06) * (1 - 0.45 * S(y, 0.35, 0.95));
    const under = camera.position.y < 0;
    this.setSun(this._s, k > 0.01 && !under, k);
    // sous l'eau : point de fuite des faisceaux = soleil réfracté (Snell, n = 1,33) devant la caméra,
    // ou son opposé (vers le fond) quand on regarde vers le bas
    if (under) {
      const r = this._r.set(sunDir.x / 1.33, 0, sunDir.z / 1.33);
      r.y = Math.sqrt(Math.max(0, 1 - r.x * r.x - r.z * r.z));
      const sgn = this._f.dot(r) >= 0 ? 1 : -1;
      const q = this._v.copy(r).multiplyScalar(1000 * sgn).add(camera.position).project(camera);
      this._s.set(q.x * 0.5 + 0.5, q.y * 0.5 + 0.5);
      // plus discret en profondeur, nul la nuit
      this.setUnderwater(true, this._s, S(y, -0.02, 0.12) * Math.exp(camera.position.y * 0.07));
    } else this.setUnderwater(false);
    this.grade.uniforms.uNearFar.value.set(camera.near, camera.far);
  }
  // Faisceaux de lumière sous l'eau : point de fuite à l'écran (0..1), intensité 0..1
  setUnderwater(on, screenPos, strength = 1) {
    this.rays.uw = on ? strength : 0;
    if (!on) return;
    this.grade.uniforms.uUWSun.value.copy(screenPos);
    // couleur : même lumière que l'eau (voir underwaterTint dans core.js), en plus fort
    const sc = U.uSunColor.value, sa = U.uSkyAmb.value, sy = Math.max(U.uSunDir.value.y, 0);
    this.grade.uniforms.uUWCol.value.setRGB((sc.r * sy + sa.r * 3.14) * 0.0008, (sc.g * sy + sa.g * 3.14) * 0.0075, (sc.b * sy + sa.b * 3.14) * 0.009);
  }
  setMSAA(n) {
    this.msaa = n;
    this.composer.renderTarget1.samples = n;
    this.composer.renderTarget2.samples = n;
    this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose();
  }
  setSize(w, h, scale, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio * scale);
    this.composer.setSize(w, h);
    const W = Math.round(w * pixelRatio * scale), H = Math.round(h * pixelRatio * scale);
    this.grade.uniforms.uTexel.value.set(1 / W, 1 / H);
    this.grade.uniforms.uSharp.value = scale < 0.95 ? 0.25 + (1 - scale) * 0.7 : 0.15;
  }
  // exposure : exposition totale voulue (calculée d'après la lumière du ciel)
  render(dt, time, exposure) {
    this.grade.uniforms.uExpo.value = exposure / OUTPUT_EXPOSURE;
    this.grade.uniforms.uTime.value = time % 100;
    this.grade.uniforms.uRayTime.value = time % 1000;
    this.rays.expo = exposure;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = OUTPUT_EXPOSURE;
    this.composer.render(dt);
  }
}
