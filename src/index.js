/**
 * 3d-anatomy — public API.
 *
 * Two levels of use:
 *
 *   1. Drop-in viewer
 *        import { AnatomyViewer } from '3d-anatomy';
 *        new AnatomyViewer(document.getElementById('view')).init();
 *
 *   2. Build blocks, for embedding individual systems in your own scene
 *        import { buildAxialSkeleton, buildMuscle, tissue, makePart } from '3d-anatomy';
 *
 * Everything is ES modules with no runtime dependency beyond three itself.
 */

export { AnatomyViewer, SYSTEMS } from './AnatomyViewer.js';

// --- systems -------------------------------------------------------
export { buildAxialSkeleton, buildVertebra, buildRib, buildCranium, buildMandible, buildSternum, buildSacrum, buildCoccyx, spinalCurveZ, VERTEBRA_Y, vertebraRegion } from './systems/SkeletonAxial.js';
export {
  buildAppendicularSkeleton,
  buildClavicle, buildScapula, buildHumerus, buildRadius, buildUlna,
  buildFemur, buildTibia, buildFibula, buildPatella, buildHipBone,
  buildPhalanxUnit, buildMetacarpalUnit, buildShortBoneUnit,
  handDigitInstances, footDigitInstances,
  CARPAL_DEFS, TARSAL_DEFS, HAND_DIGITS, FOOT_DIGITS,
} from './systems/SkeletonAppendicular.js';
export { buildMuscularSystem, buildMuscle, buildDiaphragm, MUSCLES } from './systems/MuscularSystem.js';
export {
  buildOrganSystem, buildCerebrum, buildCerebellum, buildBrainstem, buildSpinalCord,
  buildHeart, buildLungLobe, buildBronchialTree, buildLiver, buildStomach,
  buildSpleen, buildPancreas, buildKidney, buildAdrenal, buildUreter,
  buildSmallIntestine, buildLargeIntestine, buildBladder, buildThyroid,
  buildOesophagus, buildGreatVessels,
} from './systems/OrganSystem.js';
export { buildSurfaceSystem, buildTrunkSurface, TRUNK_PROFILE } from './systems/SurfaceSystem.js';

// --- geometry core --------------------------------------------------
export { loft } from './core/loft.js';
export { computeParallelFrames } from './core/Frame.js';
export { superellipse, ellipse, circle, Lobed, Flared, Tapered, Biased, Bladed, compose } from './core/Profile.js';
export {
  spine, v3cm, tube, radial, superellipsoid, merge, toIndexed,
  mirrorX, bilateral, transformGeometry, triangleCount, extrudePlate,
} from './core/builders.js';

// --- parts & instancing ---------------------------------------------
export { makePart, makeStaticPart, partCentre, partBoundingSphere } from './core/Part.js';
export { makeInstancedPart, resolveInstance } from './core/InstancedPart.js';

// --- materials & textures -------------------------------------------
export { tissue, sharedTissue, TISSUE_COLORS, disposeMaterials, disposeMaterialCache } from './core/materials.js';
export { buildTissueMaps, valueNoise, fbm, heightField, normalMapFromHeight } from './core/textures.js';

// --- performance ------------------------------------------------------
export { QUALITY_TIERS, segs, buildLOD, setLODBias, countTriangles, countDrawCalls } from './core/quality.js';
export { PerformanceGovernor } from './core/Performance.js';

// --- reference data ---------------------------------------------------
export { REFERENCE_HEIGHT_CM, LANDMARKS, SEGMENTS, cm, cm3, cmArr } from './core/units.js';
