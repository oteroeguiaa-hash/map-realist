// Simplifie les modèles scannés (Poly Haven, CC0) et les exporte dans un format binaire compact.
// Usage : node tools/prep_models.mjs <dossier ph>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MeshoptSimplifier } from 'meshoptimizer';

const PH = process.argv[2];
const OUT = new URL('../assets/mdl/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
await MeshoptSimplifier.ready;

const MODELS = [
  { id: 'rock_07', name: 'rock_a', tris: 900 },
  { id: 'rock_09', name: 'rock_b', tris: 900 },
  { id: 'moon_rock_02', name: 'rock_c', tris: 800 },
  { id: 'rock_face_01', name: 'cliff', tris: 2600 },
  { id: 'lambis_shell', name: 'shell', tris: 500 },
  { id: 'dead_tree_trunk', name: 'log', tris: 1600 },
];
const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

for (const m of MODELS) {
  const dir = path.join(PH, 'mdl', m.id);
  const g = JSON.parse(fs.readFileSync(path.join(dir, `${m.id}.gltf`), 'utf8'));
  const bin = fs.readFileSync(path.join(dir, g.buffers[0].uri));
  const acc = (i) => {
    const a = g.accessors[i], bv = g.bufferViews[a.bufferView], T = COMP[a.componentType], n = NC[a.type];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || T.BYTES_PER_ELEMENT * n;
    const out = new Float64Array(a.count * n);
    const dv = new DataView(bin.buffer, bin.byteOffset);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      const o = off + k * stride + c * T.BYTES_PER_ELEMENT;
      let v;
      switch (a.componentType) {
        case 5126: v = dv.getFloat32(o, true); break;
        case 5125: v = dv.getUint32(o, true); break;
        case 5123: v = dv.getUint16(o, true); break;
        case 5122: v = dv.getInt16(o, true); break;
        case 5121: v = dv.getUint8(o); break;
        default: v = dv.getInt8(o);
      }
      out[k * n + c] = v;
    }
    if (a.normalized) { const div = a.componentType === 5123 ? 65535 : a.componentType === 5121 ? 255 : a.componentType === 5122 ? 32767 : 127; for (let k = 0; k < out.length; k++) out[k] /= div; }
    return out;
  };
  const prim = g.meshes[0].primitives[0];
  const P = acc(prim.attributes.POSITION), N = acc(prim.attributes.NORMAL), UV = acc(prim.attributes.TEXCOORD_0), I = acc(prim.indices);
  const pos = Float32Array.from(P), idx = Uint32Array.from(I);
  const target = Math.min(idx.length, m.tris * 3);
  const [sidx] = MeshoptSimplifier.simplify(idx, pos, 3, target, 0.02, ['LockBorder']);
  const remap = new Map(), vP = [], vN = [], vU = [], outI = [];
  for (const i of sidx) {
    if (!remap.has(i)) { remap.set(i, vP.length / 3); vP.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); vN.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); vU.push(UV[i * 2], UV[i * 2 + 1]); }
    outI.push(remap.get(i));
  }
  // recentrage : base au sol, centre en x/z
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let k = 0; k < vP.length; k += 3) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], vP[k + c]); mx[c] = Math.max(mx[c], vP[k + c]); }
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
  for (let k = 0; k < vP.length; k += 3) { vP[k] -= cx; vP[k + 1] -= mn[1]; vP[k + 2] -= cz; }
  const nv = vP.length / 3, ni = outI.length;
  const head = new Uint32Array([nv, ni]);
  const bb = new Float32Array([mn[0] - cx, 0, mn[2] - cz, mx[0] - cx, mx[1] - mn[1], mx[2] - cz]);
  const ib = nv > 65535 ? Uint32Array.from(outI) : Uint16Array.from(outI);
  const pad = (b) => { const r = b.byteLength % 4; return r ? Buffer.concat([Buffer.from(b.buffer, b.byteOffset, b.byteLength), Buffer.alloc(4 - r)]) : Buffer.from(b.buffer, b.byteOffset, b.byteLength); };
  fs.writeFileSync(path.join(OUT, `${m.name}.bin`), Buffer.concat([pad(head), pad(bb), pad(Float32Array.from(vP)), pad(Float32Array.from(vN)), pad(Float32Array.from(vU)), pad(ib)]));
  // textures 512 px
  const tdir = path.join(dir, 'textures');
  const files = fs.readdirSync(tdir);
  const diff = files.find((f) => f.includes('_diff_')), nor = files.find((f) => f.includes('_nor_gl_'));
  execFileSync('convert', [path.join(tdir, diff), '-resize', '512x512', '-quality', '84', path.join(OUT, `${m.name}_a.jpg`)]);
  execFileSync('convert', [path.join(tdir, nor), '-resize', '512x512', '-quality', '88', path.join(OUT, `${m.name}_n.jpg`)]);
  console.log(m.name, 'verts', nv, 'tris', ni / 3, 'size', bb.map((v) => v.toFixed(2)).join(','));
}
