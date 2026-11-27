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
const PORT = +(process.env.PORT || 8765);
await new Promise((r) => server.listen(PORT, r));
const W = +(process.env.W || 844), H = +(process.env.H || 390);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: process.argv[2] === 'preview' ? { width: 1400, height: 900 } : { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(`[${t}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js', (route) => route.fulfill({ path: path.join(ROOT, 'node_modules/three/build/three.module.min.js'), contentType: 'text/javascript' }));
await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ body: '', contentType: 'text/css' }));
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/**', (route) => {
  const rel = route.request().url().split('/examples/jsm/')[1];
  route.fulfill({ path: path.join(ROOT, 'node_modules/three/examples/jsm', rel), contentType: 'text/javascript' });
});
if (process.argv[2] === 'preview') {
  for (const v of ['front', 'side', 'top']) {
    await page.goto(`http://localhost:${PORT}/preview.html?v=${v}${process.env.M ? '&m=' + process.env.M : ''}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__preview && window.__preview.ready, null, { timeout: 300000, polling: 500 });
    await page.screenshot({ path: path.join(OUT, `preview_${v}.png`) });
  }
  console.log(logs.slice(0, 30).join('\n') || 'aucune erreur');
  await browser.close(); server.close(); process.exit(0);
}
const t0 = Date.now();
await page.goto(`http://localhost:${PORT}/` + (process.env.Q ? '?q=' + process.env.Q : ''), { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__game && (window.__game.ready || document.getElementById('load').classList.contains('err')), null, { timeout: 600000, polling: 1000 });
} catch (e) { logs.push('[timeout] ' + e.message); }
console.log('chargement', ((Date.now() - t0) / 1000).toFixed(1), 's');
const status = await page.evaluate(() => document.getElementById('status').textContent);
console.log('statut :', status);
if (/Impossible/.test(status)) { console.log(logs.join('\n')); console.log(await page.evaluate(() => window.__err || '')); await browser.close(); server.close(); process.exit(1); }
const scen = process.argv[2] || 'spawn';
if (scen === 'drive') {
  await page.evaluate(() => { document.getElementById('load').hidden = true; document.getElementById('hud').hidden = false; const G = window.__game; G.mode = 'buggy'; G.rig.setMode('chase'); G.__t = 0; G.controls.read = () => { G.__t++; return { throttle: G.__t < 120 ? 1 : G.__t < 150 ? -1 : 0, steer: G.__t > 60 && G.__t < 100 ? 0.8 : 0, brake: 0, b2: 0, lookX: 0, lookY: 0, up: false, down: false, camera: false, reset: false, fast: false }; }; });
  for (let i = 0; i < 160; i++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    if (i % 10 === 9) console.log(await page.evaluate(() => { const b = window.__game.buggy; const up = new (b.pos.constructor)(0, 1, 0).applyQuaternion(b.quat); return `t=${window.__game.__t} pos=${b.pos.toArray().map((v) => v.toFixed(1))} v=${(b.speed * 3.6).toFixed(0)}km/h up.y=${up.y.toFixed(2)} contacts=${b.wheels.filter((w) => w.contact).length} surf=${b.wheels.map((w) => w.surface)} gear=${b.gear} rpm=${b.engRpm|0} slip=${b.wheels.map((w)=>(w.slip||0).toFixed(1))}`; }));
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
  // buggy lancé dans l'eau peu profonde : gerbes d'eau + volant
  splash: [{ name: 'splash', setup: `
    const b=G.buggy, s=G.world.spawn; G.mode='buggy'; G.rig.setMode('chase');
    let best=null; for (let r=8;r<200&&!best;r+=4) for (let a=0;a<6.28;a+=0.2){ const x=s.x+Math.cos(a)*r, z=s.z+Math.sin(a)*r, h=G.terrain.height(x,z); if(h<-0.15&&h>-0.5){best=[x,z,a];break;} }
    b.place(best[0], best[1], best[2]+Math.PI/2); b.vel.set(Math.sin(best[2]+Math.PI/2)*14,0,Math.cos(best[2]+Math.PI/2)*14);
    G.controls.read=()=>({throttle:1,steer:0.3,brake:0,lookX:0,lookY:0,up:false,down:false,camera:false,reset:false,fast:false});` }],
  shore: [
    { name: 'shore_low', setup: `G.rig.setMode('drone'); const s=G.world.spawn; G.camera.position.set(s.x+2, 2.2, s.z+8); G.rig.yaw=Math.PI*1.0; G.rig.pitch=-0.12;` },
    { name: 'shore_high', setup: `G.rig.setMode('drone'); const s=G.world.spawn; G.camera.position.set(s.x, 14, s.z-10); G.rig.yaw=Math.PI; G.rig.pitch=-0.35;` },
  ],
  // eau de mer et bord de plage : jet de rive à deux instants, vue plongeante, paillettes face au soleil, sous l'eau, vue d'ensemble
  water: [
    { name: 'w_shore_low', setup: `G.rig.setMode('drone'); const s=G.world.spawn; G.camera.position.set(s.x+2, 2.2, s.z+8); G.rig.yaw=Math.PI*1.0; G.rig.pitch=-0.12; G.water.oceanU.uTime.value=100;` },
    { name: 'w_shore_high', setup: `G.rig.setMode('drone'); const s=G.world.spawn; G.camera.position.set(s.x, 14, s.z-10); G.rig.yaw=Math.PI; G.rig.pitch=-0.35;` },
    { name: 'w_swash', setup: `G.rig.setMode('drone'); const s=G.world.spawn, T=G.terrain; let z=s.z; while(T.height(s.x,z)>0.05 && z<s.z+300) z+=0.5; window.__sh=[s.x,z]; G.camera.position.set(s.x, T.height(s.x,z-5)+1.7, z-5); G.rig.yaw=Math.PI-1.15; G.rig.pitch=-0.12; G.water.oceanU.uTime.value=100;` },
    { name: 'w_swash2', setup: `G.water.oceanU.uTime.value=102.6;` },
    { name: 'w_down', setup: `const T=G.terrain, [x,z]=window.__sh; G.camera.position.set(x, T.height(x,z-1)+3.5, z-1); G.rig.yaw=Math.PI; G.rig.pitch=-0.95; G.water.oceanU.uTime.value=101.2;` },
    { name: 'w_glitter', setup: `const T=G.terrain, [x,z]=window.__sh; const d=G.water.oceanU.uSunDir.value; G.camera.position.set(x, 3.0, z+2); G.rig.yaw=Math.atan2(-d.x,-d.z); G.rig.pitch=-0.1;` },
    { name: 'w_under', setup: `G.teleport('lagon');` },
    { name: 'w_island', setup: `G.rig.setMode('drone'); G.camera.position.set(500, 380, 900); G.rig.yaw = 0.55; G.rig.pitch = -0.32;` },
  ],
  // nombre de textures utilisées par chaque shader (limite iPhone : 16 dans le fragment shader)
  samplers: [{ name: 'samplers', setup: `G.sky.setHour(20.5);`, after: `
    const gl=G.renderer.getContext(); const out=[];
    for (const p of G.renderer.info.programs) { const pr=p.program; const n=gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS); let c=0; for(let i=0;i<n;i++){ const u=gl.getActiveUniform(pr,i); if([gl.SAMPLER_2D,gl.SAMPLER_CUBE,gl.SAMPLER_3D,gl.SAMPLER_2D_SHADOW,gl.SAMPLER_2D_ARRAY,gl.UNSIGNED_INT_SAMPLER_2D,gl.INT_SAMPLER_2D].includes(u.type)) c+=u.size; } out.push([c, p.name]); }
    out.sort((a,b)=>b[0]-a[0]); return 'max: ' + out.slice(0,6).map(x=>x.join(' ')).join(' | ') + ' — programmes: ' + out.length;` }],
  crash: [
    { name: 'crash_big', setup: `
      const F=G.veg, I=F.I, b=G.buggy; let best=-1, bd=1e9; for (let i=0;i<I.n;i++){ const t=F.types[I.t[i]]; if(t.name!=='grand arbre'||F.dead[i]) continue; const d=Math.hypot(I.x[i]-G.world.spawn.x,I.z[i]-G.world.spawn.z); if(d<bd){bd=d;best=i;} }
      const tx=I.x[best], tz=I.z[best]; G.mode='buggy'; G.rig.setMode('chase'); b.place(tx-14, tz, Math.PI/2); b.vel.set(14,0,0);
      G.__t=0; G.controls.read=()=>({throttle:1,steer:0,brake:0,lookX:0,lookY:0,up:false,down:false,camera:false,reset:false,fast:false});
      window.__crash=()=>console.warn('vitesse', (b.speed*3.6).toFixed(0), 'dégâts', (b.damage||0).toFixed(2), 'oscillations', F.wobbles.size, 'x', b.pos.x.toFixed(1), 'arbre x', tx.toFixed(1));` , after: `window.__crash(); return 'ok';` },
    { name: 'crash_small', setup: `
      const F=G.veg, I=F.I, b=G.buggy; let best=-1, bd=1e9; for (let i=0;i<I.n;i++){ const t=F.types[I.t[i]]; if(F.dead[i]||t.cat!=='tree'||t.h*I.s[i]>=9) continue; const d=Math.hypot(I.x[i]-G.world.spawn.x,I.z[i]-G.world.spawn.z); if(d<bd){bd=d;best=i;} }
      const tx=I.x[best], tz=I.z[best]; b.damage=0; b.place(tx-14, tz, Math.PI/2); b.vel.set(14,0,0); window.__small=best;`, after: `return 'petit arbre abattu: ' + G.veg.dead[window.__small] + ' chutes: ' + G.lumber.falling.length + ' vitesse ' + (G.buggy.speed*3.6).toFixed(0);` },
  ],
  night: [
    { name: 'n_camp', setup: `G.sky.setHour(20.2); const c=G.world.camp; G.rig.setMode('drone'); G.camera.position.set(c.x+14, G.terrain.height(c.x+14,c.z+10)+5, c.z+10); G.rig.yaw=Math.atan2(-(c.x-G.camera.position.x), -(c.z-G.camera.position.z)); G.rig.pitch=-0.25;` },
    { name: 'n_torch', setup: `G.rig.setMode('foot'); const P=G.player; for (const p of [...P.pickups]) if (p.name==='torch'||p.name==='binoculars') P.pick(p); P.equip(P.inv.indexOf('torch')); P.torchOn=true; const c=G.world.camp; P.place(c.x+18, c.z+18, 0.8); P.pitch=-0.15;` },
    { name: 'n_bino', setup: `G.sky.setHour(15); const P=G.player; P.equip(P.inv.indexOf('binoculars')); P.zoomOn=true; P.zoom=8; P.pitch=0.02;` },
    { name: 'pond', setup: `G.player.zoomOn=false; G.rig.setMode('drone'); const p=G.world.ponds[0]; G.camera.position.set(p.x+p.r*1.6, p.level+4, p.z+p.r*1.2); G.rig.yaw=Math.atan2(-(p.x-G.camera.position.x), -(p.z-G.camera.position.z)); G.rig.pitch=-0.3;` },
    { name: 'rockybeach', setup: `G.rig.setMode('drone'); const c=G.fauna.list.find(a=>a.name==='crab'); if(c){ G.camera.position.set(c.pos.x+5, c.pos.y+2.2, c.pos.z+5); G.rig.yaw=Math.atan2(-(c.pos.x-G.camera.position.x), -(c.pos.z-G.camera.position.z)); G.rig.pitch=-0.3; }` },
  ],
  perfspawn: [{ name: 'perf_spawn', setup: `document.querySelector('[data-q="1"]').click();`, after: `
    const rows={}; G.scene.traverse(o=>{ if(!o.isMesh||!o.visible) return; let p=o; while(p){ if(!p.visible) return; p=p.parent; } let k=o.name||''; let q=o; while(q && !k){ q=q.parent; k=q&&q.name||''; } k=k.slice(0,18)||o.material.type; const g=o.geometry; const t=(g.index?g.index.count:g.attributes.position.count)/3*(o.isInstancedMesh?o.count:1); rows[k]=rows[k]||[0,0]; rows[k][0]++; rows[k][1]+=t; });
    const L=[]; G.scene.traverse(o=>{ if(o.isLight&&o.castShadow) L.push(o.type+':'+o.shadow.autoUpdate+'/'+o.shadow.needsUpdate); });
    return Object.entries(rows).sort((a,b)=>b[1][0]-a[1][0]).slice(0,22).map(([k,v])=>k+' n='+v[0]+' t='+(v[1]|0)).join(' | ')+' || '+L.join(',');` }],
  chop: [
    { name: 'chop_before', setup: `
      try { localStorage.clear(); } catch (e) {}
      const P=G.player, F=G.veg, I=F.I; const s=G.world.spawn;
      let best=-1, bd=1e9; for (let i=0;i<I.n;i++){ const t=F.types[I.t[i]]; if(t.name!=='grand arbre') continue; const d=Math.hypot(I.x[i]-s.x,I.z[i]-s.z); if(d<bd){bd=d;best=i;} }
      G.__tree=best; const x=I.x[best]-6, z=I.z[best]-14; P.place(x, z, 0); P.yaw=Math.atan2(-(I.x[best]-x), -(I.z[best]-z)); P.pitch=0.25;
      console.warn('arbre', best, bd.toFixed(0), F.types[I.t[best]].h*I.s[best]);` },
    { name: 'chop_fall1', setup: `const L=G.lumber; for(let k=0;k<8;k++) L.hit(G.__tree, G.player.pos); console.warn('falling', L.falling.length);` },
    { name: 'chop_fall2', setup: `` },
    { name: 'chop_after', setup: `for(let k=0;k<30;k++) G.lumber.update(0.05); console.warn('bois', G.lumber.wood, 'repos', G.lumber.fallen[0] && G.lumber.fallen[0].theta.toFixed(2), JSON.stringify(G.lumber.save()));` },
    { name: 'chop_side', setup: `G.rig.setMode('drone'); const r=G.lumber.fallen[0]; const c=G.camera.position; const m=r.pivot.position.clone().addScaledVector(r.dir, r.L*0.5); c.set(m.x - r.dir.z*16, m.y+5, m.z + r.dir.x*16); G.rig.yaw=Math.atan2(-(m.x-c.x), -(m.z-c.z)); G.rig.pitch=-0.25;` },
  ],
  build: [
    { name: 'build_ramp', setup: `G.lumber.wood=60; const B=G.builder, P=G.player; B.kind='rampe'; B.active=true; B.preview(P, 60); B.confirm(); B.kind='plancher'; P.yaw+=0.9; B.preview(P,60); B.confirm(); B.kind='mur'; P.yaw-=1.8; B.preview(P,60); B.confirm(); B.active=false; G.rig.setMode('drone'); const c=G.camera.position; c.set(P.pos.x-8, P.pos.y+6, P.pos.z+8); G.rig.yaw=-0.8; G.rig.pitch=-0.4;` },
    { name: 'road_spur', setup: `G.rig.setMode('drone'); const s=G.world.spawn; G.camera.position.set(s.x+25, 14, s.z-30); G.rig.yaw=1.2; G.rig.pitch=-0.35;` },
    { name: 'road_ground', setup: `G.rig.setMode('drone'); const s=G.world.spawn; G.camera.position.set(s.x+4, G.terrain.height(s.x+4, s.z-60)+1.7, s.z-60); G.rig.yaw=0.05; G.rig.pitch=-0.08;` },
  ],
  probe: [{ name: 'probe', setup: `G.rig.setMode('drone'); const s=G.world.spawn; G.camera.position.set(s.x-60, G.terrain.height(s.x-60, s.z-180)+2.2, s.z-180); G.rig.yaw = 0.3; G.rig.pitch = 0.05;`, after: `
    const L=[]; G.scene.traverse(o=>{ if(o.isLight) L.push(o.type+':'+o.intensity.toFixed(2)); });
    const mats=new Set(); G.scene.traverse(o=>{ if(o.isMesh && /monstera/i.test(o.name)) mats.add(o.material.roughness+'/'+o.material.metalness+'/'+(o.material.map&&o.material.map.image&&o.material.map.image.width)); });
    return 'env '+G.scene.environmentIntensity.toFixed(3)+' expo '+G.expo.toFixed(3)+' '+L.join(' ')+' monst '+[...mats].join(',');` }],
  perf: [{ name: 'perf_jungle', setup: `document.querySelector('[data-q="1"]').click(); G.rig.setMode('drone'); G.camera.position.set(165.4,16.1,533.5); G.rig.yaw=0.5; G.rig.pitch=-0.05;`, after: `
    const rows=[]; G.scene.traverse(o=>{ if(!o.isMesh||!o.visible) return; let p=o; while(p){ if(!p.visible) return; p=p.parent; } const g=o.geometry; const t=(g.index?g.index.count:g.attributes.position.count)/3; const n=o.isInstancedMesh?o.count:1; rows.push([o.name||(o.parent&&o.parent.name)||o.material.type, n, Math.round(t), Math.round(t*n), 'ombre', o.castShadow?(o.shadowCount??n)*t|0:0]); });
    rows.sort((a,b)=>b[3]-a[3]); const sm=rows.reduce((a,r)=>a+r[3],0), ss=rows.reduce((a,r)=>a+r[5],0); rows.unshift(['TOTAL visible',rows.length,0,sm,'ombre',ss]); return rows.slice(0,40).map(r=>r.join(' ')).join(' | ');` }],
  foot: [
    { name: 'foot_spawn', setup: '' },
    { name: 'foot_tools', setup: `G.player.pitch = -0.55;` },
    { name: 'foot_axe', setup: `const P=G.player; const p=P.pickups.find(q=>q.name==='axe')||P.pickups[0]; if(p){P.pick(p);} P.pitch=0.0; P.strike();` },
    { name: 'foot_strike', setup: `G.player.swing=0.42;` },
    { name: 'buggy_side', setup: `G.rig.setMode('drone'); const b=G.buggy; const h=b.heading; G.camera.position.set(b.pos.x+Math.cos(h)*5.5+Math.sin(h)*1.5, b.pos.y+1.2, b.pos.z-Math.sin(h)*5.5+Math.cos(h)*1.5); const dx=b.pos.x-G.camera.position.x, dz=b.pos.z-G.camera.position.z; G.rig.yaw=Math.atan2(-dx,-dz); G.rig.pitch=-0.12;` },
    { name: 'plane', setup: `G.rig.setMode('foot'); G.teleport('piste'); G.player.pitch=0.05;` },
  ],
  fauna: ['tiger', 'jaguar', 'boar', 'komodo', 'python', 'monkey', 'crab', 'croc', 'turtle', 'fishschool', 'shark', 'seagull', 'parrot', 'aracari', 'parrots'].map((n) => ({ name: 'f_' + n, setup: `
    G.rig.setMode('drone'); const a=G.fauna.list.find(a=>a.name==='${n}'); if(!a){ console.warn('absent ${n}'); return; }
    const L=Math.max(a.L, a.size.y, 0.4); const h=a.heading+1.2; const d=L*2.4+1;
    const c=G.camera.position; c.set(a.pos.x+Math.sin(h)*d, a.pos.y+L*0.45+0.3, a.pos.z+Math.cos(h)*d);
    const dx=a.pos.x-c.x, dz=a.pos.z-c.z; G.rig.yaw=Math.atan2(-dx,-dz); G.rig.pitch=Math.atan2(a.pos.y+a.size.y*0.4-c.y, Math.hypot(dx,dz));` })),
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
  await page.screenshot({ path: path.join(OUT, `${s.name}.png`), timeout: 240000 });
  const info = await page.evaluate(() => { const G = window.__game; const r = G.renderer.info; return { calls: r.render.calls, tris: r.render.triangles, fps: G.fpsAvg.toFixed(1), scale: G.scale.toFixed(2), animals: G.fauna && G.fauna.count(), models: G.bank && Object.entries(G.bank.status).filter(([, v]) => v.state !== 'ok').map(([k, v]) => k + ':' + v.state).join(','), cam: G.camera.position.toArray().map((v) => v.toFixed(1)) }; });
  console.log(s.name, JSON.stringify(info));
  if (s.after) console.log(await page.evaluate((code) => new Function('G', code)(window.__game), s.after));
}
console.log(logs.slice(0, 40).join('\n') || 'aucune erreur');
await browser.close();
server.close();
