/**
 * Sanity checks for the push-up simulator (src/sim/pushupSimulator.ts).
 * Every counter test trusts it as ground truth, so it gets a few tests of
 * its own: the true elbow angle hits what was asked, sessions are
 * reproducible, and the special segments move only what they claim to.
 */
import { describe, expect, test } from 'vitest';
import type { JointName, PoseFrame } from '../src/core/types';
import { DEFAULT_GEOMETRY, poseAtElbow, simulateSession, standardSet, topElbowAngle } from './sim/pushupSimulator';

const joint = (f: PoseFrame | undefined, name: JointName) => {
  const j = f?.joints?.[name];
  if (!j) throw new Error(`missing ${name}`);
  return j;
};

describe('pushupSimulator', () => {
  test('a rep reaches the requested elbow angle and returns to the top', () => {
    const sim = simulateSession(standardSet([{ minElbowDeg: 85 }, { minElbowDeg: 120 }]));
    const elbows = sim.truth.map((s) => s.elbowDeg ?? NaN);
    expect(Math.min(...elbows)).toBeCloseTo(85, 3);
    expect(sim.truth[sim.truth.length - 1]?.elbowDeg).toBeCloseTo(topElbowAngle(), 6);
    expect(topElbowAngle()).toBeCloseTo(DEFAULT_GEOMETRY.topElbowDeg, 3);
    expect(sim.reps.map((r) => r.full)).toEqual([true, false]);
    expect(sim.reps[0]?.tEnd).toBeGreaterThan(sim.reps[0]?.tStart ?? Infinity);
  });

  test('the shoulders get lower as the elbows bend (and lower in the image: y grows)', () => {
    const top = poseAtElbow(170);
    const bottom = poseAtElbow(80);
    expect(joint(bottom, 'leftShoulder').y).toBeGreaterThan(joint(top, 'leftShoulder').y);
    // The hands stay planted.
    expect(joint(bottom, 'leftWrist').y).toBeCloseTo(joint(top, 'leftWrist').y, 9);
  });

  test("person's left side appears on the RIGHT of the unmirrored image", () => {
    const f = poseAtElbow(170);
    expect(joint(f, 'leftShoulder').x).toBeGreaterThan(joint(f, 'rightShoulder').x);
  });

  test('same seed → identical session; different seed → different noise', () => {
    const segs = standardSet([{ minElbowDeg: 80 }]);
    const a = simulateSession(segs, { noisePx: 3, seed: 5 });
    const b = simulateSession(segs, { noisePx: 3, seed: 5 });
    const c = simulateSession(segs, { noisePx: 3, seed: 6 });
    expect(b.frames).toEqual(a.frames);
    expect(c.frames).not.toEqual(a.frames);
  });

  test('timing options that are off leave a seeded session untouched', () => {
    const segs = standardSet([{ minElbowDeg: 80 }]);
    const plain = simulateSession(segs, { noisePx: 2, seed: 3 });
    const off = simulateSession(segs, { noisePx: 2, seed: 3, timeJitterMs: 0, frameDropRate: 0 });
    expect(off.frames).toEqual(plain.frames);
  });

  test('timestamp jitter keeps timestamps strictly increasing; frame drops remove frames', () => {
    const segs = standardSet([{ minElbowDeg: 80 }]);
    const jittered = simulateSession(segs, { fps: 15, timeJitterMs: 1000, seed: 2 });
    for (let i = 1; i < jittered.frames.length; i++) {
      expect(jittered.frames[i]?.t).toBeGreaterThan(jittered.frames[i - 1]?.t ?? Infinity);
    }
    const full = simulateSession(segs, { seed: 2 });
    const dropped = simulateSession(segs, { seed: 2, frameDropRate: 0.2 });
    expect(dropped.frames.length).toBeLessThan(full.frames.length * 0.9);
    expect(dropped.frames.length).toBeGreaterThan(full.frames.length * 0.7);
    expect(dropped.truth).toHaveLength(dropped.frames.length);
  });

  test('absent and lowConfidence segments', () => {
    const sim = simulateSession([{ kind: 'absent', ms: 100 }, { kind: 'lowConfidence', ms: 100, c: 0.3 }]);
    const [absent, low] = [sim.frames[0], sim.frames[sim.frames.length - 1]];
    expect(absent?.joints).toBeNull();
    expect(sim.truth[0]?.elbowDeg).toBeNull();
    expect(Object.values(low?.joints ?? {}).every((j) => j?.c === 0.3)).toBe(true);
  });

  test('headBob moves ONLY the nose, downward in the image', () => {
    // (The up phase ends one frame short of the rest pose, like a rep, hence the final hold.)
    const sim = simulateSession([{ kind: 'hold', ms: 100 }, { kind: 'headBob', dropM: 0.15, downMs: 300, holdMs: 300, upMs: 300 }, { kind: 'hold', ms: 100 }]);
    const rest = sim.frames[0];
    const nodded = sim.frames.find((f) => f.t >= 100 + 300 + 100); // during the hold of the nod
    for (const name of ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist', 'leftHip', 'rightHip'] as const) {
      expect(joint(nodded, name).x).toBeCloseTo(joint(rest, name).x, 12);
      expect(joint(nodded, name).y).toBeCloseTo(joint(rest, name).y, 12);
    }
    expect(joint(nodded, 'nose').y).toBeGreaterThan(joint(rest, 'nose').y + 0.03);
    // Back to the start afterwards, and the true elbow angle never changed.
    expect(joint(sim.frames[sim.frames.length - 1], 'nose').y).toBeCloseTo(joint(rest, 'nose').y, 12);
    for (const s of sim.truth) expect(s.elbowDeg).toBeCloseTo(sim.truth[0]?.elbowDeg ?? NaN, 9);
  });

  test('rockBack moves the upper body away from the camera: shoulders shrink, hands stay put', () => {
    const sim = simulateSession([{ kind: 'hold', ms: 100 }, { kind: 'rockBack', backM: 0.3, dropM: 0.2, downMs: 300, holdMs: 300, upMs: 300 }]);
    const rest = sim.frames[0];
    const rocked = sim.frames.find((f) => f.t >= 100 + 300 + 100);
    const width = (f: PoseFrame | undefined) => Math.abs(joint(f, 'leftShoulder').x - joint(f, 'rightShoulder').x);
    expect(width(rocked)).toBeLessThan(width(rest) * 0.85);
    expect(joint(rocked, 'leftWrist').x).toBeCloseTo(joint(rest, 'leftWrist').x, 12);
    expect(joint(rocked, 'leftWrist').y).toBeCloseTo(joint(rest, 'leftWrist').y, 12);
    // The truth reflects the lower shoulders and the more bent elbows.
    const restTruth = sim.truth[0];
    const rockedTruth = sim.truth[sim.frames.indexOf(rocked as PoseFrame)];
    expect(rockedTruth?.shoulderHeight).toBeCloseTo((restTruth?.shoulderHeight ?? NaN) - 0.2, 6);
    expect(rockedTruth?.elbowDeg ?? Infinity).toBeLessThan(restTruth?.elbowDeg ?? -Infinity);
  });

  test('world joints are hip-centred metres when requested', () => {
    const sim = simulateSession([{ kind: 'hold', ms: 34 }], { includeWorld: true });
    const w = sim.frames[0]?.world;
    expect(w).toBeTruthy();
    const lh = w?.leftHip;
    const rh = w?.rightHip;
    expect(((lh?.x ?? NaN) + (rh?.x ?? NaN)) / 2).toBeCloseTo(0, 9);
    // Shoulder width ≈ 0.38 m for bodyScale 1.
    const ls = w?.leftShoulder;
    const rs = w?.rightShoulder;
    expect(Math.hypot((ls?.x ?? 0) - (rs?.x ?? 0), (ls?.y ?? 0) - (rs?.y ?? 0), (ls?.z ?? 0) - (rs?.z ?? 0))).toBeCloseTo(0.38, 6);
    expect(simulateSession([{ kind: 'hold', ms: 34 }]).frames[0]?.world).toBeNull();
  });
});
