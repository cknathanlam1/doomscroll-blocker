/**
 * Unit tests for the One Euro filter (src/core/oneEuro.ts). It smooths the
 * depth signal, so it must: pass a steady value through untouched, settle on
 * a new value without overshooting, and behave the same in wall-clock time
 * whether frames arrive at 15 or 30 fps (Safari's frame rate wanders).
 */
import { describe, expect, test } from 'vitest';
import { OneEuroFilter } from '../src/core/oneEuro';
import { DEFAULT_CONFIG } from '../src/core/repCounter';
import type { SmoothingConfig } from '../src/core/types';

const CFG: SmoothingConfig = DEFAULT_CONFIG.smoothing;

/** Runs `signal(tMs)` through a fresh filter at `fps` from 0 to `durationMs`; returns [t, out] pairs. */
function run(cfg: SmoothingConfig, fps: number, durationMs: number, signal: (tMs: number) => number): Array<[number, number]> {
  const f = new OneEuroFilter(cfg);
  const out: Array<[number, number]> = [];
  const dt = 1000 / fps;
  for (let i = 0; i * dt <= durationMs + 1e-9; i++) {
    const t = i * dt;
    out.push([t, f.filter(signal(t), t)]);
  }
  return out;
}

const step = (atMs: number) => (t: number): number => (t < atMs ? 0 : 1);

describe('OneEuroFilter', () => {
  test('the first sample passes straight through', () => {
    const f = new OneEuroFilter(CFG);
    expect(f.filter(0.42, 1000)).toBe(0.42);
  });

  test('a constant signal passes through unchanged', () => {
    for (const [, y] of run(CFG, 30, 3000, () => 3.7)) expect(y).toBeCloseTo(3.7, 12);
  });

  test('step response: moves toward the new value, never overshoots, and converges', () => {
    const out = run(CFG, 30, 3000, step(1000));
    let prev = 0;
    for (const [t, y] of out) {
      if (t < 1000) expect(y).toBe(0);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12); // monotone
      expect(y).toBeLessThanOrEqual(1 + 1e-12); // no overshoot
      prev = y;
    }
    // It reacts at once (not frozen) ...
    const firstAfter = out.find(([t]) => t >= 1000)?.[1] ?? 0;
    expect(firstAfter).toBeGreaterThan(0.1);
    // ... and is essentially there after half a second, fully after a second.
    const at = (ms: number): number => out.find(([t]) => t >= ms)?.[1] ?? NaN;
    expect(at(1500)).toBeGreaterThan(0.95);
    expect(at(2000)).toBeGreaterThan(0.999);
  });

  test('dt-aware: the same signal gives (nearly) the same output at 15 and 30 fps', () => {
    /** Push-up-shaped depth: 0 → 0.45 → 0 every 1.4 s (smoothstep down and up). */
    const pushups = (t: number): number => {
      const p = (t % 1400) / 700;
      const k = p < 1 ? p : 2 - p;
      return 0.45 * k * k * (3 - 2 * k);
    };
    const signals: Array<[string, (t: number) => number]> = [
      ['step', step(1000)],
      ['sine', (t) => 0.4 * Math.sin((2 * Math.PI * t) / 1500)],
      ['push-ups', pushups],
    ];
    for (const [name, signal] of signals) {
      const at30 = run(CFG, 30, 3000, signal);
      const at15 = run(CFG, 15, 3000, signal);
      let maxDiff = 0;
      // Compare at the timestamps both frame rates share (every 1/15 s) ...
      for (let i = 0; i < at15.length; i++) {
        const a = at15[i];
        const b = at30[2 * i];
        if (!a || !b) continue;
        expect(b[0]).toBeCloseTo(a[0], 9);
        // ... except the one sample AT the step: a 15 fps frame can't know
        // when within the last 67 ms the jump happened, so any filter differs there.
        if (name === 'step' && Math.abs(a[0] - 1000) < 1) continue;
        maxDiff = Math.max(maxDiff, Math.abs(a[1] - b[1]));
      }
      // A filter with a fixed per-FRAME factor would be ~2× slower at 15 fps
      // (differences of ~0.3 on the step); this one measures ≤ 0.017.
      expect(maxDiff, name).toBeLessThan(0.03);
    }
  });

  test('a naive per-frame filter is NOT frame-rate independent (why dt matters)', () => {
    // Sanity check of the test above: a constant α = 0.2 per frame.
    const naive = (fps: number): number => {
      let y = 0;
      for (let t = 0; t <= 300; t += 1000 / fps) y += 0.2 * (1 - y);
      return y;
    };
    const oneEuroAt = (fps: number): number => run(CFG, fps, 300, () => 1).at(-1)?.[1] ?? NaN;
    expect(Math.abs(naive(30) - naive(15))).toBeGreaterThan(0.2);
    // (A constant input passes straight through the real filter at any rate.)
    expect(oneEuroAt(30)).toBe(1);
    expect(oneEuroAt(15)).toBe(1);
  });

  test('beta: fast motion is followed with less lag than with beta = 0', () => {
    const ramp = (t: number): number => (t < 500 ? 0 : Math.min(1, (t - 500) / 300)); // 0 → 1 in 0.3 s
    const lagAt = (cfg: SmoothingConfig): number => {
      const out = run(cfg, 30, 1000, ramp);
      const y = out.find(([t]) => t >= 800)?.[1] ?? NaN;
      return 1 - y;
    };
    expect(lagAt(CFG)).toBeLessThan(lagAt({ ...CFG, beta: 0 }) * 0.7);
  });

  test('reset(): the next sample passes straight through again', () => {
    const f = new OneEuroFilter(CFG);
    f.filter(0, 0);
    f.filter(0, 33);
    expect(f.filter(1, 66)).toBeLessThan(1); // smoothed
    f.reset();
    expect(f.filter(5, 100)).toBe(5);
    // ...and it smooths again from there.
    expect(f.filter(6, 133)).toBeLessThan(6);
  });

  test('repeated or out-of-order timestamps keep the previous output (no divide-by-zero)', () => {
    const f = new OneEuroFilter(CFG);
    f.filter(0, 0);
    const y = f.filter(1, 33);
    expect(f.filter(10, 33)).toBe(y);
    expect(f.filter(10, 20)).toBe(y);
    // Time moving forward again continues from that state.
    const next = f.filter(1, 66);
    expect(Number.isFinite(next)).toBe(true);
    expect(next).toBeGreaterThan(y);
  });

  test('a NaN sample is ignored', () => {
    const f = new OneEuroFilter(CFG);
    f.filter(0.3, 0);
    expect(f.filter(NaN, 33)).toBe(0.3);
    expect(f.filter(0.3, 66)).toBeCloseTo(0.3, 12);
  });

  test('setConfig changes the response but keeps the current state', () => {
    const f = new OneEuroFilter(CFG);
    f.filter(0, 0);
    f.filter(0, 33);
    f.setConfig({ minCutoff: 50, beta: 0, dCutoff: 1 }); // almost no smoothing
    // Continues from 0 (state kept), and with a 50 Hz cutoff nearly jumps to 1.
    expect(f.filter(1, 66)).toBeGreaterThan(0.9);
  });
});
