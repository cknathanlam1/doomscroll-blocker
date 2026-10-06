/**
 * GOLDEN PARITY FIXTURES: the generator.
 *
 *   npm run golden        (= vitest run --config vitest.golden.config.ts)
 *
 * Builds a fixed set of sessions (real recordings and seeded simulations),
 * runs every frame through the REAL web RepCounter (src/core/repCounter.ts)
 * and writes, per session, tests/fixtures/golden/<name>.json holding:
 *   - the full merged CounterConfig the counter ran with,
 *   - the exact PoseFrames it was fed (world joints left out),
 *   - the snapshot fields a port must reproduce, for EVERY frame.
 *
 * A port of src/core (the Swift + Apple Vision app) feeds the same frames to
 * its own RepCounter and must produce the same snapshots: exact for the
 * discrete fields, within 1e-6 for numbers (see
 * tests/fixtures/golden/README.md and docs/ALGORITHM.md, "Golden parity
 * fixtures"). tests/golden.test.ts re-checks the files on every `npm test`,
 * so the web counter can't drift away from them silently.
 *
 * Run this ONLY after an intentional change to src/core (or to add a
 * session), then commit the regenerated files. Never edit them by hand.
 *
 * This file lives outside tsconfig's `include`, so node:fs is fine here.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { RepCounter } from '../../src/core/repCounter';
import type { Recording } from '../../src/core/recording';
import type { CounterConfig, CounterEvent, CounterSnapshot, Joints2D, PoseFrame } from '../../src/core/types';
import { simulateSession, standardSet, type RepSpec, type Segment } from '../../src/sim/pushupSimulator';

/** Bump when the file layout changes (tests/golden.test.ts checks it). */
const GOLDEN_FORMAT = 'doomscroller-golden/2';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'tests', 'fixtures', 'golden');

// ---------------------------------------------------------------------------
// Rounding. Inputs are rounded BEFORE they are fed to the counter, so the JSON
// holds exactly what the counter saw. Outputs are rounded to 9 decimals only
// to keep the files small (the comparison tolerance is 1e-6).

