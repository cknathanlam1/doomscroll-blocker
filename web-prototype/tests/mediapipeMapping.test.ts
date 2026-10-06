import { describe, expect, it } from 'vitest';
import { JOINT_NAMES } from '../src/core/types';
import { MP_INDEX, toPoseFrame } from '../src/platform/mediapipeMapping';
import type { RawLandmark, RawWorldLandmark } from '../src/platform/mediapipeMapping';

/**
 * 33 landmarks where landmark i sits at a unique, in-frame position, so a
 * wrong index shows up as a wrong coordinate.
 */
function makeLandmarks(): RawLandmark[] {
  return Array.from({ length: 33 }, (_, i) => ({
    x: 0.1 + i * 0.02,
    y: 0.9 - i * 0.02,
    z: -0.1,
    visibility: 0.5 + i * 0.01,
  }));
}

function makeWorld(): RawWorldLandmark[] {
  return Array.from({ length: 33 }, (_, i) => ({ x: i * 0.1, y: -i * 0.05, z: i * 0.01 - 0.2 }));
}

/** Copy of `list` with landmark `index` replaced by `patch` applied to it. */
function withLandmark(list: RawLandmark[], index: number, patch: Partial<RawLandmark>): RawLandmark[] {
  return list.map((lm, i) => (i === index ? { ...lm, ...patch } : lm));
}

describe('toPoseFrame', () => {
  it('returns joints: null when there is no pose', () => {
    expect(toPoseFrame(undefined, undefined, 0.75, 100)).toEqual({ t: 100, aspect: 0.75, joints: null, world: null });
    expect(toPoseFrame([], [], 0.75, 101)).toEqual({ t: 101, aspect: 0.75, joints: null, world: null });
  });

  it('maps MediaPipe indices to joint names, x in height units, y as-is, c = visibility', () => {
    const aspect = 480 / 640;
    const lms = makeLandmarks();
    const frame = toPoseFrame(lms, undefined, aspect, 42);

    expect(frame.t).toBe(42);
    expect(frame.aspect).toBe(aspect);
    expect(frame.joints).not.toBeNull();
    for (const name of JOINT_NAMES) {
      const src = lms[MP_INDEX[name]]!;
      const joint = frame.joints![name]!;
      expect(joint.x).toBeCloseTo(src.x * aspect, 12);
      expect(joint.y).toBeCloseTo(src.y, 12);
      expect(joint.c).toBeCloseTo(src.visibility, 12);
    }
  });

  it('only outputs the core joints', () => {
    const frame = toPoseFrame(makeLandmarks(), makeWorld(), 1, 0);
    expect(Object.keys(frame.joints!).sort()).toEqual([...JOINT_NAMES].sort());
    expect(Object.keys(frame.world!).sort()).toEqual([...JOINT_NAMES].sort());
  });

  it('uses the person-anatomical MediaPipe sides (11 = left shoulder, 12 = right shoulder)', () => {
    const lms = withLandmark(withLandmark(makeLandmarks(), 11, { x: 0.7 }), 12, { x: 0.3 });
    const frame = toPoseFrame(lms, undefined, 1, 0);
    expect(frame.joints!.leftShoulder!.x).toBeCloseTo(0.7);
    expect(frame.joints!.rightShoulder!.x).toBeCloseTo(0.3);
  });

  it('treats a missing or NaN visibility as fully visible', () => {
    const missing = withLandmark(makeLandmarks(), MP_INDEX.nose, { visibility: undefined as unknown as number });
    expect(toPoseFrame(missing, undefined, 1, 0).joints!.nose!.c).toBe(1);

    const nan = withLandmark(makeLandmarks(), MP_INDEX.leftWrist, { visibility: Number.NaN });
    expect(toPoseFrame(nan, undefined, 1, 0).joints!.leftWrist!.c).toBe(1);
  });

  it('clamps visibility into [0, 1]', () => {
    let lms = withLandmark(makeLandmarks(), MP_INDEX.leftElbow, { visibility: 1.2 });
    lms = withLandmark(lms, MP_INDEX.rightElbow, { visibility: -0.1 });
    const joints = toPoseFrame(lms, undefined, 1, 0).joints!;
    expect(joints.leftElbow!.c).toBe(1);
    expect(joints.rightElbow!.c).toBe(0);
  });

  it('sets c = 0 for joints outside the image but keeps their position', () => {
    let lms = makeLandmarks();
    lms = withLandmark(lms, MP_INDEX.leftWrist, { x: -0.05, visibility: 0.9 });
    lms = withLandmark(lms, MP_INDEX.rightWrist, { x: 1.05, visibility: 0.9 });
    lms = withLandmark(lms, MP_INDEX.leftHip, { y: 1.2, visibility: 0.9 });
    lms = withLandmark(lms, MP_INDEX.nose, { y: -0.01, visibility: 0.9 });
    const joints = toPoseFrame(lms, undefined, 0.5, 0).joints!;

    expect(joints.leftWrist).toEqual({ x: -0.05 * 0.5, y: lms[MP_INDEX.leftWrist]!.y, c: 0 });
    expect(joints.rightWrist!.c).toBe(0);
    expect(joints.rightWrist!.x).toBeCloseTo(1.05 * 0.5);
    expect(joints.leftHip!.c).toBe(0);
    expect(joints.leftHip!.y).toBe(1.2);
    expect(joints.nose!.c).toBe(0);
  });

  it('counts the exact image edges (0 and 1) as inside', () => {
    let lms = withLandmark(makeLandmarks(), MP_INDEX.leftShoulder, { x: 0, y: 1, visibility: 0.8 });
    lms = withLandmark(lms, MP_INDEX.rightShoulder, { x: 1, y: 0, visibility: 0.7 });
    const joints = toPoseFrame(lms, undefined, 1, 0).joints!;
    expect(joints.leftShoulder!.c).toBeCloseTo(0.8);
    expect(joints.rightShoulder!.c).toBeCloseTo(0.7);
  });

  it('leaves out joints with non-numeric coordinates instead of passing NaN on', () => {
    const lms = withLandmark(makeLandmarks(), MP_INDEX.leftElbow, { x: Number.NaN });
    const joints = toPoseFrame(lms, undefined, 1, 0).joints!;
    expect(joints.leftElbow).toBeUndefined();
    expect(joints.rightElbow).toBeDefined();
  });

  it('skips joints missing from a short landmark list without throwing', () => {
    const lms = makeLandmarks().slice(0, 16); // indices 0..15: no right wrist or hips
    const joints = toPoseFrame(lms, undefined, 1, 0).joints!;
    expect(joints.leftWrist).toBeDefined();
    expect(joints.rightWrist).toBeUndefined();
    expect(joints.leftHip).toBeUndefined();
  });

  it('maps world landmarks by the same indices without scaling', () => {
    const world = makeWorld();
    const frame = toPoseFrame(makeLandmarks(), world, 0.75, 0);
    for (const name of JOINT_NAMES) {
      expect(frame.world![name]).toEqual(world[MP_INDEX[name]]);
    }
  });

  it('sets world to null when world landmarks are missing or empty', () => {
    expect(toPoseFrame(makeLandmarks(), undefined, 1, 0).world).toBeNull();
    expect(toPoseFrame(makeLandmarks(), [], 1, 0).world).toBeNull();
  });

  it('falls back to aspect 1 for an invalid aspect', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const frame = toPoseFrame(makeLandmarks(), undefined, bad, 0);
      expect(frame.aspect).toBe(1);
      expect(frame.joints!.nose!.x).toBeCloseTo(makeLandmarks()[0]!.x);
    }
  });
});
