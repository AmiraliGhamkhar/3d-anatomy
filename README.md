# 3D Human Anatomy — Three.js

An anatomically parameterised model of the human body for the web: **206 bones,
69 muscle parts, 28 viscera and CNS structures**, plus an anthropometric body
surface — assembled from procedural geometry rather than imported assets.

```js
import { AnatomyViewer } from '3d-anatomy';

new AnatomyViewer(document.getElementById('view'), {
  visible: { skeletal: true, muscular: true, visceral: false, integumentary: false },
}).init();
```

| | |
|---|---|
| Anatomical parts | 232 (each individually pickable and labelable) |
| Triangles @ highest LOD | 263,660 |
| Draw calls | 232 |
| Scene build time | ~435 ms (all systems, Node) |
| App bundle | 97.7 kB (31.8 kB gzip) + three.js |
| Tests | 109 passing |

---

## Why procedural, not imported meshes

The obvious approach is to import GLB scans. This project generates geometry
instead, and the reason is the thing the brief asks for — *accuracy* — combined
with the other thing it asks for — *performance*:

1. **Anatomy becomes data.** A rib is not 4,000 vertices; it is `{ width: 13.1,
   drop: 8.4, anteriorReach: 11.5, thickness: 0.52 }`. You can read the model
   against a textbook and correct it in place, which you cannot do with a
   sculpted mesh.
2. **LOD is exact and free.** Re-running the generator with fewer segments costs
   nothing at runtime, is deterministic, and cannot produce the flipped
   triangles and self-intersections a decimator introduces on thin structures
   like ribs, tendons and vessels.
3. **No asset pipeline, no network, no licence.** Every texture is synthesised
   from value noise into a `DataTexture`.

