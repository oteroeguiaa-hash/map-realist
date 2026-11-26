// Optimise les modèles .glb du joueur (dépôt ile-3d) pour le mobile :
// textures réduites et converties en WebP, maillages simplifiés, matériaux convertis en PBR standard.
// Sortie : assets/glb/<nom>.data.json (GLB encodé en base64) + assets/glb/manifest.json (crédits, tailles).
// Usage : node tools/prep_glb.mjs <dossier des .glb>
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, metalRough, join, resample, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const SRC = process.argv[2];
const OUT = new URL('../assets/glb/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

// kind : veg (végétation instanciée), rock, vehicle, tool, animal
const MODELS = {
  palm: { src: 'tropical_palm_tree.glb', tex: 1024, tris: 2200, err: 0.01, kind: 'veg' },
  jungle: { src: 'jungle_tree.glb', tex: 1024, tris: 3500, err: 0.01, kind: 'veg' },
  monstera: { src: 'monstera_plants.glb', tex: 1024, kind: 'veg' },
  plants: { src: 'tropical_plants_pack_m02p.glb', tex: 768, ratio: 0.3, err: 0.05, minTris: 1500, kind: 'veg', drop: /Circle_BG/ },
  rocks: { src: 'rochers_calcaires.glb', tex: 1024, tris: 6000, err: 0.04, kind: 'rock' },
  buggy: { src: 'apocalyptic_off_road_buggy.glb', tex: 1024, ratio: 0.55, kind: 'vehicle' },
  plane: { src: 'avion_jgp.glb', tex: 1024, ratio: 0.45, minTris: 800, kind: 'vehicle', join: true },
  axe: { src: 'viking_axe__hache_vinking.glb', tex: 512, ratio: 0.05, minTris: 400, kind: 'tool' },
  rivelaine: { src: 'rivelaine.glb', tex: 512, tris: 3500, kind: 'tool' },
  tiger: { src: 'tiger.glb', tex: 1024, tris: 12000, kind: 'animal' },
  jaguar: { src: 'jaguar.glb', tex: 1024, ratio: 0.6, minTris: 600, kind: 'animal' },
  komodo: { src: 'komodo.glb', tex: 512, tris: 8000, err: 0.01, kind: 'animal', join: true },
  boar: { src: 'boar_-_realistic_3d_model_demo_free.glb', tex: 1024, ratio: 0.7, minTris: 600, kind: 'animal' },
  python: { src: 'ball_python__piton_bola.glb', tex: 1024, tris: 9000, kind: 'animal' },
  croc: { src: 'nile_crocodile_swimming.glb', tex: 1024, kind: 'animal', noGeometryChange: true },
  monkey: { src: 'low_poly_monkey_animal_3d_model_free.glb', tex: 512, kind: 'animal' },
  crab: { src: 'crab_7-_eleven.glb', tex: 512, tris: 2500, err: 0.01, kind: 'animal', join: true },
  turtle: { src: 'model_50a_-_hawksbill_sea_turtle.glb', tex: 512, kind: 'animal' },
  fishschool: { src: 'the_fish_particle.glb', tex: 512, kind: 'animal' },
  shark: { src: 'great_white_shark.glb', tex: 512, kind: 'animal' },
  parrot: { src: 'parrot.glb', tex: 512, tris: 7000, kind: 'animal' },
  aracari: { src: 'aracari_a_collier.glb', tex: 512, tris: 6000, kind: 'animal' },
  parrots: { src: 'parrots_of_the_caribbean.glb', tex: 512, kind: 'animal' },
  seagull: { src: 'seagull.glb', tex: 512, kind: 'animal' },
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'sharp': sharp, 'meshopt.encoder': MeshoptEncoder });
// option : node tools/prep_glb.mjs <dossier> palm,rocks  → ne refait que ces modèles
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const MF = path.join(OUT, 'manifest.json');
const manifest = ONLY && fs.existsSync(MF) ? JSON.parse(fs.readFileSync(MF, 'utf8')) : {};
let total = 0;
for (const [name, cfg] of Object.entries(MODELS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  const file = path.join(SRC, cfg.src);
  if (!fs.existsSync(file)) { console.log('absent :', cfg.src); continue; }
  const doc = await io.read(file);
  const root = doc.getRoot();
  const extras = root.getAsset().extras || {};
  // nœuds à retirer
  if (cfg.drop) for (const n of root.listNodes()) if (cfg.drop.test(n.getName())) { n.dispose(); }
  // matériaux : spéculaire/brillance -> métal/rugosité, « unlit » -> éclairé
  try { await doc.transform(metalRough()); } catch (e) { console.log('  metalRough ignoré :', e.message); }
  for (const m of root.listMaterials()) {
    if (m.getExtension('KHR_materials_unlit')) m.setExtension('KHR_materials_unlit', null);
    m.setExtension('KHR_materials_clearcoat', null);
    m.setExtension('KHR_materials_emissive_strength', null);
    // texture avec transparence mais matériau opaque -> découpe alpha (feuilles)
    const t = m.getBaseColorTexture();
    if (t && m.getAlphaMode() === 'OPAQUE' && t.getMimeType() === 'image/png') {
      try {
        const st = await sharp(Buffer.from(t.getImage())).stats();
        if (st.channels.length === 4 && st.channels[3].min < 64 && st.channels[3].mean < 245) { m.setAlphaMode('MASK'); m.setAlphaCutoff(0.5); }
      } catch (e) { /* image illisible : on garde */ }
    }
  }
  await doc.transform(dedup(), prune());
  if (cfg.join) await doc.transform(join({ keepNamed: false }));
  // simplification des maillages
  let before = 0, after = 0;
  const countTris = () => root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + ((p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3), 0), 0);
  before = countTris();
  if (!cfg.noGeometryChange && (cfg.tris || cfg.ratio)) {
    const ratio = cfg.ratio ?? Math.min(1, cfg.tris / before);
    if (ratio < 0.98) {
      await doc.transform(weld({ tolerance: 0.0001 }), simplify({ simplifier: MeshoptSimplifier, ratio, error: cfg.err ?? 0.004, lockBorder: false }));
      // les petits maillages ne doivent pas disparaître : rien en dessous de minTris (déjà géré par l'erreur max)
    }
  }
  after = countTris();
  // textures : WebP, taille maximale
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex, cfg.tex], quality: 82 }));
  if (root.listAnimations().length) await doc.transform(resample({ tolerance: 1e-4 }));
  await doc.transform(prune());
  // compression géométrie + animations (EXT_meshopt_compression, décodée dans le navigateur)
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const glb = await io.writeBinary(doc);
  const wrapped = JSON.stringify({ format: 'base64', bytes: glb.byteLength, data: Buffer.from(glb).toString('base64') });
  fs.writeFileSync(path.join(OUT, `${name}.data.json`), wrapped);
  total += wrapped.length;
  manifest[name] = { kind: cfg.kind, file: `glb/${name}.data.json`, bytes: glb.byteLength, tris: Math.round(after), title: extras.title || name, author: extras.author || '', license: extras.license || '', source: extras.source || '' };
  console.log(`${name.padEnd(11)} ${(fs.statSync(file).size / 1048576).toFixed(1).padStart(5)} Mo -> ${(glb.byteLength / 1048576).toFixed(2).padStart(5)} Mo   triangles ${Math.round(before)} -> ${Math.round(after)}`);
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('total (base64)', (total / 1048576).toFixed(1), 'Mo');
