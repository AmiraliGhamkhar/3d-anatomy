/**
 * textures.js — fully procedural tissue detail maps.
 *
 * No image assets, no network, no `<canvas>`: every map is synthesised from value
 * noise into a `THREE.DataTexture`. That keeps the project dependency-free, makes
 * the maps testable headless (vitest/node), and — importantly for a medical
 * visualisation — means the surface detail is *generated* rather than copied from
 * an unrelated photograph, so it tiles seamlessly at any resolution and can be
 * regenerated at a lower size for the low-LOD tiers.
 *
 * Generated per tissue:
 *   • normalMap    — micro-relief (osteons, muscle fascicles, mucosal rugae, pores)
 *   • roughnessMap — spatially varying specular response (wet mucosa vs dry cortex)
 *   • aoMap        — cavity darkening baked from the same height field
 */
import {
  DataTexture,
  FloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';

/* ------------------------------------------------------------------ */
/* Value noise                                                         */
/* ------------------------------------------------------------------ */

/** Deterministic 32-bit hash → [0,1). */
function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695040888963407) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = (h * 1274126177) | 0;
  h = (h ^ (h >> 16)) | 0;
  return ((h >>> 0) % 100000) / 100000;
}

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Tileable 2D value noise. Lattice coordinates wrap at `period` so the resulting
 * maps are seamless under RepeatWrapping — essential, because anatomical surfaces
 * are UV-unwrapped from closed lofts and any seam reads as a surgical scar.
 */
export function valueNoise(x, y, period, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const wrap = (v) => ((v % period) + period) % period;
  const x0 = wrap(ix);
  const x1 = wrap(ix + 1);
  const y0 = wrap(iy);
  const y1 = wrap(iy + 1);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal Brownian motion over tileable value noise. */
export function fbm(x, y, { octaves = 4, basePeriod = 8, gain = 0.5, lacunarity = 2, seed = 0 } = {}) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let period = basePeriod;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, Math.max(1, Math.round(period * freq)), seed + o * 17);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/* ------------------------------------------------------------------ */
/* Height-field → normal / roughness / AO                              */
/* ------------------------------------------------------------------ */

/** Sample a height field into a Float32Array of `size * size`. */
export function heightField(size, fn) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      h[y * size + x] = fn(x / size, y / size, x, y);
    }
  }
  return h;
}

/**
 * Sobel-filter a tileable height field into a tangent-space normal map.
 * `strength` scales the gradient — anatomically this is the difference between the
 * near-smooth articular cartilage and the deeply ridged gastric mucosa.
 */
