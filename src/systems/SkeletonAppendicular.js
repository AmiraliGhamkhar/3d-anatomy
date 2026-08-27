/**
 * SkeletonAppendicular.js — the appendicular skeleton (126 bones).
 *
 *   pectoral girdle    4   (2 clavicles, 2 scapulae)
 *   upper limbs       60   (2 × [humerus, radius, ulna, 8 carpals,
 *                                  5 metacarpals, 14 phalanges])
 *   pelvic girdle      2   (2 hip bones; each is ilium + ischium + pubis, fused
 *                          in the adult, so it is delivered as one bone)
 *   lower limbs       60   (2 × [femur, patella, tibia, fibula, 7 tarsals,
 *                                  5 metatarsals, 14 phalanges])
 *
 * Bilateral structures are authored once for the subject's LEFT and mirrored
 * with `mirrorX` (which also reverses winding). Authoring a limb twice by hand is
 * the classic way to end up with a subtly asymmetric body.
 *
 * Landmark heights are the 175 cm reference values from units.js:
 *   acromion 143, elbow 110, wrist 88, greater trochanter 88, knee 48, ankle 7.
 */
import { Group, Vector3 } from 'three';
import { loft } from '../core/loft.js';
import { compose, superellipse, Flared, Tapered } from '../core/Profile.js';
import {
  extrudePlate,
  merge,
  mirrorX,
  spine,
  superellipsoid,
  transformGeometry,
  tube,
} from '../core/builders.js';
import { segs } from '../core/quality.js';

/** Wrap a left-only builder so it can be called with a side multiplier. */
const mirrored = (buildLeft) => (side, q) => (side > 0 ? buildLeft(q) : mirrorX(buildLeft(q)));

/* ================================================================== */
/* PECTORAL GIRDLE                                                     */
/* ================================================================== */

/**
 * Clavicle — a doubly-curved (S-shaped) strut, the only bony connection between
 * the axial skeleton and the upper limb. The medial two-thirds are convex
 * anteriorly and prismatic; the lateral third is flattened and concave anteriorly.
 * The `roll` term is what produces that twist along the bone.
 */
export const buildClavicle = mirrored((q = 1) => {
  const pts = [
    [1.6, 141.2, 7.0], // sternal (medial) end
    [4.8, 142.4, 8.0], // anterior convexity
    [8.6, 143.6, 6.6],
    [12.2, 143.8, 3.6],
    [14.9, 143.4, 1.0], // posterior concavity
    [16.8, 143.0, -0.8], // acromial (lateral) end
  ];
  return loft({
    spine: spine(pts),
    profile: compose(superellipse(0.78, 0.55, 3.6), Flared({ start: 0.35, end: 0.25, width: 0.22 })),
    // Twist the prismatic section so the medial face turns anterior and the
    // lateral end flattens into the acromion.
    roll: (t) => (t - 0.5) * 1.5,
    radialSegments: segs(14, q),
    heightSegments: segs(26, q),
    up: new Vector3(0, 1, 0),
  });
});

/**
 * Scapula — a flat triangular bone applied to the posterior thorax (ribs 2–7),
 * carrying the spine, acromion, coracoid process and glenoid cavity.
 *
 * The blade is an extruded outline rather than a loft: it is genuinely a plate
 * ~5 mm thick with a thickened border, and extruding the real outline is both
 * more faithful and an order of magnitude cheaper than a lofted approximation.
 */
export const buildScapula = mirrored((q = 1) => {
  // Outline relative to a pivot on the medial border, so the plate can be
  // rotated about the border into its oblique position on the rib cage.
  const blade = extrudePlate(
    [
      [0.0, 13.6], // superior angle
      [3.2, 12.4], // superior border
      [7.6, 10.4], // root of coracoid / glenoid neck
      [8.4, 8.4], // lateral border (axillary border)
      [3.6, -13.6], // inferior angle
      [0.4, -6.0], // medial (vertebral) border
      [-0.4, 2.0],
    ],
    0.55,
    { bevel: 0.16 },
  );
  transformGeometry(blade, { position: [8.4, 128.4, -5.0], rotation: [7, -27, 5] });

  // Spine of the scapula — the ridge crossing the posterior surface.
  const scapularSpine = loft({
    spine: spine([
      [8.0, 136.6, -6.1],
      [11.6, 138.4, -6.3],
      [15.0, 140.4, -5.4],
    ]),
    profile: compose(superellipse(0.55, 0.9, 3.4), Tapered(0.75, 1.15)),
    radialSegments: segs(10, q),
    heightSegments: segs(12, q),
    up: new Vector3(0, 1, 0),
  });

  // Acromion — the flattened lateral continuation of the spine (AC joint).
  const acromion = transformGeometry(
    superellipsoid([1.0, 0.45, 1.5], {
      n: 3.4, widthSegments: segs(14, q), heightSegments: segs(10, q),
    }),
    { position: [16.4, 142.6, -2.6], rotation: [0, -18, 0] },
  );

  // Coracoid process — the "crow's beak" projecting anterolaterally below the
  // clavicle; origin of the coracobrachialis and short head of biceps.
  const coracoid = tube(
    [
      [14.4, 139.6, -3.2],
      [15.4, 139.0, -0.4],
      [15.6, 138.4, 1.6],
    ],
    (t) => 0.62 * (1 - t * 0.35),
    { radialSegments: segs(10, q), heightSegments: segs(12, q) },
  );

  // Glenoid cavity rim — the shallow socket for the humeral head.
  const glenoid = transformGeometry(
    superellipsoid([0.55, 1.55, 1.15], {
      n: 2.8, widthSegments: segs(14, q), heightSegments: segs(10, q),
    }),
    { position: [16.9, 140.2, -1.4] },
  );

  return merge([blade, scapularSpine, acromion, coracoid, glenoid]);
});

