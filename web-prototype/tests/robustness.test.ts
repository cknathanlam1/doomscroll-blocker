/**
 * Robustness sweep: many simulated phone placements, body sizes, hand
 * positions, frame rates, landmark noise and frame timing jitter.
 *
 * The rules being checked are the ones that matter to the user:
 *   - every real push-up (elbow ≤ 85°) counts,
 *   - a clearly shallow one (elbow ≥ 130°) never counts,
 *   - just holding a plank never produces any event.
 * Everything is seeded, so a failure is reproducible from the printed case.
 * The last block stresses the counter BEYOND the expected range (heavy noise,
 * 12 fps, no rest between reps) with safety rules plus accuracy floors.
 */
import { describe, expect, test } from 'vitest';
import { computeFeatures } from '../src/core/features';
import { DEFAULT_CONFIG } from '../src/core/repCounter';
import {
  makeRng,
  poseAtElbow,
  simulateSession,
  standardSet,
  type RepSpec,
  type SimGeometry,
  type SimOptions,
} from './sim/pushupSimulator';
import { eventHistogram, runCounter } from './helpers';

interface SweepCase {
  id: number;
  geometry: Partial<SimGeometry>;
  fps: number;
  noisePx: number;
  timeJitterMs: number;
  frameDropRate: number;
  seed: number;
}

const lerp = (rng: () => number, lo: number, hi: number): number => lo + (hi - lo) * rng();
const pick = <T>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;

/** Random cases across the ranges in the task, plus the nastiest corners. */
function buildCases(n: number): SweepCase[] {
  const rng = makeRng(20261005);
  const cases: SweepCase[] = [];
  for (let i = 0; i < n; i++) {
    const fps = pick(rng, [15, 24, 30] as const);
    cases.push({
      id: i,
      geometry: {
        camHeight: lerp(rng, 0.05, 0.25),
        tiltDeg: lerp(rng, 0, 20),
        headDistance: lerp(rng, 0.7, 1.3),
        bodyScale: lerp(rng, 0.85, 1.15),
        handWidthRatio: lerp(rng, 1.1, 1.8),
        handOffsetZ: lerp(rng, 0, 0.15),
        flareDeg: lerp(rng, 20, 75),
      },
      fps,
      noisePx: lerp(rng, 0, 4),
      // Up to ±30 % of a frame of timestamp jitter, and up to 8 % dropped frames.
      timeJitterMs: rng() < 0.5 ? lerp(rng, 0, 0.3 * (1000 / fps)) : 0,
      frameDropRate: rng() < 0.5 ? lerp(rng, 0, 0.08) : 0,
      seed: 1000 + i,
    });
  }
  // Corners: worst frame rate and noise with extreme placements.
  let id = n;
  for (const camHeight of [0.05, 0.25]) {
    for (const tiltDeg of [0, 20]) {
      for (const headDistance of [0.7, 1.3]) {
        for (const bodyScale of [0.85, 1.15]) {
          cases.push({
            id: id++,
            geometry: { camHeight, tiltDeg, headDistance, bodyScale, handWidthRatio: 1.35, handOffsetZ: 0.08, flareDeg: 45 },
            fps: 15,
            noisePx: 4,
            timeJitterMs: 15,
            frameDropRate: 0.05,
            seed: 5000 + id,
          });
        }
      }
    }
  }
  return cases;
}

/**
 * A placement the app would accept: at the top AND at the bottom of a deep
 * rep the shoulders and at least one wrist are visible, and the top passes
 * the plank gate. Placements that fail this are ones where the app tells the
 * user to fix the phone (and the sweep can't expect counting to work).
 */
function placementUsable(geometry: Partial<SimGeometry>): boolean {
  const cfg = DEFAULT_CONFIG;
  const g = cfg.plankGate;
  for (const elbow of [180, 60]) {
    const f = computeFeatures(poseAtElbow(elbow, geometry), cfg.visibilityThreshold, cfg.wristVisibilityThreshold);
    if (!f.shouldersVisible || f.visibleWrists === 0) return false;
    if (elbow === 180) {
      const frac = f.shoulderWidthFrac ?? 0;
      const h = f.heightRatio ?? 0;
      if (frac < g.minShoulderWidthFrac || frac > g.maxShoulderWidthFrac) return false;
      if (h < g.minHeightRatio || h > g.maxHeightRatio || !f.wristsInSpan) return false;
    }
  }
  return true;
}

function describeCase(c: SweepCase): string {
  const g = Object.entries(c.geometry)
    .map(([k, v]) => `${k}=${(v as number).toFixed(2)}`)
    .join(' ');
  return `#${c.id} fps=${c.fps} noise=${c.noisePx.toFixed(1)} jitter=${c.timeJitterMs.toFixed(1)} drop=${c.frameDropRate.toFixed(2)} seed=${c.seed} ${g}`;
}

