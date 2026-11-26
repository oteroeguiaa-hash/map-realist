// Assemble la page : bundle JS (three.js chargé depuis le CDN) injecté dans le gabarit HTML, + copie des assets.
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = path.join(ROOT, 'dist');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
const res = await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/main.js')], bundle: true, format: 'esm', write: false,
  external: ['three'], minify: !process.argv.includes('--dev'), target: ['es2020', 'safari15'], legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync(path.join(ROOT, 'index.template.html'), 'utf8').replace('/*BUNDLE*/', () => js);
fs.writeFileSync(path.join(DIST, 'index.html'), html);
const files = [];
const copy = (rel) => {
  const src = path.join(ROOT, 'assets', rel), dst = path.join(DIST, 'assets', rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  files.push('assets/' + rel);
};
for (const f of ['world.json', 'terrain.bin', 'clouds.bin']) copy(f);
for (const f of fs.readdirSync(path.join(ROOT, 'assets/tex'))) if (!/^t_(grass|ash)_n/.test(f)) copy('tex/' + f);
for (const f of fs.readdirSync(path.join(ROOT, 'assets/mdl'))) copy('mdl/' + f);
const size = files.reduce((a, f) => a + fs.statSync(path.join(DIST, f)).size, 0) + Buffer.byteLength(html);
fs.writeFileSync(path.join(DIST, 'files.json'), JSON.stringify(files));
console.log(`page ${(Buffer.byteLength(html) / 1024).toFixed(0)} Ko, ${files.length} fichiers, total ${(size / 1048576).toFixed(1)} Mo`);
