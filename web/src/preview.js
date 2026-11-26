// Page de contrôle (tests uniquement) : affiche chaque modèle normalisé, vu de face et de côté.
import * as THREE from 'three';
import { ModelBank } from './models.js';
import { fetchJSON } from './core.js';

const r = new THREE.WebGLRenderer({ antialias: true });
r.setSize(1400, 900);
document.body.appendChild(r.domElement);
r.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb4c2);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(3, 5, 4); scene.add(sun);
const cam = new THREE.OrthographicCamera(-14, 14, 9, -9, -100, 100);
window.__preview = { ready: false };
const names = new URLSearchParams(location.search).get('m')?.split(',') ;
const manifest = await fetchJSON('assets/glb/manifest.json');
const list = names || Object.keys(manifest);
const bank = new ModelBank('assets', manifest);
await bank.loadAll(list, 60000);
const labels = [];
list.forEach((name, i) => {
  const o = bank.instance(name, { measure: 'max', size: 3.2 });
  if (!o) { labels.push(name + ' (échec)'); return; }
  const col = i % 7, row = Math.floor(i / 7);
  o.position.set(-12 + col * 4, 5.5 - row * 4.6, 0);
  if (new URLSearchParams(location.search).get('v') === 'side') o.rotation.y = -Math.PI / 2;
  scene.add(o);
  labels.push(name);
  // repère : petit cube rouge sur +z (avant supposé), bleu sur +x
  const z = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
  z.position.set(o.position.x, o.position.y, 2);
  scene.add(z);
});
const view = new URLSearchParams(location.search).get('v') || 'front';
if (view === 'front') { cam.position.set(0, 0, 50); cam.lookAt(0, 0, 0); }
else if (view === 'side') { cam.position.set(0, 0, 50); cam.lookAt(0, 0, 0); }
else { cam.position.set(0, 50, 0.01); cam.lookAt(0, 0, 0); }
cam.updateProjectionMatrix();
r.render(scene, cam);
const div = document.createElement('div');
div.style.cssText = 'position:absolute;left:0;top:0;width:1400px;height:900px;font:12px monospace;color:#000';
list.forEach((n, i) => { const col = i % 7, row = Math.floor(i / 7); const e = document.createElement('div'); e.textContent = labels[i]; e.style.cssText = `position:absolute;left:${(col * 4 - 12 + 14) / 28 * 1400 - 40}px;top:${(9 - (5.5 - row * 4.6) + 1.9) / 18 * 900}px`; div.appendChild(e); });
document.body.appendChild(div);
window.__preview.ready = true;
