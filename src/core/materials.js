/**
 * materials.js — the tissue material library.
 *
 * Two things make anatomical material look right, and neither is a colour swatch:
 *
 *  1. **Translucency.** Skin, cartilage, lung and bowel wall are not opaque —
 *     light enters, scatters, and leaves at a different point. A full BSSRDF is far
 *     too expensive for real time, so we use the Colbert & Křivánek "fast, cheap
 *     and convincing" translucency term, injected into three's physical BRDF by
 *     wrapping `RE_Direct`. It is view- and light-dependent, so a rim-lit ear or
 *     a backlit lung reads correctly without a single extra draw call.
 *
 *  2. **Wetness.** Living tissue is coated in fluid. That means low roughness with
 *     a broad specular lobe plus a sheen layer, rather than a dry diffuse look.
 *
 * Textures are generated once and shared: ~14 tissues reuse a handful of height
 * fields, so the whole model costs a few hundred KB of GPU memory instead of the
 * tens of MB a photographic PBR set would need.
 */
import { Color, MeshPhysicalMaterial } from 'three';
import {
  boneHeight,
  buildTissueMaps,
  cardiacHeight,
  cortexHeight,
  fibrousHeight,
  mucosaHeight,
  muscleHeight,
  parenchymaHeight,
  skinHeight,
} from './textures.js';

/* ------------------------------------------------------------------ */
/* Subsurface-scattering injection                                     */
/* ------------------------------------------------------------------ */

/**
 * GLSL wrapper around three's physical direct-light term. Adds a wrap-lighting
 * translucency contribution: light arriving from *behind* the surface (i.e.
 * `directLight.direction` opposed to `geometryViewDir`) leaks through as tinted
 * diffuse. `sssDistortion` bends the leak along the normal so thick, rounded
 * regions scatter more than thin flat ones.
 */
const TISSUE_RE_DIRECT = /* glsl */ `
void RE_Direct_Tissue(
  const in IncidentLight directLight,
  const in vec3 geometryPosition,
  const in vec3 geometryNormal,
  const in vec3 geometryViewDir,
  const in vec3 geometryClearcoatNormal,
  const in PhysicalMaterial material,
  inout ReflectedLight reflectedLight
) {
  RE_Direct_Physical(
    directLight, geometryPosition, geometryNormal, geometryViewDir,
    geometryClearcoatNormal, material, reflectedLight
  );
  vec3  scatterDir  = normalize( directLight.direction + geometryNormal * sssDistortion );
  float scatterCos  = clamp( dot( geometryViewDir, -scatterDir ), 0.0, 1.0 );
  float scatter     = pow( scatterCos, sssPower ) * sssStrength;
  reflectedLight.directDiffuse += directLight.color * sssColor * scatter;
}
#define RE_Direct RE_Direct_Tissue
`;

/** Match the `#define RE_Direct ... RE_Direct_Physical` line regardless of spacing. */
const RE_DIRECT_DEFINE = /#define\s+RE_Direct\s+RE_Direct_Physical/;

/**
 * Attach cheap subsurface scattering to a MeshPhysicalMaterial.
 * All callers share one `onBeforeCompile` source string, so three compiles a
 * single program for every tissue (customProgramCacheKey is derived from
 * `onBeforeCompile.toString()`) while each material keeps its own uniform values.
 */
function withSubsurface(material, sss = {}) {
  const color = new Color(sss.color ?? '#8a2b22');
  const strength = sss.strength ?? 0.5;
  const power = sss.power ?? 3;
  const distortion = sss.distortion ?? 0.35;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.sssColor = { value: color };
    shader.uniforms.sssStrength = { value: strength };
    shader.uniforms.sssPower = { value: power };
    shader.uniforms.sssDistortion = { value: distortion };

    shader.fragmentShader = `
      uniform vec3  sssColor;
      uniform float sssStrength;
      uniform float sssPower;
      uniform float sssDistortion;
      ${shader.fragmentShader}
    `.replace(RE_DIRECT_DEFINE, `${TISSUE_RE_DIRECT}`);
  };

  // Expose the live uniforms so the UI can drive them without recompiling.
  material.userData.sss = { color, strength, power, distortion };
  return material;
}

