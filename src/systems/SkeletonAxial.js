/**
 * SkeletonAxial.js — the axial skeleton (80 bones).
 *
 *   skull 22 (8 cranial + 14 facial) + 6 auditory ossicles + 1 hyoid
 *   vertebral column 26 (7 cervical, 12 thoracic, 5 lumbar, sacrum, coccyx)
 *   thoracic cage 25 (sternum + 12 pairs of ribs)
 *
 * Coordinate convention used throughout the project:
 *   x+ = subject's LEFT,  y+ = SUPERIOR,  z+ = ANTERIOR
 *   all measurements in centimetres, converted at the geometry boundary.
 *
 * Dimensions are the standard adult reference values (175 cm male): biparietal
 * breadth 15.2 cm, glabella–occiput 19.2 cm, 7 cervical / 12 thoracic / 5 lumbar
 * vertebrae, 12 rib pairs of which 1–7 are true (vertebrosternal), 8–10 false
 * (vertebrochondral) and 11–12 floating.
 */
import { Group, Vector3 } from 'three';
import { loft } from '../core/loft.js';
import { compose, superellipse, Bladed, Flared, Tapered } from '../core/Profile.js';
import { merge, radial, spine, superellipsoid, transformGeometry, tube } from '../core/builders.js';
import { segs } from '../core/quality.js';

/** Side multiplier: +1 = subject's left (+x), -1 = subject's right (-x). */
export const SIDE = Object.freeze({ left: 1, right: -1 });

/* ================================================================== */
/* 1. SKULL                                                            */
/* ================================================================== */

/**
 * Neurocranium.
 *
 * Modelled as a radial (star-shaped) surface because the calvaria is smooth but
 * decidedly not an ellipsoid: the temporal squamae are flattened, the occiput
 * bulges postero-inferiorly, the frontal bone has a superior bossing, and the
 * base tucks in sharply at the foramen magnum. Each of those is a small additive
 * term on the base superellipsoid radius, which keeps the shape editable in
 * anatomical terms rather than as opaque vertex edits.
 */
export function buildCranium(q = 1) {
  const W = segs(48, q);
  const H = segs(36, q);
  return radial(
    (dir) => {
      const { x, y, z } = dir;
      // Base calvarial ellipsoid: 7.6 cm half-breadth, 10.6 half-height, 9.6 half-depth.
      const a = 7.6, b = 10.6, c = 9.6;
      let r =
        Math.pow(
          Math.pow(Math.abs(x) / a, 2.4) + Math.pow(Math.abs(y) / b, 2.4) + Math.pow(Math.abs(z) / c, 2.4),
          -1 / 2.4,
        );

      // Temporal squama flattening — the sides of the skull are the flattest region.
      const temporalBand = Math.exp(-Math.pow((y + 0.05) / 0.42, 2));
      r *= 1 - 0.11 * temporalBand * Math.abs(x);

      // Occipital protuberance: posterior and slightly inferior.
      const occ = Math.max(0, -z - 0.35) * Math.max(0, 0.55 - y);
      r += 1.15 * occ;

      // Frontal bossing / glabellar region: anterior and superior.
      const frontal = Math.max(0, z - 0.35) * Math.max(0, y + 0.15);
      r += 0.85 * frontal;

      // Parietal eminence: broad superior-lateral fullness.
      r += 0.45 * Math.max(0, y - 0.25) * Math.abs(x);

      // Cranial base tucks in below the petrous/temporal line.
      const baseTaper = Math.max(0, -y - 0.45);
      r *= 1 - 0.55 * Math.pow(baseTaper, 1.3);

      return Math.max(0.6, r);
    },
    { widthSegments: W, heightSegments: H, centreCm: [0, 164.5, -0.6] },
  );
}

/**
 * Mandible — the only movable bone of the skull.
 * Built as a loft along the horseshoe from one condyle, around the symphysis, to
 * the other. The section is taller than it is wide (the body is a vertical plate)
 * and flares at the ramus, which is what gives the gonial angle.
 */
