import type { Features, Joint2D, Joint3D, JointName, Joints2D, Point2, PoseFrame } from './types';

/**
 * Shoulders must sit at least this far (image-height units) inside every
 * edge of the frame to count as visible. Detectors keep "guessing" joints
 * that are just outside the image, often with high confidence, so a joint
 * hugging the border is not trusted.
 */
const FRAME_MARGIN = 0.02;

/** A visible wrist may sit at most this many shoulder widths outside the outer shoulder edges. */
const WRIST_SPAN_SHOULDER_WIDTHS = 0.75;

/**
 * Angle ABC in degrees (0..180) at vertex B. Works in 2D, or in 3D when
 * every point has a `z` (a missing z is treated as 0). Returns NaN when A or
 * C sits exactly on B, because the angle is undefined there.
 */
export function angleDeg(
  a: { x: number; y: number; z?: number },
  b: { x: number; y: number; z?: number },
  c: { x: number; y: number; z?: number },
): number {
  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const baz = (a.z ?? 0) - (b.z ?? 0);
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const bcz = (c.z ?? 0) - (b.z ?? 0);
  const lenBA = Math.sqrt(bax * bax + bay * bay + baz * baz);
  const lenBC = Math.sqrt(bcx * bcx + bcy * bcy + bcz * bcz);
  if (lenBA === 0 || lenBC === 0) return NaN;
  const cos = (bax * bcx + bay * bcy + baz * bcz) / (lenBA * lenBC);
  // Rounding can push cos a hair outside [-1, 1], which would make acos NaN.
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

/** Returns the joint only if all of its numbers are usable (adapters can emit NaN). */
function usable(joints: Joints2D | null, name: JointName): Joint2D | null {
  const j = joints?.[name];
  if (!j || !Number.isFinite(j.x) || !Number.isFinite(j.y) || !Number.isFinite(j.c)) return null;
  return j;
}

/** Confidence of a joint, 0 when it is missing. */
function conf(j: Joint2D | null): number {
  return j ? j.c : 0;
}

function insideMargin(j: Joint2D, aspect: number): boolean {
  return (
    j.x >= FRAME_MARGIN && j.x <= aspect - FRAME_MARGIN && j.y >= FRAME_MARGIN && j.y <= 1 - FRAME_MARGIN
  );
}

/** Mean elbow angle over the sides where shoulder, elbow and wrist are all confident. */
function meanElbowAngle(
  sides: ReadonlyArray<{ ok: boolean; s: Joint3D | Point2 | undefined; e: Joint3D | Point2 | undefined; w: Joint3D | Point2 | undefined }>,
): number | null {
  let sum = 0;
  let n = 0;
  for (const side of sides) {
    if (!side.ok || !side.s || !side.e || !side.w) continue;
    const angle = angleDeg(side.s, side.e, side.w);
    if (!Number.isFinite(angle)) continue;
    sum += angle;
    n++;
  }
  return n > 0 ? sum / n : null;
}

/**
 * Derives geometric features from one frame. Pure.
 *
 * @param visibilityThreshold confidence needed for shoulders, elbows and the nose.
 * @param wristVisibilityThreshold confidence needed for wrists (defaults to
 *   `visibilityThreshold`). Wrists get their own threshold because they sit
 *   low in a floor-level frame and the detector is less sure about them.
 */
export function computeFeatures(
  frame: PoseFrame,
  visibilityThreshold: number,
  wristVisibilityThreshold: number = visibilityThreshold,
): Features {
  const joints = frame.joints;
  const aspect = frame.aspect;

  const nose = usable(joints, 'nose');
  const ls = usable(joints, 'leftShoulder');
  const rs = usable(joints, 'rightShoulder');
  const le = usable(joints, 'leftElbow');
  const re = usable(joints, 'rightElbow');
  const lw = usable(joints, 'leftWrist');
  const rw = usable(joints, 'rightWrist');

  const shoulderConfidence = Math.min(conf(ls), conf(rs));
  const upperBodyConfidence = Math.min(shoulderConfidence, conf(le), conf(re), conf(lw), conf(rw));

  // Both shoulders confident → we trust their positions for geometry.
  const shouldersConfident = ls !== null && rs !== null && shoulderConfidence >= visibilityThreshold;
  const shouldersVisible =
    shouldersConfident && ls !== null && rs !== null && insideMargin(ls, aspect) && insideMargin(rs, aspect);

  let shoulderMid: Point2 | null = null;
  let shoulderWidth: number | null = null;
  let shoulderWidthFrac: number | null = null;
  let shoulderTiltDeg: number | null = null;
  if (shouldersConfident && ls !== null && rs !== null) {
    // Confidence-weighted so a shakier shoulder pulls the midpoint less. (With
    // a visibility threshold of 0 both weights can be 0: use the plain mean
    // then instead of dividing by zero.)
    const wSum = ls.c + rs.c;
    const wl = wSum > 0 ? ls.c / wSum : 0.5;
    const wr = wSum > 0 ? rs.c / wSum : 0.5;
    shoulderMid = { x: ls.x * wl + rs.x * wr, y: ls.y * wl + rs.y * wr };
    const dx = rs.x - ls.x;
    const dy = rs.y - ls.y;
    shoulderWidth = Math.sqrt(dx * dx + dy * dy);
    // x is in image-height units, so the frame is `aspect` wide.
    shoulderWidthFrac = aspect > 0 ? shoulderWidth / aspect : null;
    // Unsigned: tilting either way counts the same (and mirroring can't flip it).
    shoulderTiltDeg = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
  }

  const visibleWristList = [lw, rw].filter((w): w is Joint2D => w !== null && w.c >= wristVisibilityThreshold);
  const visibleWrists = visibleWristList.length;
  let wristMid: Point2 | null = null;
  if (visibleWrists > 0) {
    let sx = 0;
    let sy = 0;
    for (const w of visibleWristList) {
      sx += w.x;
      sy += w.y;
    }
    wristMid = { x: sx / visibleWrists, y: sy / visibleWrists };
  }

  const noseVisible = nose !== null && nose.c >= visibilityThreshold;

  let heightRatio: number | null = null;
  if (shouldersVisible && shoulderMid && wristMid && shoulderWidth !== null && shoulderWidth > 1e-6) {
    heightRatio = (wristMid.y - shoulderMid.y) / shoulderWidth;
  }

  // Hands must be roughly under the shoulders (not way off to one side, which
  // usually means a mis-detected wrist or a person not in push-up position).
  let wristsInSpan = false;
  if (shoulderWidth !== null && ls !== null && rs !== null) {
    const lo = Math.min(ls.x, rs.x) - WRIST_SPAN_SHOULDER_WIDTHS * shoulderWidth;
    const hi = Math.max(ls.x, rs.x) + WRIST_SPAN_SHOULDER_WIDTHS * shoulderWidth;
    wristsInSpan = visibleWristList.every((w) => w.x >= lo && w.x <= hi);
  }

  const leftArmOk = conf(ls) >= visibilityThreshold && conf(le) >= visibilityThreshold && conf(lw) >= wristVisibilityThreshold;
  const rightArmOk = conf(rs) >= visibilityThreshold && conf(re) >= visibilityThreshold && conf(rw) >= wristVisibilityThreshold;

  const elbowAngle2D = meanElbowAngle([
    { ok: leftArmOk, s: ls ?? undefined, e: le ?? undefined, w: lw ?? undefined },
    { ok: rightArmOk, s: rs ?? undefined, e: re ?? undefined, w: rw ?? undefined },
  ]);

  // World joints carry no confidence of their own, so reuse the 2D confidences.
  const world = frame.world ?? null;
  const elbowAngle3D = world
    ? meanElbowAngle([
        { ok: leftArmOk, s: world.leftShoulder, e: world.leftElbow, w: world.leftWrist },
        { ok: rightArmOk, s: world.rightShoulder, e: world.rightElbow, w: world.rightWrist },
      ])
    : null;

  return {
    t: frame.t,
    present: joints !== null && joints !== undefined,
    shouldersVisible,
    noseVisible,
    visibleWrists,
    shoulderConfidence,
    upperBodyConfidence,
    shoulderMid,
    wristMid,
    nose: noseVisible && nose ? { x: nose.x, y: nose.y } : null,
    shoulderWidth,
    shoulderWidthFrac,
    shoulderTiltDeg,
    heightRatio,
    wristsInSpan,
    elbowAngle2D,
    elbowAngle3D,
  };
}
