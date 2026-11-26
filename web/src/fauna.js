// Faune animée : modèles .glb du joueur, patrouilles au sol, nage, vol et oiseaux perchés dans les palmiers.
// Les animations intégrées passent par AnimationMixer ; les modèles sans animation reçoivent un mouvement procédural.
import * as THREE from 'three';
import { patchMaterial, mulberry32, clamp, lerp } from './core.js';
import { makeMixer } from './models.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;

// hab : habitat ; n : nombre ; v : vitesse de marche (m/s) ; back : l'avant du modèle est -z ; far : distance d'affichage
const SPECIES = {
  tiger: { n: 14, hab: 'jungle', v: 1.3, run: 7, far: 110, clip: ['walk', 'run'], shy: 7, call: 'tiger' },
  jaguar: { n: 14, hab: 'jungle', v: 1.2, run: 7, far: 110, clip: ['walk', 'all'], shy: 7, call: 'jaguar' },
  boar: { n: 30, hab: 'jungle', v: 1.1, run: 5, far: 90, clip: ['walkfast', 'walk'], idle: ['idle', 'breath'], shy: 8, call: 'boar' },
  komodo: { n: 18, hab: 'coast', v: 0.7, run: 3, far: 90, back: true, shy: 4, call: 'hiss' },
  python: { n: 16, hab: 'jungle', v: 0.3, run: 0.6, far: 60, slither: true, shy: 2, call: 'hiss' },
  monkey: { n: 60, hab: 'jungle', v: 1.4, run: 4, far: 70, hop: true, shy: 5, call: 'monkey' },
  crab: { n: 40, hab: 'sand', v: 0.35, run: 1.4, far: 40, side: true, shy: 3 },
  croc: { n: 3, hab: 'pool', v: 0.6, run: 1.5, far: 160, swimY: -0.28, clip: ['swim'], shy: 0, call: 'croc' },
  turtle: { n: 26, hab: 'lagoon', v: 0.6, far: 70, back: true, swim: true, clip: ['swim'] },
  fishschool: { n: 16, hab: 'lagoon', v: 0.8, far: 70, swim: true, clip: ['take', ''] },
  shark: { n: 8, hab: 'reef', v: 1.6, far: 130, swim: true, clip: ['swim'] },
  seagull: { n: 40, hab: 'sky', v: 9, far: 260, back: true, fly: true, clip: ['animation', ''], call: 'seagull' },
  parrot: { n: 18, perch: true, far: 80, call: 'parrot' },
  aracari: { n: 14, perch: true, far: 70, cut: 0.42, call: 'aracari' },
  parrots: { n: 12, perch: true, far: 80, call: 'parrot' },
};
// cris : portée d'écoute (m) et intervalle moyen entre deux cris d'un même animal (s)
const CALLS = { tiger: [120, 40], jaguar: [90, 45], boar: [40, 18], hiss: [18, 25], monkey: [110, 14], croc: [50, 30], seagull: [150, 12], parrot: [80, 16], aracari: [60, 18] };


export class Fauna {
  constructor(scene, terrain, world, flora, bank) {
    this.scene = scene; this.T = terrain; this.world = world; this.flora = flora; this.bank = bank;
    this.list = [];
    this.rnd = mulberry32(4242);
    this.matCache = new Map(); this.orig = new Map();
    this.t = 0;
    this.pending = Object.keys(SPECIES);
    this.clipPlanes = [];
    bank.onLoaded((name) => { if (SPECIES[name]) this.spawnSpecies(name); });
  }

  // ---------- habitats ----------
  hab(kind, x, z) {
    const T = this.T, h = T.height(x, z);
    switch (kind) {
      case 'jungle': return h > 6 && h < 150 && T.slope(x, z) < 0.28;
      case 'coast': return h > 1.3 && h < 14 && T.slope(x, z) < 0.25;
      case 'sand': return h > 0.12 && h < 1.5;
      case 'lagoon': return h < -1.8 && h > -7;
      case 'reef': return h < -6 && h > -26;
      default: return true;
    }
  }
  findSpot(kind, cx, cz, r, tries = 300) {
    const rnd = this.rnd;
    for (let i = 0; i < tries; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * r;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (this.hab(kind, x, z)) return new V3(x, this.T.height(x, z), z);
    }
    return null;
  }

