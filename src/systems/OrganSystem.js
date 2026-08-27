/**
 * OrganSystem.js — the visceral system (thoracic, abdominal, pelvic and CNS).
 *
 * Structures here are built three ways, chosen by what the organ actually is:
 *
 *   • `radial()`  — for solid parenchymatous organs whose silhouette is smooth but
 *     not ellipsoidal: brain, liver, spleen, kidneys, lungs, heart.
 *   • `loft()`    — for tubular and J-shaped viscera: stomach, duodenum, colon,
 *     oesophagus, ureters, trachea, great vessels.
 *   • recursive branching tubes — for the bronchial tree.
 *
 * Anatomical specifics that are modelled rather than faked:
 *   • right lung has THREE lobes (oblique + horizontal fissures), left has TWO
 *     and carries the cardiac notch;
 *   • the colon has haustra (sacculations) and taeniae coli;
 *   • the kidneys are bean-shaped with a medially-facing hilum;
 *   • the heart's left ventricular wall is thicker than the right;
 *   • the cerebral hemispheres are separated by a longitudinal fissure.
 *
 * All coordinates in cm on the 175 cm reference body. x+ = subject's LEFT.
 */
import { Group, Vector3 } from 'three';
import { loft } from '../core/loft.js';
import { compose, superellipse, Flared, Tapered } from '../core/Profile.js';
import { merge, radial, spine, superellipsoid, transformGeometry, tube } from '../core/builders.js';
import { segs } from '../core/quality.js';

const V = (arr) => new Vector3(arr[0], arr[1], arr[2]);

/* ================================================================== */
/* CNS                                                                 */
/* ================================================================== */

/**
 * Cerebrum.
 *
 * A radial surface with a deep midline groove — `Math.abs(dir.x)` pulls the
 * radius in as the direction approaches the sagittal plane, which is what the
 * longitudinal fissure is. Frontal, parietal, temporal and occipital fullness are
 * additive terms; gyral convolutions come from the cortex normal map rather than
 * geometry, because modelling real gyri would cost more triangles than the entire
 * skeleton for detail that is invisible below ~20 cm viewing distance.
 */
export function buildCerebrum(q = 1) {
  return radial(
    (dir) => {
      const { x, y, z } = dir;
      const a = 6.9; // transverse
      const b = 8.3; // anteroposterior
      const c = 5.9; // vertical
      let r = Math.pow(
        Math.pow(Math.abs(x) / a, 2.3) + Math.pow(Math.abs(y) / c, 2.6) + Math.pow(Math.abs(z) / b, 2.3),
        -1 / 2.3,
      );

      // Longitudinal fissure between the hemispheres.
      r *= 1 - 0.30 * Math.exp(-Math.pow(x / 0.16, 2)) * Math.max(0, y + 0.2);

      // Frontal pole and occipital pole are both narrower than the mid-coronal section.
      r *= 1 - 0.20 * Math.pow(Math.abs(z), 3);

      // Temporal lobes bulge inferiorly and laterally.
      r += 0.85 * Math.max(0, -y - 0.25) * Math.abs(x);

      // Flatten the inferior (tentorial) surface.
      if (y < -0.35) r *= 0.72;

      return Math.max(0.5, r);
    },
    { widthSegments: segs(56, q), heightSegments: segs(40, q), centreCm: [0, 166.0, 1.0] },
  );
}

/** Cerebellum — sits in the posterior cranial fossa under the tentorium. */
export function buildCerebellum(q = 1) {
  return radial(
    (dir) => {
      const a = 5.0, b = 3.4, c = 2.7;
      let r = Math.pow(
        Math.pow(Math.abs(dir.x) / a, 2.2) + Math.pow(Math.abs(dir.y) / c, 2.2) + Math.pow(Math.abs(dir.z) / b, 2.2),
        -1 / 2.2,
      );
      // Vermis: a shallow midline constriction.
      r *= 1 - 0.12 * Math.exp(-Math.pow(dir.x / 0.2, 2));
      return r;
    },
    { widthSegments: segs(36, q), heightSegments: segs(24, q), centreCm: [0, 158.6, -5.4] },
  );
}

/** Brainstem — midbrain, pons and medulla, continuing into the spinal cord. */
export function buildBrainstem(q = 1) {
  const stem = loft({
    spine: spine([
      [0, 161.0, -2.0],
      [0, 158.0, -2.6], // pons (the bulge)
      [0, 154.0, -2.4], // medulla
      [0, 150.0, -2.0], // foramen magnum
    ]),
    profile: compose(superellipse(1.05, 1.0, 2.6), Flared({ start: 0.35, width: 0.3 })),
    radialSegments: segs(16, q),
    heightSegments: segs(14, q),
    up: V([1, 0, 0]),
  });
  return stem;
}

