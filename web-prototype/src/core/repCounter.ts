import { computeFeatures } from './features';
import { OneEuroFilter } from './oneEuro';
import type {
  CounterConfig,
  CounterEvent,
  CounterHint,
  CounterPhase,
  CounterSnapshot,
  Features,
  MotionPhase,
  PauseReason,
  PoseFrame,
  SmoothingConfig,
} from './types';

/**
 * Starting values. Geometry-derived (see types.ts); re-tune on real
 * recordings. downThreshold 0.25 ≈ a 95–100° elbow, so true 90° reps
 * (d ≈ 0.32–0.39) pass with margin after smoothing.
 */
export const DEFAULT_CONFIG: CounterConfig = {
  targetReps: 10,

  downThreshold: 0.25,
  upThreshold: 0.07,
  partialMinDepth: 0.12,
  turnBackMargin: 0.04,
  // Real laptop session (tests/fixtures/laptop-session-1.json): tired reps came
  // back up to d ≈ 0.08–0.12, never reaching upThreshold 0.07, so 13 push-ups
  // counted as 10. Counting at 70 % of the way back up fixes that.
  returnFraction: 0.3,

  minBottomMs: 60,
  minRepMs: 450,
  maxRepMs: 10000,

  visibilityThreshold: 0.5,
  wristVisibilityThreshold: 0.4,
  lostAfterMs: 500,
  resumeAfterMs: 300,

  calibrationHoldMs: 600,
  countdownMs: 3000,
  calibrationWindowMs: 1000,
  calibrationMaxStd: 0.04,
  plankGate: {
    minShoulderWidthFrac: 0.15,
    maxShoulderWidthFrac: 0.7,
    maxShoulderTiltDeg: 20,
    minHeightRatio: 1.1,
    maxHeightRatio: 2.6,
  },

  smoothing: { minCutoff: 1.2, beta: 1.5, dCutoff: 1.0 },
  // Was 400. Shoulder width really grows 5–30 % during a rep (the shoulders
  // come closer to the camera), so a slow average lags behind: right after a
  // deep rep it is still inflated, which keeps d above upThreshold and merged
  // fast back-to-back reps into one (18–49 % of fast-cadence sessions missed
  // a rep in the simulator sweep). 150 ms fixes that and is still smooth enough.
  shoulderWidthTauMs: 150,
  wristTauMs: 500,
  maxJump: 0.25,
  baselineAdaptRate: 0.05,
  baselineMaxDrift: 0.08,
  minShoulderWidthRatio: 0.9,
  // Was 1.2. In the simulator sweep a deep (60°) rep from a close, tilted-up
  // phone legitimately widens the shoulders by up to 30 % (smoothed), so 1.2
  // threw away real reps. Rocking back is caught by the LOWER bound; the
  // upper bound is only a sanity check.
  maxShoulderWidthRatio: 1.4,
  outOfPlankRatio: 1.35,
  headOnlyDropRatio: 0.3,
};

/** Depth strictness presets for the settings UI (values for downThreshold). */
export const DEPTH_PRESETS = { lenient: 0.21, normal: 0.25, strict: 0.29 } as const;

// ---------------------------------------------------------------------------
// Fixed tuning constants. These are deliberately NOT in CounterConfig: they
// are safety nets rather than knobs, and changing them rarely helps.

/** During the countdown, the plank gate may fail this long before the countdown is cancelled (one bad frame shouldn't cancel it). */
const COUNTDOWN_GATE_GRACE_MS = 400;
/**
 * Calibration needs at least this many samples in its window ...
 * (Was 8, a frame-count rule: below ~7 fps a perfectly still plank could
 * never calibrate and the 3-2-1 restarted forever with "Hold still". The CPU
 * fallback with the Full model can run at 5–7 fps.)
 */
const MIN_CALIBRATION_SAMPLES = 4;
/** ... and they must span at least this fraction of calibrationWindowMs (time, not frames). */
const MIN_CALIBRATION_SPAN = 0.7;
/** "Still" = smoothed depth stays within ±this band ... */
const STILL_BAND = 0.03;
/** ... for at least this long. */
const STILL_MS = 500;
/** The top baseline only adapts while depth is below this (resting at the top, or above the calibrated top). */
const ADAPT_MAX_DEPTH = 0.05;
/**
 * Per-frame settings (baselineAdaptRate, maxJump) are defined for one 30 fps
 * frame and scaled by the real frame time, so they behave the same at 15 fps.
 */
