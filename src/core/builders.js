/**
 * builders.js — higher-level geometry builders assembled on top of the loft.
 *
 * Everything here is deterministic and dependency-free: given the same anatomical
 * parameters and quality tier it returns byte-identical geometry, which makes the
 * LOD tiers and the unit tests reproducible.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loft } from './loft.js';

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Spine helper                                                        */
/* ------------------------------------------------------------------ */

/**
 * Build a smooth spine curve from waypoints given in **centimetres**.
 * 'centripetal' Catmull-Rom is the default because it never overshoots on unevenly
 * spaced control points — and anatomical waypoints are never evenly spaced.
 */
export function spine(pointsCm, { tension = 0.5, type = 'centripetal', closed = false } = {}) {
  const pts = pointsCm.map(([x, y, z]) => new Vector3(x * 0.01, y * 0.01, z * 0.01));
  if (pts.length === 1) pts.push(pts[0].clone().add(new Vector3(0, 1e-4, 0)));
  return new CatmullRomCurve3(pts, closed, type, tension);
}

/** Convenience wrapper for three's Vector3 with cm input. */
export const v3cm = ([x, y, z]) => new Vector3(x * 0.01, y * 0.01, z * 0.01);

/* ------------------------------------------------------------------ */
/* Tube = loft with a radius-along-length function                     */
/* ------------------------------------------------------------------ */

/**
 * Round tube following a path — vessels, ureters, bronchi, intestines, tendons.
 * @param {number[][]} pointsCm  waypoints in cm
 * @param {((t:number)=>number)|number} radiusCm  radius in cm at normalised arc position
 */
export function tube(pointsCm, radiusCm, opts = {}) {
  const { radialSegments = 12, heightSegments = 32, cap = true, up = [0, 1, 0] } = opts;
  const rf = typeof radiusCm === 'function' ? radiusCm : () => radiusCm;
  return loft({
    spine: spine(pointsCm),
    // loft() converts cm → scene units, so pass the radius through unchanged.
    profile: (_theta, t) => Math.max(1e-3, rf(t)),
    radialSegments,
    heightSegments,
    cap,
    up: new Vector3(up[0], up[1], up[2]),
  });
}

/* ------------------------------------------------------------------ */
/* Radial / superellipsoid shapes                                      */
/* ------------------------------------------------------------------ */

/**
 * Star-shaped ("radial") surface: every ray from `centreCm` meets the surface
 * exactly once, at `radiusCm(dir, theta, phi)`. Ideal for the neurocranium, the
 * iliac ala, the brain, the liver, the spleen and the kidneys — smooth but far
 * from ellipsoidal silhouettes.
 *
 * @param {(dir:Vector3, theta:number, phi:number)=>number} radiusCm radius in cm
 */
