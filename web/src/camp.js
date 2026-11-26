// Campement : enceinte de barrières en béton (les animaux ne peuvent pas entrer), poteaux avec appliques
// murales, projecteur de 20 000 lumens sur trépied, table en rondins avec bougeoir (flamme qui vacille).
// Les lumières s'allument au crépuscule ; ombres portées réelles pour chaque source.
import * as THREE from 'three';
import { patchMaterial, mergeGeometries, clamp } from './core.js';

const V3 = THREE.Vector3;

// Faisceau volumétrique : cône additif, fondu progressif vers les bords (Fresnel) et le long de la portée
export function makeBeam(len) {
  const g = new THREE.CylinderGeometry(0.02, 1, 1, 48, 24, true);
  g.translate(0, -0.5, 0);
  g.rotateX(Math.PI / 2); // pointe vers -z
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1, 0.95, 0.85) }, uStrength: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying float vT;
      void main() {
        vT = -position.z;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uStrength;
      varying vec3 vN; varying vec3 vV; varying float vT;
      void main() {
        float f = abs(dot(normalize(vN), normalize(vV)));
        float edge = pow(f, 2.2);                                    // bords du cône très doux
        float along = smoothstep(0.02, 0.3, vT) * pow(1.0 - vT, 2.2); // fondu vers le bout
        float a = edge * along * uStrength;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(g, mat);
  m.scale.set(1, 1, len);
  m.renderOrder = 6;
  m.frustumCulled = false;
  m.castShadow = false;
  return m;
}
// lumens -> paramètres de projecteur (three.js : puissance photométrique en lumens)
export function setSpot(light, lumens, angle) {
  light.angle = angle;
  light.power = lumens;
}

export class Camp {
  constructor(scene, T, world, bank, props, quality) {
    this.scene = scene; this.T = T; this.world = world; this.bank = bank; this.props = props;
    this.c = world.camp;
    this.lights = [];
    // ombres des lampes seulement en qualité Élevée/Ultra : sur téléphone chaque ombre coûte une texture
    // dans TOUS les matériaux (limite de 16), le sol ne s'afficherait plus
    this.shadows = quality >= 2;
    this.on = 0;
    if (!this.c) return;
    this.build();
    this.freeze();
  }
  model(name) {
    const o = this.bank.has(name) ? this.bank.instance(name, { measure: 'none' }) : null;
    if (o) o.traverse((m) => { if (m.isMesh) { m.material = patchMaterial(m.material, { key: 'camp' + m.material.name }); m.castShadow = true; m.receiveShadow = true; } });
    return o;
  }
  build() {
    const c = this.c, T = this.T, sc = this.scene;
    this.group = new THREE.Group(); sc.add(this.group);
    const wood = this.props.types.trunk2 ? this.props.types.trunk2.mat : new THREE.MeshStandardMaterial({ color: 0x6b4f35 });
    const metal = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.8 }), { key: 'campMetal' });
    // --- barrières tout autour (une ouverture face à la route) ---
    const proto = this.model('barrier');
    const toSpawn = Math.atan2(this.world.spawn.x - c.x, this.world.spawn.z - c.z);
    if (proto) {
      // un seul InstancedMesh par morceau du modèle (100 % de ses triangles), pas 18 copies
      const n = 18, mats = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const da = Math.abs(((a - toSpawn) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
        if (da < 0.2) continue; // entrée
        const x = c.x + Math.sin(a) * c.r, z = c.z + Math.cos(a) * c.r;
        mats.push(new THREE.Matrix4().compose(new V3(x, T.height(x, z) - 0.02, z), new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), a + Math.PI / 2), new V3(1, 1, 1)));
        this.props.colliders.push({ x, z, r: 0.75, top: T.height(x, z) + 1.1 });
      }
      proto.updateMatrixWorld(true);
      proto.traverse((o) => {
        if (!o.isMesh) return;
        const im = new THREE.InstancedMesh(o.geometry, o.material, mats.length);
        mats.forEach((m, i) => im.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(m, o.matrixWorld)));
        im.castShadow = true; im.receiveShadow = true;
        im.computeBoundingSphere();
        this.group.add(im);
      });
    }
    // --- poteaux + appliques murales (2, de part et d'autre de l'entrée) ---
    const sconce = this.model('sconce');
    for (const side of [-1, 1]) {
      const a = toSpawn + side * 0.42, x = c.x + Math.sin(a) * (c.r - 0.8), z = c.z + Math.cos(a) * (c.r - 0.8), y = T.height(x, z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 3.2, 10), wood);
      post.position.set(x, y + 1.5, z); post.castShadow = post.receiveShadow = true; this.group.add(post);
      this.props.colliders.push({ x, z, r: 0.18 });
      if (sconce) {
        const s = sconce.clone();
        const inward = Math.atan2(c.x - x, c.z - z);
        s.position.set(x + Math.sin(inward) * 0.12, y + 2.5, z + Math.cos(inward) * 0.12);
        s.rotation.y = inward;
        this.group.add(s);
      }
      const L = new THREE.SpotLight(0xffb45e, 0, 22, 1.05, 0.9, 2);
      L.position.set(x + Math.sin(Math.atan2(c.x - x, c.z - z)) * 0.3, y + 2.55, z + Math.cos(Math.atan2(c.x - x, c.z - z)) * 0.3);
      L.target.position.set(c.x, y, c.z);
      this.addLight(L, 600, 512);
    }
    // --- projecteur portable sur trépied, braqué vers la jungle ---
    const sl = this.model('searchlight');
    {
      const a = toSpawn + Math.PI, x = c.x + Math.sin(a) * (c.r - 2.2), z = c.z + Math.cos(a) * (c.r - 2.2), y = T.height(x, z);
      const legs = [];
      for (let k = 0; k < 3; k++) { const b = k / 3 * Math.PI * 2; const g = new THREE.CylinderGeometry(0.02, 0.025, 1.7, 6); g.translate(0, 0.85, 0); g.rotateZ(0.32); g.rotateY(b); legs.push(g); }
      const tri = new THREE.Mesh(mergeGeometries(legs), metal); tri.position.set(x, y, z); tri.castShadow = true; this.group.add(tri);
      const dir = new V3(Math.sin(a), -0.12, Math.cos(a)).normalize();
      if (sl) {
        sl.position.set(x, y + 1.62, z);
        sl.lookAt(x - dir.x, y + 1.62 - dir.y, z - dir.z); // l'avant du modèle (-z) vers l'extérieur
        sl.scale.setScalar(2.2); // le modèle mesure 25 cm : à l'échelle d'un vrai projecteur portable
        this.group.add(sl);
      }
      const L = new THREE.SpotLight(0xf4f6ff, 0, 160, 0.42, 0.9, 2);
      L.position.set(x + dir.x * 0.35, y + 1.62, z + dir.z * 0.35);
      L.target.position.set(x + dir.x * 40, y + 1.62 + dir.y * 40, z + dir.z * 40);
      this.addLight(L, 20000, 1024);
      const beam = makeBeam(55);
      beam.position.copy(L.position);
      beam.lookAt(L.target.position); beam.rotateY(Math.PI); // le cône pointe vers -z : on le retourne vers la cible
      beam.scale.set(Math.tan(0.42) * 55, Math.tan(0.42) * 55, 55);
      this.group.add(beam);
      this.searchBeam = beam;
    }
    // --- table en rondins + bougeoir ---
    {
      const x = c.x, z = c.z, y = T.height(x, z);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.8), wood); top.position.set(x, y + 0.78, z); top.castShadow = top.receiveShadow = true; this.group.add(top);
      for (const [u, v] of [[-0.7, -0.32], [0.7, -0.32], [-0.7, 0.32], [0.7, 0.32]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.78, 8), wood); leg.position.set(x + u, y + 0.39, z + v); leg.castShadow = true; this.group.add(leg); }
      this.props.colliders.push({ x, z, r: 0.7, top: y + 0.82 });
      this.tableTop = new V3(x, y + 0.82, z);
      const cd = this.model('candle');
      if (cd) { cd.position.set(x + 0.45, y + 0.82, z + 0.1); this.group.add(cd); }
      // flamme : petite lueur + lumière ponctuelle chaude qui vacille
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb25a }));
      flame.scale.set(1, 2.2, 1);
      flame.position.set(x + 0.45, y + 0.82 + 0.235, z + 0.1);
      this.group.add(flame); this.flame = flame;
      const L = new THREE.PointLight(0xff7a2e, 0, 14, 2);
      L.position.copy(flame.position).y += 0.03;
      this.addLight(L, 80, 256);
      this.candle = L;
    }
  }
  // décor fixe : matrices calculées une fois pour toutes
  freeze() { this.group.traverse((o) => { if (o !== this.flame) { o.updateMatrix(); o.matrixAutoUpdate = false; } }); this.group.updateMatrixWorld(true); }
  addLight(L, lumens, map) {
    L.castShadow = this.shadows;
    L.shadow.mapSize.set(map, map);
    L.shadow.bias = -0.0008;
    L.shadow.autoUpdate = false; L.shadow.needsUpdate = true;
    L.userData.lm = lumens;
    if (L.isSpotLight || L.isPointLight) L.power = 0;
    this.scene.add(L); if (L.target) this.scene.add(L.target);
    this.lights.push(L);
  }
  // nuit = lumières allumées ; ombres des lampes fixes remises à jour de temps en temps près du joueur
  update(dt, camPos, night) {
    if (!this.c) return;
    this.t = (this.t || 0) + dt;
    this.on += clamp((night ? 1 : 0) - this.on, -dt * 0.5, dt * 0.5);
    const dCamp = Math.hypot(camPos.x - this.c.x, camPos.z - this.c.z), near = dCamp < 120;
    // modèles d'origine très détaillés (100 % des triangles) : affichés seulement à portée de vue utile
    this.group.visible = dCamp < 90;
    for (const L of this.lights) {
      let k = this.on;
      if (L === this.candle) k = Math.max(k, 0.6) * (0.85 + Math.sin(this.t * 11) * 0.05 + Math.sin(this.t * 23.7) * 0.04 + Math.sin(this.t * 3.1) * 0.06);
      L.power = L.userData.lm * k * (near ? 1 : 0);
    }
    if (this.flame) this.flame.scale.set(1 + Math.sin(this.t * 17) * 0.1, 2.2 + Math.sin(this.t * 13) * 0.3, 1);
    if (this.searchBeam) this.searchBeam.material.uniforms.uStrength.value = 0.22 * this.on * (near ? 1 : 0);
    this.shT = (this.shT || 0) + dt;
    if (near && this.on > 0.05 && this.shT > 1.5) { this.shT = 0; for (const L of this.lights) L.shadow.needsUpdate = true; }
  }
  inside(x, z) { return this.c && Math.hypot(x - this.c.x, z - this.c.z) < this.c.r - 0.5; }
}