/* ================================================================== */
/* UPPER LIMB                                                          */
/* ================================================================== */

/**
 * Humerus — the longest bone of the upper limb (~32 cm).
 * Hemispherical head set at an angle on the anatomical neck, greater and lesser
 * tubercles for the rotator cuff, deltoid tuberosity mid-shaft, and the distal
 * condylar block (capitulum + trochlea) with its two epicondyles.
 */
export const buildHumerus = mirrored((q = 1) => {
  const parts = [];

  // Shaft, from the surgical neck to the supracondylar region.
  parts.push(
    loft({
      spine: spine([
        [17.3, 137.0, 0.0],
        [17.9, 131.0, 0.2],
        [18.5, 124.0, 0.2],
        [18.9, 117.0, 0.1],
        [19.2, 113.5, 0.0],
      ]),
      profile: compose(superellipse(1.28, 1.22, 2.6), Flared({ start: 0.5, end: 0.55, width: 0.2 })),
      radialSegments: segs(16, q),
      heightSegments: segs(22, q),
      up: new Vector3(0, 0, 1),
    }),
  );

  // Head — a hemisphere inclined up and medially (~135° to the shaft).
  parts.push(
    transformGeometry(
      superellipsoid([2.5, 2.5, 2.5], {
        n: 2.0, widthSegments: segs(22, q), heightSegments: segs(16, q),
      }),
      { position: [15.9, 139.6, 0.3], scale: [0.82, 1, 1] },
    ),
  );

  // Greater tubercle — lateral; supraspinatus/infraspinatus/teres minor insert.
  parts.push(
    transformGeometry(
      superellipsoid([1.15, 1.5, 1.1], {
        n: 3.0, widthSegments: segs(14, q), heightSegments: segs(10, q),
      }),
      { position: [18.5, 137.9, -0.1], rotation: [0, 0, -14] },
    ),
  );
  // Lesser tubercle — anteromedial; subscapularis inserts.
  parts.push(
    transformGeometry(
      superellipsoid([0.7, 1.05, 0.85], {
        n: 3.0, widthSegments: segs(12, q), heightSegments: segs(8, q),
      }),
      { position: [16.4, 136.2, 1.7] },
    ),
  );

  // Deltoid tuberosity — the lateral V-shaped roughening at mid-shaft.
  parts.push(
    transformGeometry(
      superellipsoid([0.55, 1.5, 0.5], {
        n: 3.2, widthSegments: segs(10, q), heightSegments: segs(8, q),
      }),
      { position: [19.6, 127.5, 0.4], rotation: [0, 0, -8] },
    ),
  );

  // Distal condylar block.
  parts.push(
    transformGeometry(
      superellipsoid([1.55, 1.25, 1.5], {
        n: 2.6, widthSegments: segs(16, q), heightSegments: segs(12, q),
      }),
      { position: [19.2, 112.0, 0.1] },
    ),
  );
  // Medial and lateral epicondyles.
  for (const s of [1, -1]) {
    parts.push(
      transformGeometry(
        superellipsoid([0.5, 0.85, 0.75], {
          n: 2.8, widthSegments: segs(12, q), heightSegments: segs(8, q),
        }),
        { position: [19.2 + s * 1.75, 112.6, -0.1] },
      ),
    );
  }

  return merge(parts);
});

/**
 * Ulna — the medial bone of the forearm. The olecranon (elbow point) and the
 * coronoid process form the trochlear notch, which is what makes the elbow a
 * hinge. Distally it narrows to the head and styloid process.
 */
export const buildUlna = mirrored((q = 1) => {
  const parts = [];
  parts.push(
    loft({
      spine: spine([
        [18.6, 112.6, -1.6], // olecranon
        [18.3, 110.4, -0.2], // trochlear notch
        [18.6, 104.0, -0.2],
        [19.2, 97.0, -0.1],
        [19.8, 91.5, 0.0],
      ]),
      profile: compose(
        superellipse(0.92, 0.86, 3.0),
        Flared({ start: 0.9, width: 0.14 }),
        Tapered(1, 0.62),
      ),
      radialSegments: segs(14, q),
      heightSegments: segs(20, q),
      up: new Vector3(0, 0, 1),
    }),
  );
  // Styloid process of the ulna.
  parts.push(
    tube([[19.9, 91.8, -0.7], [20.1, 89.9, -0.9]], 0.28, {
      radialSegments: segs(8, q), heightSegments: segs(6, q),
    }),
  );
  return merge(parts);
});

/**
 * Radius — the lateral bone of the forearm. Small disc-like head proximally,
 * widening distally into the styloid process and the carpal articular surface.
 * It is the bone that crosses the ulna during pronation.
 */