export function buildMandible(side = 1, q = 1) {
  // Half-mandible: condyle → ramus → angle → body → symphysis.
  const pts = [
    [side * 3.4, 164.0, -1.2], // condylar process (TMJ)
    [side * 4.3, 160.0, -1.0],
    [side * 4.6, 156.5, -0.9], // ramus
    [side * 4.4, 153.5, -0.4], // gonial angle
    [side * 3.9, 152.0, 2.2], // body
    [side * 2.7, 151.2, 4.4],
    [side * 1.2, 150.8, 5.5], // approaching symphysis
    [side * 0.35, 150.7, 5.8], // mental region
  ];

  const body = loft({
    spine: spine(pts),
    profile: compose(superellipse(0.62, 1.15, 3.2), Flared({ start: 0.85, width: 0.28, power: 1.6 })),
    radialSegments: segs(18, q),
    heightSegments: segs(28, q),
    up: new Vector3(0, 1, 0),
  });

  // Coronoid process — the anterior projection of the ramus (temporalis inserts).
  const coronoid = tube(
    [
      [side * 4.2, 155.0, 0.2],
      [side * 3.9, 159.0, 0.9],
      [side * 3.6, 162.5, 1.3],
    ],
    (t) => 0.75 * (1 - t * 0.55),
    { radialSegments: segs(12, q), heightSegments: segs(14, q) },
  );

  // Alveolar arch — the tooth-bearing ridge along the superior border of the body.
  const alveolar = loft({
    spine: spine(pts.slice(2)),
    profile: superellipse(0.45, 0.4, 2.2),
    radialSegments: segs(12, q),
    heightSegments: segs(18, q),
    up: new Vector3(0, 1, 0),
  });
  alveolar.translate(0, 0.009, 0);

  return merge([body, coronoid, alveolar]);
}

/** Zygomatic bone + arch (cheekbone). */
export function buildZygomatic(side = 1, q = 1) {
  const body = superellipsoid([1.1, 0.85, 0.75], {
    n: 3.4,
    widthSegments: segs(20, q),
    heightSegments: segs(14, q),
    centreCm: [side * 4.3, 158.6, 3.4],
  });
  const arch = tube(
    [
      [side * 5.0, 158.4, 2.6],
      [side * 6.2, 158.6, 0.6],
      [side * 6.6, 159.0, -1.4],
      [side * 6.4, 159.6, -3.0],
    ],
    (t) => 0.42 * (1 - t * 0.25),
    { radialSegments: segs(10, q), heightSegments: segs(14, q) },
  );
  return merge([body, arch]);
}

/** Maxilla — upper jaw, carries the upper alveolar process and forms the orbit floor. */
export function buildMaxilla(side = 1, q = 1) {
  const body = superellipsoid([1.7, 1.5, 1.7], {
    n: 3.0,
    widthSegments: segs(20, q),
    heightSegments: segs(14, q),
    centreCm: [side * 1.7, 155.2, 4.2],
  });
  const alveolar = superellipsoid([1.6, 0.55, 1.75], {
    n: 2.6,
    widthSegments: segs(18, q),
    heightSegments: segs(10, q),
    centreCm: [side * 1.7, 152.6, 4.4],
  });
  return merge([body, alveolar]);
}

/** Nasal bones — the bridge of the nose. */
export function buildNasal(side = 1, q = 1) {
  return superellipsoid([0.55, 1.3, 0.35], {
    n: 2.6,
    widthSegments: segs(14, q),
    heightSegments: segs(10, q),
    centreCm: [side * 0.55, 158.4, 5.7],
  });
}

/** Lacrimal bone — the smallest facial bone, in the medial orbital wall. */
export function buildLacrimal(side = 1, q = 1) {
  return superellipsoid([0.28, 0.7, 0.65], {
    n: 2.4,
    widthSegments: segs(12, q),
    heightSegments: segs(10, q),
    centreCm: [side * 1.55, 158.4, 4.0],
  });
}

/** Palatine bone — L-shaped, forms the posterior hard palate. */
export function buildPalatine(side = 1, q = 1) {
  const plate = superellipsoid([0.9, 0.18, 0.8], {
    n: 3.0,
    widthSegments: segs(12, q),
    heightSegments: segs(8, q),
    centreCm: [side * 1.3, 152.0, 2.3],
  });
  const perpendicular = superellipsoid([0.16, 1.0, 0.85], {
    n: 3.0,
    widthSegments: segs(12, q),
    heightSegments: segs(8, q),
    centreCm: [side * 2.1, 153.2, 2.3],
  });
  return merge([plate, perpendicular]);
}

/** Inferior nasal concha — a thin scroll of bone in the lateral nasal wall. */
export function buildInferiorConcha(side = 1, q = 1) {
  return transformGeometry(
    superellipsoid([1.5, 0.22, 0.5], {
      n: 2.2,
      widthSegments: segs(14, q),
      heightSegments: segs(8, q),
    }),
    { position: [side * 1.7, 154.6, 4.0], rotation: [0, side * -14, side * -8] },
  );
}

