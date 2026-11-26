// Ambiance sonore synthétisée : vagues, vent, oiseaux, cascade, pluie et moteur du buggy.
import { clamp, lerp } from './core.js';

export class Sound {
  constructor() { this.ctx = null; this.t = 0; this.birdT = 2; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    const noise = (sec, brown) => {
      const b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate), d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
      return b;
    };
    const src = (buf) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    this.master = c.createGain(); this.master.gain.value = 0.8; this.master.connect(c.destination);
    const chain = (node, ...rest) => { let n = node; for (const r of rest) { n.connect(r); n = r; } return n; };
    // vagues
    const brown = noise(4, true), white = noise(2, false);
    this.waveG = c.createGain(); this.waveG.gain.value = 0;
    const wf = c.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 650;
    const swell = c.createGain(); swell.gain.value = 0.6;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.11; const lfoG = c.createGain(); lfoG.gain.value = 0.4; lfo.connect(lfoG); lfoG.connect(swell.gain); lfo.start();
    chain(src(brown), wf, swell, this.waveG, this.master);
    // vent
    this.windG = c.createGain(); this.windG.gain.value = 0;
    const bf = c.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 520; bf.Q.value = 0.5;
    chain(src(white), bf, this.windG, this.master);
    // cascade
    this.fallG = c.createGain(); this.fallG.gain.value = 0;
    const hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1800;
    chain(src(white), hf, this.fallG, this.master);
    // pluie
    this.rainG = c.createGain(); this.rainG.gain.value = 0;
    const rf = c.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 1500;
    chain(src(white), rf, this.rainG, this.master);
    // moteur
    this.eng = c.createOscillator(); this.eng.type = 'sawtooth'; this.eng.frequency.value = 45;
    this.eng2 = c.createOscillator(); this.eng2.type = 'square'; this.eng2.frequency.value = 22.5;
    const ef = c.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 700; ef.Q.value = 2;
    this.engG = c.createGain(); this.engG.gain.value = 0;
    const e2g = c.createGain(); e2g.gain.value = 0.5;
    this.eng.connect(ef); this.eng2.connect(e2g); e2g.connect(ef); ef.connect(this.engG); this.engG.connect(this.master);
    this.eng.start(); this.eng2.start();
    this.ef = ef;
    this.white = white;
    // crissement / glissement des pneus (sable, terre)
    this.skidG = c.createGain(); this.skidG.gain.value = 0;
    const sf = c.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 900; sf.Q.value = 0.7;
    chain(src(brown), sf, this.skidG, this.master);
  }
  // pas du personnage : sable (doux), herbe et feuilles (froissement), eau (clapotis)
  footstep(kind, vol = 1) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime, s = c.createBufferSource(); s.buffer = this.white;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(), g = c.createGain();
    f.type = kind === 'water' ? 'lowpass' : 'bandpass';
    f.frequency.value = kind === 'sand' ? 700 : kind === 'water' ? 900 : 2200; f.Q.value = kind === 'leaves' ? 0.9 : 0.6;
    const len = kind === 'water' ? 0.22 : 0.12;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16 * vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 1.5); s.stop(t + len + 0.05);
  }
  // coup de hache dans le bois : claquement sec + résonance sourde
  chop(vol = 1) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.white;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 1.2;
    const g = c.createGain(); g.gain.setValueAtTime(0.5 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + 0.12);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.15);
    const og = c.createGain(); og.gain.setValueAtTime(0.35 * vol, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.2);
  }
  // craquement du tronc qui cède
  creak() {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t);
    for (let k = 0; k < 8; k++) o.frequency.setValueAtTime(55 + Math.random() * 60, t + k * 0.11);
    f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 3;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.15); g.gain.linearRampToValueAtTime(0, t + 1.0);
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.05);
  }
  // l'arbre s'écrase au sol : grondement + branches qui cassent
  crash(vol = 1) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.white;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(120, t + 1.2);
    const g = c.createGain(); g.gain.setValueAtTime(0.7 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + 1.5);
    for (let k = 0; k < 6; k++) setTimeout(() => this.chop(0.35 * vol), 40 + Math.random() * 500);
  }
  // cris d'animaux synthétisés, placés à gauche ou à droite selon leur position
  animal(kind, vol, pan) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime, out = c.createGain();
    out.gain.value = vol;
    let node = out;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; out.connect(p); node = p; }
    node.connect(this.master);
    const tone = (type, f0, f1, t0, len, amp, filt) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t0 + len * 0.8);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(amp, t0 + Math.min(0.03, len * 0.2)); g.gain.exponentialRampToValueAtTime(0.001, t0 + len);
      let n = o;
      if (filt) { const f = c.createBiquadFilter(); f.type = filt[0]; f.frequency.value = filt[1]; f.Q.value = filt[2] || 1; o.connect(f); n = f; }
      n.connect(g); g.connect(out); o.start(t0); o.stop(t0 + len + 0.05);
      return o;
    };
    const noise = (t0, len, amp, type, freq, q = 0.8) => {
      const s = c.createBufferSource(); s.buffer = this.white;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(amp, t0 + 0.04); g.gain.exponentialRampToValueAtTime(0.001, t0 + len);
      s.connect(f); f.connect(g); g.connect(out); s.start(t0, Math.random()); s.stop(t0 + len + 0.05);
    };
    const R = Math.random;
    if (kind === 'monkey') {
      // « hou-hou-hou… ha-ha-ha » qui monte en excitation
      const n = 4 + Math.floor(R() * 5), base = 320 + R() * 120;
      for (let i = 0; i < n; i++) { const tt = t + i * (0.16 - i * 0.008); const up = 1 + i * 0.12; tone('triangle', base * up, base * up * 1.6, tt, 0.13, 0.22, ['bandpass', 900, 1.5]); }
      for (let i = 0; i < 3 + Math.floor(R() * 3); i++) tone('sawtooth', 900 + R() * 200, 650, t + n * 0.14 + i * 0.1, 0.08, 0.12, ['bandpass', 1500, 2]);
    } else if (kind === 'parrot') {
      for (let i = 0; i < 1 + Math.floor(R() * 2); i++) { const o = tone('sawtooth', 1100 + R() * 300, 1700, t + i * 0.32, 0.26, 0.16, ['bandpass', 2000, 3]); const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 32; lg.gain.value = 180; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + 0.8); }
    } else if (kind === 'aracari') {
      for (let i = 0; i < 3; i++) tone('square', 1800 + R() * 200, 1500, t + i * 0.12, 0.06, 0.08, ['bandpass', 2200, 4]);
    } else if (kind === 'seagull') {
      for (let i = 0; i < 2 + Math.floor(R() * 3); i++) tone('triangle', 1500 + R() * 200, 850, t + i * 0.38, 0.32, 0.14, ['bandpass', 1400, 1.2]);
    } else if (kind === 'tiger' || kind === 'jaguar') {
      const f = kind === 'tiger' ? 95 : 130;
      tone('sawtooth', f * 1.3, f * 0.75, t, 1.5, 0.5, ['lowpass', 700, 1.5]);
      tone('sawtooth', f * 0.66, f * 0.5, t + 0.05, 1.4, 0.35, ['lowpass', 400, 1]);
      noise(t, 1.3, 0.25, 'bandpass', 500, 0.7);
    } else if (kind === 'boar') {
      for (let i = 0; i < 3 + Math.floor(R() * 3); i++) { noise(t + i * 0.2, 0.14, 0.35, 'lowpass', 380, 2); tone('sawtooth', 110, 80, t + i * 0.2, 0.12, 0.15, ['lowpass', 500]); }
    } else if (kind === 'croc') {
      tone('sine', 52, 40, t, 1.4, 0.6); noise(t, 1.0, 0.15, 'lowpass', 200);
    } else if (kind === 'hiss') {
      noise(t, 0.7, 0.2, 'highpass', 3500, 0.5);
    }
  }
  bird(vol) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    const f0 = 1800 + Math.random() * 2600, n = 2 + Math.floor(Math.random() * 4);
    o.type = 'sine';
    g.gain.value = 0;
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.13;
      o.frequency.setValueAtTime(f0, s); o.frequency.exponentialRampToValueAtTime(f0 * (1.3 + Math.random() * 0.5), s + 0.08);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(vol * 0.06, s + 0.02); g.gain.linearRampToValueAtTime(0, s + 0.1);
    }
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + n * 0.13 + 0.2);
  }
  update(dt, camera, buggy, T, world, sky) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime, p = camera.position;
    const h = T.height(p.x, p.z);
    const coast = clamp(1 - (h - 2) / 25, 0, 1) * clamp(1 - (p.y - 20) / 200, 0, 1);
    this.waveG.gain.setTargetAtTime(0.25 + coast * 0.6, now, 0.5);
    const w = sky.weather;
    this.windG.gain.setTargetAtTime(0.03 + clamp(p.y / 300, 0, 0.25) + w * 0.18, now, 0.5);
    const lip = world.waterfall.pool;
    const d = Math.hypot(p.x - lip[0], p.y - lip[1], p.z - lip[2]);
    this.fallG.gain.setTargetAtTime(clamp(30 / (d + 10), 0, 1) * 0.7, now, 0.3);
    this.rainG.gain.setTargetAtTime((sky.rain || 0) * 0.35, now, 0.6);
    const rpm = buggy.rpm || 0;
    this.eng.frequency.setTargetAtTime(38 + rpm * 120, now, 0.05);
    this.eng2.frequency.setTargetAtTime(19 + rpm * 60, now, 0.05);
    this.ef.frequency.setTargetAtTime(400 + rpm * 1400, now, 0.08);
    const near = clamp(1 - buggy.pos.distanceTo(p) / 60, 0, 1);
    this.engG.gain.setTargetAtTime((0.05 + rpm * 0.18) * near * (buggy.engineOn ?? 1), now, 0.25);
    const slip = buggy.wheels.reduce((a, w) => a + (w.contact ? Math.min(w.slip || 0, 3) : 0), 0) / 4;
    const sp = Math.min(Math.abs(buggy.speed) / 8, 1);
    this.skidG.gain.setTargetAtTime(clamp((slip - 0.35) * 0.25, 0, 0.3) * sp * near * (buggy.engineOn ?? 1), now, 0.08);
    // oiseaux le jour, dans la végétation
    this.birdT -= dt;
    const day = sky.hour > 6 && sky.hour < 18.8;
    if (this.birdT < 0) {
      this.birdT = 1 + Math.random() * 4;
      if (day && h > 3 && h < 220 && p.y - h < 60) this.bird(lerp(0.5, 1, Math.random()));
    }
  }
}