export const buildRadius = mirrored((q = 1) => {
  const parts = [];
  parts.push(
    loft({
      spine: spine([
        [17.9, 110.4, 0.6], // head
        [18.4, 104.0, 0.8],
        [19.4, 97.0, 1.0],
        [20.4, 91.5, 1.0],
      ]),
      profile: compose(superellipse(0.72, 0.72, 2.6), Flared({ end: 1.5, width: 0.2 })),
      radialSegments: segs(14, q),
      heightSegments: segs(20, q),
      up: new Vector3(0, 0, 1),
    }),
  );
  // Radial styloid — extends further distally than the ulnar styloid.
  parts.push(
    tube([[20.8, 91.4, 0.6], [21.1, 89.4, 0.4]], 0.3, {
      radialSegments: segs(8, q), heightSegments: segs(6, q),
    }),
  );
  return merge(parts);
});

/**
 * Carpals — eight short bones in two rows.
 *
 *   proximal (lateral → medial): scaphoid, lunate, triquetrum, pisiform
 *   distal  (lateral → medial): trapezium, trapezoid, capitate, hamate
 *
 * They are drawn as one InstancedMesh of 8 — a shared superellipsoid scaled and
 * rotated per bone. At this size (1–2 cm) the individual silhouettes differ far
 * less than their arrangement does, and instancing turns 8 draw calls into 1.
 */
export const CARPAL_DEFS = Object.freeze([
  // id, latin, [x, y, z] cm, scale [x, y, z]
  { id: 'scaphoid', latin: 'Os scaphoideum', name: 'Scaphoid', pos: [21.0, 87.4, 0.9], scale: [1.35, 0.7, 0.85] },
  { id: 'lunate', latin: 'Os lunatum', name: 'Lunate', pos: [19.8, 87.3, 0.4], scale: [0.95, 0.65, 0.85] },
  { id: 'triquetrum', latin: 'Os triquetrum', name: 'Triquetrum', pos: [18.7, 87.2, -0.2], scale: [0.85, 0.65, 0.8] },
  { id: 'pisiform', latin: 'Os pisiforme', name: 'Pisiform', pos: [18.2, 86.6, -1.1], scale: [0.55, 0.5, 0.55] },
  { id: 'trapezium', latin: 'Os trapezium', name: 'Trapezium', pos: [21.4, 85.8, 1.0], scale: [0.95, 0.7, 0.85] },
  { id: 'trapezoid', latin: 'Os trapezoideum', name: 'Trapezoid', pos: [20.3, 85.7, 0.7], scale: [0.75, 0.6, 0.75] },
  { id: 'capitate', latin: 'Os capitatum', name: 'Capitate', pos: [19.3, 85.6, 0.2], scale: [0.9, 0.9, 0.85] },
  { id: 'hamate', latin: 'Os hamatum', name: 'Hamate', pos: [18.3, 85.7, -0.4], scale: [0.95, 0.8, 0.85] },
]);

/**
 * The five digits of the hand, each as a chain of collinear segments.
 *
 * Segment lengths follow the real digital proportions (proximal ≈ 50 %, middle
 * ≈ 30 %, distal ≈ 20 % of the digit), and every segment after the first starts
 * exactly where the previous one ends, so the metacarpal and the three phalanges
 * of a finger form one continuous line rather than four floating bones.
 *
 * `origin` is the carpometacarpal joint; `dir` is the (unnormalised) bone axis.
 * The thumb axis is deliberately oblique and anterior — that is what makes it
 * opposable.
 */
export const HAND_DIGITS = Object.freeze([
  {
    id: 'i', finger: 'Thumb', latin: 'pollicis', greek: 'I',
    origin: [22.6, 85.6, 1.6], dir: [0.34, -0.30, 0.89],
    metacarpal: 4.8,
    phalanges: [
      { seg: 'proximal', len: 3.2 },
      { seg: 'distal', len: 2.6 },
    ],
  },
  {
    id: 'ii', finger: 'Index', latin: 'indicis', greek: 'II',
    origin: [22.2, 85.2, 1.0], dir: [0.10, -0.99, 0.06],
    metacarpal: 7.4,
    phalanges: [
      { seg: 'proximal', len: 3.8 },
      { seg: 'middle', len: 2.4 },
      { seg: 'distal', len: 1.9 },
    ],
  },
  {
    id: 'iii', finger: 'Middle', latin: 'medii', greek: 'III',
    origin: [20.9, 85.1, 0.6], dir: [0.02, -0.998, 0.04],
    metacarpal: 7.8,
    phalanges: [
      { seg: 'proximal', len: 4.2 },
      { seg: 'middle', len: 2.6 },
      { seg: 'distal', len: 2.0 },
    ],
  },
  {
    id: 'iv', finger: 'Ring', latin: 'anularis', greek: 'IV',
    origin: [19.6, 85.0, 0.2], dir: [-0.05, -0.995, 0.02],
    metacarpal: 7.1,
    phalanges: [
      { seg: 'proximal', len: 3.8 },
      { seg: 'middle', len: 2.3 },
      { seg: 'distal', len: 1.8 },
    ],
  },
  {
    id: 'v', finger: 'Little', latin: 'minimi', greek: 'V',
    origin: [18.5, 85.1, -0.3], dir: [-0.15, -0.98, -0.02],
    metacarpal: 6.2,
    phalanges: [
      { seg: 'proximal', len: 3.0 },
      { seg: 'middle', len: 1.8 },
      { seg: 'distal', len: 1.5 },
    ],
  },
]);

/** Unit phalanx: a 1 cm-long bone along +Y, to be scaled per instance. */
export function buildPhalanxUnit(q = 1) {
  return loft({
    spine: spine([[0, 0, 0], [0, 0.5, 0], [0, 1, 0]]),
    profile: compose(superellipse(0.34, 0.3, 3.0), Flared({ start: 0.5, end: 0.55, width: 0.26 })),
    radialSegments: segs(10, q),
    heightSegments: segs(8, q),
    up: new Vector3(1, 0, 0),
  });
}

