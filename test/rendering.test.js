/**
 * rendering.test.js — materials, textures, LOD and the performance governor.
 *
 * These can all run headless. The most important one is the subsurface-scattering
 * injection: it patches three's physical BRDF by text replacement, so it is
 * tested against the *actual* r180 shader chunk rather than a hand-written stub.
 * If three ever renames `RE_Direct_Physical`, this test fails instead of the
 * tissue shading silently going flat in the browser.
 */
import { describe, expect, it } from 'vitest';
import { Color, ShaderChunk, ShaderLib } from 'three';
import { tissue, sharedTissue, TISSUE_COLORS, disposeMaterialCache } from '../src/core/materials.js';
import {
  buildTissueMaps,
  fbm,
  heightField,
  normalMapFromHeight,
  valueNoise,
} from '../src/core/textures.js';
import { QUALITY_TIERS, segs, buildLOD, setLODBias, countTriangles } from '../src/core/quality.js';
import { PerformanceGovernor } from '../src/core/Performance.js';
import { superellipsoid, triangleCount } from '../src/core/builders.js';
import { buildRib } from '../src/systems/SkeletonAxial.js';

/* ================================================================== */
/* Materials & the subsurface-scattering injection                     */
/* ================================================================== */

describe('tissue materials', () => {
  it('creates a physical material with procedural detail maps', () => {
    const m = tissue('skeletalMuscle');
    expect(m.type).toBe('MeshPhysicalMaterial');
    expect(m.normalMap).toBeTruthy();
    expect(m.roughnessMap).toBeTruthy();
    expect(m.aoMap).toBeTruthy();
    expect(m.color.getHexString()).toBe(TISSUE_COLORS.skeletalMuscle.slice(1));
    expect(m.metalness).toBe(0); // tissue is a dielectric
    expect(m.dithering).toBe(true);
  });

  it('shares one texture set across repeated tissues', () => {
    const a = sharedTissue('corticalBone');
    const b = sharedTissue('corticalBone');
    expect(a).toBe(b);
    expect(a.normalMap).toBe(b.normalMap);
    disposeMaterialCache();
  });

  it('configures translucency only for tissues that actually scatter light', () => {
    // three gives every Material a default no-op onBeforeCompile, so the marker
    // for a patched material is the userData.sss block withSubsurface() installs.
    for (const name of ['skin', 'lung', 'liver', 'skeletalMuscle', 'cartilage']) {
      const m = tissue(name);
      expect(m.userData.sss, `${name} should be translucent`).toBeTruthy();
      expect(m.userData.sss.strength).toBeGreaterThan(0);
      expect(m.onBeforeCompile).toBeTypeOf('function');
    }
    // Dry, opaque tissue: no scattering term and no shader patch.
    const dry = tissue('cancellousBone');
    expect(dry.userData.sss).toBeUndefined();
  });

  it('injects a valid RE_Direct wrapper into three\'s real physical shader chunk', () => {
    const material = tissue('skin');
    const uniforms = {};
    // The genuine chunk three compiles, not a stand-in.
    const chunk = ShaderChunk.lights_physical_pars_fragment;
    expect(chunk).toContain('#define RE_Direct');
    expect(chunk).toContain('RE_Direct_Physical');

    const shader = { uniforms, fragmentShader: chunk, vertexShader: '' };
    material.onBeforeCompile(shader, {});

    // The default define must have been replaced by our wrapper.
    expect(shader.fragmentShader).toContain('void RE_Direct_Tissue(');
    expect(shader.fragmentShader).toContain('#define RE_Direct RE_Direct_Tissue');
    expect(shader.fragmentShader).not.toMatch(/#define\s+RE_Direct\s+RE_Direct_Physical/);

    // The wrapper must still call the original BRDF, or we would lose specular.
    expect(shader.fragmentShader).toContain('RE_Direct_Physical(');

    // Uniforms must be registered so the values actually reach the GPU.
    for (const name of ['sssColor', 'sssStrength', 'sssPower', 'sssDistortion']) {
      expect(shader.uniforms[name], `missing uniform ${name}`).toBeTruthy();
      expect(shader.uniforms[name].value).toBeDefined();
    }
    expect(shader.uniforms.sssColor.value).toBeInstanceOf(Color);
  });

  it('matches three\'s current RE_Direct signature (guards against API drift)', () => {
    // If three changes the parameter list, the wrapper would fail to compile.
    const chunk = ShaderChunk.lights_physical_pars_fragment;
    const sig = chunk.match(/void RE_Direct_Physical\(([^)]*)\)/);
    expect(sig, 'could not find RE_Direct_Physical signature').toBeTruthy();
    expect(sig[1]).toContain('geometryPosition');
    expect(sig[1]).toContain('geometryNormal');
    expect(sig[1]).toContain('geometryViewDir');
    expect(sig[1]).toContain('inout ReflectedLight reflectedLight');

    const shader = { uniforms: {}, fragmentShader: chunk, vertexShader: '' };
    tissue('skin').onBeforeCompile(shader, {});
    const wrapped = shader.fragmentShader.match(/void RE_Direct_Tissue\(([^)]*)\)/);
    expect(wrapped[1].replace(/\s+/g, ' ')).toBe(sig[1].replace(/\s+/g, ' '));
  });

  it('declares every uniform it uses in the shader source', () => {
    const shader = { uniforms: {}, fragmentShader: ShaderChunk.lights_physical_pars_fragment, vertexShader: '' };
    tissue('lung').onBeforeCompile(shader, {});
    // Each uniform registered on the JS side must also be declared in GLSL,
    // otherwise the value is silently dropped at compile time.
    const declared = ['uniform vec3  sssColor', 'uniform float sssStrength', 'uniform float sssPower', 'uniform float sssDistortion'];
    for (const d of declared) expect(shader.fragmentShader).toContain(d);
    expect(Object.keys(shader.uniforms).sort()).toEqual(['sssColor', 'sssDistortion', 'sssPower', 'sssStrength']);
  });

  it('keeps the physical shader library intact for reference', () => {
    // Sanity check that we are patching a real, non-trivial shader.
    expect(ShaderLib.physical.fragmentShader).toContain('lights_physical_pars_fragment');
  });
});

