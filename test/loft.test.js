/**
 * loft.test.js — correctness of the core surface generator.
 *
 * These are the invariants every anatomical mesh in the project depends on, so
 * they are tested directly rather than assumed:
 *   1. the mesh is watertight (every edge shared by exactly two triangles),
 *   2. every face points OUTWARD,
 *   3. the enclosed volume matches the analytic answer,
 *   4. it survives spines with inflections, helices and closed loops,
 *   5. the cm → scene-unit conversion is applied exactly once.
 */
import { describe, expect, it } from 'vitest';
import { CatmullRomCurve3, Vector3 } from 'three';
import { loft } from '../src/core/loft.js';
import { computeParallelFrames } from '../src/core/Frame.js';
import { compose, superellipse, Bladed, Flared, Lobed, Tapered } from '../src/core/Profile.js';
import { spine } from '../src/core/builders.js';

const V = (...a) => new Vector3(...a);

/** Signed (oriented) volume of a triangle mesh. */
function signedVolume(g) {
  const p = g.attributes.position.array;
  const idx = g.index.array;
  let v = 0;
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3;
    const b = idx[k + 1] * 3;
    const c = idx[k + 2] * 3;
    v +=
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6;
  }
  return v;
}

/** Count edges not shared by exactly two triangles (non-manifold = not watertight). */
function nonManifoldEdges(g) {
  const idx = g.index.array;
  const seen = new Map();
  for (let k = 0; k < idx.length; k += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[k + e];
      const b = idx[k + ((e + 1) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const n of seen.values()) if (n !== 2) bad++;
  return bad;
}

/** Faces whose normal points toward the nearest spine point instead of away. */
function inwardFaces(g, curve, samples = 240) {
  const p = g.attributes.position.array;
  const n = g.attributes.normal.array;
  const idx = g.index.array;
  const pts = [];
  for (let i = 0; i <= samples; i++) pts.push(curve.getPointAt(i / samples));
  const near = new Vector3();
  const c = new Vector3();
  const radial = new Vector3();
  let bad = 0;
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3;
    const b = idx[k + 1] * 3;
    const d = idx[k + 2] * 3;
    c.set((p[a] + p[b] + p[d]) / 3, (p[a + 1] + p[b + 1] + p[d + 1]) / 3, (p[a + 2] + p[d + 2] + p[b + 2]) / 3);
    let best = Infinity;
    for (const q of pts) {
      const dist = q.distanceToSquared(c);
      if (dist < best) {
        best = dist;
        near.copy(q);
      }
    }
    radial.copy(c).sub(near);
    const nx = (n[a] + n[b] + n[d]) / 3;
    const ny = (n[a + 1] + n[b + 1] + n[d + 1]) / 3;
    const nz = (n[a + 2] + n[b + 2] + n[d + 2]) / 3;
    if (radial.lengthSq() > 1e-10 && nx * radial.x + ny * radial.y + nz * radial.z < 0) bad++;
  }
  return bad;
}

function finiteVertices(g) {
  const a = g.attributes.position.array;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

describe('loft()', () => {
  it('produces a watertight, outward-facing closed surface', () => {
    const curve = new CatmullRomCurve3([V(0, 0, 0), V(0, 0.5, 0), V(0, 1, 0)]);
    const g = loft({ spine: curve, profile: superellipse(5, 5, 2), radialSegments: 24, heightSegments: 8 });
    expect(nonManifoldEdges(g)).toBe(0);
    expect(inwardFaces(g, curve)).toBe(0);
    expect(finiteVertices(g)).toBe(true);
  });

  it('matches the analytic volume of a cylinder to within polygon error', () => {
    const R = 5; // cm
    const H = 100; // cm
    const n = 48;
    const curve = new CatmullRomCurve3([V(0, 0, 0), V(0, 0.5, 0), V(0, 1, 0)]);
    const g = loft({ spine: curve, profile: superellipse(R, R, 2), radialSegments: n, heightSegments: 8 });
    // Exact area of a regular n-gon inscribed in radius R, in cm².
    const areaCm2 = 0.5 * R * R * n * Math.sin((2 * Math.PI) / n);
    // cm³ → m³ is 1e-6, because the loft works in metres.
    const expectedM3 = areaCm2 * H * 1e-6;
    expect(signedVolume(g)).toBeCloseTo(expectedM3, 9);
  });

  it('keeps outward orientation through an inflected spine (the Frenet failure case)', () => {
    // Cervical lordosis → thoracic kyphosis: curvature changes sign.
    const curve = new CatmullRomCurve3([V(0, 0, 0), V(0, 0.3, 0.2), V(0, 0.7, -0.2), V(0, 1, 0)]);
    const g = loft({ spine: curve, profile: superellipse(12, 7, 4), radialSegments: 16, heightSegments: 48 });
    expect(inwardFaces(g, curve)).toBe(0);
    expect(signedVolume(g)).toBeGreaterThan(0);
  });

  it('keeps outward orientation along a helix', () => {
    const pts = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 15) * Math.PI * 3;
      return V(Math.cos(a) * 0.2, i / 15, Math.sin(a) * 0.2);
    });
    const curve = new CatmullRomCurve3(pts);
    const g = loft({ spine: curve, profile: superellipse(6, 6, 2), radialSegments: 12, heightSegments: 96 });
    expect(inwardFaces(g, curve)).toBe(0);
    expect(nonManifoldEdges(g)).toBe(0);
  });

  it('converts profile radii from centimetres exactly once', () => {
    // A 10 cm radius cylinder over a 1 m spine must be 0.1 m wide, not 10 m.
    const curve = new CatmullRomCurve3([V(0, 0, 0), V(0, 1, 0)]);
    const g = loft({ spine: curve, profile: superellipse(10, 10, 2), radialSegments: 12, heightSegments: 2 });
    g.computeBoundingBox();
    const width = g.boundingBox.max.x - g.boundingBox.min.x;
    expect(width).toBeCloseTo(0.2, 5);
  });

  it('can leave ends open, and honours per-end caps', () => {
    const curve = new CatmullRomCurve3([V(0, 0, 0), V(0, 1, 0)]);
    const open = loft({ spine: curve, profile: superellipse(5, 5, 2), radialSegments: 8, heightSegments: 2, cap: false });
    const both = loft({ spine: curve, profile: superellipse(5, 5, 2), radialSegments: 8, heightSegments: 2, cap: true });
    // Each closed cap adds one pole vertex and R triangles.
    expect(open.attributes.position.count).toBe(3 * 8);
    expect(both.attributes.position.count).toBe(3 * 8 + 2);
    expect(both.index.count / 3 - open.index.count / 3).toBe(16);
  });

  it('emits position, normal and uv so parts can be merged', () => {
    const curve = new CatmullRomCurve3([V(0, 0, 0), V(0, 1, 0)]);
    const g = loft({ spine: curve, profile: superellipse(5, 5, 2), radialSegments: 8, heightSegments: 2 });
    expect(Object.keys(g.attributes).sort()).toEqual(['normal', 'position', 'uv']);
    expect(g.attributes.uv.count).toBe(g.attributes.position.count);
  });
});

