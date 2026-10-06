/**
 * Behaviour tests for the push-up state machine (src/core/repCounter.ts),
 * driven by the geometric simulator so the inputs come from real camera
 * geometry, not from the counter's own assumptions. Everything is seeded.
 *
 * Default timeline from t = 0 with a plank in view: the plank gate passes at
 * once → after calibrationHoldMs (600) 'inFrame' + countdown "3" → "2" at
 * 1600 → "1" at 2600 → 'start' at 3600. standardSet() holds 4.5 s first.
 */
import { describe, expect, test } from 'vitest';
import { computeFeatures } from '../src/core/features';
import { DEFAULT_CONFIG, RepCounter } from '../src/core/repCounter';
import type { CounterEvent, CounterSnapshot, Joint2D, Joints2D, PoseFrame } from '../src/core/types';
import { simulateSession, standardSet, type RepSpec, type Segment, type SimGeometry, type SimOptions } from './sim/pushupSimulator';
import { eventHistogram, eventsOfType, eventTypes, mirrorFrame, runCounter } from './helpers';

const FRAME = 1000 / 30;
const CFG = DEFAULT_CONFIG;

// ---------------------------------------------------------------------------
// Helpers

/** Returns a copy of `frames` where frames with t in [t0, t1) are replaced by `fn(frame)`. */
function alterWindow(frames: PoseFrame[], t0: number, t1: number, fn: (f: PoseFrame) => PoseFrame): PoseFrame[] {
  return frames.map((f) => (f.t >= t0 && f.t < t1 ? fn(f) : f));
}

/** Nobody detected. */
const blank = (f: PoseFrame): PoseFrame => ({ ...f, joints: null, world: null });

/** Every joint's confidence set to `c` (e.g. a dark room). */
const lowConfidence =
  (c: number) =>
  (f: PoseFrame): PoseFrame => {
    if (!f.joints) return f;
    const joints: Joints2D = {};
    for (const [name, j] of Object.entries(f.joints) as [keyof Joints2D, Joint2D | undefined][]) {
      if (j) joints[name] = { ...j, c };
    }
    return { ...f, joints };
  };

/** Wrists not detected (confidence 0), everything else unchanged. */
const hideWrists = (f: PoseFrame): PoseFrame => {
  if (!f.joints) return f;
  const joints: Joints2D = { ...f.joints };
  if (joints.leftWrist) joints.leftWrist = { ...joints.leftWrist, c: 0 };
  if (joints.rightWrist) joints.rightWrist = { ...joints.rightWrist, c: 0 };
  return { ...f, joints };
};

const reps = (n: number, spec: RepSpec): RepSpec[] => Array.from({ length: n }, () => ({ ...spec }));

/** Event types that matter for counting (leaves out the calibration ones and depthReached). */
function countingEvents(events: CounterEvent[]): string[] {
  const keep = new Set(['rep', 'partial', 'repCancelled', 'paused', 'resumed', 'complete']);
  return events
    .filter((e) => keep.has(e.type))
    .map((e) => ('reason' in e ? `${e.type}:${e.reason}` : e.type));
}

function snapshotAt(snaps: CounterSnapshot[], t: number): CounterSnapshot {
  let best: CounterSnapshot | undefined;
  for (const s of snaps) if (s.features.t <= t) best = s;
  if (!best) throw new Error(`no snapshot at ${t}`);
  return best;
}

/** Plays session B right after session A (B's timestamps shifted to continue A's). */
function concat(a: PoseFrame[], b: PoseFrame[]): PoseFrame[] {
  const lastT = a[a.length - 1]?.t ?? 0;
  const firstB = b[0]?.t ?? 0;
  return [...a, ...b.map((f) => ({ ...f, t: f.t - firstB + lastT + FRAME }))];
}

// ---------------------------------------------------------------------------

