// Bruits déterministes (Perlin 2D/3D, Worley 3D) partagés par les outils de génération.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makePerlin(seed) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(512);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  function grad2(h, x, y) {
    switch (h & 7) {
      case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
      case 4: return x; case 5: return -x; case 6: return y; default: return -y;
    }
  }
  function noise2(x, y) {
    const X = Math.floor(x), Y = Math.floor(y);
    const xf = x - X, yf = y - Y;
    const xi = X & 255, yi = Y & 255;
    const u = fade(xf), v = fade(yf);
    const aa = p[p[xi] + yi], ab = p[p[xi] + yi + 1], ba = p[p[xi + 1] + yi], bb = p[p[xi + 1] + yi + 1];
    return lerp(lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u), lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u), v) * 0.7071;
  }
  function grad3(h, x, y, z) {
    const hh = h & 15;
    const u = hh < 8 ? x : y;
    const v = hh < 4 ? y : (hh === 12 || hh === 14 ? x : z);
    return ((hh & 1) ? -u : u) + ((hh & 2) ? -v : v);
  }
  // Perlin 3D périodique (période `per` en cellules) pour textures tuilables.
  function noise3(x, y, z, per = 256) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const xf = x - X, yf = y - Y, zf = z - Z;
    const w = (i) => ((i % per) + per) % per & 255;
    const xi = w(X), yi = w(Y), zi = w(Z), xi1 = w(X + 1), yi1 = w(Y + 1), zi1 = w(Z + 1);
    const u = fade(xf), v = fade(yf), ww = fade(zf);
    const h = (a, b, c) => p[p[p[a] + b] + c];
    const x1 = lerp(grad3(h(xi, yi, zi), xf, yf, zf), grad3(h(xi1, yi, zi), xf - 1, yf, zf), u);
    const x2 = lerp(grad3(h(xi, yi1, zi), xf, yf - 1, zf), grad3(h(xi1, yi1, zi), xf - 1, yf - 1, zf), u);
    const x3 = lerp(grad3(h(xi, yi, zi1), xf, yf, zf - 1), grad3(h(xi1, yi, zi1), xf - 1, yf, zf - 1), u);
    const x4 = lerp(grad3(h(xi, yi1, zi1), xf, yf - 1, zf - 1), grad3(h(xi1, yi1, zi1), xf - 1, yf - 1, zf - 1), u);
    return lerp(lerp(x1, x2, v), lerp(x3, x4, v), ww);
  }
  function fbm2(x, y, oct = 5, lac = 2.0, gain = 0.5) {
    let s = 0, a = 1, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * noise2(x * f + i * 17.13, y * f - i * 9.71); n += a; a *= gain; f *= lac; }
    return s / n;
  }
  function ridged2(x, y, oct = 5, lac = 2.0, gain = 0.5) {
    let s = 0, a = 1, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { const r = 1 - Math.abs(noise2(x * f + i * 3.1, y * f + i * 7.7)); s += a * r * r; n += a; a *= gain; f *= lac; }
    return s / n;
  }
  return { noise2, noise3, fbm2, ridged2 };
}

// Worley 3D périodique : distance au point caractéristique le plus proche (0..~1).
export function makeWorley3(seed, cells) {
  const rnd = mulberry32(seed);
  const pts = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rnd();
  return function (x, y, z) { // x,y,z dans [0,1)
    const fx = x * cells, fy = y * cells, fz = z * cells;
    const cx = Math.floor(fx), cy = Math.floor(fy), cz = Math.floor(fz);
    let best = 1e9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ix = cx + dx, iy = cy + dy, iz = cz + dz;
      const wx = ((ix % cells) + cells) % cells, wy = ((iy % cells) + cells) % cells, wz = ((iz % cells) + cells) % cells;
      const k = ((wz * cells + wy) * cells + wx) * 3;
      const px = ix + pts[k], py = iy + pts[k + 1], pz = iz + pts[k + 2];
      const d = (px - fx) ** 2 + (py - fy) ** 2 + (pz - fz) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
}

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
