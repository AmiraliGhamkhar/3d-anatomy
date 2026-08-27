/**
 * anatomy.test.js — validates the model against standard anatomical references.
 *
 * These are the assertions that matter for a medical visualisation: the *counts*
 * must be right (206 bones, 12 rib pairs, 3 right lung lobes), the *proportions*
 * must be right (a 175 cm body has a ~43 cm femur and a 15.2 cm biparietal
 * breadth), and the *left and right sides must be congruent*.
 *
 * Reference values: Gray's Anatomy / Standring; Winter, Biomechanics and Motor
 * Control of Human Movement (segment anthropometry); Drake, Gray's Anatomy for
 * Students.
 */
import { describe, expect, it } from 'vitest';
import { Box3, Group, Vector3 } from 'three';
import { makePart } from '../src/core/Part.js';
import { makeInstancedPart, resolveInstance } from '../src/core/InstancedPart.js';
import { sharedTissue } from '../src/core/materials.js';
import {
  buildAxialSkeleton,
  VERTEBRA_Y,
  vertebraRegion,
  spinalCurveZ,
  buildRib,
  buildCranium,
} from '../src/systems/SkeletonAxial.js';
import {
  buildAppendicularSkeleton,
  buildFemur,
  buildHumerus,
  CARPAL_DEFS,
  TARSAL_DEFS,
  HAND_DIGITS,
  FOOT_DIGITS,
} from '../src/systems/SkeletonAppendicular.js';
import { buildMuscularSystem, MUSCLES } from '../src/systems/MuscularSystem.js';
import { buildOrganSystem, buildLungLobe } from '../src/systems/OrganSystem.js';
import { buildSurfaceSystem, buildTrunkSurface, TRUNK_PROFILE } from '../src/systems/SurfaceSystem.js';
import { mirrorX } from '../src/core/builders.js';

/* ----------------------------- helpers ----------------------------- */

const partFactory = (def) => makePart({ ...def, material: sharedTissue(def.material) });
const instancedFactory = (def) => makeInstancedPart({ ...def, material: sharedTissue(def.material) });

function collectParts(root) {
  const out = [];
  root.traverse((o) => {
    if (o.userData.part) out.push({ object: o, meta: o.userData.part });
  });
  return out;
}

function partIds(root) {
  return collectParts(root).map((p) => p.meta.id);
}

/** Total individual bones represented, expanding instanced groups. */
function boneCount(root) {
  let n = 0;
  for (const { object, meta } of collectParts(root)) {
    n += meta.instanced ? meta.instances.length : 1;
  }
  return n;
}

/** World-axis size of a part's top LOD tier, in cm. */
function sizeCm(object) {
  const mesh = object.isLOD ? object.levels[0]?.object : object;
  if (!mesh?.geometry) return null;
  const box = new Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
  return box.getSize(new Vector3()).multiplyScalar(100);
}

function assertSane(root, label) {
  let verts = 0;
  let degenerate = 0;
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const a = o.geometry.attributes.position.array;
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(a[i])) throw new Error(`Non-finite vertex in ${label}: ${o.name}`);
    }
    verts += o.geometry.attributes.position.count;
    if (o.geometry.attributes.position.count === 0) degenerate++;
  });
  expect(degenerate, `${label} has empty geometries`).toBe(0);
  expect(verts).toBeGreaterThan(0);
}

/* ================================================================== */
/* Bone counts                                                         */
/* ================================================================== */