/** Vomer — the thin midline bone forming the posteroinferior nasal septum. */
export function buildVomer(q = 1) {
  return superellipsoid([0.12, 1.05, 1.5], {
    n: 2.6,
    widthSegments: segs(10, q),
    heightSegments: segs(10, q),
    centreCm: [0, 154.2, 3.4],
  });
}

/**
 * Auditory ossicles — malleus, incus, stapes. Sub-centimetre, so they are only
 * worth modelling at the top quality tier; the LOD steps them away almost
 * immediately, which is exactly what LOD is for.
 */
export function buildOssicles(side = 1, q = 1) {
  const cx = side * 4.6;
  const cy = 160.6;
  const cz = -1.4;
  const malleus = superellipsoid([0.22, 0.42, 0.18], {
    n: 2.2, widthSegments: segs(10, q), heightSegments: segs(8, q), centreCm: [cx, cy, cz],
  });
  const incus = superellipsoid([0.2, 0.3, 0.26], {
    n: 2.2, widthSegments: segs(10, q), heightSegments: segs(8, q), centreCm: [cx - side * 0.35, cy + 0.1, cz - 0.2],
  });
  const stapes = superellipsoid([0.14, 0.2, 0.12], {
    n: 2.2, widthSegments: segs(8, q), heightSegments: segs(6, q), centreCm: [cx - side * 0.6, cy + 0.25, cz - 0.3],
  });
  return merge([malleus, incus, stapes]);
}

/** Hyoid — the free-floating U-shaped bone of the neck. */
export function buildHyoid(q = 1) {
  const arm = (side) =>
    tube(
      [
        [side * 0.3, 144.2, 2.2],
        [side * 1.3, 144.0, 1.5],
        [side * 2.0, 144.6, 0.4],
        [side * 2.1, 146.0, -0.6],
      ],
      (t) => 0.24 * (1 - t * 0.4),
      { radialSegments: segs(10, q), heightSegments: segs(12, q) },
    );
  return merge([arm(1), arm(-1)]);
}

/* ================================================================== */
/* 2. VERTEBRAL COLUMN                                                 */
/* ================================================================== */

/**
 * Vertebral column centreline.
 *
 * The four curves are the real ones, and they matter visually: cervical lordosis
 * (convex anteriorly), thoracic kyphosis (convex posteriorly), lumbar lordosis,
 * sacral kyphosis. Getting the z-offsets right is what stops the model looking
 * like a stack of coins.
 *
 * @returns {(yCm:number)=>number} anterior displacement z in cm at height y
 */
export function spinalCurveZ(yCm) {
  // Anchors: [y, z]. Interpolated with a monotone cubic so the curves do not
  // overshoot between landmarks.
  const A = [
    [147.5, 0.6], // C1 atlas
    [143.0, 2.0], // mid-cervical lordotic peak
    [136.0, 1.0], // cervicothoracic junction
    [131.0, -0.2], // T2
    [122.0, -1.9], // mid-thoracic kyphotic trough (T6)
    [112.0, -1.4], // T10
    [108.0, -0.4], // T12
    [104.0, 0.9], // L2
    [99.0, 2.0], // lumbar lordotic peak (L3/L4)
    [93.0, 1.0], // L5
    [88.0, -0.4], // sacral promontory
    [80.0, -1.6], // mid sacrum
    [75.0, -2.6], // coccyx
  ];
  if (yCm >= A[0][0]) return A[0][1];
  for (let i = 0; i < A.length - 1; i++) {
    const [y1, z1] = A[i];
    const [y0, z0] = A[i + 1];
    if (yCm <= y1 && yCm >= y0) {
      const t = (y1 - yCm) / (y1 - y0 || 1);
      const s = t * t * (3 - 2 * t);
      return z1 + (z0 - z1) * s;
    }
  }
  return A[A.length - 1][1];
}

/** Centroid height (cm) of each presacral vertebra, C1 → L5. */
export const VERTEBRA_Y = (() => {
  const ys = [];
  // Cervical C1–C7: 147.5 down to 135.0 (≈1.75 cm each)
  for (let i = 0; i < 7; i++) ys.push(147.5 - i * 1.78);
  // Thoracic T1–T12: 133.5 down to 108.0 (≈2.3 cm each, taller caudally)
  for (let i = 0; i < 12; i++) ys.push(133.2 - i * 2.27);
  // Lumbar L1–L5: 105.5 down to 93.0 (≈3.0 cm each)
  for (let i = 0; i < 5; i++) ys.push(105.5 - i * 3.05);
  return ys;
})();

