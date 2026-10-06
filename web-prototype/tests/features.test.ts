/**
 * Unit tests for src/core/features.ts: the per-frame geometry everything else
 * is built on. Hand-built frames use round numbers so the expected values can
 * be checked by hand; simulator poses check the real camera geometry.
 */
import { describe, expect, test } from 'vitest';
import { angleDeg, computeFeatures } from '../src/core/features';
import type { Features, Joint2D, JointName, Joints2D, PoseFrame } from '../src/core/types';
import { poseAtElbow, simulateSession, type SimGeometry } from './sim/pushupSimulator';
import { mirrorFrame } from './helpers';

const VIS = 0.5;
const WRIST_VIS = 0.4;
/** 480 × 640 portrait image: x runs 0..0.75 in image-height units. */
const ASPECT = 0.75;

/**
 * A clean plank in the hand-built image. The person faces the camera, so
 * their LEFT shoulder is on the RIGHT of the (unmirrored) image.
 *   shoulders y = 0.40, 0.25 apart  →  shoulderWidth 0.25, mid x 0.375
 *   wrists    y = 0.75              →  heightRatio (0.75 - 0.40) / 0.25 = 1.4
 */
function plankJoints(): Joints2D {
  const j = (x: number, y: number, c = 0.95): Joint2D => ({ x, y, c });
  return {
    nose: j(0.375, 0.3),
    leftShoulder: j(0.5, 0.4),
    rightShoulder: j(0.25, 0.4),
    leftElbow: j(0.58, 0.55),
    rightElbow: j(0.17, 0.55),
    leftWrist: j(0.55, 0.75),
    rightWrist: j(0.2, 0.75),
    leftHip: j(0.45, 0.2),
    rightHip: j(0.3, 0.2),
  };
}

function frame(joints: Joints2D | null, aspect = ASPECT, t = 0): PoseFrame {
  return { t, aspect, joints };
}

/** Copy of `joints` with one joint changed (or removed with `null`). */
function withJoint(joints: Joints2D, name: JointName, value: Partial<Joint2D> | null): Joints2D {
  const out = { ...joints };
  if (value === null) delete out[name];
  else out[name] = { ...(joints[name] as Joint2D), ...value };
  return out;
}

const features = (joints: Joints2D | null, aspect = ASPECT): Features =>
  computeFeatures(frame(joints, aspect), VIS, WRIST_VIS);

