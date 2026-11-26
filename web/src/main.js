// Map Realist — démo temps réel d'une île tropicale volcanique.
import * as THREE from 'three';
import { U, fetchBuf, fetchJSON, clamp, lerp, smoothstep } from './core.js';
import { TerrainData, TerrainMesh, loadTerrainTextures } from './terrain.js';
import { Sky } from './sky.js';
import { WorldLight } from './lighting.js';
import { Water } from './water.js';
import { Post } from './post.js';
import { Flora } from './flora.js';
import { ModelBank } from './models.js';
import { Player } from './player.js';
import { Fauna } from './fauna.js';
import { Roads, spurFromSpawn, stampRoad } from './roads.js';
import { Lumber } from './lumber.js';
import { GrassField } from './grassfield.js';
import { Builder, PIECES } from './build.js';

// sauvegarde locale (arbres abattus, bois, constructions) : retrouvée au retour sur ce téléphone
const SAVE_KEY = 'mapRealist.save.v1';
const loadSave = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; } };
const writeSave = (o) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(o)); } catch (e) { /* stockage indisponible */ } };
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { Props } from './props.js';
import { Buggy } from './buggy.js';
import { Effects } from './fx.js';
import { Sea } from './fish.js';
import { Controls, CameraRig } from './controls.js';
import { UI } from './ui.js';
import { Sound } from './audio.js';

const ASSETS = 'assets';
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
const QUALITY = [
  { name: 'Bas', scale: 0.8, msaa: 0, shadow: 1024, shadowR: 60, sky: 0, terrain: 0, veg: 0 },
  { name: 'Moyen', scale: 0.88, msaa: 2, shadow: 1536, shadowR: 80, sky: 1, terrain: 1, veg: 1 },
  { name: 'Élevé', scale: 0.92, msaa: 4, shadow: 2048, shadowR: 105, sky: 2, terrain: 2, veg: 2 },
  { name: 'Ultra', scale: 1.0, msaa: 4, shadow: 2048, shadowR: 130, sky: 3, terrain: 3, veg: 3 },
];