/** Region metadata for vertebrae 0–23. */
export function vertebraRegion(index) {
  if (index < 7) return { region: 'cervical', n: index + 1, label: `C${index + 1}` };
  if (index < 19) return { region: 'thoracic', n: index - 6, label: `T${index - 6}` };
  return { region: 'lumbar', n: index - 18, label: `L${index - 18}` };
}

/**
 * A single presacral vertebra.
 *
 * Built from the real components: body (anterior weight-bearing cylinder),
 * pedicles, laminae (which enclose the vertebral foramen with the body),
 * spinous process, paired transverse processes and four articular processes.
 * Regional differences are parameterised rather than hand-modelled:
 *   • cervical  — small body, transverse foramen, short bifid spine
 *   • thoracic  — heart-shaped body, costal facets, long inferiorly-angled spine
 *   • lumbar    — massive kidney-shaped body, short broad horizontal spine
 */
export function buildVertebra(index, q = 1) {
  const { region, n } = vertebraRegion(index);
  const y = VERTEBRA_Y[index];
  const z = spinalCurveZ(y);

  // --- regional dimensions (cm) -------------------------------------
  const dims = {
    cervical: {
      bodyW: 2.15 + 0.09 * n, bodyD: 1.75 + 0.07 * n, bodyH: 1.15 + 0.05 * n,
      archW: 1.55 + 0.05 * n, spinousLen: 1.5 + 0.1 * n, spinousDrop: 18,
      transverseLen: 1.9 + 0.1 * n, transverseDrop: 5, bodyN: 2.6, foramen: true,
    },
    thoracic: {
      bodyW: 2.55 + 0.085 * n, bodyD: 2.35 + 0.07 * n, bodyH: 1.75 + 0.05 * n,
      archW: 1.5 + 0.03 * n, spinousLen: 2.6 + 0.07 * n, spinousDrop: 58,
      transverseLen: 1.7 + 0.05 * n, transverseDrop: 18, bodyN: 3.0, foramen: false,
    },
    lumbar: {
      bodyW: 3.55 + 0.16 * n, bodyD: 2.75 + 0.11 * n, bodyH: 2.25 + 0.12 * n,
      archW: 1.75, spinousLen: 2.1, spinousDrop: 12,
      transverseLen: 2.6 + 0.15 * n, transverseDrop: 4, bodyN: 3.2, foramen: false,
    },
  }[region];

  const parts = [];
  const R = segs(16, q);

  // --- vertebral body -----------------------------------------------
  // Cervical C1 (atlas) has NO body — it is a ring that carries the skull.
  const isAtlas = region === 'cervical' && n === 1;
  if (!isAtlas) {
    const body = loft({
      spine: spine([
        [0, y - dims.bodyH / 2, z],
        [0, y, z + 0.06],
        [0, y + dims.bodyH / 2, z],
      ]),
      profile: compose(superellipse(dims.bodyW / 2, dims.bodyD / 2, dims.bodyN), Flared({ start: 0.14, end: 0.14, width: 0.3 })),
      radialSegments: R,
      heightSegments: segs(6, q),
      up: new Vector3(1, 0, 0),
    });
    parts.push(body);
  } else {
    // Anterior arch of the atlas.
    parts.push(
      superellipsoid([1.0, 0.62, 0.5], {
        n: 3, widthSegments: R, heightSegments: segs(10, q), centreCm: [0, y, z + 1.3],
      }),
    );
  }

  // --- pedicles: body → arch ----------------------------------------
  const pedicleR = region === 'lumbar' ? 0.42 : 0.3;
  for (const s of [1, -1]) {
    parts.push(
      tube(
        [
          [s * dims.bodyW * 0.42, y + dims.bodyH * 0.12, z - dims.bodyD * 0.3],
          [s * dims.archW * 0.8, y + dims.bodyH * 0.32, z - dims.bodyD * 0.75],
        ],
        pedicleR,
        { radialSegments: segs(8, q), heightSegments: segs(6, q) },
      ),
    );
  }

  // --- laminae: arch → spinous process ------------------------------
  const laminaY = y + dims.bodyH * 0.3;
  for (const s of [1, -1]) {
    parts.push(
      transformGeometry(
        superellipsoid([dims.archW * 0.5, 0.34, 0.85], {
          n: 3.2, widthSegments: segs(12, q), heightSegments: segs(8, q),
        }),
        { position: [s * dims.archW * 0.52, laminaY, z - dims.bodyD * 0.75 - 0.75], rotation: [region === 'thoracic' ? 22 : 8, s * -6, 0] },
      ),
    );
  }

  // --- spinous process ----------------------------------------------
  const sDrop = (dims.spinousDrop * Math.PI) / 180;
  const sLen = dims.spinousLen;
  parts.push(
    loft({
      spine: spine([
        [0, laminaY, z - dims.bodyD * 0.75 - 1.3],
        [0, laminaY - Math.sin(sDrop) * sLen * 0.5, z - dims.bodyD * 0.75 - 1.3 - Math.cos(sDrop) * sLen * 0.5],
        [0, laminaY - Math.sin(sDrop) * sLen, z - dims.bodyD * 0.75 - 1.3 - Math.cos(sDrop) * sLen],
      ]),
      profile: compose(
        superellipse(region === 'lumbar' ? 0.72 : 0.4, 0.22, 3.0),
        Tapered(1.35, 0.5),
      ),
      radialSegments: segs(10, q),
      heightSegments: segs(8, q),
      up: new Vector3(1, 0, 0),
    }),
  );

  // --- transverse processes -----------------------------------------
  const tDrop = (dims.transverseDrop * Math.PI) / 180;
  for (const s of [1, -1]) {
    const tLen = dims.transverseLen;
    parts.push(
      loft({
        spine: spine([
          [s * dims.archW * 0.85, laminaY, z - dims.bodyD * 0.6],
          [s * (dims.archW * 0.85 + Math.cos(tDrop) * tLen * 0.55), laminaY - 0.1, z - dims.bodyD * 0.6 - Math.sin(tDrop) * tLen * 0.3],
          [s * (dims.archW * 0.85 + Math.cos(tDrop) * tLen), laminaY - 0.25, z - dims.bodyD * 0.6 - Math.sin(tDrop) * tLen * 0.6],
        ]),
        profile: compose(superellipse(0.3, 0.26, 3.0), Tapered(1.2, 0.55)),
        radialSegments: segs(8, q),
        heightSegments: segs(8, q),
        up: new Vector3(0, 1, 0),
      }),
    );
  }

  // --- articular processes (superior + inferior facets) --------------
  for (const s of [1, -1]) {
    for (const [dy, dz, r] of [
      [dims.bodyH * 0.42, -dims.bodyD * 0.55, 0.34],
      [-dims.bodyH * 0.42, -dims.bodyD * 0.9, 0.32],
    ]) {
      parts.push(
        superellipsoid([r, r * 1.5, r], {
          n: 2.6, widthSegments: segs(10, q), heightSegments: segs(8, q),
          centreCm: [s * dims.archW * 0.82, y + dy, z + dz],
        }),
      );
    }
  }

  // --- axis dens (odontoid process of C2) ----------------------------
  if (region === 'cervical' && n === 2) {
    parts.push(
      loft({
        spine: spine([
          [0, y + dims.bodyH * 0.5, z + dims.bodyD * 0.1],
          [0, y + dims.bodyH * 0.5 + 1.1, z + dims.bodyD * 0.25],
          [0, y + dims.bodyH * 0.5 + 1.9, z + dims.bodyD * 0.2],
        ]),
        profile: compose(superellipse(0.36, 0.36, 2.4), Tapered(1, 0.45)),
        radialSegments: segs(12, q),
        heightSegments: segs(8, q),
        up: new Vector3(1, 0, 0),
      }),
    );
  }

  return merge(parts);
}