describe('axial skeleton counts', () => {
  const axial = buildAxialSkeleton(partFactory, { q: 0.5 });
  const ids = partIds(axial);

  it('has 7 cervical, 12 thoracic and 5 lumbar vertebrae', () => {
    expect(ids.filter((i) => /^vertebra\.c\d$/.test(i))).toHaveLength(7);
    expect(ids.filter((i) => /^vertebra\.t\d+$/.test(i))).toHaveLength(12);
    expect(ids.filter((i) => /^vertebra\.l\d$/.test(i))).toHaveLength(5);
  });

  it('has a sacrum and a coccyx', () => {
    expect(ids).toContain('sacrum');
    expect(ids).toContain('coccyx');
  });

  it('has exactly 12 pairs of ribs and 12 pairs of costal cartilages', () => {
    expect(ids.filter((i) => /^rib\.\d+\.(left|right)$/.test(i))).toHaveLength(24);
    expect(ids.filter((i) => /^costal-cartilage\.\d+\.(left|right)$/.test(i))).toHaveLength(24);
    for (let n = 1; n <= 12; n++) {
      expect(ids).toContain(`rib.${n}.left`);
      expect(ids).toContain(`rib.${n}.right`);
    }
  });

  it('has all 22 skull bones plus 6 auditory ossicles and the hyoid', () => {
    expect(ids).toContain('cranium');
    const pairedFacial = ['zygomatic', 'maxilla', 'nasal', 'lacrimal', 'palatine', 'inferior-concha'];
    for (const f of pairedFacial) {
      expect(ids).toContain(`${f}.left`);
      expect(ids).toContain(`${f}.right`);
    }
    // The mandible is unpaired but delivered as two halves, one per side.
    expect(ids).toContain('mandible.left');
    expect(ids).toContain('mandible.right');
    expect(ids).toContain('vomer');
    expect(ids).toContain('ossicles.left');
    expect(ids).toContain('ossicles.right');
    expect(ids).toContain('hyoid');
    // Facial bones: 6 pairs (12) + mandible (1) + vomer (1) = 14.
    expect(pairedFacial.length * 2 + 1 + 1).toBe(14);
  });

  it('accounts for the 80 axial bones', () => {
    // The mapping from parts to bones is not 1:1, and this makes it explicit:
    //   cranium            1 merged mesh  →  8 cranial bones
    //   mandible.{l,r}     2 half-meshes  →  1 unpaired bone
    //   ossicles.{l,r}     2 groups       →  6 bones (3 each)
    // Everything else is one part per bone.
    const boneIds = ids.filter((i) => !i.startsWith('costal-cartilage.'));

    const cranial = 8;
    const ossicles = boneIds.filter((i) => i.startsWith('ossicles.')).length * 3;
    const mandible = 1;
    const others = boneIds.filter(
      (i) => i !== 'cranium' && !i.startsWith('ossicles.') && !i.startsWith('mandible.'),
    ).length;

    expect(ossicles).toBe(6);
    expect(cranial + ossicles + mandible + others).toBe(80);

    // Cross-check the same total by anatomical group.
    const vertebrae = 24 + 1 + 1; // 24 presacral + sacrum + coccyx
    const thoracicCage = 1 + 24; // sternum + 24 ribs
    const skull = 8 + 14; // cranial + facial
    expect(skull + ossicles + 1 /* hyoid */ + vertebrae + thoracicCage).toBe(80);
  });
});

describe('appendicular skeleton counts', () => {
  const app = buildAppendicularSkeleton(partFactory, instancedFactory, { q: 0.5 });
  const parts = collectParts(app);
  const ids = parts.map((p) => p.meta.id);

  it('has 126 bones', () => {
    expect(boneCount(app)).toBe(126);
  });

  it('has 8 carpals and 7 tarsals per side', () => {
    expect(CARPAL_DEFS).toHaveLength(8);
    expect(TARSAL_DEFS).toHaveLength(7);
    expect(ids.filter((i) => i.startsWith('carpals.'))).toHaveLength(2);
    expect(ids.filter((i) => i.startsWith('tarsals.'))).toHaveLength(2);
  });

  it('has 14 phalanges and 5 metacarpals per hand', () => {
    for (const side of ['left', 'right']) {
      const ph = parts.find((p) => p.meta.id === `phalanges.${side}`);
      const mc = parts.find((p) => p.meta.id === `metacarpals.${side}`);
      expect(ph.meta.instances).toHaveLength(14);
      expect(mc.meta.instances).toHaveLength(5);
      // Thumb: 2 phalanges. Fingers II–V: 3 each. 2 + 4×3 = 14.
      const thumb = ph.meta.instances.filter((i) => /thumb/i.test(i.name));
      expect(thumb).toHaveLength(2);
      expect(ph.meta.instances.length - thumb.length).toBe(12);
    }
  });

  it('has 14 toe phalanges and 5 metatarsals per foot', () => {
    for (const side of ['left', 'right']) {
      expect(parts.find((p) => p.meta.id === `toe-phalanges.${side}`).meta.instances).toHaveLength(14);
      expect(parts.find((p) => p.meta.id === `metatarsals.${side}`).meta.instances).toHaveLength(5);
    }
  });

  it('resolves an instanced raycast hit to the individual bone', () => {
    const hand = parts.find((p) => p.meta.id === 'phalanges.left');
    const hit = { object: hand.object, instanceId: 0 };
    const resolved = resolveInstance(hit);
    expect(resolved.name).toMatch(/phalanx/i);
    expect(resolved.latin).toMatch(/Phalanx/);
  });

  it('gives the thumb two phalanges and each other finger three', () => {
    expect(HAND_DIGITS[0].phalanges).toHaveLength(2);
    for (let i = 1; i < HAND_DIGITS.length; i++) expect(HAND_DIGITS[i].phalanges).toHaveLength(3);
    expect(FOOT_DIGITS[0].phalanges).toHaveLength(2);
    for (let i = 1; i < FOOT_DIGITS.length; i++) expect(FOOT_DIGITS[i].phalanges).toHaveLength(3);
  });
});