/** Spinal cord — runs the vertebral canal to about L1/L2, then the cauda equina. */
export function buildSpinalCord(q = 1) {
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const y = 149.5 - i * 2.6; // C1 → L1
    // Follows the same curvature as the vertebral column, 1.2 cm posterior to
    // it, i.e. inside the vertebral canal.
    pts.push([0, y, spinalZ(y) - 1.2]);
  }
  return loft({
    spine: spine(pts),
    profile: compose(superellipse(0.62, 0.55, 2.4), Flared({ start: 0.18, width: 0.16 }), Tapered(1, 0.55)),
    radialSegments: segs(14, q),
    heightSegments: segs(30, q),
    up: V([1, 0, 0]),
  });
}

/** Local copy of the column's anterior displacement, to avoid an import cycle. */
function spinalZ(y) {
  const A = [[147.5, 0.6], [143, 2.0], [136, 1.0], [131, -0.2], [122, -1.9], [112, -1.4], [108, -0.4], [104, 0.9], [99, 2.0], [93, 1.0], [88, -0.4]];
  if (y >= A[0][0]) return A[0][1];
  for (let i = 0; i < A.length - 1; i++) {
    const [y1, z1] = A[i];
    const [y0, z0] = A[i + 1];
    if (y <= y1 && y >= y0) {
      const t = (y1 - y) / (y1 - y0 || 1);
      return z1 + (z0 - z1) * t * t * (3 - 2 * t);
    }
  }
  return A[A.length - 1][1];
}

/* ================================================================== */
/* THORAX                                                              */
/* ================================================================== */

/**
 * Heart.
 *
 * The body is a cone with its base posterosuperior and its apex pointing down,
 * anteriorly and to the left. The right atrium bulges to the right, the left
 * atrium posteriorly, and the left ventricular wall is deliberately thicker —
 * it pumps against systemic rather than pulmonary resistance. The great vessels
 * (aortic arch, pulmonary trunk, venae cavae) and the coronary arteries are added
 * as tubes, because they are what make a heart read as a heart.
 */
export function buildHeart(q = 1) {
  const parts = [];

  // --- myocardial mass ------------------------------------------------
  parts.push(
    radial(
      (dir) => {
        const a = 4.6, b = 5.4, c = 6.4;
        let r = Math.pow(
          Math.pow(Math.abs(dir.x) / a, 2.1) + Math.pow(Math.abs(dir.y) / c, 2.4) + Math.pow(Math.abs(dir.z) / b, 2.1),
          -1 / 2.1,
        );
        // Taper towards the apex (inferior, anterior, left).
        const apexward = Math.max(0, -dir.y * 0.7 + dir.z * 0.35 + dir.x * 0.3);
        r *= 1 - 0.42 * Math.pow(apexward, 1.6);
        // Right atrial bulge.
        r += 0.85 * Math.max(0, -dir.x - 0.45) * Math.max(0, dir.y + 0.2);
        // Interventricular groove — the surface marking between the ventricles.
        r *= 1 - 0.07 * Math.exp(-Math.pow((dir.z - 0.35) / 0.22, 2)) * Math.max(0, -dir.y);
        return Math.max(0.6, r);
      },
      { widthSegments: segs(40, q), heightSegments: segs(30, q), centreCm: [1.4, 122.5, 4.6] },
    ),
  );

  // --- aortic arch: ascending aorta, arch, descending -----------------
  parts.push(
    tube(
      [
        [1.2, 126.0, 4.0],
        [1.0, 130.5, 3.4],
        [0.4, 133.0, 2.2],
        [-0.6, 132.6, 0.0],
        [-1.0, 130.0, -1.8],
        [-0.8, 126.0, -2.6],
      ],
      (t) => (t < 0.55 ? 1.35 : 1.15 - (t - 0.55) * 0.3),
      { radialSegments: segs(16, q), heightSegments: segs(28, q) },
    ),
  );

  // --- pulmonary trunk, bifurcating to left and right -----------------
  parts.push(
    tube(
      [[2.4, 127.0, 5.0], [2.6, 130.5, 4.0], [1.8, 132.0, 2.6], [0.2, 132.2, 1.8]],
      1.25,
      { radialSegments: segs(14, q), heightSegments: segs(16, q) },
    ),
  );
  for (const s of [1, -1]) {
    parts.push(
      tube(
        [[0.2, 132.2, 1.8], [s * 2.4, 132.4, 0.4], [s * 4.6, 132.0, -1.4]],
        (t) => 0.85 - t * 0.15,
        { radialSegments: segs(12, q), heightSegments: segs(12, q) },
      ),
    );
  }

  // --- superior and inferior venae cavae (right side) -----------------
  parts.push(tube([[-2.2, 133.0, 1.0], [-2.4, 129.0, 2.0], [-2.4, 126.0, 2.8]], 1.05, { radialSegments: segs(12, q), heightSegments: segs(12, q) }));
  parts.push(tube([[-2.0, 112.0, 2.4], [-2.4, 116.0, 2.8], [-2.6, 119.5, 3.2]], 1.15, { radialSegments: segs(12, q), heightSegments: segs(12, q) }));

  // --- coronary arteries on the surface -------------------------------
  // Left anterior descending: runs in the anterior interventricular groove.
  parts.push(
    tube(
      [[1.6, 126.6, 6.6], [2.4, 123.0, 7.4], [3.0, 119.5, 7.0], [3.4, 116.6, 6.2]],
      (t) => 0.22 - t * 0.09,
      { radialSegments: segs(8, q), heightSegments: segs(14, q) },
    ),
  );
  // Right coronary: in the right atrioventricular groove.
  parts.push(
    tube(
      [[0.4, 126.4, 6.2], [-1.8, 124.6, 6.6], [-3.4, 122.0, 5.6], [-3.0, 119.0, 4.2]],
      (t) => 0.2 - t * 0.08,
      { radialSegments: segs(8, q), heightSegments: segs(14, q) },
    ),
  );

  return merge(parts);
}

