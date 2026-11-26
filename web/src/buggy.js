// Buggy tout-terrain : modèle procédural, physique (suspensions, adhérence selon le sol), traces de pneus.
import * as THREE from 'three';
import { U, GLSL_COMMON, patchMaterial, clamp, lerp, mergeGeometries, vnoise } from './core.js';

const V3 = THREE.Vector3;
const COM_H = 0.55;           // hauteur du centre de gravité au repos
const WR = 0.4;               // rayon des roues
const WHEELS = [[-0.86, 1.28], [0.86, 1.28], [-0.86, -1.24], [0.86, -1.24]]; // x, z (avant = +z)
const LNAT = 0.26, LMAX = 0.46, LREST = 0.2;

function rod(a, b, r, seg = 8) {
  const d = new V3().subVectors(b, a), L = d.length();
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1, false);
  g.translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
function tireGeometry() {
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * Math.PI;
    pts.push(new THREE.Vector2(0.235 + Math.pow(Math.sin(a), 0.6) * (WR - 0.255), (0.5 - i / 20) * 0.34));
  }
  const g = new THREE.LatheGeometry(pts, 40);
  const geos = [g];
  for (let k = 0; k < 44; k++) for (const row of [-1, 1]) {
    const a = (k / 44) * Math.PI * 2 + (row > 0 ? Math.PI / 44 : 0);
    const kb = new THREE.BoxGeometry(0.075, 0.085, 0.045);
    kb.rotateY(row * 0.3);
    kb.translate(0, row * 0.075, WR - 0.02);
    kb.rotateY(a);
    geos.push(kb);
  }
  const merged = mergeGeometries(geos.map((x) => { const y = x.index ? x : x; if (!y.attributes.uv) y.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(y.attributes.position.count * 2), 2)); return y; }));
  merged.rotateZ(Math.PI / 2); // axe de la roue = x
  merged.computeVertexNormals();
  return merged;
}
function rimGeometry() {
  const geos = [];
  const c = new THREE.CylinderGeometry(0.24, 0.24, 0.2, 24, 1, true); c.rotateZ(Math.PI / 2); geos.push(c);
  const ring = new THREE.TorusGeometry(0.245, 0.02, 6, 24); ring.rotateY(Math.PI / 2); ring.translate(0.1, 0, 0); geos.push(ring);
  const hub = new THREE.CylinderGeometry(0.07, 0.08, 0.12, 12); hub.rotateZ(Math.PI / 2); hub.translate(0.05, 0, 0); geos.push(hub);
  for (let k = 0; k < 6; k++) {
    const s = new THREE.BoxGeometry(0.03, 0.2, 0.045); s.translate(0.06, 0.13, 0); s.rotateX((k / 6) * Math.PI * 2); geos.push(s);
  }
  return mergeGeometries(geos);
}

export class Buggy {
  constructor(scene, terrain, world, veg, props) {
    this.T = terrain; this.world = world; this.veg = veg; this.props = props;
    this.pos = new V3(); this.vel = new V3(); this.quat = new THREE.Quaternion(); this.angVel = new V3();
    this.mass = 720;
    this.Ib = new V3(450, 560, 300); // tangage (x), lacet (y), roulis (z)
    this.steer = 0; this.speed = 0; this.heading = 0; this.rpm = 0;
    this.wheels = WHEELS.map(([x, z], i) => ({ x, z, front: i < 2, L: LREST, Lprev: LREST, spin: 0, contact: false, load: 0, slip: 0, surface: 0, lastTrack: null, dist: 0 }));
    this.safe = { x: world.spawn.x, z: world.spawn.z, h: world.spawn.heading };
    this.safeT = 0; this.deepT = 0;
    this.trunks = [];
    this.buildModel(scene);
    this.tracks = new Tracks(scene);
  }

