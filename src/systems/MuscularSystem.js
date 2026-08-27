/**
 * MuscularSystem.js — the skeletal musculature.
 *
 * Every muscle is described by the two things anatomy actually defines it by:
 * its **origin**, its **insertion**, and the shape of the belly between them.
 * The generator lofts a cross-section along that path with a bell-shaped girth
 * envelope, so the muscle is thick through the belly and tapers to tendon at both
 * ends — fusiform for biceps, strap-like for sartorius, and a broad thin sheet
 * for latissimus dorsi, purely from the numbers in MUSCLES.
 *
 * CROSS-SECTION ORIENTATION (important when adding a muscle)
 *   The loft frame is normal = cross(tangent, up), binormal = cross(tangent, normal).
 *   • up = [0, 0, 1] (anterior)  → wMax is MEDIOLATERAL, dMax is ANTEROPOSTERIOR.
 *     Use this for vertical muscles (arm, thigh, leg, neck).
 *   • up = [0, 1, 0] (superior)  → wMax is ANTEROPOSTERIOR, dMax is SUPERIOR–INFERIOR.
 *     Use this for muscles that run sideways (trapezius, pectoralis, obliques).
 *
 * 34 named muscles × 2 sides, covering the surface anatomy you can actually see:
 * the torso's flexor/extensor sheets, the rotator-cuff region, both arm
 * compartments, the gluteal group, all three quadriceps heads you can see, the
 * hamstrings, and both leg compartments.
 */
import { Group, Vector3 } from 'three';
import { loft } from '../core/loft.js';
import { superellipse } from '../core/Profile.js';
import { merge, mirrorX, radial, spine } from '../core/builders.js';
import { segs } from '../core/quality.js';

const UP_ANTERIOR = [0, 0, 1];
const UP_SUPERIOR = [0, 1, 1e-4];

/**
 * Girth envelope for a muscle belly.
 *
 * A Gaussian centred on `belly` with width `spread`, clamped so the ends fall to
 * a thin tendon rather than to zero (a real tendon still has cross-section).
 */
function bellyProfile({ wMax, dMax, belly = 0.45, spread = 0.3, n = 2.6, tendon = 0.16 }) {
  const w0 = tendon;
  const d0 = tendon * 0.85;
  return (theta, t) => {
    const g = Math.exp(-Math.pow((t - belly) / spread, 2));
    const w = w0 + (wMax - w0) * g;
    const d = d0 + (dMax - d0) * g;
    return superellipse(w, d, n)(theta, t);
  };
}

/**
 * @param {object} def a MUSCLES entry
 * @param {number} q quality scalar
 */
export function buildMuscle(def, q = 1) {
  const {
    points,
    wMax,
    dMax,
    belly = 0.45,
    spread = 0.3,
    n = 2.6,
    tendon = 0.16,
    up = UP_ANTERIOR,
    radialSegments = 16,
    heightSegments = 26,
  } = def;

  return loft({
    spine: spine(points),
    profile: bellyProfile({ wMax, dMax, belly, spread, n, tendon }),
    radialSegments: segs(radialSegments, q),
    heightSegments: segs(heightSegments, q),
    up: new Vector3(up[0], up[1], up[2]),
    cap: true,
  });
}

/**
 * The muscle table. All coordinates are centimetres on the 175 cm reference body
 * (see units.js); `points` runs origin → belly → insertion.
 */