/* ------------------------------------------------------------------ */
/* Shared map cache                                                    */
/* ------------------------------------------------------------------ */

const mapCache = new Map();

/** Build (or reuse) the normal/roughness/AO set for a tissue height field. */
function maps(key, heightFn, opts) {
  const id = `${key}:${opts.size ?? 128}:${opts.repeat ?? 2}`;
  if (!mapCache.has(id)) mapCache.set(id, buildTissueMaps(heightFn, opts));
  return mapCache.get(id);
}

/** Release every generated texture. Call on teardown to avoid GPU leaks. */
export function disposeMaterials() {
  for (const set of mapCache.values()) {
    set.normalMap.dispose();
    set.roughnessMap.dispose();
    set.aoMap.dispose();
  }
  mapCache.clear();
}

/* ------------------------------------------------------------------ */
/* Tissue definitions                                                  */
/* ------------------------------------------------------------------ */

/**
 * Anatomical palette. Colours are sRGB hex values matched against standard
 * anatomical illustration references (Netter) rather than guessed.
 */
export const TISSUE_COLORS = Object.freeze({
  corticalBone: '#e6dcc4',
  cancellousBone: '#d9c8a8',
  cartilage: '#dfe6ea',
  tendon: '#e8e2cf',
  fascia: '#ded3c2',
  skeletalMuscle: '#8e3b32',
  cardiacMuscle: '#9c4038',
  smoothMuscle: '#b06a62',
  liver: '#8b4a3c',
  lung: '#cf8f8a',
  kidney: '#8d4b43',
  spleen: '#79384a',
  pancreas: '#c9a682',
  stomach: '#c98d84',
  intestine: '#cf9c8c',
  bladder: '#d0a894',
  brain: '#d6b6ab',
  cerebellum: '#c9a99c',
  skin: '#c9967e',
  adipose: '#e2cd8a',
  artery: '#b6534c',
  vein: '#5d6f9c',
  nerve: '#e8d9a0',
  eye: '#e8e4dc',
});

/**
 * Create a tissue material.
 *
 * @param {keyof typeof TISSUE_COLORS|string} name tissue key (or an explicit hex)
 * @param {object} [opts] overrides: { color, roughness, metalness, clearcoat,
 *                       sheen, sss, mapSize, repeat, normalStrength, emissive }
 */