// ordre de chargement des modèles .glb : végétation d'abord, puis rochers, véhicules, outils, animaux
const GLB_ORDER = ['palm', 'plants', 'fern2', 'grass2', 'othonna', 'roots',
  'boulder', 'nboulder2', 'nboulder5', 'rockface', 'mossrocks', 'ncliff', 'mountain', 'trunk2', 'sandrocks', 'buggy', 'plane', 'axe', 'rivelaine',
  'crab', 'seagull', 'parrot', 'aracari', 'parrots', 'monkey', 'boar', 'tiger', 'jaguar', 'komodo', 'python', 'turtle', 'fishschool', 'shark', 'croc'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const G = (window.__game = {
  mode: 'foot',
  ready: false, expo: 1, autoQ: true, qi: isMobile ? 1 : 2, frame: 0, fpsAvg: 30, scale: 1, paused: false,
});
const ui = new UI();

async function boot() {
  try {
    ui.progress(0.03, 'Préparation du moteur 3D…');
    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 est nécessaire.');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = true;
    renderer.info.autoReset = false;
    renderer.localClippingEnabled = true;
    G.renderer = renderer;
    const Q = () => QUALITY[G.qi];

    // modèles 3D : tout part en parallèle tout de suite, sans bloquer le démarrage ;
    // un modèle trop lent ou cassé est ignoré (version de secours générée) au lieu de bloquer sur un écran noir
    const manifest = await fetchJSON(`${ASSETS}/glb/manifest.json`).catch(() => ({}));
    const bank = new ModelBank(ASSETS, manifest);
    G.bank = bank;
    bank.loadAll(GLB_ORDER, 60000);
    const waitModels = (names, ms) => Promise.race([Promise.all(names.filter((k) => manifest[k]).map((k) => bank.load(k))), sleep(ms)]);
    ui.credits(manifest);

    ui.progress(0.08, 'Chargement du relief de l’île…');
    const [world, tbuf, cbuf, atlasRects] = await Promise.all([
      fetchJSON(`${ASSETS}/world.json`), fetchBuf(`${ASSETS}/terrain.data.json`), fetchBuf(`${ASSETS}/clouds.data.json`), fetchJSON(`${ASSETS}/tex/atlas.json`),
    ]);
    G.world = world;
    const data = new TerrainData(world, tbuf);
    // nouvelle route de terre : de la plage de départ jusqu'à la grande boucle autour de l'île
    const spur = spurFromSpawn(world);
    if (spur) stampRoad(data, spur);
    const allRoads = world.roads.concat(spur ? [spur] : []);
    data.addRelief(world);
    data.makeTextures();
    G.terrain = data;

    ui.progress(0.2, 'Chargement des textures (sable, roche, jungle)…');
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const ttex = await loadTerrainTextures(ASSETS, aniso);

    const scene = new THREE.Scene();
    G.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 45000);
    G.camera = camera;
    scene.add(camera); // l'outil tenu en main est attaché à la caméra

    ui.progress(0.32, 'Ciel et nuages volumétriques…');
    const sky = new Sky(renderer, cbuf, Q().sky);
    G.sky = sky;
    scene.add(sky.dome);
    const wl = new WorldLight(renderer, data, sky);
    G.light = wl;

    const terrain = new TerrainMesh(data, ttex, Q().terrain);
    scene.add(terrain.mesh);
    G.terrainMesh = terrain;

    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(Q().shadow, Q().shadow);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.6;
    sun.shadow.radius = 2;
    scene.add(sun, sun.target);
    // lumière d'ambiance ciel / sol : les ombres restent lisibles et chaudes, jamais noires
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x6b5e45, 1.3);
    scene.add(hemi);
    const GOLD = new THREE.Color(0xfff2d6);
    // éclairage d'environnement : HDRI « stream » (Poly Haven) lue avec EXRLoader
    let hdri = null;
    const pmrem = new THREE.PMREMGenerator(renderer);
    fetchBuf(`${ASSETS}/hdri/stream_1k.data.json`).then((buf) => {
      const d = new EXRLoader().setDataType(THREE.HalfFloatType).parse(buf);
      const tex = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, d.type);
      tex.colorSpace = THREE.LinearSRGBColorSpace; tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
      // luminosité moyenne (sans le disque solaire) et direction du soleil de la photo
      const h2f = d.type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat : (v) => v;
      let sum = 0, n = 0, best = 0, bx = 0;
      for (let y = 0; y < d.height; y += 2) for (let x = 0; x < d.width; x += 2) {
        const q = (y * d.width + x) * 4, L = h2f(d.data[q]) * 0.21 + h2f(d.data[q + 1]) * 0.72 + h2f(d.data[q + 2]) * 0.07;
        sum += Math.min(L, 8); n++;
        if (L > best) { best = L; bx = x; }
      }
      // azimut du soleil de l'image (convention équirectangulaire de three.js)
      const phi = (bx / d.width - 0.5) * Math.PI * 2; // u = atan(z, x) / 2π + 0.5
      hdri = { tex: pmrem.fromEquirectangular(tex).texture, avg: sum / Math.max(n, 1), sunAz: Math.atan2(Math.cos(phi), Math.sin(phi)) };
      tex.dispose();
    }).catch((e) => console.warn('HDRI ignorée :', e && e.message));
    let skyEnv = null;
    G.sun = sun;

    ui.progress(0.42, 'Lagon, récif et cascade…');
    const water = new Water(scene, data, world, sky);
    G.water = water;

    ui.progress(0.5, 'Palmiers, arbres géants et plantes de la jungle…');
    await waitModels(['palm', 'plants', 'fern2', 'grass2', 'othonna', 'roots'], 30000);
    await nextFrame();
    const veg = new Flora(renderer, scene, data, world, atlasRects, Q().veg);
    await veg.init(ASSETS, bank, (p, msg) => ui.progress(0.5 + p * 0.25, msg));
    G.veg = veg;
    const grassField = new GrassField(scene, data, veg, Q().veg);
    G.grassField = grassField;
    wl.setCanopy(veg.canopyList());

    ui.progress(0.78, 'Herbe, rochers, avions…');
    await nextFrame();
    await waitModels(['boulder', 'nboulder2', 'nboulder5', 'rockface', 'mossrocks', 'ncliff', 'mountain', 'trunk2', 'sandrocks', 'plane', 'buggy'], 20000);
    const props = new Props(scene, data, world, null, bank);
    await props.init(ASSETS);
    G.props = props;
    const roads = new Roads(scene, data, world);
    await roads.init(ASSETS, allRoads);
    G.roads = roads;
    const sea = new Sea(scene, data, world);
    G.sea = sea;

    ui.progress(0.88, 'Le buggy, ton personnage et les animaux…');
    const buggy = new Buggy(scene, data, world, veg, props, bank);
    G.buggy = buggy;
    const player = new Player(scene, camera, data, world, veg, props, bank);
    G.player = player;
    const fauna = new Fauna(scene, data, world, veg, bank);
    G.fauna = fauna;
    // abattage et construction
    const lumber = new Lumber(scene, veg, data, props);
    const builder = new Builder(scene, data, props);
    builder.init(bank);
    G.lumber = lumber; G.builder = builder;
    const groundAt = (x, z) => Math.max(data.height(x, z), builder.heightAt(x, z));
    const onBuilt = (x, z) => builder.heightAt(x, z) > data.height(x, z) + 0.03;
    const groundNormal = (x, z, out, e) => {
      if (!builder.pieces.length || (!onBuilt(x, z) && !onBuilt(x + 0.5, z) && !onBuilt(x, z + 0.5) && !onBuilt(x - 0.5, z) && !onBuilt(x, z - 0.5))) return data.normal(x, z, out, e);
      const k = 0.3;
      return out.set(groundAt(x - k, z) - groundAt(x + k, z), 2 * k, groundAt(x, z - k) - groundAt(x, z + k)).normalize();
    };
    player.groundAt = groundAt;
    grassField.excl = (x, z) => builder.pieces.length > 0 && onBuilt(x, z);
    let saveT = null;
    const save = () => { clearTimeout(saveT); saveT = setTimeout(() => writeSave({ ...lumber.save(), builds: builder.save() }), 400); };
    {
      const sv = loadSave();
      if (sv) { lumber.load(sv); builder.load(sv.builds); wl.setCanopy(veg.canopyList()); }
    }
    lumber.onChange = () => { save(); wl.setCanopy(veg.canopyList()); ui.toast(`+ du bois · tu as ${lumber.wood} bûches · bouton Construire`); };
    const fx = new Effects(scene, data, world);
    G.fx = fx;
    buggy.fx = fx;

    const controls = new Controls(canvas, ui);
    const rig = new CameraRig(camera, data);
    G.controls = controls; G.rig = rig;
    player.onStep = (v) => {
      const p = player.pos, h = data.height(p.x, p.z);
      const kind = player.waterLevel(p.x, p.z) - h > 0.15 ? 'water' : h < 2.2 ? 'sand' : 'leaves';
      sound.footstep(kind, clamp(v / 4, 0.4, 1.2));
    };
    buggy.ground = groundAt; buggy.groundNormal = groundNormal; buggy.onBuilt = onBuilt;
    player.onHit = (p, kind, tree) => {
      if (kind === 'tree' && tree) {
        fx.burst(p, 14, [0.78, 0.66, 0.46], 2.2, 2.5, 0.06, 0.9); // copeaux clairs
        sound.chop();
        const left = lumber.hit(tree.i, player.pos);
        if (left > 0) ui.toast(left === 1 ? 'Encore 1 coup…' : `Encore ${left} coups`);
        else { ui.toast('Ça craque… l’arbre tombe !'); sound.creak(); }
      }
      fauna.scare(p, 14);
    };
    const sound = new Sound();
    G.sound = sound;
    fauna.sound = sound;

    const post = new Post(renderer, scene, camera, Q().msaa);
    G.post = post;

    // ---------- réglages ----------
    const applyQuality = () => {
      const q = Q();
      terrain.setQuality(q.terrain);
      veg.setQuality(q.veg);
      grassField.setQuality(q.veg);
      sun.shadow.mapSize.set(q.shadow, q.shadow);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      if (post.msaa !== q.msaa) post.setMSAA(q.msaa);
      G.scale = q.scale;
      resize(true);
    };
    ui.onQuality = (i) => { if (i < 0) { G.autoQ = true; } else { G.autoQ = false; G.qi = i; applyQuality(); } };
    ui.onHour = (h) => { sky.setHour(h); };
    ui.onWeather = (w) => { sky.setWeather(w); };
    ui.onPlace = (k) => teleport(k);
    ui.onCamera = () => { rig.cycle(G.mode === 'foot'); ui.toast(rig.label()); };
    ui.onReset = () => buggy.reset();
    ui.onStart = () => { sound.start(); requestWakeLock(); };

    function teleport(k) {
      const w = world;
      const lip = w.waterfall.lip, dir = w.waterfall.dir;
      const places = {
        plage: [w.spawn.x, w.spawn.z, w.spawn.heading],
        cascade: (() => { const px = -dir[1], pz = dir[0]; const x = w.waterfall.pool[0] + dir[0] * 26 + px * 7, z = w.waterfall.pool[2] + dir[1] * 26 + pz * 7; return [x, z, Math.atan2(lip[0] - x, lip[2] - z)]; })(),
        volcan: [w.volcano.x + 150, w.volcano.z + 120, Math.atan2(-150, -120)],
        piste: [w.strip.x - Math.sin(w.strip.angle) * (w.strip.length / 2 - 60), w.strip.z - Math.cos(w.strip.angle) * (w.strip.length / 2 - 60), w.strip.angle + Math.PI],
        ponton: [w.pier.x0 + 9, w.pier.z0 + 3, Math.atan2(w.pier.x1 - w.pier.x0, w.pier.z1 - w.pier.z0) + 0.25],
      };
      if (k === 'lagon') {
        rig.setMode('drone');
        let best = null;
        for (let r = 20; r < 420 && !best; r += 6) for (let a = 0; a < 6.28; a += 0.15) {
          const xx = w.spawn.x + Math.cos(a) * r, zz = w.spawn.z + Math.sin(a) * r, hh = data.height(xx, zz);
          if (hh < -2.6 && hh > -4.6) { best = [xx, zz]; break; }
        }
        const [x, z] = best || [w.spawn.x, w.spawn.z + 80];
        const bed = data.height(x, z);
        camera.position.set(x, Math.min(bed + 1.6, -1.2), z);
        rig.yaw = Math.PI * 0.5; rig.pitch = -0.12;
        ui.toast('Caméra libre sous l’eau — utilise ▲ ▼ pour monter ou descendre');
        return;
      }
      const p = places[k];
      if (!p) return;
      if (G.mode === 'buggy') buggy.place(p[0], p[1], p[2]);
      else { player.place(p[0], p[1], p[2] + Math.PI); if (rig.mode === 'drone') rig.setMode('foot'); }
      if (k === 'cascade') {
        rig.setMode('drone');
        const pool = w.waterfall.pool;
        camera.position.set(pool[0] + dir[0] * 58, pool[1] + 9, pool[2] + dir[1] * 58);
        rig.yaw = Math.atan2(dir[0], dir[1]); rig.pitch = 0.12;
        ui.toast('Vue libre sur la cascade — appuie sur Caméra pour revenir au buggy');
        return;
      }
      if (G.mode === 'buggy' && rig.mode === 'drone') rig.setMode('chase');
      rig.snap = true;
    }
    G.teleport = teleport;

    // ---------- à pied / en buggy ----------
    const dry = (x, z) => data.height(x, z) > 0.35;
    function enterBuggy() {
      G.mode = 'buggy';
      player.vm.visible = false;
      rig.setMode('chase');
      ui.toast('En voiture ! Bouton orange pour descendre');
    }
    function exitBuggy() {
      const h = buggy.heading, sx = Math.cos(h), sz = -Math.sin(h);
      let x = buggy.pos.x + sx * 2, z = buggy.pos.z + sz * 2;
      if (!dry(x, z)) { x = buggy.pos.x - sx * 2; z = buggy.pos.z - sz * 2; }
      G.mode = 'foot';
      player.place(x, z, h + Math.PI);
      rig.setMode('foot');
    }
    lumber.onImpact = (rec, speed, first) => {
      const p = new THREE.Vector3();
      for (let k = 2; k <= 8; k++) { lumber.pointAt(rec, rec.L * k / 8, p); fx.burst(p, first ? 6 : 2, [0.55, 0.47, 0.36], 3, 1.6, 0.25, 1.6); }
      lumber.pointAt(rec, rec.L * 0.9, p);
      if (first) fx.burst(p, 40, [0.2, 0.34, 0.1], 6, 3.5, 0.09, 2.2); // feuilles arrachées
      const d = p.distanceTo(camera.position), vol = clamp(speed / 12, 0.2, 1) * clamp(30 / (d + 5), 0, 1);
      sound.crash(vol);
      if (G.mode === 'foot' && d < 30) player.shake = Math.max(player.shake, clamp(speed / 10, 0, 1) * (1 - d / 30));
    };
    function actionLabel() {
      if (rig.mode === 'drone') return null;
      if (G.mode === 'foot' && builder.active) {
        const pv = builder.preview(player, lumber.wood);
        return pv && pv.ok ? pv.label : `Pas assez de bois (${PIECES[builder.kind].cost})`;
      }
      if (G.mode === 'buggy') return Math.abs(buggy.speed) < 4 ? 'Descendre' : null;
      if (player.pos.distanceTo(buggy.pos) < 3.4) return 'Monter dans le buggy';
      const p = player.nearPickup();
      if (p) return 'Ramasser ' + p.label;
      if (player.equipped >= 0) return 'Frapper';
      return null;
    }
    function doAction(label) {
      if (!label) return;
      if (label === 'Descendre') exitBuggy();
      else if (label === 'Monter dans le buggy') enterBuggy();
      else if (label.startsWith('Ramasser')) { const p = player.nearPickup(); if (p) ui.toast(player.pick(p) + ' · bouton Outil pour changer'); }
      else if (label === 'Frapper') player.strike();
      else if (label.startsWith('Poser')) {
        const sh = builder.confirm();
        if (sh) { lumber.wood -= PIECES[sh.kind].cost; save(); ui.toast(`${PIECES[sh.kind].label} construit · il te reste ${lumber.wood} bûches`); }
      }
    }
    const buggyCol = [{ x: 0, z: 0, r: 1.05 }, { x: 0, z: 0, r: 1.05 }, { x: 0, z: 0, r: 1.05 }];
    const IDLE = { throttle: 0, steer: 0, brake: 1 };

    function resize(force) {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      G.baseFov = camera.fov = w > h ? 58 : 72;
      camera.updateProjectionMatrix();
      const pr = renderer.getPixelRatio();
      post.setSize(w, h, G.scale, pr);
      void force;
    }
    window.addEventListener('resize', () => resize());
    G.scale = Q().scale;
    resize();

    // ---------- état initial ----------
    sky.setHour(ui.hour);
    sky.setWeather(ui.weather);
    // le personnage apparaît sur la plage ; le buggy l'attend juste devant, en travers
    {
      const sp = world.spawn, h = sp.heading;
      let bx = sp.x + Math.sin(h) * 8, bz = sp.z + Math.cos(h) * 8;
      for (let k = 0; k < 12 && !dry(bx, bz); k++) { bx -= Math.sin(h) * 0.8 + Math.cos(h) * 0.6; bz -= Math.cos(h) * 0.8 - Math.sin(h) * 0.6; }
      buggy.place(bx, bz, h + 1.25);
      player.place(sp.x, sp.z, h + Math.PI);
      const putTools = () => { if (!player.toolsDone && bank.has('axe') && bank.has('rivelaine')) { player.toolsDone = true; player.layTools(sp.x, sp.z, h); } };
      bank.onLoaded(putTools);
      sleep(20000).then(() => { if (!player.toolsDone) { player.toolsDone = true; player.layTools(sp.x, sp.z, h); } });
    }
    rig.attach(buggy);
    rig.setMode('foot');
    rig.snap = true;

    ui.progress(0.95, 'Premier rendu…');
    // premier rendu complet (compile les shaders)
    const clock = new THREE.Clock();
    let last = performance.now(), sunPrev = new THREE.Vector3(), ftAcc = 0, ftN = 0, qTimer = 0;
    const shadowCenter = new THREE.Vector3();
    function frame(now) {
      requestAnimationFrame(frame);
      let dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (G.paused) dt = 0;
      G.frame++;
      renderer.info.reset();
      U.uTime.value += dt;
      // entrées et véhicule
      const input = controls.read();
      if (input.camera) ui.onCamera();
      if (input.reset) buggy.reset();
      const act = actionLabel();
      if (input.act) doAction(act);
      if (input.tool && G.mode === 'foot') { const m = builder.active ? 'Pièce : ' + builder.cycle() : player.cycleTool(); if (m) ui.toast(m); }
      if (input.build) {
        builder.active = !builder.active && G.mode === 'foot';
        ui.toast(builder.active ? 'Mode construction · Outil pour changer de pièce, bouton orange pour poser' : 'Construction terminée');
      }
      if (G.mode !== 'foot' || rig.mode === 'drone') builder.active = false;
      if (!builder.active) builder.preview(player, 0);
      buggy.engineOn = G.mode === 'buggy' ? 1 : 0;
      if (G.mode === 'buggy') {
        buggy.update(dt, rig.mode !== 'drone' ? input : IDLE);
        rig.update(dt, input, buggy);
      } else {
        buggy.update(dt, IDLE);
        if (rig.mode === 'drone') rig.update(dt, input, buggy);
        else {
          const f = new THREE.Vector3(0, 0, 1).applyQuaternion(buggy.quat);
          for (let k = 0; k < 3; k++) { buggyCol[k].x = buggy.pos.x + f.x * (k - 1) * 1.25; buggyCol[k].z = buggy.pos.z + f.z * (k - 1) * 1.25; }
          player.update(dt, input, buggyCol);
          rig.target.copy(player.pos);
        }
      }
      // champ de vision qui s'élargit avec la vitesse (sensation de vitesse), et en sprint
      const fovAdd = rig.mode === 'chase' && G.mode === 'buggy' ? clamp((Math.abs(buggy.speed) - 8) * 0.35, 0, 11) : G.mode === 'foot' && rig.mode === 'foot' && player.speed > 4 ? 4 : 0;
      const fovT = G.baseFov + fovAdd;
      if (Math.abs(camera.fov - fovT) > 0.01) { camera.fov = lerp(camera.fov, fovT, 1 - Math.exp(-dt * 3)); camera.updateProjectionMatrix(); }
      U.uCamPos.value.copy(camera.position);
      // ciel, lumière
      const sunMoved = sky.update(dt, scene) || sunPrev.distanceToSquared(U.uSunDir.value) > 1e-6;
      sunPrev.copy(U.uSunDir.value);
      wl.update(dt, sunMoved);
      sun.color.copy(sky.sunLightColor).lerp(GOLD, 0.45);
      sun.intensity = sky.sunIntensity;
      // ambiance : même rapport que 2,5 (soleil) / 1,3 (ciel), suit l'heure et la météo
      const dayK = clamp(U.uSunDir.value.y * 4 + 0.15, 0.05, 1);
      const ambL0 = U.uSkyAmb.value.r * 0.21 + U.uSkyAmb.value.g * 0.72 + U.uSkyAmb.value.b * 0.07;
      hemi.intensity = Math.max(sky.sunIntensity * (1.3 / 2.5) * 0.55 * dayK * (1 - sky.weather * 0.5), ambL0 * 0.9); // ombres profondes mais jamais noires
      if (scene.environment && (!hdri || scene.environment !== hdri.tex)) skyEnv = scene.environment;
      if (hdri) {
        // la carte suit le soleil du jeu : on la tourne pour aligner son soleil, intensité calée sur le ciel
        scene.environment = hdri.tex;
        scene.environmentIntensity = 0.55 * ambL0 / Math.max(hdri.avg, 1e-4);
        const sd2 = U.uSunDir.value, az = Math.atan2(sd2.x, sd2.z);
        scene.environmentRotation.set(0, az - hdri.sunAz, 0);
      }
      else if (skyEnv) { scene.environment = skyEnv; scene.environmentIntensity = 0.5; }
      // ombre portée centrée devant la caméra, alignée sur la grille d'ombre
      const sr = Q().shadowR;
      const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
      shadowCenter.copy(rig.target).addScaledVector(fwd, sr * 0.45);
      const sc = sun.shadow.camera;
      sc.left = sc.bottom = -sr; sc.right = sc.top = sr; sc.near = 1; sc.far = 900;
      const texel = (2 * sr) / sun.shadow.mapSize.x;
      const sd = U.uSunDir.value;
      const lightDir = new THREE.Vector3(sd.x, Math.max(sd.y, 0.08), sd.z).normalize();
      // aligne le centre sur les texels (repère lumière)
      const lz = lightDir.clone().negate(), lx = new THREE.Vector3(0, 1, 0).cross(lz).normalize(), ly = lz.clone().cross(lx);
      const cx = Math.round(shadowCenter.dot(lx) / texel) * texel, cy = Math.round(shadowCenter.dot(ly) / texel) * texel, cz = shadowCenter.dot(lz);
      shadowCenter.copy(lx).multiplyScalar(cx).addScaledVector(ly, cy).addScaledVector(lz, cz);
      sun.position.copy(shadowCenter).addScaledVector(lightDir, 450);
      sun.target.position.copy(shadowCenter);
      sc.updateProjectionMatrix();
      // exposition automatique
      const sunL = U.uSunColor.value.r * 0.21 + U.uSunColor.value.g * 0.72 + U.uSunColor.value.b * 0.07;
      const ambL = U.uSkyAmb.value.r * 0.21 + U.uSkyAmb.value.g * 0.72 + U.uSkyAmb.value.b * 0.07;
      const refE = sunL * Math.max(sd.y, 0.12) * (0.35 + 0.65 * (1 - sky.weather * 0.6)) + ambL * Math.PI + hemi.intensity * 0.6;
      const targetExp = clamp(5.0 / Math.max(refE, 1.5), 0.35, 2.6);
      G.expo = G.frame < 3 ? targetExp : lerp(G.expo, targetExp, 1 - Math.exp(-dt * 1.5));
      // monde
      terrain.update(camera);
      veg.update(camera, dt);
      water.update(camera, sky.weather);
      props.update(camera, dt);
      roads.update(camera);
      grassField.update(camera);
      lumber.update(dt);
      sea.update(dt, camera);
      fauna.update(dt, camera, G.mode === 'foot' && rig.mode !== 'drone' ? player.pos : null);
      fx.update(dt, camera, sky);
      sound.update(dt, camera, buggy, data, world, sky);
      const drone = rig.mode === 'drone';
      ui.hud({
        speed: drone ? rig.speed : G.mode === 'buggy' ? Math.abs(buggy.speed) : player.speed,
        mode: drone ? 'Caméra libre' : G.mode === 'buggy' ? `Buggy · ${buggy.gear < 0 ? 'R' : buggy.gear + 'e'}` : builder.active ? 'Construction' : player.swimming ? 'À la nage' : 'À pied',
        wood: lumber.wood, build: G.mode === 'foot' && !drone && (lumber.wood > 0 || builder.pieces.length > 0 || builder.active), building: builder.active,
        toolLabel: builder.active ? 'Pièce : ' + PIECES[builder.kind].label : 'Outil',
        upDown: drone || (G.mode === 'foot' && player.swimming), inBuggy: G.mode === 'buggy' && !drone, drone,
        action: act, tools: G.mode === 'foot' && !drone && (player.inv.length > 0 || builder.active), fps: G.fpsAvg,
      });
      camera.updateMatrixWorld();
      post.render(dt, U.uTime.value, G.expo);
      // performance & résolution dynamique
      if (dt > 0) { ftAcc += dt; ftN++; }
      qTimer += dt;
      if (qTimer > 1.0 && ftN > 0) {
        const avg = ftAcc / ftN;
        G.fpsAvg = 1 / avg;
        ftAcc = 0; ftN = 0; qTimer = 0;
        if (G.autoQ && G.ready) {
          const target = isMobile ? 1 / 30 : 1 / 50;
          let s = G.scale;
          if (avg > target * 1.18) s *= 0.9;
          else if (avg < target * 0.8) s *= 1.04;
          s = clamp(s, 0.72, Q().scale);
          if (Math.abs(s - G.scale) > 0.02) { G.scale = s; resize(); }
          if (G.scale <= 0.74 && avg > target * 1.25 && G.qi > 0) { G.qi--; applyQuality(); G.scale = Q().scale; resize(); }
        }
      }
      if (!G.ready && G.frame > 2) {
        G.ready = true;
        ui.ready();
      }
    }
    requestAnimationFrame(frame);
  } catch (e) {
    console.error(e);
    window.__err = e && e.stack;
    ui.error(e && e.message ? e.message : String(e));
  }
}

function nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch (e) { /* refusé : sans importance */ }
}

boot();
export { smoothstep };