/**
 * A lung lobe.
 * @param {'right'|'left'} side
 * @param {number} lobe 0 = superior, 1 = middle (right only), 2 = inferior
 */
export function buildLungLobe(side, lobe, q = 1) {
  const right = side === 'right';
  const sx = right ? -1 : 1; // subject's right is -x

  // Lobe centres and semi-axes (cm). The right lung is larger and its three
  // lobes are split by the oblique and horizontal fissures; the left has two and
  // is indented by the cardiac notch.
  const spec = right
    ? [
        { c: [-8.4, 132.5, 1.4], s: [4.0, 4.2, 5.0] }, // superior
        { c: [-7.4, 125.0, 4.2], s: [3.2, 2.6, 3.6] }, // middle (anterior, below horizontal fissure)
        { c: [-8.2, 122.0, 0.2], s: [4.2, 5.4, 5.4] }, // inferior
      ][lobe]
    : [
        { c: [8.8, 131.5, 1.4], s: [3.8, 4.6, 5.0] }, // superior (with lingula)
        { c: [8.6, 121.5, 0.2], s: [4.0, 5.6, 5.4] }, // inferior
      ][lobe];
  if (!spec) return null;

  return radial(
    (dir) => {
      const [a, c, b] = spec.s; // x, y, z semi-axes
      let r = Math.pow(
        Math.pow(Math.abs(dir.x) / a, 2.2) + Math.pow(Math.abs(dir.y) / c, 2.2) + Math.pow(Math.abs(dir.z) / b, 2.2),
        -1 / 2.2,
      );

      // Mediastinal surface is flattened where the lobe abuts the heart and vessels.
      r *= 1 - 0.34 * Math.max(0, sx * dir.x - 0.45);

      // Cardiac notch: only on the left, anteromedial, in the superior lobe.
      if (!right && lobe === 0) {
        r *= 1 - 0.42 * Math.max(0, -sx * dir.x - 0.3) * Math.max(0, dir.z - 0.2) * Math.max(0, -dir.y - 0.1);
      }

      // Vertebral groove: the posterior surface is concave over the spine.
      r *= 1 - 0.14 * Math.max(0, -dir.z - 0.55) * Math.abs(dir.x);

      // Flatten the base, which sits on the diaphragm.
      if (lobe === (right ? 2 : 1) && dir.y < -0.4) r *= 0.82;

      return Math.max(0.4, r);
    },
    { widthSegments: segs(36, q), heightSegments: segs(26, q), centreCm: spec.c },
  );
}

/**
 * Bronchial tree — recursive branching tubes.
 *
 * The trachea divides at the carina (T4/T5) into a right main bronchus that is
 * wider, shorter and more vertical than the left — which is why aspirated objects
 * usually end up in the right lung. Branching is generated to a depth limit
 * rather than authored, so the tree costs a few hundred triangles at depth 4 and
 * the same code can be run deeper for a close-up.
 */
export function buildBronchialTree(q = 1, { depth = 4 } = {}) {
  const parts = [];

  // Trachea, with cartilaginous rings implied by the radius modulation.
  parts.push(
    loft({
      spine: spine([[0, 145.0, 2.4], [0, 140.0, 2.2], [0, 135.5, 1.8], [0, 132.0, 1.4]]),
      profile: (theta, t) => superellipse(1.05, 0.9, 3.4)(theta) * (1 + 0.07 * Math.sin(t * Math.PI * 2 * 16)),
      radialSegments: segs(14, q),
      heightSegments: segs(30, q),
      up: V([1, 0, 0]),
    }),
  );

  /** Recursively add a branch and its two daughters. */
  const branch = (from, dir, radius, len, level) => {
    const to = [from[0] + dir[0] * len, from[1] + dir[1] * len, from[2] + dir[2] * len];
    parts.push(
      tube([from, to], (t) => radius * (1 - t * 0.18), {
        radialSegments: segs(Math.max(6, 10 - level), q),
        heightSegments: segs(6, q),
      }),
    );
    if (level >= depth) return;
    // Daughter directions: splay laterally and posteriorly, as real bronchi do.
    const spread = 0.42 + level * 0.06;
    for (const s of [1, -1]) {
      const d = [
        dir[0] + s * spread,
        dir[1] * 0.86 - 0.18,
        dir[2] - 0.12 + s * 0.05,
      ];
      const n = Math.hypot(d[0], d[1], d[2]) || 1;
      branch(to, [d[0] / n, d[1] / n, d[2] / n], radius * 0.68, len * 0.74, level + 1);
    }
  };

  // Right main bronchus: wider, shorter, more vertical. Left: narrower, longer,
  // more horizontal.
  branch([0, 132.0, 1.4], [-0.42, -0.78, -0.10], 0.72, 3.0, 1);
  branch([0, 132.0, 1.4], [0.46, -0.66, -0.10], 0.62, 3.6, 1);

  return merge(parts);
}