export const MUSCLES = Object.freeze([
  /* ---------------- head & neck ---------------- */
  {
    id: 'sternocleidomastoid', name: 'Sternocleidomastoid', latin: 'M. sternocleidomastoideus',
    bilateral: true, tissue: 'skeletalMuscle', region: 'neck',
    points: [[2.4, 140.0, 6.4], [3.1, 146.0, 3.2], [3.9, 152.0, -0.4], [4.3, 155.6, -2.3]],
    wMax: 1.35, dMax: 0.95, belly: 0.5, spread: 0.28,
    note: 'Rotates the head to the opposite side; the most prominent neck landmark.',
  },
  {
    id: 'masseter', name: 'Masseter', latin: 'M. masseter',
    bilateral: true, tissue: 'skeletalMuscle', region: 'head',
    points: [[5.6, 158.4, 1.4], [5.2, 156.0, 0.6], [4.7, 153.6, -0.3]],
    wMax: 1.15, dMax: 0.75, belly: 0.5, spread: 0.34, n: 3.2,
    note: 'Principal jaw-closing muscle; arises from the zygomatic arch.',
  },
  {
    id: 'temporalis', name: 'Temporalis', latin: 'M. temporalis',
    bilateral: true, tissue: 'skeletalMuscle', region: 'head',
    points: [[6.2, 167.0, -1.0], [5.6, 163.0, 0.4], [4.2, 160.5, 1.0], [3.7, 161.4, 1.2]],
    wMax: 1.0, dMax: 2.4, belly: 0.45, spread: 0.3, n: 3.0, up: UP_SUPERIOR,
    note: 'Fan-shaped jaw elevator filling the temporal fossa.',
  },

  /* ---------------- trunk, anterior ---------------- */
  {
    id: 'pectoralis-major', name: 'Pectoralis major', latin: 'M. pectoralis major',
    bilateral: true, tissue: 'skeletalMuscle', region: 'thorax',
    points: [[2.2, 136.0, 8.4], [8.0, 137.5, 7.2], [13.5, 138.0, 4.2], [16.6, 137.2, 1.6]],
    wMax: 2.2, dMax: 5.6, belly: 0.42, spread: 0.34, n: 3.0, up: UP_SUPERIOR,
    note: 'Clavicular and sternocostal heads; adducts and medially rotates the arm.',
  },
  {
    id: 'rectus-abdominis', name: 'Rectus abdominis', latin: 'M. rectus abdominis',
    bilateral: true, tissue: 'skeletalMuscle', region: 'abdomen',
    points: [[2.4, 91.0, 6.6], [3.0, 100.0, 8.0], [3.2, 110.0, 8.6], [3.0, 119.0, 8.4]],
    wMax: 3.4, dMax: 1.05, belly: 0.5, spread: 0.62, n: 3.4, up: UP_ANTERIOR,
    note: 'Segmented by tendinous intersections into the "six-pack"; flexes the trunk.',
  },
  {
    id: 'external-oblique', name: 'External oblique', latin: 'M. obliquus externus abdominis',
    bilateral: true, tissue: 'skeletalMuscle', region: 'abdomen',
    points: [[10.6, 122.0, 6.0], [12.2, 112.0, 6.6], [10.4, 102.0, 6.8], [6.4, 95.0, 7.0]],
    wMax: 1.0, dMax: 6.4, belly: 0.45, spread: 0.42, n: 3.2, up: UP_SUPERIOR,
    note: 'Broad aponeurotic sheet; fibres run inferomedially ("hands in pockets").',
  },
  {
    id: 'serratus-anterior', name: 'Serratus anterior', latin: 'M. serratus anterior',
    bilateral: true, tissue: 'skeletalMuscle', region: 'thorax',
    points: [[12.4, 132.0, 5.2], [13.4, 125.0, 3.0], [12.0, 118.0, 0.4], [8.4, 122.0, -4.4]],
    wMax: 1.1, dMax: 3.2, belly: 0.45, spread: 0.36, n: 3.0, up: UP_SUPERIOR,
    note: 'Digitations on the lateral chest wall; holds the scapula against the ribs.',
  },

  /* ---------------- trunk, posterior ---------------- */
  {
    id: 'trapezius', name: 'Trapezius', latin: 'M. trapezius',
    bilateral: true, tissue: 'skeletalMuscle', region: 'back',
    points: [[1.0, 150.0, -5.4], [6.0, 146.0, -6.4], [11.5, 144.0, -6.0], [16.6, 143.2, -3.0]],
    wMax: 2.6, dMax: 8.4, belly: 0.45, spread: 0.42, n: 3.2, up: UP_SUPERIOR,
    note: 'Diamond-shaped; descending, transverse and ascending fibres move the scapula.',
  },
  {
    id: 'latissimus-dorsi', name: 'Latissimus dorsi', latin: 'M. latissimus dorsi',
    bilateral: true, tissue: 'skeletalMuscle', region: 'back',
    points: [[2.6, 100.0, -5.6], [7.0, 112.0, -6.0], [12.0, 124.0, -4.4], [16.0, 134.0, -1.4]],
    wMax: 1.6, dMax: 7.6, belly: 0.4, spread: 0.42, n: 3.2, up: UP_SUPERIOR,
    note: 'Broadest muscle of the back; extends, adducts and medially rotates the arm.',
  },
  {
    id: 'erector-spinae', name: 'Erector spinae', latin: 'M. erector spinae',
    bilateral: true, tissue: 'skeletalMuscle', region: 'back',
    points: [[3.0, 92.0, -4.2], [3.2, 105.0, -4.6], [3.0, 120.0, -4.8], [2.6, 133.0, -4.4]],
    wMax: 2.2, dMax: 1.7, belly: 0.5, spread: 0.85, n: 3.0, up: UP_ANTERIOR,
    note: 'Iliocostalis, longissimus and spinalis columns; the chief spine extensors.',
  },
  {
    id: 'rhomboid-major', name: 'Rhomboid major', latin: 'M. rhomboideus major',
    bilateral: true, tissue: 'skeletalMuscle', region: 'back',
    points: [[1.6, 130.0, -5.8], [4.6, 126.0, -6.2], [7.8, 122.0, -6.0]],
    wMax: 0.9, dMax: 3.2, belly: 0.5, spread: 0.4, n: 3.0, up: UP_SUPERIOR,
    note: 'Retracts the scapula; deep to trapezius.',
  },

  /* ---------------- shoulder & arm ---------------- */
  {
    id: 'deltoid', name: 'Deltoid', latin: 'M. deltoideus',
    bilateral: true, tissue: 'skeletalMuscle', region: 'shoulder',
    points: [[14.6, 143.0, -1.0], [19.4, 141.0, 0.4], [20.4, 134.0, 0.6], [19.6, 127.6, 0.4]],
    wMax: 2.4, dMax: 3.4, belly: 0.4, spread: 0.3, n: 2.8, up: UP_ANTERIOR,
    note: 'Three parts (clavicular, acromial, spinal); the shoulder\'s rounded contour.',
  },
  {
    id: 'biceps-brachii', name: 'Biceps brachii', latin: 'M. biceps brachii',
    bilateral: true, tissue: 'skeletalMuscle', region: 'arm',
    points: [[16.2, 138.4, 1.0], [18.0, 130.0, 1.6], [18.7, 121.0, 1.4], [18.6, 112.0, 1.0]],
    wMax: 1.95, dMax: 1.75, belly: 0.45, spread: 0.28, up: UP_ANTERIOR,
    note: 'Two heads from the scapula; supinates the forearm and flexes the elbow.',
  },
  {
    id: 'brachialis', name: 'Brachialis', latin: 'M. brachialis',
    bilateral: true, tissue: 'skeletalMuscle', region: 'arm',
    points: [[17.6, 130.0, 0.6], [18.4, 122.0, 0.6], [18.8, 114.0, 0.4]],
    wMax: 1.7, dMax: 1.5, belly: 0.5, spread: 0.34, up: UP_ANTERIOR,
    note: 'Deep to biceps; the true workhorse of elbow flexion.',
  },
  {
    id: 'triceps-brachii', name: 'Triceps brachii', latin: 'M. triceps brachii',
    bilateral: true, tissue: 'skeletalMuscle', region: 'arm',
    points: [[16.4, 138.0, -1.6], [18.4, 129.0, -1.8], [19.0, 120.0, -1.6], [18.8, 112.4, -1.6]],
    wMax: 2.1, dMax: 1.9, belly: 0.42, spread: 0.3, up: UP_ANTERIOR,
    note: 'Three heads converging on the olecranon; extends the elbow.',
  },
  {
    id: 'brachioradialis', name: 'Brachioradialis', latin: 'M. brachioradialis',
    bilateral: true, tissue: 'skeletalMuscle', region: 'forearm',
    points: [[19.4, 114.0, 0.8], [20.4, 105.0, 1.2], [21.1, 96.0, 1.2], [21.0, 90.4, 0.8]],
    wMax: 1.3, dMax: 1.0, belly: 0.35, spread: 0.3, up: UP_ANTERIOR,
    note: 'Lateral forearm fusiform muscle; flexes the elbow in mid-pronation.',
  },
  {
    id: 'flexor-mass', name: 'Forearm flexors', latin: 'Mm. flexores antebrachii',
    bilateral: true, tissue: 'skeletalMuscle', region: 'forearm',
    points: [[18.2, 110.0, 1.4], [19.6, 102.0, 1.8], [20.4, 96.0, 1.6], [20.6, 91.0, 1.2]],
    wMax: 1.6, dMax: 1.4, belly: 0.3, spread: 0.3, up: UP_ANTERIOR,
    note: 'Superficial flexor compartment: pronator teres, FCR, palmaris longus, FCU.',
  },
  {
    id: 'extensor-mass', name: 'Forearm extensors', latin: 'Mm. extensores antebrachii',
    bilateral: true, tissue: 'skeletalMuscle', region: 'forearm',
    points: [[19.4, 111.0, -0.8], [20.2, 103.0, -0.6], [20.6, 96.0, -0.2], [20.4, 90.6, 0.2]],
    wMax: 1.4, dMax: 1.2, belly: 0.3, spread: 0.3, up: UP_ANTERIOR,
    note: 'Superficial extensor compartment arising from the lateral epicondyle.',
  },

  /* ---------------- hip & thigh ---------------- */
  {
    id: 'gluteus-maximus', name: 'Gluteus maximus', latin: 'M. gluteus maximus',
    bilateral: true, tissue: 'skeletalMuscle', region: 'gluteal',
    points: [[3.4, 95.0, -4.6], [7.6, 90.0, -6.2], [10.8, 86.0, -5.4], [11.6, 83.4, -2.2]],
    wMax: 3.4, dMax: 4.6, belly: 0.42, spread: 0.34, n: 2.8, up: UP_ANTERIOR,
    note: 'Largest muscle in the body; the chief extensor of the hip.',
  },
  {
    id: 'gluteus-medius', name: 'Gluteus medius', latin: 'M. gluteus medius',
    bilateral: true, tissue: 'skeletalMuscle', region: 'gluteal',
    points: [[8.0, 99.0, -3.6], [11.0, 95.0, -3.4], [11.8, 90.6, -1.4]],
    wMax: 2.6, dMax: 3.4, belly: 0.4, spread: 0.32, n: 2.8, up: UP_ANTERIOR,
    note: 'Principal hip abductor; keeps the pelvis level in single-leg stance.',
  },
  {
    id: 'tensor-fasciae-latae', name: 'Tensor fasciae latae', latin: 'M. tensor fasciae latae',
    bilateral: true, tissue: 'skeletalMuscle', region: 'hip',
    points: [[10.6, 100.0, 3.6], [12.6, 94.0, 2.4], [13.4, 86.0, 1.2], [13.0, 78.0, 0.8]],
    wMax: 1.5, dMax: 1.2, belly: 0.3, spread: 0.3, up: UP_ANTERIOR,
    note: 'Tenses the iliotibial tract from the anterior superior iliac spine.',
  },
  {
    id: 'iliopsoas', name: 'Iliopsoas', latin: 'M. iliopsoas',
    bilateral: true, tissue: 'skeletalMuscle', region: 'hip',
    points: [[4.0, 100.0, 1.0], [6.4, 94.0, 2.4], [8.0, 89.0, 2.0], [8.4, 84.0, -1.2]],
    wMax: 1.9, dMax: 1.7, belly: 0.45, spread: 0.32, up: UP_ANTERIOR,
    note: 'Psoas major plus iliacus; the strongest hip flexor. Deep to the inguinal ligament.',
  },
  {
    id: 'adductor-group', name: 'Adductors', latin: 'Mm. adductores',
    bilateral: true, tissue: 'skeletalMuscle', region: 'thigh',
    points: [[3.4, 87.0, 3.0], [6.4, 79.0, 1.4], [8.2, 70.0, -0.4], [9.0, 62.0, -1.2]],
    wMax: 2.4, dMax: 2.8, belly: 0.4, spread: 0.34, up: UP_ANTERIOR,
    note: 'Adductor longus, brevis and magnus; the medial thigh compartment.',
  },
  {
    id: 'rectus-femoris', name: 'Rectus femoris', latin: 'M. rectus femoris',
    bilateral: true, tissue: 'skeletalMuscle', region: 'thigh',
    points: [[10.0, 98.0, 4.4], [10.6, 84.0, 5.4], [10.2, 68.0, 5.0], [9.6, 53.0, 3.4]],
    wMax: 2.3, dMax: 1.9, belly: 0.45, spread: 0.3, up: UP_ANTERIOR,
    note: 'The only quadriceps head crossing both hip and knee; bipennate.',
  },
  {
    id: 'vastus-lateralis', name: 'Vastus lateralis', latin: 'M. vastus lateralis',
    bilateral: true, tissue: 'skeletalMuscle', region: 'thigh',
    points: [[12.2, 88.0, 1.6], [12.8, 76.0, 2.2], [12.0, 64.0, 2.4], [10.8, 53.0, 2.2]],
    wMax: 2.6, dMax: 2.4, belly: 0.45, spread: 0.34, up: UP_ANTERIOR,
    note: 'Largest quadriceps head; forms the lateral thigh contour.',
  },
  {
    id: 'vastus-medialis', name: 'Vastus medialis', latin: 'M. vastus medialis',
    bilateral: true, tissue: 'skeletalMuscle', region: 'thigh',
    points: [[8.4, 82.0, 2.4], [8.6, 70.0, 3.4], [8.6, 60.0, 3.4], [8.8, 52.0, 2.8]],
    wMax: 2.2, dMax: 2.0, belly: 0.55, spread: 0.3, up: UP_ANTERIOR,
    note: 'Its oblique distal fibres (VMO) stabilise the patella.',
  },
  {
    id: 'sartorius', name: 'Sartorius', latin: 'M. sartorius',
    bilateral: true, tissue: 'skeletalMuscle', region: 'thigh',
    points: [[11.0, 99.0, 4.0], [10.2, 84.0, 4.0], [9.0, 68.0, 3.0], [7.6, 54.0, 1.6]],
    wMax: 1.1, dMax: 0.75, belly: 0.5, spread: 0.7, n: 3.4, up: UP_ANTERIOR,
    note: 'Longest muscle in the body; runs obliquely across the front of the thigh.',
  },
  {
    id: 'biceps-femoris', name: 'Biceps femoris', latin: 'M. biceps femoris',
    bilateral: true, tissue: 'skeletalMuscle', region: 'thigh',
    points: [[8.6, 84.0, -3.6], [10.4, 72.0, -3.4], [11.2, 60.0, -3.0], [11.0, 50.0, -2.0]],
    wMax: 2.0, dMax: 1.8, belly: 0.45, spread: 0.32, up: UP_ANTERIOR,
    note: 'Lateral hamstring; flexes the knee and laterally rotates the leg.',
  },
  {
    id: 'semitendinosus', name: 'Semitendinosus & semimembranosus', latin: 'M. semitendinosus',
    bilateral: true, tissue: 'skeletalMuscle', region: 'thigh',
    points: [[7.6, 84.0, -3.2], [8.0, 72.0, -3.0], [8.2, 60.0, -2.6], [7.8, 50.0, -1.6]],
    wMax: 1.9, dMax: 1.9, belly: 0.45, spread: 0.34, up: UP_ANTERIOR,
    note: 'Medial hamstrings; the semitendinosus tendon is a common graft source.',
  },

  /* ---------------- leg ---------------- */
  {
    id: 'tibialis-anterior', name: 'Tibialis anterior', latin: 'M. tibialis anterior',
    bilateral: true, tissue: 'skeletalMuscle', region: 'leg',
    points: [[9.2, 45.0, 1.6], [9.0, 34.0, 1.6], [8.4, 22.0, 1.2], [7.6, 10.0, 1.4]],
    wMax: 1.35, dMax: 1.1, belly: 0.3, spread: 0.3, up: UP_ANTERIOR,
    note: 'Dorsiflexes and inverts the foot; sits beside the tibial crest.',
  },
  {
    id: 'fibularis-longus', name: 'Fibularis (peroneus) longus', latin: 'M. fibularis longus',
    bilateral: true, tissue: 'skeletalMuscle', region: 'leg',
    points: [[10.6, 45.0, 0.2], [10.6, 33.0, 0.2], [10.0, 21.0, 0.0], [9.4, 10.0, -0.2]],
    wMax: 1.2, dMax: 1.0, belly: 0.28, spread: 0.3, up: UP_ANTERIOR,
    note: 'Everts the foot; its tendon crosses the sole to the medial cuneiform.',
  },
  {
    id: 'gastrocnemius', name: 'Gastrocnemius', latin: 'M. gastrocnemius',
    bilateral: true, tissue: 'skeletalMuscle', region: 'leg',
    points: [[9.8, 51.0, -2.4], [9.8, 40.0, -3.4], [9.2, 28.0, -2.6], [8.6, 16.0, -1.8]],
    wMax: 2.1, dMax: 1.9, belly: 0.32, spread: 0.28, up: UP_ANTERIOR,
    note: 'Two-headed calf muscle crossing knee and ankle; the calf contour.',
  },
  {
    id: 'soleus', name: 'Soleus', latin: 'M. soleus',
    bilateral: true, tissue: 'skeletalMuscle', region: 'leg',
    points: [[9.0, 45.0, -2.0], [9.0, 34.0, -2.8], [8.6, 22.0, -2.2], [8.4, 12.0, -1.6]],
    wMax: 1.9, dMax: 1.5, belly: 0.4, spread: 0.36, up: UP_ANTERIOR,
    note: 'Deep to gastrocnemius; the main postural plantarflexor.',
  },
  {
    id: 'achilles-tendon', name: 'Calcaneal (Achilles) tendon', latin: 'Tendo calcaneus',
    bilateral: true, tissue: 'tendon', region: 'leg',
    points: [[8.6, 17.0, -1.9], [8.4, 12.0, -2.2], [8.2, 7.0, -2.4], [8.2, 4.6, -2.6]],
    wMax: 0.6, dMax: 0.32, belly: 0.5, spread: 0.9, tendon: 0.5, n: 3.4, up: UP_ANTERIOR,
    note: 'Thickest and strongest tendon in the body; common insertion of the calf.',
  },
]);

