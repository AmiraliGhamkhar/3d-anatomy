/**
 * Profile.js — cross-section radius functions used by the loft engine.
 *
 * A cross-section is a pure function `r(theta, t)` returning the distance from the
 * spine to the surface at polar angle `theta` (radians, 0 = local +normal axis)
 * and normalised arc position `t` (0 = start of spine, 1 = end).
 *
 * Two kinds of function live here:
 *   • BASE  profiles — `superellipse(a, b, n)`, terminal, produce a radius.
 *   • TRANSFORMS     — curried `(profile) => profile` modifiers that reshape a
 *     section along the spine. They compose, so one loft engine can express a
 *     round long-bone diaphysis, a flat prismatic rib, a lobed lung and a
 *     bean-shaped kidney without special-casing geometry generators.
 *
 * Example:
 *   const sec = compose(superellipse(1.4, 1.0, 3), Flared({ start: 0.45, end: 0.4 }));
 */

/**
 * Superellipse ("Lamé") cross-section.
 * n = 2 → ellipse; n = 4 → rounded rectangle (rib, clavicle); n → ∞ → rectangle.
 *
 * Evaluated in log space. The naive form
 *   r = ( (cos θ / a)^n + (sin θ / b)^n )^(-1/n)
 * overflows badly for large n: at n ≈ 500 the terms underflow to 0 and the
 * expression returns Infinity, which silently turns into NaN vertices downstream.
 * Taking logs first turns the power into a product and the sum into a
 * log-sum-exp, which is stable for any exponent.
 *
 * @param {number} a semi-axis along the local normal
 * @param {number} b semi-axis along the local binormal
 * @param {number} n squareness exponent
 * @returns {(theta:number,t:number)=>number}
 */
export function superellipse(a, b, n = 2) {
  const A = Math.max(1e-6, a);
  const B = Math.max(1e-6, b);
  const logA = Math.log(A);
  const logB = Math.log(B);
  const inv = 1 / n;

  return (theta) => {
    const c = Math.abs(Math.cos(theta));
    const s = Math.abs(Math.sin(theta));

    // u = n·ln(cos θ / a), v = n·ln(sin θ / b). A zero component gives -Infinity,
    // which log-sum-exp absorbs correctly (that axis simply does not contribute).
    const u = c === 0 ? -Infinity : n * (Math.log(c) - logA);
    const v = s === 0 ? -Infinity : n * (Math.log(s) - logB);

    const m = Math.max(u, v);
    if (!Number.isFinite(m)) return 0;
    // log(exp(u) + exp(v)) without ever exponentiating an overflowing value.
    const logSum = m + Math.log1p(Math.exp(Math.min(u, v) - m));
    return Math.exp(-inv * logSum);
  };
}

/** Plain ellipse — default for tubular structures (vessels, ureters, bronchi). */
export const ellipse = (a, b) => superellipse(a, b, 2);

/** Circle. */
export const circle = (r) => superellipse(r, r, 2);

/**
 * TRANSFORM — add `lobes` sinusoidal bulges of relative depth `amount`.
 * Liver lobation, cortical bulging of the kidney, cerebellar folia.
 */
export const Lobed =
  (lobes, amount = 0.15, phase = 0) =>
  (base) =>
  (theta, t) =>
    base(theta, t) * (1 + amount * Math.sin(lobes * theta + phase));

/**
 * TRANSFORM — widen the ends of the spine to model an epiphysis (long bone end)
 * or the broad origin/insertion of a flat muscle. `width` is the fraction of the
 * total length over which the flare fades in.
 */
export const Flared =
  ({ start = 0, end = 0, width = 0.18, power = 2 } = {}) =>
  (base) =>
  (theta, t) => {
    let f = 1;
    if (start > 0 && t < width) f += start * Math.pow(1 - t / width, power);
    if (end > 0 && t > 1 - width) f += end * Math.pow(1 - (1 - t) / width, power);
    return base(theta, t) * f;
  };

/**
 * TRANSFORM — scale the section linearly (smoothstep-eased) from `from` at t = 0
 * to `to` at t = 1. Muscle belly → tendon taper, distal bronchial narrowing.
 */
export const Tapered =
  (from = 1, to = 1, smooth = true) =>
  (base) =>
  (theta, t) => {
    const s = smooth ? t * t * (3 - 2 * t) : t;
    return base(theta, t) * (from + (to - from) * s);
  };

/**
 * TRANSFORM — asymmetric thickening of one half of the section. Models the heart's
 * thicker left ventricular wall, the liver's domed superior (diaphragmatic) face.
 * `k` scales the +normal half; the opposite half gets (2 - k) so the mean is kept.
 */
export const Biased =
  (k = 1.15) =>
  (base) =>
  (theta, t) =>
    base(theta, t) * (Math.cos(theta) >= 0 ? k : 2 - k);

/**
 * TRANSFORM — pinch the section towards a plane, producing a blade-like or
 * wing-like section (scapula, iliac ala, spinous processes).
 * @param {number} k amount of squashing applied to the binormal semi-axis
 */
export const Bladed =
  (k = 0.35) =>
  (base) =>
  (theta, t) => {
    const r = base(theta, t);
    // Decompose the polar radius back to components, squash one, recombine.
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const x = r * c;
    const y = r * s * k;
    return Math.hypot(x, y);
  };

/** Apply transforms left-to-right to a base profile. */
export function compose(base, ...transforms) {
  return transforms.reduce((profile, fn) => fn(profile), base);
}