  material(m, name) {
    let out = this.matCache.get(m);
    if (!out) {
      const src = m.clone();
      out = patchMaterial(m, { key: 'fauna' + m.type + (m.alphaTest > 0 ? 'a' : '') });
      this.matCache.set(m, out);
      this.orig.set(out, src);
    }
    return out;
  }

  spawnSpecies(name) {
    const sp = SPECIES[name], w = this.world, rnd = this.rnd;
    const sx = w.spawn.x, sz = w.spawn.z;
    for (let k = 0; k < sp.n; k++) {
      const obj = this.bank.instance(name);
      if (!obj) return;
      obj.traverse((o) => { if (o.isMesh) { o.material = this.material(o.material, name); o.castShadow = !sp.fly; } });
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new V3());
      const a = { name, sp, obj, size, L: Math.max(size.x, size.z), pos: new V3(), heading: rnd() * TAU, target: null, state: 'idle', t: rnd() * 4, phase: rnd() * 10, speed: 0, fear: 0 };
      // animation intégrée
      a.mix = makeMixer(obj);
      if (a.mix) {
        const clip = sp.clip ? a.mix.pick(...sp.clip) || a.mix.clips[0] : a.mix.clips[0];
        a.walk = a.mix.mixer.clipAction(clip);
        a.walk.play();
        a.walk.time = rnd() * clip.duration;
        const ic = sp.idle && a.mix.pick(...sp.idle);
        if (ic && ic !== clip) { a.idle = a.mix.mixer.clipAction(ic); a.idle.play(); a.idle.weight = 0; }
      }
      if (!this.place(a, k)) { continue; }
      this.scene.add(obj);
      this.list.push(a);
    }
  }

  place(a, k) {
    const sp = a.sp, w = this.world, rnd = this.rnd;
    const near = k < Math.ceil(sp.n * 0.75); // la plupart autour du point de départ, pour qu'on les croise
    const cx = near ? w.spawn.x : 0, cz = near ? w.spawn.z : 0, R = near ? 320 : this.T.W * 0.42;
    if (sp.perch) {
      const tops = this.flora.palmTops(1, { x: w.spawn.x, z: w.spawn.z, r: near ? 160 : 420 }, rnd);
      if (!tops.length) return false;
      a.pos.copy(tops[0]);
      if (sp.cut) {
        // l'aracari est livré sur un socle : on coupe tout ce qui est sous ses pattes
        a.pos.y -= a.size.y * sp.cut;
        const plane = new THREE.Plane(new V3(0, 1, 0), -(a.pos.y + a.size.y * sp.cut));
        a.obj.traverse((o) => {
          if (!o.isMesh) return;
          const m = this.orig.get(o.material) || o.material;
          o.material = patchMaterial(m.clone(), { key: 'faunaClip' });
          o.material.clippingPlanes = [plane];
        });
      }
      a.home = a.pos.clone();
      this.applyPose(a, 0);
      return true;
    }
    if (sp.fly) {
      a.home = new V3(w.spawn.x + (rnd() - 0.5) * 260, 0, w.spawn.z + (rnd() - 0.5) * 260);
      a.R = 25 + rnd() * 45; a.alt = 14 + rnd() * 26; a.dir = rnd() < 0.5 ? 1 : -1; a.ang = rnd() * TAU;
      a.pos.set(a.home.x + Math.cos(a.ang) * a.R, a.alt, a.home.z + Math.sin(a.ang) * a.R);
      return true;
    }
    if (sp.hab === 'pool') {
      const p = w.waterfall.pool;
      a.pool = { x: p[0], y: p[1], z: p[2], r: w.waterfall.poolR * 0.62 };
      a.pos.set(p[0] + (k - 0.5) * 6, p[1] + sp.swimY, p[2] + (rnd() - 0.5) * 4);
      a.home = a.pos.clone();
      return true;
    }
    const spot = this.findSpot(sp.hab, cx, cz, R) || this.findSpot(sp.hab, 0, 0, this.T.W * 0.45);
    if (!spot) return false;
    a.pos.copy(spot);
    a.home = spot.clone();
    if (sp.swim) a.pos.y = this.swimY(a, spot.x, spot.z);
    return true;
  }
  swimY(a, x, z) {
    const bed = this.T.height(x, z);
    if (a.name === 'shark') return clamp(bed + 2.5, -9, -2.6);
    if (a.name === 'fishschool') return clamp(bed + 1.6, -4.5, -1.6) - a.size.y * 0.4;
    return clamp(bed + 0.9, -3.2, -0.9);
  }

  // ---------- comportement ----------
  pickTarget(a) {
    const sp = a.sp, rnd = this.rnd;
    if (a.pool) {
      const an = rnd() * TAU, d = Math.sqrt(rnd()) * a.pool.r;
      return new V3(a.pool.x + Math.cos(an) * d, a.pool.y + sp.swimY, a.pool.z + Math.sin(an) * d);
    }
    for (let i = 0; i < 24; i++) {
      const an = a.heading + (rnd() - 0.5) * 2.6, d = 6 + rnd() * (sp.swim ? 40 : 26);
      let x = a.pos.x + Math.sin(an) * d, z = a.pos.z + Math.cos(an) * d;
      // reste dans son territoire
      const hx = x - a.home.x, hz = z - a.home.z, hd = Math.hypot(hx, hz), HR = sp.swim ? 120 : 70;
      if (hd > HR) { x = a.home.x + hx / hd * HR; z = a.home.z + hz / hd * HR; }
      const mx = (x + a.pos.x) / 2, mz = (z + a.pos.z) / 2;
      if (this.hab(sp.hab, x, z) && this.hab(sp.hab, mx, mz)) return new V3(x, 0, z);
    }
    return null;
  }

  scare(p, r) {
    for (const a of this.list) if (!a.sp.perch && !a.sp.fly && a.pos.distanceTo(p) < r) { a.fear = 4; a.state = 'idle'; a.t = 0; }
  }

  update(dt, camera, player) {
    if (dt <= 0) return;
    this.t += dt;
    const cp = camera.position;
    for (const a of this.list) {
      const d = a.pos.distanceTo(cp);
      const vis = d < a.sp.far;
      a.obj.visible = vis;
      // les animaux lointains bougent moins souvent (économie de calcul)
      a.acc = (a.acc || 0) + dt;
      if (!vis && a.acc < 0.5) continue;
      const step = a.acc; a.acc = 0;
      // fuite à l'approche du joueur
      if (player && a.sp.shy && !a.fear && player.distanceTo(a.pos) < a.sp.shy) a.fear = 3;
      this.think(a, step, player);
      this.applyPose(a, step);
      if (a.mix && vis && d < 90) a.mix.mixer.update(step);
      // cris des animaux proches
      const call = a.sp.call && CALLS[a.sp.call];
      if (call && this.sound && d < call[0]) {
        a.callT = (a.callT ?? this.rnd() * call[1]) - step;
        if (a.callT <= 0 && this.t - (this.lastCall || 0) > 0.35) {
          a.callT = call[1] * (0.5 + this.rnd());
          this.lastCall = this.t;
          const dx = a.pos.x - cp.x, dz = a.pos.z - cp.z;
          const fw = this._fw || (this._fw = new V3()); camera.getWorldDirection(fw);
          const pan = clamp((dx * -fw.z + dz * fw.x) / Math.max(Math.hypot(dx, dz), 1), -1, 1);
          this.sound.animal(a.sp.call, clamp(12 / (d + 6), 0.05, 1), pan);
        }
      }
    }
  }

  think(a, dt, player) {
    const sp = a.sp;
    a.phase += dt;
    if (sp.perch) return;
    if (sp.fly) {
      a.ang += a.dir * (sp.v / a.R) * dt;
      const wob = Math.sin(this.t * 0.31 + a.phase * 0.07) * 4;
      a.pos.set(a.home.x + Math.cos(a.ang) * a.R, a.alt + wob, a.home.z + Math.sin(a.ang) * a.R);
      a.heading = Math.atan2(-Math.sin(a.ang) * a.dir, Math.cos(a.ang) * a.dir);
      a.speed = sp.v;
      return;
    }
    a.fear = Math.max(0, a.fear - dt);
    if (a.fear > 0 && player && !a.flee && !a.pool) {
      // s'éloigne du joueur
      const dx = a.pos.x - player.x, dz = a.pos.z - player.z, l = Math.hypot(dx, dz) || 1;
      const t = new V3(a.pos.x + dx / l * 18, 0, a.pos.z + dz / l * 18);
      if (this.hab(sp.hab, t.x, t.z)) { a.target = t; a.state = 'walk'; a.flee = true; }
    }
    if (a.state === 'idle') {
      a.t -= dt;
      a.speed = lerp(a.speed, 0, 1 - Math.exp(-dt * 4));
      if (a.t <= 0) {
        a.target = this.pickTarget(a);
        if (a.target) a.state = 'walk'; else a.t = 2;
      }
      return;
    }
    const dx = a.target.x - a.pos.x, dz = a.target.z - a.pos.z, dist = Math.hypot(dx, dz);
    if (dist < Math.max(1.2, a.L * 0.5)) {
      a.state = 'idle'; a.flee = false;
      a.t = sp.swim ? 0.5 + this.rnd() * 2 : 2 + this.rnd() * 7;
      return;
    }
    let want = Math.atan2(dx, dz), dh = want - a.heading;
    while (dh > Math.PI) dh -= TAU; while (dh < -Math.PI) dh += TAU;
    const turn = (sp.swim ? 0.6 : 1.6) * dt;
    a.heading += clamp(dh, -turn, turn);
    const vmax = a.fear > 0 && sp.run ? sp.run : sp.v;
    const v = vmax * clamp(Math.cos(dh), 0.15, 1);
    a.speed = lerp(a.speed, v, 1 - Math.exp(-dt * 3));
    const nx = a.pos.x + Math.sin(a.heading) * a.speed * dt, nz = a.pos.z + Math.cos(a.heading) * a.speed * dt;
    if (!a.pool && !this.hab(sp.hab, nx, nz)) { a.state = 'idle'; a.t = 0.3; a.heading += Math.PI * 0.5; return; }
    a.pos.x = nx; a.pos.z = nz;
    if (a.pool) a.pos.y = a.pool.y + sp.swimY;
    else if (sp.swim) a.pos.y = lerp(a.pos.y, this.swimY(a, nx, nz), 1 - Math.exp(-dt));
    else a.pos.y = this.T.height(nx, nz);
  }

  applyPose(a, dt) {
    const sp = a.sp, o = a.obj, T = this.T;
    let yaw = a.heading + (sp.back ? Math.PI : 0), pitch = 0, roll = 0, y = a.pos.y;
    if (sp.side) yaw -= Math.PI / 2;
    if (!sp.swim && !sp.fly && !sp.perch && !a.pool) {
      // suit la pente du terrain
      const L = Math.max(a.L * 0.45, 0.2), fx = Math.sin(a.heading) * L, fz = Math.cos(a.heading) * L;
      const hf = T.height(a.pos.x + fx, a.pos.z + fz), hb = T.height(a.pos.x - fx, a.pos.z - fz);
      pitch = Math.atan2(hb - hf, 2 * L) * (sp.side ? 0 : 1);
      y = (hf + hb) * 0.5 * 0.5 + a.pos.y * 0.5;
    }
    const moving = a.speed > 0.05;
    if (!a.mix && moving) {
      // démarche procédurale pour les modèles sans animation
      const f = a.speed / Math.max(a.L, 0.2) * 2.2;
      a.gait = (a.gait || 0) + f * dt * TAU;
      if (sp.slither) yaw += Math.sin(a.gait * 0.5) * 0.22;
      else if (sp.hop) y += Math.max(0, Math.sin(a.gait)) * a.size.y * 0.12;
      else { y += Math.abs(Math.sin(a.gait)) * a.size.y * 0.025; roll = Math.sin(a.gait) * 0.035; }
    }
    if (sp.fly) { roll = -a.dir * 0.32; pitch = Math.sin(this.t * 0.5 + a.phase) * 0.06; }
    if (sp.swim) { roll = Math.sin(a.phase * 0.9) * 0.05; pitch = Math.sin(a.phase * 0.6) * 0.04; }
    if (sp.perch) yaw = a.heading + Math.sin(this.t * 0.4 + a.phase) * 0.5;
    o.position.set(a.pos.x, y, a.pos.z);
    o.rotation.set(pitch, yaw, roll, 'YXZ');
    if (a.walk) {
      const nominal = sp.swim || sp.fly ? 1 : a.L * 0.55;
      a.walk.timeScale = sp.fly || sp.swim ? 1 : clamp(a.speed / nominal, 0, 2.2);
      if (a.idle) { const k = clamp(a.speed / 0.3, 0, 1); a.walk.weight = k; a.idle.weight = 1 - k; a.idle.timeScale = 1; }
    }
  }

  count() { return this.list.length; }
}