describe('calibration (Placement screen → 3-2-1 → start)', () => {
  const sim = simulateSession([{ kind: 'hold', ms: 5000 }]);
  const r = runCounter(sim.frames);

  test('events: inFrame → countdownTick 3, 2, 1 → start, and nothing else', () => {
    expect(eventTypes(r.events)).toEqual(['inFrame', 'countdownTick', 'countdownTick', 'countdownTick', 'start']);
    expect(eventsOfType(r.events, 'countdownTick').map((e) => e.secondsLeft)).toEqual([3, 2, 1]);
  });

  test('timing follows calibrationHoldMs and the countdown, in ms', () => {
    const [inFrame, tick3, tick2, tick1, start] = r.events;
    const near = (t: number | undefined, expected: number) => {
      expect(t).toBeGreaterThanOrEqual(expected - 1e-6);
      expect(t).toBeLessThan(expected + FRAME + 1e-6);
    };
    near(inFrame?.t, CFG.calibrationHoldMs);
    expect(tick3?.t).toBe(inFrame?.t);
    near(tick2?.t, CFG.calibrationHoldMs + 1000);
    near(tick1?.t, CFG.calibrationHoldMs + 2000);
    near(start?.t, CFG.calibrationHoldMs + CFG.countdownMs);
  });

  test('the baseline is the heightRatio at the top', () => {
    const start = eventsOfType(r.events, 'start')[0];
    const hTrue = computeFeatures(sim.frames[0] as PoseFrame, CFG.visibilityThreshold, CFG.wristVisibilityThreshold).heightRatio;
    expect(start?.baselineRatio).toBeCloseTo(hTrue ?? NaN, 3);
  });

  test('snapshots: phases, countdown timer, hints, startedAt and depth line', () => {
    const startT = eventsOfType(r.events, 'start')[0]?.t ?? NaN;
    const inFrameT = eventsOfType(r.events, 'inFrame')[0]?.t ?? NaN;
    let lastRemaining = Infinity;
    for (const s of r.snapshots) {
      const t = s.features.t;
      if (t < inFrameT) {
        expect(s.phase).toBe('waiting');
        expect(s.hint).toBe('holdStill'); // in a plank, but not for long enough yet
        expect(s.plankOk).toBe(true);
      } else if (t < startT) {
        expect(s.phase).toBe('countdown');
        expect(s.hint).toBeNull();
        expect(s.countdownRemainingMs).not.toBeNull();
        expect(s.countdownRemainingMs as number).toBeLessThanOrEqual(lastRemaining);
        expect(s.countdownRemainingMs as number).toBeLessThanOrEqual(CFG.countdownMs);
        lastRemaining = s.countdownRemainingMs as number;
      } else {
        expect(s.phase).toBe('counting');
        expect(s.countdownRemainingMs).toBeNull();
        expect(s.hint).toBeNull();
      }
      if (s.phase !== 'countdown') expect(s.countdownRemainingMs).toBeNull();
      expect(s.startedAt).toBe(t < startT ? null : startT);
      expect(s.baselineRatio === null).toBe(t < startT);
      expect(s.depthLineY === null).toBe(t < startT);
      expect(s.depth === null).toBe(t < startT);
      expect(s.count).toBe(0);
      expect(s.target).toBe(CFG.targetReps);
      // inFrame turns on after resumeAfterMs of visible shoulders.
      expect(s.inFrame).toBe(t >= CFG.resumeAfterMs - 1e-6);
    }
  });

  test('moving during the countdown restarts it with "hold still"; it starts once the user is still', () => {
    // Bobbing down to 115° and back, once a second, from t = 1 s to t = 5 s.
    const bob: Segment[] = [
      { kind: 'hold', ms: 1000 },
      ...reps(4, { minElbowDeg: 115, downMs: 500, upMs: 500, bottomHoldMs: 0, topRestMs: 0 }).map((spec): Segment => ({ kind: 'rep', spec })),
      { kind: 'hold', ms: 5000 },
    ];
    const res = runCounter(simulateSession(bob).frames);
    const ticks = eventsOfType(res.events, 'countdownTick').map((e) => e.secondsLeft);
    expect(ticks.slice(0, 4)).toEqual([3, 2, 1, 3]); // restarted instead of starting
    const restartT = eventsOfType(res.events, 'countdownTick')[3]?.t ?? NaN;
    const startT = eventsOfType(res.events, 'start')[0]?.t ?? NaN;
    expect(startT).toBeGreaterThan(5000); // never calibrates while moving
    const hints = res.snapshots.filter((s) => s.phase === 'countdown' && s.features.t > restartT).map((s) => s.hint);
    expect(hints).toContain('holdStill');
    // The baseline was measured while still, so it is the real top.
    const hTrue = computeFeatures(simulateSession([{ kind: 'hold', ms: 34 }]).frames[0] as PoseFrame, 0.5, 0.4).heightRatio;
    expect(eventsOfType(res.events, 'start')[0]?.baselineRatio).toBeCloseTo(hTrue ?? NaN, 2);
  });

  test('leaving the plank during the countdown cancels it (after a short grace period)', () => {
    const segs: Segment[] = [{ kind: 'hold', ms: 1500 }, { kind: 'rep', spec: { minElbowDeg: 80 } }, { kind: 'hold', ms: 6000 }];
    const res = runCounter(simulateSession(segs).frames);
    const types = eventTypes(res.events);
    expect(types.slice(0, 3)).toEqual(['inFrame', 'countdownTick', 'countdownTick']);
    expect(types).toContain('countdownCancelled');
    // ...then starts over from "in frame" and calibrates normally.
    const afterCancel = types.slice(types.indexOf('countdownCancelled') + 1);
    expect(afterCancel).toEqual(['inFrame', 'countdownTick', 'countdownTick', 'countdownTick', 'start']);
    expect(res.finalCount).toBe(0);
  });

  test('a still plank calibrates at a low frame rate (5–6.5 fps, e.g. the CPU fallback)', () => {
    // Regression: calibration needed 8 frames in its 1 s window, so below
    // ~7 fps the 3-2-1 restarted forever with "Hold still".
    for (const fps of [6.5, 6, 5]) {
      const res = runCounter(simulateSession([{ kind: 'hold', ms: 8000 }], { fps, noisePx: 1, seed: 1 }).frames);
      expect(eventsOfType(res.events, 'countdownTick'), `${fps} fps`).toHaveLength(3);
      expect(eventsOfType(res.events, 'start'), `${fps} fps`).toHaveLength(1);
    }
  });
});

