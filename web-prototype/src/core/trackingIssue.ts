import type { TrackingIssue } from './types';

export interface TrackingIssueInput {
  t: number;
  /** A person was detected in this frame. */
  present: boolean;
  /** Debounced in-frame state from the counter. */
  inFrame: boolean;
  /** Minimum shoulder confidence this frame (0 if absent). */
  shoulderConfidence: number;
  /** Mean frame luminance 0..255, or null if not measured recently. */
  luminance: number | null;
}

export interface TrackingIssueOptions {
  /** Luminance below which the scene is always "too dark" (enter threshold). */
  darkEnter: number;
  /** Luminance above which hard "too dark" clears (exit threshold, > darkEnter). */
  darkExit: number;
  /**
   * Dim-but-not-black: luminance below this AND a low-confidence pattern over
   * the window (pose found in < minPoseRate of frames, or median shoulder
   * confidence < minMedianConfidence) also means "too dark". iOS auto-exposure
   * can make a dim room look fine by luminance while confidence collapses.
   */
  dimLuminance: number;
  windowMs: number;
  minPoseRate: number;
  minMedianConfidence: number;
  /** An issue must persist this long before it is reported (and clear for this long before it goes away). */
  debounceMs: number;
}

export const DEFAULT_TRACKING_ISSUE_OPTIONS: TrackingIssueOptions = {
  darkEnter: 35,
  darkExit: 50,
  dimLuminance: 70,
  windowMs: 2000,
  minPoseRate: 0.6,
  minMedianConfidence: 0.6,
  debounceMs: 700,
};

interface WindowSample {
  t: number;
  present: boolean;
  shoulderConfidence: number;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length === 0) return 0;
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/**
 * Decides which "something's off" state to show (spec S2 vs S3), with
 * hysteresis and debouncing so the UI doesn't flicker. Pure.
 * - tooDark: luminance rules above (wins over notDetected when both apply).
 * - notDetected: the user is not in frame (inFrame false) and it is not dark.
 * - none: otherwise.
 */
export class TrackingIssueDetector {
  private readonly opts: TrackingIssueOptions;
  private samples: WindowSample[] = [];
  /** Hard "too dark" state; uses two thresholds so it doesn't flicker around one value. */
  private hardDark = false;
  private reported: TrackingIssue = 'none';
  /** A different issue that is waiting out the debounce, and since when. */
  private candidate: TrackingIssue | null = null;
  private candidateSince = 0;

  constructor(options?: Partial<TrackingIssueOptions>) {
    this.opts = { ...DEFAULT_TRACKING_ISSUE_OPTIONS, ...options };
  }

  update(input: TrackingIssueInput): TrackingIssue {
    const o = this.opts;
    const t = input.t;

    // Keep only the last windowMs of frames for the low-confidence pattern.
    this.samples.push({ t, present: input.present, shoulderConfidence: input.present ? input.shoulderConfidence : 0 });
    while (this.samples.length > 0 && (this.samples[0]?.t ?? t) < t - o.windowMs) this.samples.shift();

    const lum = input.luminance;
    if (lum === null) {
      // Without a recent luminance reading we never claim it is dark.
      this.hardDark = false;
    } else if (this.hardDark) {
      if (lum > o.darkExit) this.hardDark = false;
    } else if (lum < o.darkEnter) {
      this.hardDark = true;
    }

    let dim = false;
    const first = this.samples[0];
    // Only judge the pattern once we have at least half a window of history,
    // otherwise one missed frame right after start-up would look like a 0% pose rate.
    if (lum !== null && lum < o.dimLuminance && first && t - first.t >= o.windowMs / 2) {
      const poseRate = this.samples.filter((s) => s.present).length / this.samples.length;
      const medianConfidence = median(this.samples.map((s) => s.shoulderConfidence));
      dim = poseRate < o.minPoseRate || medianConfidence < o.minMedianConfidence;
    }

    const raw: TrackingIssue = this.hardDark || dim ? 'tooDark' : input.inFrame ? 'none' : 'notDetected';

    // Debounce: a change is only reported once it has held for debounceMs.
    if (raw === this.reported) {
      this.candidate = null;
    } else if (raw !== this.candidate) {
      this.candidate = raw;
      this.candidateSince = t;
    }
    if (this.candidate !== null && t - this.candidateSince >= o.debounceMs) {
      this.reported = this.candidate;
      this.candidate = null;
    }
    return this.reported;
  }

  reset(): void {
    this.samples = [];
    this.hardDark = false;
    this.reported = 'none';
    this.candidate = null;
    this.candidateSince = 0;
  }
}
