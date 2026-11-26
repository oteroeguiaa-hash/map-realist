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
    this.engG.gain.setTargetAtTime((0.05 + rpm * 0.18) * near, now, 0.1);
    // oiseaux le jour, dans la végétation
    this.birdT -= dt;
    const day = sky.hour > 6 && sky.hour < 18.8;
    if (this.birdT < 0) {
      this.birdT = 1 + Math.random() * 4;
      if (day && h > 3 && h < 220 && p.y - h < 60) this.bird(lerp(0.5, 1, Math.random()));
    }
  }
}