/** Unit metacarpal: 1 cm along +Y with a rounded head distally. */
export function buildMetacarpalUnit(q = 1) {
  return loft({
    spine: spine([[0, 0, 0], [0, 0.5, 0.06], [0, 1, 0]]),
    profile: compose(superellipse(0.42, 0.36, 3.2), Flared({ start: 0.25, end: 0.7, width: 0.2 })),
    radialSegments: segs(10, q),
    heightSegments: segs(10, q),
    up: new Vector3(1, 0, 0),
  });
}

/** Unit carpal / tarsal: a 1 cm superellipsoid blob scaled per instance. */
export function buildShortBoneUnit(q = 1) {
  return superellipsoid([0.5, 0.5, 0.5], {
    n: 3.0, widthSegments: segs(12, q), heightSegments: segs(8, q),
  });
}

/** Advance `p` along `dir` by `len` cm, returning a new array. */
const advance = (p, dir, len) => [p[0] + dir[0] * len, p[1] + dir[1] * len, p[2] + dir[2] * len];

/**
 * Instance descriptors for one hand's 5 metacarpals and 14 phalanges.
 * @param {number} side +1 subject's left / -1 subject's right
 */
export function handDigitInstances(side = 1) {
  const metacarpals = [];
  const phalanges = [];
  const sideName = side > 0 ? 'left' : 'right';

  for (const d of HAND_DIGITS) {
    // Mirror about x = 0 for the subject's right side.
    const dir = [side * d.dir[0], d.dir[1], d.dir[2]];
    const origin = [side * d.origin[0], d.origin[1], d.origin[2]];

    metacarpals.push({
      id: `metacarpal.${d.greek.toLowerCase()}.${sideName}`,
      name: `Metacarpal ${d.greek} (${sideName})`,
      latin: `Os metacarpi ${d.greek}`,
      note: `Metacarpal of the ${d.finger.toLowerCase()} digit — ${d.metacarpal.toFixed(1)} cm.`,
      position: origin,
      direction: dir,
      scale: [1, d.metacarpal, 1],
    });

    let p = advance(origin, dir, d.metacarpal);
    const names = { proximal: 'proximalis', middle: 'media', distal: 'distalis' };
    for (const ph of d.phalanges) {
      phalanges.push({
        id: `phalanx.${d.id}-${ph.seg}.${sideName}`,
        name: `${ph.seg[0].toUpperCase()}${ph.seg.slice(1)} phalanx, ${d.finger.toLowerCase()} finger (${sideName})`,
        latin: `Phalanx ${names[ph.seg]} digiti ${d.latin}`,
        note: `${d.finger} finger ${ph.seg} phalanx — ${ph.len.toFixed(1)} cm.`,
        position: p,
        direction: dir,
        scale: [1, ph.len, 1],
      });
      p = advance(p, dir, ph.len);
    }
  }
  return { metacarpals, phalanges };
}

/* ================================================================== */
/* PELVIC GIRDLE                                                       */
/* ================================================================== */

/**
 * Hip bone (os coxae) — ilium, ischium and pubis, fused in the adult.
 *
 * The iliac ala is a broad curved plate (extruded outline), the acetabulum is the
 * deep socket at the junction of all three, the ischium forms the posterior-inferior
 * bar with its tuberosity, and the pubis runs anteromedially to meet its
 * partner at the pubic symphysis. The obturator foramen is the large hole between
 * ischium and pubis — left open, because it is one of the most recognisable
 * features of the pelvis.
 */
export const buildHipBone = mirrored((q = 1) => {
  const parts = [];

  // --- iliac ala: broad curved plate -------------------------------
  const ala = extrudePlate(
    [
      [0.0, 0.0], // iliac crest, medial end
      [2.6, 1.6],
      [5.4, 2.2], // iliac tubercle / crest summit
      [8.0, 1.4],
      [9.4, -0.6], // ASIS region
      [8.6, -4.6],
      [6.0, -8.4], // towards the acetabulum
      [2.4, -8.0],
      [0.4, -5.6], // posterior inferior iliac spine
      [-1.4, -2.0],
    ],
    0.85,
    { bevel: 0.2 },
  );
  transformGeometry(ala, { position: [9.6, 99.5, -0.6], rotation: [12, -18, -6] });
  parts.push(ala);

  // --- acetabulum: the socket --------------------------------------
  parts.push(
    transformGeometry(
      superellipsoid([1.5, 2.4, 2.3], {
        n: 2.6, widthSegments: segs(18, q), heightSegments: segs(14, q),
      }),
      { position: [10.4, 89.2, 0.0] },
    ),
  );

  // --- ischium: posterior inferior body + tuberosity ----------------
  parts.push(
    loft({
      spine: spine([
        [9.6, 87.6, -0.4],
        [9.2, 84.0, -1.6],
        [8.6, 81.0, -2.2],
      ]),
      profile: compose(superellipse(1.5, 1.5, 3.0), Tapered(1, 0.85)),
      radialSegments: segs(14, q),
      heightSegments: segs(10, q),
      up: new Vector3(1, 0, 0),
    }),
  );
  parts.push(
    transformGeometry(
      superellipsoid([1.4, 1.0, 1.5], {
        n: 3.0, widthSegments: segs(14, q), heightSegments: segs(10, q),
      }),
      { position: [8.4, 80.2, -2.4] },
    ),
  );
  // Ischiopubic ramus.
  parts.push(
    loft({
      spine: spine([
        [8.6, 81.0, -2.0],
        [7.0, 79.8, -0.2],
        [5.0, 79.4, 2.2],
        [3.0, 79.6, 3.8],
      ]),
      profile: compose(superellipse(0.95, 0.85, 3.2), Tapered(1, 0.8)),
      radialSegments: segs(12, q),
      heightSegments: segs(14, q),
      up: new Vector3(0, 1, 0),
    }),
  );

  // --- pubis: superior ramus to the symphysis ----------------------
  parts.push(
    loft({
      spine: spine([
        [7.2, 83.6, 2.2],
        [4.6, 84.6, 4.6],
        [2.0, 85.2, 5.6],
        [0.5, 85.4, 5.9],
      ]),
      profile: compose(superellipse(0.85, 0.75, 3.2), Tapered(1.1, 0.9)),
      radialSegments: segs(12, q),
      heightSegments: segs(14, q),
      up: new Vector3(0, 1, 0),
    }),
  );
  // Pubic body at the symphysis.
  parts.push(
    transformGeometry(
      superellipsoid([0.85, 1.3, 0.9], {
        n: 3.0, widthSegments: segs(12, q), heightSegments: segs(10, q),
      }),
      { position: [0.5, 85.0, 6.0] },
    ),
  );

  return merge(parts);
});