function simOptions(c: SweepCase): SimOptions {
  return {
    geometry: c.geometry,
    fps: c.fps,
    noisePx: c.noisePx,
    timeJitterMs: c.timeJitterMs,
    frameDropRate: c.frameDropRate,
    seed: c.seed,
  };
}

/** Random rep timing so speed and pauses vary too. */
function randomReps(rng: () => number, n: number, minDeg: number, maxDeg: number): RepSpec[] {
  return Array.from({ length: n }, () => ({
    minElbowDeg: lerp(rng, minDeg, maxDeg),
    downMs: lerp(rng, 400, 1500),
    bottomHoldMs: lerp(rng, 0, 400),
    upMs: lerp(rng, 400, 1200),
    topRestMs: lerp(rng, 300, 900),
  }));
}

const CASES = buildCases(250);
const USABLE = CASES.filter((c) => placementUsable(c.geometry));
const REPS_PER_SESSION = 6;

describe('robustness sweep', () => {
  test('most sampled placements are usable (otherwise the sweep proves little)', () => {
    expect(USABLE.length).toBeGreaterThanOrEqual(CASES.length * 0.8);
  });

  test('every full rep (elbow 60–85°) counts, with no false partials', () => {
    const failures: string[] = [];
    for (const c of USABLE) {
      const rng = makeRng(c.seed * 7 + 1);
      const sim = simulateSession(standardSet(randomReps(rng, REPS_PER_SESSION, 60, 85)), simOptions(c));
      const r = runCounter(sim.frames);
      const hist = eventHistogram(r.events);
      if (r.finalCount !== REPS_PER_SESSION || hist.partial || hist.repCancelled || hist.paused) {
        failures.push(`${describeCase(c)} → count ${r.finalCount} ${JSON.stringify(hist)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('shallow reps (elbow 130–150°) never count', () => {
    const failures: string[] = [];
    for (const c of USABLE) {
      const rng = makeRng(c.seed * 7 + 2);
      const sim = simulateSession(standardSet(randomReps(rng, REPS_PER_SESSION, 130, 150)), simOptions(c));
      const r = runCounter(sim.frames);
      const hist = eventHistogram(r.events);
      if (r.finalCount !== 0 || hist.depthReached) {
        failures.push(`${describeCase(c)} → count ${r.finalCount} ${JSON.stringify(hist)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('holding a plank produces no events after the start', () => {
    const failures: string[] = [];
    for (const c of USABLE) {
      const sim = simulateSession([{ kind: 'hold', ms: 20000 }], simOptions(c));
      const r = runCounter(sim.frames);
      const types = r.events.map((e) => e.type);
      const startIdx = types.indexOf('start');
      const after = startIdx >= 0 ? types.slice(startIdx + 1) : ['<never started>'];
      if (after.length > 0) failures.push(`${describeCase(c)} → ${after.join(',')}`);
    }
    expect(failures).toEqual([]);
  });

  test('fast back-to-back reps (0.3–0.5 s each way, short rest at the top) all count', () => {
    const failures: string[] = [];
    for (const c of USABLE) {
      const rng = makeRng(c.seed * 7 + 3);
      const reps: RepSpec[] = Array.from({ length: REPS_PER_SESSION }, () => ({
        minElbowDeg: lerp(rng, 60, 85),
        downMs: lerp(rng, 300, 500),
        bottomHoldMs: lerp(rng, 0, 80),
        upMs: lerp(rng, 300, 500),
        topRestMs: lerp(rng, 150, 300),
      }));
      // A short hold at the end so the last rep has time to reach the top.
      const sim = simulateSession([...standardSet(reps), { kind: 'hold', ms: 1000 }], simOptions(c));
      const r = runCounter(sim.frames);
      const hist = eventHistogram(r.events);
      if (r.finalCount !== REPS_PER_SESSION || hist.partial || hist.repCancelled) {
        failures.push(`${describeCase(c)} → count ${r.finalCount} ${JSON.stringify(hist)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("rocking back toward child's pose never counts", () => {
    // A real rock toward child's pose moves the shoulders back ~40 cm. (A
    // 30 cm rock from 1.3 m away only shrinks the shoulders to ~0.89×, right at
    // minShoulderWidthRatio — the check is weaker when the user is far away.)
    const failures: string[] = [];
    for (const c of USABLE) {
      const sim = simulateSession(
        [{ kind: 'hold', ms: 4500 }, ...Array.from({ length: 3 }, () => ({ kind: 'rockBack' as const, backM: 0.4, dropM: 0.3 })), { kind: 'hold', ms: 1000 }],
        simOptions(c),
      );
      const r = runCounter(sim.frames);
      if (r.finalCount !== 0) failures.push(`${describeCase(c)} → count ${r.finalCount} ${JSON.stringify(eventHistogram(r.events))}`);
    }
    expect(failures).toEqual([]);
  });

  test('head bobs (only the head moves) never count or trigger "Go lower"', () => {
    const failures: string[] = [];
    for (const c of USABLE) {
      const sim = simulateSession(
        [{ kind: 'hold', ms: 4500 }, ...Array.from({ length: 3 }, () => ({ kind: 'headBob' as const, dropM: 0.15 })), { kind: 'hold', ms: 500 }],
        simOptions(c),
      );
      const r = runCounter(sim.frames);
      const hist = eventHistogram(r.events);
      if (r.finalCount !== 0 || hist.partial || hist.depthReached) {
        failures.push(`${describeCase(c)} → count ${r.finalCount} ${JSON.stringify(hist)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('partial reps (elbow 112°) never count and each one gets exactly one "Go lower"', () => {
    const failures: string[] = [];
    // A subset keeps the runtime down; partial detection is less noise-sensitive than counting.
    for (const c of USABLE.filter((_, i) => i % 3 === 0)) {
      const sim = simulateSession(
        standardSet(Array.from({ length: 4 }, () => ({ minElbowDeg: 112 }))),
        simOptions(c),
      );
      const r = runCounter(sim.frames);
      const hist = eventHistogram(r.events);
      if (r.finalCount !== 0 || hist.partial !== 4) {
        failures.push(`${describeCase(c)} → count ${r.finalCount} ${JSON.stringify(hist)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

/**
 * Stress BEYOND the expected operating range: heavy landmark noise (6–8 px),
 * 12 fps, dropped frames and almost no rest at the top between fast reps.
 * (Formerly an exploratory script that only printed numbers.)
 *
 * The SAFETY rules must hold in every case — a clearly shallow rep never
 * counts, a session never counts more reps than were done, and holding a
 * plank never counts a rep. Accuracy may degrade, but not below the floors
 * set per case (measured rates in the comments; floors leave some margin).
 * A missed rep is the forgiving failure: the user just does one more.
 */
describe('stress beyond the expected operating range', () => {
  interface StressCase {
    name: string;
    noisePx: number;
    fps: number;
    /** Rest at the top between fast reps: [lo, lo + 120] ms. */
    fastRestMs: number;
    frameDropRate: number;
    /** Minimum share of placements where all 8 fast reps counted exactly. */
    minFastExact: number;
    /** Minimum share where all 6 normal-speed reps counted exactly. */
    minNormalExact: number;
    /** Maximum share of sessions where the 3-2-1 had to restart. */
    maxRestarts: number;
    /** Maximum share of 15 s plank holds with ANY event after the start (never a rep). */
    maxHoldEvents: number;
  }

  const STRESS: StressCase[] = [
    // Almost no rest at the top at 15 fps: the smoothed depth sometimes doesn't
    // get back above upThreshold, so two reps merge into one.
    // measured: fast 91 %, normal 100 %, restarts 0 %, hold events 0 %
    { name: '4 px, 15 fps, 30 ms rests, 5 % drops', noisePx: 4, fps: 15, fastRestMs: 30, frameDropRate: 0.05, minFastExact: 0.85, minNormalExact: 0.97, maxRestarts: 0.03, maxHoldEvents: 0 },
    // measured: fast 100 %, normal 100 %, restarts 0 %, hold events 0 %
    { name: '4 px, 15 fps, 150 ms rests, 5 % drops', noisePx: 4, fps: 15, fastRestMs: 150, frameDropRate: 0.05, minFastExact: 0.93, minNormalExact: 0.97, maxRestarts: 0.03, maxHoldEvents: 0 },
    // measured: fast 98 %, normal 99 %, restarts 1 %, hold events 0 %
    { name: '4 px, 12 fps, 150 ms rests, 5 % drops', noisePx: 4, fps: 12, fastRestMs: 150, frameDropRate: 0.05, minFastExact: 0.92, minNormalExact: 0.95, maxRestarts: 0.04, maxHoldEvents: 0 },
    // measured: fast 100 %, normal 100 %, restarts 0 %, hold events 0 %
    { name: '4 px, 30 fps, 30 ms rests, 5 % drops', noisePx: 4, fps: 30, fastRestMs: 30, frameDropRate: 0.05, minFastExact: 0.95, minNormalExact: 0.97, maxRestarts: 0.03, maxHoldEvents: 0 },
    // measured: fast 96 %, normal 99 %, restarts 0 %, hold events 0 %
    { name: '6 px, 15 fps, 150 ms rests', noisePx: 6, fps: 15, fastRestMs: 150, frameDropRate: 0, minFastExact: 0.9, minNormalExact: 0.93, maxRestarts: 0.05, maxHoldEvents: 0.02 },
    // Heavy noise (≈ 1.3 % of the image height per joint, per frame): far
    // placements start to miss reps, restart the 3-2-1 and see false
    // "Go lower" while holding — but never a false rep.
    // measured: fast 81 %, normal 89 %, restarts 5 %, hold events 2 % (partials only)
    { name: '8 px, 15 fps, 150 ms rests (degraded)', noisePx: 8, fps: 15, fastRestMs: 150, frameDropRate: 0, minFastExact: 0.7, minNormalExact: 0.8, maxRestarts: 0.12, maxHoldEvents: 0.08 },
  ];

  /** The same 100 random placements for every case (seeded), keeping only usable ones. */
  function stressPlacements(): Partial<SimGeometry>[] {
    const rng = makeRng(11);
    const out: Partial<SimGeometry>[] = [];
    for (let i = 0; i < 100; i++) {
      const g: Partial<SimGeometry> = {
        camHeight: lerp(rng, 0.05, 0.25),
        tiltDeg: lerp(rng, 0, 20),
        headDistance: lerp(rng, 0.7, 1.3),
        bodyScale: lerp(rng, 0.85, 1.15),
        handWidthRatio: lerp(rng, 1.1, 1.8),
        handOffsetZ: lerp(rng, 0, 0.15),
        flareDeg: lerp(rng, 20, 75),
      };
      if (placementUsable(g)) out.push(g);
    }
    return out;
  }
  const PLACEMENTS = stressPlacements();

  test('enough stress placements are usable', () => {
    expect(PLACEMENTS.length).toBeGreaterThanOrEqual(80);
  });

  for (const sc of STRESS) {
    test(sc.name, () => {
      const rng = makeRng(sc.noisePx * 1000 + sc.fps * 10 + sc.fastRestMs);
      const safety: string[] = [];
      let fastExact = 0;
      let normalExact = 0;
      let restarts = 0;
      let holdEvents = 0;
      PLACEMENTS.forEach((geometry, i) => {
        const opts: SimOptions = { geometry, fps: sc.fps, noisePx: sc.noisePx, seed: i + 1, timeJitterMs: 10, frameDropRate: sc.frameDropRate };

        const fast: RepSpec[] = Array.from({ length: 8 }, () => ({
          minElbowDeg: lerp(rng, 60, 85),
          downMs: lerp(rng, 300, 500),
          upMs: lerp(rng, 300, 500),
          bottomHoldMs: lerp(rng, 0, 80),
          topRestMs: lerp(rng, sc.fastRestMs, sc.fastRestMs + 120),
        }));
        const rf = runCounter(simulateSession([...standardSet(fast, 6000), { kind: 'hold', ms: 1000 }], opts).frames);
        if (rf.finalCount === 8) fastExact++;
        if (rf.finalCount > 8) safety.push(`#${i} fast: counted ${rf.finalCount} of 8`);

        const normal = Array.from({ length: 6 }, (_, k): RepSpec => ({ minElbowDeg: 60 + k * 5 }));
        const rn = runCounter(simulateSession([...standardSet(normal, 6000), { kind: 'hold', ms: 1000 }], opts).frames);
        if (rn.finalCount === 6) normalExact++;
        if (rn.finalCount > 6) safety.push(`#${i} normal: counted ${rn.finalCount} of 6`);
        if ((eventHistogram(rn.events).countdownTick ?? 0) > 3) restarts++;

        const rs = runCounter(simulateSession(standardSet(Array.from({ length: 6 }, () => ({ minElbowDeg: 130 }))), opts).frames);
        if (rs.finalCount !== 0) safety.push(`#${i} shallow 130°: counted ${rs.finalCount}`);

        const rh = runCounter(simulateSession([{ kind: 'hold', ms: 15000 }], opts).frames);
        const types = rh.events.map((e) => e.type);
        const after = types.slice(types.indexOf('start') + 1);
        if (types.indexOf('start') < 0) safety.push(`#${i} hold: never started`);
        if (after.length > 0) holdEvents++;
        if (after.includes('rep')) safety.push(`#${i} hold: counted a rep`);
      });

      const n = PLACEMENTS.length;
      const stats = `fast ${((100 * fastExact) / n).toFixed(0)} %, normal ${((100 * normalExact) / n).toFixed(0)} %, restarts ${((100 * restarts) / n).toFixed(0)} %, hold events ${((100 * holdEvents) / n).toFixed(0)} %`;
      expect(safety, stats).toEqual([]);
      expect(fastExact / n, stats).toBeGreaterThanOrEqual(sc.minFastExact);
      expect(normalExact / n, stats).toBeGreaterThanOrEqual(sc.minNormalExact);
      expect(restarts / n, stats).toBeLessThanOrEqual(sc.maxRestarts);
      expect(holdEvents / n, stats).toBeLessThanOrEqual(sc.maxHoldEvents);
    });
  }
});
