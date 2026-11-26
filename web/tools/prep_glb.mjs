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
import { execFileSync } from 'node:child_process';
import os from 'node:os';

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
  // décor Poly Haven (CC0) fourni en .gltf.zip ; tailles réelles en mètres
  boulder: { zip: 'boulder_01_2k.gltf.zip', tex: 1024, tris: 1600, err: 0.02, sloppy: true, kind: 'decor' },
  trunk2: { zip: 'dead_tree_trunk_02_2k.gltf.zip', tex: 1024, tris: 1600, err: 0.02, kind: 'decor' },
  fern2: { zip: 'fern_02_4k.gltf.zip', tex: 1024, tris: 3600, err: 0.01, kind: 'veg', alpha: 'fern_02' },
  grass2: { zip: 'grass_medium_01_4k.gltf.zip', tex: 1024, tris: 7000, err: 0.01, kind: 'veg', alpha: 'grass_medium_01' },
  mountain: { zip: 'mountainside_2k.gltf.zip', tex: 1024, tris: 3500, err: 0.02, kind: 'decor' },
  nboulder2: { zip: 'namaqualand_boulder_02_2k.gltf.zip', tex: 1024, tris: 1600, err: 0.02, kind: 'decor' },
  nboulder5: { zip: 'namaqualand_boulder_05_2k.gltf.zip', tex: 1024, tris: 1400, err: 0.02, kind: 'decor' },
  ncliff: { zip: 'namaqualand_cliff_01_2k.gltf.zip', tex: 1024, tris: 3000, err: 0.02, kind: 'decor' },
  othonna: { zip: 'othonna_cerarioides_2k.gltf.zip', tex: 1024, tris: 7000, err: 0.04, kind: 'veg', alpha: 'othonna_cerarioides' },
  rockface: { zip: 'rock_face_02_2k.gltf.zip', tex: 1024, tris: 1800, err: 0.02, kind: 'decor' },
  mossrocks: { zip: 'rock_moss_set_02_4k.gltf.zip', tex: 1024, tris: 6000, err: 0.02, kind: 'decor' },
  roots: { zip: 'root_cluster_01_2k.gltf.zip', tex: 1024, tris: 3500, err: 0.02, kind: 'decor' },
  sandrocks: { zip: 'sand_rocks_small_01_1k.gltf.zip', tex: 1024, tris: 4000, err: 0.03, kind: 'decor' },
};
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'prepglb-'));
// .gltf.zip -> dossier temporaire, renvoie le chemin du .gltf
function unzipGltf(zip) {
  const d = path.join(TMP, zip.replace(/\.gltf\.zip$/, ''));
  fs.mkdirSync(d, { recursive: true });
  execFileSync('unzip', ['-oq', path.join(SRC, zip), '-d', d]);
  const f = fs.readdirSync(d).find((x) => x.endsWith('.gltf'));
  return path.join(d, f);
}
// les .jpg Poly Haven n'ont pas de canal alpha : on récupère le masque d'origine (même asset, CC0)
function alphaMask(id) {
  const f = path.join(TMP, `alpha_${id}.jpg`);
  if (!fs.existsSync(f)) {
    const info = JSON.parse(execFileSync('curl', ['-s', `https://api.polyhaven.com/files/${id}`]).toString());
    execFileSync('curl', ['-s', '-o', f, info.Alpha['2k'].jpg.url]);
  }
  return f;
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'sharp': sharp, 'meshopt.encoder': MeshoptEncoder });
// option : node tools/prep_glb.mjs <dossier> palm,rocks  → ne refait que ces modèles
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const MF = path.join(OUT, 'manifest.json');
const manifest = ONLY && fs.existsSync(MF) ? JSON.parse(fs.readFileSync(MF, 'utf8')) : {};
let total = 0;
for (const [name, cfg] of Object.entries(MODELS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  if (cfg.zip && !fs.existsSync(path.join(SRC, cfg.zip))) { console.log('absent :', cfg.zip); continue; }
  const file = cfg.zip ? unzipGltf(cfg.zip) : path.join(SRC, cfg.src);
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
  if (cfg.alpha) {
    // couleur + masque alpha -> PNG RGBA, matériaux en découpe nette
    const mask = await sharp(alphaMask(cfg.alpha)).greyscale().toBuffer();
    for (const m of root.listMaterials()) {
      const t = m.getBaseColorTexture();
      if (!t || m.getAlphaMode() === 'OPAQUE') continue;
      const img = sharp(Buffer.from(t.getImage()));
      const { width, height } = await img.metadata();
      const a = await sharp(mask).resize(width, height).toColourspace('b-w').raw().toBuffer();
      const rgb = await img.removeAlpha().raw().toBuffer();
      const rgba = Buffer.alloc(width * height * 4);
      for (let i = 0; i < width * height; i++) { rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = a[i]; }
      t.setImage(new Uint8Array(await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer())).setMimeType('image/png');
      m.setAlphaMode('MASK'); m.setAlphaCutoff(0.5);
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
  // maillages scannés avec coutures d'UV partout : on soude les sommets par position (en ignorant les UV)
  // pour que le simplificateur puisse travailler ; chaque sommet garde les attributs de son représentant
  if (cfg.sloppy && countTris() > cfg.tris * 1.5) {
    for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices(), pos = prim.getAttribute('POSITION');
      if (!idx) continue;
      const P = pos.getArray(), n = pos.getCount(), map = new Map(), rep = new Uint32Array(n);
      for (let i = 0; i < n; i++) { const k = `${P[i * 3].toFixed(4)},${P[i * 3 + 1].toFixed(4)},${P[i * 3 + 2].toFixed(4)}`; let v = map.get(k); if (v === undefined) { v = i; map.set(k, i); } rep[i] = v; }
      const I = new Uint32Array(idx.getArray()).map((v) => rep[v]);
      const target = Math.floor(cfg.tris * (idx.getCount() / 3) / Math.max(1, countTris())) * 3;
      let [out] = MeshoptSimplifier.simplify(I, new Float32Array(P), 3, Math.max(target, 300), 1.0, []);
      if (out.length / 3 > target * 1.5) {
        // dernier recours : regroupement des sommets sur une grille (la carte de normales garde le détail)
        let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], P[i * 3 + c]); mx[c] = Math.max(mx[c], P[i * 3 + c]); }
        const cell = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / Math.sqrt(target / 9), cmap = new Map(), crep = new Uint32Array(n);
        for (let i = 0; i < n; i++) { const k = [0, 1, 2].map((c) => Math.floor((P[i * 3 + c] - mn[c]) / cell)).join(','); let v = cmap.get(k); if (v === undefined) { v = i; cmap.set(k, i); } crep[i] = v; }
        const res = [], seen = new Set();
        for (let t = 0; t < out.length; t += 3) {
          const a = crep[out[t]], b = crep[out[t + 1]], c = crep[out[t + 2]];
          if (a === b || b === c || a === c) continue;
          const key = [a, b, c].sort((x, y) => x - y).join(',');
          if (seen.has(key)) continue; seen.add(key); res.push(a, b, c);
        }
        out = res;
      }
      idx.setArray(new Uint32Array(out));
    }
    await doc.transform(prune());
  }
  after = countTris();
  // textures : WebP, taille maximale
  // feuilles : la couleur des pixels transparents est étendue depuis la feuille voisine,
  // sinon le filtrage de texture fait apparaître un liseré noir autour de chaque feuille
  if (cfg.kind === 'veg') await bleedAlpha(root, cfg.tex);
  // licence des modèles Poly Haven (pas de métadonnées dans leurs .gltf)
  if (cfg.zip && !extras.license) { extras.license = 'CC0 (domaine public)'; extras.author = 'Poly Haven'; extras.title = cfg.zip.replace(/_\dk\.gltf\.zip$/, ''); extras.source = 'https://polyhaven.com/a/' + extras.title; }
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

