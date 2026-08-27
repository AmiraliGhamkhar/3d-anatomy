/**
 * Frame.js — rotation-minimising (parallel transport) frames along a curve.
 *
 * Why not Frenet frames? Frenet frames use the curve's *curvature* to define the
 * normal, which flips sign at inflection points. Anatomical spines are full of
 * inflections — the cervical lordosis → thoracic kyphosis transition, the S-shaped
 * clavicle, the sigmoid colon — and a Frenet-based loft visibly "snaps" 180° at
 * each one. Parallel transport integrates the frame along the curve instead, so
 * it stays continuous regardless of curvature sign.
 *
 * The seed normal is chosen from a supplied anatomical "up"/"reference" direction
 * so that cross-section orientation is meaningful: for a rib we seed with the
 * body's superior axis so the flat costal face lands in the correct plane.
 */
import { Vector3 } from 'three';

const _t0 = new Vector3();
const _t1 = new Vector3();
const _axis = new Vector3();
const _tmp = new Vector3();

/**
 * Build `segments + 1` frames along `curve`.
 *
 * @param {import('three').Curve} curve  Curve to follow.
 * @param {number} segments              Number of span steps (→ segments+1 frames).
 * @param {Vector3} [up]                 World direction used to seed the first normal.
 * @returns {{points:Vector3[],tangents:Vector3[],normals:Vector3[],binormals:Vector3[]}}
 */
export function computeParallelFrames(curve, segments, up = new Vector3(0, 1, 0)) {
  const n = Math.max(1, segments | 0);
  const points = new Array(n + 1);
  const tangents = new Array(n + 1);
  const normals = new Array(n + 1);
  const binormals = new Array(n + 1);

  // Sample positions and tangents.
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    points[i] = curve.getPointAt(u);
    tangents[i] = curve.getTangentAt(u).normalize();
  }

  // Seed: normal perpendicular to the first tangent, closest to `up`.
  const n0 = new Vector3();
  _tmp.copy(tangents[0]);
  if (Math.abs(_tmp.dot(up)) > 0.999) {
    // Tangent nearly parallel to the seed — fall back to a transverse axis.
    _tmp.copy(Math.abs(_tmp.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1));
  }
  n0.crossVectors(_tmp, up).normalize();
  if (n0.lengthSq() < 1e-8) n0.set(1, 0, 0);
  normals[0] = n0;
  binormals[0] = new Vector3().crossVectors(tangents[0], normals[0]).normalize();

  // Transport each frame to the next using the rotation that aligns tangents.
  for (let i = 1; i <= n; i++) {
    _t0.copy(tangents[i - 1]);
    _t1.copy(tangents[i]);
    _axis.crossVectors(_t0, _t1);

    let normal = normals[i - 1].clone();
    if (_axis.lengthSq() > 1e-12) {
      _axis.normalize();
      const dot = Math.min(1, Math.max(-1, _t0.dot(_t1)));
      normal.applyAxisAngle(_axis, Math.acos(dot));
    }
    // Re-orthogonalise against the local tangent (guards numerical drift).
    normal.sub(_t1.clone().multiplyScalar(normal.dot(_t1))).normalize();

    normals[i] = normal;
    binormals[i] = new Vector3().crossVectors(_t1, normal).normalize();
  }

  return { points, tangents, normals, binormals };
}