  buildModel(scene) {
    const g = new THREE.Group();
    this.group = g;
    const paint = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xd2521c, roughness: 0.42, metalness: 0.25 }), { key: 'bPaint' });
    const black = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.6, metalness: 0.2 }), { key: 'bBlack' });
    const alu = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xc2c5c8, roughness: 0.32, metalness: 0.9 }), { key: 'bAlu' });
    const steel = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.35, metalness: 0.95 }), { key: 'bSteel' });
    const fabric = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.95 }), { key: 'bFab' });
    const rubber = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.93 }), { key: 'bRub' });
    const lens = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d6, emissiveIntensity: 0.6, roughness: 0.1 }), { key: 'bLens' });
    const P = (x, y, z) => new V3(x, y, z);
    const frame = [];
    const T = (a, b, r = 0.028) => frame.push(rod(a, b, r));
    for (const s of [-1, 1]) {
      T(P(0.55 * s, 0.42, -1.55), P(0.55 * s, 0.42, 1.2));
      T(P(0.55 * s, 0.42, 1.2), P(0.36 * s, 0.5, 1.85));
      T(P(0.62 * s, 0.42, -0.45), P(0.56 * s, 1.58, -0.58));
      T(P(0.6 * s, 0.62, 0.95), P(0.5 * s, 1.52, 0.12));
      T(P(0.5 * s, 1.52, 0.12), P(0.56 * s, 1.58, -0.58));
      T(P(0.56 * s, 1.58, -0.58), P(0.5 * s, 0.92, -1.78));
      T(P(0.5 * s, 0.92, -1.78), P(0.5 * s, 0.45, -1.92));
      T(P(0.55 * s, 0.42, -1.55), P(0.5 * s, 0.45, -1.92));
      T(P(0.62 * s, 0.86, 0.62), P(0.62 * s, 0.86, -0.46));
      T(P(0.55 * s, 0.42, 0.95), P(0.6 * s, 0.62, 0.95));
      T(P(0.36 * s, 0.5, 1.85), P(0.45 * s, 0.46, 2.02));
    }
    for (const [y, z] of [[0.42, -1.55], [0.42, -0.6], [0.42, 0.4], [0.42, 1.2], [1.58, -0.58], [1.52, 0.12], [0.92, -1.78], [0.45, -1.92], [0.46, 2.02], [0.5, 1.85]]) {
      const w = y > 1.4 ? (z > 0 ? 0.5 : 0.56) : z > 1.7 ? (z > 1.95 ? 0.45 : 0.36) : z < -1.7 ? 0.5 : 0.55;
      T(P(-w, y, z), P(w, y, z));
    }
    T(P(-0.56, 1.58, -0.58), P(0.5, 0.92, -1.78), 0.022); T(P(0.56, 1.58, -0.58), P(-0.5, 0.92, -1.78), 0.022);
    const frameMesh = new THREE.Mesh(mergeGeometries(frame), paint);
    const parts = [frameMesh];
    const box = (sx, sy, sz, x, y, z, m, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); b.position.set(x, y, z); b.rotation.x = rx; parts.push(b); return b; };
    box(1.1, 0.03, 2.75, 0, 0.405, -0.15, alu);
    box(1.02, 0.02, 0.75, 0, 1.6, -0.22, black);
    const hood = box(0.78, 0.025, 0.95, 0, 0.66, 1.5, paint, 0.32);
    void hood;
    for (const s of [-0.27, 0.27]) {
      box(0.44, 0.1, 0.46, s, 0.5, -0.2, fabric);
      box(0.44, 0.7, 0.09, s, 0.86, -0.45, fabric, -0.18);
      box(0.08, 0.5, 0.08, s, 0.78, -0.5, fabric);
    }
    const wheelSt = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 24), black);
    wheelSt.position.set(-0.27, 0.98, 0.32); wheelSt.rotation.x = -0.55; parts.push(wheelSt);
    parts.push(new THREE.Mesh(rod(P(-0.27, 0.98, 0.32), P(-0.27, 0.7, 0.75), 0.02), steel));
    box(0.62, 0.44, 0.52, 0, 0.7, -1.32, alu);
    box(0.7, 0.12, 0.44, 0, 0.96, -1.32, black);
    const filt = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.24, 16), steel); filt.position.set(0.28, 1.08, -1.05); filt.rotation.z = Math.PI / 2; parts.push(filt);
    for (const s of [-1, 1]) parts.push(new THREE.Mesh(rod(P(0.18 * s, 0.62, -1.6), P(0.24 * s, 0.75, -2.05), 0.04), steel));
    box(0.95, 0.07, 0.08, 0, 1.66, 0.08, black);
    const lb = box(0.85, 0.05, 0.02, 0, 1.66, 0.125, lens); void lb;
    const spare = new THREE.Mesh(tireGeometry(), rubber); spare.position.set(0, 1.12, -1.92); spare.rotation.y = Math.PI / 2; spare.scale.setScalar(0.92); parts.push(spare);
    const body = new THREE.Group();
    parts.forEach((p) => { p.castShadow = true; p.receiveShadow = true; body.add(p); });
    body.position.y = -COM_H;
    g.add(body);
    // roues + bras de suspension
    const tg = tireGeometry(), rg = rimGeometry();
    this.wheelObjs = this.wheels.map((w) => {
      const pivot = new THREE.Group();
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(tg, rubber), rim = new THREE.Mesh(rg, steel);
      tire.castShadow = true; rim.castShadow = true;
      rim.scale.x = w.x < 0 ? -1 : 1;
      spin.add(tire, rim);
      pivot.add(spin);
      g.add(pivot);
      const armMat = steel;
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), armMat);
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6), armMat);
      const shock = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 8), paint);
      [upper, lower, shock].forEach((m) => { m.castShadow = true; g.add(m); });
      return { pivot, spin, upper, lower, shock };
    });
    scene.add(g);
  }

  place(x, z, heading) {
    const h = this.T.height(x, z);
    this.pos.set(x, h + COM_H + 0.25, z);
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    const n = this.T.normal(x, z, new V3(), 1.5);
    const fwd = new V3(Math.sin(heading), 0, Math.cos(heading));
    const q1 = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), heading);
    const q2 = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), n);
    this.quat.copy(q2).multiply(q1);
    void fwd;
    this.safe = { x, z, h: heading };
    for (const w of this.wheels) { w.L = w.Lprev = LREST; w.lastTrack = null; }
    this.tracks && this.tracks.breakAll(this.wheels);
    this.updateVisual(0);
  }
  reset() { this.place(this.safe.x, this.safe.z, this.safe.h); }

  surfaceAt(x, z, h) {
    const T = this.T;
    const beach = 1.9 + vnoise(x * 0.045, z * 0.045) * 1.3 + vnoise(x * 0.0085 - 7, z * 0.0085 + 7) * 0.9;
    const path = T.mask(T.path, x, z);
    if (h < 0.35) return 1;          // sable mouillé
    if (h < beach) return 0;         // sable sec
    if (path > 0.4) return 2;        // terre
    if (T.slope(x, z) > 0.42) return 4; // roche
    if (h > 210) return 5;           // cendres
    return 3;                        // herbe / sol de jungle
  }

  update(dt, inp) {
    if (dt <= 0) { this.updateVisual(0); return; }
    const steps = Math.ceil(dt / 0.0045), h = dt / steps;
    // direction (lissée, réduite à haute vitesse)
    const maxSteer = 0.6 / (1 + Math.abs(this.speed) * 0.045);
    const target = clamp(inp.steer, -1, 1) * maxSteer;
    this.steer += clamp(target - this.steer, -dt * 2.6, dt * 2.6);
    this.inp = inp;
    for (let s = 0; s < steps; s++) this.step(h, inp);
    // sécurité : retour à un point sûr si on tombe à l'eau profonde ou sous le relief
    const g = this.T.height(this.pos.x, this.pos.z);
    if (this.pos.y < g - 1.5) this.reset();
    const deep = g < -1.25 && this.pos.y < 0.4;
    this.deepT = deep ? this.deepT + dt : 0;
    if (this.deepT > 2.0) { this.reset(); this.onDeep && this.onDeep(); }
    this.safeT += dt;
    const grounded = this.wheels.filter((w) => w.contact).length >= 3;
    if (this.safeT > 1.5 && grounded && g > 0.6 && Math.abs(this.speed) < 25) {
      this.safeT = 0;
      this.safe = { x: this.pos.x, z: this.pos.z, h: this.heading };
    }
    this.updateVisual(dt);
    // traces et projections
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w.contact || !w.cp) { if (w.lastTrack) this.tracks.break(w); continue; }
      const soft = w.surface === 0 || w.surface === 1 || w.surface === 2 || w.surface === 5 || (w.surface === 3 && w.cp.y < 6);
      if (soft) this.tracks.add(w, w.cp, w.cn, w.fwdDir, w.surface, clamp(0.55 + w.slip * 0.1, 0.5, 1));
      else if (w.lastTrack) this.tracks.break(w);
      if (this.fx && Math.abs(w.vlong) > 3 && (w.surface <= 2 || w.surface === 5)) {
        const amt = (Math.abs(w.vlong) - 3) * 0.03 + w.slip * 0.05;
        this.fx.sand(w.cp, this.vel, amt * dt * 60, w.surface);
      }
      if (this.fx && w.water && this.vel.length() > 2) this.fx.splash(w.cp, this.vel, dt);
    }
  }

  step(h, inp) {
    const T = this.T, m = this.mass;
    const R = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(this.quat));
    const e = R.elements;
    const right = new V3(e[0], e[1], e[2]), up = new V3(e[3], e[4], e[5]), fwd = new V3(e[6], e[7], e[8]);
    const F = new V3(0, -9.81 * m, 0), Tq = new V3();
    const vf = this.vel.dot(fwd);
    this.speed = vf;
    // moteur / freins
    const thr = inp.throttle, brakeIn = inp.brake;
    let drive = 0, brake = 0;
    if (thr > 0.02) { drive = vf < -1 ? 0 : thr * 7800 * Math.max(0, 1 - Math.max(vf, 0) / 31); if (vf < -1) brake = thr; }
    else if (thr < -0.02) { if (vf > 1.0) brake = -thr; else drive = thr * 4200 * Math.max(0, 1 - Math.max(-vf, 0) / 9); }
    const hand = brakeIn > 0;
    this.rpm = lerp(this.rpm, clamp(Math.abs(vf) / 31 * 0.8 + Math.abs(thr) * 0.35, 0.08, 1), 0.02);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const a = new V3(w.x, 0.05, w.z).applyMatrix3(R).add(this.pos);
      const g = T.height(a.x, a.z);
      const cosT = Math.max(up.y, 0.3);
      const dist = (a.y - g - WR) / cosT;
      let L = clamp(dist, 0.03, LMAX);
      w.contact = dist < LMAX;
      w.Lprev = w.L; w.L = w.contact ? L : Math.min(LMAX, w.L + h * 2.5);
      w.water = false;
      if (!w.contact) { w.load = 0; w.cp = null; continue; }
      const comp = LNAT - L;
      const vComp = (w.Lprev - w.L) / h;
      let Fs = Math.max(0, comp * 30000 + vComp * 3000);
      if (dist < 0.03) Fs += (0.03 - dist) * 150000; // butée
      w.load = Fs;
      const cp = new V3(a.x, g, a.z);
      const n = T.normal(a.x, a.z, new V3(), 0.8);
      const surf = this.surfaceAt(a.x, a.z, g);
      w.surface = surf;
      // direction de la roue
      const st = w.front ? this.steer : 0;
      const wf = fwd.clone().applyAxisAngle(up, st);
      const wfg = wf.clone().addScaledVector(n, -wf.dot(n)).normalize();
      const ws = new V3().crossVectors(n, wfg).normalize();
      const r = new V3().subVectors(cp, this.pos);
      const vc = this.vel.clone().add(new V3().crossVectors(this.angVel, r));
      const vlat = vc.dot(ws), vlong = vc.dot(wfg);
      w.vlong = vlong; w.fwdDir = wfg; w.cp = cp; w.cn = n;
      const MU = [0.78, 0.92, 0.98, 0.9, 1.05, 0.82][surf];
      const CRR = [0.07, 0.03, 0.02, 0.025, 0.015, 0.05][surf];
      let mu = MU;
      if (g < 0.0) { mu *= 0.8; w.water = true; }
      const N = Fs;
      let latMu = mu * (hand && !w.front ? 0.45 : 1);
      let Flat = -latMu * N * Math.tanh(vlat / 0.9);
      let Flong = (drive * (w.front ? 0.4 : 0.6)) - Math.sign(vlong) * Math.min(Math.abs(vlong) * 4000, (brake * 9000 + (hand && !w.front ? 7000 : 0)) / 4 * (w.front ? 1.1 : 0.9)) - vlong * CRR * N * 0.35 - Math.sign(vlong) * Math.min(Math.abs(vlong) * 200, CRR * N);
      const lim = mu * N;
      const tot = Math.hypot(Flat, Flong);
      w.slip = tot > lim ? (tot - lim) / Math.max(lim, 1) * 4 + Math.abs(vlat) * 0.2 : Math.abs(vlat) * 0.12;
      if (tot > lim) { Flat *= lim / tot; Flong *= lim / tot; }
      const Fw = new V3().addScaledVector(up, Fs).addScaledVector(ws, Flat).addScaledVector(wfg, Flong);
      F.add(Fw);
      Tq.add(new V3().crossVectors(r, Fw));
      // eau : traînée
      if (w.water) { const dep = clamp(-g, 0, 1.2); F.addScaledVector(this.vel, -dep * 260); }
    }
    // collisions de la caisse avec le sol (avant, arrière)
    for (const [cx, cz] of [[0, 1.95], [0, -1.9], [-0.5, 0.4], [0.5, 0.4]]) {
      const p = new V3(cx, -COM_H + 0.38, cz).applyMatrix3(R).add(this.pos);
      const g = T.height(p.x, p.z);
      if (p.y < g) {
        const n = T.normal(p.x, p.z, new V3(), 0.8);
        const r = new V3().subVectors(p, this.pos);
        const vp = this.vel.clone().add(new V3().crossVectors(this.angVel, r));
        const Fn = n.clone().multiplyScalar((g - p.y) * 90000 - Math.min(0, vp.dot(n)) * 6000);
        const vt = vp.clone().addScaledVector(n, -vp.dot(n));
        Fn.addScaledVector(vt, -1500);
        F.add(Fn); Tq.add(new V3().crossVectors(r, Fn));
      }
    }
    // flottaison
    if (this.pos.y < 0.2) { F.y += clamp(0.2 - this.pos.y, 0, 1.5) * 6500; F.addScaledVector(this.vel, -300); this.angVel.multiplyScalar(0.995); }
    // aérodynamique
    F.addScaledVector(this.vel, -0.45 * this.vel.length());
    // intégration
    this.vel.addScaledVector(F, h / m);
    const Tb = Tq.clone().applyMatrix3(R.clone().transpose());
    const Ib = this.Ib;
    const wb = this.angVel.clone().applyMatrix3(R.clone().transpose());
    wb.x += Tb.x / Ib.x * h; wb.y += Tb.y / Ib.y * h; wb.z += Tb.z / Ib.z * h;
    wb.multiplyScalar(1 - 0.6 * h);
    this.angVel.copy(wb.applyMatrix3(R));
    this.pos.addScaledVector(this.vel, h);
    const wq = new THREE.Quaternion(this.angVel.x * h * 0.5, this.angVel.y * h * 0.5, this.angVel.z * h * 0.5, 0).multiply(this.quat);
    this.quat.x += wq.x; this.quat.y += wq.y; this.quat.z += wq.z; this.quat.w += wq.w;
    this.quat.normalize();
    // obstacles (troncs, rochers, avions) : cercles dans le plan
    this.collide(fwd);
  }

  collide(fwd) {
    const list = this.veg.trunksNear(this.pos.x, this.pos.z, 5, this.trunks);
    const all = list.concat(this.props.colliders.filter((c) => Math.abs(c.x - this.pos.x) < 8 && Math.abs(c.z - this.pos.z) < 8));
    for (const c of all) {
      for (const off of [1.05, -0.95]) {
        const px = this.pos.x + fwd.x * off, pz = this.pos.z + fwd.z * off;
        const dx = px - c.x, dz = pz - c.z, d = Math.hypot(dx, dz), R = c.r + 0.92;
        if (d < R && d > 1e-4) {
          const nx = dx / d, nz = dz / d, pen = R - d;
          this.pos.x += nx * pen; this.pos.z += nz * pen;
          const vn = this.vel.x * nx + this.vel.z * nz;
          if (vn < 0) { this.vel.x -= nx * vn * 1.25; this.vel.z -= nz * vn * 1.25; this.angVel.y *= 0.7; this.bump = Math.max(this.bump || 0, -vn); }
        }
      }
    }
  }

  updateVisual(dt) {
    const g = this.group;
    g.position.copy(this.pos);
    g.quaternion.copy(this.quat);
    const f = new V3(0, 0, 1).applyQuaternion(this.quat);
    this.heading = Math.atan2(f.x, f.z);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i], o = this.wheelObjs[i];
      const y = 0.05 - w.L;
      o.pivot.position.set(w.x, y, w.z);
      o.pivot.rotation.y = w.front ? this.steer : 0;
      const ang = (w.contact ? (w.vlong || 0) : this.speed) / WR;
      w.spin += ang * dt;
      o.spin.rotation.x = w.spin;
      const side = Math.sign(w.x);
      const inner = new V3(side * 0.42, -0.1, w.z), hub = new V3(w.x - side * 0.12, y, w.z);
      setRod(o.lower, new V3(side * 0.42, -0.18, w.z), hub.clone().add(new V3(0, -0.06, 0)));
      setRod(o.upper, inner.clone().add(new V3(0, 0.18, 0)), hub.clone().add(new V3(0, 0.12, 0)));
      setRod(o.shock, new V3(side * 0.5, 0.55, w.z * 0.92), hub.clone().add(new V3(-side * 0.08, 0.05, 0)), 1);
    }
  }
}
function setRod(mesh, a, b, thick) {
  const d = new V3().subVectors(b, a), L = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize());
  mesh.scale.set(1, L, 1);
  void thick;
}