/**
 * Sacrum — five fused vertebrae forming a posteriorly-concave wedge that locks
 * between the two hip bones. Four pairs of anterior sacral foramina are implied
 * by the surface relief rather than modelled as holes (holes would break the
 * watertightness the loft guarantees, for no visual gain at this scale).
 */
export function buildSacrum(q = 1) {
  const g = loft({
    spine: spine([
      [0, 91.5, 0.4],
      [0, 88.5, -0.3],
      [0, 85.0, -1.0],
      [0, 81.5, -1.7],
      [0, 78.5, -2.2],
    ]),
    profile: compose(
      superellipse(4.6, 1.55, 3.4),
      Bladed(0.62),
      Tapered(1.0, 0.22),
    ),
    radialSegments: segs(20, q),
    heightSegments: segs(14, q),
    up: new Vector3(1, 0, 0),
  });
  // Sacral ala — the broad lateral wings that articulate with the ilium.
  const ala = (s) =>
    superellipsoid([2.0, 1.05, 1.6], {
      n: 3.0, widthSegments: segs(14, q), heightSegments: segs(10, q),
      centreCm: [s * 3.6, 90.2, -0.2],
    });
  return merge([g, ala(1), ala(-1)]);
}

/** Coccyx — four fused rudimentary vertebrae, angled anteriorly. */
export function buildCoccyx(q = 1) {
  return loft({
    spine: spine([
      [0, 78.0, -2.2],
      [0, 76.2, -2.9],
      [0, 74.6, -3.4],
      [0, 73.4, -3.6],
    ]),
    profile: compose(superellipse(1.0, 0.42, 3.0), Bladed(0.7), Tapered(1, 0.3)),
    radialSegments: segs(12, q),
    heightSegments: segs(10, q),
    up: new Vector3(1, 0, 0),
  });
}