/* ================================================================== */
/* Procedural textures                                                 */
/* ================================================================== */

describe('procedural textures', () => {
  it('value noise is deterministic and in [0,1]', () => {
    expect(valueNoise(3.25, 7.75, 8, 1)).toBe(valueNoise(3.25, 7.75, 8, 1));
    for (let i = 0; i < 200; i++) {
      const v = valueNoise(i * 0.37, i * 0.91, 16, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('tiles seamlessly — opposite edges agree', () => {
    const P = 16;
    for (let i = 0; i < 64; i++) {
      const y = i * 0.5;
      expect(valueNoise(0, y, P, 5)).toBeCloseTo(valueNoise(P, y, P, 5), 10);
      expect(valueNoise(y, 0, P, 5)).toBeCloseTo(valueNoise(y, P, P, 5), 10);
    }
  });

  it('fbm stays in range and varies with octaves', () => {
    const a = fbm(2.5, 3.5, { octaves: 1, basePeriod: 8 });
    const b = fbm(2.5, 3.5, { octaves: 5, basePeriod: 8 });
    for (const v of [a, b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(a).not.toBeCloseTo(b, 6);
  });

  it('produces unit-length normal vectors', () => {
    const h = heightField(32, (u, v) => Math.sin(u * 20) * Math.cos(v * 13));
    const nrm = normalMapFromHeight(h, 32, 3);
    expect(nrm.length).toBe(32 * 32 * 4);
    for (let i = 0; i < 32 * 32; i++) {
      const nx = nrm[i * 4] / 255 * 2 - 1;
      const ny = nrm[i * 4 + 1] / 255 * 2 - 1;
      const nz = nrm[i * 4 + 2] / 255 * 2 - 1;
      const len = Math.hypot(nx, ny, nz);
      // Quantised to 8 bits, so allow a generous tolerance.
      expect(len).toBeGreaterThan(0.85);
      expect(len).toBeLessThan(1.15);
      expect(nrm[i * 4 + 3]).toBe(255);
    }
  });

  it('builds a complete, correctly-sized map set', () => {
    const set = buildTissueMaps((size) => heightField(size, (u, v) => u * v), { size: 32, repeat: 3 });
    for (const tex of [set.normalMap, set.roughnessMap, set.aoMap]) {
      expect(tex.image.width).toBe(32);
      expect(tex.image.height).toBe(32);
      expect(tex.repeat.x).toBe(3);
      expect(tex.colorSpace).toBe(''); // non-colour data stays linear
      expect(tex.generateMipmaps).toBe(true);
    }
    expect(set.height.length).toBe(32 * 32);
  });

  it('generates finite values for every tissue height field', async () => {
    const { boneHeight, muscleHeight, cardiacHeight, parenchymaHeight, mucosaHeight, cortexHeight, skinHeight, fibrousHeight } =
      await import('../src/core/textures.js');
    for (const fn of [boneHeight, muscleHeight, cardiacHeight, parenchymaHeight, mucosaHeight, cortexHeight, skinHeight, fibrousHeight]) {
      const h = fn(32, 1);
      for (let i = 0; i < h.length; i++) {
        expect(Number.isFinite(h[i]), `${fn.name} produced a non-finite value`).toBe(true);
      }
    }
  });
});

/* ================================================================== */
/* LOD                                                                 */
/* ================================================================== */

describe('level of detail', () => {
  it('builds tiers with monotonically decreasing triangle counts', () => {
    const lod = buildLOD((q) => buildRib(7, 1, q), undefined, {
      distances: [0, 1.6, 3.2, 6.0],
    });
    const tris = lod.userData.triangles;
    expect(tris).toHaveLength(4);
    for (let i = 1; i < tris.length; i++) {
      expect(tris[i], `tier ${i} should be coarser than tier ${i - 1}`).toBeLessThan(tris[i - 1]);
    }
    // A meaningful reduction, not a rounding difference.
    expect(tris[tris.length - 1]).toBeLessThan(tris[0] * 0.4);
  });

  it('records authored distances so the governor can bias them', () => {
    const lod = buildLOD((q) => buildRib(3, 1, q), undefined, { distances: [0, 2, 4, 8] });
    expect(lod.userData.baseDistances).toEqual([0, 2, 4, 8]);
  });

  it('setLODBias rescales switch distances without rebuilding geometry', () => {
    const root = { children: [] };
    const lod = buildLOD((q) => buildRib(3, 1, q), undefined, { distances: [0, 2, 4, 8] });
    // A minimal traversable stand-in: reuse three's Object3D via the LOD itself.
    const touched = setLODBias(lod, 0.5);
    expect(touched).toBe(1);
    expect(lod.levels.map((l) => l.distance)).toEqual([0, 1, 2, 4]);
    setLODBias(lod, 1);
    expect(lod.levels.map((l) => l.distance)).toEqual([0, 2, 4, 8]);
    void root;
  });

  it('never lets a section collapse below a valid polygon', () => {
    expect(segs(16, 0.01)).toBeGreaterThanOrEqual(3);
    expect(segs(16, 1)).toBe(16);
    expect(segs(16, 0.5)).toBe(8);
  });

  it('counts triangles across LODs and plain meshes', () => {
    const g = superellipsoid([2, 2, 2], { widthSegments: 8, heightSegments: 6 });
    expect(triangleCount(g)).toBe(g.index.count / 3);
    const lod = buildLOD((q) => buildRib(5, 1, q), undefined, {});
    expect(countTriangles(lod)).toBe(lod.userData.triangles[0]);
  });

  it('defines four coherent quality tiers', () => {
    const names = Object.keys(QUALITY_TIERS);
    expect(names).toEqual(['low', 'medium', 'high', 'ultra']);
    let lastQ = 0;
    for (const name of names) {
      const t = QUALITY_TIERS[name];
      expect(t.q).toBeGreaterThan(lastQ);
      expect(t.dpr).toBeGreaterThanOrEqual(1);
      lastQ = t.q;
    }
  });
});

/* ================================================================== */
/* Performance governor                                                */
/* ================================================================== */

/** Minimal renderer stand-in — the governor only touches these members. */
function fakeRenderer() {
  return {
    domElement: { clientWidth: 1280, clientHeight: 720 },
    capabilities: { getMaxAnisotropy: () => 16 },
    shadowMap: { enabled: false },
    info: { render: { calls: 10, triangles: 1000 } },
    _dpr: 1,
    setPixelRatio(v) {
      this._dpr = v;
    },
  };
}

describe('PerformanceGovernor', () => {
  it('steps down when frames are slow', () => {
    const renderer = fakeRenderer();
    const gov = new PerformanceGovernor({ renderer, scene: null, targetFPS: 55 });
    gov.tierIndex = 0; // ultra
    const start = gov.tierName;

    // Feed 40 frames at ~30 fps.
    let now = 0;
    for (let i = 0; i < 40; i++) {
      now += 33;
      gov.update(now);
    }
    expect(gov.stats.fps).toBeLessThan(40);
    expect(gov.tierName).not.toBe(start);
    expect(TIER_RANK[gov.tierName]).toBeGreaterThan(TIER_RANK[start]);
  });

  it('does not climb back without sustained headroom', () => {
    const renderer = fakeRenderer();
    const gov = new PerformanceGovernor({ renderer, scene: null, targetFPS: 55 });
    gov.tierIndex = 3; // low
    let now = 0;
    // A few very fast frames is not enough to upgrade.
    for (let i = 0; i < 35; i++) {
      now += 8;
      gov.update(now);
    }
    expect(gov.stats.fps).toBeGreaterThan(100);
    expect(gov.tierName).toBe('low');
  });

  it('ignores outlier frame times from tab switches', () => {
    const renderer = fakeRenderer();
    const gov = new PerformanceGovernor({ renderer, scene: null, targetFPS: 55 });
    gov.tierIndex = 0;
    let now = 0;
    for (let i = 0; i < 40; i++) {
      now += 16;
      if (i === 20) now += 5000; // a 5 s stall must not poison the median
      gov.update(now);
    }
    expect(gov.stats.fps).toBeGreaterThan(50);
  });

  it('caps the pixel ratio by the tier pixel budget', () => {
    const renderer = fakeRenderer();
    const gov = new PerformanceGovernor({ renderer, scene: null });
    gov.setTier('low');
    // 1280×720 = 0.92 Mpx; the low budget is 1.2 Mpx, so dpr ≈ 1.14 at most.
    expect(renderer._dpr).toBeLessThanOrEqual(1.2);
    expect(renderer._dpr).toBeGreaterThanOrEqual(0.75);
  });

  it('reads renderer draw-call and triangle counts', () => {
    const renderer = fakeRenderer();
    const gov = new PerformanceGovernor({ renderer, scene: null });
    gov.update(16);
    expect(gov.stats.drawCalls).toBe(10);
    expect(gov.stats.triangles).toBe(1000);
  });

  it('can be forced to a named tier', () => {
    const gov = new PerformanceGovernor({ renderer: fakeRenderer(), scene: null });
    for (const name of ['low', 'medium', 'high', 'ultra']) {
      gov.setTier(name);
      expect(gov.tierName).toBe(name);
      expect(gov.q).toBe(QUALITY_TIERS[name].q);
    }
  });
});

const TIER_RANK = { ultra: 0, high: 1, medium: 2, low: 3 };