const REFERENCE_FRAME_MS = 1000 / 30;
/** Shoulder-width ratio outside this range while counting means the user left the plank (pause). */
const OUT_OF_PLANK_MIN_SW_RATIO = 0.8;
/** Must stay above maxShoulderWidthRatio (deep reps from a close phone reach ~1.3). */
const OUT_OF_PLANK_MAX_SW_RATIO = 1.5;
/** Out-of-plank must persist this long before pausing, so one glitchy frame can't pause the set. */
const OUT_OF_PLANK_DEBOUNCE_MS = 200;
/** To resume after an out-of-plank pause, depth must be back within ±this of the top. */
const RESUME_MAX_DEPTH = 0.1;
/** The "chest, not head" check only runs while the shoulders have barely moved. */
const HEAD_DROP_MAX_DEPTH = 0.1;
/** The head must stay dropped this long before the hint shows. */
const HEAD_DROP_MS = 300;
/** Hints that flash (chest, not head) stay up this long so they can be read from the floor. */
const HINT_LINGER_MS = 1500;
/** A suspicious jump in raw depth is replaced by the previous value for at most this many frames, then accepted. */
const MAX_JUMP_HOLD_FRAMES = 3;
/**
 * A new rep attempt starts only once depth has risen this far above the
 * lowest point since the last rep (the "local top"). Because a rep can now be
 * counted before the user is fully back up, this stops the rest of the way
 * up from looking like the start of a new (shallow) rep.
 */
const ATTEMPT_MIN_RISE = 0.06;
/**
 * An attempt also ends once depth is back within this of where it started
 * (its local top). A tired user's top can sit above upThreshold (d ≈ 0.08 at
 * a 135° elbow), and without this a shallow rep from there never ended: the
 * next reps folded into it with no "Go lower", and a real rep could later be
 * cancelled as too slow.
 */
const ATTEMPT_END_MARGIN = 0.04;

// ---------------------------------------------------------------------------
// Small helpers