/* ================================================================== */
/* 3. THORACIC CAGE                                                    */
/* ================================================================== */

/**
 * Rib geometry by number.
 *
 * Ribs 1–7 are true ribs (costal cartilage reaches the sternum directly), 8–10
 * are false (cartilage joins the rib above), 11–12 float. Rib length peaks at 7
 * and falls away at 12; rib 1 is short, broad and sharply curved, and rib 12 has
 * no neck or tubercle. The cross-section is a flat rounded rectangle — ribs are
 * blades, not tubes — which is why the superellipse exponent is 4 rather than 2.
 */
const RIB_TABLE = [
  // n, lengthScale, lateralHalfBreadth(cm), verticalDrop(cm), anteriorZ(cm), thickness
  { n: 1, w: 8.2, drop: 2.2, antZ: 6.0, thick: 0.62, cart: 2.5 },
  { n: 2, w: 11.4, drop: 5.0, antZ: 9.4, thick: 0.56, cart: 3.6 },
  { n: 3, w: 12.4, drop: 6.6, antZ: 10.6, thick: 0.55, cart: 4.2 },
  { n: 4, w: 12.9, drop: 7.6, antZ: 11.2, thick: 0.54, cart: 4.6 },
  { n: 5, w: 13.1, drop: 8.4, antZ: 11.5, thick: 0.53, cart: 4.8 },
  { n: 6, w: 13.0, drop: 9.0, antZ: 11.5, thick: 0.52, cart: 4.6 },
  { n: 7, w: 12.6, drop: 9.4, antZ: 11.2, thick: 0.52, cart: 4.4 },
  { n: 8, w: 12.0, drop: 9.6, antZ: 10.4, thick: 0.5, cart: 5.0 },
  { n: 9, w: 11.2, drop: 9.4, antZ: 9.4, thick: 0.5, cart: 5.4 },
  { n: 10, w: 10.2, drop: 8.8, antZ: 8.2, thick: 0.48, cart: 5.2 },
  { n: 11, w: 8.8, drop: 6.6, antZ: 5.2, thick: 0.46, cart: 2.6 },
  { n: 12, w: 6.6, drop: 4.4, antZ: 2.6, thick: 0.44, cart: 1.4 },
];

/**
 * Build one rib (bone only).
 * @param {number} n rib number 1–12
 * @param {number} side +1 left / -1 right
 */
export function buildRib(n, side, q = 1) {
  const t = RIB_TABLE[n - 1];
  const headY = VERTEBRA_Y[6 + n] ?? 133.2 - n * 2.27; // articulates with Tn
  const zHead = spinalCurveZ(headY) - 1.0;
  const w = side * t.w;

  const pts = [
    [side * 1.55, headY + 0.35, zHead - 0.2], // head (articulates with 2 vertebral bodies)
    [side * 3.1, headY + 0.1, zHead - 1.0], // neck
    [side * 4.2, headY - 0.25, zHead - 1.6], // tubercle (articulates with transverse process)
    // Angle of the rib — the sharpest bend, ~4 cm posterior to the vertebral body.
    [w * 0.86, headY - t.drop * 0.42, zHead - 3.2],
    [w, headY - t.drop * 0.66, t.antZ * 0.35], // lateral most point
    [w * 0.86, headY - t.drop * 0.86, t.antZ * 0.72],
    [side * (t.w * 0.42 + 2.4), headY - t.drop, t.antZ], // costochondral junction
  ];

  return loft({
    spine: spine(pts),
    // Ribs are flat blades: ~1.05 cm broad, `thick` deep, and the costal groove
    // runs along the inferior internal border.
    profile: compose(
      superellipse(0.52, t.thick, 4.2),
      Tapered(0.78, 0.92),
    ),
    radialSegments: segs(10, q),
    heightSegments: segs(34, q),
    up: new Vector3(0, 1, 0),
  });
}

/**
 * Costal cartilage — the hyaline continuation of ribs 1–10 that attaches them to
 * the sternum (or, for 8–10, to the cartilage above). Rendered in the cartilage
 * tissue so the thoracic cage reads as bone + flexible anterior wall.
 */
