// Chargement des modèles .glb du joueur : en parallèle, sans bloquer, avec délai maximal,
// normalisation de taille (Box3) et pose au sol, animations (AnimationMixer).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { fetchBuf } from './core.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

// Orientation de chaque modèle : rotation de correction (avant normalisation) et dimension de référence.
// size : taille cible en mètres ; measure : 'height' | 'length' (plus grande dimension horizontale) | 'max'
export const MODEL_SPECS = {
  palm: { size: 10, measure: 'height' },
  jungle: { size: 12.5, measure: 'height' },
  monstera: { size: 1.1, measure: 'height' },
  plants: { size: 1, measure: 'none' },
  rocks: { size: 1, measure: 'none' },
  buggy: { size: 4.1, measure: 'length' },
  plane: { size: 9, measure: 'length' },
  axe: { size: 0.85, measure: 'max' },
  rivelaine: { size: 0.6, measure: 'max' },
  tiger: { size: 2.9, measure: 'length' },
  jaguar: { size: 1.9, measure: 'length' },
  komodo: { size: 2.6, measure: 'length' },
  boar: { size: 1.4, measure: 'length' },
  python: { size: 1.1, measure: 'length' },
  croc: { size: 4.2, measure: 'length' },
  monkey: { size: 0.75, measure: 'height' },
  crab: { size: 0.32, measure: 'length' },
  turtle: { size: 1.0, measure: 'length' },
  fishschool: { size: 7, measure: 'max' },
  shark: { size: 4.2, measure: 'max' },
  parrot: { size: 0.9, measure: 'max' },
  aracari: { size: 0.45, measure: 'max' },
  parrots: { size: 0.9, measure: 'max' },
  seagull: { size: 1.3, measure: 'max' },
};

export class ModelBank {
  constructor(base, manifest) {
    this.base = base; this.manifest = manifest;
    this.gltf = {};
    this.status = {};
    this.listeners = [];
  }
  // Lance tous les chargements en parallèle (ordre de priorité respecté), sans attendre
  loadAll(order, timeoutMs = 45000) {
    const jobs = order.filter((k) => this.manifest[k]).map((k) => this.load(k, timeoutMs));
    return Promise.allSettled(jobs);
  }
  load(name, timeoutMs = 45000) {
    if (this.status[name]) return this.status[name].promise;
    const entry = this.manifest[name];
    const st = (this.status[name] = { state: 'loading' });
    const work = (async () => {
      const buf = await fetchBuf(`${this.base}/${entry.file}`);
      return loader.parseAsync(buf, '');
    })();
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('délai dépassé')), timeoutMs));
    st.promise = Promise.race([work, timeout]).then((g) => {
      this.gltf[name] = g;
      st.state = 'ok';
      this.listeners.forEach((f) => f(name, g));
      return g;
    }).catch((e) => {
      st.state = 'failed';
      console.warn(`Modèle ignoré (${name}) :`, e && e.message);
      return null;
    });
    return st.promise;
  }
  onLoaded(f) { this.listeners.push(f); for (const k in this.gltf) f(k, this.gltf[k]); }
  has(name) { return !!this.gltf[name]; }
  // Instance normalisée : groupe externe (à placer dans le monde) contenant le modèle remis à l'échelle et posé au sol
  instance(name, opts = {}) {
    const g = this.gltf[name];
    if (!g) return null;
    const spec = { ...MODEL_SPECS[name], ...opts };
    const src = g.scene;
    const model = spec.clone === false ? src : SkeletonUtils.clone(src);
    const outer = new THREE.Group();
    outer.name = name;
    const inner = new THREE.Group();
    inner.add(model);
    outer.add(inner);
    if (spec.rot) inner.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
    fitToGround(inner, spec.size, spec.measure);
    model.traverse((o) => {
      if (o.isMesh) { o.castShadow = spec.castShadow ?? true; o.receiveShadow = true; o.frustumCulled = !o.isSkinnedMesh; }
    });
    outer.userData.animations = g.animations || [];
    return outer;
  }
}

export function fitToGround(inner, size, measure) {
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner, true);
  const s = box.getSize(new THREE.Vector3());
  if (measure && measure !== 'none') {
    const cur = measure === 'height' ? s.y : measure === 'length' ? Math.max(s.x, s.z) : Math.max(s.x, s.y, s.z);
    if (cur > 1e-6) inner.scale.multiplyScalar(size / cur);
  }
  inner.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(inner, true);
  const c = b2.getCenter(new THREE.Vector3());
  inner.position.x -= c.x; inner.position.z -= c.z; inner.position.y -= b2.min.y;
  inner.updateMatrixWorld(true);
  return b2;
}

// Animation : mixeur + recherche d'un clip par mots-clés
export function makeMixer(obj) {
  const clips = obj.userData.animations || [];
  if (!clips.length) return null;
  const mixer = new THREE.AnimationMixer(obj);
  const pick = (...keys) => clips.find((c) => keys.some((k) => c.name.toLowerCase().includes(k))) || null;
  return { mixer, clips, pick, action: null };
}