export function radial(radiusCm, { widthSegments = 32, heightSegments = 24, centreCm = [0, 0, 0] } = {}) {
  const W = Math.max(3, widthSegments | 0);
  const H = Math.max(2, heightSegments | 0);
  const count = (W + 1) * (H + 1);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const cx = centreCm[0] * 0.01;
  const cy = centreCm[1] * 0.01;
  const cz = centreCm[2] * 0.01;
  const dir = new Vector3();

  let k = 0;
  for (let i = 0; i <= H; i++) {
    const phi = (i / H) * Math.PI; // 0 at +Y (superior)
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let j = 0; j <= W; j++) {
      const theta = (j / W) * Math.PI * 2;
      dir.set(sinPhi * Math.sin(theta), cosPhi, sinPhi * Math.cos(theta));
      const r = Math.max(1e-6, radiusCm(dir, theta, phi) * 0.01);
      pos[k * 3] = cx + dir.x * r;
      pos[k * 3 + 1] = cy + dir.y * r;
      pos[k * 3 + 2] = cz + dir.z * r;
      uv[k * 2] = j / W;
      uv[k * 2 + 1] = i / H;
      k++;
    }
  }

  const idx = [];
  for (let i = 0; i < H; i++) {
    for (let j = 0; j < W; j++) {
      const a = i * (W + 1) + j;
      const b = a + W + 1;
      // Skip degenerate triangles at the poles.
      if (i !== 0) idx.push(a, a + 1, b);
      if (i !== H - 1) idx.push(a + 1, b + 1, b);
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Superellipsoid ("Lamé sphere") — the workhorse for bones that are boxy but
 * rounded: carpals, tarsals, patella, sacrum, vertebral bodies.
 *
 * Radial form of  |x/a|^n + |y/b|^n + |z/c|^n = 1  is
 *   r(dir) = ( |dx/a|^n + |dy/b|^n + |dz/c|^n )^(-1/n)
 * n = 2 → ellipsoid, n = 4 → rounded box, n = 8 → near-cuboid.
 *
 * @param {[number,number,number]} semi  semi-axes in cm
 */
export function superellipsoid(semi, { n = 2, widthSegments = 24, heightSegments = 16, centreCm = [0, 0, 0] } = {}) {
  const [a, b, c] = semi.map((s) => Math.max(1e-4, s));
  const inv = 1 / n;
  return radial(
    (dir) =>
      Math.pow(
        Math.pow(Math.abs(dir.x) / a, n) + Math.pow(Math.abs(dir.y) / b, n) + Math.pow(Math.abs(dir.z) / c, n),
        -inv,
      ),
    { widthSegments, heightSegments, centreCm },
  );
}

/* ------------------------------------------------------------------ */
/* Composition helpers                                                 */
/* ------------------------------------------------------------------ */

const _mat = new Matrix4();
const _euler = new Euler();
const _quat = new Quaternion();
const _pos = new Vector3();
const _scl = new Vector3();

/**
 * Apply a rigid transform in cm. Rotation is XYZ Euler in **degrees** (anatomy
 * texts give bone angulations in degrees). Mutates and returns `geometry`.
 */
export function transformGeometry(geometry, { position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 } = {}) {
  const s = Array.isArray(scale) ? scale : [scale, scale, scale];
  _euler.set(rotation[0] * DEG, rotation[1] * DEG, rotation[2] * DEG, 'XYZ');
  _quat.setFromEuler(_euler);
  _pos.set(position[0] * 0.01, position[1] * 0.01, position[2] * 0.01);
  _scl.set(s[0], s[1], s[2]);
  _mat.compose(_pos, _quat, _scl);
  geometry.applyMatrix4(_mat);
  return geometry;
}

/**
 * Give a geometry a sequential index without welding any vertices.
 *
 * `mergeGeometries` refuses to mix indexed and non-indexed inputs, and builders
 * like `ExtrudeGeometry` emit non-indexed buffers. A sequential index fixes the
 * mismatch while preserving the exact per-face normals the builder computed —
 * `mergeVertices` would weld the cap/side crease of a plate and round it off.
 */
export function toIndexed(geometry) {
  if (geometry.index) return geometry;
  const count = geometry.attributes.position.count;
  const array = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
  for (let i = 0; i < count; i++) array[i] = i;
  geometry.setIndex(new BufferAttribute(array, 1));
  return geometry;
}

/**
 * Merge a list of geometries into a single buffer so a multi-part bone or organ
 * costs one draw call. `mergeGeometries` demands identical attribute sets and no
 * groups, so both are normalised here.
 */
export function merge(list) {
  const clean = list.filter(Boolean).map((g) => {
    const c = toIndexed(g.clone());
    c.clearGroups();
    if (!c.attributes.uv) {
      c.setAttribute('uv', new BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2));
    }
    if (!c.attributes.normal) c.computeVertexNormals();
    // Keep attribute sets identical: drop anything beyond position/normal/uv.
    for (const name of Object.keys(c.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) c.deleteAttribute(name);
    }
    return c;
  });
  if (clean.length === 0) return new BufferGeometry();
  if (clean.length === 1) return clean[0];
  const merged = mergeGeometries(clean, false);
  if (!merged) throw new Error('mergeGeometries failed — attribute layouts differ');
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Triangle count — used by the performance governor and the tests. */
export function triangleCount(geometry) {
  return geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
}

/**
 * Mirror a geometry about the X = 0 plane (produces the contralateral twin).
 *
 * Reflection reverses orientation, so simply negating x would turn every
 * outward-facing triangle inside out and back-face culling would eat the bone.
 * Reversing the index winding of every triangle restores the outward convention.
 * @returns {BufferGeometry} a new geometry (the input is not modified)
 */
export function mirrorX(geometry) {
  const g = geometry.clone();
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setX(i, -pos.getX(i));
  pos.needsUpdate = true;

  const idx = g.index;
  if (idx) {
    const a = idx.array;
    for (let i = 0; i < a.length; i += 3) {
      const tmp = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = tmp;
    }
    idx.needsUpdate = true;
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Build a bilaterally symmetric pair. Returns two geometries built from the same
 * parameters so the left and right sides are guaranteed congruent — a common
 * source of asymmetry bugs when limbs are authored twice by hand.
 * @param {(side:number)=>BufferGeometry} build called with +1 (subject's left) / -1 (right)
 */
export function bilateral(build) {
  return { left: build(1), right: build(-1) };
}

/* ------------------------------------------------------------------ */
/* Flat bones: polygon extrusion                                       */
/* ------------------------------------------------------------------ */

import { ExtrudeGeometry, Shape } from 'three';

/**
 * Extrude a 2D polygon in the XY plane into a thin plate.
 *
 * The scapular blade and the iliac ala are genuinely flat bones — triangular
 * plates a few millimetres thick. Extruding the real outline is both more
 * accurate and far cheaper than approximating them with a loft, and the bevel
 * gives the rounded cortical border you see on a real specimen.
 *
 * @param {number[][]} outlineCm polygon vertices [x, y] in cm
 * @param {number} thicknessCm   plate thickness in cm (extruded along z)
 */
export function extrudePlate(outlineCm, thicknessCm, { bevel = 0.12, curveSegments = 6 } = {}) {
  // Same convention as spine() and radial(): inputs in cm, output in scene units.
  const shape = new Shape();
  outlineCm.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x * 0.01, y * 0.01) : shape.lineTo(x * 0.01, y * 0.01)));
  shape.closePath();

  const depth = Math.max(0.0005, thicknessCm * 0.01);
  const bev = bevel * 0.01;
  const g = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bev,
    bevelSize: bev,
    bevelSegments: 2,
    curveSegments,
  });
  // Centre the plate on its own thickness so `position` stays the mid-plane.
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
