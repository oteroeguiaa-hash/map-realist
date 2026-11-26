// Réduit une carte d'environnement .exr (Poly Haven) en 1k pour le téléphone, en restant au format EXR.
// Usage : node tools/prep_hdri.mjs <entrée.exr> <sortie.exr> [largeur]
import fs from 'node:fs';
import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { EXRExporter } from 'three/examples/jsm/exporters/EXRExporter.js';

const [inp, out, w = '1024'] = process.argv.slice(2);
const buf = fs.readFileSync(inp);
const d = new EXRLoader().setDataType(THREE.FloatType).parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const W = +w, H = W / 2, src = d.data, sw = d.width, sh = d.height, C = src.length / (sw * sh);
const dst = new Float32Array(W * H * 4);
const fx = sw / W, fy = sh / H;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let yy = Math.floor(y * fy); yy < Math.floor((y + 1) * fy); yy++) for (let xx = Math.floor(x * fx); xx < Math.floor((x + 1) * fx); xx++) {
    const q = (yy * sw + xx) * C; r += src[q]; g += src[q + 1]; b += src[q + 2]; n++;
  }
  const o = (y * W + x) * 4, M = 60000; dst[o] = Math.min(r / n, M); dst[o + 1] = Math.min(g / n, M); dst[o + 2] = Math.min(b / n, M); dst[o + 3] = 1;
}
const tex = new THREE.DataTexture(dst, W, H, THREE.RGBAFormat, THREE.FloatType);
const exr = await new EXRExporter().parse(tex, { type: THREE.HalfFloatType, compression: 3 /* ZIP */ });
fs.writeFileSync(out, exr);
console.log(`${sw}x${sh} -> ${W}x${H}, ${(buf.length / 1048576).toFixed(1)} Mo -> ${(exr.length / 1048576).toFixed(2)} Mo`);
