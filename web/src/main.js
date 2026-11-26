// Map Realist — démo temps réel d'une île tropicale volcanique.
import * as THREE from 'three';
import { U, fetchBuf, fetchJSON, clamp, lerp, smoothstep } from './core.js';
import { TerrainData, TerrainMesh, loadTerrainTextures } from './terrain.js';
import { Sky } from './sky.js';
import { WorldLight } from './lighting.js';
import { Water } from './water.js';
import { Post } from './post.js';
import { Vegetation } from './vegetation.js';
import { Grass } from './grass.js';
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
  { name: 'Bas', scale: 0.62, msaa: 0, shadow: 1024, shadowR: 60, sky: 0, terrain: 0, veg: 0 },
  { name: 'Moyen', scale: 0.78, msaa: 2, shadow: 1536, shadowR: 80, sky: 1, terrain: 1, veg: 1 },
  { name: 'Élevé', scale: 0.92, msaa: 4, shadow: 2048, shadowR: 105, sky: 2, terrain: 2, veg: 2 },
  { name: 'Ultra', scale: 1.0, msaa: 4, shadow: 2048, shadowR: 130, sky: 3, terrain: 3, veg: 3 },
];

const G = (window.__game = {
  ready: false, autoQ: true, qi: isMobile ? 1 : 2, frame: 0, fpsAvg: 30, scale: 1, paused: false,
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
    G.renderer = renderer;
    const Q = () => QUALITY[G.qi];

    ui.progress(0.08, 'Chargement du relief de l’île…');
    const [world, tbuf, cbuf, atlasRects] = await Promise.all([
      fetchJSON(`${ASSETS}/world.json`), fetchBuf(`${ASSETS}/terrain.data.json`), fetchBuf(`${ASSETS}/clouds.data.json`), fetchJSON(`${ASSETS}/tex/atlas.json`),
    ]);
    G.world = world;
    const data = new TerrainData(world, tbuf);
    data.makeTextures();
    G.terrain = data;

    ui.progress(0.2, 'Chargement des textures (sable, roche, jungle)…');
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const ttex = await loadTerrainTextures(ASSETS, aniso);

    const scene = new THREE.Scene();
    G.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 45000);
    G.camera = camera;

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
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    sun.shadow.radius = 2;
    scene.add(sun, sun.target);
    G.sun = sun;

    ui.progress(0.42, 'Lagon, récif et cascade…');
    const water = new Water(scene, data, world, sky);
    G.water = water;

    ui.progress(0.5, 'Génération des 100 types d’arbres et des 100 types de buissons…');
    await nextFrame();
    const veg = new Vegetation(renderer, scene, data, world, atlasRects, Q().veg);
    await veg.init(ASSETS, (p, msg) => ui.progress(0.5 + p * 0.25, msg));
    G.veg = veg;
    wl.setCanopy(veg.canopyList());

    ui.progress(0.78, 'Herbe, rochers, avions…');
    await nextFrame();
    const grass = new Grass(scene, data, Q().veg);
    G.grass = grass;
    const props = new Props(scene, data, world, veg.atlas);
    await props.init(ASSETS);
    G.props = props;
    const sea = new Sea(scene, data, world);
    G.sea = sea;

    ui.progress(0.88, 'Le buggy…');
    const buggy = new Buggy(scene, data, world, veg, props);
    G.buggy = buggy;
    const fx = new Effects(scene, data, world);
    G.fx = fx;
    buggy.fx = fx;

    const controls = new Controls(canvas, ui);
    const rig = new CameraRig(camera, data);
    G.controls = controls; G.rig = rig;
    const sound = new Sound();
    G.sound = sound;

    const post = new Post(renderer, Q().msaa);
    G.post = post;

    // ---------- réglages ----------
    const applyQuality = () => {
      const q = Q();
      terrain.setQuality(q.terrain);
      veg.setQuality(q.veg);
      grass.setQuality(q.veg);
      sun.shadow.mapSize.set(q.shadow, q.shadow);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      post.msaa = q.msaa;
      G.scale = q.scale;
      resize(true);
    };
    ui.onQuality = (i) => { if (i < 0) { G.autoQ = true; } else { G.autoQ = false; G.qi = i; applyQuality(); } };
    ui.onHour = (h) => { sky.setHour(h); };
    ui.onWeather = (w) => { sky.setWeather(w); };
    ui.onPlace = (k) => teleport(k);
    ui.onCamera = () => { rig.cycle(); ui.toast(rig.label()); };
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
      buggy.place(p[0], p[1], p[2]);
      if (k === 'cascade') {
        rig.setMode('drone');
        const pool = w.waterfall.pool;
        camera.position.set(pool[0] + dir[0] * 58, pool[1] + 9, pool[2] + dir[1] * 58);
        rig.yaw = Math.atan2(dir[0], dir[1]); rig.pitch = 0.12;
        ui.toast('Vue libre sur la cascade — appuie sur Caméra pour revenir au buggy');
        return;
      }
      if (rig.mode === 'drone') rig.setMode('chase');
      rig.snap = true;
    }
    G.teleport = teleport;

    function resize(force) {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w > h ? 58 : 72;
      camera.updateProjectionMatrix();
      const pr = renderer.getPixelRatio();
      post.setSize(w * pr, h * pr, G.scale);
      if (force) post.rt = post.rt; // no-op
    }
    window.addEventListener('resize', () => resize());
    G.scale = Q().scale;
    resize();

    // ---------- état initial ----------
    sky.setHour(ui.hour);
    sky.setWeather(ui.weather);
    buggy.place(world.spawn.x, world.spawn.z, world.spawn.heading);
    rig.attach(buggy);
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
      if (rig.mode !== 'drone') buggy.update(dt, input);
      else buggy.update(dt, { throttle: 0, steer: 0, brake: 1 });
      rig.update(dt, input, buggy);
      U.uCamPos.value.copy(camera.position);
      // ciel, lumière
      const sunMoved = sky.update(dt, scene) || sunPrev.distanceToSquared(U.uSunDir.value) > 1e-6;
      sunPrev.copy(U.uSunDir.value);
      wl.update(dt, sunMoved);
      sun.color.copy(sky.sunLightColor);
      sun.intensity = sky.sunIntensity;
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
      const refE = sunL * Math.max(sd.y, 0.12) * (0.35 + 0.65 * (1 - sky.weather * 0.6)) + ambL * Math.PI;
      const targetExp = clamp(5.0 / Math.max(refE, 1.5), 0.35, 2.6);
      renderer.toneMappingExposure = G.frame < 3 ? targetExp : lerp(renderer.toneMappingExposure, targetExp, 1 - Math.exp(-dt * 1.5));
      // monde
      terrain.update(camera);
      veg.update(camera, dt);
      grass.update(camera);
      water.update(camera, sky.weather);
      props.update(camera, dt);
      sea.update(dt, camera);
      fx.update(dt, camera, sky);
      sound.update(dt, camera, buggy, data, world, sky);
      ui.hud(buggy, rig, G.fpsAvg);
      camera.updateMatrixWorld();
      post.render(scene, camera, U.uTime.value);
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
          s = clamp(s, 0.5, Q().scale);
          if (Math.abs(s - G.scale) > 0.02) { G.scale = s; resize(); }
          if (G.scale <= 0.52 && avg > target * 1.3 && G.qi > 0) { G.qi--; applyQuality(); G.scale = Q().scale * 0.8; resize(); }
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
    ui.error(e && e.message ? e.message : String(e));
  }
}

function nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch (e) { /* refusé : sans importance */ }
}

boot();
export { smoothstep };
