// Rendu HDR hors écran puis passe finale : exposition, étalonnage léger, vignettage, tonemapping.
import * as THREE from 'three';

export class Post {
  constructor(renderer, msaa) {
    this.renderer = renderer;
    const gl = renderer.getContext();
    this.hdr = !!(renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
    this.msaa = msaa;
    this.scale = 1;
    this.rt = null;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, uTexel: { value: new THREE.Vector2() }, uSharpen: { value: 0 }, uVig: { value: 0.22 }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tScene; uniform vec2 uTexel; uniform float uSharpen; uniform float uVig; uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tScene, vUv).rgb;
          if (uSharpen > 0.0) {
            vec3 n = texture2D(tScene, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tScene, vUv - vec2(uTexel.x, 0.0)).rgb
                   + texture2D(tScene, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tScene, vUv - vec2(0.0, uTexel.y)).rgb;
            c = max(c + (c - n * 0.25) * uSharpen, vec3(0.0));
          }
          // légère saturation des tons moyens
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = max(mix(vec3(l), c, 1.06), vec3(0.0));
          vec2 q = vUv - 0.5;
          c *= 1.0 - uVig * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          float dn = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
          gl_FragColor.rgb += (dn - 0.5) / 255.0;
        }`,
      depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene();
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    q.frustumCulled = false;
    this.scene.add(q);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  setSize(w, h, scale) {
    this.scale = scale;
    const W = Math.max(64, Math.round(w * scale)), H = Math.max(64, Math.round(h * scale));
    if (this.rt && this.rt.width === W && this.rt.height === H) return;
    if (this.rt) this.rt.dispose();
    if (!this.hdr) { this.rt = null; return; }
    this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: this.msaa, depthBuffer: true, stencilBuffer: false });
    this.rt.texture.minFilter = this.rt.texture.magFilter = THREE.LinearFilter;
    this.rt.texture.generateMipmaps = false;
    this.mat.uniforms.tScene.value = this.rt.texture;
    this.mat.uniforms.uTexel.value.set(1 / W, 1 / H);
    this.mat.uniforms.uSharpen.value = scale < 0.95 ? 0.35 * (1 - scale) / 0.5 + 0.12 : 0.08;
  }
  render(scene, camera, time) {
    const r = this.renderer;
    if (!this.rt) { r.setRenderTarget(null); r.render(scene, camera); return; }
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    this.mat.uniforms.uTime.value = time % 100;
    r.render(this.scene, this.cam);
  }
}
