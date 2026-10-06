/**
 * "Back up" is judged relative to each rep's depth (CounterConfig.returnFraction),
 * so tired reps that stop a little short of the calibrated plank still count.
 */
import { describe, expect, test } from 'vitest';
import { replayRecording, type Recording } from '../src/core/recording';
import { simulateSession, standardSet, type RepSpec } from './sim/pushupSimulator';
import { eventsOfType, runCounter } from './helpers';
import laptopSession from './fixtures/laptop-session-1.json';

const session = laptopSession as unknown as Recording;

describe('real laptop session (tests/fixtures/laptop-session-1.json)', () => {
  // Recorded on a laptop webcam (11.5 fps, Full model). The user did 13
  // push-ups; the later ones came back up only to d ≈ 0.08–0.12. With the old
  // fixed lockout (d ≤ 0.07) they merged and only 10 counted.
  test('all 13 push-ups count, with no false "Go lower"', () => {
    const events = replayRecording(session, { targetReps: 30 }).flatMap((s) => s.events);
    expect(eventsOfType(events, 'rep')).toHaveLength(13);
    expect(eventsOfType(events, 'partial')).toHaveLength(0);
  });

  test('with the default target of 10 the set completes', () => {
    const events = replayRecording(session, { targetReps: 10 }).flatMap((s) => s.events);
    expect(eventsOfType(events, 'complete')).toHaveLength(1);
    expect(eventsOfType(events, 'rep')).toHaveLength(10);
  });
});

describe('simulated tired reps', () => {
  const tired = (n: number, returnElbowDeg: number): RepSpec[] =>
    Array.from({ length: n }, () => ({ minElbowDeg: 75, returnElbowDeg, topRestMs: 300 }));

  for (const returnElbowDeg of [150, 140, 135]) {
    test(`reps that only come back up to ${returnElbowDeg}° all count`, () => {
      const res = runCounter(simulateSession(standardSet(tired(6, returnElbowDeg)), { noisePx: 2, seed: 7 }).frames, { targetReps: 30 });
      expect(res.finalCount).toBe(6);
      expect(eventsOfType(res.events, 'partial')).toHaveLength(0);
    });
  }

  // The relaxed return must not count bounces that stay in the bottom half.
  // A 120–125° elbow is d ≈ 0.12–0.14, above partialMinDepth: a rep has to come
  // back out of that zone. (The bar used to be capped at 0.9 × downThreshold,
  // so a bounce back up to 125° counted as a second rep.)
  for (const returnElbowDeg of [110, 120, 125]) {
    test(`a bounce only part of the way up (to ${returnElbowDeg}°) at the bottom is one rep, not two`, () => {
      const reps: RepSpec[] = [
        { minElbowDeg: 70, returnElbowDeg, topRestMs: 100 }, // part of the way up…
        { minElbowDeg: 70 }, // …back down, then all the way up
      ];
      const res = runCounter(simulateSession(standardSet(reps), { noisePx: 2, seed: 3 }).frames, { targetReps: 30 });
      expect(res.finalCount).toBe(1);
    });
  }

  test('pulsing in the bottom half (60–75° ↔ 120–125°) counts at most one push-up', () => {
    for (const [minElbowDeg, returnElbowDeg] of [[65, 120], [60, 120], [75, 125]] as const) {
      for (const fps of [30, 15]) {
        const pulses: RepSpec[] = [
          ...Array.from({ length: 6 }, () => ({ minElbowDeg, returnElbowDeg, topRestMs: 150 })),
          { minElbowDeg }, // only the last one goes all the way up
        ];
        const res = runCounter(simulateSession([...standardSet(pulses), { kind: 'hold', ms: 1000 }], { noisePx: 2, seed: 3, fps }).frames, { targetReps: 30 });
        expect(res.finalCount, `${minElbowDeg}↔${returnElbowDeg}° @${fps} fps`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('shallow reps from a tired top (135°) each get "Go lower"; the full reps around them all count', () => {
    // Regression: a shallow attempt only ended at d ≤ upThreshold (0.07), which
    // a tired top (d ≈ 0.08) never reaches: the next shallow reps folded into
    // it with no "Go lower", and a later full rep could be cancelled as too slow.
    for (const nShallow of [3, 5]) {
      const specs: RepSpec[] = [
        { minElbowDeg: 75, returnElbowDeg: 135 },
        ...Array.from({ length: nShallow }, () => ({ minElbowDeg: 115, returnElbowDeg: 135 })),
        { minElbowDeg: 75, returnElbowDeg: 135 },
        { minElbowDeg: 75 },
      ];
      const res = runCounter(simulateSession([...standardSet(specs), { kind: 'hold', ms: 1000 }], { noisePx: 1, seed: 2 }).frames, { targetReps: 30 });
      expect(res.finalCount, `${nShallow} shallow`).toBe(3);
      expect(eventsOfType(res.events, 'partial'), `${nShallow} shallow`).toHaveLength(nShallow);
      expect(eventsOfType(res.events, 'repCancelled'), `${nShallow} shallow`).toHaveLength(0);
    }
  });

  test('resting at a tired top after a shallow rep does not cancel the next full rep', () => {
    const res = runCounter(
      simulateSession(
        [
          { kind: 'hold', ms: 4500 },
          { kind: 'rep', spec: { minElbowDeg: 75, returnElbowDeg: 130 } },
          { kind: 'rep', spec: { minElbowDeg: 115, returnElbowDeg: 130, topRestMs: 9000 } },
          { kind: 'rep', spec: { minElbowDeg: 75 } },
          { kind: 'hold', ms: 1000 },
        ],
        { noisePx: 1, seed: 2 },
      ).frames,
      { targetReps: 30 },
    );
    expect(res.finalCount).toBe(2);
    expect(eventsOfType(res.events, 'repCancelled')).toHaveLength(0);
  });
});