/* ================================================================== */
/* LOWER LIMB                                                          */
/* ================================================================== */

/**
 * Femur — the longest and strongest bone (~43 cm in this body).
 * The head sits on a neck inclined about 125° to the shaft, the greater
 * trochanter projects superolaterally, the lesser posteromedially, and the shaft
 * bows slightly anteriorly. Distally the two condyles are separated by the
 * intercondylar fossa.
 */
export const buildFemur = mirrored((q = 1) => {
  const parts = [];

  // Shaft with a slight anterior bow (the linea aspera runs along the back).
  parts.push(
    loft({
      spine: spine([
        [10.0, 84.5, -0.4],
        [9.9, 76.0, 0.4],
        [9.7, 67.0, 0.7],
        [9.6, 58.0, 0.5],
        [9.5, 51.0, 0.3],
      ]),
      profile: compose(superellipse(1.42, 1.36, 2.6), Flared({ start: 0.55, end: 0.9, width: 0.18 })),
      radialSegments: segs(16, q),
      heightSegments: segs(24, q),
      up: new Vector3(0, 0, 1),
    }),
  );

  // Neck — inclined up and medially.
  parts.push(
    loft({
      spine: spine([
        [10.2, 85.0, -0.3],
        [9.8, 86.8, -0.2],
        [9.3, 87.9, -0.1],
      ]),
      profile: compose(superellipse(1.05, 1.0, 2.8), Tapered(1.25, 0.8)),
      radialSegments: segs(14, q),
      heightSegments: segs(8, q),
      up: new Vector3(0, 0, 1),
    }),
  );

  // Head — about two-thirds of a sphere, fitting the acetabulum.
  parts.push(
    transformGeometry(
      superellipsoid([2.45, 2.45, 2.45], {
        n: 2.0, widthSegments: segs(22, q), heightSegments: segs(16, q),
      }),
      { position: [8.6, 88.4, -0.1], scale: [1, 0.95, 1] },
    ),
  );

  // Greater trochanter.
  parts.push(
    transformGeometry(
      superellipsoid([1.3, 1.7, 1.35], {
        n: 3.0, widthSegments: segs(14, q), heightSegments: segs(10, q),
      }),
      { position: [11.3, 88.4, -0.7], rotation: [0, 0, -10] },
    ),
  );
  // Lesser trochanter.
  parts.push(
    transformGeometry(
      superellipsoid([0.85, 1.15, 0.9], {
        n: 3.0, widthSegments: segs(12, q), heightSegments: segs(8, q),
      }),
      { position: [8.2, 83.6, -1.9] },
    ),
  );

  // Distal condyles.
  for (const s of [1, -1]) {
    parts.push(
      transformGeometry(
        superellipsoid([1.35, 2.1, 2.3], {
          n: 2.4, widthSegments: segs(16, q), heightSegments: segs(12, q),
        }),
        { position: [9.5 + s * 1.35, 49.6, 0.6] },
      ),
    );
  }

  return merge(parts);
});

/** Patella — the largest sesamoid bone, embedded in the quadriceps tendon. */
export const buildPatella = mirrored((q = 1) =>
  transformGeometry(
    superellipsoid([1.25, 1.55, 0.85], {
      n: 2.8, widthSegments: segs(18, q), heightSegments: segs(14, q),
    }),
    { position: [9.5, 50.6, 2.7], rotation: [6, 0, 0] },
  ),
);

/**
 * Tibia — the weight-bearing bone of the leg. Broad proximal condyles, a sharp
 * anterior border (the "shin"), and the medial malleolus distally.
 */
