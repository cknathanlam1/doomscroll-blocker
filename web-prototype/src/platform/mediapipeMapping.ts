import { JOINT_NAMES } from '../core/types';
import type { Joints2D, Joints3D, PoseFrame } from '../core/types';

/** A MediaPipe landmark: normalized [0,1] coords of the UNMIRRORED image. */
export interface RawLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface RawWorldLandmark {
  x: number;
  y: number;
  z: number;
}

/** MediaPipe Pose landmark indices for the joints the core uses. */
export const MP_INDEX = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;

/** Skeleton edges (pairs of MediaPipe indices) to draw for the upper body. */
export const UPPER_BODY_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
];

/**
 * Converts MediaPipe output for ONE pose into a core PoseFrame.
 * x is rescaled to image-height units (x * aspect) so both axes share a unit.
 * Pure — unit-testable in Node.
 *
 * - No landmarks (undefined or empty) → `joints: null` ("nobody in view").
 * - Confidence `c` = MediaPipe `visibility`; a missing/NaN visibility counts
 *   as 1 (some builds leave it unset — the joint was still detected).
 * - Joints whose normalized x or y is outside [0, 1] get `c = 0`: MediaPipe
 *   still guesses where off-screen joints are, but Apple Vision reports them
 *   as confidence 0, and the core must behave the same on both.
 * - A joint with a non-numeric coordinate is left out entirely so NaN can
 *   never leak into the geometry.
 * - An invalid aspect (0, negative, NaN) falls back to 1.
 */
export function toPoseFrame(
  landmarks: RawLandmark[] | undefined,
  world: RawWorldLandmark[] | undefined,
  aspect: number,
  t: number,
): PoseFrame {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;

  if (!landmarks || landmarks.length === 0) {
    return { t, aspect: safeAspect, joints: null, world: null };
  }

  const joints: Joints2D = {};
  for (const name of JOINT_NAMES) {
    const lm = landmarks[MP_INDEX[name]];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) continue;
    const inside = lm.x >= 0 && lm.x <= 1 && lm.y >= 0 && lm.y <= 1;
    // Number.isFinite(undefined) is false, so this also covers a missing field.
    const visibility = Number.isFinite(lm.visibility) ? clamp01(lm.visibility) : 1;
    joints[name] = { x: lm.x * safeAspect, y: lm.y, c: inside ? visibility : 0 };
  }

  return { t, aspect: safeAspect, joints, world: toJoints3D(world) };
}

/** World landmarks are already metric (metres, hip-centred), so no scaling. */
function toJoints3D(world: RawWorldLandmark[] | undefined): Joints3D | null {
  if (!world || world.length === 0) return null;
  const out: Joints3D = {};
  for (const name of JOINT_NAMES) {
    const w = world[MP_INDEX[name]];
    if (!w || !Number.isFinite(w.x) || !Number.isFinite(w.y) || !Number.isFinite(w.z)) continue;
    out[name] = { x: w.x, y: w.y, z: w.z };
  }
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