/**
 * Diaphragm — the dome that separates thorax from abdomen.
 *
 * Built as the superior half of a flattened ellipsoid with a peripheral skirt,
 * because that is precisely what it is: a musculotendinous sheet domed into the
 * thoracic cavity, with the central tendon at the apex and the crura anchoring it
 * to the lumbar vertebrae.
 */
export function buildDiaphragm(q = 1) {
  const dome = radial(
    (dir, _theta, phi) => {
      // Only the upper hemisphere is diaphragm; taper the rim into the skirt.
      const y = dir.y;
      const a = 13.2; // transverse semi-axis (cm)
      const b = 10.8; // anteroposterior semi-axis
      const c = 6.4; // dome height
      let r =
        Math.pow(
          Math.pow(Math.abs(dir.x) / a, 2.2) +
            Math.pow(Math.abs(y) / c, 2.2) +
            Math.pow(Math.abs(dir.z) / b, 2.2),
          -1 / 2.2,
        );
      // Flatten the underside so it is a sheet, not a ball.
      if (y < 0) r *= 0.16 + 0.5 * Math.max(0, 1 + y * 1.4);
      return Math.max(0.25, r);
    },
    { widthSegments: segs(40, q), heightSegments: segs(28, q), centreCm: [0, 116.5, 0.5] },
  );

  // Crura — the two muscular pillars arising from the lumbar vertebrae and
  // forming the aortic and oesophageal hiatuses.
  const crus = (side) =>
    loft({
      spine: spine([
        [side * 1.6, 116.0, -1.0],
        [side * 2.0, 111.0, -2.2],
        [side * 2.2, 106.0, -3.0],
      ]),
      profile: (theta) => superellipse(0.9, 0.7, 2.8)(theta),
      radialSegments: segs(10, q),
      heightSegments: segs(10, q),
      up: new Vector3(0, 0, 1),
    });

  return merge([dome, crus(1), crus(-1)]);
}