export function buildCostalCartilage(n, side, q = 1) {
  const t = RIB_TABLE[n - 1];
  const headY = VERTEBRA_Y[6 + n] ?? 133.2 - n * 2.27;
  const boneEndX = side * (t.w * 0.42 + 2.4);
  const boneEndY = headY - t.drop;

  // Ribs 1–7 run to the sternum; 8–10 sweep up to join the cartilage above.
  const toSternum = n <= 7;
  const endX = toSternum ? side * (2.0 - n * 0.06) : side * (3.0 - (10 - n) * 0.35);
  const endY = toSternum
    ? 140.2 - n * 2.15 // manubrium → xiphoid
    : boneEndY + 1.4 + (10 - n) * 0.9;
  const endZ = toSternum ? 8.4 - n * 0.32 : 9.0 - (10 - n) * 0.5;

  return loft({
    spine: spine([
      [boneEndX, boneEndY, t.antZ],
      [(boneEndX + endX) * 0.55, (boneEndY + endY) * 0.5 + 0.25, (t.antZ + endZ) * 0.55],
      [endX, endY, endZ],
    ]),
    profile: compose(superellipse(0.5, t.thick * 0.95, 3.0), Tapered(1, 0.72)),
    radialSegments: segs(10, q),
    heightSegments: segs(16, q),
    up: new Vector3(0, 1, 0),
  });
}

/** Sternum — manubrium, body (gladiolus) and xiphoid process. */
export function buildSternum(q = 1) {
  const manubrium = loft({
    spine: spine([[0, 140.4, 7.6], [0, 137.4, 8.0], [0, 134.6, 8.2]]),
    profile: superellipse(2.75, 0.62, 3.6),
    radialSegments: segs(14, q),
    heightSegments: segs(6, q),
    up: new Vector3(1, 0, 0),
  });
  const body = loft({
    spine: spine([[0, 134.0, 8.25], [0, 128.5, 8.5], [0, 123.0, 8.55]]),
    profile: superellipse(1.95, 0.5, 3.6),
    radialSegments: segs(14, q),
    heightSegments: segs(8, q),
    up: new Vector3(1, 0, 0),
  });
  const xiphoid = loft({
    spine: spine([[0, 122.4, 8.5], [0, 120.2, 8.7], [0, 118.4, 8.6]]),
    profile: compose(superellipse(0.85, 0.36, 2.8), Tapered(1, 0.4)),
    radialSegments: segs(10, q),
    heightSegments: segs(6, q),
    up: new Vector3(1, 0, 0),
  });
  return merge([manubrium, body, xiphoid]);
}

/* ================================================================== */
/* Assembly                                                            */
/* ================================================================== */

/**
 * Build the whole axial skeleton as a node hierarchy:
 *   axial
 *   ├── skull
 *   ├── vertebral column  (cervical / thoracic / lumbar / sacrococcygeal)
 *   └── thoracic cage     (sternum / ribs / costal cartilages)
 *
 * @param {(def:object)=>import('three').Object3D} partFactory turns a part
 *   definition into a display object; supplied by the system so material and LOD
 *   policy stay centralised.
 */
