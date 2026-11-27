// Empreintes de pas dans le sable : creux sombre et humide, orienté dans le sens de la marche,
// qui s'estompe lentement. Une seule géométrie instanciée (anneau de 400 empreintes).
import * as THREE from 'three';
import { patchMaterial } from './core.js';

export class Footprints {
  constructor(scene, T, max = 400) {
    this.T = T; this.max = max; this.n = 0; this.head = 0;
    // forme de pied : ovale allongé, plus large à l'avant
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.13);
    shape.bezierCurveTo(0.06, -0.13, 0.05, 0.02, 0.055, 0.08);
    shape.bezierCurveTo(0.06, 0.14, -0.06, 0.14, -0.055, 0.08);
    shape.bezierCurveTo(-0.05, 0.02, -0.06, -0.13, 0, -0.13);
    const g = new THREE.ShapeGeometry(shape, 6);
    g.rotateX(-Math.PI / 2);
    this.age = new Float32Array(max);
    this.aAge = new THREE.InstancedBufferAttribute(this.age, 1);
    g.setAttribute('aAge', this.aAge);
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x3b2f22, roughness: 0.35, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }), {
      key: 'footprint', canopy: 0.3,
      vertexPars: 'attribute float aAge; varying float vAge;',
      vertexMain: 'vAge = aAge;',
      fragmentPars: 'varying float vAge;',
      fragmentMain: 'diffuseColor.a *= 0.55 * (1.0 - smoothstep(20.0, 60.0, vAge));',
    });
    this.mesh = new THREE.InstancedMesh(g, mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._up = new THREE.Vector3(0, 1, 0);
  }
  add(x, z, yaw, side) {
    const k = this.head; this.head = (this.head + 1) % this.max; this.n = Math.min(this.n + 1, this.max);
    const ox = Math.cos(yaw) * side * 0.12, oz = -Math.sin(yaw) * side * 0.12;
    const px = x + ox, pz = z + oz;
    this._q.setFromAxisAngle(this._up, yaw + Math.PI);
    this._m.compose(this._p.set(px, this.T.height(px, pz) + 0.015, pz), this._q, this._s.set(side, 1, 1));
    this.mesh.setMatrixAt(k, this._m);
    this.age[k] = 0;
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  update(dt) {
    if (!this.n) return;
    for (let i = 0; i < this.n; i++) this.age[i] += dt;
    this.aAge.needsUpdate = true;
  }
}
