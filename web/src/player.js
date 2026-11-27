// Personnage à pied (vue à la première personne) : marche, course, saut, nage et plongée,
// collisions avec les troncs, rochers et véhicules ; ramasser et utiliser la hache et la rivelaine.
import * as THREE from 'three';
import { patchMaterial, clamp, lerp } from './core.js';
import { fitToGround } from './models.js';

const V3 = THREE.Vector3;
const EYE = 1.66, RAD = 0.34;
const TOOLS = { axe: 'la hache', rivelaine: 'la rivelaine' };
const LABELS = { ...TOOLS, torch: 'la lampe torche', binoculars: 'les jumelles' };
// rotation exprimée dans le repère du parent (les rotations s'enchaînent sans se mélanger)
const rotW = (o, x, y, z, a) => o.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new V3(x, y, z), a));

export class Player {
  constructor(scene, camera, terrain, world, flora, props, bank) {
    this.scene = scene; this.camera = camera; this.T = terrain; this.world = world; this.flora = flora; this.props = props; this.bank = bank;
    this.pos = new V3(); this.vel = new V3();
    this.yaw = 0; this.pitch = -0.05;
    this.onGround = true; this.swimming = false; this.bob = 0; this.speed = 0; this.shake = 0;
    this.trunks = [];
    this.pickups = []; this.inv = []; this.equipped = -1;
    this.vm = new THREE.Group(); // outil tenu en main, attaché à la caméra
    camera.add(this.vm);
    this.swing = -1;
    this.onHit = null;
    // lampe torche : projecteur attaché à la caméra (toujours présent, éteint = puissance nulle)
    this.torchOn = false; this.beamAngle = 0.32;
    const L = new THREE.SpotLight(0xfff1dc, 0, 60, this.beamAngle, 0.95, 2);
    L.castShadow = false; L.shadow.mapSize.set(1024, 1024); L.shadow.bias = -0.0006; L.shadow.autoUpdate = false;
    L.position.set(0.22, -0.22, -0.35);
    L.target.position.set(0.04, -0.12, -12);
    camera.add(L); camera.add(L.target);
    this.torchLight = L;
    // jumelles
    this.zoomOn = false; this.zoom = 6;
    this.groundAt = (x, z) => this.T.height(x, z);
  }