async function bleedAlpha(root, size) {
  const done = new Set();
  for (const m of root.listMaterials()) {
    const t = m.getBaseColorTexture();
    if (!t || done.has(t) || m.getAlphaMode() === 'OPAQUE') continue;
    done.add(t);
    const { data, info } = await sharp(Buffer.from(t.getImage())).resize(size, size, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height, N = W * H;
    let ok = new Uint8Array(N), cnt = 0, sr = 0, sg = 0, sb = 0;
    for (let i = 0; i < N; i++) if (data[i * 4 + 3] > 100) { ok[i] = 1; cnt++; sr += data[i * 4]; sg += data[i * 4 + 1]; sb += data[i * 4 + 2]; }
    if (cnt === N || cnt === 0) continue;
    for (let pass = 0; pass < 48; pass++) {
      const next = ok.slice(); let changed = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; if (ok[i]) continue;
        let r = 0, g = 0, b = 0, k = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx; if (!ok[j]) continue;
          r += data[j * 4]; g += data[j * 4 + 1]; b += data[j * 4 + 2]; k++;
        }
        if (k) { data[i * 4] = r / k; data[i * 4 + 1] = g / k; data[i * 4 + 2] = b / k; next[i] = 1; changed++; }
      }
      ok = next; if (!changed) break;
    }
    for (let i = 0; i < N; i++) if (!ok[i]) { data[i * 4] = sr / cnt; data[i * 4 + 1] = sg / cnt; data[i * 4 + 2] = sb / cnt; }
    t.setImage(new Uint8Array(await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer())).setMimeType('image/png');
  }
}
