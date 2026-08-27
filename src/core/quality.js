/**
 * quality.js — tessellation budget and level-of-detail construction.
 *
 * The model is generated procedurally, which means LOD is not "load a smaller
 * file" but "re-run the generator with fewer segments". That is strictly better
 * than mesh decimation here: it costs nothing at runtime, it is deterministic,
 * and it cannot produce the self-intersections and flipped triangles a decimator
 * introduces on thin anatomical structures (ribs, tendons, vessels).
 *
 * A single scalar `q` in (0, 1] drives every segment count in the project, so the
 * whole model — skeleton, musculature and viscera together — moves between quality
 * tiers coherently instead of one system staying sharp while another goes flat.
 */
import { LOD, Object3D } from 'three';
import { triangleCount } from './builders.js';

/** Named tiers. `q` scales segment counts; `dpr` caps device pixel ratio. */
export const QUALITY_TIERS = Object.freeze({
  low: { label: 'Low (mobile)', q: 0.4, dpr: 1.0, shadows: false, pixelBudget: 1.2e6 },
  medium: { label: 'Medium', q: 0.65, dpr: 1.5, shadows: true, pixelBudget: 2.6e6 },
  high: { label: 'High', q: 0.85, dpr: 2.0, shadows: true, pixelBudget: 4.5e6 },
  ultra: { label: 'Ultra', q: 1.0, dpr: 2.5, shadows: true, pixelBudget: 8e6 },
});

/**
 * Resolve a segment count from a base value and a quality scalar.
 * A hard floor of 3 keeps any section a valid closed polygon even at q → 0.
 */
export function segs(base, q = 1) {
  return Math.max(3, Math.round(base * Math.max(0.12, q)));
}

/**
 * Build a THREE.LOD from a geometry generator.
 *
 * @param {(q:number)=>import('three').BufferGeometry} build geometry factory
 * @param {(geometry:import('three').BufferGeometry, distance:number)=>import('three').Object3D} [makeObject]
 *   Wraps each tier's geometry in a display object (usually a Mesh). Defaults to a
 *   bare Object3D so `buildLOD` stays usable for measurement-only LODs.
 * @param {object} [opts]
 * @param {number[]} [opts.distances] camera distances (scene units = metres) at
 *   which to step down. Default tiers assume the model is ~1.75 m tall and is
 *   usually viewed from 1.5–4 m.
 * @param {number} [opts.baseQ=1] quality scalar for the highest tier.
 * @param {number[]} [opts.qSteps] quality multipliers per tier, highest first.
 * @returns {LOD}
 */
export function buildLOD(build, makeObject = defaultMakeObject, opts = {}) {
  const { distances = [0, 1.6, 3.2, 6.0], baseQ = 1, qSteps = [1, 0.72, 0.5, 0.34] } = opts;

  const lod = new LOD();
  lod.autoUpdate = true;
  const n = Math.min(distances.length, qSteps.length);

  for (let i = 0; i < n; i++) {
    const geometry = build(baseQ * qSteps[i]);
    if (!geometry || !geometry.attributes?.position) continue;
    const obj = makeObject(geometry, distances[i]);
    obj.userData.triangles = triangleCount(geometry);
    // addLevel() parents the object to the LOD — do not reparent it afterwards.
    lod.addLevel(obj, distances[i]);
  }

  lod.userData.lodTiers = lod.levels.length;
  lod.userData.triangles = lod.levels.map((l) => l.object.userData.triangles ?? 0);
  // Remember the authored distances so the performance governor can bias the
  // switch points without rebuilding geometry.
  lod.userData.baseDistances = lod.levels.map((l) => l.distance);
  return lod;
}

/**
 * Shift every LOD's switch distances by a multiplier. Values < 1 make the model
 * step down to coarser tiers sooner (used by the adaptive governor); 1 restores
 * the authored behaviour. Cheap: it only rewrites a scalar per level.
 */
export function setLODBias(root, factor = 1) {
  let touched = 0;
  root.traverse((o) => {
    if (!o.isLOD || !o.userData.baseDistances) return;
    const base = o.userData.baseDistances;
    o.levels.forEach((level, i) => {
      level.distance = base[i] * factor;
    });
    touched++;
  });
  return touched;
}

function defaultMakeObject(geometry) {
  const holder = new Object3D();
  holder.userData.geometry = geometry;
  return holder;
}

/** Total triangles across the highest tier of every LOD in a subtree. */
export function countTriangles(root) {
  let total = 0;
  root.traverse((o) => {
    if (o.isLOD) {
      // LODs render one tier at a time — charge the model its highest tier.
      total += o.userData.triangles?.[0] ?? 0;
    } else if ((o.isMesh || o.isInstancedMesh) && !isInsideLOD(o)) {
      total += triangleCount(o.geometry) * (o.isInstancedMesh ? o.count : 1);
    }
  });
  return total;
}

function isInsideLOD(obj) {
  let p = obj.parent;
  while (p) {
    if (p.isLOD) return true;
    p = p.parent;
  }
  return false;
}

/**
 * Objects that will submit a draw call.
 *
 * An LOD renders exactly one tier at a time, so it counts as one call — not as
 * one call per tier, and (the bug this avoids) not as zero by skipping its
 * children outright.
 */
export function countDrawCalls(root) {
  let total = 0;
  root.traverse((o) => {
    if (o.isLOD) {
      total += 1;
      return;
    }
    if ((o.isMesh || o.isInstancedMesh) && !isInsideLOD(o)) total += 1;
  });
  return total;
}