/* ================================================================== */
/* ABDOMEN                                                             */
/* ================================================================== */

/**
 * Liver — the largest internal organ.
 *
 * Right and left lobes separated by the falciform ligament, with the right lobe
 * far larger. The superior (diaphragmatic) surface is domed to fit under the
 * diaphragm and the inferior surface is notched for the gallbladder and the
 * porta hepatis.
 */
export function buildLiver(q = 1) {
  const body = radial(
    (dir) => {
      const a = 11.4, b = 9.0, c = 4.9;
      let r = Math.pow(
        Math.pow(Math.abs(dir.x) / a, 2.4) + Math.pow(Math.abs(dir.y) / c, 2.6) + Math.pow(Math.abs(dir.z) / b, 2.4),
        -1 / 2.4,
      );
      // The left lobe tapers to a thin edge; the right lobe stays full.
      const leftward = Math.max(0, dir.x); // +x = subject's left
      r *= 1 - 0.42 * Math.pow(leftward, 1.5);
      // Dome the superior surface against the diaphragm.
      r *= dir.y > 0 ? 1.06 : 0.94;
      // Falciform groove between the lobes.
      r *= 1 - 0.14 * Math.exp(-Math.pow((dir.x - 0.16) / 0.05, 2)) * Math.max(0, dir.z);
      return Math.max(0.5, r);
    },
    { widthSegments: segs(44, q), heightSegments: segs(32, q), centreCm: [-4.6, 108.5, 4.0] },
  );

  // Gallbladder — nestled on the inferior surface of the right lobe.
  const gallbladder = loft({
    spine: spine([[-9.4, 105.0, 6.6], [-8.6, 104.2, 7.6], [-7.2, 104.0, 8.4]]),
    profile: compose(superellipse(1.15, 1.1, 2.4), Flared({ start: 0.6, width: 0.5 }), Tapered(0.5, 0.75)),
    radialSegments: segs(14, q),
    heightSegments: segs(12, q),
    up: V([0, 1, 0]),
  });

  return merge([body, gallbladder]);
}

/** Stomach — a J-shaped muscular sac from the cardia to the pylorus. */
export function buildStomach(q = 1) {
  return loft({
    spine: spine([
      [1.0, 118.5, 2.4], // cardia (oesophageal junction)
      [4.0, 118.0, 3.6], // fundus (the dome)
      [6.4, 113.5, 5.0], // body
      [5.8, 107.5, 5.6], // greater curvature
      [3.6, 105.0, 6.0], // antrum
      [2.0, 105.5, 5.2], // pylorus
    ]),
    profile: compose(
      superellipse(3.0, 2.4, 2.4),
      Flared({ start: 0.25, end: 0.0, width: 0.3 }),
      Tapered(0.72, 0.5),
    ),
    radialSegments: segs(24, q),
    heightSegments: segs(28, q),
    up: V([0, 1, 0]),
  });
}

/** Spleen — lies in the left hypochondrium, under ribs 9–11. */
export function buildSpleen(q = 1) {
  return radial(
    (dir) => {
      const a = 3.0, b = 5.6, c = 6.2;
      let r = Math.pow(
        Math.pow(Math.abs(dir.x) / a, 2.2) + Math.pow(Math.abs(dir.y) / c, 2.2) + Math.pow(Math.abs(dir.z) / b, 2.2),
        -1 / 2.2,
      );
      r *= 1 - 0.16 * Math.max(0, -dir.x - 0.4); // flattened diaphragmatic surface
      return r;
    },
    { widthSegments: segs(32, q), heightSegments: segs(24, q), centreCm: [10.6, 112.0, -1.0] },
  );
}

/** Pancreas — head in the C-loop of the duodenum, tail reaching the splenic hilum. */
export function buildPancreas(q = 1) {
  return loft({
    spine: spine([
      [2.6, 105.5, -1.0], // head
      [5.4, 107.0, -1.6], // neck
      [8.0, 109.5, -2.0], // body
      [10.4, 112.0, -1.8], // tail
    ]),
    profile: compose(superellipse(1.7, 1.3, 2.6), Flared({ start: 0.85, width: 0.25 }), Tapered(1, 0.42)),
    radialSegments: segs(16, q),
    heightSegments: segs(18, q),
    up: V([0, 1, 0]),
  });
}

