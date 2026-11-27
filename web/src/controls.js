// Commandes tactiles (joystick, glisser pour la caméra, boutons) et clavier ; caméra de poursuite / capot / libre.
import * as THREE from 'three';
import { clamp, lerp } from './core.js';

export class Controls {
  constructor(canvas) {
    this.keys = new Set();
    this.stick = { x: 0, y: 0, id: null };
    this.look = { dx: 0, dy: 0, id: null, x: 0, y: 0 };
    this.brake = false; this.up = false; this.down = false; this.cam = false; this.reset = false;
    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.cam = true;
      if (e.code === 'KeyR') this.reset = true;
      if (e.code === 'KeyF' || e.code === 'Enter') this.act = true;
      if (e.code === 'KeyT') this.tool = true;
      if (e.code === 'KeyB') this.build = true;
      if (e.code === 'Space') this.jumpK = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    const stick = document.getElementById('stick'), knob = document.getElementById('knob');
    const setStick = (e) => {
      const r = stick.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width * 0.42;
      let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R;
      const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      this.stick.x = dx; this.stick.y = dy;
      knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
    };
    stick.addEventListener('pointerdown', (e) => { e.preventDefault(); this.stick.id = e.pointerId; stick.setPointerCapture(e.pointerId); setStick(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === this.stick.id) setStick(e); });
    const endStick = (e) => { if (e.pointerId !== this.stick.id) return; this.stick.id = null; this.stick.x = this.stick.y = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);
    canvas.addEventListener('pointerdown', (e) => { if (this.look.id !== null) return; this.look.id = e.pointerId; this.look.x = e.clientX; this.look.y = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.look.id) return;
      this.look.dx += e.clientX - this.look.x; this.look.dy += e.clientY - this.look.y;
      this.look.x = e.clientX; this.look.y = e.clientY;
    });
    const endLook = (e) => { if (e.pointerId === this.look.id) this.look.id = null; };
    canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook);
    const hold = (id, key) => {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this[key] = true; el.setPointerCapture(e.pointerId); });
      const off = () => { this[key] = false; };
      el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
    };
    hold('bBrake', 'brake'); hold('bUp', 'up'); hold('bDown', 'down'); hold('bJump', 'jumpB');
    hold('bGas', 'gas'); hold('bRev', 'rev');
    // volant : on le tourne avec le doigt (jusqu'à 1,5 tour à gauche ou à droite), il revient seul au centre quand on lâche
    this.wheelAngle = 0; this.wheelHeld = false;
    const wheel = document.getElementById('wheel'), wsvg = wheel.querySelector('svg');
    let wId = null, lastA = 0;
    const ang = (e) => { const r = wheel.getBoundingClientRect(); return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))); };
    wheel.addEventListener('pointerdown', (e) => { e.preventDefault(); wId = e.pointerId; wheel.setPointerCapture(wId); lastA = ang(e); this.wheelHeld = true; });
    wheel.addEventListener('pointermove', (e) => {
      if (e.pointerId !== wId) return;
      const a = ang(e); let d = a - lastA;
      if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
      lastA = a;
      this.wheelAngle = Math.max(-2.4, Math.min(2.4, this.wheelAngle + d));
    });
    const endW = (e) => { if (e.pointerId === wId) { wId = null; this.wheelHeld = false; } };
    wheel.addEventListener('pointerup', endW); wheel.addEventListener('pointercancel', endW);
    this.wheelEl = wsvg;
    const tap = (id, key) => document.getElementById(id).addEventListener('pointerdown', (e) => { e.preventDefault(); this[key] = true; });
    tap('bAct', 'act'); tap('bTool', 'tool'); tap('bBuild', 'build'); tap('bJump', 'jumpK');
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => { if (e.target === canvas || e.target.closest('#hud')) e.preventDefault(); }, { passive: false });
  }
  read() {
    const k = this.keys;
    let throttle = -this.stick.y, steer = this.stick.x;
    // en buggy : volant et pédales (le joystick est caché)
    if (this.carMode) {
      if (!this.wheelHeld) this.wheelAngle *= Math.exp(-(1 / 60) * 6); // retour au centre
      steer = Math.max(-1, Math.min(1, this.wheelAngle / 2.4 * 1.15));
      throttle = (this.gas ? 1 : 0) - (this.rev ? 1 : 0);
      if (this.wheelEl) this.wheelEl.style.transform = `rotate(${this.wheelAngle}rad)`;
    }
    if (k.has('ArrowUp') || k.has('KeyW')) throttle = 1;
    if (k.has('ArrowDown') || k.has('KeyS')) throttle = -1;
    if (k.has('ArrowLeft') || k.has('KeyA')) steer = -1;
    if (k.has('ArrowRight') || k.has('KeyD')) steer = 1;
    const out = {
      throttle, steer, brake: this.brake || k.has('Space') ? 1 : 0,
      lookX: this.look.dx, lookY: this.look.dy,
      up: this.up || k.has('KeyE') || k.has('PageUp'), down: this.down || k.has('KeyQ') || k.has('PageDown'),
      camera: this.cam, reset: this.reset, fast: k.has('ShiftLeft') || k.has('ShiftRight'),
      jump: this.jumpK || this.jumpB || k.has('Space'), act: this.act, tool: this.tool, build: this.build, analog: this.stick.id !== null,
    };
    this.look.dx = this.look.dy = 0; this.cam = this.reset = this.act = this.tool = this.jumpK = this.build = false;
    return out;
  }
}

