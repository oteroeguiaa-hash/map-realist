// Assemble la page : bundle JS (three.js chargé depuis le CDN) injecté dans le gabarit HTML, + copie des assets.
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = path.join(ROOT, 'dist');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
const bundle = async (entry) => {
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, entry)], bundle: true, format: 'esm', write: false,
    external: ['three', 'three/addons/*'], minify: !process.argv.includes('--dev'), target: ['es2022', 'safari15'], legalComments: 'none',
  });
  return res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
};
const js = await bundle('src/main.js');
const tpl = fs.readFileSync(path.join(ROOT, 'index.template.html'), 'utf8');
const html = tpl.replace('/*BUNDLE*/', () => js);
fs.writeFileSync(path.join(DIST, 'index.html'), html);
// page de contrôle des modèles (tests locaux seulement, jamais publiée)
const pjs = await bundle('src/preview.js');
const importmap = tpl.match(/<script type="importmap">[\s\S]*?<\/script>/)[0];
fs.writeFileSync(path.join(DIST, 'preview.html'), `<!doctype html><meta charset="utf-8"><body style="margin:0">${importmap}<script type="module">${pjs}</script>`);
const files = [];
// Les données binaires (.bin) sont publiées en JSON (base64), un format de données standard.
const copy = (rel) => {
  const src = path.join(ROOT, 'assets', rel);
  if (rel.endsWith('.bin')) {
    rel = rel.replace(/\.bin$/, '.data.json');
    const dst = path.join(DIST, 'assets', rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, JSON.stringify({ format: 'base64', bytes: fs.statSync(src).size, data: fs.readFileSync(src).toString('base64') }));
  } else {
    const dst = path.join(DIST, 'assets', rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  files.push('assets/' + rel);
};
for (const f of ['world.json', 'terrain.bin', 'clouds.bin']) copy(f);
for (const f of fs.readdirSync(path.join(ROOT, 'assets/tex'))) if (!/^t_(grass|ash)_n/.test(f)) copy('tex/' + f);
for (const f of fs.readdirSync(path.join(ROOT, 'assets/mdl'))) copy('mdl/' + f);
if (fs.existsSync(path.join(ROOT, 'assets/glb'))) for (const f of fs.readdirSync(path.join(ROOT, 'assets/glb'))) copy('glb/' + f);
const size = files.reduce((a, f) => a + fs.statSync(path.join(DIST, f)).size, 0) + Buffer.byteLength(html);
fs.writeFileSync(path.join(DIST, 'files.json'), JSON.stringify(files));
console.log(`page ${(Buffer.byteLength(html) / 1024).toFixed(0)} Ko, ${files.length} fichiers, total ${(size / 1048576).toFixed(1)} Mo`);