describe('counting', () => {
  test('10 full reps → exactly 10 rep events (1..10) then complete; nothing counts after complete', () => {
    const sim = simulateSession(standardSet(reps(12, { minElbowDeg: 80 })));
    const r = runCounter(sim.frames);
    const repEvents = eventsOfType(r.events, 'rep');
    expect(repEvents.map((e) => e.count)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const complete = eventsOfType(r.events, 'complete');
    expect(complete).toHaveLength(1);
    expect(complete[0]?.count).toBe(10);
    expect(complete[0]?.t).toBe(repEvents[9]?.t);
    const startT = eventsOfType(r.events, 'start')[0]?.t ?? NaN;
    expect(complete[0]?.elapsedMs).toBeCloseTo((complete[0]?.t ?? NaN) - startT, 9);
    // 'complete' is the very last event: reps 11 and 12 produce nothing.
    expect(r.events[r.events.length - 1]?.type).toBe('complete');
    for (const s of r.snapshots.filter((x) => x.features.t >= (complete[0]?.t ?? Infinity))) {
      expect(s.phase).toBe('complete');
      expect(s.count).toBe(10);
    }
    // Pattern: each rep is "depth reached" then "rep" — no partials, cancels or pauses.
    expect(countingEvents(r.events)).toEqual([...Array<string>(10).fill('rep'), 'complete']);
    expect(eventsOfType(r.events, 'depthReached')).toHaveLength(10);
  });

  test('each rep is counted at the TOP of its own push-up, never at the bottom', () => {
    const sim = simulateSession(standardSet(reps(5, { minElbowDeg: 80 })));
    const r = runCounter(sim.frames);
    const repEvents = eventsOfType(r.events, 'rep');
    expect(repEvents).toHaveLength(5);
    sim.reps.forEach((simRep, i) => {
      const e = repEvents[i];
      const bottomEnd = simRep.tStart + 700 + 100; // downMs + bottomHoldMs (defaults)
      expect(e?.t).toBeGreaterThan(bottomEnd);
      expect(e?.t).toBeLessThanOrEqual(simRep.tEnd + 400); // within the rest at the top
      expect(e?.peakDepth).toBeGreaterThanOrEqual(CFG.downThreshold);
      // Duration ≈ the push-up itself (1.5 s), measured from leaving the top.
      expect(e?.durationMs).toBeGreaterThan(1000);
      expect(e?.durationMs).toBeLessThan(2000);
    });
  });

  test('partial reps (elbow 120°) never count and get exactly one "Go lower" each', () => {
    for (const opts of [{}, { fps: 15, noisePx: 2, seed: 5 }] as SimOptions[]) {
      const sim = simulateSession(standardSet(reps(5, { minElbowDeg: 120 })), opts);
      const r = runCounter(sim.frames);
      expect(r.finalCount).toBe(0);
      expect(eventsOfType(r.events, 'depthReached')).toHaveLength(0);
      const partials = eventsOfType(r.events, 'partial');
      expect(partials).toHaveLength(5);
      sim.reps.forEach((simRep) => {
        const inWindow = partials.filter((p) => p.t >= simRep.tStart && p.t <= simRep.tEnd + 400);
        expect(inWindow).toHaveLength(1);
      });
      for (const p of partials) {
        expect(p.peakDepth).toBeGreaterThanOrEqual(CFG.partialMinDepth);
        expect(p.peakDepth).toBeLessThan(CFG.downThreshold);
        // Turning back early is noticed on the way up, before reaching the top.
        expect(p.live).toBe(true);
      }
    }
  });

  test('when "turning back" is not detected live, the partial comes at the top instead (still one per attempt)', () => {
    const sim = simulateSession(standardSet(reps(3, { minElbowDeg: 120 })));
    const r = runCounter(sim.frames, { turnBackMargin: 0.5 });
    const partials = eventsOfType(r.events, 'partial');
    expect(partials.map((p) => p.live)).toEqual([false, false, false]);
    expect(r.finalCount).toBe(0);
  });

  test('a mixed set counts exactly the full reps', () => {
    const angles = [80, 120, 70, 85, 120, 60, 88];
    const sim = simulateSession(standardSet(angles.map((minElbowDeg) => ({ minElbowDeg }))));
    const r = runCounter(sim.frames);
    expect(r.finalCount).toBe(5);
    expect(countingEvents(r.events)).toEqual(['rep', 'partial', 'rep', 'rep', 'partial', 'rep', 'rep']);
    // Each event belongs to the right push-up.
    const ordered = r.events.filter((e) => e.type === 'rep' || e.type === 'partial');
    sim.reps.forEach((simRep, i) => {
      const e = ordered[i];
      expect(e?.type).toBe(simRep.full ? 'rep' : 'partial');
      expect(e?.t).toBeGreaterThanOrEqual(simRep.tStart);
      expect(e?.t).toBeLessThanOrEqual(simRep.tEnd + 400);
    });
  });

  test('a long plank hold (60 s) produces nothing after the start, at 30 and 15 fps', () => {
    for (const opts of [{ fps: 30, noisePx: 2, seed: 1 }, { fps: 15, noisePx: 2, timeJitterMs: 10, seed: 2 }] as SimOptions[]) {
      const r = runCounter(simulateSession([{ kind: 'hold', ms: 60000 }], opts).frames);
      const types = eventTypes(r.events);
      expect(types.slice(types.indexOf('start') + 1)).toEqual([]);
      const counting = r.snapshots.filter((s) => s.phase === 'counting');
      expect(counting.length).toBeGreaterThan(50000 / (1000 / (opts.fps ?? 30)));
      for (const s of counting) {
        expect(s.motion).toBe('up');
        expect(s.count).toBe(0);
        expect(s.hint).toBeNull();
      }
    }
  });

  test('fast reps (0.3 s down, 0.3 s up) all count, at 30 and 15 fps', () => {
    const fast = reps(6, { minElbowDeg: 80, downMs: 300, upMs: 300, bottomHoldMs: 0, topRestMs: 300 });
    for (const fps of [30, 15]) {
      const r = runCounter(simulateSession([...standardSet(fast), { kind: 'hold', ms: 800 }], { fps }).frames);
      expect(r.finalCount).toBe(6);
      expect(eventHistogram(r.events).partial).toBeUndefined();
    }
  });

  test('slow reps (2 s down, 2 s up) all count', () => {
    const slow = reps(4, { minElbowDeg: 80, downMs: 2000, upMs: 2000, bottomHoldMs: 300, topRestMs: 600 });
    const r = runCounter(simulateSession(standardSet(slow)).frames);
    expect(r.finalCount).toBe(4);
    expect(countingEvents(r.events)).toEqual(['rep', 'rep', 'rep', 'rep']);
  });

  test('holding the bottom, then pushing up, counts once', () => {
    const r = runCounter(simulateSession(standardSet(reps(2, { minElbowDeg: 80, bottomHoldMs: 2500 }))).frames);
    expect(r.finalCount).toBe(2);
    expect(eventsOfType(r.events, 'depthReached')).toHaveLength(2);
    expect(countingEvents(r.events)).toEqual(['rep', 'rep']);
  });

  test('an attempt longer than maxRepMs is cancelled as tooSlow; the next rep counts', () => {
    const sim = simulateSession(standardSet([{ minElbowDeg: 80, bottomHoldMs: 11000 }, { minElbowDeg: 80 }]));
    const r = runCounter(sim.frames);
    expect(countingEvents(r.events)).toEqual(['repCancelled:tooSlow', 'rep']);
    expect(r.finalCount).toBe(1);
  });

  test('a bounce faster than minRepMs is not a push-up', () => {
    const sim = simulateSession([...standardSet([{ minElbowDeg: 80, downMs: 150, upMs: 150, bottomHoldMs: 30 }]), { kind: 'hold', ms: 1000 }]);
    expect(runCounter(sim.frames).finalCount).toBe(0);
  });

  test('a mirrored video gives identical counts and events', () => {
    const angles = [80, 120, 70, 95, 130, 85];
    const sim = simulateSession(standardSet(angles.map((minElbowDeg) => ({ minElbowDeg }))), {
      fps: 24,
      noisePx: 2,
      dropoutRate: 0.02,
      timeJitterMs: 8,
      seed: 9,
    });
    const a = runCounter(sim.frames);
    const b = runCounter(sim.frames.map(mirrorFrame));
    expect(a.finalCount).toBeGreaterThanOrEqual(3);
    // Same events at the same times. (Numbers inside them may differ in the
    // last binary digit: aspect - x is not exactly reversible in floating point.)
    expect(b.events.map((e) => `${e.type}@${e.t}`)).toEqual(a.events.map((e) => `${e.type}@${e.t}`));
    expect(eventsOfType(b.events, 'rep').map((e) => e.peakDepth)).toEqual(
      eventsOfType(a.events, 'rep').map((e) => expect.closeTo(e.peakDepth, 9) as unknown as number),
    );
    expect(b.snapshots.map((s) => s.count)).toEqual(a.snapshots.map((s) => s.count));
    a.snapshots.forEach((s, i) => {
      const m = b.snapshots[i];
      if (s.depth === null) expect(m?.depth).toBeNull();
      else expect(m?.depth).toBeCloseTo(s.depth, 9);
    });
  });
});

describe('losing the user mid-set', () => {
  // Three good reps, then a slow 4th rep during which the user disappears.
  const slowRep: RepSpec = { minElbowDeg: 80, downMs: 1500, bottomHoldMs: 1500, upMs: 700 };
  const segments: Segment[] = [
    ...standardSet([...reps(3, { minElbowDeg: 80 }), slowRep]),
    { kind: 'hold', ms: 1000 },
    ...reps(2, { minElbowDeg: 80 }).map((spec): Segment => ({ kind: 'rep', spec })),
    { kind: 'hold', ms: 500 },
  ];
  const sim = simulateSession(segments);
  const gapStart = (sim.reps[3]?.tStart ?? NaN) + 1000; // deep into the descent
  const gapEnd = gapStart + 1500; // reappears at the bottom

  function checkPauseAndResume(frames: PoseFrame[]): void {
    const r = runCounter(frames);
    // The rep in progress is cancelled (never count what we couldn't see), the
    // count is kept, and counting resumes by itself.
    expect(countingEvents(r.events)).toEqual(['rep', 'rep', 'rep', 'repCancelled:lost', 'paused:lost', 'resumed', 'rep', 'rep']);
    expect(r.finalCount).toBe(5);

    const paused = eventsOfType(r.events, 'paused')[0];
    expect((paused?.t ?? NaN) - gapStart).toBeGreaterThanOrEqual(CFG.lostAfterMs - 1e-6);
    expect((paused?.t ?? NaN) - gapStart).toBeLessThan(CFG.lostAfterMs + 2 * FRAME);
    const during = r.snapshots.filter((s) => s.features.t > (paused?.t ?? 0) && s.features.t < gapEnd);
    expect(during.length).toBeGreaterThan(10);
    for (const s of during) {
      expect(s.phase).toBe('paused');
      expect(s.count).toBe(3);
      expect(s.hint).toBe('getInFrame');
    }
    // Back at the bottom of a push-up is not a plank yet: resumes only once the
    // user is up again, and the half rep they finish doesn't count.
    const resumed = eventsOfType(r.events, 'resumed')[0];
    expect(resumed?.t).toBeGreaterThan(gapEnd + CFG.resumeAfterMs);
    expect(snapshotAt(r.snapshots, (sim.reps[4]?.tStart ?? NaN) - 1).count).toBe(3);
  }

  test('nobody detected → paused("lost") → resumed, count kept, rep in progress cancelled', () => {
    checkPauseAndResume(alterWindow(sim.frames, gapStart, gapEnd, blank));
  });

  test('a low-confidence stretch (e.g. lights dimmed) behaves exactly like being lost', () => {
    checkPauseAndResume(alterWindow(sim.frames, gapStart, gapEnd, lowConfidence(0.2)));
  });

  test('a low-confidence segment between reps pauses and resumes too', () => {
    const segs: Segment[] = [
      ...standardSet(reps(2, { minElbowDeg: 80 })),
      { kind: 'lowConfidence', ms: 1500 },
      { kind: 'hold', ms: 1000 },
      { kind: 'rep', spec: { minElbowDeg: 80 } },
    ];
    const r = runCounter(simulateSession(segs).frames);
    expect(countingEvents(r.events)).toEqual(['rep', 'rep', 'paused:lost', 'resumed', 'rep']);
  });

  test('a short dropout (< lostAfterMs) mid-rep is ignored and the rep still counts', () => {
    const s = simulateSession(standardSet(reps(3, { minElbowDeg: 80 })));
    const t0 = (s.reps[1]?.tStart ?? NaN) + 400;
    const r = runCounter(alterWindow(s.frames, t0, t0 + 300, blank));
    expect(r.finalCount).toBe(3);
    expect(countingEvents(r.events)).toEqual(['rep', 'rep', 'rep']);
    // Depth is unknown while nobody is visible, and the hint asks to get back in frame.
    const mid = snapshotAt(r.snapshots, t0 + 150);
    expect(mid.depth).toBeNull();
    expect(mid.hint).toBe('getInFrame');
    expect(mid.phase).toBe('counting');
  });

  test('coming back FURTHER from the phone (shoulders 25 % smaller) resumes and keeps counting', () => {
    // Regression: the resume check used to demand the old shoulder width, so
    // this user was stuck on "back to plank" forever.
    const a = simulateSession(standardSet(reps(2, { minElbowDeg: 80 }))).frames;
    const b = simulateSession([{ kind: 'absent', ms: 2000 }, { kind: 'hold', ms: 1500 }, ...reps(3, { minElbowDeg: 80 }).map((spec): Segment => ({ kind: 'rep', spec })), { kind: 'hold', ms: 500 }], {
      geometry: { headDistance: 1.3 },
    }).frames;
    const r = runCounter(concat(a, b));
    expect(countingEvents(r.events)).toEqual(['rep', 'rep', 'paused:lost', 'resumed', 'rep', 'rep', 'rep']);
    expect(r.finalCount).toBe(5);
  });

  test('coming back CLOSER to the phone also works', () => {
    const a = simulateSession(standardSet(reps(2, { minElbowDeg: 80 }))).frames;
    const b = simulateSession([{ kind: 'absent', ms: 2000 }, { kind: 'hold', ms: 1000 }, ...reps(3, { minElbowDeg: 80 }).map((spec): Segment => ({ kind: 'rep', spec }))], {
      geometry: { headDistance: 0.6 },
    }).frames;
    expect(runCounter(concat(a, b)).finalCount).toBe(5);
  });

  test('shuffling back abruptly (no absence) pauses as out-of-plank, then resumes in the new spot', () => {
    // Regression: the shoulder-width jump pauses the set; the user is in a good
    // plank in the new spot, so it must resume (it used to stay paused forever).
    const a = simulateSession(standardSet(reps(2, { minElbowDeg: 80 }))).frames;
    const b = simulateSession([{ kind: 'hold', ms: 1500 }, ...reps(2, { minElbowDeg: 80 }).map((spec): Segment => ({ kind: 'rep', spec }))], {
      geometry: { headDistance: 1.35 },
    }).frames;
    const r = runCounter(concat(a, b));
    // The instant jump briefly fools the depth signal (the hand line follows
    // the wrists with a 0.5 s lag), so an attempt may start and be cancelled
    // as rockedBack first. Either way nothing is counted for it.
    const events = countingEvents(r.events).filter((e) => e !== 'repCancelled:rockedBack');
    expect(events).toEqual(['rep', 'rep', 'paused:outOfPlank', 'resumed', 'rep', 'rep']);
    expect(r.finalCount).toBe(4);
  });

  test('the phone was moved during the pause (propped up again at another tilt or height): counting carries on', () => {
    // Regression: after resuming, the hand line stopped following the wrists
    // until the user was "back at the top", but with the stale hand line the
    // real top read as d ≈ 0.15–0.17, so that never happened and no rep could
    // count again for the rest of the set (with no hint).
    for (const geometry of [{ tiltDeg: 18 }, { tiltDeg: 20 }, { camHeight: 0.2, tiltDeg: 14 }]) {
      const a = simulateSession(standardSet(reps(2, { minElbowDeg: 80 }))).frames;
      const b = simulateSession(
        [{ kind: 'absent', ms: 2000 }, { kind: 'hold', ms: 1500 }, ...reps(6, { minElbowDeg: 80 }).map((spec): Segment => ({ kind: 'rep', spec })), { kind: 'hold', ms: 500 }],
        { geometry, noisePx: 1, seed: 4 },
      ).frames;
      const r = runCounter(concat(a, b), { targetReps: 30 });
      expect(r.finalCount, JSON.stringify(geometry)).toBe(8);
    }
  });

  test('a bump that tilts the phone while resting at the top costs at most one slow attempt, then counting recovers', () => {
    // The jump in depth starts an attempt that can't end (the hand line is
    // frozen during attempts); after maxRepMs it is cancelled, the hand line
    // catches up and later reps count again (they used to never count again).
    const a = simulateSession(standardSet(reps(2, { minElbowDeg: 80 }))).frames;
    const b = simulateSession(
      [{ kind: 'hold', ms: 3000 }, ...reps(10, { minElbowDeg: 80 }).map((spec): Segment => ({ kind: 'rep', spec })), { kind: 'hold', ms: 500 }],
      { geometry: { tiltDeg: 16 }, noisePx: 1, seed: 4 },
    ).frames;
    const r = runCounter(concat(a, b), { targetReps: 30 });
    const after = countingEvents(r.events).slice(2);
    expect(after.filter((e) => e !== 'rep')).toEqual(['repCancelled:tooSlow']);
    expect(r.finalCount).toBeGreaterThanOrEqual(2 + 5);
  });
});

describe('cheating and form hints', () => {
  test("rocking back toward child's pose: repCancelled('rockedBack'), never a rep", () => {
    const segs: Segment[] = [{ kind: 'hold', ms: 4500 }, { kind: 'rockBack', backM: 0.2, dropM: 0.2 }, { kind: 'hold', ms: 1500 }];
    const r = runCounter(simulateSession(segs).frames);
    expect(countingEvents(r.events)).toEqual(['repCancelled:rockedBack']);
    expect(r.finalCount).toBe(0);
    // The shoulders really did shrink below minShoulderWidthRatio.
    const minRatio = Math.min(...r.snapshots.map((s) => s.shoulderWidthRatio ?? Infinity));
    expect(minRatio).toBeLessThan(CFG.minShoulderWidthRatio);
  });

  test('a big rock back pauses as out-of-plank with "back to plank", then resumes at the top', () => {
    const segs: Segment[] = [{ kind: 'hold', ms: 4500 }, { kind: 'rockBack', backM: 0.4, dropM: 0.3 }, { kind: 'hold', ms: 1500 }];
    const r = runCounter(simulateSession(segs).frames);
    expect(countingEvents(r.events)).toEqual(['repCancelled:outOfPlank', 'paused:outOfPlank', 'resumed']);
    expect(r.snapshots.filter((s) => s.phase === 'paused').some((s) => s.hint === 'backToPlank')).toBe(true);
    expect(r.finalCount).toBe(0);
  });

  test('head nod without the chest going down: "chest, not head" hint, no rep, no "Go lower"', () => {
    const segs: Segment[] = [{ kind: 'hold', ms: 4500 }, { kind: 'headBob', dropM: 0.15 }, { kind: 'hold', ms: 3000 }];
    const r = runCounter(simulateSession(segs).frames);
    expect(countingEvents(r.events)).toEqual([]);
    expect(eventsOfType(r.events, 'depthReached')).toHaveLength(0);
    const shown = r.snapshots.filter((s) => s.hint === 'chestNotHead').map((s) => s.features.t);
    expect(shown.length).toBeGreaterThan(0);
    // Not before the nod has lasted a moment; long enough to read from the floor; gone at the end.
    expect(shown[0]).toBeGreaterThan(4500 + 300);
    expect((shown[shown.length - 1] ?? 0) - (shown[0] ?? 0)).toBeGreaterThan(1000);
    expect(r.snapshots[r.snapshots.length - 1]?.hint).toBeNull();
  });

  test('a small nod (8 cm) is not flagged', () => {
    const segs: Segment[] = [{ kind: 'hold', ms: 4500 }, { kind: 'headBob', dropM: 0.08 }, { kind: 'hold', ms: 1000 }];
    const r = runCounter(simulateSession(segs).frames);
    expect(r.snapshots.some((s) => s.hint === 'chestNotHead')).toBe(false);
  });
});

describe('hints before the set starts', () => {
  test('nobody there → "get in frame"', () => {
    const r = runCounter(simulateSession([{ kind: 'absent', ms: 2000 }]).frames);
    for (const s of r.snapshots) {
      expect(s.hint).toBe('getInFrame');
      expect(s.phase).toBe('waiting');
      expect(s.plankOk).toBe(false);
      expect(s.inFrame).toBe(false);
    }
    expect(r.events).toEqual([]);
  });

  test('shoulders visible but no wrists → "hands in view" (and the countdown never starts)', () => {
    const frames = simulateSession([{ kind: 'hold', ms: 3000 }]).frames.map(hideWrists);
    const r = runCounter(frames);
    for (const s of r.snapshots) expect(s.hint).toBe('handsInView');
    expect(r.events).toEqual([]);
  });

  test('too far → "move closer"; too close → "move back"', () => {
    const far = runCounter(simulateSession([{ kind: 'hold', ms: 2000 }], { geometry: { headDistance: 2.5 } }).frames);
    expect(far.snapshots.every((s) => s.hint === 'moveCloser')).toBe(true);
    expect(far.events).toEqual([]);
    // The simulated phone can't get close enough before the shoulders leave
    // the frame, so lower the limit instead (default placement ≈ 0.33 of the width).
    const close = runCounter(simulateSession([{ kind: 'hold', ms: 2000 }]).frames, {
      plankGate: { ...CFG.plankGate, maxShoulderWidthFrac: 0.3 },
    });
    expect(close.snapshots.every((s) => s.hint === 'moveBack')).toBe(true);
  });
});

describe('wrists out of view while counting', () => {
  // A close, steeply tilted phone: shoulders grow most here as they come toward
  // the camera, which is where the old shoulder-only fallback went wrong.
  const geometry: Partial<SimGeometry> = { camHeight: 0.05, headDistance: 0.7, tiltDeg: 20 };
  const sim = simulateSession(standardSet(reps(3, { minElbowDeg: 90 })), { geometry });
  const hidden = alterWindow(sim.frames, 4000, Infinity, hideWrists);

  test('90° reps still count; depth is labelled "shoulders" and the hint asks for the hands', () => {
    // Regression: the fallback read ~25 % shallower than the wrist signal and
    // these reps were all reported as "Go lower".
    const r = runCounter(hidden);
    expect(r.finalCount).toBe(3);
    for (const s of r.snapshots.filter((x) => x.features.t >= 4000)) {
      expect(s.depthSource).toBe('shoulders');
      expect(s.hint).toBe('handsInView');
    }
  });

  test('hiding the wrists keeps depth on the same scale (same formula, last known hand line)', () => {
    const withWrists = runCounter(sim.frames);
    const without = runCounter(hidden);
    expect(without.finalCount).toBe(withWrists.finalCount);
    let maxDiff = 0;
    withWrists.snapshots.forEach((s, i) => {
      const o = without.snapshots[i];
      if (s.depth === null || o?.depth === null || o?.depth === undefined) expect(o?.depth ?? null).toBe(s.depth);
      else maxDiff = Math.max(maxDiff, Math.abs(o.depth - s.depth));
    });
    // The old fallback was ~0.08 shallower at the bottom. What is left (≈ 0.01)
    // comes only from the slow top-baseline adaptation, which runs only while
    // the wrists are visible.
    expect(maxDiff).toBeLessThan(0.02);
  });
});

describe('depthLineY (the line the chest must cross)', () => {
  const down = CFG.downThreshold;

  /**
   * depth is linear in the shoulder y: d - down = (y - lineY) / (hTop · shoulderWidth).
   * Checked on steady frames (end of a long bottom hold), where the smoothed
   * values have settled.
   */
  function checkSteadyIdentity(frames: PoseFrame[], holdEnds: number[]): void {
    const r = runCounter(frames);
    for (const t of holdEnds) {
      const s = snapshotAt(r.snapshots, t);
      const y = s.features.shoulderMid?.y;
      const sw = s.features.shoulderWidth;
      expect(s.depth).not.toBeNull();
      expect(s.depthLineY).not.toBeNull();
      expect(s.baselineRatio).not.toBeNull();
      if (y === undefined || sw === null || s.depth === null || s.depthLineY === null || s.baselineRatio === null) continue;
      expect(s.depth - down).toBeCloseTo((y - s.depthLineY) / (s.baselineRatio * sw), 3);
      // Below the line (larger y, image is y-down) ⇔ deeper than downThreshold.
      if (Math.abs(s.depth - down) > 0.01) expect(y > s.depthLineY).toBe(s.depth > down);
    }
  }

  const angles = [140, 120, 105, 95, 85, 70];
  const holdSpec = (minElbowDeg: number): RepSpec => ({ minElbowDeg, downMs: 800, bottomHoldMs: 1500, upMs: 800, topRestMs: 600 });
  const sim = simulateSession(standardSet(angles.map(holdSpec)));
  const holdEnds = sim.reps.map((r) => r.tStart + 800 + 1500 - 2 * FRAME);

  test('steady frames: depth - downThreshold matches the distance to the line', () => {
    checkSteadyIdentity(sim.frames, holdEnds);
  });

  test('the same holds with the wrists hidden (depth from the shoulders alone)', () => {
    checkSteadyIdentity(alterWindow(sim.frames, 4000, Infinity, hideWrists), holdEnds);
  });

  test('during a slow push-up, depth equals downThreshold where the shoulders cross the line', () => {
    const slow = simulateSession(standardSet([{ minElbowDeg: 70, downMs: 4000, bottomHoldMs: 200, upMs: 4000 }]));
    const r = runCounter(slow.frames);
    const crossings: number[] = [];
    for (let i = 1; i < r.snapshots.length; i++) {
      const a = r.snapshots[i - 1];
      const b = r.snapshots[i];
      const ya = a?.features.shoulderMid?.y;
      const yb = b?.features.shoulderMid?.y;
      if (!a || !b || ya === undefined || yb === undefined || a.depthLineY === null || b.depthLineY === null) continue;
      if (a.depth === null || b.depth === null) continue;
      const ga = ya - a.depthLineY;
      const gb = yb - b.depthLineY;
      if (ga === 0 || Math.sign(ga) !== Math.sign(gb)) {
        // Interpolate depth to the exact crossing.
        const k = ga / (ga - gb);
        crossings.push(a.depth + k * (b.depth - a.depth));
      }
    }
    expect(crossings).toHaveLength(2); // once on the way down, once on the way up
    // Within the smoothing lag of a 4-second push-up.
    for (const d of crossings) expect(Math.abs(d - down)).toBeLessThan(0.02);
  });

  test('a stricter depth setting moves the line lower on the screen (larger y)', () => {
    const counter = new RepCounter();
    const frames = simulateSession([{ kind: 'hold', ms: 5000 }]).frames;
    let before: CounterSnapshot | undefined;
    for (const f of frames.slice(0, -1)) before = counter.update(f);
    counter.setConfig({ downThreshold: 0.35 });
    const after = counter.update(frames[frames.length - 1] as PoseFrame);
    expect(before?.depthLineY).not.toBeNull();
    expect(after.depthLineY as number).toBeGreaterThan(before?.depthLineY as number);
  });
});

describe('setConfig and reset', () => {
  test('setConfig mid-set keeps the count and calibration; new values apply from then on', () => {
    const sim = simulateSession(standardSet(reps(8, { minElbowDeg: 80 })));
    const cut = (sim.reps[2]?.tEnd ?? NaN) + 300; // just after the 3rd rep
    const counter = new RepCounter();
    const first = runCounter(sim.frames.filter((f) => f.t < cut), undefined, counter);
    expect(first.finalCount).toBe(3);
    const baseline = first.snapshots[first.snapshots.length - 1]?.baselineRatio ?? NaN;

    counter.setConfig({ targetReps: 5, downThreshold: 0.3, smoothing: { ...CFG.smoothing, beta: 1.0 } });
    const cfg = counter.config;
    expect(cfg.targetReps).toBe(5);
    expect(cfg.downThreshold).toBe(0.3);
    expect(cfg.smoothing.beta).toBe(1.0);
    expect(cfg.smoothing.minCutoff).toBe(CFG.smoothing.minCutoff);
    expect(cfg.upThreshold).toBe(CFG.upThreshold);

    const rest = runCounter(sim.frames.filter((f) => f.t >= cut), undefined, counter);
    expect(rest.snapshots[0]?.baselineRatio).toBeCloseTo(baseline, 3);
    expect(rest.snapshots[0]?.phase).toBe('counting');
    // No recalibration, and counting continues from 3 to the NEW target of 5.
    expect(eventTypes(rest.events).filter((t) => t === 'start' || t === 'countdownTick' || t === 'inFrame')).toEqual([]);
    expect(eventsOfType(rest.events, 'rep').map((e) => e.count)).toEqual([4, 5]);
    expect(eventsOfType(rest.events, 'complete')[0]?.count).toBe(5);
    expect(rest.snapshots[rest.snapshots.length - 1]?.phase).toBe('complete');
  });

  test('setConfig accepts partially filled nested groups (e.g. one debug slider)', () => {
    const counter = new RepCounter();
    counter.setConfig({ smoothing: { beta: 0.7 } as unknown as typeof CFG.smoothing });
    expect(counter.config.smoothing).toEqual({ ...CFG.smoothing, beta: 0.7 });
    counter.setConfig({ plankGate: { minHeightRatio: 1.0 } as unknown as typeof CFG.plankGate, upThreshold: undefined });
    expect(counter.config.plankGate).toEqual({ ...CFG.plankGate, minHeightRatio: 1.0 });
    expect(counter.config.upThreshold).toBe(CFG.upThreshold);
  });

  test('the config getter returns a copy (callers cannot change the counter by accident)', () => {
    const counter = new RepCounter();
    const cfg = counter.config;
    cfg.downThreshold = 0.9;
    cfg.smoothing.beta = 99;
    expect(counter.config.downThreshold).toBe(CFG.downThreshold);
    expect(counter.config.smoothing.beta).toBe(CFG.smoothing.beta);
  });

  test('reset() goes back to waiting with count 0, keeps the config, and recalibrates', () => {
    const counter = new RepCounter({ targetReps: 4 });
    const a = simulateSession(standardSet(reps(3, { minElbowDeg: 80 }))).frames;
    expect(runCounter(a, undefined, counter).finalCount).toBe(3);

    counter.reset();
    const b = simulateSession(standardSet(reps(2, { minElbowDeg: 80 })), { startT: (a[a.length - 1]?.t ?? 0) + 5000 }).frames;
    const r = runCounter(b, undefined, counter);
    const firstSnap = r.snapshots[0];
    expect(firstSnap?.phase).toBe('waiting');
    expect(firstSnap?.count).toBe(0);
    expect(firstSnap?.baselineRatio).toBeNull();
    expect(firstSnap?.depthLineY).toBeNull();
    expect(firstSnap?.startedAt).toBeNull();
    expect(eventTypes(r.events).slice(0, 5)).toEqual(['inFrame', 'countdownTick', 'countdownTick', 'countdownTick', 'start']);
    expect(eventsOfType(r.events, 'rep').map((e) => e.count)).toEqual([1, 2]);
    expect(counter.config.targetReps).toBe(4);
  });
});
