/**
 * units.js — unit convention for the whole project.
 *
 * Scene unit = 1 metre. All *anatomical data* in this project is authored in
 * centimetres because that is how anatomy is published (Gray's, Netter, Winter's
 * segment anthropometry). Every data module expresses lengths in cm and converts
 * at the boundary with `cm()`, so no scene-space magic numbers leak into the
 * anatomical definitions.
 *
 * Reference body: adult male, 175 cm standing height, feet on the ground plane
 * (y = 0), standard anatomical position (anterior = +z, left of subject = -x).
 */

export const REFERENCE_HEIGHT_CM = 175;

/** Convert a length in centimetres to scene units (metres). */
export const cm = (v) => v * 0.01;

/** Convert a [x,y,z] triple of centimetres to a scene-unit array. */
export const cm3 = ([x, y, z]) => [x * 0.01, y * 0.01, z * 0.01];

/** Scale every element of an array of cm values. */
export const cmArr = (a) => a.map(cm);

/**
 * Standard anatomical landmark heights (cm above the ground) for the 175 cm
 * reference body. Derived from Winter, *Biomechanics and Motor Control of Human
 * Movement* (segment endpoints) and Drillis & Contini anthropometry.
 */
export const LANDMARKS = Object.freeze({
  vertex: 175.0, // top of skull
  trichion: 165.0, // hairline
  glabella: 160.5,
  menton: 152.0, // chin
  cricoid: 144.0,
  acromion: 143.0, // shoulder tip
  sternalNotch: 140.5,
  xiphoid: 121.0,
  elbow: 110.0, // olecranon / cubital crease
  umbilicus: 105.0,
  iliacCrest: 105.0,
  asis: 100.0, // anterior superior iliac spine
  pubis: 90.0, // pubic symphysis
  greaterTrochanter: 88.0,
  wrist: 88.0, // radial styloid
  knee: 48.0, // lateral joint line
  ankle: 7.0, // medial malleolus
  fingertip: 69.5, // middle-finger tip: hand length ≈ 19 cm below the wrist
  footToe: 0.0,
});

/**
 * Segment lengths (cm) for the reference body.
 * Sum of shank + thigh + pelvis + trunk + neck + head ≈ standing height.
 */
export const SEGMENTS = Object.freeze({
  head: 23.0, // vertex → menton
  neck: 9.0,
  trunk: 62.0, // sternal notch → pubis
  upperArm: 32.0, // acromion → elbow
  forearm: 26.0, // elbow → wrist
  hand: 19.0, // wrist → middle fingertip
  thigh: 40.0, // greater trochanter → knee
  shank: 41.0, // knee → ankle
  foot: 27.0, // heel → toe tip
  biacromial: 40.0, // shoulder breadth
  bicristal: 29.0, // iliac crest breadth
});