/** Merges a partial config into a full one, ignoring undefined values and merging the nested groups. */
function mergeConfig(base: CounterConfig, partial: Partial<CounterConfig> | undefined): CounterConfig {
  const out: CounterConfig = { ...base, smoothing: { ...base.smoothing }, plankGate: { ...base.plankGate } };
  if (!partial) return out;
  const target = out as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined || key === 'smoothing' || key === 'plankGate') continue;
    target[key] = value;
  }
  // Nested groups may arrive partially filled (e.g. from a debug slider), so merge field by field.
  for (const [key, value] of Object.entries(partial.smoothing ?? {})) {
    if (value !== undefined) (out.smoothing as unknown as Record<string, unknown>)[key] = value;
  }
  for (const [key, value] of Object.entries(partial.plankGate ?? {})) {
    if (value !== undefined) (out.plankGate as unknown as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** Exponential moving average step with time constant tauMs, using the real frame time dtMs. */
function ema(prev: number | null, value: number, dtMs: number, tauMs: number): number {
  if (prev === null) return value;
  const a = tauMs > 0 ? 1 - Math.exp(-dtMs / tauMs) : 1;
  return prev + a * (value - prev);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? NaN) : ((s[mid - 1] ?? NaN) + (s[mid] ?? NaN)) / 2;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return Infinity;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return Math.sqrt(variance);
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * Smoothing for the calibration stillness check: a plain low-pass (beta = 0)
 * at half the depth filter's cutoff. Landmark jitter is fast and gets
 * filtered out; a user still settling into position drifts slowly and still
 * shows up as variance.
 */
function calibrationSmoothing(smoothing: SmoothingConfig): SmoothingConfig {
  return { ...smoothing, minCutoff: smoothing.minCutoff / 2, beta: 0 };
}

// ---------------------------------------------------------------------------
// State

interface CalibrationSample {
  t: number;
  /** heightRatio from the smoothed references. hTop is the median of these. */
  h: number;
  /** The same, passed through a One Euro filter. Only used for the stillness (std) check. */
  hSmooth: number;
  /** nose.y - shoulderMid.y, or null if the nose wasn't visible. */
  noseGap: number | null;
}

interface DepthMeasurement {
  /** Unsmoothed depth. */
  raw: number;
  /** heightRatio that corresponds to `raw`. */
  h: number;
  source: 'wrists' | 'shoulders';
}

/** Everything that changes while counting. Kept in one object so reset() is a single assignment. */
interface CounterState {
  phase: CounterPhase;
  motion: MotionPhase;
  count: number;
  startedAt: number | null;
  lastT: number | null;

  // Debounced visibility ("in frame").
  inFrame: boolean;
  visibleSince: number | null;
  hiddenSince: number | null;

  // Smoothed references (image-height units).
  swEma: number | null;
  wristRefY: number | null;

  // Calibration results. hTop and swTop also follow the user slowly while resting at the top.
  hTop: number | null;
  hTopCalibrated: number | null;
  swTop: number | null;
  noseGapTop: number | null;

  // Waiting / countdown.
  gateSince: number | null;
  countdownStart: number | null;
  lastTick: number;
  gateFailSince: number | null;
  calSamples: CalibrationSample[];
  calibrationRestarted: boolean;

  // Depth signal.
  lastRawAccepted: number | null;
  lastRawT: number | null;
  jumpHeldFrames: number;
  peakDepth: number;

  // Current rep attempt (attemptStart === null → no attempt).
  /** Lowest depth since the last attempt ended: where "the top" is right now. */
  localTop: number | null;
  /** When the user was at localTop (the rep's timer starts there). */
  leftTopAt: number | null;
  repStart: number;
  attemptStart: number | null;
  /** localTop when the current attempt started: the attempt also ends once the user is back near it. */
  attemptTop: number;
  bottomSince: number | null;
  livePartialSent: boolean;
  swRatioMin: number;
  swRatioMax: number;
  /** After a cancelled attempt, the user must return to the top before a new attempt can start. */
  awaitingTop: boolean;

  // Baseline adaptation.
  stillAnchor: number | null;
  stillSince: number;

  // Pause.
  pauseReason: PauseReason | null;
  outOfPlankSince: number | null;
  resumeSince: number | null;

  // Hints.
  headDropSince: number | null;
  chestHintUntil: number;
}

function initialState(): CounterState {
  return {
    phase: 'waiting',
    motion: 'up',
    count: 0,
    startedAt: null,
    lastT: null,
    inFrame: false,
    visibleSince: null,
    hiddenSince: null,
    swEma: null,
    wristRefY: null,
    hTop: null,
    hTopCalibrated: null,
    swTop: null,
    noseGapTop: null,
    gateSince: null,
    countdownStart: null,
    lastTick: 0,
    gateFailSince: null,
    calSamples: [],
    calibrationRestarted: false,
    lastRawAccepted: null,
    lastRawT: null,
    jumpHeldFrames: 0,
    peakDepth: 0,
    localTop: null,
    leftTopAt: null,
    repStart: 0,
    attemptStart: null,
    attemptTop: 0,
    bottomSince: null,
    livePartialSent: false,
    swRatioMin: 1,
    swRatioMax: 1,
    awaitingTop: false,
    stillAnchor: null,
    stillSince: 0,
    pauseReason: null,
    outOfPlankSince: null,
    resumeSince: null,
    headDropSince: null,
    chestHintUntil: -Infinity,
  };
}

// ---------------------------------------------------------------------------

/**
 * Push-up rep counter state machine. Pure: feed it PoseFrames, read snapshots.
 *
 * Depth signal (front camera on the floor, user's head toward the phone):
 *   h = (wristRefY - shoulderMid.y) / shoulderWidth  — the gap between the
 *       hands and the shoulders, measured in shoulder widths so it doesn't
 *       change with distance to the camera.
 *   d = 1 - h / hTop  — 0 at the top (calibrated during the 3-2-1), growing
 *       as the shoulders sink toward the hands.
 * A rep counts when d goes past downThreshold and comes back to upThreshold.
 */
export class RepCounter {
  private cfg: CounterConfig;
  private readonly depthFilter: OneEuroFilter;
  /**
   * Smooths h during the countdown so ordinary landmark jitter doesn't fail
   * the stillness check (see calibrationSmoothing). With the normal beta the
   * filter mistakes jitter for motion and barely smooths at all.
   */
  private readonly calFilter: OneEuroFilter;
  private s: CounterState = initialState();

  constructor(config?: Partial<CounterConfig>) {
    this.cfg = mergeConfig(DEFAULT_CONFIG, config);
    this.depthFilter = new OneEuroFilter(this.cfg.smoothing);
    this.calFilter = new OneEuroFilter(calibrationSmoothing(this.cfg.smoothing));
  }

  /** A copy of the active configuration. */
  get config(): CounterConfig {
    return mergeConfig(this.cfg, undefined);
  }

  /** Updates thresholds live (e.g. from debug sliders) without losing the count or calibration. */
  setConfig(partial: Partial<CounterConfig>): void {
    this.cfg = mergeConfig(this.cfg, partial);
    this.depthFilter.setConfig(this.cfg.smoothing);
    this.calFilter.setConfig(calibrationSmoothing(this.cfg.smoothing));
  }

  update(frame: PoseFrame): CounterSnapshot {
    const cfg = this.cfg;
    const s = this.s;
    const t = frame.t;
    // Timing always comes from timestamps, never from frame counts: Safari's
    // frame rate wanders between ~12 and 30 fps.
    const dtMs = s.lastT === null ? 0 : Math.max(0, t - s.lastT);
    s.lastT = t;

    const f = computeFeatures(frame, cfg.visibilityThreshold, cfg.wristVisibilityThreshold);
    const events: CounterEvent[] = [];

    this.updateInFrame(f, t);
    const gateHint = this.plankGateHint(f);
    const plankOk = gateHint === null;
    this.updateReferences(f, dtMs, plankOk);

    let hint: CounterHint | null = null;
    let measurement: DepthMeasurement | null = null;
    let depth: number | null = null;

    switch (s.phase) {
      case 'waiting': {
        hint = this.stepWaiting(t, gateHint, events);
        break;
      }
      case 'countdown': {
        hint = this.stepCountdown(f, t, gateHint, events);
        // (Cast: TypeScript doesn't know stepCountdown can change the phase.)
        if ((s.phase as CounterPhase) === 'counting') {
          // Calibration just finished: start the depth filter on this frame.
          measurement = this.measureDepth(f);
          if (measurement) depth = this.smoothDepth(measurement.raw, t);
        }
        break;
      }
      case 'counting': {
        measurement = this.measureDepth(f);
        if (measurement) depth = this.smoothDepth(measurement.raw, t);
        hint = this.stepCounting(f, t, dtMs, measurement, depth, events);
        break;
      }
      case 'paused': {
        measurement = this.measureDepth(f);
        if (measurement) depth = this.smoothDepth(measurement.raw, t);
        hint = this.stepPaused(t, gateHint, depth, events);
        break;
      }
      case 'complete': {
        measurement = this.measureDepth(f);
        if (measurement) depth = this.smoothDepth(measurement.raw, t);
        break;
      }
    }

    const calibrated = s.hTop !== null;
    return {
      phase: s.phase,
      motion: s.phase === 'counting' ? s.motion : 'up',
      count: s.count,
      target: cfg.targetReps,
      depth,
      rawDepth: measurement ? measurement.raw : null,
      peakDepth: s.peakDepth,
      depthSource: measurement ? measurement.source : null,
      heightRatio: measurement ? measurement.h : this.referenceHeightRatio(f),
      baselineRatio: s.hTop,
      shoulderWidthRatio: calibrated && s.swEma !== null && s.swTop ? s.swEma / s.swTop : null,
      depthLineY: this.depthLineY(),
      countdownRemainingMs:
        s.phase === 'countdown' && s.countdownStart !== null
          ? Math.max(0, cfg.countdownMs - (t - s.countdownStart))
          : null,
      inFrame: s.inFrame,
      plankOk,
      hint,
      startedAt: s.startedAt,
      features: f,
      events,
    };
  }

  /** Back to 'waiting' with count 0 (keeps config). */
  reset(): void {
    this.s = initialState();
    this.depthFilter.reset();
    this.calFilter.reset();
  }

  // -------------------------------------------------------------------------
  // Per-frame bookkeeping

  /** Debounced "the user is visible": on after resumeAfterMs of visible shoulders, off after lostAfterMs without. */
  private updateInFrame(f: Features, t: number): void {
    const s = this.s;
    if (f.shouldersVisible) {
      s.hiddenSince = null;
      s.visibleSince ??= t;
      if (!s.inFrame && t - s.visibleSince >= this.cfg.resumeAfterMs) s.inFrame = true;
    } else {
      s.visibleSince = null;
      s.hiddenSince ??= t;
      if (s.inFrame && t - s.hiddenSince >= this.cfg.lostAfterMs) s.inFrame = false;
    }
  }

  /**
   * Updates the smoothed shoulder width and the wrist reference.
   * The wrist reference only follows the wrists between rep attempts (or
   * while setting up). During a rep it is frozen: the hands don't move on the
   * floor, but the detector's wrist estimate can wobble as the body moves.
   *
   * It keeps following while awaitingTop (after a pause or a cancelled
   * attempt). It used to freeze there too, and if the phone had been moved
   * (knocked over and propped up again at another tilt) the stale hand line
   * kept d above partialMinDepth at the real top: awaitingTop never cleared
   * and no rep could ever count again.
   */
  private updateReferences(f: Features, dtMs: number, plankOk: boolean): void {
    const s = this.s;
    const cfg = this.cfg;
    if (f.shouldersVisible && f.shoulderWidth !== null) {
      s.swEma = ema(s.swEma, f.shoulderWidth, dtMs, cfg.shoulderWidthTauMs);
    }
    if (f.wristMid === null) return;
    const atTop =
      s.phase === 'waiting' ||
      s.phase === 'countdown' ||
      (s.phase === 'counting' && s.attemptStart === null) ||
      // Hands may have been re-planted during a pause; follow them once the plank is back.
      (s.phase === 'paused' && plankOk);
    if (atTop) s.wristRefY = ema(s.wristRefY, f.wristMid.y, dtMs, cfg.wristTauMs);
  }

  /** heightRatio from the smoothed references (no calibration needed), or null. */
  private referenceHeightRatio(f: Features): number | null {
    const s = this.s;
    if (!f.shouldersVisible || !f.shoulderMid || s.wristRefY === null || !s.swEma) return null;
    return (s.wristRefY - f.shoulderMid.y) / s.swEma;
  }

  /**
   * The plank gate: null when this frame looks like a plank seen from a
   * phone on the floor, otherwise the hint for the first check that failed.
   */
  private plankGateHint(f: Features): CounterHint | null {
    const g = this.cfg.plankGate;
    if (!f.present || !f.shouldersVisible || !f.shoulderMid) return 'getInFrame';
    if (f.visibleWrists === 0 || !f.wristMid) return 'handsInView';
    if (f.shoulderWidthFrac === null || f.shoulderWidthFrac < g.minShoulderWidthFrac) return 'moveCloser';
    if (f.shoulderWidthFrac > g.maxShoulderWidthFrac) return 'moveBack';
    // The rest mean "not a plank shape yet" — the instruction is to hold a plank.
    if (f.shoulderTiltDeg === null || f.shoulderTiltDeg > g.maxShoulderTiltDeg) return 'holdStill';
    if (f.wristMid.y <= f.shoulderMid.y) return 'holdStill';
    if (f.heightRatio === null || f.heightRatio < g.minHeightRatio || f.heightRatio > g.maxHeightRatio) {
      return 'holdStill';
    }
    if (!f.wristsInSpan) return 'holdStill';
    if (f.nose && f.nose.y >= f.wristMid.y) return 'holdStill';
    return null;
  }

  /**
   * Where the shoulder midpoint must reach for d = downThreshold (the "depth
   * line" the UI draws). Solving d = 1 - h/hTop with h = (wristRefY - y)/sw
   * for y gives  y = wristRefY - hTop·(1 - down)·sw.  It uses exactly the
   * references measureDepth uses, so a shoulder midpoint on this line means
   * raw depth = downThreshold. Null until calibrated.
   */
  private depthLineY(): number | null {
    const s = this.s;
    if (s.hTop === null || s.wristRefY === null || !s.swEma) return null;
    return s.wristRefY - s.hTop * (1 - this.cfg.downThreshold) * s.swEma;
  }

  /**
   * Depth of this frame. Needs calibration and visible shoulders.
   *
   * The hand line (wristRefY) is frozen during a rep and the hands don't move
   * on the floor, so the same formula also works when no wrist is visible in
   * this frame (hidden in low light, or a wobbly detection): depth then comes
   * from the shoulders alone, against the last known hand line, and is
   * labelled 'shoulders'. One formula for both cases means no jump in depth
   * when the wrists drop in and out mid-rep.
   *
   * (An earlier fallback divided the raw shoulder drop by the shoulder width
   * at the TOP. The shoulders grow as they come closer to the camera, so it
   * read up to ~25 % shallower than the wrist signal at the bottom and a real
   * 90° rep from a close phone failed to count whenever the wrists vanished.)
   */
  private measureDepth(f: Features): DepthMeasurement | null {
    const s = this.s;
    if (!f.shouldersVisible || !f.shoulderMid || s.hTop === null || s.wristRefY === null || !s.swEma) return null;
    const h = (s.wristRefY - f.shoulderMid.y) / s.swEma;
    return { raw: 1 - h / s.hTop, h, source: f.visibleWrists > 0 ? 'wrists' : 'shoulders' };
  }

  /** Jump rejection + One Euro smoothing of the raw depth. */
  private smoothDepth(raw: number, t: number): number {
    const s = this.s;
    let accepted = raw;
    // A single-frame leap (e.g. the detector briefly snapping a wrist to the
    // wrong place) is ignored for a few frames; if it persists it is real.
    // maxJump is per 30 fps frame: after a longer gap (15 fps, or a dropped
    // frame) a fast but real push-up legitimately moves further, so the limit
    // grows with the gap.
    const gapMs = s.lastRawT === null ? REFERENCE_FRAME_MS : t - s.lastRawT;
    const maxJump = this.cfg.maxJump * Math.max(1, gapMs / REFERENCE_FRAME_MS);
    if (
      s.lastRawAccepted !== null &&
      Math.abs(raw - s.lastRawAccepted) > maxJump &&
      s.jumpHeldFrames < MAX_JUMP_HOLD_FRAMES
    ) {
      accepted = s.lastRawAccepted;
      s.jumpHeldFrames++;
    } else {
      s.jumpHeldFrames = 0;
    }
    s.lastRawAccepted = accepted;
    s.lastRawT = t;
    return this.depthFilter.filter(accepted, t);
  }

  // -------------------------------------------------------------------------
  // Phases

  private stepWaiting(t: number, gateHint: CounterHint | null, events: CounterEvent[]): CounterHint | null {
    const s = this.s;
    if (gateHint !== null) {
      s.gateSince = null;
      return gateHint;
    }
    s.gateSince ??= t;
    if (t - s.gateSince >= this.cfg.calibrationHoldMs) {
      events.push({ type: 'inFrame', t });
      this.startCountdown(t, events);
      return null;
    }
    // In a plank but not for long enough yet.
    return 'holdStill';
  }

  private startCountdown(t: number, events: CounterEvent[]): void {
    const s = this.s;
    s.phase = 'countdown';
    s.countdownStart = t;
    s.gateFailSince = null;
    s.calSamples = [];
    this.calFilter.reset();
    s.lastTick = Math.ceil(this.cfg.countdownMs / 1000);
    events.push({ type: 'countdownTick', t, secondsLeft: s.lastTick });
  }

  private stepCountdown(
    f: Features,
    t: number,
    gateHint: CounterHint | null,
    events: CounterEvent[],
  ): CounterHint | null {
    const s = this.s;
    const cfg = this.cfg;
    if (gateHint !== null) {
      s.gateFailSince ??= t;
      if (t - s.gateFailSince >= COUNTDOWN_GATE_GRACE_MS) {
        events.push({ type: 'countdownCancelled', t });
        s.phase = 'waiting';
        s.gateSince = null;
        s.countdownStart = null;
        s.calibrationRestarted = false;
        return gateHint;
      }
    } else {
      s.gateFailSince = null;
      const h = this.referenceHeightRatio(f);
      if (h !== null && f.shoulderMid) {
        s.calSamples.push({
          t,
          h,
          hSmooth: this.calFilter.filter(h, t),
          noseGap: f.nose ? f.nose.y - f.shoulderMid.y : null,
        });
        // Only the last calibrationWindowMs is ever used.
        while (s.calSamples.length > 0 && (s.calSamples[0]?.t ?? t) < t - cfg.calibrationWindowMs) {
          s.calSamples.shift();
        }
      }
    }

    const elapsed = t - (s.countdownStart ?? t);
    const remaining = cfg.countdownMs - elapsed;
    if (remaining <= 0) {
      this.finishCountdown(t, events);
    } else {
      const secondsLeft = Math.ceil(remaining / 1000);
      if (secondsLeft < s.lastTick) {
        s.lastTick = secondsLeft;
        events.push({ type: 'countdownTick', t, secondsLeft });
      }
    }
    if (s.phase !== 'countdown') return null;
    if (gateHint !== null) return gateHint;
    return s.calibrationRestarted ? 'holdStill' : null;
  }

  /** End of the 3-2-1: measure the top baseline, or restart if the user wasn't still. */
  private finishCountdown(t: number, events: CounterEvent[]): void {
    const s = this.s;
    const cfg = this.cfg;
    const window = s.calSamples.filter((c) => c.t >= t - cfg.calibrationWindowMs);
    const span = (window[window.length - 1]?.t ?? 0) - (window[0]?.t ?? 0);
    const stable =
      window.length >= MIN_CALIBRATION_SAMPLES &&
      span >= MIN_CALIBRATION_SPAN * cfg.calibrationWindowMs &&
      stdDev(window.map((c) => c.hSmooth)) <= cfg.calibrationMaxStd;
    if (!stable || s.swEma === null) {
      // Still moving: run the 3-2-1 again (the hint tells the user to hold still).
      s.calibrationRestarted = true;
      this.startCountdown(t, events);
      return;
    }
    const hTop = median(window.map((c) => c.h));
    const noseGaps = window.map((c) => c.noseGap).filter((g): g is number => g !== null);
    s.hTop = hTop;
    s.hTopCalibrated = hTop;
    s.swTop = s.swEma;
    // The head check needs a reliable nose; skip it if the nose was mostly out of view.
    s.noseGapTop = noseGaps.length >= window.length / 2 ? median(noseGaps) : null;

    s.phase = 'counting';
    s.motion = 'up';
    s.startedAt = t;
    s.countdownStart = null;
    s.calibrationRestarted = false;
    s.leftTopAt = t;
    s.localTop = null;
    s.attemptStart = null;
    s.awaitingTop = false;
    s.peakDepth = 0;
    s.stillAnchor = null;
    s.lastRawAccepted = null;
    s.lastRawT = null;
    s.jumpHeldFrames = 0;
    this.depthFilter.reset();
    events.push({ type: 'start', t, baselineRatio: hTop });
  }

  private stepCounting(
    f: Features,
    t: number,
    dtMs: number,
    m: DepthMeasurement | null,
    d: number | null,
    events: CounterEvent[],
  ): CounterHint | null {
    const s = this.s;
    const cfg = this.cfg;

    if (m === null || d === null) {
      // Shoulders not visible. Short dropouts are tolerated (the rep in
      // progress continues); after lostAfterMs the set pauses.
      if (s.hiddenSince !== null && t - s.hiddenSince >= cfg.lostAfterMs) {
        this.enterPause('lost', t, events);
      }
      return 'getInFrame';
    }

    const swRatio = s.swEma !== null && s.swTop ? s.swEma / s.swTop : 1;
    // h > outOfPlankRatio × hTop  ⇔  d < 1 - outOfPlankRatio (the user rose up, e.g. onto the knees).
    const outOfPlank =
      d < 1 - cfg.outOfPlankRatio || swRatio < OUT_OF_PLANK_MIN_SW_RATIO || swRatio > OUT_OF_PLANK_MAX_SW_RATIO;
    if (outOfPlank) {
      s.outOfPlankSince ??= t;
      if (t - s.outOfPlankSince >= OUT_OF_PLANK_DEBOUNCE_MS) {
        this.enterPause('outOfPlank', t, events);
        return 'backToPlank';
      }
    } else {
      s.outOfPlankSince = null;
    }

    this.stepMotion(t, dtMs, d, m, swRatio, events);
    this.checkHeadOnly(f, t, d);

    if (s.count >= cfg.targetReps) {
      s.phase = 'complete';
      s.motion = 'up';
      events.push({ type: 'complete', t, count: s.count, elapsedMs: t - (s.startedAt ?? t) });
      return null;
    }

    if (f.visibleWrists === 0) return 'handsInView';
    if (t < s.chestHintUntil) return 'chestNotHead';
    return null;
  }

  /** up → descending → down → (back to up: rep / partial / cancelled). */
  private stepMotion(
    t: number,
    dtMs: number,
    d: number,
    m: DepthMeasurement,
    swRatio: number,
    events: CounterEvent[],
  ): void {
    const s = this.s;
    const cfg = this.cfg;

    if (s.attemptStart === null) {
      // Follow the lowest point since the last rep: tired users often stop a
      // little short of their calibrated plank, so the next rep starts from
      // wherever they turned around, not only from d ≈ 0.
      if (s.localTop === null || d <= s.localTop) {
        s.localTop = d;
        s.leftTopAt = t;
      }
      if (d <= cfg.partialMinDepth) s.awaitingTop = false;
      if (!s.awaitingTop && d > cfg.partialMinDepth && d - s.localTop >= ATTEMPT_MIN_RISE) {
        // A real descent has begun: this is now a rep attempt.
        s.attemptStart = t;
        s.attemptTop = s.localTop;
        s.repStart = s.leftTopAt ?? t;
        s.motion = 'descending';
        s.peakDepth = d;
        s.bottomSince = null;
        s.livePartialSent = false;
        s.swRatioMin = swRatio;
        s.swRatioMax = swRatio;
        s.stillAnchor = null;
        return;
      }
      if (!s.awaitingTop && m.source === 'wrists') this.adaptBaseline(t, dtMs, d);
      return;
    }

    // --- An attempt is in progress.
    s.peakDepth = Math.max(s.peakDepth, d);
    s.swRatioMin = Math.min(s.swRatioMin, swRatio);
    s.swRatioMax = Math.max(s.swRatioMax, swRatio);
    // A real push-up only widens the shoulders a little (they come closer to
    // the camera). A big change means the user rocked back or shifted instead.
    const ratioOk = s.swRatioMin >= cfg.minShoulderWidthRatio && s.swRatioMax <= cfg.maxShoulderWidthRatio;

    if (s.motion === 'descending') {
      if (d >= cfg.downThreshold && ratioOk) {
        s.bottomSince ??= t;
        if (t - s.bottomSince >= cfg.minBottomMs) {
          s.motion = 'down';
          events.push({ type: 'depthReached', t });
        }
      } else {
        s.bottomSince = null;
      }
      // Turned back before reaching depth → say "Go lower" right away, not only at the top.
      if (s.motion === 'descending' && !s.livePartialSent && ratioOk && s.peakDepth >= cfg.partialMinDepth && d < s.peakDepth - cfg.turnBackMargin) {
        s.livePartialSent = true;
        events.push({ type: 'partial', t, peakDepth: s.peakDepth, live: true });
      }
    }

    if (t - s.attemptStart > cfg.maxRepMs) {
      events.push({ type: 'repCancelled', t, reason: 'tooSlow' });
      this.endAttempt();
      s.awaitingTop = true;
      return;
    }

    // Back up: counted once the user is most of the way back up (never at the
    // bottom). The bar scales with how deep this rep went and is never
    // stricter than upThreshold. It is capped at partialMinDepth, the line
    // where an attempt starts, so a rep must come back out of the bottom
    // zone. (The cap used to be 0.9 × downThreshold ≈ a 115–125° elbow, and
    // pulsing in the bottom half between ~65° and ~120° counted every pulse.)
    const returnAt = Math.min(Math.max(cfg.upThreshold, cfg.returnFraction * s.peakDepth), cfg.partialMinDepth);
    // A tired user's top can sit above returnAt (a shallow attempt has a low
    // returnAt): the attempt also ends once they are back near where it started.
    const endAt = Math.max(returnAt, Math.min(cfg.partialMinDepth, s.attemptTop + ATTEMPT_END_MARGIN));
    if (d <= endAt) {
      const durationMs = t - s.repStart;
      if (!ratioOk) {
        events.push({ type: 'repCancelled', t, reason: 'rockedBack' });
      } else if (s.motion === 'down') {
        // Faster than minRepMs is a bounce or a tracking glitch, not a push-up: silently ignored.
        if (durationMs >= cfg.minRepMs) {
          s.count++;
          events.push({ type: 'rep', t, count: s.count, durationMs, peakDepth: s.peakDepth });
        }
      } else if (!s.livePartialSent) {
        events.push({ type: 'partial', t, peakDepth: s.peakDepth, live: false });
      }
      this.endAttempt();
      s.leftTopAt = t;
    }
  }

  private endAttempt(): void {
    const s = this.s;
    s.attemptStart = null;
    s.localTop = null; // re-measured from the next frame
    s.motion = 'up';
    s.bottomSince = null;
    s.stillAnchor = null;
  }

  /**
   * While resting still at the top, let the top references slowly follow the
   * user: they may settle into a slightly different plank than at calibration,
   * have calibrated with slightly bent arms, or shuffle closer/further between
   * reps. hTop is clamped near its calibrated value so it can never drift far;
   * the shoulder width at the top just tracks where the user now is
   * (otherwise a user who shuffled back 12 cm would have every later rep
   * rejected as "rocked back").
   */
  private adaptBaseline(t: number, dtMs: number, d: number): void {
    const s = this.s;
    const cfg = this.cfg;
    if (s.stillAnchor === null || Math.abs(d - s.stillAnchor) > STILL_BAND) {
      s.stillAnchor = d;
      s.stillSince = t;
      return;
    }
    if (cfg.baselineAdaptRate <= 0 || d >= ADAPT_MAX_DEPTH || t - s.stillSince < STILL_MS) return;
    if (s.hTop === null || s.hTopCalibrated === null) return;
    const rate = clamp(cfg.baselineAdaptRate, 0, 1);
    const alpha = 1 - Math.pow(1 - rate, dtMs / REFERENCE_FRAME_MS);
    const hNow = s.hTop * (1 - d); // smoothed h
    const lo = s.hTopCalibrated * (1 - cfg.baselineMaxDrift);
    const hi = s.hTopCalibrated * (1 + cfg.baselineMaxDrift);
    s.hTop = clamp(s.hTop + alpha * (hNow - s.hTop), lo, hi);
    if (s.swTop !== null && s.swEma !== null) s.swTop += alpha * (s.swEma - s.swTop);
  }

  /** "Lower your chest, not just your head": nose dips while the shoulders stay up. Never counts. */
  private checkHeadOnly(f: Features, t: number, d: number): void {
    const s = this.s;
    if (s.noseGapTop === null || !s.swTop || !f.nose || !f.shoulderMid) {
      s.headDropSince = null;
      return;
    }
    // Measured relative to the shoulders so slow drift of the whole body doesn't trigger it.
    const drop = (f.nose.y - f.shoulderMid.y - s.noseGapTop) / s.swTop;
    if (drop > this.cfg.headOnlyDropRatio && d < HEAD_DROP_MAX_DEPTH) {
      s.headDropSince ??= t;
      if (t - s.headDropSince >= HEAD_DROP_MS) s.chestHintUntil = t + HINT_LINGER_MS;
    } else {
      s.headDropSince = null;
    }
  }

  private enterPause(reason: PauseReason, t: number, events: CounterEvent[]): void {
    const s = this.s;
    if (s.attemptStart !== null) {
      // Never count a rep we couldn't fully see.
      events.push({ type: 'repCancelled', t, reason });
      this.endAttempt();
    }
    s.phase = 'paused';
    s.pauseReason = reason;
    s.resumeSince = null;
    s.outOfPlankSince = null;
    s.headDropSince = null;
    if (reason === 'lost') {
      // The old smoothing state is stale by the time the user is back.
      this.depthFilter.reset();
      s.lastRawAccepted = null;
      s.lastRawT = null;
      s.jumpHeldFrames = 0;
    }
    events.push({ type: 'paused', t, reason });
  }

  private stepPaused(
    t: number,
    gateHint: CounterHint | null,
    d: number | null,
    events: CounterEvent[],
  ): CounterHint | null {
    const s = this.s;
    const cfg = this.cfg;
    // The plank gate (shape and size in frame) plus the depth prove the user
    // is back in a plank. The shoulder-width ratio is deliberately NOT
    // required: someone who walked off and came back 40 cm further from the
    // phone has shoulders ~25 % smaller than at calibration, and demanding the
    // old ratio left them stuck on "back to plank" forever. The width
    // reference is re-anchored on resume instead (below). heightRatio is a
    // ratio of two image lengths, so it barely changes with distance.
    const inPlankRange = d !== null && d >= 1 - cfg.outOfPlankRatio;
    // After leaving the plank, also require being back near the top before resuming.
    const nearTop = s.pauseReason === 'lost' || (d !== null && Math.abs(d) < RESUME_MAX_DEPTH);
    const resumable = gateHint === null && inPlankRange && nearTop;

    if (resumable) {
      s.resumeSince ??= t;
      if (t - s.resumeSince >= cfg.resumeAfterMs) {
        s.phase = 'counting';
        s.pauseReason = null;
        s.motion = 'up';
        // Require a return to the top before the next rep can start, so a
        // user who comes back mid-push-up doesn't get a half rep counted.
        s.awaitingTop = true;
        s.leftTopAt = null;
        s.localTop = null;
        s.resumeSince = null;
        s.stillAnchor = null;
        // Measure "rocked back" against where the user is NOW, not where they
        // were before the pause (they may have come back closer or further).
        if (s.swEma !== null) s.swTop = s.swEma;
        events.push({ type: 'resumed', t });
        return null;
      }
    } else {
      s.resumeSince = null;
    }

    if (gateHint === 'getInFrame' || gateHint === 'handsInView' || gateHint === 'moveCloser' || gateHint === 'moveBack') {
      return gateHint;
    }
    return resumable ? null : 'backToPlank';
  }
}
