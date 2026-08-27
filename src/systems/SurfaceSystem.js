/**
 * SurfaceSystem.js — the body surface (integumentary reference layer).
 *
 * A single loft cannot represent a body, because the body branches: one trunk
 * becomes two legs, two arms, a head. So the surface is assembled from one loft
 * per unbranched region — head+neck+trunk, each arm, each leg, each foot — all in
 * the same skin material, so as a group they read as one body.
 *
 * The cross-sections are real anthropometry (breadth × depth at each landmark
 * height) rather than a smooth tube, which is why the model has shoulders, a
 * waist, an iliac flare and calves instead of looking like a mannequin turned on
 * a lathe.
 *
 * Its main job is to be *translucent*: at low opacity it gives the internal
 * systems a body to sit inside and makes depth legible, without hiding anything.
 */
import { Group, Vector3 } from 'three';
import { loft } from '../core/loft.js';
import { compose, superellipse, Tapered } from '../core/Profile.js';
import { merge, mirrorX, radial, spine } from '../core/builders.js';
import { segs } from '../core/quality.js';

/**
 * Interpolated cross-section table.
 * Each row is [y (cm), half-breadth (x, cm), half-depth (z, cm), squareness].
 * `squareness` 2 = ellipse (limbs); 3–4 = squarer (shoulders, pelvis).
 */
function sectionAt(table, y) {
  if (y >= table[0][0]) return table[0];
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i];
    const b = table[i + 1];
    if (y <= a[0] && y >= b[0]) {
      const t = (a[0] - y) / (a[0] - b[0] || 1);
      const s = t * t * (3 - 2 * t);
      return [
        y,
        a[1] + (b[1] - a[1]) * s,
        a[2] + (b[2] - a[2]) * s,
        a[3] + (b[3] - a[3]) * s,
      ];
    }
  }
  return table[table.length - 1];
}

/**
 * Head, neck and trunk as one surface.
 *
 * Breadths are the classic male reference values: biacromial 40 cm at the
 * acromion, chest breadth ~30 cm, waist ~28 cm, bicristal 29 cm at the iliac
 * crests, and a head 15 cm across.
 */
export const TRUNK_PROFILE = Object.freeze([
  [175.0, 0.8, 1.0, 2.0], // vertex
  [172.0, 6.2, 8.2, 2.2],
  [168.0, 7.4, 9.4, 2.2], // parietal eminence — widest part of the skull
  [163.0, 7.0, 9.2, 2.3],
  [157.0, 5.9, 8.0, 2.4],
  [152.0, 4.7, 6.6, 2.6], // menton (chin)
  [149.0, 5.3, 6.0, 2.6], // neck
  [145.0, 5.7, 6.2, 2.6],
  [143.0, 8.6, 8.0, 3.2], // shoulder girdle
  [138.0, 13.4, 10.6, 3.0], // deltoid line
  [130.0, 14.8, 11.0, 2.8], // nipple line — chest breadth ≈ 30 cm
  [121.0, 14.2, 10.6, 2.8], // xiphoid
  [112.0, 13.6, 10.2, 2.8],
  [105.0, 14.2, 10.6, 3.0], // umbilicus
  [100.0, 15.0, 11.0, 3.2], // iliac crests — bicristal ≈ 29 cm
  [95.0, 15.6, 11.4, 3.2], // greater trochanter line (widest)
  [90.0, 14.4, 10.9, 3.2], // pubic symphysis
  [86.0, 11.6, 9.8, 3.4],
  [82.0, 8.8, 8.2, 3.6], // perineum
]);

export function buildTrunkSurface(q = 1) {
  const top = TRUNK_PROFILE[0][0];
  const bottom = TRUNK_PROFILE[TRUNK_PROFILE.length - 1][0];
  const H = segs(64, q);
  return loft({
    spine: spine([
      [0, top, 0],
      [0, (top + bottom) / 2, 0.2],
      [0, bottom, 0],
    ]),
    profile: (_theta, t) => {
      const y = top + (bottom - top) * t;
      const [, b, d, n] = sectionAt(TRUNK_PROFILE, y);
      return superellipse(b, d, n)(_theta, t);
    },
    radialSegments: segs(48, q),
    heightSegments: H,
    // up = anterior ⇒ frame normal lands on x and binormal on z, so the first
    // profile axis is body BREADTH and the second is body DEPTH.
    up: new Vector3(0, 0, 1),
  });
}

/** Arm surface: shoulder → wrist, from anthropometric limb circumferences. */
export const ARM_PROFILE = Object.freeze([
  // t, half-breadth, half-depth
  [0.0, 5.0, 4.8], // deltoid
  [0.12, 4.5, 4.3],
  [0.3, 3.8, 3.6], // mid-arm
  [0.48, 3.2, 3.1], // above the elbow
  [0.52, 3.4, 3.3], // elbow
  [0.66, 3.0, 2.8], // proximal forearm
  [0.85, 2.3, 2.2],
  [1.0, 1.9, 1.6], // wrist
]);

export const buildArmSurface = (side, q = 1) => {
  const buildLeft = () =>
    loft({
      spine: spine([
        [18.4, 142.5, -0.2],
        [19.0, 134.0, 0.2],
        [19.3, 124.0, 0.3],
        [19.3, 111.0, 0.2], // elbow
        [20.2, 100.0, 0.8],
        [21.0, 89.0, 1.0], // wrist
      ]),
      profile: (theta, t) => {
        const row = sectionAt(ARM_PROFILE, t);
        return superellipse(row[1], row[2], 2.6)(theta, t);
      },
      radialSegments: segs(28, q),
      heightSegments: segs(40, q),
      up: new Vector3(0, 0, 1),
    });
  return side > 0 ? buildLeft() : mirrorX(buildLeft());
};