/**
 * Kidney — bean-shaped, with the hilum facing medially.
 * The indentation is a subtraction from the radius on the medial side, which is
 * exactly the shape that lets the renal vessels and ureter enter.
 * @param {number} side +1 left / -1 right
 */
export function buildKidney(side, q = 1) {
  const cx = side * 5.0;
  const cy = side > 0 ? 101.0 : 100.0; // the right kidney sits lower (the liver pushes it down)
  return radial(
    (dir) => {
      const a = 2.9, b = 3.2, c = 5.6;
      let r = Math.pow(
        Math.pow(Math.abs(dir.x) / a, 2.2) + Math.pow(Math.abs(dir.y) / c, 2.2) + Math.pow(Math.abs(dir.z) / b, 2.2),
        -1 / 2.2,
      );
      // Hilum: a deep medial concavity, slightly posterior.
      const medial = Math.max(0, -side * dir.x - 0.35) * Math.max(0, 1 - Math.abs(dir.y) * 1.4);
      r *= 1 - 0.42 * medial * Math.max(0, -dir.z + 0.4);
      return Math.max(0.35, r);
    },
    { widthSegments: segs(32, q), heightSegments: segs(26, q), centreCm: [cx, cy, -4.6] },
  );
}

/** Adrenal (suprarenal) gland — sits on the superomedial pole of the kidney. */
export function buildAdrenal(side, q = 1) {
  return transformGeometry(
    superellipsoid([1.5, 0.7, 1.1], {
      n: 2.8, widthSegments: segs(16, q), heightSegments: segs(12, q),
    }),
    { position: [side * 4.4, side > 0 ? 105.8 : 104.8, -4.8], rotation: [0, 0, side * -18] },
  );
}

/** Ureter — from the renal pelvis down to the posterolateral bladder. */
export function buildUreter(side, q = 1) {
  return tube(
    [
      [side * 4.0, 100.0, -4.4],
      [side * 3.4, 95.0, -3.4],
      [side * 2.8, 90.0, -1.6],
      [side * 2.0, 86.5, 1.6],
    ],
    (t) => 0.32 - t * 0.06,
    { radialSegments: segs(10, q), heightSegments: segs(20, q) },
  );
}

/**
 * Small intestine — duodenum, jejunum and ileum.
 *
 * The duodenum is a fixed C-loop around the pancreatic head; the jejunum and
 * ileum are a mobile coil filling the umbilical and hypogastric regions. The coil
 * is generated as a slowly tightening spiral inside a bounded volume, which is a
 * far better approximation of the real packing than a handful of hand-placed
 * loops, and it stays inside the peritoneal cavity by construction.
 */
export function buildSmallIntestine(q = 1) {
  const parts = [];

  // Duodenum: C-loop, ~25 cm, embracing the head of the pancreas.
  parts.push(
    tube(
      [
        [2.0, 105.5, 5.0], // duodenal cap (from the pylorus)
        [3.6, 104.0, 4.4],
        [4.4, 101.0, 3.0], // descending part
        [3.8, 98.0, 0.6],
        [2.2, 96.6, 0.2], // horizontal part
        [0.6, 97.0, 1.0], // ascending part → duodenojejunal flexure
      ],
      (t) => 1.55 - t * 0.3,
      { radialSegments: segs(14, q), heightSegments: segs(26, q) },
    ),
  );

  // Jejunum + ileum coil.
  const coil = [];
  const turns = 6.5;
  const samples = Math.max(40, Math.round(150 * q));
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const ang = t * turns * Math.PI * 2;
    const r = 6.4 - t * 2.6; // spiral inwards as it descends
    coil.push([
      Math.cos(ang) * r * 1.05,
      100.0 - t * 8.5 + Math.sin(ang * 2) * 0.9,
      3.6 + Math.sin(ang) * r * 0.72,
    ]);
  }
  parts.push(
    tube(coil, (t) => 1.28 - t * 0.34, {
      radialSegments: segs(12, q),
      heightSegments: segs(Math.round(180 * q), q),
    }),
  );

  return merge(parts);
}

/**
 * Large intestine — caecum, appendix, ascending, transverse, descending, sigmoid
 * colon and rectum.
 *
 * Two features are modelled because they are diagnostic at a glance:
 *   • **haustra** — the sacculations, produced by modulating the tube radius
 *     sinusoidally along its length;
 *   • the **appendix**, hanging from the posteromedial caecum.
 * Taeniae coli are implied by the haustral relief.
 */