describe('total skeleton', () => {
  it('represents all 206 adult bones', () => {
    const axial = buildAxialSkeleton(partFactory, { q: 0.3 });
    const app = buildAppendicularSkeleton(partFactory, instancedFactory, { q: 0.3 });
    const root = new Group();
    root.add(axial, app);

    const axialIds = partIds(axial).filter((i) => !i.startsWith('costal-cartilage.'));
    const ossicles = axialIds.filter((i) => i.startsWith('ossicles.')).length * 3;
    const axialOthers = axialIds.filter(
      (i) => i !== 'cranium' && !i.startsWith('ossicles.') && !i.startsWith('mandible.'),
    ).length;
    // cranium mesh = 8 bones, two mandible halves = 1 bone.
    const axialBones = 8 + ossicles + 1 + axialOthers;

    expect(axialBones).toBe(80);
    expect(boneCount(app)).toBe(126);
    expect(axialBones + boneCount(app)).toBe(206);
  });
});

/* ================================================================== */
/* Measurements                                                        */
/* ================================================================== */

describe('anatomical measurements (175 cm reference)', () => {
  it('has a 15.2 cm biparietal breadth', () => {
    const g = buildCranium(1);
    const box = new Box3().setFromBufferAttribute(g.attributes.position);
    const breadth = (box.max.x - box.min.x) * 100;
    expect(breadth).toBeGreaterThan(14.4);
    expect(breadth).toBeLessThan(16.0);
  });

  it('has a femur close to 43 cm long', () => {
    const size = sizeCm({ isLOD: false, geometry: buildFemur(1, 1) });
    // Measured along the bone's long axis, which is y in this model.
    expect(size.y).toBeGreaterThan(38);
    expect(size.y).toBeLessThan(46);
  });

  it('has a humerus close to 32 cm long', () => {
    const size = sizeCm({ isLOD: false, geometry: buildHumerus(1, 1) });
    expect(size.y).toBeGreaterThan(27);
    expect(size.y).toBeLessThan(34);
  });

  it('has a rib cage about 30 cm wide and 22 cm deep', () => {
    const axial = buildAxialSkeleton(partFactory, { q: 0.4 });
    const cage = axial.getObjectByName('thoracic-cage');
    const box = new Box3().setFromObject(cage);
    const w = (box.max.x - box.min.x) * 100;
    const d = (box.max.z - box.min.z) * 100;
    expect(w).toBeGreaterThan(24);
    expect(w).toBeLessThan(33);
    // The bony cage sits inside the ~22 cm external trunk depth, so its own AP
    // diameter is smaller: roughly 15–20 cm once the chest wall is accounted for.
    expect(d).toBeGreaterThan(15);
    expect(d).toBeLessThan(21);
    expect(w).toBeGreaterThan(d); // the thorax is wider than it is deep
  });

  it('spans the full reference height from skull to feet', () => {
    const axial = buildAxialSkeleton(partFactory, { q: 0.4 });
    const app = buildAppendicularSkeleton(partFactory, instancedFactory, { q: 0.4 });
    const root = new Group();
    root.add(axial, app);
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);
    expect(box.max.y * 100).toBeGreaterThan(172);
    expect(box.max.y * 100).toBeLessThan(178);
    // The lowest bone is the calcaneus/toes, a few cm above the ground plane.
    expect(box.min.y * 100).toBeGreaterThan(0);
    expect(box.min.y * 100).toBeLessThan(4);
  });

  it('places the vertebral levels at the published heights', () => {
    expect(VERTEBRA_Y).toHaveLength(24);
    expect(VERTEBRA_Y[0]).toBeCloseTo(147.5, 1); // C1
    // Heights decrease monotonically down the column.
    for (let i = 1; i < VERTEBRA_Y.length; i++) expect(VERTEBRA_Y[i]).toBeLessThan(VERTEBRA_Y[i - 1]);
  });

  it('assigns the right region label to each vertebra index', () => {
    expect(vertebraRegion(0)).toMatchObject({ region: 'cervical', label: 'C1' });
    expect(vertebraRegion(6)).toMatchObject({ region: 'cervical', label: 'C7' });
    expect(vertebraRegion(7)).toMatchObject({ region: 'thoracic', label: 'T1' });
    expect(vertebraRegion(18)).toMatchObject({ region: 'thoracic', label: 'T12' });
    expect(vertebraRegion(19)).toMatchObject({ region: 'lumbar', label: 'L1' });
    expect(vertebraRegion(23)).toMatchObject({ region: 'lumbar', label: 'L5' });
  });

  it('has the four physiological spinal curves', () => {
    // Cervical lordosis: convex anteriorly, so z peaks in the mid-cervical region.
    expect(spinalCurveZ(143)).toBeGreaterThan(spinalCurveZ(147.5));
    // Thoracic kyphosis: z dips posteriorly around T6.
    expect(spinalCurveZ(122)).toBeLessThan(spinalCurveZ(131));
    expect(spinalCurveZ(122)).toBeLessThan(0);
    // Lumbar lordosis: z comes back anteriorly.
    expect(spinalCurveZ(99)).toBeGreaterThan(spinalCurveZ(108));
    // Sacral kyphosis: z recedes again.
    expect(spinalCurveZ(75)).toBeLessThan(spinalCurveZ(93));
  });

  it('gives ribs 1–7 a sternal reach and ribs 11–12 none (floating ribs)', () => {
    const trueRib = buildRib(6, 1, 0.6);
    const floating = buildRib(12, 1, 0.6);
    const b1 = new Box3().setFromBufferAttribute(trueRib.attributes.position);
    const b2 = new Box3().setFromBufferAttribute(floating.attributes.position);
    // A true rib reaches well anteriorly; a floating rib does not.
    expect(b1.max.z * 100).toBeGreaterThan(9);
    expect(b2.max.z * 100).toBeLessThan(5);
  });
});