const MODES = ['chase', 'hood', 'drone'];
const LABELS = { chase: 'Caméra : poursuite', hood: 'Caméra : pilote', drone: 'Caméra libre (vol)', foot: 'Vue à pied' };

export class CameraRig {
  constructor(camera, terrain) {
    this.camera = camera; this.terrain = terrain;
    this.mode = 'chase';
    this.userYaw = 0; this.userPitch = 0; this.idle = 0;
    this.yaw = 0; this.pitch = -0.1; this.speed = 0;
    this.target = new THREE.Vector3();
    this.snap = true;
    this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3();
    this.smoothYaw = 0;
  }
  attach(buggy) { this.buggy = buggy; }
  cycle(onFoot) {
    if (onFoot) { this.setMode(this.mode === 'drone' ? 'foot' : 'drone'); return; }
    this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]);
  }
  setMode(m) {
    if (m === 'drone' && this.mode !== 'drone') {
      const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.yaw = e.y; this.pitch = e.x;
    }
    this.mode = m;
    this.snap = true;
  }
  label() { return LABELS[this.mode]; }
  update(dt, inp, buggy) {
    const cam = this.camera, T = this.terrain;
    if (this.mode === 'drone') {
      this.yaw -= inp.lookX * 0.0045; this.pitch = clamp(this.pitch - inp.lookY * 0.0045, -1.45, 1.3);
      const alt = cam.position.y - T.height(cam.position.x, cam.position.z);
      const sp = (6 + Math.max(alt, 0) * 0.25) * (inp.fast ? 3 : 1);
      const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const mv = this._v.set(0, 0, 0).addScaledVector(fwd, inp.throttle).addScaledVector(right, inp.steer);
      mv.y += (inp.up ? 1 : 0) - (inp.down ? 1 : 0);
      cam.position.addScaledVector(mv, sp * dt);
      this.speed = mv.length() * sp;
      const g = T.height(cam.position.x, cam.position.z) + 0.6;
      if (cam.position.y < g) cam.position.y = g;
      cam.position.y = Math.min(cam.position.y, 2500);
      cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      this.target.copy(cam.position).addScaledVector(fwd, 20);
      return;
    }
    const b = buggy;
    if (this.mode === 'hood') {
      this._p.set(0, 1.42, -0.15).applyQuaternion(b.quat).add(b.pos);
      cam.position.copy(this._p);
      this._q.copy(b.quat).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.06 + this.userPitch * 0.5, Math.PI + this.userYaw, 0, 'YXZ')));
      cam.quaternion.slerp(this._q, this.snap ? 1 : 1 - Math.exp(-dt * 14));
      this.userYaw = lerp(this.userYaw - inp.lookX * 0.004, 0, this.idle > 1.5 ? 1 - Math.exp(-dt * 2) : 0);
      this.userPitch = clamp(this.userPitch - inp.lookY * 0.003, -0.5, 0.5);
      this.idle = inp.lookX || inp.lookY ? 0 : this.idle + dt;
      this.target.copy(b.pos);
      this.snap = false;
      return;
    }
    // poursuite
    if (inp.lookX || inp.lookY) this.idle = 0; else this.idle += dt;
    this.userYaw -= inp.lookX * 0.006;
    this.userPitch = clamp(this.userPitch + inp.lookY * 0.004, -0.15, 0.9);
    if (this.idle > 2.2) { this.userYaw *= Math.exp(-dt * 1.6); }
    const heading = b.heading;
    let dy = heading - this.smoothYaw;
    while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    this.smoothYaw = this.snap ? heading : this.smoothYaw + dy * (1 - Math.exp(-dt * 3.2));
    const yaw = this.smoothYaw + this.userYaw;
    const elev = 0.2 + this.userPitch;
    const dist = 6.6 + Math.min(Math.abs(b.speed) * 0.05, 1.6);
    const tgt = this._v.copy(b.pos); tgt.y += 1.0;
    const want = this._p.set(-Math.sin(yaw) * Math.cos(elev), Math.sin(elev), -Math.cos(yaw) * Math.cos(elev)).multiplyScalar(dist).add(tgt);
    const ground = Math.max(T.height(want.x, want.z), 0) + 0.7;
    if (want.y < ground) want.y = ground;
    if (this.snap) cam.position.copy(want); else cam.position.lerp(want, 1 - Math.exp(-dt * 9));
    this.target.lerp(tgt, this.snap ? 1 : 1 - Math.exp(-dt * 12));
    cam.lookAt(this.target.x + Math.sin(yaw) * 2, this.target.y + 0.3, this.target.z + Math.cos(yaw) * 2);
    this.snap = false;
  }
}