export const buildTibia = mirrored((q = 1) => {
  const parts = [];
  parts.push(
    loft({
      spine: spine([
        [8.6, 47.0, 0.2],
        [8.4, 38.0, 0.2],
        [8.2, 28.0, 0.1],
        [8.0, 17.0, 0.0],
        [7.9, 9.0, 0.0],
      ]),
      profile: compose(superellipse(1.15, 1.1, 3.4), Flared({ start: 1.1, width: 0.12 }), Tapered(1, 0.72)),
      radialSegments: segs(14, q),
      heightSegments: segs(24, q),
      up: new Vector3(0, 0, 1),
    }),
  );
  // Proximal condylar plateau.
  parts.push(
    transformGeometry(
      superellipsoid([2.1, 1.15, 2.2], {
        n: 2.8, widthSegments: segs(16, q), heightSegments: segs(10, q),
      }),
      { position: [8.6, 47.6, 0.2] },
    ),
  );
  // Tibial tuberosity — patellar ligament insertion.
  parts.push(
    transformGeometry(
      superellipsoid([0.7, 1.0, 0.6], {
        n: 3.0, widthSegments: segs(10, q), heightSegments: segs(8, q),
      }),
      { position: [8.7, 44.4, 2.0] },
    ),
  );
  // Medial malleolus.
  parts.push(
    tube([[7.9, 9.4, 0.0], [7.3, 7.4, -0.2]], 0.62, {
      radialSegments: segs(10, q), heightSegments: segs(8, q),
    }),
  );
  return merge(parts);
});

/**
 * Fibula — the slender lateral bone. It bears almost no weight; its head
 * articulates with the tibia and its distal end forms the lateral malleolus,
 * which extends further distally than the medial one.
 */
export const buildFibula = mirrored((q = 1) => {
  const parts = [];
  parts.push(
    loft({
      spine: spine([
        [10.4, 46.4, -0.4],
        [10.2, 36.0, -0.3],
        [9.8, 25.0, -0.3],
        [9.4, 15.0, -0.3],
        [9.2, 9.0, -0.4],
      ]),
      profile: compose(superellipse(0.55, 0.52, 3.4), Flared({ start: 0.6, width: 0.1 }), Tapered(1, 0.8)),
      radialSegments: segs(10, q),
      heightSegments: segs(22, q),
      up: new Vector3(0, 0, 1),
    }),
  );
  // Fibular head.
  parts.push(
    transformGeometry(
      superellipsoid([0.95, 0.95, 0.95], {
        n: 2.8, widthSegments: segs(12, q), heightSegments: segs(10, q),
      }),
      { position: [10.4, 47.2, -0.4] },
    ),
  );
  // Lateral malleolus.
  parts.push(
    tube([[9.2, 9.2, -0.4], [9.0, 6.4, -0.5]], 0.6, {
      radialSegments: segs(10, q), heightSegments: segs(8, q),
    }),
  );
  return merge(parts);
});

/**
 * Tarsals — seven bones. Talus and calcaneus are the large proximal pair; the
 * navicular, cuboid and three cuneiforms form the midfoot and, with the
 * metatarsals, the longitudinal and transverse arches.
 */
export const TARSAL_DEFS = Object.freeze([
  { id: 'talus', latin: 'Talus', name: 'Talus', pos: [8.2, 5.6, -0.2], scale: [1.5, 1.0, 1.7] },
  { id: 'calcaneus', latin: 'Calcaneus', name: 'Calcaneus', pos: [8.2, 3.4, -2.8], scale: [1.5, 1.6, 2.7] },
  { id: 'navicular', latin: 'Os naviculare', name: 'Navicular', pos: [7.4, 4.2, 2.2], scale: [1.2, 0.85, 0.8] },
  { id: 'cuboid', latin: 'Os cuboideum', name: 'Cuboid', pos: [9.7, 3.8, 2.4], scale: [1.0, 0.9, 1.0] },
  { id: 'medial-cuneiform', latin: 'Os cuneiforme mediale', name: 'Medial cuneiform', pos: [6.6, 4.0, 3.6], scale: [0.95, 1.05, 1.0] },
  { id: 'intermediate-cuneiform', latin: 'Os cuneiforme intermedium', name: 'Intermediate cuneiform', pos: [7.8, 4.0, 3.7], scale: [0.65, 0.9, 0.9] },
  { id: 'lateral-cuneiform', latin: 'Os cuneiforme laterale', name: 'Lateral cuneiform', pos: [8.8, 4.0, 3.6], scale: [0.8, 0.85, 0.9] },
]);

/**
 * The five toes as segment chains, exactly as for the hand.
 * The great toe has only two phalanges; toes II–V have three.
 */
export const FOOT_DIGITS = Object.freeze([
  {
    id: 'i', toe: 'Great', greek: 'I',
    origin: [6.9, 3.6, 8.2], dir: [0.02, -0.10, 0.995],
    metatarsal: 6.2,
    phalanges: [ { seg: 'proximal', len: 3.0 }, { seg: 'distal', len: 2.2 } ],
  },
  {
    id: 'ii', toe: 'Second', greek: 'II',
    origin: [8.1, 3.6, 8.2], dir: [0.0, -0.13, 0.99],
    metatarsal: 7.0,
    phalanges: [ { seg: 'proximal', len: 2.2 }, { seg: 'middle', len: 1.4 }, { seg: 'distal', len: 1.1 } ],
  },
  {
    id: 'iii', toe: 'Third', greek: 'III',
    origin: [9.0, 3.6, 8.1], dir: [0.0, -0.13, 0.99],
    metatarsal: 6.6,
    phalanges: [ { seg: 'proximal', len: 2.0 }, { seg: 'middle', len: 1.3 }, { seg: 'distal', len: 1.0 } ],
  },
  {
    id: 'iv', toe: 'Fourth', greek: 'IV',
    origin: [9.8, 3.5, 7.9], dir: [0.0, -0.14, 0.99],
    metatarsal: 6.0,
    phalanges: [ { seg: 'proximal', len: 1.7 }, { seg: 'middle', len: 1.1 }, { seg: 'distal', len: 0.95 } ],
  },
  {
    id: 'v', toe: 'Little', greek: 'V',
    origin: [10.5, 3.4, 7.4], dir: [0.03, -0.16, 0.985],
    metatarsal: 5.4,
    phalanges: [ { seg: 'proximal', len: 1.4 }, { seg: 'middle', len: 0.9 }, { seg: 'distal', len: 0.85 } ],
  },
]);

