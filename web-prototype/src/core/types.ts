/**
 * Core, platform-neutral types for push-up detection.
 *
 * Everything in src/core is pure TypeScript (no DOM, no MediaPipe) so the
 * algorithm can be unit-tested in Node and ported line-for-line to Swift +
 * Apple Vision later. Adapters (src/platform) convert detector output into
 * these types.
 */

/**
 * The joints the algorithm is allowed to use. All of them exist in both
 * MediaPipe Pose (33 landmarks) and Apple Vision VNDetectHumanBodyPoseRequest
 * (19 joints), so the port needs no new signals.
 *
 * "left"/"right" are from the PERSON's point of view (anatomical), not the
 * image's, matching both MediaPipe and Vision. The algorithm must not depend
 * on which side is which (a mirrored video file swaps them).
 */
export type JointName =
  | 'nose'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftElbow'
  | 'rightElbow'
  | 'leftWrist'
  | 'rightWrist'
  | 'leftHip'
  | 'rightHip';

export const JOINT_NAMES: readonly JointName[] = [
  'nose',
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
 * A 2D joint in an isotropic, y-DOWN image frame where BOTH axes are measured
 * in units of the image HEIGHT: x ∈ [0, aspect], y ∈ [0, 1] (origin top-left
 * of the UNMIRRORED camera image). Using height units for both axes means
 * Euclidean distances are meaningful regardless of the aspect ratio.
 *
 * `c` is the detector's confidence that the joint is visible, 0..1
 * (MediaPipe `visibility`, Vision `confidence`). Adapters set c = 0 for
 * joints that fall outside the image.
 */
export interface Joint2D {
  x: number;
  y: number;
  c: number;
}

/** Optional metric 3D joint (metres, y-down, hip-centred; MediaPipe worldLandmarks). */
export interface Joint3D {
  x: number;
  y: number;
  z: number;
}

export type Joints2D = Partial<Record<JointName, Joint2D>>;
export type Joints3D = Partial<Record<JointName, Joint3D>>;

/** One processed camera frame, as delivered to the core algorithm. */
export interface PoseFrame {
  /** Timestamp in milliseconds. Strictly increasing within a session. */
  t: number;
  /** Source image width / height. */
  aspect: number;
  /** Detected joints, or null when no person was detected in this frame. */
  joints: Joints2D | null;
  /** Optional 3D joints (only used for diagnostics / secondary signals). */
  world?: Joints3D | null;
}

export interface Point2 {
  x: number;
  y: number;
}

/**
 * Per-frame geometric features derived from a PoseFrame (see features.ts).
 * Instantaneous (unsmoothed). All lengths are in image-height units.
 */
export interface Features {
  t: number;
  /** A person was detected at all. */
  present: boolean;
  /** Both shoulders have confidence ≥ the visibility threshold and lie inside the frame margin. */
  shouldersVisible: boolean;
  /** Nose confidence ≥ the visibility threshold. */
  noseVisible: boolean;
  /** Number of wrists with confidence ≥ the wrist visibility threshold (0, 1 or 2). */
  visibleWrists: number;
  /** Minimum confidence over the two shoulders (0 if absent). */
  shoulderConfidence: number;
  /** Minimum confidence over shoulders + elbows + wrists (0 if absent). For lighting heuristics. */
  upperBodyConfidence: number;
  /** Confidence-weighted midpoint of the shoulders. */
  shoulderMid: Point2 | null;
  /** Mean of the visible wrists. */
  wristMid: Point2 | null;
  nose: Point2 | null;
  /** Distance between the shoulders. */
  shoulderWidth: number | null;
  /** shoulderWidth as a fraction of the frame WIDTH (used for "move closer / back"). */
  shoulderWidthFrac: number | null;
  /** Angle of the shoulder line from horizontal, degrees (0 = level). */
  shoulderTiltDeg: number | null;
  /**
   * (wristMid.y - shoulderMid.y) / shoulderWidth, using THIS frame's values.
   * Large at the TOP of a push-up (≈1.4–1.6 for a floor-level front camera),
   * shrinking toward 0 as the shoulders drop to hand level.
   * Null unless shoulders and at least one wrist are visible.
   */
  heightRatio: number | null;
  /** Every visible wrist lies within 0.75 × shoulderWidth of the outer shoulder edges. */
  wristsInSpan: boolean;
  /** Mean 2D elbow angle in degrees over confident sides (180 = straight). Diagnostic only. */
  elbowAngle2D: number | null;
  /** Mean 3D elbow angle in degrees from world joints, if available. Diagnostic only. */
  elbowAngle3D: number | null;
}

export interface SmoothingConfig {
  /** One Euro filter minimum cutoff frequency (Hz). Lower = smoother, more lag. */
  minCutoff: number;
  /** One Euro filter speed coefficient. Higher = less lag on fast motion. */
  beta: number;
  /** Cutoff (Hz) for the derivative low-pass. */
  dCutoff: number;
}

/**
 * "Is this a plausible plank seen from a phone on the floor?" Must pass to
 * calibrate (and to resume after an out-of-plank pause). Standing, sitting or
 * kneeling upright 1 m from a floor phone puts the shoulders out of frame, so
 * the gate fails naturally.
 */
export interface PlankGateConfig {
  /** shoulderWidth / frame width must be in [min, max]; outside → "move closer"/"move back". */
  minShoulderWidthFrac: number;
  maxShoulderWidthFrac: number;
  /** Max shoulder-line tilt from horizontal (deg). */
  maxShoulderTiltDeg: number;
  /** heightRatio must be in [min, max]. */
  minHeightRatio: number;
  maxHeightRatio: number;
}

export interface CounterConfig {
  /** Reps needed to complete the set. */
  targetReps: number;

  // --- Depth thresholds. depth d = 1 - h / hTop, where h = heightRatio
  // (smoothed) and hTop = the calibrated value at the top of the push-up.
  // Geometry (simulated, floor-level front camera): d ≈ 0.14–0.17 at a 120°
  // elbow, 0.25–0.29 at 100°, 0.32–0.39 at 90°.

  /** d at or beyond which a rep is deep enough ("about 90°" with some leniency). */
  downThreshold: number;
  /** d at or below which the user is back at the top (lockout). */
  upThreshold: number;
  /**
   * d beyond which a descent becomes a rep ATTEMPT. An attempt that never
   * reaches downThreshold is a partial rep ("Go lower").
   * Must satisfy upThreshold < partialMinDepth < downThreshold.
   */
  partialMinDepth: number;
  /** If d falls this far below the attempt's peak before reaching depth, the user turned back early → live "Go lower". */
  turnBackMargin: number;
  /**
   * How far back up counts as "back up". A rep is counted once d falls to
   * max(upThreshold, returnFraction × the rep's peak depth), capped at
   * partialMinDepth: 0.3 means "70 % of the way back up from your deepest
   * point", but always back above the line where an attempt starts. Tired
   * users stop a little short of their calibrated plank; a fixed upThreshold
   * alone merged their reps together. (An attempt also ends once d is back
   * within 0.04 of where it started, see repCounter.ts.)
   */
  returnFraction: number;

  // --- Timing (all in ms, never frame counts — frame rate varies on iPhone).

  /** d must stay ≥ downThreshold this long to register the bottom. */
  minBottomMs: number;
  /** Minimum time from leaving the top to returning, for a valid rep. */
  minRepMs: number;
  /** An attempt longer than this is cancelled (no rep, no partial). */
  maxRepMs: number;

  // --- Visibility.

  /** Confidence needed for shoulders / nose / elbows to count as visible. */
  visibilityThreshold: number;
  /** Confidence needed for a wrist to count as visible. */
  wristVisibilityThreshold: number;
  /** Body missing for this long while counting → pause (and cancel any rep in progress). */
  lostAfterMs: number;
  /** Body back for this long while paused → resume. */
  resumeAfterMs: number;

  // --- Calibration (during the 3-2-1 countdown).

  /** Stable plank needed before the countdown starts. */
  calibrationHoldMs: number;
  /** Length of the 3-2-1 countdown. */
  countdownMs: number;
  /** hTop = median heightRatio over the last this-many ms of the countdown. */
  calibrationWindowMs: number;
  /** Max standard deviation of heightRatio in that window; above it the countdown restarts. */
  calibrationMaxStd: number;
  plankGate: PlankGateConfig;

  // --- Robustness.

  /** Smoothing applied to the depth signal d. */
  smoothing: SmoothingConfig;
  /** Time constant (ms) of the EMA on shoulder width. */
  shoulderWidthTauMs: number;
  /** Time constant (ms) of the EMA on the wrist reference (updated only at the top, frozen during a rep). */
  wristTauMs: number;
  /** Single-frame jumps in raw d larger than this are held for up to 3 frames. */
  maxJump: number;
  /** Rate at which hTop follows the user while resting still at the top (0 disables). */
  baselineAdaptRate: number;
  /** hTop may drift at most this fraction from its calibrated value. */
  baselineMaxDrift: number;
  /** A valid rep keeps shoulderWidth / shoulderWidthAtTop within [min, max] (rejects rocking back). */
  minShoulderWidthRatio: number;
  maxShoulderWidthRatio: number;
  /** h above this multiple of hTop (user rose up / left the plank) → pause until back in plank. */
  outOfPlankRatio: number;
  /** Nose dropping more than this × shoulderWidth while d stays tiny → "chest, not head" hint. */
  headOnlyDropRatio: number;
}

/**
 * Lifecycle of one set.
 * - waiting:   looking for the user in a plank (Placement screen)
 * - countdown: user is in frame and holding a plank; 3-2-1 running, the top
 *              baseline is being measured
 * - counting:  set in progress
 * - paused:    set in progress but the body was lost or left the plank (count is kept)
 * - complete:  target reached
 */
export type CounterPhase = 'waiting' | 'countdown' | 'counting' | 'paused' | 'complete';

/** Where the user is within a rep (only meaningful while counting). */
export type MotionPhase = 'up' | 'descending' | 'down';

/** A short instruction the UI should show (one at a time; highest priority wins). */
export type CounterHint =
  | 'getInFrame' // no body / shoulders not visible
  | 'handsInView' // shoulders fine but no wrist visible
  | 'moveCloser' // shoulder width too small in frame
  | 'moveBack' // shoulder width too large in frame
  | 'holdStill' // in plank but still moving; countdown can't start / restarted
  | 'backToPlank' // paused because the user left the plank mid-set
  | 'chestNotHead'; // head dipping without the chest going down

export type PauseReason = 'lost' | 'outOfPlank';

export type CounterEvent =
  | { type: 'inFrame'; t: number }
  | { type: 'countdownTick'; t: number; secondsLeft: number }
  | { type: 'countdownCancelled'; t: number }
  | { type: 'start'; t: number; baselineRatio: number }
  | { type: 'depthReached'; t: number }
  | { type: 'rep'; t: number; count: number; durationMs: number; peakDepth: number }
  /** live = emitted when the user turned back early (before returning to the top). At most one per attempt. */
  | { type: 'partial'; t: number; peakDepth: number; live: boolean }
  | { type: 'repCancelled'; t: number; reason: 'lost' | 'outOfPlank' | 'tooSlow' | 'rockedBack' }
  | { type: 'paused'; t: number; reason: PauseReason }
  | { type: 'resumed'; t: number }
  | { type: 'complete'; t: number; count: number; elapsedMs: number };

export type CounterEventType = CounterEvent['type'];

/** Result of feeding one frame to the counter. */
export interface CounterSnapshot {
  phase: CounterPhase;
  motion: MotionPhase;
  count: number;
  target: number;
  /** Smoothed depth, 0 = top, 1 = shoulders at hand level. Null if unknown. */
  depth: number | null;
  /** Unsmoothed depth for diagnostics. */
  rawDepth: number | null;
  /** Deepest smoothed depth reached in the current (or most recent) attempt. */
  peakDepth: number;
  /**
   * 'wrists' when a wrist is visible this frame; 'shoulders' when none is, so
   * depth came from the shoulders alone against the last known hand line
   * (same formula and scale, just less certain). Null when depth is null.
   */
  depthSource: 'wrists' | 'shoulders' | null;
  /** Smoothed heightRatio h. */
  heightRatio: number | null;
  /** Calibrated (and slowly adapted) heightRatio at the top of the push-up, hTop. */
  baselineRatio: number | null;
  /** Smoothed shoulderWidth / shoulderWidth at calibration. */
  shoulderWidthRatio: number | null;
  /**
   * Image y (height units, unmirrored, y-down) the shoulder midpoint must
   * reach for depth = downThreshold, i.e. the "depth line" to draw across the
   * video. Null until calibrated.
   */
  depthLineY: number | null;
  /** Remaining countdown time while phase === 'countdown'. */
  countdownRemainingMs: number | null;
  /** The user is currently visible enough to count (debounced). */
  inFrame: boolean;
  /** The plank gate passes this frame. */
  plankOk: boolean;
  /** Current instruction for the user, or null. */
  hint: CounterHint | null;
  /** Timestamp of the 'start' event, or null before the set starts. */
  startedAt: number | null;
  features: Features;
  /** Events emitted by THIS update (empty most frames). */
  events: CounterEvent[];
}

/** What the UI should tell the user when tracking is not working (spec S2 / S3). */
export type TrackingIssue = 'none' | 'notDetected' | 'tooDark';