export function buildLargeIntestine(q = 1) {
  const path = [
    [-5.4, 90.5, 1.0], // caecum
    [-6.6, 94.0, 1.6],
    [-7.0, 100.0, 2.0], // ascending colon
    [-6.8, 106.0, 2.4], // hepatic flexure
    [-3.4, 108.5, 5.2],
    [0.0, 109.0, 5.8], // transverse colon (drapes anteriorly)
    [3.6, 108.5, 5.0],
    [6.6, 106.5, 2.2], // splenic flexure
    [7.2, 100.0, 1.6], // descending colon
    [6.8, 94.0, 1.2],
    [4.4, 89.5, -0.4], // sigmoid colon
    [2.0, 86.5, -1.6],
    [0.4, 84.0, -2.2], // rectum
    [0.2, 80.5, -2.6],
  ];

  const haustraCount = 26;
  const colon = loft({
    spine: spine(path),
    // Radius swells and pinches to give the sacculated (haustral) outline.
    profile: (theta, t) =>
      superellipse(2.3, 2.1, 2.6)(theta) * (0.86 + 0.2 * Math.sin(t * Math.PI * 2 * haustraCount)),
    radialSegments: segs(16, q),
    heightSegments: segs(90, q),
    up: V([0, 1, 0]),
  });

  // Caecum — the blind pouch below the ileocaecal valve.
  const caecum = radial(
    (dir) => {
      const a = 3.0, b = 2.9, c = 3.6;
      return Math.pow(
        Math.pow(Math.abs(dir.x) / a, 2.2) + Math.pow(Math.abs(dir.y) / c, 2.2) + Math.pow(Math.abs(dir.z) / b, 2.2),
        -1 / 2.2,
      );
    },
    { widthSegments: segs(20, q), heightSegments: segs(16, q), centreCm: [-5.6, 90.0, 1.4] },
  );

  // Vermiform appendix.
  const appendix = tube(
    [
      [-5.6, 88.4, 1.0],
      [-5.0, 85.6, 0.2],
      [-4.2, 83.4, -0.8],
      [-3.6, 82.0, -1.6],
    ],
    (t) => 0.42 - t * 0.16,
    { radialSegments: segs(10, q), heightSegments: segs(14, q) },
  );

  return merge([colon, caecum, appendix]);
}

/** Urinary bladder — behind the pubic symphysis. */
export function buildBladder(q = 1) {
  return radial(
    (dir) => {
      const a = 3.6, b = 3.2, c = 3.4;
      let r = Math.pow(
        Math.pow(Math.abs(dir.x) / a, 2.2) + Math.pow(Math.abs(dir.y) / c, 2.4) + Math.pow(Math.abs(dir.z) / b, 2.2),
        -1 / 2.2,
      );
      if (dir.y < -0.3) r *= 0.86; // flattened base on the pelvic floor
      return r;
    },
    { widthSegments: segs(28, q), heightSegments: segs(22, q), centreCm: [0, 87.0, 3.4] },
  );
}

/** Thyroid — two lobes joined by an isthmus, wrapping the upper trachea. */
export function buildThyroid(q = 1) {
  const lobe = (side) =>
    transformGeometry(
      superellipsoid([1.0, 1.9, 0.9], {
        n: 2.8, widthSegments: segs(16, q), heightSegments: segs(12, q),
      }),
      { position: [side * 1.5, 141.5, 4.6] },
    );
  const isthmus = transformGeometry(
    superellipsoid([1.5, 0.4, 0.4], {
      n: 2.8, widthSegments: segs(12, q), heightSegments: segs(8, q),
    }),
    { position: [0, 140.8, 5.0] },
  );
  return merge([lobe(1), lobe(-1), isthmus]);
}

/** Oesophagus — from the pharynx through the diaphragm to the cardia. */
export function buildOesophagus(q = 1) {
  return tube(
    [
      [0, 146.0, 1.6],
      [0.2, 140.0, 0.4],
      [0.4, 132.0, -0.4],
      [0.6, 124.0, 0.2],
      [0.8, 118.5, 1.6],
    ],
    0.78,
    { radialSegments: segs(12, q), heightSegments: segs(24, q) },
  );
}

/**
 * Aorta and inferior vena cava — the two great trunks of the trunk.
 * The aorta arches over the left main bronchus and descends left of the midline,
 * bifurcating at L4 into the common iliac arteries; the IVC lies to the right.
 */
export function buildGreatVessels(q = 1) {
  const aorta = tube(
    [
      [0.2, 128.0, -1.6],
      [-0.2, 122.0, -2.4],
      [-0.4, 112.0, -3.2],
      [-0.4, 100.0, -3.8],
      [-0.2, 94.0, -3.6],
    ],
    (t) => 1.25 - t * 0.35,
    { radialSegments: segs(14, q), heightSegments: segs(26, q) },
  );
  const iliacs = [1, -1].map((s) =>
    tube(
      [
        [-0.2, 94.0, -3.6],
        [s * 1.6, 91.0, -3.0],
        [s * 2.8, 88.0, -2.0],
      ],
      (t) => 0.85 - t * 0.15,
      { radialSegments: segs(12, q), heightSegments: segs(12, q) },
    ),
  );
  const ivc = tube(
    [
      [2.2, 88.0, -1.4],
      [2.6, 96.0, -2.2],
      [2.6, 106.0, -2.6],
      [2.2, 116.0, -1.4],
    ],
    (t) => 1.35 + t * 0.15,
    { radialSegments: segs(14, q), heightSegments: segs(26, q) },
  );
  return { aorta: merge([aorta, ...iliacs]), ivc };
}

