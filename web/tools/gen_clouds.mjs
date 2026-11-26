// Textures de bruit tuilables pour les nuages volumétriques -> assets/clouds.bin
// [64³ RG : perlin-worley, worley] [32³ R : détail worley] [256² RG : carte météo (couverture, type)]
import fs from 'node:fs';
import { makePerlin, makeWorley3, smoothstep, clamp } from './noise.mjs';

const OUT = new URL('../assets/clouds.bin', import.meta.url).pathname;
const S = 64, D = 32, WM = 256;
const P = makePerlin(31337);

function perlinFbm(x, y, z, base, oct) {
  let s = 0, a = 1, n = 0, f = base;
  for (let i = 0; i < oct; i++) { s += a * P.noise3(x * f, y * f, z * f, f); n += a; a *= 0.5; f *= 2; }
  return s / n;
}
const W4 = makeWorley3(1, 4), W8 = makeWorley3(2, 8), W16 = makeWorley3(3, 16), W32 = makeWorley3(4, 32);
const D8 = makeWorley3(5, 8), D16 = makeWorley3(6, 16), D24 = makeWorley3(7, 24);
const shape = new Uint8Array(S * S * S * 2);
console.time('shape');
for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const u = x / S, v = y / S, w = z / S;
  const p = clamp(perlinFbm(u, v, w, 4, 4) * 0.5 + 0.5, 0, 1);
  const wf = (1 - W4(u, v, w)) * 0.625 + (1 - W8(u, v, w)) * 0.25 + (1 - W16(u, v, w)) * 0.125;
  const pw = clamp((p - (wf - 1)) / (1 - (wf - 1)), 0, 1); // remap(perlin, wf-1, 1, 0, 1)
  const wf2 = (1 - W8(u, v, w)) * 0.625 + (1 - W16(u, v, w)) * 0.25 + (1 - W32(u, v, w)) * 0.125;
  const k = ((z * S + y) * S + x) * 2;
  shape[k] = Math.round(clamp((pw - 0.25) / 0.65, 0, 1) * 255);
  shape[k + 1] = Math.round(clamp(wf2, 0, 1) * 255);
}
console.timeEnd('shape');
const detail = new Uint8Array(D * D * D);
for (let z = 0; z < D; z++) for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
  const u = x / D, v = y / D, w = z / D;
  const wf = (1 - D8(u, v, w)) * 0.625 + (1 - D16(u, v, w)) * 0.25 + (1 - D24(u, v, w)) * 0.125;
  detail[(z * D + y) * D + x] = Math.round(clamp(wf, 0, 1) * 255);
}
const weather = new Uint8Array(WM * WM * 2);
const P2 = makePerlin(4711);
for (let y = 0; y < WM; y++) for (let x = 0; x < WM; x++) {
  const u = x / WM, v = y / WM;
  let c = 0, a = 1, n = 0, f = 4;
  for (let i = 0; i < 5; i++) { c += a * P2.noise3(u * f, v * f, 0.5, f); n += a; a *= 0.55; f *= 2; }
  c = c / n * 0.5 + 0.5;
  let t = 0; a = 1; n = 0; f = 3;
  for (let i = 0; i < 3; i++) { t += a * P2.noise3(u * f + 0.37, v * f + 0.71, 3.3, f); n += a; a *= 0.5; f *= 2; }
  t = t / n * 0.5 + 0.5;
  weather[(y * WM + x) * 2] = Math.round(smoothstep(0.3, 0.75, c) * 255);
  weather[(y * WM + x) * 2 + 1] = Math.round(clamp(t, 0, 1) * 255);
}
fs.writeFileSync(OUT, Buffer.concat([Buffer.from(shape), Buffer.from(detail), Buffer.from(weather)]));
console.log('clouds.bin', fs.statSync(OUT).size);