/**
 * Instance descriptors for one foot's 5 metatarsals and 14 toe phalanges.
 * @param {number} side +1 subject's left / -1 subject's right
 */
export function footDigitInstances(side = 1) {
  const metatarsals = [];
  const phalanges = [];
  const sideName = side > 0 ? 'left' : 'right';

  for (const d of FOOT_DIGITS) {
    const dir = [side * d.dir[0], d.dir[1], d.dir[2]];
    const origin = [side * d.origin[0], d.origin[1], d.origin[2]];

    metatarsals.push({
      id: `metatarsal.${d.greek.toLowerCase()}.${sideName}`,
      name: `Metatarsal ${d.greek} (${sideName})`,
      latin: `Os metatarsi ${d.greek}`,
      note: `Metatarsal of the ${d.toe.toLowerCase()} toe — ${d.metatarsal.toFixed(1)} cm.`,
      position: origin,
      direction: dir,
      scale: [1, d.metatarsal, 1],
    });

    let p = advance(origin, dir, d.metatarsal);
    const names = { proximal: 'proximalis', middle: 'media', distal: 'distalis' };
    for (const ph of d.phalanges) {
      phalanges.push({
        id: `toe-phalanx.${d.id}-${ph.seg}.${sideName}`,
        name: `${ph.seg[0].toUpperCase()}${ph.seg.slice(1)} phalanx, ${d.toe.toLowerCase()} toe (${sideName})`,
        latin: `Phalanx ${names[ph.seg]} digiti pedis ${d.greek}`,
        note: `${d.toe} toe ${ph.seg} phalanx — ${ph.len.toFixed(1)} cm.`,
        position: p,
        direction: dir,
        scale: [1, ph.len, 1],
      });
      p = advance(p, dir, ph.len);
    }
  }
  return { metatarsals, phalanges };
}

/**
 * Assembly.
 *
 * Node hierarchy mirrors the anatomical grouping so that hiding "upper limb" or
 * "pelvic girdle" is a single visibility toggle on one node:
 *
 *   appendicular
 *   ├── pectoral-girdle
 *   ├── upper-limb/{left,right}/{arm,forearm,hand}
 *   ├── pelvic-girdle
 *   └── lower-limb/{left,right}/{thigh,leg,foot}
 */
