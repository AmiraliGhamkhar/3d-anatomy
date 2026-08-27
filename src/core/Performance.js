/**
 * Performance.js — adaptive quality governor.
 *
 * The model is heavy by nature (a full skeleton + musculature + viscera). Rather
 * than picking one fixed setting that is either wasteful on a desktop or a
 * slideshow on a phone, this measures real frame times and walks the quality
 * ladder until it finds the highest tier that holds the target frame rate.
 *
 * Levers, cheapest first (so we degrade gracefully rather than abruptly):
 *   1. renderer pixel ratio          — instant, invisible until you look closely
 *   2. shadow maps on/off
 *   3. LOD distance bias             — pushes every tier switch closer in
 *   4. quality tier                  — combines the three above
 *
 * It ratchets down immediately but only climbs back after a sustained headroom
 * window, which stops the governor from oscillating between two tiers.
 */
import { QUALITY_TIERS, setLODBias } from './quality.js';

const TIER_ORDER = ['ultra', 'high', 'medium', 'low'];

export class PerformanceGovernor {
  /**
   * @param {object} deps
   * @param {import('three').WebGLRenderer} deps.renderer
   * @param {import('three').Scene} deps.scene  scene whose LODs get biased
   * @param {(tier:object, name:string)=>void} [deps.onTierChange]
   * @param {number} [deps.targetFPS]
   */
  constructor({ renderer, scene, onTierChange = null, targetFPS = 55 }) {
    this.renderer = renderer;
    this.scene = scene;
    this.onTierChange = onTierChange;
    this.targetFPS = targetFPS;

    this.tierIndex = this.detectStartTier();
    this.enabled = true;
    this.stats = { fps: 0, frameMs: 0, dpr: 1, drawCalls: 0, triangles: 0, tier: this.tierName };

    this._samples = [];
    this._last = 0;
    this._headroom = 0;
    this._cooldown = 0;
  }

  get tierName() {
    return TIER_ORDER[Math.min(this.tierIndex, TIER_ORDER.length - 1)];
  }

  get tier() {
    return QUALITY_TIERS[this.tierName];
  }

  /** Quality scalar (0..1] used when generating geometry. */
  get q() {
    return this.tier.q;
  }

  /**
   * Pick a starting tier from device signals instead of guessing.
   * `deviceMemory` / `hardwareConcurrency` are the only broadly available
   * proxies; combine them with a coarse mobile-UA check.
   */
  detectStartTier() {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const mem = nav.deviceMemory ?? 8;
    const cores = nav.hardwareConcurrency ?? 4;
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent ?? '');
    if (mobile || mem <= 4 || cores <= 4) return 2; // medium
    if (mem >= 8 && cores >= 8) return 0; // ultra
    return 1; // high
  }

  /** Apply the current tier: pixel ratio, shadows and LOD bias. */
  apply(onChange) {
    const tier = this.tier;
    const canvas = this.renderer?.domElement;
    const cssW = canvas?.clientWidth || 1;
    const cssH = canvas?.clientHeight || 1;
    const deviceDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    // Cap the ratio by the tier's pixel budget so a 4K phone panel does not ask
    // for tens of millions of shaded fragments per frame.
    const maxByBudget = Math.sqrt(tier.pixelBudget / Math.max(1, cssW * cssH));
    const dpr = Math.max(0.75, Math.min(deviceDpr, tier.dpr, maxByBudget, 2.5));
    this.renderer?.setPixelRatio(dpr);
    if (this.renderer?.shadowMap) this.renderer.shadowMap.enabled = tier.shadows;

    // Low tiers switch to coarser LOD sooner.
    if (this.scene) setLODBias(this.scene, 1 - (1 - tier.q) * 0.85);

    this.stats.dpr = dpr;
    this.stats.tier = this.tierName;
    (onChange ?? this.onTierChange)?.(tier, this.tierName);
    return dpr;
  }

  /**
   * Feed one frame's timing. Call once per rendered frame.
   * @param {number} now `performance.now()` milliseconds
   */
  update(now) {
    if (this._last) {
      const dt = now - this._last;
      // Ignore outliers from tab switches and GC pauses — otherwise a single
      // stall triggers a quality drop the device does not actually need.
      if (dt > 0 && dt < 250) {
        this._samples.push(dt);
        if (this._samples.length > 45) this._samples.shift();
      }
    }
    this._last = now;

    const info = this.renderer?.info;
    if (info) {
      this.stats.drawCalls = info.render.calls;
      this.stats.triangles = info.render.triangles;
    }

    if (this._cooldown > 0) this._cooldown--;
    if (!this.enabled || this._samples.length < 30) return;

    // Median rather than mean: robust against a single dropped frame.
    const sorted = [...this._samples].sort((a, b) => a - b);
    const medianMs = sorted[sorted.length >> 1];
    this.stats.frameMs = medianMs;
    this.stats.fps = 1000 / medianMs;
    if (this._cooldown > 0) return;

    if (this.stats.fps < this.targetFPS) {
      this._headroom = 0;
      if (this.tierIndex < TIER_ORDER.length - 1) {
        this.tierIndex++;
        this._cooldown = 90; // ~1.5 s of grace before re-measuring
        this.apply();
      }
    } else if (this.stats.fps > this.targetFPS + 12) {
      if (++this._headroom > 6) {
        this._headroom = 0;
        if (this.tierIndex > 0) {
          this.tierIndex--;
          this._cooldown = 180;
          this.apply();
        }
      }
    } else {
      this._headroom = 0;
    }
  }

  /** Force a tier (used by the UI quality selector). */
  setTier(name) {
    const i = TIER_ORDER.indexOf(name);
    if (i >= 0) {
      this.tierIndex = i;
      this.apply();
    }
  }

  /** Reset the measurement window. */
  reset() {
    this._samples.length = 0;
    this._headroom = 0;
    this._cooldown = 0;
  }
}