describe('computeParallelFrames()', () => {
  it('produces orthonormal frames at every sample', () => {
    const curve = new CatmullRomCurve3([V(0, 0, 0), V(0, 0.4, 0.3), V(0, 0.8, -0.3), V(0, 1, 0)]);
    const f = computeParallelFrames(curve, 32, new Vector3(0, 1, 0));
    for (let i = 0; i <= 32; i++) {
      expect(f.normals[i].length()).toBeCloseTo(1, 6);
      expect(f.binormals[i].length()).toBeCloseTo(1, 6);
      expect(Math.abs(f.normals[i].dot(f.binormals[i]))).toBeLessThan(1e-6);
      expect(Math.abs(f.normals[i].dot(f.tangents[i]))).toBeLessThan(1e-6);
    }
  });

  it('does not flip across a curvature sign change (unlike Frenet frames)', () => {
    const curve = new CatmullRomCurve3([V(0, 0, 0), V(0, 0.5, 0.4), V(0, 1.0, -0.4), V(0, 1.5, 0)]);
    const f = computeParallelFrames(curve, 60, new Vector3(1, 0, 0));
    for (let i = 1; i <= 60; i++) {
      // A Frenet frame would reverse here; a transported frame stays continuous.
      expect(f.normals[i].dot(f.normals[i - 1])).toBeGreaterThan(0.9);
    }
  });

  it('handles a tangent parallel to the seed direction', () => {
    const curve = new CatmullRomCurve3([V(0, 0, 0), V(0, 1, 0)]);
    const f = computeParallelFrames(curve, 4, new Vector3(0, 1, 0));
    for (let i = 0; i <= 4; i++) expect(f.normals[i].length()).toBeCloseTo(1, 6);
  });
});