// ---------- traces de pneus (rubans assombrissant le sable) ----------
class Tracks {
  constructor(scene) {
    this.MAX = 6000;
    const n = this.MAX;
    this.pos = new Float32Array(n * 4 * 3); this.uv = new Float32Array(n * 4 * 2); this.age = new Float32Array(n * 4 * 2);
    const idx = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) { const a = i * 4; idx.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], i * 6); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAge', new THREE.BufferAttribute(this.age, 2).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new V3(), 1e6);
    this.geo = g;
    this.head = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime },
      vertexShader: 'attribute vec2 aAge; varying vec2 vUv; varying vec2 vAge; void main(){ vUv = uv; vAge = aAge; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        uniform float uTime; varying vec2 vUv; varying vec2 vAge;
        void main() {
          float age = uTime - vAge.x;
          float fade = 1.0 - smoothstep(70.0, 150.0, age);
          float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
          float lug = smoothstep(0.35, 0.55, fract(vUv.y * 3.2 + abs(vUv.x - 0.5) * 1.6));
          float k = vAge.y * fade * edge;
          vec3 mulc = mix(vec3(1.0), mix(vec3(0.56, 0.53, 0.5), vec3(0.72, 0.69, 0.65), lug), k);
          float rim = smoothstep(0.0, 0.1, vUv.x) * smoothstep(0.24, 0.1, vUv.x) + smoothstep(1.0, 0.9, vUv.x) * smoothstep(0.76, 0.9, vUv.x);
          mulc *= 1.0 + rim * 0.18 * k;
          gl_FragColor = vec4(mulc, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }
  break(w) { w.lastTrack = null; }
  breakAll(ws) { for (const w of ws) w.lastTrack = null; }
  add(w, p, n, f, surf, strength) {
    const last = w.lastTrack;
    if (last && p.distanceToSquared(last.p) < 0.09) return;
    const side = new V3().crossVectors(n, f).normalize().multiplyScalar(0.19);
    const lift = n.clone().multiplyScalar(0.025);
    const L = p.clone().sub(side).add(lift), Rr = p.clone().add(side).add(lift);
    const v = (w.dist = (w.dist || 0) + (last ? p.distanceTo(last.p) : 0));
    const k = surf === 1 ? 0.55 : surf === 2 ? 0.7 : surf === 3 ? 0.45 : 1.0;
    if (last && p.distanceToSquared(last.p) < 4) {
      const i = this.head, o = i * 4;
      const t = U.uTime.value;
      this.pos.set([last.L.x, last.L.y, last.L.z, last.R.x, last.R.y, last.R.z, L.x, L.y, L.z, Rr.x, Rr.y, Rr.z], o * 3);
      this.uv.set([0, last.v, 1, last.v, 0, v, 1, v], o * 2);
      this.age.set([last.t, last.s, last.t, last.s, t, strength * k, t, strength * k], o * 2);
      const g = this.geo;
      for (const [name, arr, sz] of [['position', this.pos, 3], ['uv', this.uv, 2], ['aAge', this.age, 2]]) {
        const at = g.attributes[name];
        at.addUpdateRange(o * sz, 4 * sz);
        at.needsUpdate = true;
        void arr;
      }
      this.head = (this.head + 1) % this.MAX;
    }
    w.lastTrack = { p: p.clone(), L, R: Rr, v, t: U.uTime.value, s: strength * k };
  }
}

export { GLSL_COMMON };