The tradeoff is stated plainly in [Accuracy](#accuracy-and-limitations).

---

## Architecture

```
src/
├── core/
│   ├── loft.js          the surface generator every mesh is built from
│   ├── Frame.js         rotation-minimising (parallel transport) frames
│   ├── Profile.js       cross-section radius functions + composable transforms
│   ├── builders.js      tube, radial, superellipsoid, extrudePlate, merge, mirrorX
│   ├── textures.js      procedural height → normal / roughness / AO maps
│   ├── materials.js     the tissue library + subsurface-scattering injection
│   ├── Part.js          one anatomical structure = one LOD + its metadata
│   ├── InstancedPart.js many small bones, one draw call, still pickable
│   ├── quality.js       tessellation budget, LOD construction, draw-call counts
│   ├── Performance.js   adaptive quality governor
│   └── units.js         cm/scene-unit convention + reference anthropometry
├── systems/
│   ├── SkeletonAxial.js         skull, vertebral column, thoracic cage
│   ├── SkeletonAppendicular.js  girdles and limbs
│   ├── MuscularSystem.js        34 named muscles × 2 sides + diaphragm
│   ├── OrganSystem.js           thoracic, abdominal, pelvic viscera + CNS
│   └── SurfaceSystem.js         anthropometric body surface
├── AnatomyViewer.js     renderer, lighting rig, controls, picking
└── app/                 the demo UI
```

### The loft engine

Every anatomical mesh — long bones, ribs, vertebrae, muscle bellies, tendons,
vessels, bronchi, intestines, ureters — is one swept surface:

```js
loft({
  spine: spine([[17.3, 137.0, 0.0], [18.5, 124.0, 0.2], [19.2, 113.5, 0.0]]), // cm
  profile: compose(superellipse(1.28, 1.22, 2.6), Flared({ start: 0.5, end: 0.55, width: 0.2 })),
  radialSegments: 16,
  heightSegments: 22,
});
```

Two details matter more than they look:

**Parallel transport, not Frenet frames.** Frenet frames derive their normal from
curvature, so they flip 180° at every inflection point. Anatomical spines are
full of them — the cervical lordosis → thoracic kyphosis transition, the
S-shaped clavicle, the sigmoid colon — and a Frenet-based loft visibly snaps at
each one. `Frame.js` integrates the frame along the curve instead, so it stays
continuous regardless of curvature sign. There is a regression test for exactly
this.

**Cross-section orientation is explicit.** The frame is
`normal = cross(tangent, up)`, `binormal = cross(tangent, normal)`. So for a
vertical spine seeded with `up = anterior`, the first profile axis is
mediolateral and the second is anteroposterior. Getting this wrong silently
produces a torso 30 cm deep and 23 cm wide — which it did, once, and the
measurement test caught it.

### Level of detail

Each part is a `THREE.LOD` whose tiers are *regenerated*, not decimated:

```js
buildLOD((q) => buildRib(7, 1, q), makeMesh, { distances: [0, 1.6, 3.2, 6.0] });
// rib #7: 700 → 350 → 180 → 78 triangles (88.9% reduction)
```

A single scalar `q ∈ (0,1]` drives every segment count in the project, so the
skeleton, musculature and viscera move between tiers coherently instead of one
system staying sharp while another goes flat.

### Instancing

Each hand has 27 bones and each foot 26 — 106 sub-centimetre meshes. The carpals,
metacarpals/metatarsals and phalanges are drawn as `InstancedMesh` with one
shared geometry and a per-instance matrix that scales and orients it. That is
**6 draw calls instead of 106**, and picking is preserved: three reports
`instanceId`, and each instance carries its own name and Latin term, so clicking
a middle phalanx still tells you *which* middle phalanx.

### Materials and lighting

Tissue shading rests on two things that are not colour swatches:

- **Translucency.** Skin, cartilage, lung and bowel wall are not opaque. A full
  BSSRDF is far too expensive for real time, so `materials.js` injects the
  Colbert & Křivánek "fast, cheap and convincing" term into three's physical
  BRDF by wrapping `RE_Direct`. It is view- and light-dependent, so a rim-lit ear
  reads correctly with no extra draw call. The injection is a text replacement,
  so a test runs it against three's **actual** `lights_physical_pars_fragment`
  chunk and asserts the signature still matches — if three ever renames the
  function, the test fails instead of the shading silently going flat.
- **Wetness.** Living tissue is fluid-coated: low roughness, a broad specular
  lobe, plus a sheen layer. Not a dry diffuse look.

The rig is a neutral PMREM environment (the dominant ambient term for PBR) plus a
warm key at the classic "anatomical plate" angle, a cool fill, and a rim light —
the rim is what separates overlapping structures of nearly the same colour, like
ribs over lung. ACES tone mapping plus material dithering stops banding in the
broad soft gradients that dominate tissue shading.

### Adaptive performance

`PerformanceGovernor` measures median frame time over a rolling 45-frame window
and walks a four-tier ladder, degrading in order of visibility: pixel ratio →
shadow maps → LOD distance bias. It ratchets down immediately but only climbs
back after sustained headroom, which stops oscillation. Outlier frames (tab
switches, GC pauses) are discarded so a single stall cannot trigger a quality
drop the device does not need.

---

## Accuracy and limitations

**What is modelled faithfully:**

- 206 adult bones, counted and asserted: 7 cervical / 12 thoracic / 5 lumbar
  vertebrae, sacrum, coccyx, 12 rib pairs, 8 carpals, 7 tarsals, 14 phalanges per
  hand and foot.
- The four physiological spinal curves, from landmark heights.
- Rib classification: 1–7 true, 8–10 false, 11–12 floating — with the correct
  anterior reach for each.
- Right lung three lobes, left lung two with the cardiac notch.
- Haustra and the vermiform appendix on the large intestine.
- Bean-shaped kidneys with a medially-facing hilum; the right sits lower.
- A thicker left ventricular wall; the right main bronchus wider, shorter and
  more vertical than the left.
- Segment lengths from published anthropometry (Winter): femur ~43 cm, humerus
  ~32 cm, hand 19 cm, biparietal breadth 15.2 cm, chest ~30 × 22 cm.

**What is deliberately approximated:**

- **Carpals and tarsals** are scaled superellipsoids, not individually shaped
  bones. At 1–2 cm they are instanced; their arrangement is accurate, their
  individual silhouettes are not.
- **Gyri and sulci** come from a normal map, not geometry. Modelling real
  convolutions would cost more triangles than the entire skeleton for detail
  invisible below ~20 cm.
- **Muscles** are 34 named groups with correct origins, insertions and belly
  shapes. Deep and small muscles (rotator cuff, intrinsic hand and foot muscles,
  pelvic floor) are not individually modelled.
- **Cortical and cancellous bone** are not distinguished structurally; the
  distinction is material only.
- The body is a **static reference in anatomical position**. There is no
  skeleton, skinning or animation rig, so joints do not articulate.

**Not verified in this environment:** shader compilation and the rasterised
image. The sandbox has no GPU, no GL libraries and no browser, so the WebGL
render itself was not executed here. Everything up to the renderer — scene
assembly, all 232 parts, the lighting rig, picking, projection, LOD and the
quality governor — is covered by headless tests. Run `npm run dev` to see it.

---

## Development

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production bundle
npm run preview   # serve the built bundle
npm test          # 109 tests
```

## Using the building blocks

The viewer is one option; the generators are exported for embedding in your own
scene.

```js
import {
  buildAxialSkeleton, buildMuscularSystem, buildOrganSystem,
  makePart, tissue, buildLOD,
} from '3d-anatomy';
import { Group } from 'three';

const root = new Group();

// Build just the thoracic cage at medium quality.
const partFactory = (def) =>
  makePart({ ...def, material: tissue(def.material) });

root.add(buildAxialSkeleton(partFactory, { q: 0.65, detail: 'bone-only' }));
scene.add(root);
```

Or generate a single structure:

```js
import { buildRib, buildMuscle, buildKidney, MUSCLES } from '3d-anatomy';

const rib = buildRib(7, /* side */ 1, /* quality */ 1);   // BufferGeometry
const kidney = buildKidney(-1, 1);
const biceps = buildMuscle(MUSCLES.find((m) => m.id === 'biceps-brachii'), 1);
```

### Coordinate convention

`x+` = subject's **left**, `y+` = **superior**, `z+` = **anterior**. Scene units
are metres; every anatomical definition is authored in centimetres and converted
once at the geometry boundary. The reference body is a 175 cm adult standing on
the ground plane.

### Adding a muscle

Append one entry to `MUSCLES`. Nothing else needs to change — the bilateral pair,
the LOD tiers, the metadata, the search index and the layer panel all follow:

```js
{
  id: 'supraspinatus',
  name: 'Supraspinatus',
  latin: 'M. supraspinatus',
  bilateral: true,
  tissue: 'skeletalMuscle',
  region: 'shoulder',
  points: [[4.0, 141.0, -3.5], [9.0, 142.0, -2.5], [16.0, 140.5, -0.5]],
  wMax: 1.4, dMax: 1.8, belly: 0.45, spread: 0.3,
  note: 'Initiates abduction; one of the four rotator cuff muscles.',
}
```

Remember the cross-section rule: with `up = [0,0,1]` (the default) `wMax` is
mediolateral and `dMax` is anteroposterior.

## API

```js
const viewer = new AnatomyViewer(container, options).init();

viewer.setSystemVisible('muscular', true);  // whole-system toggle
viewer.select('heart');                     // highlight + label
viewer.isolate('heart');                    // hide everything else
viewer.focus('femur.left');                 // frame one structure
viewer.frameAll();                          // frame the whole body
viewer.setSkinOpacity(0.15);                // ghost the body surface
viewer.pick(clientX, clientY);              // → { id, name, latin, note, ... }
viewer.governor.setTier('high');            // or 'auto' to re-enable adaptation
viewer.dispose();                           // free every GPU resource
```

## Licence

MIT. Anatomical reference values are from *Gray's Anatomy* (Standring),
*Gray's Anatomy for Students* (Drake), and Winter, *Biomechanics and Motor
Control of Human Movement*. This is an educational visualisation, not a
clinical or diagnostic tool.