export function normalMapFromHeight(height, size, strength = 2) {
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 3×3 Sobel with wrap-around sampling.
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = tr + 2 * r + br - (tl + 2 * l + bl);
      const dy = bl + 2 * b + br - (tl + 2 * t + tr);
      let nx = -dx * strength;
      let ny = -dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len;
      const i = (y * size + x) * 4;
      data[i] = ((nx * 0.5 + 0.5) * 255) | 0;
      data[i + 1] = ((ny * 0.5 + 0.5) * 255) | 0;
      data[i + 2] = ((1 / len) * 0.5 * 255 + 127.5) | 0;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Pack a scalar field into a single-channel-ish RGBA byte texture payload. */
export function scalarToRGBA(field, size, { lo = 0, hi = 1 } = {}) {
  const data = new Uint8Array(size * size * 4);
  const span = hi - lo || 1;
  for (let i = 0; i < field.length; i++) {
    const v = Math.min(1, Math.max(0, (field[i] - lo) / span)) * 255;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function makeTexture(data, size, { srgb = false, repeat = 1, anisotropy = 4 } = {}) {
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  // DataTexture defaults to no mipmaps; our sizes are power-of-two so enable them.
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  // Non-colour data (normal / roughness / AO) must stay in linear space.
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  // Leave `channel` at its default (0) so aoMap shares the primary UV set —
  // our lofts emit a single `uv` attribute, so a second set would be dead weight.
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Per-tissue height fields                                            */
/* ------------------------------------------------------------------ */

/**
 * Cortical bone: coarse vascular (Haversian) mottling plus fine periosteal grain,
 * stretched along v so the grain follows the long axis of the diaphysis.
 */
export function boneHeight(size = 128, seed = 1) {
  return heightField(size, (u, v) => {
    const coarse = fbm(u * 6, v * 2, { octaves: 3, basePeriod: 6, seed });
    const fine = fbm(u * 24, v * 8, { octaves: 2, basePeriod: 24, gain: 0.45, seed: seed + 3 });
    return coarse * 0.75 + fine * 0.25;
  });
}

/**
 * Skeletal muscle: dominant longitudinal fascicle striations (the perimysial
 * septa between fibre bundles), modulated by a slow envelope so bundles merge and
 * split along the belly — this is what makes a muscle read as a muscle.
 */
export function muscleHeight(size = 128, seed = 2, { fascicles = 42, envelope = 3 } = {}) {
  return heightField(size, (u, v) => {
    const wobble = fbm(u * envelope, v * 1.5, { octaves: 3, basePeriod: 3, seed }) - 0.5;
    const band = Math.sin((u * fascicles + wobble * 5) * Math.PI * 2) * 0.5 + 0.5;
    const grain = fbm(u * 30, v * 30, { octaves: 2, basePeriod: 30, gain: 0.4, seed: seed + 5 });
    return band * 0.62 + grain * 0.22 + wobble * 0.16;
  });
}

/** Cardiac muscle: coarser, more irregular spiral fibre pattern (myocardium). */
export function cardiacHeight(size = 128, seed = 4) {
  return heightField(size, (u, v) => {
    const wobble = fbm(u * 4, v * 2, { octaves: 3, basePeriod: 4, seed });
    const band = Math.sin((u * 26 + v * 7 + wobble * 4) * Math.PI * 2) * 0.5 + 0.5;
    return band * 0.5 + fbm(u * 14, v * 14, { octaves: 3, basePeriod: 14, seed: seed + 1 }) * 0.5;
  });
}

/** Parenchymal / glandular organ surface: soft lobulated mottling. */
export function parenchymaHeight(size = 128, seed = 6, { lobularity = 10 } = {}) {
  return heightField(size, (u, v) => {
    const lob = fbm(u * lobularity, v * lobularity, { octaves: 4, basePeriod: lobularity, seed });
    const fine = fbm(u * 40, v * 40, { octaves: 2, basePeriod: 40, gain: 0.4, seed: seed + 9 });
    return lob * 0.7 + fine * 0.3;
  });
}

/** Hollow-organ mucosa: broad folds (rugae) over fine villous texture. */
export function mucosaHeight(size = 128, seed = 8, { folds = 5 } = {}) {
  return heightField(size, (u, v) => {
    const ruga = fbm(u * folds, v * folds * 1.6, { octaves: 3, basePeriod: folds, seed });
    return Math.pow(ruga, 1.6) * 0.8 + fbm(u * 50, v * 50, { octaves: 2, basePeriod: 50, seed: seed + 2 }) * 0.2;
  });
}

/** Cerebral cortex: tight gyral convolutions. */
export function cortexHeight(size = 256, seed = 12) {
  return heightField(size, (u, v) => {
    const gyri = fbm(u * 22, v * 14, { octaves: 5, basePeriod: 22, gain: 0.55, seed });
    const ridge = Math.pow(Math.abs(gyri - 0.5) * 2, 0.6);
    return (1 - ridge) * 0.8 + fbm(u * 60, v * 60, { octaves: 2, basePeriod: 60, seed: seed + 4 }) * 0.2;
  });
}

/** Skin: pores (cellular Voronoi-ish) over a low-frequency dermal undulation. */
export function skinHeight(size = 128, seed = 14) {
  return heightField(size, (u, v) => {
    // Cheap cellular pattern: jittered lattice distance.
    const sx = u * 48;
    const sy = v * 48;
    const ix = Math.floor(sx);
    const iy = Math.floor(sy);
    let d = 1e9;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const jx = ox + hash2(ix + ox, iy + oy, seed);
        const jy = oy + hash2(ix + ox, iy + oy, seed + 91);
        const dx = jx - (sx - ix);
        const dy = jy - (sy - iy);
        d = Math.min(d, dx * dx + dy * dy);
      }
    }
    const pore = 1 - Math.min(1, Math.sqrt(d) * 1.6);
    const undulation = fbm(u * 8, v * 8, { octaves: 3, basePeriod: 8, seed });
    return pore * 0.55 + undulation * 0.45;
  });
}

/** Dense fibrous tissue (tendon, ligament, fascia): tight parallel collagen bands. */
export function fibrousHeight(size = 128, seed = 16) {
  return heightField(size, (u, v) => {
    const band = Math.sin(u * 90 * Math.PI * 2) * 0.5 + 0.5;
    return band * 0.6 + fbm(u * 40, v * 4, { octaves: 2, basePeriod: 40, seed }) * 0.4;
  });
}

/* ------------------------------------------------------------------ */
/* Public factory                                                      */
/* ------------------------------------------------------------------ */

/**
 * Build the full map set for a tissue.
 * @param {Function} heightFn (size, seed) => Float32Array
 * @param {object} opts
 * @param {number} [opts.size=128]
 * @param {number} [opts.normalStrength=2]
 * @param {[number,number]} [opts.roughnessRange] remap height into roughness
 * @param {number} [opts.repeat=1]
 * @param {number} [opts.aoStrength=0.35]
 * @returns {{normalMap:DataTexture,roughnessMap:DataTexture,aoMap:DataTexture,height:Float32Array}}
 */
export function buildTissueMaps(heightFn, opts = {}) {
  const {
    size = 128,
    seed = 1,
    normalStrength = 2,
    roughnessRange = [0.45, 0.85],
    repeat = 2,
    aoStrength = 0.35,
    anisotropy = 4,
  } = opts;

  const height = heightFn(size, seed);

  // Roughness: inverse of height so ridges catch light and grooves stay matte.
  const [rLo, rHi] = roughnessRange;
  const rough = new Float32Array(height.length);
  for (let i = 0; i < height.length; i++) rough[i] = rHi - (rHi - rLo) * height[i];

  // Ambient occlusion approximated by inverting and softening the height field.
  const ao = new Float32Array(height.length);
  for (let i = 0; i < height.length; i++) ao[i] = 1 - (1 - height[i]) * aoStrength;

  return {
    height,
    normalMap: makeTexture(normalMapFromHeight(height, size, normalStrength), size, { repeat, anisotropy }),
    roughnessMap: makeTexture(scalarToRGBA(rough, size, { lo: rLo, hi: rHi }), size, { repeat, anisotropy }),
    aoMap: makeTexture(scalarToRGBA(ao, size), size, { repeat, anisotropy }),
  };
}

export { FloatType };