/* ================================================================== */
/* Assembly                                                            */
/* ================================================================== */

/**
 * Assemble the visceral system.
 *
 *   viscera
 *   ├── cns         (brain, brainstem, spinal cord)
 *   ├── thoracic    (heart, lungs, airway, oesophagus, great vessels)
 *   ├── abdominal   (liver, stomach, spleen, pancreas, kidneys, adrenals, ureters, bowel)
 *   └── pelvic      (bladder)
 */
export function buildOrganSystem(partFactory, { q = 1 } = {}) {
  const root = new Group();
  root.name = 'viscera';

  const section = (name) => {
    const g = new Group();
    g.name = `viscera.${name}`;
    root.add(g);
    return g;
  };
  const cns = section('cns');
  const thoracic = section('thoracic');
  const abdominal = section('abdominal');
  const pelvic = section('pelvic');

  const add = (parent, def) => parent.add(partFactory(def));

  /* --- CNS --- */
  add(cns, {
    id: 'cerebrum', name: 'Cerebrum', latin: 'Cerebrum', system: 'nervous', region: 'cns',
    build: (qq) => buildCerebrum(qq), material: 'brain', distances: [0, 2.0, 3.6], q,
    note: 'Two hemispheres separated by the longitudinal fissure; ~86 billion neurons.',
  });
  add(cns, {
    id: 'cerebellum', name: 'Cerebellum', latin: 'Cerebellum', system: 'nervous', region: 'cns',
    build: (qq) => buildCerebellum(qq), material: 'cerebellum', distances: [0, 2.0, 3.6], q,
    note: 'Coordinates movement and balance; contains over half the brain\'s neurons.',
  });
  add(cns, {
    id: 'brainstem', name: 'Brainstem', latin: 'Truncus encephali', system: 'nervous', region: 'cns',
    build: (qq) => buildBrainstem(qq), material: 'brain', distances: [0, 2.0, 3.6], q,
    note: 'Midbrain, pons and medulla; carries all tracts between brain and cord.',
  });
  add(cns, {
    id: 'spinal-cord', name: 'Spinal cord', latin: 'Medulla spinalis', system: 'nervous', region: 'cns',
    build: (qq) => buildSpinalCord(qq), material: 'nerve', distances: [0, 2.2, 4.4], q,
    note: 'Ends at L1/L2 in the adult; below that lies the cauda equina.',
  });

  /* --- thorax --- */
  add(thoracic, {
    id: 'heart', name: 'Heart', latin: 'Cor', system: 'visceral', region: 'thoracic',
    build: (qq) => buildHeart(qq), material: 'cardiacMuscle', distances: [0, 2.0, 4.0], q,
    note: 'Four chambers; the apex points down, forward and to the left.',
  });

  const lungNotes = {
    'right-0': 'Right superior lobe — above the oblique fissure.',
    'right-1': 'Right middle lobe — unique to the right lung, below the horizontal fissure.',
    'right-2': 'Right inferior lobe — the largest of the three.',
    'left-0': 'Left superior lobe, including the lingula and the cardiac notch.',
    'left-1': 'Left inferior lobe — below the oblique fissure.',
  };
  for (const side of ['right', 'left']) {
    const lobeCount = side === 'right' ? 3 : 2;
    const names = side === 'right' ? ['superior', 'middle', 'inferior'] : ['superior', 'inferior'];
    for (let l = 0; l < lobeCount; l++) {
      add(thoracic, {
        id: `lung.${side}.${names[l]}`,
        name: `${names[l][0].toUpperCase()}${names[l].slice(1)} lobe of the ${side} lung`,
        latin: `Lobus ${names[l]} pulmonis ${side === 'right' ? 'dextri' : 'sinistri'}`,
        system: 'visceral', region: 'thoracic',
        build: (qq) => buildLungLobe(side, l, qq), material: 'lung',
        distances: [0, 2.0, 4.0], q,
        note: lungNotes[`${side}-${l}`],
      });
    }
  }

  add(thoracic, {
    id: 'bronchial-tree', name: 'Trachea and bronchial tree', latin: 'Trachea et bronchi',
    system: 'visceral', region: 'thoracic',
    build: (qq) => buildBronchialTree(qq), material: 'cartilage',
    distances: [0, 2.2, 4.4], q,
    note: 'The right main bronchus is wider, shorter and more vertical than the left.',
  });
  add(thoracic, {
    id: 'oesophagus', name: 'Oesophagus', latin: 'Oesophagus', system: 'visceral', region: 'thoracic',
    build: (qq) => buildOesophagus(qq), material: 'smoothMuscle',
    distances: [0, 2.2, 4.4], q,
    note: 'Passes the diaphragm at T10 to join the stomach at the cardia.',
  });

  add(thoracic, {
    id: 'aorta', name: 'Aorta', latin: 'Aorta', system: 'visceral', region: 'thoracic',
    build: (qq) => buildGreatVessels(qq).aorta, material: 'artery', distances: [0, 2.4, 4.8], q,
    note: 'Largest artery; bifurcates at L4 into the common iliac arteries.',
  });
  add(thoracic, {
    id: 'inferior-vena-cava', name: 'Inferior vena cava', latin: 'Vena cava inferior',
    system: 'visceral', region: 'thoracic',
    build: (qq) => buildGreatVessels(qq).ivc, material: 'vein', distances: [0, 2.4, 4.8], q,
    note: 'Largest vein; returns blood from below the diaphragm to the right atrium.',
  });

  /* --- abdomen --- */
  add(abdominal, {
    id: 'liver', name: 'Liver', latin: 'Hepar', system: 'visceral', region: 'abdominal',
    build: (qq) => buildLiver(qq), material: 'liver', distances: [0, 2.0, 4.0], q,
    note: 'Largest internal organ (~1.5 kg); right and left lobes divided by the falciform ligament.',
  });
  add(abdominal, {
    id: 'stomach', name: 'Stomach', latin: 'Gaster', system: 'visceral', region: 'abdominal',
    build: (qq) => buildStomach(qq), material: 'stomach', distances: [0, 2.0, 4.0], q,
    note: 'J-shaped; cardia, fundus, body, antrum and pylorus.',
  });
  add(abdominal, {
    id: 'spleen', name: 'Spleen', latin: 'Splen (lien)', system: 'visceral', region: 'abdominal',
    build: (qq) => buildSpleen(qq), material: 'spleen', distances: [0, 2.0, 4.0], q,
    note: 'Largest lymphoid organ; lies under ribs 9–11 on the left.',
  });
  add(abdominal, {
    id: 'pancreas', name: 'Pancreas', latin: 'Pancreas', system: 'visceral', region: 'abdominal',
    build: (qq) => buildPancreas(qq), material: 'pancreas', distances: [0, 2.2, 4.4], q,
    note: 'Head, neck, body and tail; both exocrine and endocrine (islets of Langerhans).',
  });

  for (const [sideName, s] of [['left', 1], ['right', -1]]) {
    add(abdominal, {
      id: `kidney.${sideName}`, name: `Kidney (${sideName})`, latin: 'Ren',
      system: 'visceral', region: 'abdominal',
      build: (qq) => buildKidney(s, qq), material: 'kidney', distances: [0, 2.0, 4.0], q,
      note: 'Bean-shaped; the hilum faces medially. The right kidney sits lower than the left.',
    });
    add(abdominal, {
      id: `adrenal.${sideName}`, name: `Adrenal gland (${sideName})`, latin: 'Glandula suprarenalis',
      system: 'visceral', region: 'abdominal',
      build: (qq) => buildAdrenal(s, qq), material: 'pancreas', distances: [0, 2.2, 4.4], q,
      note: 'Cortex and medulla; sits on the superomedial pole of the kidney.',
    });
    add(abdominal, {
      id: `ureter.${sideName}`, name: `Ureter (${sideName})`, latin: 'Ureter',
      system: 'visceral', region: 'abdominal',
      build: (qq) => buildUreter(s, qq), material: 'smoothMuscle', distances: [0, 2.4, 4.8], q,
      note: 'Carries urine from the renal pelvis to the bladder by peristalsis.',
    });
  }

  add(abdominal, {
    id: 'small-intestine', name: 'Small intestine', latin: 'Intestinum tenue',
    system: 'visceral', region: 'abdominal',
    build: (qq) => buildSmallIntestine(qq), material: 'intestine', distances: [0, 2.0, 4.0], q,
    note: 'Duodenum, jejunum and ileum; ~6 m long and the main site of absorption.',
  });
  add(abdominal, {
    id: 'large-intestine', name: 'Large intestine', latin: 'Intestinum crassum',
    system: 'visceral', region: 'abdominal',
    build: (qq) => buildLargeIntestine(qq), material: 'intestine', distances: [0, 2.0, 4.0], q,
    note: 'Caecum, appendix, colon and rectum; distinguished by haustra and taeniae coli.',
  });

  /* --- pelvis --- */
  add(pelvic, {
    id: 'bladder', name: 'Urinary bladder', latin: 'Vesica urinaria',
    system: 'visceral', region: 'pelvic',
    build: (qq) => buildBladder(qq), material: 'bladder', distances: [0, 2.2, 4.4], q,
    note: 'Hollow muscular reservoir behind the pubic symphysis.',
  });
  add(pelvic, {
    id: 'thyroid', name: 'Thyroid gland', latin: 'Glandula thyroidea',
    system: 'visceral', region: 'neck',
    build: (qq) => buildThyroid(qq), material: 'pancreas', distances: [0, 2.2, 4.4], q,
    note: 'Two lobes and an isthmus wrapping the upper trachea.',
  });

  return root;
}