export function buildAxialSkeleton(partFactory, { q = 1, detail = 'full' } = {}) {
  const axial = new Group();
  axial.name = 'axial-skeleton';

  // --- skull ---------------------------------------------------------
  const skull = new Group();
  skull.name = 'skull';
  const S = { system: 'skeletal', region: 'axial-skull' };

  skull.add(partFactory({ id: 'cranium', name: 'Neurocranium', latin: 'Neurocranium', ...S, build: (qq) => buildCranium(qq), material: 'corticalBone', distances: [0, 2.2, 4.0], q, note: 'Eight bones enclosing the brain.' }));

  const facial = [
    ['mandible', 'Mandible', 'Mandibula', buildMandible, 'The only movable bone of the skull.'],
    ['zygomatic', 'Zygomatic bone', 'Os zygomaticum', buildZygomatic, 'Cheekbone; forms the zygomatic arch.'],
    ['maxilla', 'Maxilla', 'Maxilla', buildMaxilla, 'Upper jaw and floor of the orbit.'],
    ['nasal', 'Nasal bone', 'Os nasale', buildNasal, 'Bridge of the nose.'],
    ['lacrimal', 'Lacrimal bone', 'Os lacrimale', buildLacrimal, 'Smallest facial bone; medial orbital wall.'],
    ['palatine', 'Palatine bone', 'Os palatinum', buildPalatine, 'Posterior hard palate.'],
    ['inferior-concha', 'Inferior nasal concha', 'Concha nasalis inferior', buildInferiorConcha, 'Lateral nasal wall scroll.'],
  ];
  for (const [id, name, latin, fn, note] of facial) {
    for (const [sideName, s] of [['left', 1], ['right', -1]]) {
      skull.add(
        partFactory({
          id: `${id}.${sideName}`, name: `${name} (${sideName})`, latin, ...S,
          build: (qq) => fn(s, qq), material: 'corticalBone',
          distances: [0, 2.0, 3.6], q, note,
        }),
      );
    }
  }
  skull.add(partFactory({ id: 'vomer', name: 'Vomer', latin: 'Vomer', ...S, build: (qq) => buildVomer(qq), material: 'corticalBone', distances: [0, 2.0, 3.6], q }));
  for (const [sideName, s] of [['left', 1], ['right', -1]]) {
    skull.add(partFactory({ id: `ossicles.${sideName}`, name: `Auditory ossicles (${sideName})`, latin: 'Ossicula auditus', ...S, build: (qq) => buildOssicles(s, qq), material: 'corticalBone', distances: [0, 1.2], q, note: 'Malleus, incus and stapes — the smallest bones in the body.' }));
  }
  skull.add(partFactory({ id: 'hyoid', name: 'Hyoid', latin: 'Os hyoideum', ...S, build: (qq) => buildHyoid(qq), material: 'corticalBone', distances: [0, 2.0, 3.6], q, note: 'Anchors the tongue; articulates with no other bone.' }));
  axial.add(skull);

  // --- vertebral column ----------------------------------------------
  const column = new Group();
  column.name = 'vertebral-column';
  const V = { system: 'skeletal', region: 'axial-spine' };
  for (let i = 0; i < 24; i++) {
    const { label, region } = vertebraRegion(i);
    column.add(
      partFactory({
        id: `vertebra.${label.toLowerCase()}`,
        name: `${label} vertebra`,
        latin: `Vertebra ${region === 'cervical' ? 'cervicalis' : region === 'thoracic' ? 'thoracica' : 'lumbalis'}`,
        ...V,
        build: (qq) => buildVertebra(i, qq),
        material: 'corticalBone',
        distances: [0, 1.8, 3.4, 6.0],
        q,
        note: `${region[0].toUpperCase()}${region.slice(1)} vertebra ${label.slice(1)}.`,
      }),
    );
  }
  column.add(partFactory({ id: 'sacrum', name: 'Sacrum', latin: 'Os sacrum', ...V, build: (qq) => buildSacrum(qq), material: 'corticalBone', distances: [0, 1.8, 3.4], q, note: 'Five fused vertebrae wedged between the hip bones.' }));
  column.add(partFactory({ id: 'coccyx', name: 'Coccyx', latin: 'Os coccygis', ...V, build: (qq) => buildCoccyx(qq), material: 'corticalBone', distances: [0, 1.8, 3.4], q, note: 'Four fused rudimentary vertebrae.' }));
  axial.add(column);

  // --- thoracic cage ---------------------------------------------------
  const cage = new Group();
  cage.name = 'thoracic-cage';
  cage.add(partFactory({ id: 'sternum', name: 'Sternum', latin: 'Sternum', system: 'skeletal', region: 'axial-thorax', build: (qq) => buildSternum(qq), material: 'corticalBone', distances: [0, 2.0, 4.0], q, note: 'Manubrium, body and xiphoid process.' }));

  if (detail !== 'bone-only') {
    for (let n = 1; n <= 12; n++) {
      for (const [sideName, s] of [['left', 1], ['right', -1]]) {
        cage.add(
          partFactory({
            id: `rib.${n}.${sideName}`,
            name: `Rib ${n} (${sideName})`,
            latin: `Costa ${n}`,
            system: 'skeletal',
            region: 'axial-thorax',
            build: (qq) => buildRib(n, s, qq),
            material: 'corticalBone',
            distances: [0, 1.6, 3.0, 5.5],
            q,
            note: n <= 7 ? 'True rib — cartilage reaches the sternum.' : n <= 10 ? 'False rib — cartilage joins the rib above.' : 'Floating rib — no anterior attachment.',
          }),
        );
        cage.add(
          partFactory({
            id: `costal-cartilage.${n}.${sideName}`,
            name: `Costal cartilage ${n} (${sideName})`,
            latin: `Cartilago costalis ${n}`,
            system: 'skeletal',
            region: 'axial-thorax',
            build: (qq) => buildCostalCartilage(n, s, qq),
            material: 'cartilage',
            distances: [0, 1.6, 3.0, 5.5],
            q,
            castShadow: false,
          }),
        );
      }
    }
  }
  axial.add(cage);

  return axial;
}
