import type { SmoothingConfig } from './types';

/**
 * Low-pass smoothing factor for a sample that arrived `dtSec` after the
 * previous one, for a filter with cutoff frequency `cutoffHz`. Computing it
 * from the real dt (instead of a per-frame constant) keeps the smoothing the
 * same whether the phone delivers 15 or 30 frames per second.
 */
function smoothingFactor(dtSec: number, cutoffHz: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

/**
 * One Euro filter (Casiez et al. 2012) for a scalar signal sampled at irregular times.
 *
 * It is a low-pass filter whose cutoff rises with the signal's speed: when the
 * value barely moves (holding a plank) it smooths heavily to hide jitter; when
 * it moves fast (a quick push-up) it follows closely so the bottom of the rep
 * isn't clipped.
 */
export class OneEuroFilter {
  private cfg: SmoothingConfig;
  /** Last filtered value, or null before the first sample. */
  private x: number | null = null;
  /** Last filtered derivative (signal units per second). */
  private dx = 0;
  private tPrevMs: number | null = null;

  constructor(config: SmoothingConfig) {
    this.cfg = { ...config };
  }

  /** Filters `value` observed at time `tMs` (milliseconds). */
  filter(value: number, tMs: number): number {
    if (!Number.isFinite(value)) return this.x ?? value;
    if (this.x === null || this.tPrevMs === null) {
      // First sample: nothing to smooth against, pass it straight through.
      this.x = value;
      this.dx = 0;
      this.tPrevMs = tMs;
      return value;
    }
    const dtSec = (tMs - this.tPrevMs) / 1000;
    // Repeated or out-of-order timestamp: dt would be 0 or negative and the
    // maths would divide by zero. Keep the previous output instead.
    if (!(dtSec > 0)) return this.x;
    this.tPrevMs = tMs;

    const rawDx = (value - this.x) / dtSec;
    const aD = smoothingFactor(dtSec, this.cfg.dCutoff);
    this.dx = aD * rawDx + (1 - aD) * this.dx;

    const cutoff = this.cfg.minCutoff + this.cfg.beta * Math.abs(this.dx);
    const a = smoothingFactor(dtSec, cutoff);
    this.x = a * value + (1 - a) * this.x;
    return this.x;
  }

  /** Forgets all history; the next sample passes straight through. */
  reset(): void {
    this.x = null;
    this.dx = 0;
    this.tPrevMs = null;
  }

  /** Changes the parameters without losing the current state. */
  setConfig(config: SmoothingConfig): void {
    this.cfg = { ...config };
  }
}
