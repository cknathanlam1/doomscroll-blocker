/**
 * The body figure drawn over the camera: head, neck, shoulders, arms and a
 * faint torso.
 *
 * A Figure is a small, neutral description of where those parts are, built
 * from EITHER source:
 *   - MediaPipe landmarks (the live camera): has ears and eyes, so the head
 *     circle can sit on the real head;
 *   - a core PoseFrame (the demo's simulated person, or a saved recording):
 *     only has the nose, so the head is estimated from the nose and the
 *     shoulder width.
 * The overlay (overlay.ts) only ever draws Figures, so it doesn't care
 * where the points came from.
 *
 * Units: like the core, both axes are measured in image HEIGHTS of the
 * UNMIRRORED source image (x ∈ [0, aspect], y ∈ [0, 1], y down). Pure.
 */
import type { Joint2D, JointName, PoseFrame } from '../core/types';
import { MP_INDEX, type RawLandmark } from '../platform/mediapipeMapping';

/** One point of the figure. c = confidence 0..1 (0 = not seen / outside the image). */
export interface FigurePoint {
  x: number;
  y: number;
  c: number;
}

/** The head circle (radius in image heights). */
export interface FigureHead extends FigurePoint {
  r: number;
}

/** The joints drawn as dots and limbs (the nose is part of the head instead). */
export type FigureJoint = Exclude<JointName, 'nose'>;

export interface Figure {
  /** Source image width / height. */
  aspect: number;
  joints: Partial<Record<FigureJoint, FigurePoint>>;
  head: FigureHead | null;
}

/** Below this confidence a landmark is not used to place the head (same bar the counter uses). */
const HEAD_MIN_CONFIDENCE = 0.5;
/** Head radius from the ear-to-ear distance (a head is a bit wider than the ears are apart). */
const EAR_RADIUS = 0.55;
/** Head radius from the eye-to-eye distance (eyes are ~6 cm apart, a head is ~16 cm wide). */
const EYE_RADIUS = 1.3;
/** Minimum head radius as a fraction of the shoulder width (also the only size cue for a PoseFrame). */
const SHOULDER_RADIUS = 0.28;

/** MediaPipe Pose indices of the face points used for the head (not part of the core's joint set). */
const MP_FACE = { leftEye: 2, rightEye: 5, leftEar: 7, rightEar: 8 } as const;

const FIGURE_JOINTS: readonly FigureJoint[] = [
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftHip',
  'rightHip',
];

/**
 * Figure from MediaPipe's 33 landmarks (normalized 0..1, unmirrored).
 * The head circle sits on the ear midpoint when both ears are confident,
 * else the eye midpoint, else the nose.
 */
export function figureFromLandmarks(landmarks: readonly RawLandmark[], aspect: number): Figure {
  const a = safeAspect(aspect);
  const point = (index: number): FigurePoint | null => {
    const lm = landmarks[index];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) return null;
    // Same rules as toPoseFrame(): a missing visibility means "detected", and
    // a point outside the picture is a guess, so it gets confidence 0.
    const inside = lm.x >= 0 && lm.x <= 1 && lm.y >= 0 && lm.y <= 1;
    const visibility = Number.isFinite(lm.visibility) ? Math.min(1, Math.max(0, lm.visibility)) : 1;
    return { x: lm.x * a, y: lm.y, c: inside ? visibility : 0 };
  };

  const joints: Figure['joints'] = {};
  for (const name of FIGURE_JOINTS) {
    const p = point(MP_INDEX[name]);
    if (p) joints[name] = p;
  }
  const sw = shoulderWidth(joints);

  const pair = (i: number, j: number): { mid: FigurePoint; dist: number } | null => {
    const p = point(i);
    const q = point(j);
    if (!p || !q || p.c < HEAD_MIN_CONFIDENCE || q.c < HEAD_MIN_CONFIDENCE) return null;
    return {
      mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, c: Math.min(p.c, q.c) },
      dist: Math.hypot(p.x - q.x, p.y - q.y),
    };
  };

  let head: FigureHead | null = null;
  const ears = pair(MP_FACE.leftEar, MP_FACE.rightEar);
  const eyes = ears ? null : pair(MP_FACE.leftEye, MP_FACE.rightEye);
  if (ears) {
    head = { ...ears.mid, r: Math.max(EAR_RADIUS * ears.dist, SHOULDER_RADIUS * sw) };
  } else if (eyes) {
    head = { ...eyes.mid, r: Math.max(EYE_RADIUS * eyes.dist, SHOULDER_RADIUS * sw) };
  } else {
    const nose = point(MP_INDEX.nose);
    if (nose) head = { ...nose, r: SHOULDER_RADIUS * sw };
  }
  return { aspect: a, joints, head };
}

/**
 * Figure from a core PoseFrame (already in height units). There are no
 * ears or eyes, so the head is a circle on the nose sized from the shoulders.
 * Returns null when nobody is in the frame.
 */
export function figureFromPoseFrame(frame: PoseFrame): Figure | null {
  if (!frame.joints) return null;
  const joints: Figure['joints'] = {};
  for (const name of FIGURE_JOINTS) {
    const j = frame.joints[name];
    if (j && isFiniteJoint(j)) joints[name] = { x: j.x, y: j.y, c: j.c };
  }
  const nose = frame.joints.nose;
  const head = nose && isFiniteJoint(nose) ? { x: nose.x, y: nose.y, c: nose.c, r: SHOULDER_RADIUS * shoulderWidth(joints) } : null;
  return { aspect: safeAspect(frame.aspect), joints, head };
}

/** Midpoint of the two shoulders (for the neck), or null if either is missing. */
export function shoulderMid(fig: Figure): FigurePoint | null {
  const l = fig.joints.leftShoulder;
  const r = fig.joints.rightShoulder;
  if (!l || !r) return null;
  return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, c: Math.min(l.c, r.c) };
}

/** Shoulder-to-shoulder distance, or 0 if a shoulder is missing (callers then fall back to a minimum size). */
function shoulderWidth(joints: Figure['joints']): number {
  const l = joints.leftShoulder;
  const r = joints.rightShoulder;
  return l && r ? Math.hypot(l.x - r.x, l.y - r.y) : 0;
}

function isFiniteJoint(j: Joint2D): boolean {
  return Number.isFinite(j.x) && Number.isFinite(j.y) && Number.isFinite(j.c);
}

function safeAspect(aspect: number): number {
  return Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
}