/**
 * Assemble the muscular system.
 *
 * Node hierarchy:
 *   musculature
 *   ├── <region>            (head, neck, thorax, abdomen, back, shoulder, arm,
 *   │                        forearm, gluteal, hip, thigh, leg, respiratory)
 *   │   ├── <muscle>.left
 *   │   └── <muscle>.right
 *
 * Grouping by region means "show me the arm" or "hide the back" is one toggle.
 */
export function buildMuscularSystem(partFactory, { q = 1, include = null } = {}) {
  const root = new Group();
  root.name = 'musculature';
  const groups = new Map();

  const groupFor = (region) => {
    if (!groups.has(region)) {
      const g = new Group();
      g.name = `muscles.${region}`;
      root.add(g);
      groups.set(region, g);
    }
    return groups.get(region);
  };

  for (const def of MUSCLES) {
    if (include && !include.includes(def.id)) continue;

    if (def.bilateral) {
      // Author once (subject's left) and mirror — guarantees left/right symmetry.
      for (const [sideName, side] of [['left', 1], ['right', -1]]) {
        groupFor(def.region).add(
          partFactory({
            id: `${def.id}.${sideName}`,
            name: `${def.name} (${sideName})`,
            latin: def.latin,
            system: 'muscular',
            region: def.region,
            note: def.note,
            build: (qq) => {
              const d = { ...def, points: def.points };
              const g = buildMuscle(d, qq);
              return side > 0 ? g : mirrorX(g);
            },
            material: def.tissue ?? 'skeletalMuscle',
            distances: [0, 1.8, 3.4, 6.0],
            q,
          }),
        );
      }
    } else {
      groupFor(def.region).add(
        partFactory({
          id: def.id,
          name: def.name,
          latin: def.latin,
          system: 'muscular',
          region: def.region,
          note: def.note,
          build: (qq) => buildMuscle(def, qq),
          material: def.tissue ?? 'skeletalMuscle',
          distances: [0, 1.8, 3.4, 6.0],
          q,
        }),
      );
    }
  }

  // The diaphragm is midline, so it is a single part.
  groupFor('respiratory').add(
    partFactory({
      id: 'diaphragm',
      name: 'Diaphragm',
      latin: 'Diaphragma',
      system: 'muscular',
      region: 'respiratory',
      note: 'Principal muscle of respiration; its dome reaches the 5th intercostal space.',
      build: (qq) => buildDiaphragm(qq),
      material: 'skeletalMuscle',
      distances: [0, 2.2, 4.4],
      q,
    }),
  );

  return root;
}