  place(x, z, yaw) {
    this.pos.set(x, Math.max(this.T.height(x, z), this.waterLevel(x, z) - 1.4), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = -0.05;
    this.applyCamera(0);
  }

  waterLevel(x, z) {
    const p = this.world.waterfall.pool;
    if (Math.hypot(x - p[0], z - p[2]) < this.world.waterfall.poolR) return p[1];
    for (const q of this.world.ponds || []) if (Math.hypot(x - q.x, z - q.z) < q.r * 1.9 && this.T.height(x, z) < q.level) return q.level;
    return 0;
  }

  // ---------- outils ----------
  layTools(x, z, heading) {
    const fx = Math.sin(heading), fz = Math.cos(heading), rx = Math.cos(heading), rz = -Math.sin(heading);
    let k = 0;
    for (const name of Object.keys(TOOLS)) {
      if (!this.bank.has(name)) continue;
      const o = this.ground(name);
      const px = x + fx * 2.6 + rx * (k ? 1.1 : -1.1), pz = z + fz * 2.6 + rz * (k ? 1.1 : -1.1);
      o.position.set(px, this.T.height(px, pz) + 0.01, pz);
      o.rotation.y = heading + (k ? 0.6 : -0.9);
      this.scene.add(o);
      this.pickups.push({ name, obj: o, label: TOOLS[name] });
      k++;
    }
  }
  patch(o) { o.traverse((m) => { if (m.isMesh) { m.material = patchMaterial(m.material, { key: 'tool' }); m.castShadow = true; } }); return o; }
  // posé à plat sur le sable
  ground(name) {
    const o = this.bank.instance(name);
    const inner = o.children[0];
    const s = new THREE.Box3().setFromObject(inner).getSize(new V3());
    if (s.y > Math.max(s.x, s.z) * 0.7) rotW(inner, 1, 0, 0, Math.PI / 2);
    fitToGround(inner, 0, 'none');
    return this.patch(o);
  }
  // modèle « en main » : manche vertical, tête vers le haut, prise au bas du manche
  held(name) {
    const o = this.bank.instance(name);
    const inner = o.children[0];
    let s = new THREE.Box3().setFromObject(inner).getSize(new V3());
    if (s.x >= s.y && s.x >= s.z) rotW(inner, 0, 0, 1, Math.PI / 2);
    else if (s.z >= s.y && s.z >= s.x) rotW(inner, 1, 0, 0, Math.PI / 2);
    fitToGround(inner, 0, 'none');
    // quel bout est la tête ? celui dont la section est la plus large
    inner.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(inner, true), H = b.max.y - b.min.y, v = new V3();
    let top = 0, bot = 0, topX = 0, topZ = 0;
    inner.traverse((m) => {
      if (!m.isMesh) return;
      const pa = m.geometry.attributes.position;
      for (let i = 0; i < pa.count; i += 3) {
        v.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld);
        const r = Math.hypot(v.x, v.z), t = (v.y - b.min.y) / H;
        if (t > 0.75) { top = Math.max(top, r); topX = Math.max(topX, Math.abs(v.x)); topZ = Math.max(topZ, Math.abs(v.z)); } else if (t < 0.25) bot = Math.max(bot, r);
      }
    });
    if (bot > top) { rotW(inner, 1, 0, 0, Math.PI); fitToGround(inner, 0, 'none'); }
    if (topZ > topX) rotW(inner, 0, 1, 0, Math.PI / 2); // la lame de profil
    fitToGround(inner, 0, 'none');
    inner.position.y -= H * 0.16; // la main tient le manche près du bas
    o.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.frustumCulled = false; } });
    return { obj: this.patch(o), len: H };
  }
  addPickup(name, x, y, z, rotY) {
    const o = this.bank.instance(name, { measure: 'none' });
    if (!o) return;
    this.patch(o);
    o.position.set(x, y, z); o.rotation.y = rotY;
    this.scene.add(o);
    this.pickups.push({ name, obj: o, label: LABELS[name] });
  }
  // modèle tenu « tel quel » (taille réelle), orienté vers l'avant
  heldReal(name) {
    const o = this.bank.instance(name, { measure: 'none' });
    const inner = o.children[0];
    if (name === 'torch') {
      // l'axe le plus long devient l'axe de visée ; la vitre (verre) vers l'avant
      inner.updateMatrixWorld(true);
      const s = new THREE.Box3().setFromObject(inner).getSize(new V3());
      if (s.x >= s.z) rotW(inner, 0, 1, 0, Math.PI / 2);
      fitToGround(inner, 0, 'none'); inner.updateMatrixWorld(true);
      let gz = 0, n = 0;
      inner.traverse((m) => { if (m.isMesh && /glass/i.test(m.material.name)) { const b = new THREE.Box3().setFromObject(m); gz += (b.min.z + b.max.z) / 2; n++; } });
      if (n && gz / n > 0) rotW(inner, 0, 1, 0, Math.PI);
      fitToGround(inner, 0, 'none');
      inner.position.y -= 0.03;
    }
    o.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.frustumCulled = false; } });
    return { obj: this.patch(o), len: 0.25 };
  }
  equip(i) {
    this.equipped = i;
    this.vm.clear();
    this.zoomOn = false;
    if (i < 0) return;
    const name = this.inv[i];
    const h = name === 'torch' || name === 'binoculars' ? this.heldReal(name) : this.held(name);
    this.vm.add(h.obj);
    this.vmLen = h.len;
  }
  cycleTool() {
    if (!this.inv.length) return null;
    const n = this.equipped + 1;
    this.equip(n >= this.inv.length ? -1 : n);
    return this.equipped < 0 ? 'Mains libres' : 'En main : ' + LABELS[this.inv[this.equipped]];
  }
  nearPickup() {
    let best = null, bd = 2.3;
    for (const p of this.pickups) {
      const d = Math.hypot(p.obj.position.x - this.pos.x, p.obj.position.z - this.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  pick(p) {
    this.scene.remove(p.obj);
    this.pickups.splice(this.pickups.indexOf(p), 1);
    this.inv.push(p.name);
    this.equip(this.inv.length - 1);
    return 'Tu as ramassé ' + p.label;
  }
  strike() {
    const tool = this.tool();
    if (tool === 'torch') { this.torchOn = !this.torchOn; return; }
    if (tool === 'binoculars') { this.zoomOn = !this.zoomOn; return; } if (this.equipped >= 0 && this.swing < 0) this.swing = 0; }

  // ---------- déplacement ----------
  update(dt, inp, extra) {
    const T = this.T;
    // aux jumelles, la visée devient plus fine (sensibilité divisée par le grossissement)
    const sens = this.zoomOn ? 1 / this.zoom : 1;
    this.yaw -= inp.lookX * 0.0042 * sens;
    this.pitch = clamp(this.pitch - inp.lookY * 0.0036 * sens, -1.4, 1.35);
    const fwd = new V3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), right = new V3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new V3().addScaledVector(fwd, inp.throttle).addScaledVector(right, inp.steer);
    const mag = Math.min(1, wish.length());
    if (mag > 1e-3) wish.multiplyScalar(1 / wish.length());
    const g = this.groundAt(this.pos.x, this.pos.z), wl = this.waterLevel(this.pos.x, this.pos.z);
    const depth = wl - g;
    // nage : l'eau est plus profonde que la poitrine
    this.swimming = depth > 1.35 && this.pos.y < wl - 1.1;
    let sp;
    if (this.swimming) sp = (inp.fast || mag > 0.92 ? 2.1 : 1.3) * mag;
    else sp = (inp.fast || (inp.analog && mag > 0.92) ? 5.6 : 1.9) * mag;
    if (!this.swimming && depth > 0.5) sp *= 0.6; // on avance moins vite dans l'eau
    const ax = 1 - Math.exp(-dt * (this.onGround || this.swimming ? 10 : 1.5));
    this.vel.x = lerp(this.vel.x, wish.x * sp, ax);
    this.vel.z = lerp(this.vel.z, wish.z * sp, ax);
    if (this.swimming) {
      // flotte la tête hors de l'eau ; ▼ pour plonger, ▲ pour remonter
      const dive = (inp.down ? -1 : 0) + (inp.up ? 1 : 0);
      const surf = wl - EYE + 0.12;
      if (dive) this.vel.y = lerp(this.vel.y, dive * 1.4, 1 - Math.exp(-dt * 4));
      else this.vel.y = lerp(this.vel.y, (surf - this.pos.y) * 2.2, 1 - Math.exp(-dt * 3));
      if (!dive && inp.jump && this.pos.y > surf - 0.3) this.vel.y = 3.2;
    } else {
      if (this.onGround && inp.jump) { this.vel.y = 4.6; this.onGround = false; }
      this.vel.y -= 9.81 * dt;
    }
    // pentes trop raides : on ne monte pas
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const gn = this.groundAt(nx, nz), step = Math.hypot(nx - this.pos.x, nz - this.pos.z);
    if (this.onGround && step > 1e-4 && (gn - g) / step > 1.15 && gn > wl) { this.vel.x *= 0.1; this.vel.z *= 0.1; }
    else { this.pos.x = nx; this.pos.z = nz; }
    this.pos.y += this.vel.y * dt;
    this.collide(extra);
    const gg = this.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y <= gg + 0.02 || (this.onGround && !this.swimming && this.vel.y <= 0 && this.pos.y - gg < 0.45)) {
      this.pos.y = gg; if (this.vel.y < 0) this.vel.y = 0; this.onGround = true;
    } else this.onGround = false;
    if (this.swimming) this.onGround = false;
    this.pos.y = Math.min(this.pos.y, Math.max(gg, wl) + 40);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.applyCamera(dt);
  }

  collide(extra) {
    const list = this.flora.trunksNear(this.pos.x, this.pos.z, 3, this.trunks);
    const near = (c) => Math.abs(c.x - this.pos.x) < 9 && Math.abs(c.z - this.pos.z) < 9;
    const all = list.concat(this.props.colliders.filter(near), extra.filter(near));
    for (const c of all) {
      if (c.top !== undefined && this.pos.y > c.top) continue;
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z, d = Math.hypot(dx, dz), R = c.r + RAD;
      if (d < R && d > 1e-5) {
        const nx = dx / d, nz = dz / d;
        this.pos.x += nx * (R - d); this.pos.z += nz * (R - d);
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) { this.vel.x -= nx * vn; this.vel.z -= nz * vn; }
      }
    }
  }

  applyCamera(dt) {
    const cam = this.camera;
    const moving = this.onGround && this.speed > 0.3;
    if (moving) {
      const before = Math.sin(this.bob);
      this.bob += dt * (this.speed > 3 ? 11.5 : 7.5);
      if (Math.sign(before) !== Math.sign(Math.sin(this.bob)) && this.onStep) this.onStep(this.speed);
    }
    const amp = moving ? Math.min(this.speed, 5.6) * 0.0085 : 0;
    this.bobAmp = lerp(this.bobAmp || 0, amp, 1 - Math.exp(-dt * 8));
    const by = Math.abs(Math.sin(this.bob)) * this.bobAmp * 2 - this.bobAmp, bx = Math.cos(this.bob) * this.bobAmp;
    this.shake = Math.max(0, this.shake - dt * 3);
    const sh = this.shake * 0.02;
    const eye = this.swimming ? EYE - 0.1 + Math.sin(performance.now() * 0.0018) * 0.04 : EYE;
    cam.position.set(this.pos.x + Math.cos(this.yaw) * bx, this.pos.y + eye + by + (Math.random() - 0.5) * sh, this.pos.z - Math.sin(this.yaw) * bx);
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch + (Math.random() - 0.5) * sh, this.yaw, Math.sin(this.bob * 0.5) * this.bobAmp * 0.25, 'YXZ'));
    this.updateTool(dt, bx, by);
  }

  tool() { return this.equipped >= 0 ? this.inv[this.equipped] : null; }
  updateTool(dt, bx, by) {
    const vm = this.vm, tool = this.tool();
    const lit = tool === 'torch' && this.torchOn;
    this.torchLight.power = lit ? 1000 : 0; // 1000 lumens
    this.torchLight.angle = this.beamAngle;
    this.torchLight.shadow.autoUpdate = lit;
    if (this.beam) { this.beam.visible = lit; const r = Math.tan(this.beamAngle) * 14; this.beam.scale.set(r, r, 14); }
    if (tool !== 'binoculars') this.zoomOn = false;
    vm.visible = this.equipped >= 0 && !this.zoomOn;
    if (!vm.visible) return;
    if (tool === 'torch' || tool === 'binoculars') {
      vm.position.set(0.24 + bx * 0.6, -0.26 + by * 0.6, -0.42);
      vm.rotation.set(tool === 'torch' ? 0.05 : -0.2, tool === 'torch' ? 0.06 : 0, 0);
      return;
    }
    let rx = -0.45, ry = -0.25, rz = -0.25, px = 0.36 + bx * 0.6, py = -0.47 + by * 0.6, pz = -0.6;
    if (this.swing >= 0) {
      this.swing += dt / 0.55;
      const t = this.swing;
      // armé en arrière puis frappe vers l'avant
      const k = t < 0.35 ? -Math.sin((t / 0.35) * Math.PI * 0.5) * 0.75 : t < 0.55 ? -0.75 + ((t - 0.35) / 0.2) * 1.85 : 1.1 * (1 - (t - 0.55) / 0.45);
      rx -= k; py += Math.max(0, -k) * 0.08; pz -= Math.max(0, k) * 0.12; px -= Math.max(0, k) * 0.08;
      if (!this.hitDone && t > 0.5) { this.hitDone = true; this.hit(); }
      if (t >= 1) { this.swing = -1; this.hitDone = false; }
    }
    vm.position.set(px, py, pz);
    vm.rotation.set(rx, ry, rz);
  }

  hit() {
    const dir = new V3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const list = this.flora.trunksNear(this.pos.x, this.pos.z, 2.6, this.trunks);
    let best = null, bd = 1e9;
    for (const c of list) {
      const dx = c.x - this.pos.x, dz = c.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d - c.r < 1.25 && (dx * dir.x + dz * dir.z) / d > 0.55 && d < bd) { bd = d; best = c; }
    }
    if (best) {
      this.shake = 1;
      const p = new V3(best.x - dir.x * best.r, this.pos.y + 1.1, best.z - dir.z * best.r);
      this.onHit && this.onHit(p, 'tree', best);
    } else {
      const rock = this.props.rockAt && this.props.rockAt(this.pos.x, this.pos.z, dir.x, dir.z);
      if (rock) { this.shake = 0.8; this.onHit && this.onHit(new V3(rock.x - dir.x * rock.size * 0.35, this.pos.y + 0.6, rock.z - dir.z * rock.size * 0.35), 'rock', rock); }
      else this.onHit && this.onHit(this.pos.clone().addScaledVector(dir, 1.2), 'air');
    }
  }
}