export function tissue(name, opts = {}) {
  const base = {
    corticalBone: {
      height: boneHeight, color: TISSUE_COLORS.corticalBone, roughness: 0.62,
      clearcoat: 0.12, clearcoatRoughness: 0.6, normalStrength: 1.4,
      roughnessRange: [0.45, 0.78], sss: { color: '#7a4a2a', strength: 0.1, power: 4 },
    },
    cancellousBone: {
      height: boneHeight, color: TISSUE_COLORS.cancellousBone, roughness: 0.85,
      normalStrength: 3.2, roughnessRange: [0.7, 0.95], repeat: 4,
    },
    cartilage: {
      height: parenchymaHeight, color: TISSUE_COLORS.cartilage, roughness: 0.18,
      clearcoat: 0.7, clearcoatRoughness: 0.12, normalStrength: 0.35,
      sss: { color: '#cfe0e8', strength: 0.55, power: 2.2, distortion: 0.6 },
    },
    tendon: {
      height: fibrousHeight, color: TISSUE_COLORS.tendon, roughness: 0.34,
      clearcoat: 0.4, clearcoatRoughness: 0.25, normalStrength: 1.1, repeat: 3,
      sss: { color: '#d8c8a8', strength: 0.3, power: 3 },
    },
    fascia: {
      height: fibrousHeight, color: TISSUE_COLORS.fascia, roughness: 0.4,
      normalStrength: 0.8, repeat: 4, transparent: true,
    },
    skeletalMuscle: {
      height: muscleHeight, color: TISSUE_COLORS.skeletalMuscle, roughness: 0.5,
      sheen: 0.45, sheenRoughness: 0.6, sheenColor: '#ff9a86',
      normalStrength: 1.9, roughnessRange: [0.3, 0.62], repeat: 3,
      sss: { color: '#8a2018', strength: 0.6, power: 2.6, distortion: 0.5 },
    },
    cardiacMuscle: {
      height: cardiacHeight, color: TISSUE_COLORS.cardiacMuscle, roughness: 0.42,
      sheen: 0.4, sheenColor: '#ff9080', normalStrength: 2.2, repeat: 2,
      sss: { color: '#7d1a14', strength: 0.7, power: 2.2, distortion: 0.55 },
    },
    smoothMuscle: {
      height: muscleHeight, color: TISSUE_COLORS.smoothMuscle, roughness: 0.55,
      normalStrength: 1.2, repeat: 2,
      sss: { color: '#8f3a30', strength: 0.5, power: 2.6 },
    },
    liver: {
      height: parenchymaHeight, color: TISSUE_COLORS.liver, roughness: 0.28,
      clearcoat: 0.55, clearcoatRoughness: 0.2, normalStrength: 1.0,
      sss: { color: '#6d2418', strength: 0.75, power: 2.0, distortion: 0.7 },
    },
    lung: {
      height: parenchymaHeight, color: TISSUE_COLORS.lung, roughness: 0.42,
      normalStrength: 1.6, repeat: 5,
      sss: { color: '#c8756c', strength: 1.1, power: 1.7, distortion: 0.9 },
    },
    kidney: {
      height: parenchymaHeight, color: TISSUE_COLORS.kidney, roughness: 0.26,
      clearcoat: 0.6, clearcoatRoughness: 0.18, normalStrength: 0.7,
      sss: { color: '#74241d', strength: 0.7, power: 2.1, distortion: 0.7 },
    },
    spleen: {
      height: parenchymaHeight, color: TISSUE_COLORS.spleen, roughness: 0.35,
      clearcoat: 0.35, normalStrength: 0.9,
      sss: { color: '#5d1b2c', strength: 0.65, power: 2.2 },
    },
    pancreas: {
      height: parenchymaHeight, color: TISSUE_COLORS.pancreas, roughness: 0.5,
      normalStrength: 2.4, repeat: 6,
    },
    stomach: {
      height: mucosaHeight, color: TISSUE_COLORS.stomach, roughness: 0.24,
      clearcoat: 0.6, clearcoatRoughness: 0.15, normalStrength: 2.8, repeat: 2,
      sss: { color: '#a8564c', strength: 0.8, power: 2.0, distortion: 0.8 },
    },
    intestine: {
      height: mucosaHeight, color: TISSUE_COLORS.intestine, roughness: 0.26,
      clearcoat: 0.55, clearcoatRoughness: 0.2, normalStrength: 2.6, repeat: 2,
      sss: { color: '#a85e4e', strength: 0.85, power: 2.0, distortion: 0.8 },
    },
    bladder: {
      height: mucosaHeight, color: TISSUE_COLORS.bladder, roughness: 0.3,
      clearcoat: 0.4, normalStrength: 1.6,
      sss: { color: '#b07860', strength: 0.7, power: 2.0 },
    },
    brain: {
      height: cortexHeight, color: TISSUE_COLORS.brain, roughness: 0.3,
      clearcoat: 0.45, clearcoatRoughness: 0.25, normalStrength: 2.4, repeat: 1,
      size: 256, sss: { color: '#c08878', strength: 0.7, power: 2.2 },
    },
    cerebellum: {
      height: cortexHeight, color: TISSUE_COLORS.cerebellum, roughness: 0.34,
      clearcoat: 0.35, normalStrength: 3.4, repeat: 2, size: 256,
      sss: { color: '#b08070', strength: 0.6, power: 2.2 },
    },
    skin: {
      height: skinHeight, color: TISSUE_COLORS.skin, roughness: 0.45,
      sheen: 0.3, sheenRoughness: 0.8, sheenColor: '#ffc9b0',
      clearcoat: 0.12, clearcoatRoughness: 0.5, normalStrength: 0.9, repeat: 6,
      sss: { color: '#a83c2c', strength: 1.25, power: 2.4, distortion: 0.85 },
    },
    adipose: {
      height: parenchymaHeight, color: TISSUE_COLORS.adipose, roughness: 0.4,
      normalStrength: 2.0, repeat: 8,
      sss: { color: '#d8b860', strength: 0.9, power: 1.9 },
    },
    artery: {
      height: fibrousHeight, color: TISSUE_COLORS.artery, roughness: 0.32,
      clearcoat: 0.3, normalStrength: 0.7, repeat: 3,
      sss: { color: '#8e2a24', strength: 0.7, power: 2.2 },
    },
    vein: {
      height: fibrousHeight, color: TISSUE_COLORS.vein, roughness: 0.36,
      clearcoat: 0.25, normalStrength: 0.6, repeat: 3,
      sss: { color: '#2c3a66', strength: 0.6, power: 2.2 },
    },
    nerve: {
      height: fibrousHeight, color: TISSUE_COLORS.nerve, roughness: 0.42,
      clearcoat: 0.3, normalStrength: 0.9, repeat: 4,
    },
    eye: {
      height: parenchymaHeight, color: TISSUE_COLORS.eye, roughness: 0.06,
      clearcoat: 1.0, clearcoatRoughness: 0.03, normalStrength: 0.15,
    },
  }[name];

  if (!base) {
    // Unknown key → treat `name` as a literal colour so callers can extend freely.
    return withSubsurface(
      new MeshPhysicalMaterial({ color: new Color(name), roughness: 0.6 }),
      opts.sss,
    );
  }

  const o = { ...base, ...opts };
  const m = maps(name, o.height, {
    size: o.size ?? 128,
    repeat: o.repeat ?? 2,
    normalStrength: o.normalStrength ?? 1.5,
    roughnessRange: o.roughnessRange ?? [0.4, 0.8],
    seed: o.seed ?? 1,
  });

  // Only pass defined values: three warns loudly on `undefined` parameters and
  // the noise hides real configuration mistakes.
  const params = {
    color: new Color(o.color),
    roughness: o.roughness ?? 0.6,
    metalness: 0,
    normalMap: m.normalMap,
    roughnessMap: m.roughnessMap,
    aoMap: m.aoMap,
    aoMapIntensity: o.aoMapIntensity ?? 0.7,
    clearcoat: o.clearcoat ?? 0,
    clearcoatRoughness: o.clearcoatRoughness ?? 0.4,
    sheen: o.sheen ?? 0,
    sheenRoughness: o.sheenRoughness ?? 0.6,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    side: o.side ?? 0, // FrontSide default; callers override for sheets
    dithering: true, // suppresses banding on broad low-roughness tissue
  };
  if (o.sheenColor) params.sheenColor = new Color(o.sheenColor);
  if (o.emissive) params.emissive = new Color(o.emissive);
  if (o.emissiveIntensity != null) params.emissiveIntensity = o.emissiveIntensity;

  const material = new MeshPhysicalMaterial(params);

  if (o.normalScale) material.normalScale.set(o.normalScale, o.normalScale);
  if (o.sss) withSubsurface(material, o.sss);

  material.userData.tissue = name;
  return material;
}

/** Material cache so every rib/muscle of a tissue shares one program+texture set. */
const materialCache = new Map();

/**
 * Shared (cached) tissue material — use this for the many repeated parts.
 * Per-part overrides (opacity, side) still need a unique material; see `tissue()`.
 */
export function sharedTissue(name, opts = {}) {
  const key = `${name}|${JSON.stringify(opts)}`;
  if (!materialCache.has(key)) materialCache.set(key, tissue(name, opts));
  return materialCache.get(key);
}

/** Release cached materials (textures are released by disposeMaterials). */
export function disposeMaterialCache() {
  for (const m of materialCache.values()) m.dispose();
  materialCache.clear();
}