describe('Profile transforms', () => {
  it('compose() applies transforms in order', () => {
    const p = compose(superellipse(10, 6, 3), Flared({ start: 0.5, end: 0.4, width: 0.2 }), Tapered(1, 0.7));
    expect(p(0, 0)).toBeGreaterThan(p(0, 0.5)); // flared at the start
    expect(p(0, 1)).toBeCloseTo(10 * (1 + 0.4) * 0.7, 5); // flare × taper
  });

  it('Tapered interpolates with a smoothstep by default', () => {
    const p = Tapered(1, 2)(superellipse(1, 1, 2));
    expect(p(0, 0)).toBeCloseTo(1, 6);
    expect(p(0, 0.5)).toBeCloseTo(1.5, 6); // smoothstep(0.5) = 0.5
    expect(p(0, 1)).toBeCloseTo(2, 6);
  });

  it('Bladed squashes one axis only', () => {
    const base = superellipse(4, 4, 2);
    const blade = Bladed(0.25)(base);
    expect(blade(0, 0)).toBeCloseTo(4, 6); // along the normal: unchanged
    expect(blade(Math.PI / 2, 0)).toBeCloseTo(1, 6); // along the binormal: ×0.25
  });

  it('Lobed modulates around the section without changing the mean much', () => {
    const p = Lobed(4, 0.2)(superellipse(5, 5, 2));
    const samples = Array.from({ length: 64 }, (_, i) => p((i / 64) * Math.PI * 2, 0));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeCloseTo(5, 1);
    expect(Math.max(...samples)).toBeGreaterThan(Math.min(...samples) * 1.3);
  });

  it('superellipse matches the analytic Lamé radius and limits to a square', () => {
    // n = 2 is a circle (r = a at every angle).
    const circle = superellipse(3, 3, 2);
    expect(circle(Math.PI / 4, 0)).toBeCloseTo(3, 6);
    expect(circle(0, 0)).toBeCloseTo(3, 6);

    // On the 45° diagonal of an equal-axis Lamé curve the closed form is
    //   r(n) = a·√2 · 2^(-1/n)
    // which increases monotonically towards a√2 (the square corner) as n → ∞.
    const a = 3;
    const limit = a * Math.SQRT2;
    let prev = 0;
    for (const n of [2, 4, 8, 20, 60, 200, 2000]) {
      const r = superellipse(a, a, n)(Math.PI / 4, 0);
      expect(r).toBeCloseTo(limit * Math.pow(2, -1 / n), 8);
      expect(r).toBeGreaterThan(prev);
      expect(r).toBeLessThan(limit);
      prev = r;
    }
    // The residual gap is exactly limit·(1 − 2^(-1/n)), i.e. O(1/n).
    expect(prev).toBeCloseTo(limit, 2);

    // The semi-axes are exact for every exponent.
    expect(superellipse(3, 5, 7)(0, 0)).toBeCloseTo(3, 6);
    expect(superellipse(3, 5, 7)(Math.PI / 2, 0)).toBeCloseTo(5, 6);
  });

  it('spine() converts centimetres to scene units', () => {
    const s = spine([[0, 100, 0], [0, 150, 0]]);
    expect(s.getPointAt(0).y).toBeCloseTo(1.0, 6);
    expect(s.getPointAt(1).y).toBeCloseTo(1.5, 6);
  });
});