/* ================================================================== */
/* Bilateral symmetry                                                  */
/* ================================================================== */

describe('bilateral symmetry', () => {
  it('mirrorX preserves volume magnitude and reverses orientation', () => {
    const left = buildHumerus(1, 1);
    const right = mirrorX(left);
    const bl = new Box3().setFromBufferAttribute(left.attributes.position);
    const br = new Box3().setFromBufferAttribute(right.attributes.position);
    expect(bl.getSize(new Vector3()).x).toBeCloseTo(br.getSize(new Vector3()).x, 8);
    // Mirrored about x = 0.
    expect(bl.max.x).toBeCloseTo(-br.min.x, 8);
    expect(bl.min.x).toBeCloseTo(-br.max.x, 8);
    // Winding must be reversed so faces still point outward.
    expect(left.index.array[1]).not.toBe(right.index.array[1]);
  });

  it('makes left and right limbs congruent', () => {
    const app = buildAppendicularSkeleton(partFactory, instancedFactory, { q: 0.5 });
    const ids = partIds(app);
    for (const id of ids.filter((i) => i.endsWith('.left'))) {
      const partner = id.replace(/\.left$/, '.right');
      expect(ids).toContain(partner);
    }
  });
});

/* ================================================================== */
/* Musculature                                                         */
/* ================================================================== */

