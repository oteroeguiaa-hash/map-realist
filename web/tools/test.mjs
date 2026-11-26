// Test local : sert dist/, charge la page dans Chromium (WebGL logiciel), relève les erreurs et prend des captures.
// Usage : node tools/test.mjs [scénario] ; scénarios définis plus bas.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = path.join(ROOT, 'dist');
const OUT = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(8765, r));
const W = +(process.env.W || 844), H = +(process.env.H || 390);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(`[${t}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js', (route) => route.fulfill({ path: path.join(ROOT, 'node_modules/three/build/three.module.min.js'), contentType: 'text/javascript' }));
await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ body: '', contentType: 'text/css' }));
const t0 = Date.now();
await page.goto('http://localhost:8765/', { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__game && (window.__game.ready || document.getElementById('load').classList.contains('err')), null, { timeout: 600000, polling: 1000 });
} catch (e) { logs.push('[timeout] ' + e.message); }
console.log('chargement', ((Date.now() - t0) / 1000).toFixed(1), 's');
const status = await page.evaluate(() => document.getElementById('status').textContent);
console.log('statut :', status);
const scen = process.argv[2] || 'spawn';
if (scen === 'drive') {
  await page.evaluate(() => { document.getElementById('load').hidden = true; document.getElementById('hud').hidden = false; const G = window.__game; G.__t = 0; G.controls.read = () => { G.__t++; return { throttle: G.__t < 45 ? 0.6 : 0, steer: G.__t > 14 && G.__t < 30 ? 0.6 : 0, brake: G.__t > 45 ? 1 : 0, b2: 0, lookX: 0, lookY: 0, up: false, down: false, camera: false, reset: false, fast: false }; }; });
  for (let i = 0; i < 60; i++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    if (i % 10 === 9) console.log(await page.evaluate(() => { const b = window.__game.buggy; const up = new (b.pos.constructor)(0, 1, 0).applyQuaternion(b.quat); return `t=${window.__game.__t} pos=${b.pos.toArray().map((v) => v.toFixed(1))} v=${(b.speed * 3.6).toFixed(0)}km/h up.y=${up.y.toFixed(2)} contacts=${b.wheels.filter((w) => w.contact).length} surf=${b.wheels.map((w) => w.surface)}`; }));
  }
  await page.evaluate(() => { const G = window.__game; G.rig.userYaw = 3.0; G.rig.userPitch = 0.75; });
  for (let i = 0; i < 4; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: path.join(OUT, 'drive.png') });
}
const shots = {
  check: [
    { name: 'c_cascade', setup: `G.teleport('cascade');` },
    { name: 'c_fall', setup: `G.rig.setMode('drone'); const w=G.world.waterfall; G.camera.position.set(w.pool[0]+w.dir[0]*60, w.pool[1]+10, w.pool[2]+w.dir[1]*60); G.rig.yaw = Math.atan2(w.dir[0], w.dir[1]); G.rig.pitch = 0.1;` },
    { name: 'c_grass', setup: `G.rig.setMode('drone'); const s=G.world.strip; const x=s.x+30, z=s.z+40; G.camera.position.set(x, G.terrain.height(x,z)+1.4, z); G.rig.yaw = 2.0; G.rig.pitch = -0.25;` },
    { name: 'c_under', setup: `G.teleport('lagon');` },
    { name: 'c_island', setup: `G.rig.setMode('drone'); G.camera.position.set(500, 380, 900); G.rig.yaw = 0.55; G.rig.pitch = -0.32;` },
    { name: 'c_pier', setup: `G.teleport('ponton');` },
  ],
  spawn: [{ name: 'spawn', setup: '' }],
  views: [
    { name: 'spawn', setup: '' },
    { name: 'drone_island', setup: `G.rig.setMode('drone'); G.camera.position.set(500, 380, 900); G.rig.yaw = 0.55; G.rig.pitch = -0.32;` },
    { name: 'waterfall', setup: `G.teleport('cascade');` },
    { name: 'waterfall_drone', setup: `G.rig.setMode('drone'); const w=G.world.waterfall; G.camera.position.set(w.pool[0]+w.dir[0]*70, w.pool[1]+14, w.pool[2]+w.dir[1]*70); G.rig.yaw = Math.atan2(w.dir[0], w.dir[1]); G.rig.pitch = 0.05;` },
    { name: 'jungle', setup: `G.rig.setMode('drone'); const s=G.world.spawn; G.camera.position.set(s.x-60, G.terrain.height(s.x-60, s.z-180)+2.2, s.z-180); G.rig.yaw = 0.3; G.rig.pitch = 0.05;` },
    { name: 'lagoon_under', setup: `G.teleport('lagon');` },
    { name: 'strip', setup: `G.teleport('piste');` },
    { name: 'grass_close', setup: `G.rig.setMode('drone'); const s=G.world.strip; const x=s.x+30, z=s.z+40; G.camera.position.set(x, G.terrain.height(x,z)+1.4, z); G.rig.yaw = 2.0; G.rig.pitch = -0.25;` },
    { name: 'sunset', setup: `G.sky.setHour(18.3); G.teleport('plage');` },
  ],
};
for (const s of shots[scen] || shots.spawn) {
  await page.evaluate((code) => { const G = window.__game; document.getElementById('load').hidden = true; document.getElementById('hud').hidden = false; new Function('G', code)(G); }, s.setup);
  // laisse tourner quelques images
  for (let i = 0; i < (+process.env.FRAMES || 6); i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: path.join(OUT, `${s.name}.png`) });
  const info = await page.evaluate(() => { const G = window.__game; const r = G.renderer.info; return { calls: r.render.calls, tris: r.render.triangles, fps: G.fpsAvg.toFixed(1), scale: G.scale.toFixed(2), trees: G.veg && G.veg.count, cam: G.camera.position.toArray().map((v) => v.toFixed(1)) }; });
  console.log(s.name, JSON.stringify(info));
}
console.log(logs.slice(0, 40).join('\n') || 'aucune erreur');
await browser.close();
server.close();