/** Leg surface: hip → ankle. */
export const LEG_PROFILE = Object.freeze([
  [0.0, 7.2, 7.8], // upper thigh
  [0.12, 6.5, 7.1],
  [0.26, 5.5, 5.9], // mid-thigh
  [0.42, 4.6, 5.0],
  [0.5, 4.0, 4.4], // knee
  [0.58, 3.8, 4.1], // calf — the gastrocnemius bulge
  [0.68, 3.3, 3.7],
  [0.82, 2.7, 3.1],
  [1.0, 2.2, 2.6], // ankle
]);

export const buildLegSurface = (side, q = 1) => {
  const buildLeft = () =>
    loft({
      spine: spine([
        [9.0, 90.0, 0.0],
        [9.3, 78.0, 0.4],
        [9.5, 64.0, 0.5],
        [9.4, 50.0, 0.6], // knee
        [8.9, 34.0, 0.2],
        [8.3, 18.0, 0.0],
        [8.2, 7.0, 0.0], // ankle
      ]),
      profile: (theta, t) => {
        const row = sectionAt(LEG_PROFILE, t);
        return superellipse(row[1], row[2], 2.6)(theta, t);
      },
      radialSegments: segs(28, q),
      heightSegments: segs(44, q),
      up: new Vector3(0, 0, 1),
    });
  return side > 0 ? buildLeft() : mirrorX(buildLeft());
};

/** Foot surface — a wedge from the heel to the toes. */
export const buildFootSurface = (side, q = 1) => {
  const buildLeft = () =>
    loft({
      spine: spine([
        [8.2, 4.0, -4.6], // heel
        [8.2, 2.4, -1.0],
        [8.0, 1.6, 5.0], // midfoot
        [7.8, 1.4, 12.0],
        [7.6, 1.3, 18.5], // toes
      ]),
      profile: compose(superellipse(3.6, 2.4, 2.8), Tapered(0.62, 0.5)),
      radialSegments: segs(24, q),
      heightSegments: segs(26, q),
      up: new Vector3(0, 1, 0),
    });
  return side > 0 ? buildLeft() : mirrorX(buildLeft());
};

/** Hand surface — a flattened plate with a thumb bulge. */
export const buildHandSurface = (side, q = 1) => {
  const buildLeft = () => {
    const palm = loft({
      spine: spine([
        [20.4, 87.0, 0.4],
        [21.0, 81.0, 1.0],
        [21.4, 76.0, 1.3],
        [21.6, 72.5, 1.4],
      ]),
      // Wide across the palm (x), thin anteroposteriorly (z).
      profile: compose(superellipse(3.7, 1.15, 3.2), Tapered(1, 0.82)),
      radialSegments: segs(20, q),
      heightSegments: segs(20, q),
      up: new Vector3(0, 0, 1),
    });
    const thumb = radial(
      (dir) => {
        const a = 1.2, b = 1.1, c = 3.0;
        return Math.pow(
          Math.pow(Math.abs(dir.x) / a, 2.2) + Math.pow(Math.abs(dir.y) / c, 2.2) + Math.pow(Math.abs(dir.z) / b, 2.2),
          -1 / 2.2,
        );
      },
      { widthSegments: segs(16, q), heightSegments: segs(12, q), centreCm: [24.4, 82.0, 6.0] },
    );
    return merge([palm, thumb]);
  };
  return side > 0 ? buildLeft() : mirrorX(buildLeft());
};

/**
 * Assemble the surface.
 *
 * @param {(def:object)=>import('three').Object3D} partFactory
 * @param {object} [opts]
 * @param {number} [opts.opacity=0.22] default skin opacity — deliberately ghostly
 *   so the systems underneath stay readable.
 */
export function buildSurfaceSystem(partFactory, { q = 1, opacity = 0.22 } = {}) {
  const root = new Group();
  root.name = 'body-surface';

  root.add(
    partFactory({
      id: 'surface.trunk', name: 'Body surface (head, neck and trunk)', latin: 'Integumentum commune',
      system: 'integumentary', region: 'surface',
      build: (qq) => buildTrunkSurface(qq),
      material: 'skin', distances: [0, 3.0, 6.0], q,
      opacity, castShadow: false, receiveShadow: false, renderOrder: 10,
      note: 'Anthropometric reference surface; ~1.8 m² of skin on the adult body.',
    }),
  );

  const limbDefs = [
    ['arm', 'Arm surface', 'Brachium et antebrachium', buildArmSurface, [0, 2.6, 5.0]],
    ['leg', 'Leg surface', 'Coxa et crus', buildLegSurface, [0, 2.6, 5.0]],
    ['foot', 'Foot surface', 'Pes', buildFootSurface, [0, 2.0, 4.0]],
    ['hand', 'Hand surface', 'Manus', buildHandSurface, [0, 2.0, 4.0]],
  ];
  for (const [key, name, latin, build, distances] of limbDefs) {
    for (const [sideName, s] of [['left', 1], ['right', -1]]) {
      root.add(
        partFactory({
          id: `surface.${key}.${sideName}`, name: `${name} (${sideName})`, latin,
          system: 'integumentary', region: 'surface',
          build: (qq) => build(s, qq),
          material: 'skin', distances, q,
          opacity, castShadow: false, receiveShadow: false, renderOrder: 10,
        }),
      );
    }
  }

  return root;
}