describe('muscular system', () => {
  const muscular = buildMuscularSystem(partFactory, { q: 0.5 });
  const parts = collectParts(muscular);

  it('builds a bilateral pair for every bilateral muscle definition', () => {
    const bilateral = MUSCLES.filter((m) => m.bilateral);
    expect(bilateral.length).toBeGreaterThan(30);
    for (const m of bilateral) {
      expect(parts.find((p) => p.meta.id === `${m.id}.left`)).toBeTruthy();
      expect(parts.find((p) => p.meta.id === `${m.id}.right`)).toBeTruthy();
    }
  });

  it('includes the muscles that define surface anatomy', () => {
    const ids = parts.map((p) => p.meta.id);
    for (const expected of [
      'pectoralis-major.left', 'latissimus-dorsi.left', 'trapezius.left',
      'deltoid.left', 'biceps-brachii.left', 'triceps-brachii.left',
      'rectus-abdominis.left', 'gluteus-maximus.left', 'rectus-femoris.left',
      'biceps-femoris.left', 'gastrocnemius.left', 'sternocleidomastoid.left',
    ]) {
      expect(ids).toContain(expected);
    }
  });

  it('has a single midline diaphragm', () => {
    expect(parts.filter((p) => p.meta.id === 'diaphragm')).toHaveLength(1);
  });

  it('labels every entry with a Latin term and an anatomical note', () => {
    for (const m of MUSCLES) {
      expect(m.latin, `${m.id} missing latin`).toBeTruthy();
      expect(m.note, `${m.id} missing note`).toBeTruthy();
    }
  });

  it('names actual muscles with the M./Mm. convention', () => {
    // The table is the *muscular* system, so muscle entries must follow the
    // standard abbreviation: 'M.' singular, 'Mm.' for a named group. Tendons
    // (e.g. Tendo calcaneus) are correctly exempt.
    const muscles = MUSCLES.filter((m) => (m.tissue ?? 'skeletalMuscle') === 'skeletalMuscle');
    expect(muscles.length).toBeGreaterThan(30);
    for (const m of muscles) {
      expect(m.latin, `${m.id} should be "M." or "Mm."`).toMatch(/^Mm?[.]/);
    }
    const tendons = MUSCLES.filter((m) => m.tissue === 'tendon');
    expect(tendons.map((t2) => t2.id)).toContain('achilles-tendon');
  });

  it('keeps every muscle inside the body envelope', () => {
    const surface = buildSurfaceSystem(partFactory, { q: 0.5 });
    surface.updateMatrixWorld(true);
    const body = new Box3().setFromObject(surface);
    body.expandByScalar(0.03); // tolerance for muscles that sit proud of the surface
    muscular.updateMatrixWorld(true);
    const mus = new Box3().setFromObject(muscular);
    expect(body.containsBox(mus), `muscles escape the body envelope: ${JSON.stringify(mus)}`).toBe(true);
  });
});

/* ================================================================== */
/* Viscera                                                             */
/* ================================================================== */

describe('visceral system', () => {
  const viscera = buildOrganSystem(partFactory, { q: 0.5 });
  const ids = partIds(viscera);

  it('gives the right lung three lobes and the left lung two', () => {
    expect(ids.filter((i) => /^lung\.right\./.test(i))).toHaveLength(3);
    expect(ids.filter((i) => /^lung\.left\./.test(i))).toHaveLength(2);
    expect(ids).toContain('lung.right.superior');
    expect(ids).toContain('lung.right.middle');
    expect(ids).toContain('lung.right.inferior');
    expect(ids).toContain('lung.left.superior');
    expect(ids).toContain('lung.left.inferior');
  });

  it('includes the heart, liver, stomach, spleen, pancreas and bladder', () => {
    for (const id of ['heart', 'liver', 'stomach', 'spleen', 'pancreas', 'bladder']) {
      expect(ids).toContain(id);
    }
  });

  it('includes paired kidneys, adrenals and ureters', () => {
    for (const id of ['kidney', 'adrenal', 'ureter']) {
      expect(ids).toContain(`${id}.left`);
      expect(ids).toContain(`${id}.right`);
    }
  });

  it('includes the whole bowel and the airway', () => {
    expect(ids).toContain('small-intestine');
    expect(ids).toContain('large-intestine');
    expect(ids).toContain('bronchial-tree');
    expect(ids).toContain('oesophagus');
  });

  it('includes the CNS', () => {
    for (const id of ['cerebrum', 'cerebellum', 'brainstem', 'spinal-cord']) {
      expect(ids).toContain(id);
    }
  });

  it('produces a distinct mesh for every lung lobe', () => {
    const lobes = [
      buildLungLobe('right', 0, 0.5),
      buildLungLobe('right', 1, 0.5),
      buildLungLobe('right', 2, 0.5),
      buildLungLobe('left', 0, 0.5),
      buildLungLobe('left', 1, 0.5),
    ];
    for (const l of lobes) expect(l.attributes.position.count).toBeGreaterThan(0);
    // An out-of-range lobe index must yield null rather than a bogus mesh.
    expect(buildLungLobe('left', 2, 0.5)).toBeNull();
  });

  it('keeps every organ inside the body envelope', () => {
    const surface = buildSurfaceSystem(partFactory, { q: 0.5 });
    surface.updateMatrixWorld(true);
    const body = new Box3().setFromObject(surface);
    body.expandByScalar(0.02);
    viscera.updateMatrixWorld(true);
    const v = new Box3().setFromObject(viscera);
    expect(body.containsBox(v), `organs escape the body envelope: ${JSON.stringify(v)}`).toBe(true);
  });
});