describe('angleDeg', () => {
  test('2D: right angle, straight line, folded back, 45°', () => {
    const b = { x: 0, y: 0 };
    expect(angleDeg({ x: 1, y: 0 }, b, { x: 0, y: 1 })).toBeCloseTo(90, 10);
    expect(angleDeg({ x: -1, y: 0 }, b, { x: 1, y: 0 })).toBeCloseTo(180, 10);
    expect(angleDeg({ x: 1, y: 0 }, b, { x: 2, y: 0 })).toBeCloseTo(0, 10);
    expect(angleDeg({ x: 1, y: 0 }, b, { x: 1, y: 1 })).toBeCloseTo(45, 10);
  });

  test('does not depend on which side is A and which is C', () => {
    const a = { x: 0.3, y: 0.1 };
    const b = { x: 0.1, y: 0.4 };
    const c = { x: 0.6, y: 0.9 };
    expect(angleDeg(a, b, c)).toBeCloseTo(angleDeg(c, b, a), 12);
  });

  test('3D uses z: an angle hidden in the image plane is still measured', () => {
    const b = { x: 0, y: 0, z: 0 };
    // In the image (x, y) both arms point the same way (0°); in 3D they are 45° apart.
    expect(angleDeg({ x: 1, y: 0, z: 0 }, b, { x: 1, y: 0, z: 1 })).toBeCloseTo(45, 10);
    expect(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0, 10);
    // Bending along the camera's depth axis: the 2D angle reads 180° but the real angle is 90°.
    expect(angleDeg({ x: 0, y: -1, z: 0 }, b, { x: 0, y: 0, z: 1 })).toBeCloseTo(90, 10);
  });

  test('a missing z counts as 0', () => {
    const withZ = angleDeg({ x: 1, y: 2, z: 0 }, { x: 0, y: 0, z: 0 }, { x: -1, y: 1, z: 0 });
    const without = angleDeg({ x: 1, y: 2 }, { x: 0, y: 0 }, { x: -1, y: 1 });
    expect(without).toBeCloseTo(withZ, 12);
  });

  test('returns NaN when A or C sits on B (angle undefined), never throws', () => {
    expect(angleDeg({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNaN();
    expect(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNaN();
  });

  test('nearly collinear points never produce NaN from rounding', () => {
    const angle = angleDeg({ x: 1e8, y: 1 }, { x: 0, y: 0 }, { x: -1e8, y: -1 });
    expect(Number.isFinite(angle)).toBe(true);
    expect(angle).toBeCloseTo(180, 6);
  });
});

describe('computeFeatures: a clean hand-built plank', () => {
  test('every feature has the hand-computed value', () => {
    const f = features(plankJoints());
    expect(f.present).toBe(true);
    expect(f.shouldersVisible).toBe(true);
    expect(f.noseVisible).toBe(true);
    expect(f.visibleWrists).toBe(2);
    expect(f.shoulderConfidence).toBeCloseTo(0.95, 12);
    expect(f.upperBodyConfidence).toBeCloseTo(0.95, 12);
    expect(f.shoulderMid?.x).toBeCloseTo(0.375, 12);
    expect(f.shoulderMid?.y).toBeCloseTo(0.4, 12);
    expect(f.wristMid?.x).toBeCloseTo(0.375, 12);
    expect(f.wristMid?.y).toBeCloseTo(0.75, 12);
    expect(f.nose).toEqual({ x: 0.375, y: 0.3 });
    expect(f.shoulderWidth).toBeCloseTo(0.25, 12);
    expect(f.shoulderWidthFrac).toBeCloseTo(0.25 / ASPECT, 12);
    expect(f.shoulderTiltDeg).toBeCloseTo(0, 12);
    expect(f.heightRatio).toBeCloseTo(1.4, 12);
    expect(f.wristsInSpan).toBe(true);
    expect(f.elbowAngle2D).not.toBeNull();
    expect(f.elbowAngle3D).toBeNull(); // no world joints given
  });

  test('keeps the frame timestamp', () => {
    expect(computeFeatures(frame(plankJoints(), ASPECT, 1234.5), VIS).t).toBe(1234.5);
  });

  test('shoulder tilt is unsigned (either direction, and mirroring, give the same value)', () => {
    const up = features(withJoint(plankJoints(), 'leftShoulder', { y: 0.4 - 0.25 * Math.tan(Math.PI / 12) }));
    const down = features(withJoint(plankJoints(), 'leftShoulder', { y: 0.4 + 0.25 * Math.tan(Math.PI / 12) }));
    expect(up.shoulderTiltDeg).toBeCloseTo(15, 9);
    expect(down.shoulderTiltDeg).toBeCloseTo(15, 9);
  });

  test('heightRatio is negative when the wrists are ABOVE the shoulders (not a plank)', () => {
    let j = plankJoints();
    j = withJoint(j, 'leftWrist', { y: 0.3 });
    j = withJoint(j, 'rightWrist', { y: 0.3 });
    expect(features(j).heightRatio).toBeCloseTo(-0.4, 12);
  });

  test('a wrist far outside the shoulder span clears wristsInSpan', () => {
    // Span = [0.25 - 0.75·0.25, 0.5 + 0.75·0.25] = [0.0625, 0.6875].
    expect(features(withJoint(plankJoints(), 'leftWrist', { x: 0.68 })).wristsInSpan).toBe(true);
    expect(features(withJoint(plankJoints(), 'leftWrist', { x: 0.7 })).wristsInSpan).toBe(false);
  });
});

describe('computeFeatures: missing joints', () => {
  test('no person (joints null) → nothing visible, all geometry null', () => {
    const f = features(null);
    expect(f.present).toBe(false);
    expect(f.shouldersVisible).toBe(false);
    expect(f.noseVisible).toBe(false);
    expect(f.visibleWrists).toBe(0);
    expect(f.shoulderConfidence).toBe(0);
    expect(f.upperBodyConfidence).toBe(0);
    expect(f.shoulderMid).toBeNull();
    expect(f.wristMid).toBeNull();
    expect(f.nose).toBeNull();
    expect(f.shoulderWidth).toBeNull();
    expect(f.shoulderWidthFrac).toBeNull();
    expect(f.shoulderTiltDeg).toBeNull();
    expect(f.heightRatio).toBeNull();
    expect(f.wristsInSpan).toBe(false);
    expect(f.elbowAngle2D).toBeNull();
    expect(f.elbowAngle3D).toBeNull();
  });

  test('an empty joint list is "present" but shows nothing', () => {
    const f = features({});
    expect(f.present).toBe(true);
    expect(f.shouldersVisible).toBe(false);
    expect(f.visibleWrists).toBe(0);
    expect(f.heightRatio).toBeNull();
  });

  test('one shoulder missing → no shoulder geometry, wrists still reported', () => {
    const f = features(withJoint(plankJoints(), 'rightShoulder', null));
    expect(f.shouldersVisible).toBe(false);
    expect(f.shoulderConfidence).toBe(0);
    expect(f.shoulderMid).toBeNull();
    expect(f.shoulderWidth).toBeNull();
    expect(f.heightRatio).toBeNull();
    expect(f.wristsInSpan).toBe(false);
    expect(f.visibleWrists).toBe(2);
    expect(f.wristMid?.y).toBeCloseTo(0.75, 12);
  });

  test('one wrist missing → the other wrist alone gives wristMid and heightRatio', () => {
    let j = withJoint(plankJoints(), 'rightWrist', null);
    j = withJoint(j, 'leftWrist', { y: 0.8 });
    const f = features(j);
    expect(f.visibleWrists).toBe(1);
    expect(f.wristMid).toEqual({ x: 0.55, y: 0.8 });
    expect(f.heightRatio).toBeCloseTo((0.8 - 0.4) / 0.25, 12);
    expect(f.upperBodyConfidence).toBe(0); // a missing joint counts as confidence 0
  });

  test('both wrists missing → heightRatio null, wristsInSpan vacuously true', () => {
    let j = withJoint(plankJoints(), 'rightWrist', null);
    j = withJoint(j, 'leftWrist', null);
    const f = features(j);
    expect(f.visibleWrists).toBe(0);
    expect(f.wristMid).toBeNull();
    expect(f.heightRatio).toBeNull();
    expect(f.elbowAngle2D).toBeNull();
    // "Every visible wrist" is in span when there are none; the plank gate checks visibleWrists first.
    expect(f.wristsInSpan).toBe(true);
  });

  test('nose missing → noseVisible false and nose null, rest unaffected', () => {
    const f = features(withJoint(plankJoints(), 'nose', null));
    expect(f.noseVisible).toBe(false);
    expect(f.nose).toBeNull();
    expect(f.heightRatio).toBeCloseTo(1.4, 12);
  });

  test('NaN / Infinity coordinates or confidence are treated as missing', () => {
    expect(features(withJoint(plankJoints(), 'leftShoulder', { x: NaN })).shouldersVisible).toBe(false);
    expect(features(withJoint(plankJoints(), 'leftShoulder', { y: Infinity })).shouldersVisible).toBe(false);
    expect(features(withJoint(plankJoints(), 'leftWrist', { c: NaN })).visibleWrists).toBe(1);
    const f = features(withJoint(plankJoints(), 'nose', { y: NaN }));
    expect(f.noseVisible).toBe(false);
    for (const value of [f.shoulderWidth, f.heightRatio, f.shoulderTiltDeg]) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });
});

describe('computeFeatures: confidence', () => {
  test('a shoulder below the visibility threshold hides all shoulder geometry', () => {
    const f = features(withJoint(plankJoints(), 'leftShoulder', { c: 0.45 }));
    expect(f.shouldersVisible).toBe(false);
    expect(f.shoulderConfidence).toBeCloseTo(0.45, 12);
    expect(f.shoulderMid).toBeNull();
    expect(f.heightRatio).toBeNull();
  });

  test('exactly at the threshold counts as visible', () => {
    const f = features(withJoint(plankJoints(), 'leftShoulder', { c: VIS }));
    expect(f.shouldersVisible).toBe(true);
  });

  test('wrists use their own (lower) threshold, defaulting to the main one', () => {
    const j = withJoint(plankJoints(), 'leftWrist', { c: 0.45 });
    expect(computeFeatures(frame(j), VIS, WRIST_VIS).visibleWrists).toBe(2);
    expect(computeFeatures(frame(j), VIS).visibleWrists).toBe(1);
  });

  test('low-confidence nose → not visible', () => {
    expect(features(withJoint(plankJoints(), 'nose', { c: 0.3 })).noseVisible).toBe(false);
  });

  test('the shoulder midpoint leans toward the more confident shoulder', () => {
    let j = withJoint(plankJoints(), 'leftShoulder', { y: 0.36, c: 0.9 });
    j = withJoint(j, 'rightShoulder', { y: 0.44, c: 0.6 });
    const f = features(j);
    expect(f.shoulderMid?.y).toBeCloseTo((0.36 * 0.9 + 0.44 * 0.6) / 1.5, 12);
    expect(f.shoulderMid?.x).toBeCloseTo((0.5 * 0.9 + 0.25 * 0.6) / 1.5, 12);
  });

  test('a visibility threshold of 0 with zero confidences falls back to the plain midpoint (no NaN)', () => {
    let j = withJoint(plankJoints(), 'leftShoulder', { c: 0 });
    j = withJoint(j, 'rightShoulder', { c: 0 });
    const f = computeFeatures(frame(j), 0);
    expect(f.shoulderMid?.x).toBeCloseTo(0.375, 12);
    expect(f.shoulderMid?.y).toBeCloseTo(0.4, 12);
  });

  test('upperBodyConfidence is the weakest of shoulders, elbows and wrists', () => {
    const f = features(withJoint(plankJoints(), 'rightElbow', { c: 0.3 }));
    expect(f.upperBodyConfidence).toBeCloseTo(0.3, 12);
    expect(f.shoulderConfidence).toBeCloseTo(0.95, 12);
  });
});

describe('computeFeatures: frame edges and aspect ratio', () => {
  test('a confident shoulder hugging the edge is NOT visible (detectors guess off-frame joints)', () => {
    // FRAME_MARGIN = 0.02 image heights.
    const bottom = features(withJoint(plankJoints(), 'rightShoulder', { y: 0.99 }));
    expect(bottom.shouldersVisible).toBe(false);
    expect(bottom.heightRatio).toBeNull();
    // Confident, so the geometry itself is still computed (used for "move back" style hints).
    expect(bottom.shoulderWidth).not.toBeNull();

    expect(features(withJoint(plankJoints(), 'rightShoulder', { y: 0.01 })).shouldersVisible).toBe(false);
    expect(features(withJoint(plankJoints(), 'rightShoulder', { x: 0.01 })).shouldersVisible).toBe(false);
    expect(features(withJoint(plankJoints(), 'leftShoulder', { x: ASPECT - 0.01 })).shouldersVisible).toBe(false);
    expect(features(withJoint(plankJoints(), 'rightShoulder', { x: 0.03 })).shouldersVisible).toBe(true);
  });

  test('the right edge is at x = aspect, so the same x can be inside a wider frame', () => {
    const j = withJoint(plankJoints(), 'leftShoulder', { x: 0.74 });
    expect(features(j, 0.75).shouldersVisible).toBe(false);
    expect(features(j, 4 / 3).shouldersVisible).toBe(true);
  });

  test('shoulderWidthFrac is relative to the frame WIDTH; lengths in height units do not change', () => {
    const narrow = features(plankJoints(), 0.75);
    const wide = features(plankJoints(), 1.5);
    expect(narrow.shoulderWidthFrac).toBeCloseTo(0.25 / 0.75, 12);
    expect(wide.shoulderWidthFrac).toBeCloseTo(0.25 / 1.5, 12);
    expect(wide.shoulderWidth).toBeCloseTo(narrow.shoulderWidth ?? NaN, 12);
    expect(wide.heightRatio).toBeCloseTo(narrow.heightRatio ?? NaN, 12);
    expect(wide.shoulderTiltDeg).toBeCloseTo(narrow.shoulderTiltDeg ?? NaN, 12);
  });

  test('an invalid aspect gives no shoulderWidthFrac instead of Infinity', () => {
    expect(features(plankJoints(), 0).shoulderWidthFrac).toBeNull();
  });
});

describe('computeFeatures: mirroring invariance', () => {
  // Scalar features must be identical for a mirrored video (x → aspect - x and
  // left/right labels swapped): the algorithm must not care which side is which.
  const SCALARS = [
    'present',
    'shouldersVisible',
    'noseVisible',
    'visibleWrists',
    'shoulderConfidence',
    'upperBodyConfidence',
    'shoulderWidth',
    'shoulderWidthFrac',
    'shoulderTiltDeg',
    'heightRatio',
    'wristsInSpan',
    'elbowAngle2D',
    'elbowAngle3D',
  ] as const;

  function expectMirrored(a: Features, b: Features, aspect: number): void {
    for (const key of SCALARS) {
      const va = a[key];
      const vb = b[key];
      if (typeof va === 'number' && typeof vb === 'number') expect(vb, key).toBeCloseTo(va, 9);
      else expect(vb, key).toBe(va);
    }
    // Points: same y, x reflected.
    for (const key of ['shoulderMid', 'wristMid', 'nose'] as const) {
      const pa = a[key];
      const pb = b[key];
      if (pa === null || pb === null) {
        expect(pb, key).toBe(pa);
        continue;
      }
      expect(pb.y, key).toBeCloseTo(pa.y, 12);
      expect(pb.x, key).toBeCloseTo(aspect - pa.x, 9);
    }
  }

  test('hand-built plank, including uneven confidences and a tilt', () => {
    let j = withJoint(plankJoints(), 'leftShoulder', { y: 0.37, c: 0.7 });
    j = withJoint(j, 'rightWrist', { c: 0.45 });
    const f = frame(j);
    expectMirrored(computeFeatures(f, VIS, WRIST_VIS), computeFeatures(mirrorFrame(f), VIS, WRIST_VIS), ASPECT);
  });

  test('noisy simulated session with 3D joints, several placements', () => {
    const placements: Partial<SimGeometry>[] = [{}, { camHeight: 0.05, tiltDeg: 18, headDistance: 0.75 }, { camHeight: 0.22, tiltDeg: 2, headDistance: 1.25 }];
    for (const geometry of placements) {
      const sim = simulateSession(
        [
          { kind: 'hold', ms: 300 },
          { kind: 'rep', spec: { minElbowDeg: 75 } },
          { kind: 'lowConfidence', ms: 100, c: 0.45 },
        ],
        { geometry, noisePx: 3, dropoutRate: 0.1, seed: 7, includeWorld: true },
      );
      for (const f of sim.frames) {
        expectMirrored(computeFeatures(f, VIS, WRIST_VIS), computeFeatures(mirrorFrame(f), VIS, WRIST_VIS), f.aspect);
      }
    }
  });
});

describe('computeFeatures on simulated poses (floor-level front camera)', () => {
  const hAt = (elbowDeg: number, geometry?: Partial<SimGeometry>): number => {
    const h = computeFeatures(poseAtElbow(elbowDeg, geometry), VIS, WRIST_VIS).heightRatio;
    if (h === null) throw new Error(`no heightRatio at ${elbowDeg}°`);
    return h;
  };

  test('heightRatio at the top is positive and in the documented ≈1.4–1.6 range', () => {
    expect(hAt(180)).toBeGreaterThan(1.4);
    expect(hAt(180)).toBeLessThan(1.6);
  });

  test('heightRatio shrinks steadily as the elbows bend (and stays positive down to 60°)', () => {
    const angles = [172, 160, 150, 140, 130, 120, 110, 100, 90, 80, 70, 60];
    for (const geometry of [{}, { camHeight: 0.05, tiltDeg: 20, headDistance: 0.7 }, { camHeight: 0.25, tiltDeg: 0, headDistance: 1.3 }]) {
      const hs = angles.map((a) => hAt(a, geometry));
      for (let i = 1; i < hs.length; i++) expect(hs[i]).toBeLessThan(hs[i - 1] as number);
      expect(hs[hs.length - 1]).toBeGreaterThan(0);
    }
  });

  test('depth d = 1 - h/hTop matches the geometry documented in CounterConfig', () => {
    // types.ts: d ≈ 0.14–0.17 at 120°, 0.25–0.29 at 100°, 0.32–0.39 at 90° (default placement in the middle).
    const top = hAt(180);
    const d = (deg: number): number => 1 - hAt(deg) / top;
    expect(d(120)).toBeGreaterThan(0.13);
    expect(d(120)).toBeLessThan(0.18);
    expect(d(100)).toBeGreaterThan(0.24);
    expect(d(100)).toBeLessThan(0.3);
    expect(d(90)).toBeGreaterThan(0.31);
    expect(d(90)).toBeLessThan(0.4);
  });

  test('heightRatio barely depends on the distance to the phone (it is a ratio of lengths)', () => {
    // Practically equal at the top (1e-4); at the bottom perspective adds well
    // under 2 % (shoulders and hands are at slightly different depths).
    expect(hAt(180, { headDistance: 1.3 })).toBeCloseTo(hAt(180, { headDistance: 0.7 }), 3);
    const near = hAt(90, { headDistance: 0.7 });
    const far = hAt(90, { headDistance: 1.3 });
    expect(Math.abs(far - near) / near).toBeLessThan(0.02);
    // ...while the shoulders really do get smaller in the image.
    const swNear = computeFeatures(poseAtElbow(180, { headDistance: 0.7 }), VIS).shoulderWidth ?? 0;
    const swFar = computeFeatures(poseAtElbow(180, { headDistance: 1.3 }), VIS).shoulderWidth ?? 0;
    expect(swFar).toBeLessThan(swNear * 0.7);
  });

  test('the 3D elbow angle from world joints equals the true angle; the 2D one reads too open', () => {
    const sim = simulateSession([{ kind: 'holdAt', elbowDeg: 90, ms: 100 }], { includeWorld: true });
    const f = computeFeatures(sim.frames[0] as PoseFrame, VIS, WRIST_VIS);
    expect(f.elbowAngle3D).toBeCloseTo(sim.truth[0]?.elbowDeg ?? NaN, 6);
    expect(f.elbowAngle3D).toBeCloseTo(90, 3);
    // From the front much of the bend is along the camera's depth axis, which
    // is exactly why the counter never uses the 2D elbow angle.
    expect(f.elbowAngle2D ?? 0).toBeGreaterThan(110);
  });

  test('world joints without confident 2D arms give no 3D elbow angle', () => {
    const sim = simulateSession([{ kind: 'lowConfidence', ms: 34, c: 0.2 }], { includeWorld: true });
    const f = computeFeatures(sim.frames[0] as PoseFrame, VIS, WRIST_VIS);
    expect(f.elbowAngle3D).toBeNull();
    expect(f.elbowAngle2D).toBeNull();
  });
});
