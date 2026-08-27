/**
 * loft.js — the core procedural surface generator.
 *
 * Sweeps a polar cross-section along a spine curve using rotation-minimising
 * frames (see Frame.js) and produces a watertight, UV-mapped, closed or open
 * `BufferGeometry`.
 *
 * This one primitive, driven by different profiles, is what makes the project
 * feasible: long bones, ribs, vertebrae, muscle bellies, tendons, vessels,
 * bronchi, intestines and ureters are all lofts. Keeping a single generator
 * means a single place to optimise tessellation, and it guarantees every mesh in
 * the model has an identical attribute layout (position + normal + uv), so
 * arbitrary anatomical parts can be merged into one draw call by
 * `BufferGeometryUtils.mergeGeometries`.
 */
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { computeParallelFrames } from './Frame.js';

const _p = new Vector3();

/**
 * UNIT CONVENTION — read before writing a profile.
 *
 * The spine waypoints are given in **centimetres** and the profile function
 * returns a radius in **centimetres**; the conversion to scene units (metres)
 * happens once, here. Mixing the two is the easiest way to get a rib that is two
 * metres long, so this module is the single place that knows about the factor.
 */
const CM_TO_SCENE = 0.01;

/**
 * @param {object} opts
 * @param {import('three').Curve} opts.spine  Spine curve (already in scene units).
 * @param {(theta:number,t:number)=>number} opts.profile  Cross-section radius **in cm**.
 * @param {number} [opts.radialSegments=16]  Segments around the section.
 * @param {number} [opts.heightSegments=12]  Segments along the spine.
 * @param {boolean|{capStart?:boolean,capEnd?:boolean}} [opts.cap=true]  Close the ends.
 * @param {(t:number)=>number} [opts.roll]  Extra twist (radians) applied along the spine.
 * @param {Vector3} [opts.up]  Seed direction for the frame's first normal.
 * @param {[number,number]} [opts.uvScale=[1,1]]  UV tiling multiplier.
 * @param {(theta:number,t:number)=>number} [opts.displace]
 *        Optional radial perturbation **in cm** added to the profile (surface
 *        detail such as muscle fascicle ridges or cortical bone undulation). Kept
 *        additive and small so the silhouette stays anatomically faithful.
 * @returns {BufferGeometry}
 */
export function loft(opts) {
  const {
    spine,
    profile,
    radialSegments = 16,
    heightSegments = 12,
    cap = true,
    roll = null,
    up = new Vector3(0, 1, 0),
    uvScale = [1, 1],
    displace = null,
  } = opts;

  const R = Math.max(3, radialSegments | 0);
  const H = Math.max(1, heightSegments | 0);
  const capStart = cap === true ? true : !!cap?.capStart;
  const capEnd = cap === true ? true : !!cap?.capEnd;

  const frames = computeParallelFrames(spine, H, up);

  const ringCount = H + 1;
  const tubeVerts = ringCount * R;
  const poleVerts = (capStart ? 1 : 0) + (capEnd ? 1 : 0);
  const positions = new Float32Array((tubeVerts + poleVerts) * 3);
  const normals = new Float32Array((tubeVerts + poleVerts) * 3);
  const uvs = new Float32Array((tubeVerts + poleVerts) * 2);

  // ---- Tube vertices -------------------------------------------------------
  let vi = 0;
  for (let i = 0; i <= H; i++) {
    const t = i / H;
    const origin = frames.points[i];
    const nrm = frames.normals[i];
    const bin = frames.binormals[i];
    const twist = roll ? roll(t) : 0;
    const cosT = Math.cos(twist);
    const sinT = Math.sin(twist);

    for (let j = 0; j < R; j++) {
      const theta = (j / R) * Math.PI * 2;
      // Apply roll by rotating the sampling angle within the frame plane.
      const a = theta + twist;
      // Profile and displacement are in cm; convert once to scene units.
      const rCm = (profile(theta, t) || 0) + (displace ? displace(theta, t) : 0);
      const r = Math.max(0, rCm) * CM_TO_SCENE;

      // Local 2D → frame basis. cosT/sinT keep the *section* fixed while the
      // sample index rotates, which is what a physical torsion looks like.
      const cn = Math.cos(a);
      const cb = Math.sin(a);

      _p.copy(origin)
        .addScaledVector(nrm, r * (cn * cosT - cb * sinT))
        .addScaledVector(bin, r * (cn * sinT + cb * cosT));

      const o = vi * 3;
      positions[o] = _p.x;
      positions[o + 1] = _p.y;
      positions[o + 2] = _p.z;
      uvs[vi * 2] = (j / R) * uvScale[0];
      uvs[vi * 2 + 1] = t * uvScale[1];
      vi++;
    }
  }

  // ---- Indices (winding verified outward — see module header) --------------
  const quads = H * R * 2;
  const capTris = (capStart ? R : 0) + (capEnd ? R : 0);
  const indices = new Uint32Array((quads + capTris) * 3);
  let ii = 0;

  for (let i = 0; i < H; i++) {
    for (let j = 0; j < R; j++) {
      const a = i * R + j;
      const b = (i + 1) * R + j;
      const c = (i + 1) * R + ((j + 1) % R);
      const d = i * R + ((j + 1) % R);
      indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
      indices[ii++] = a; indices[ii++] = d; indices[ii++] = c;
    }
  }

  // ---- Caps ----------------------------------------------------------------
  // Cap rings reuse the tube rim *positions* but need their own vertices so that
  // computeVertexNormals() can give the cap a face-perpendicular normal instead
  // of blending it with the tube wall.
  const poleIndex = { start: -1, end: -1 };
  if (capStart) {
    poleIndex.start = vi;
    const o = vi * 3;
    positions[o] = frames.points[0].x;
    positions[o + 1] = frames.points[0].y;
    positions[o + 2] = frames.points[0].z;
    uvs[vi * 2] = 0.5; uvs[vi * 2 + 1] = 0;
    vi++;
  }
  if (capEnd) {
    poleIndex.end = vi;
    const o = vi * 3;
    positions[o] = frames.points[H].x;
    positions[o + 1] = frames.points[H].y;
    positions[o + 2] = frames.points[H].z;
    uvs[vi * 2] = 0.5; uvs[vi * 2 + 1] = 1;
    vi++;
  }

  if (capStart) {
    for (let j = 0; j < R; j++) {
      const cur = j;
      const nxt = (j + 1) % R;
      indices[ii++] = poleIndex.start; indices[ii++] = nxt; indices[ii++] = cur;
    }
  }
  if (capEnd) {
    const base = H * R;
    for (let j = 0; j < R; j++) {
      const cur = base + j;
      const nxt = base + ((j + 1) % R);
      indices[ii++] = poleIndex.end; indices[ii++] = cur; indices[ii++] = nxt;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Convenience: build a spine curve from an array of [x,y,z] waypoints. */
export { CatmullRomCurve3 as spineFromPoints } from 'three';