const round = (x: number, digits: number): number => {
  const f = 10 ** digits;
  const r = Math.round(x * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

/** Every number written to `expected` goes through here: finite check + rounding. */
function num(x: number, where: string): number {
  if (!Number.isFinite(x)) throw new Error(`non-finite number at ${where}: ${x}`);
  return round(x, 9);
}
const numOrNull = (x: number | null, where: string): number | null => (x === null ? null : num(x, where));

/** The exact input frame: x/y to 6 decimals (≈ 0.0006 px at 640 px), c to 4, t to 3, no world joints. */
function inputFrame(f: PoseFrame): PoseFrame {
  let joints: Joints2D | null = null;
  if (f.joints) {
    joints = {};
    for (const [name, j] of Object.entries(f.joints) as [keyof Joints2D, Joints2D[keyof Joints2D]][]) {
      if (j) joints[name] = { x: round(j.x, 6), y: round(j.y, 6), c: round(j.c, 4) };
    }
  }
  return { t: round(f.t, 3), aspect: round(f.aspect, 6), joints };
}

function expectedEvent(e: CounterEvent, where: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) out[k] = typeof v === 'number' ? num(v, `${where}.${k}`) : v;
  return out;
}

/** The snapshot fields a port must reproduce, in a fixed key order. */
function expectedOf(s: CounterSnapshot, i: number): Record<string, unknown> {
  const w = (field: string): string => `expected[${i}].${field}`;
  return {
    t: num(s.features.t, w('t')),
    phase: s.phase,
    motion: s.motion,
    count: s.count,
    depth: numOrNull(s.depth, w('depth')),
    rawDepth: numOrNull(s.rawDepth, w('rawDepth')),
    peakDepth: num(s.peakDepth, w('peakDepth')),
    depthSource: s.depthSource,
    heightRatio: numOrNull(s.heightRatio, w('heightRatio')),
    baselineRatio: numOrNull(s.baselineRatio, w('baselineRatio')),
    shoulderWidthRatio: numOrNull(s.shoulderWidthRatio, w('shoulderWidthRatio')),
    depthLineY: numOrNull(s.depthLineY, w('depthLineY')),
    countdownRemainingMs: numOrNull(s.countdownRemainingMs, w('countdownRemainingMs')),
    inFrame: s.inFrame,
    plankOk: s.plankOk,
    hint: s.hint,
    events: s.events.map((e, k) => expectedEvent(e, w(`events[${k}]`))),
  };
}

// ---------------------------------------------------------------------------
// Session building blocks

interface Run {
  snaps: CounterSnapshot[];
  events: CounterEvent[];
}

interface Session {
  name: string;
  description: string;
  /** Partial config; the file stores the FULL merged config (RepCounter.config). */
  config: Partial<CounterConfig>;
  frames: () => PoseFrame[];
  /** Sanity check, so a golden file never captures a broken run. */
  check: (r: Run) => void;
}

const specs = (n: number, spec: RepSpec): RepSpec[] => Array.from({ length: n }, () => ({ ...spec }));
const reps = (n: number, spec: RepSpec): Segment[] => specs(n, spec).map((s): Segment => ({ kind: 'rep', spec: s }));
/** b continues one 30 fps frame after a ends (timestamps shifted). */
const concat = (a: PoseFrame[], b: PoseFrame[]): PoseFrame[] => {
  const lastT = a[a.length - 1]?.t ?? 0;
  const firstB = b[0]?.t ?? 0;
  return [...a, ...b.map((f) => ({ ...f, t: f.t - firstB + lastT + 1000 / 30 }))];
};
const countOf = (r: Run, type: CounterEvent['type']): number => r.events.filter((e) => e.type === type).length;
const reasons = (r: Run, type: 'repCancelled' | 'paused'): string[] =>
  r.events.flatMap((e) => (e.type === type ? [e.reason] : []));

function loadLaptopSession(): Recording {
  const path = join(ROOT, 'tests', 'fixtures', 'laptop-session-1.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Recording;
}
const laptopFrames = (): PoseFrame[] => loadLaptopSession().frames.map((f) => ({ t: f.t, aspect: f.aspect, joints: f.joints }));
/** The recording's config (recorded before returnFraction existed; the counter fills in the default). */
const laptopConfig = (targetReps: number): Partial<CounterConfig> => ({ ...loadLaptopSession().config, targetReps });

// ---------------------------------------------------------------------------
// The sessions. Names are file names; keep them stable (the Swift tests may
// list them). Seeds are fixed so every run produces the same files.

const SESSIONS: Session[] = [
  {
    name: '01-laptop-session-target10',
    description:
      'The REAL recorded laptop set (tests/fixtures/laptop-session-1.json: MediaPipe Pose Full on a webcam, ~11.5 fps, 379 frames) with targetReps 10: calibrates, counts 10 push-ups (several with tired tops at d ≈ 0.08–0.12), then complete.',
    config: laptopConfig(10),
    frames: laptopFrames,
    check: (r) => {
      expect(countOf(r, 'start')).toBe(1);
      expect(countOf(r, 'rep')).toBe(10);
      expect(countOf(r, 'partial')).toBe(0);
      expect(countOf(r, 'complete')).toBe(1);
    },
  },
  {
    name: '02-laptop-session-target30',
    description:
      'The same REAL laptop recording with targetReps 30: all 13 push-ups count, no "Go lower", the set never completes. (With the old fixed lockout at d ≤ 0.07 only 10 counted; returnFraction fixed it.)',
    config: laptopConfig(30),
    frames: laptopFrames,
    check: (r) => {
      expect(countOf(r, 'rep')).toBe(13);
      expect(countOf(r, 'partial')).toBe(0);
      expect(countOf(r, 'complete')).toBe(0);
    },
  },
  {
    name: '03-clean-10-reps-30fps',
    description:
      'Simulated, default geometry, 30 fps, no landmark noise: 4.5 s plank (calibration), then 10 full push-ups (80° elbows, 0.7 s down, 0.1 s hold, 0.7 s up, 0.4 s rest) and a 1 s hold. targetReps 10: ends with complete.',
    config: { targetReps: 10 },
    frames: () => simulateSession([...standardSet(specs(10, { minElbowDeg: 80 })), { kind: 'hold', ms: 1000 }], { seed: 1 }).frames,
    check: (r) => {
      expect(countOf(r, 'start')).toBe(1);
      expect(countOf(r, 'rep')).toBe(10);
      expect(countOf(r, 'partial')).toBe(0);
      expect(countOf(r, 'complete')).toBe(1);
    },
  },
  {
    name: '04-mixed-full-and-partial-noise2',
    description:
      'Simulated, 30 fps, 2 px landmark noise: full reps (80°, 75°, 85°, 70°) alternating with partial reps (115°, 120°, 112°, 118°). Every full rep counts; every partial rep gets exactly one "Go lower" (a partial event, live or at the top) and never counts. targetReps 30.',
    config: { targetReps: 30 },
    frames: () =>
      simulateSession(
        [...standardSet([80, 115, 75, 120, 85, 112, 70, 118].map((minElbowDeg) => ({ minElbowDeg }))), { kind: 'hold', ms: 1000 }],
        { noisePx: 2, seed: 4 },
      ).frames,
    check: (r) => {
      expect(countOf(r, 'rep')).toBe(4);
      expect(countOf(r, 'partial')).toBe(4);
      expect(countOf(r, 'repCancelled')).toBe(0);
    },
  },
  {
    name: '05-absence-mid-set-pause-resume',
    description:
      'Simulated, 30 fps, 1 px noise: 3 full reps, then the user disappears (joints null) while holding the bottom of a 4th rep, so that attempt is cancelled ("repCancelled lost") and the set pauses ("paused lost"); after 2 s they are back in a plank, the set resumes, and 3 more reps count (6 in total). targetReps 30.',
    config: { targetReps: 30 },
    frames: () => {
      const a = simulateSession(
        [...standardSet(specs(3, { minElbowDeg: 80 })), { kind: 'rep', spec: { minElbowDeg: 80, bottomHoldMs: 2000 } }],
        { noisePx: 1, seed: 5 },
      );
      const fourth = a.reps[3];
      if (!fourth) throw new Error('simulator returned no 4th rep');
      // Cut 1 s into the 2 s bottom hold (0.7 s descent + 1 s).
      const cut = fourth.tStart + 700 + 1000;
      const b = simulateSession(
        [{ kind: 'absent', ms: 2000 }, { kind: 'hold', ms: 1500 }, ...reps(3, { minElbowDeg: 80 }), { kind: 'hold', ms: 500 }],
        { noisePx: 1, seed: 55 },
      );
      return concat(
        a.frames.filter((f) => f.t < cut),
        b.frames,
      );
    },
    check: (r) => {
      expect(reasons(r, 'repCancelled')).toEqual(['lost']);
      expect(reasons(r, 'paused')).toEqual(['lost']);
      expect(countOf(r, 'resumed')).toBe(1);
      expect(countOf(r, 'rep')).toBe(6);
      expect(countOf(r, 'partial')).toBe(0);
    },
  },
  {
    name: '06-tired-reps-return-135',
    description:
      'Simulated, 30 fps, 1 px noise. Tired reps (75°) that only come back up to a 135° elbow (RepSpec.returnElbowDeg; d ≈ 0.08, above upThreshold), then two shallow reps from that tired top: 115° (turns back early: live "Go lower") and 120° (ends back at the tired top before turning back 0.04 below its peak: "Go lower" at the top, partial live = false); more tired reps, a full rep, then a bounce part of the way up (70° → 120° → 70° → top) that counts once, not twice. 6 reps, 2 partials, nothing cancelled. targetReps 30.',
    config: { targetReps: 30 },
    frames: () =>
      simulateSession(
        [
          ...standardSet([
            { minElbowDeg: 75, returnElbowDeg: 135 },
            { minElbowDeg: 75, returnElbowDeg: 135 },
            { minElbowDeg: 115, returnElbowDeg: 135 },
            { minElbowDeg: 120, returnElbowDeg: 135 },
            { minElbowDeg: 75, returnElbowDeg: 135 },
            { minElbowDeg: 75, returnElbowDeg: 135 },
            { minElbowDeg: 75 },
            { minElbowDeg: 70, returnElbowDeg: 120, topRestMs: 100 },
            { minElbowDeg: 70 },
          ]),
          { kind: 'hold', ms: 1000 },
        ],
        { noisePx: 1, seed: 6 },
      ).frames,
    check: (r) => {
      expect(countOf(r, 'rep')).toBe(6);
      expect(r.events.flatMap((e) => (e.type === 'partial' ? [e.live] : []))).toEqual([true, false]);
      expect(countOf(r, 'repCancelled')).toBe(0);
    },
  },
  {
    name: '07-15fps-noise4-time-jitter',
    description:
      'Simulated at 15 fps with 4 px landmark noise and ±15 ms of frame-time jitter (uneven frame intervals): 8 full reps (75°). All 8 count. Exercises the time-based (never frame-count) timing, the gap-scaled jump rejection and the dt-aware filters. targetReps 30.',
    config: { targetReps: 30 },
    frames: () =>
      simulateSession([...standardSet(specs(8, { minElbowDeg: 75 })), { kind: 'hold', ms: 1000 }], {
        fps: 15,
        noisePx: 4,
        timeJitterMs: 15,
        seed: 7,
      }).frames,
    check: (r) => {
      expect(countOf(r, 'start')).toBe(1);
      expect(countOf(r, 'rep')).toBe(8);
    },
  },
  {
    name: '08-shallow-reps-never-count',
    description:
      'Simulated, 30 fps, 1.5 px noise: only shallow reps. 115°, 120° and 112° dips pass partialMinDepth and each gets one "Go lower"; 140°, 145° and 135° dips are too shallow to even start an attempt. Nothing ever counts. targetReps 10.',
    config: { targetReps: 10 },
    frames: () =>
      simulateSession(
        [...standardSet([115, 140, 120, 145, 112, 135].map((minElbowDeg) => ({ minElbowDeg }))), { kind: 'hold', ms: 1000 }],
        { noisePx: 1.5, seed: 8 },
      ).frames,
    check: (r) => {
      expect(countOf(r, 'start')).toBe(1);
      expect(countOf(r, 'rep')).toBe(0);
      expect(countOf(r, 'depthReached')).toBe(0);
      expect(countOf(r, 'partial')).toBe(3);
    },
  },

  // --- Extra coverage beyond the eight core sessions: the remaining branches
  // (countdown restart / cancel, out-of-plank pause, rockedBack, tooSlow,
  // "chest, not head", very low fps, joint dropouts, a moved phone).
  {
    name: '09-calibration-restart-and-cancel',
    description:
      'Simulated, 30 fps, no noise: shallow quick dips during the first 3-2-1 make it restart ("holdStill", a second countdownTick 3); a deep dip makes the plank gate fail long enough to cancel it (countdownCancelled, back to waiting); then a still plank calibrates and two reps count. targetReps 30.',
    config: { targetReps: 30 },
    frames: () =>
      simulateSession([
        { kind: 'hold', ms: 1000 },
        ...reps(3, { minElbowDeg: 115, downMs: 500, upMs: 500, bottomHoldMs: 0, topRestMs: 0 }),
        { kind: 'hold', ms: 1500 },
        { kind: 'rep', spec: { minElbowDeg: 80 } },
        { kind: 'hold', ms: 5000 },
        ...reps(2, { minElbowDeg: 80 }),
        { kind: 'hold', ms: 500 },
      ]).frames,
    check: (r) => {
      expect(countOf(r, 'countdownCancelled')).toBe(1);
      expect(r.events.filter((e) => e.type === 'countdownTick' && e.secondsLeft === 3)).toHaveLength(3);
      expect(r.snaps.some((s) => s.phase === 'countdown' && s.hint === 'holdStill')).toBe(true);
      expect(countOf(r, 'start')).toBe(1);
      expect(countOf(r, 'rep')).toBe(2);
    },
  },
  {
    name: '10-rock-back-head-bob-too-slow',
    description:
      'Simulated at 15 fps, 1 px noise: one rep; a rock back toward child\'s pose (shoulders shrink below minShoulderWidthRatio: the attempt ends as repCancelled rockedBack); a bigger rock back (out of plank: repCancelled outOfPlank, paused outOfPlank, hint backToPlank, then resumed); a head nod with the shoulders still (hint chestNotHead, no count); a rep held at the bottom for 11 s (repCancelled tooSlow); one more rep. targetReps 30.',
    config: { targetReps: 30 },
    frames: () =>
      simulateSession(
        [
          ...standardSet([{ minElbowDeg: 80 }]),
          { kind: 'rockBack', backM: 0.2, dropM: 0.2 },
          { kind: 'hold', ms: 1500 },
          { kind: 'rockBack', backM: 0.4, dropM: 0.15, holdMs: 1200 },
          { kind: 'hold', ms: 2000 },
          { kind: 'headBob', dropM: 0.15 },
          { kind: 'hold', ms: 1000 },
          { kind: 'rep', spec: { minElbowDeg: 80, bottomHoldMs: 11000 } },
          { kind: 'rep', spec: { minElbowDeg: 80 } },
          { kind: 'hold', ms: 500 },
        ],
        { fps: 15, noisePx: 1, seed: 10 },
      ).frames,
    check: (r) => {
      expect(reasons(r, 'repCancelled')).toEqual(['rockedBack', 'outOfPlank', 'tooSlow']);
      expect(reasons(r, 'paused')).toEqual(['outOfPlank']);
      expect(countOf(r, 'resumed')).toBe(1);
      expect(r.snaps.some((s) => s.hint === 'chestNotHead')).toBe(true);
      expect(r.snaps.some((s) => s.hint === 'backToPlank')).toBe(true);
      expect(countOf(r, 'rep')).toBe(2);
    },
  },
  {
    name: '11-low-fps-6',
    description:
      'Simulated at 6 fps (like a slow CPU fallback), 1 px noise: a 6 s plank still calibrates (the calibration rule is time-based: ≥ 4 samples spanning ≥ 70 % of the 1 s window), then 4 slow full reps (75°, 0.9 s each way) count. targetReps 30.',
    config: { targetReps: 30 },
    frames: () =>
      simulateSession([...standardSet(specs(4, { minElbowDeg: 75, downMs: 900, upMs: 900 }), 6000), { kind: 'hold', ms: 1000 }], {
        fps: 6,
        noisePx: 1,
        seed: 11,
      }).frames,
    check: (r) => {
      expect(countOf(r, 'start')).toBe(1);
      expect(countOf(r, 'rep')).toBe(4);
    },
  },
  {
    name: '12-phone-moved-after-pause',
    description:
      'Simulated, 30 fps, 1 px noise: two reps, the user walks away (paused lost), the phone is propped up again at a steeper tilt (18° instead of 8°) so the hand line moves, the user comes back, the set resumes and six more reps count (8 in total). targetReps 30.',
    config: { targetReps: 30 },
    frames: () =>
      concat(
        simulateSession(standardSet(specs(2, { minElbowDeg: 80 })), { noisePx: 1, seed: 12 }).frames,
        simulateSession([{ kind: 'absent', ms: 2000 }, { kind: 'hold', ms: 1500 }, ...reps(6, { minElbowDeg: 80 }), { kind: 'hold', ms: 500 }], {
          geometry: { tiltDeg: 18 },
          noisePx: 1,
          seed: 120,
        }).frames,
      ),
    check: (r) => {
      expect(reasons(r, 'paused')).toEqual(['lost']);
      expect(countOf(r, 'resumed')).toBe(1);
      expect(countOf(r, 'rep')).toBe(8);
    },
  },
  {
    name: '13-dropouts-24fps-jitter',
    description:
      'Simulated at 24 fps, 2 px noise, ±8 ms frame-time jitter and random single-joint confidence dropouts (c = 0.15 for one joint in ~2 % of frames). Full (80°, 70°, 75°, 85°), partial (120°, 112°) and borderline (100°) reps. Around the 6th rep (75°) BOTH wrists are hidden (c = 0.1, like hands lost in low light): depth then comes from the shoulders against the frozen hand line (depthSource "shoulders", hint "handsInView") and the rep still counts. targetReps 30.',
    config: { targetReps: 30 },
    frames: () => {
      const sim = simulateSession(standardSet([80, 120, 70, 112, 100, 75, 85].map((minElbowDeg) => ({ minElbowDeg }))), {
        fps: 24,
        noisePx: 2,
        dropoutRate: 0.02,
        timeJitterMs: 8,
        seed: 13,
      });
      const hidden = sim.reps[5];
      if (!hidden) throw new Error('simulator returned no 6th rep');
      const from = hidden.tStart - 300;
      const to = hidden.tEnd + 200;
      return sim.frames.map((f): PoseFrame => {
        const j = f.joints;
        if (!j || f.t < from || f.t >= to) return f;
        const lw = j.leftWrist;
        const rw = j.rightWrist;
        return {
          ...f,
          joints: {
            ...j,
            ...(lw ? { leftWrist: { ...lw, c: 0.1 } } : {}),
            ...(rw ? { rightWrist: { ...rw, c: 0.1 } } : {}),
          },
        };
      });
    },
    check: (r) => {
      // 80 ✓, 120 Go lower, 70 ✓, 112 Go lower, 100 (borderline here) Go lower, 75 ✓ (wrists hidden), 85 ✓.
      expect(countOf(r, 'rep')).toBe(4);
      expect(countOf(r, 'partial')).toBe(3);
      expect(r.snaps.some((s) => s.phase === 'counting' && s.depthSource === 'shoulders' && s.hint === 'handsInView')).toBe(true);
      // The rep done with hidden wrists counted while they were still hidden.
      expect(r.snaps.some((s) => s.depthSource === 'shoulders' && s.events.some((e) => e.type === 'rep'))).toBe(true);
    },
  },
  {
    name: '14-placement-hints-and-shuffle-away',
    description:
      'Simulated, 30 fps, 1 px noise, five separate simulations joined end to end (so the person jumps between setups): too far (headDistance 2.6 m: shoulders < 15 % of the frame width → hint moveCloser while waiting); too close (a high, wide-angle phone 0.55 m away: shoulders > 70 % of the width → moveBack); a normal setup: calibrate, 2 reps; too far again mid-set (shoulder-width ratio < 0.8 → out-of-plank pause, paused hint moveCloser, the attempt the jump started is cancelled); back to normal: resumed, 2 more reps. targetReps 30.',
    config: { targetReps: 30 },
    frames: () => {
      const far = { headDistance: 2.6 };
      const tooClose = { vFovDeg: 46, tiltDeg: 8, headDistance: 0.55, camHeight: 0.2, handWidthRatio: 1 };
      const parts = [
        simulateSession([{ kind: 'hold', ms: 1500 }], { geometry: far, noisePx: 1, seed: 141 }).frames,
        simulateSession([{ kind: 'hold', ms: 1500 }], { geometry: tooClose, noisePx: 1, seed: 142 }).frames,
        simulateSession(standardSet(specs(2, { minElbowDeg: 80 })), { noisePx: 1, seed: 143 }).frames,
        simulateSession([{ kind: 'hold', ms: 1500 }], { geometry: far, noisePx: 1, seed: 144 }).frames,
        simulateSession([{ kind: 'hold', ms: 1500 }, ...reps(2, { minElbowDeg: 80 }), { kind: 'hold', ms: 500 }], { noisePx: 1, seed: 145 })
          .frames,
      ];
      return parts.reduce((acc, part) => concat(acc, part));
    },
    check: (r) => {
      const hintsIn = (phase: string): Set<string | null> => new Set(r.snaps.filter((s) => s.phase === phase).map((s) => s.hint));
      expect(hintsIn('waiting').has('moveCloser')).toBe(true);
      expect(hintsIn('waiting').has('moveBack')).toBe(true);
      expect(hintsIn('paused').has('moveCloser')).toBe(true);
      expect(reasons(r, 'paused')).toEqual(['outOfPlank']);
      expect(countOf(r, 'resumed')).toBe(1);
      expect(countOf(r, 'rep')).toBe(4);
    },
  },
  {
    name: '15-fast-reps-and-too-fast-bounce',
    description:
      'Simulated, 30 fps, 1 px noise: fast push-ups (75°, 0.3 s down, no hold, 0.3 s up, 0.2 s rest) count; one 0.15 s-each-way bounce (60°) reaches depth (depthReached) but is back up in less than minRepMs (450 ms), so it is silently ignored: no rep, no partial, no repCancelled. 4 reps. targetReps 30.',
    config: { targetReps: 30 },
    frames: () => {
      const fast: RepSpec = { minElbowDeg: 75, downMs: 300, upMs: 300, bottomHoldMs: 0, topRestMs: 200 };
      const bounce: RepSpec = { minElbowDeg: 60, downMs: 150, upMs: 150, bottomHoldMs: 0, topRestMs: 600 };
      return simulateSession([...standardSet([fast, fast, bounce, fast, fast]), { kind: 'hold', ms: 800 }], { noisePx: 1, seed: 15 }).frames;
    },
    check: (r) => {
      expect(countOf(r, 'depthReached')).toBe(5);
      expect(countOf(r, 'rep')).toBe(4);
      expect(countOf(r, 'partial')).toBe(0);
      expect(countOf(r, 'repCancelled')).toBe(0);
    },
  },
  {
    name: '16-bent-arm-calibration-baseline-clamp',
    description:
      'Simulated, 30 fps, 1 px noise: the user calibrates with bent arms (holding a 135° elbow through the 3-2-1), then straightens to the real top (d ≈ −0.09) and rests there: the top baseline hTop adapts upward until it hits its clamp, hTopCalibrated × (1 + baselineMaxDrift) = +8 %. Then 3 full reps (80°) count. targetReps 30.',
    config: { targetReps: 30 },
    frames: () =>
      simulateSession(
        [{ kind: 'holdAt', elbowDeg: 135, ms: 4500 }, { kind: 'hold', ms: 4000 }, ...reps(3, { minElbowDeg: 80 }), { kind: 'hold', ms: 500 }],
        { noisePx: 1, seed: 16 },
      ).frames,
    check: (r) => {
      const start = r.events.find((e) => e.type === 'start');
      if (start?.type !== 'start') throw new Error('no start event');
      const maxTop = Math.max(...r.snaps.map((s) => s.baselineRatio ?? -Infinity));
      expect(maxTop / start.baselineRatio).toBeCloseTo(1.08, 9);
      expect(countOf(r, 'rep')).toBe(3);
      expect(countOf(r, 'partial')).toBe(0);
    },
  },
];

// ---------------------------------------------------------------------------
// Writing

/** One frame / expected entry per line, so git diffs stay readable. */
function render(
  s: Session,
  config: CounterConfig,
  frames: PoseFrame[],
  expected: Record<string, unknown>[],
  run: Run,
): string {
  const eventCounts: Record<string, number> = {};
  for (const e of run.events) eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1;
  const last = run.snaps[run.snaps.length - 1];
  const summary = {
    frames: frames.length,
    durationMs: round((frames[frames.length - 1]?.t ?? 0) - (frames[0]?.t ?? 0), 3),
    finalPhase: last?.phase ?? null,
    finalCount: last?.count ?? 0,
    eventCounts,
  };
  const lines = (items: unknown[]): string => items.map((x) => `    ${JSON.stringify(x)}`).join(',\n');
  return [
    '{',
    `  "format": ${JSON.stringify(GOLDEN_FORMAT)},`,
    `  "name": ${JSON.stringify(s.name)},`,
    `  "description": ${JSON.stringify(s.description)},`,
    `  "summary": ${JSON.stringify(summary)},`,
    `  "config": ${JSON.stringify(config)},`,
    '  "frames": [',
    lines(frames),
    '  ],',
    '  "expected": [',
    lines(expected),
    '  ]',
    '}',
    '',
  ].join('\n');
}

describe('export golden parity fixtures → tests/fixtures/golden/', () => {
  mkdirSync(OUT_DIR, { recursive: true });

  test('session names are unique and file-safe', () => {
    const names = SESSIONS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z0-9-]+$/);
  });

  for (const s of SESSIONS) {
    test(s.name, () => {
      const counter = new RepCounter(s.config);
      const frames = s.frames().map(inputFrame);
      for (let i = 1; i < frames.length; i++) {
        const prev = frames[i - 1]?.t ?? -Infinity;
        if (!((frames[i]?.t ?? -Infinity) > prev)) throw new Error(`${s.name}: timestamps must strictly increase (frame ${i})`);
      }
      const snaps = frames.map((f) => counter.update(f));
      const run: Run = { snaps, events: snaps.flatMap((x) => x.events) };
      s.check(run);
      const expected = snaps.map(expectedOf);
      writeFileSync(join(OUT_DIR, `${s.name}.json`), render(s, counter.config, frames, expected, run), 'utf8');
    });
  }

  test('no stale fixtures are left in the folder', () => {
    const produced = new Set(SESSIONS.map((s) => `${s.name}.json`));
    const stale = readdirSync(OUT_DIR).filter((f) => f.endsWith('.json') && !produced.has(f));
    // A renamed or removed session leaves its old file behind: delete it by hand.
    expect(stale, `delete these from tests/fixtures/golden/: ${stale.join(', ')}`).toEqual([]);
  });
});