export function buildAppendicularSkeleton(partFactory, instancedFactory, { q = 1 } = {}) {
  const app = new Group();
  app.name = 'appendicular-skeleton';
  const S = { system: 'skeletal', region: 'appendicular' };

  const addSide = (parentGroup, id, name, latin, build, note, distances = [0, 1.8, 3.4, 6.0]) => {
    for (const [sideName, s] of [['left', 1], ['right', -1]]) {
      parentGroup.add(
        partFactory({
          id: `${id}.${sideName}`,
          name: `${name} (${sideName})`,
          latin,
          ...S,
          build: (qq) => build(s, qq),
          material: 'corticalBone',
          distances,
          q,
          note,
        }),
      );
    }
  };

  /* --- pectoral girdle --------------------------------------------- */
  const pectoral = new Group();
  pectoral.name = 'pectoral-girdle';
  addSide(pectoral, 'clavicle', 'Clavicle', 'Clavicula', buildClavicle, 'Only bony link between the axial skeleton and the arm.', [0, 2.0, 4.0]);
  addSide(pectoral, 'scapula', 'Scapula', 'Scapula', buildScapula, 'Shoulder blade; carries the glenoid cavity.', [0, 2.0, 4.0]);
  app.add(pectoral);

  /* --- upper limbs --------------------------------------------------- */
  const upper = new Group();
  upper.name = 'upper-limb';
  for (const [sideName, s] of [['left', 1], ['right', -1]]) {
    const limb = new Group();
    limb.name = `upper-limb.${sideName}`;

    const arm = new Group();
    arm.name = 'arm';
    arm.add(
      partFactory({
        id: `humerus.${sideName}`, name: `Humerus (${sideName})`, latin: 'Humerus', ...S,
        build: (qq) => buildHumerus(s, qq), material: 'corticalBone',
        distances: [0, 1.8, 3.4, 6.0], q, note: 'Bone of the arm; head articulates with the scapula.',
      }),
    );
    limb.add(arm);

    const forearm = new Group();
    forearm.name = 'forearm';
    forearm.add(
      partFactory({
        id: `radius.${sideName}`, name: `Radius (${sideName})`, latin: 'Radius', ...S,
        build: (qq) => buildRadius(s, qq), material: 'corticalBone',
        distances: [0, 1.8, 3.4, 6.0], q, note: 'Lateral forearm bone; crosses the ulna in pronation.',
      }),
    );
    forearm.add(
      partFactory({
        id: `ulna.${sideName}`, name: `Ulna (${sideName})`, latin: 'Ulna', ...S,
        build: (qq) => buildUlna(s, qq), material: 'corticalBone',
        distances: [0, 1.8, 3.4, 6.0], q, note: 'Medial forearm bone; the olecranon is the elbow point.',
      }),
    );
    limb.add(forearm);

    const hand = new Group();
    hand.name = 'hand';
    const digits = handDigitInstances(s);
    hand.add(
      instancedFactory({
        id: `carpals.${sideName}`, name: `Carpal bones (${sideName})`, latin: 'Ossa carpi',
        ...S, region: 'appendicular-hand',
        build: buildShortBoneUnit, material: 'corticalBone', q,
        instances: CARPAL_DEFS.map((c) => ({
          id: `carpal.${c.id}.${sideName}`, name: `${c.name} (${sideName})`, latin: c.latin,
          note: 'One of the eight carpal bones of the wrist.',
          position: [s * c.pos[0], c.pos[1], c.pos[2]], scale: c.scale,
        })),
      }),
    );
    hand.add(
      instancedFactory({
        id: `metacarpals.${sideName}`, name: `Metacarpals (${sideName})`, latin: 'Ossa metacarpi',
        ...S, region: 'appendicular-hand',
        build: buildMetacarpalUnit, material: 'corticalBone', q,
        instances: digits.metacarpals,
      }),
    );
    hand.add(
      instancedFactory({
        id: `phalanges.${sideName}`, name: `Phalanges of the ${sideName} hand`, latin: 'Phalanges manus',
        ...S, region: 'appendicular-hand',
        build: buildPhalanxUnit, material: 'corticalBone', q,
        instances: digits.phalanges,
      }),
    );
    limb.add(hand);
    upper.add(limb);
  }
  app.add(upper);

  /* --- pelvic girdle -------------------------------------------------- */
  const pelvis = new Group();
  pelvis.name = 'pelvic-girdle';
  addSide(pelvis, 'hip-bone', 'Hip bone', 'Os coxae', buildHipBone, 'Ilium, ischium and pubis, fused in the adult.', [0, 1.8, 3.4]);
  app.add(pelvis);

  /* --- lower limbs ------------------------------------------------------ */
  const lower = new Group();
  lower.name = 'lower-limb';
  for (const [sideName, s] of [['left', 1], ['right', -1]]) {
    const limb = new Group();
    limb.name = `lower-limb.${sideName}`;

    const thigh = new Group();
    thigh.name = 'thigh';
    thigh.add(
      partFactory({
        id: `femur.${sideName}`, name: `Femur (${sideName})`, latin: 'Os femoris', ...S,
        build: (qq) => buildFemur(s, qq), material: 'corticalBone',
        distances: [0, 1.8, 3.4, 6.0], q, note: 'Longest and strongest bone of the body.',
      }),
    );
    thigh.add(
      partFactory({
        id: `patella.${sideName}`, name: `Patella (${sideName})`, latin: 'Patella', ...S,
        build: (qq) => buildPatella(s, qq), material: 'corticalBone',
        distances: [0, 1.8, 3.4], q, note: 'Largest sesamoid bone; sits in the quadriceps tendon.',
      }),
    );
    limb.add(thigh);

    const leg = new Group();
    leg.name = 'leg';
    leg.add(
      partFactory({
        id: `tibia.${sideName}`, name: `Tibia (${sideName})`, latin: 'Tibia', ...S,
        build: (qq) => buildTibia(s, qq), material: 'corticalBone',
        distances: [0, 1.8, 3.4, 6.0], q, note: 'Weight-bearing bone of the leg; the shin.',
      }),
    );
    leg.add(
      partFactory({
        id: `fibula.${sideName}`, name: `Fibula (${sideName})`, latin: 'Fibula', ...S,
        build: (qq) => buildFibula(s, qq), material: 'corticalBone',
        distances: [0, 1.8, 3.4, 6.0], q, note: 'Slender lateral bone; forms the lateral malleolus.',
      }),
    );
    limb.add(leg);

    const foot = new Group();
    foot.name = 'foot';
    const toes = footDigitInstances(s);
    foot.add(
      instancedFactory({
        id: `tarsals.${sideName}`, name: `Tarsal bones (${sideName})`, latin: 'Ossa tarsi',
        ...S, region: 'appendicular-foot',
        build: buildShortBoneUnit, material: 'corticalBone', q,
        instances: TARSAL_DEFS.map((t) => ({
          id: `tarsal.${t.id}.${sideName}`, name: `${t.name} (${sideName})`, latin: t.latin,
          note: 'One of the seven tarsal bones of the foot.',
          position: [s * t.pos[0], t.pos[1], t.pos[2]], scale: t.scale,
        })),
      }),
    );
    foot.add(
      instancedFactory({
        id: `metatarsals.${sideName}`, name: `Metatarsals (${sideName})`, latin: 'Ossa metatarsi',
        ...S, region: 'appendicular-foot',
        build: buildMetacarpalUnit, material: 'corticalBone', q,
        instances: toes.metatarsals,
      }),
    );
    foot.add(
      instancedFactory({
        id: `toe-phalanges.${sideName}`, name: `Phalanges of the ${sideName} foot`, latin: 'Phalanges pedis',
        ...S, region: 'appendicular-foot',
        build: buildPhalanxUnit, material: 'corticalBone', q,
        instances: toes.phalanges,
      }),
    );
    limb.add(foot);
    lower.add(limb);
  }
  app.add(lower);

  return app;
}
