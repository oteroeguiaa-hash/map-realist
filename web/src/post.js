// Chaîne d'effets officielle de three.js : EffectComposer → RenderPass → étalonnage → UnrealBloomPass → OutputPass.
// L'OutputPass applique le tonemapping ACES Filmic (renderer.toneMappingExposure) et la conversion sRGB.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Étalonnage : exposition automatique (ciel physique) ramenée à l'exposition fixe de l'OutputPass,
// légère saturation, vignettage, grain anti-bandes.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uExpo: { value: 1 }, uVig: { value: 0.2 }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uExpo; uniform float uVig; uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb * uExpo;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = max(mix(vec3(l), c, 1.07), vec3(0.0));
      vec2 q = vUv - 0.5;
      c *= 1.0 - uVig * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
      float dn = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      c += (dn - 0.5) * 0.002 * (l + 0.05);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export const OUTPUT_EXPOSURE = 1.15;

export class Post {
  constructor(renderer, scene, camera, msaa) {
    this.renderer = renderer;
    this.msaa = msaa;
    const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.grade = new ShaderPass(GradeShader);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.25, 0.6, 0.85);
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.expo = 1;
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
  }
  // exposure : exposition totale voulue (calculée d'après la lumière du ciel)
  render(dt, time, exposure) {
    this.grade.uniforms.uExpo.value = exposure / OUTPUT_EXPOSURE;
    this.grade.uniforms.uTime.value = time % 100;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = OUTPUT_EXPOSURE;
    this.composer.render(dt);
  }
}