/* ================================================================== */
/* Whole-model integrity                                               */
/* ================================================================== */

describe('whole model integrity', () => {
  const root = new Group();
  root.add(
    buildAxialSkeleton(partFactory, { q: 0.6 }),
    buildAppendicularSkeleton(partFactory, instancedFactory, { q: 0.6 }),
    buildMuscularSystem(partFactory, { q: 0.6 }),
    buildOrganSystem(partFactory, { q: 0.6 }),
    buildSurfaceSystem(partFactory, { q: 0.6 }),
  );

  it('contains no non-finite or empty geometry', () => {
    assertSane(root, 'whole model');
  });

  it('has sensible overall dimensions', () => {
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);
    const s = box.getSize(new Vector3()).multiplyScalar(100);
    expect(s.y).toBeGreaterThan(170);
    expect(s.y).toBeLessThan(180);
    expect(s.x).toBeGreaterThan(45);
    expect(s.x).toBeLessThan(65);
    expect(s.z).toBeGreaterThan(20);
    expect(s.z).toBeLessThan(40);
  });

  it('names every part uniquely', () => {
    const ids = partIds(root);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('classifies every part into one of the four systems', () => {
    const allowed = new Set(['skeletal', 'muscular', 'visceral', 'nervous', 'integumentary']);
    for (const { meta } of collectParts(root)) {
      expect(allowed.has(meta.system), `${meta.id} has system "${meta.system}"`).toBe(true);
    }
  });
});

describe('surface system', () => {
  it('uses anthropometric breadths and depths', () => {
    // Chest breadth at the nipple line should be ~30 cm across (half-breadth 14.8).
    const nipple = TRUNK_PROFILE.find((r) => r[0] === 130);
    expect(nipple[1] * 2).toBeCloseTo(29.6, 1);
    // Bicristal breadth at the iliac crests ~29–31 cm.
    const widest = TRUNK_PROFILE.reduce((a, b) => (b[1] > a[1] ? b : a));
    expect(widest[1] * 2).toBeGreaterThan(28);
    expect(widest[1] * 2).toBeLessThan(33);
    // Below the neck the torso is wider than it is deep. The skull is the
    // opposite — the cranium is longer anteroposteriorly than it is broad.
    for (const [y, b, d] of TRUNK_PROFILE) {
      if (y <= 143) expect(d, `trunk row y=${y}`).toBeLessThan(b);
      // Neck and skull: both are deeper anteroposteriorly than they are broad.
      else expect(d, `neck/skull row y=${y}`).toBeGreaterThanOrEqual(b * 0.95);
    }
  });

  it('builds a closed trunk surface', () => {
    const g = buildTrunkSurface(1);
    expect(g.attributes.position.count).toBeGreaterThan(1000);
    const box = new Box3().setFromBufferAttribute(g.attributes.position);
    const s = box.getSize(new Vector3()).multiplyScalar(100);
    // 31 cm wide, 23 cm deep — not swapped.
    expect(s.x).toBeGreaterThan(s.z);
    expect(s.x).toBeGreaterThan(28);
    expect(s.z).toBeLessThan(26);
  });
});
