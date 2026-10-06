/**
 * Unit tests for TrackingIssueDetector (src/core/trackingIssue.ts): which
 * "something's off" screen to show — S2 "Can't see you" (notDetected) or S3
 * "Too dark" (tooDark) — without flickering.
 *
 * Defaults: darkEnter 35, darkExit 50, dimLuminance 70, windowMs 2000,
 * minPoseRate 0.6, minMedianConfidence 0.6, debounceMs 700.
 */
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_TRACKING_ISSUE_OPTIONS,
  TrackingIssueDetector,
  type TrackingIssueInput,
} from '../src/core/trackingIssue';
import type { TrackingIssue } from '../src/core/types';

const FRAME_MS = 1000 / 30;
const DEBOUNCE = DEFAULT_TRACKING_ISSUE_OPTIONS.debounceMs;

/** A well-lit user, in frame. */
const GOOD: Omit<TrackingIssueInput, 't'> = { present: true, inFrame: true, shoulderConfidence: 0.95, luminance: 120 };

interface Sample {
  t: number;
  issue: TrackingIssue;
}

/**
 * Feeds 30 fps frames from `from` (inclusive) to `to` (exclusive). `input`
 * may be a function of the frame index for patterns (e.g. pose found in 40 %
 * of frames).
 */
function feed(
  det: TrackingIssueDetector,
  from: number,
  to: number,
  input: Omit<TrackingIssueInput, 't'> | ((i: number) => Omit<TrackingIssueInput, 't'>),
): Sample[] {
  const out: Sample[] = [];
  for (let i = 0, t = from; t < to - 1e-9; i++, t = from + i * FRAME_MS) {
    const inp = typeof input === 'function' ? input(i) : input;
    out.push({ t, issue: det.update({ ...inp, t }) });
  }
  return out;
}

const last = (samples: Sample[]): TrackingIssue => samples[samples.length - 1]?.issue ?? 'none';
/** First time `issue` was reported, or null. */
const firstTime = (samples: Sample[], issue: TrackingIssue): number | null => samples.find((s) => s.issue === issue)?.t ?? null;
const distinct = (samples: Sample[]): TrackingIssue[] => [...new Set(samples.map((s) => s.issue))];

describe('TrackingIssueDetector', () => {
  test('a well-lit user in frame never gets an issue', () => {
    const det = new TrackingIssueDetector();
    expect(distinct(feed(det, 0, 10000, GOOD))).toEqual(['none']);
  });

  test('notDetected: reported only after the debounce, and cleared only after the debounce', () => {
    const det = new TrackingIssueDetector();
    feed(det, 0, 2000, GOOD);
    const gone = feed(det, 2000, 4000, { ...GOOD, present: false, inFrame: false, shoulderConfidence: 0 });
    const t = firstTime(gone, 'notDetected');
    expect(t).not.toBeNull();
    expect((t as number) - 2000).toBeGreaterThanOrEqual(DEBOUNCE);
    expect((t as number) - 2000).toBeLessThan(DEBOUNCE + 2 * FRAME_MS);
    expect(last(gone)).toBe('notDetected');

    const back = feed(det, 4000, 6000, GOOD);
    const tBack = firstTime(back, 'none');
    expect((tBack as number) - 4000).toBeGreaterThanOrEqual(DEBOUNCE);
    expect((tBack as number) - 4000).toBeLessThan(DEBOUNCE + 2 * FRAME_MS);
  });

  test('debounce: blips shorter than debounceMs never change the reported issue (either direction)', () => {
    const det = new TrackingIssueDetector();
    feed(det, 0, 2000, GOOD);
    // 0.5 s of "not in frame" and 0.5 s of black: both too short.
    expect(distinct(feed(det, 2000, 2500, { ...GOOD, inFrame: false }))).toEqual(['none']);
    expect(distinct(feed(det, 2500, 3000, GOOD))).toEqual(['none']);
    expect(distinct(feed(det, 3000, 3500, { ...GOOD, luminance: 10 }))).toEqual(['none']);
    expect(distinct(feed(det, 3500, 5000, GOOD))).toEqual(['none']);

    // Now really dark; a 0.5 s bright flash must not clear it.
    expect(last(feed(det, 5000, 7000, { ...GOOD, present: false, inFrame: false, luminance: 10 }))).toBe('tooDark');
    expect(distinct(feed(det, 7000, 7500, { ...GOOD, present: false, inFrame: false, luminance: 120 }))).toEqual(['tooDark']);
    expect(last(feed(det, 7500, 9000, { ...GOOD, present: false, inFrame: false, luminance: 10 }))).toBe('tooDark');
  });

  test('a candidate that keeps changing restarts the debounce', () => {
    const det = new TrackingIssueDetector();
    feed(det, 0, 2000, GOOD);
    // 0.4 s notDetected then tooDark: 0.8 s in total, but neither held 0.7 s
    // until the second one alone has.
    const a = feed(det, 2000, 2400, { ...GOOD, inFrame: false });
    const b = feed(det, 2400, 4000, { ...GOOD, inFrame: false, luminance: 10 });
    expect(distinct(a)).toEqual(['none']);
    expect(firstTime(b, 'notDetected')).toBeNull();
    expect((firstTime(b, 'tooDark') as number) - 2400).toBeGreaterThanOrEqual(DEBOUNCE);
  });

  test('hard dark uses hysteresis: enter below 35, stay until above 50', () => {
    const det = new TrackingIssueDetector();
    feed(det, 0, 2000, GOOD);
    // 45 is between the thresholds: from bright it never ENTERS "too dark".
    expect(distinct(feed(det, 2000, 6000, { ...GOOD, luminance: 45 }))).toEqual(['none']);
    // Below 35 → too dark.
    expect(last(feed(det, 6000, 8000, { ...GOOD, luminance: 30 }))).toBe('tooDark');
    // Back to 45: still too dark (does not flicker around one threshold).
    expect(distinct(feed(det, 8000, 12000, { ...GOOD, luminance: 45 }))).toEqual(['tooDark']);
    // Exactly 50 is not "above" the exit threshold.
    expect(distinct(feed(det, 12000, 14000, { ...GOOD, luminance: 50 }))).toEqual(['tooDark']);
    // Above 50 → clears (after the debounce).
    const cleared = feed(det, 14000, 16000, { ...GOOD, luminance: 55 });
    expect(last(cleared)).toBe('none');
    expect((firstTime(cleared, 'none') as number) - 14000).toBeGreaterThanOrEqual(DEBOUNCE);
  });

  test('a luminance oscillating around 35–50 does not flicker', () => {
    const det = new TrackingIssueDetector();
    feed(det, 0, 2000, GOOD);
    feed(det, 2000, 4000, { ...GOOD, luminance: 20 });
    const wobble = feed(det, 4000, 14000, (i) => ({ ...GOOD, luminance: 42 + 7 * Math.sin(i / 3) }));
    expect(distinct(wobble)).toEqual(['tooDark']);
  });

  describe('dim rule (luminance < 70 AND a low-confidence pattern over the 2 s window)', () => {
    test('pose found in only 40 % of frames in a dim room → tooDark', () => {
      const det = new TrackingIssueDetector();
      feed(det, 0, 2000, GOOD);
      const dim = feed(det, 2000, 6000, (i) => {
        const present = i % 5 < 2;
        return { present, inFrame: false, shoulderConfidence: present ? 0.9 : 0, luminance: 60 };
      });
      expect(last(dim)).toBe('tooDark');
    });

    test('pose found every frame but with median shoulder confidence 0.4 → tooDark', () => {
      const det = new TrackingIssueDetector();
      feed(det, 0, 2000, GOOD);
      expect(last(feed(det, 2000, 6000, { present: true, inFrame: false, shoulderConfidence: 0.4, luminance: 60 }))).toBe('tooDark');
    });

    test('the same dim room with confident tracking is fine', () => {
      const det = new TrackingIssueDetector();
      expect(distinct(feed(det, 0, 6000, { ...GOOD, luminance: 60 }))).toEqual(['none']);
    });

    test('the same low-confidence pattern in a BRIGHT room is "not detected", not "too dark"', () => {
      const det = new TrackingIssueDetector();
      feed(det, 0, 2000, GOOD);
      const bright = feed(det, 2000, 6000, (i) => {
        const present = i % 5 < 2;
        return { present, inFrame: false, shoulderConfidence: present ? 0.4 : 0, luminance: 80 };
      });
      expect(firstTime(bright, 'tooDark')).toBeNull();
      expect(last(bright)).toBe('notDetected');
    });

    test('needs half a window of history first (one missed frame at start-up is not 0 % pose rate)', () => {
      const det = new TrackingIssueDetector({ debounceMs: 0 });
      const start = feed(det, 0, 2000, { present: false, inFrame: true, shoulderConfidence: 0, luminance: 60 });
      // Not judged before 1 s of history, judged after.
      expect(start.filter((s) => s.t < 1000 - 1e-6).every((s) => s.issue === 'none')).toBe(true);
      expect(last(start)).toBe('tooDark');
    });

    test('only the last windowMs counts: good frames push old bad ones out', () => {
      const det = new TrackingIssueDetector();
      feed(det, 0, 3000, { present: true, inFrame: false, shoulderConfidence: 0.3, luminance: 60 });
      // Dim but now tracking well; after > 2 s the bad frames have left the window.
      const recovered = feed(det, 3000, 7000, { present: true, inFrame: true, shoulderConfidence: 0.95, luminance: 60 });
      expect(last(recovered)).toBe('none');
    });
  });

  test('priority: when it is dark AND nobody is detected, the answer is tooDark', () => {
    const det = new TrackingIssueDetector();
    const s = feed(det, 0, 4000, { present: false, inFrame: false, shoulderConfidence: 0, luminance: 10 });
    expect(firstTime(s, 'notDetected')).toBeNull();
    expect(last(s)).toBe('tooDark');
  });

  test('without a luminance reading it never claims "too dark"', () => {
    const det = new TrackingIssueDetector();
    const s = feed(det, 0, 6000, { present: false, inFrame: false, shoulderConfidence: 0, luminance: null });
    expect(distinct(s)).toEqual(['none', 'notDetected']);
    // A missing reading also drops an existing hard-dark state.
    const det2 = new TrackingIssueDetector();
    feed(det2, 0, 2000, { ...GOOD, luminance: 10 });
    expect(last(feed(det2, 2000, 4000, { ...GOOD, luminance: null }))).toBe('none');
  });

  test('options can be overridden', () => {
    const det = new TrackingIssueDetector({ darkEnter: 60, darkExit: 80, debounceMs: 100 });
    const s = feed(det, 0, 1000, { ...GOOD, luminance: 55 });
    expect(last(s)).toBe('tooDark');
    expect(firstTime(s, 'tooDark') as number).toBeLessThan(200);
  });

  test('reset() forgets everything', () => {
    const det = new TrackingIssueDetector();
    feed(det, 0, 3000, { ...GOOD, present: false, inFrame: false, luminance: 10 });
    det.reset();
    // Luminance 45 would keep an old hard-dark state; after reset it is fine.
    expect(det.update({ ...GOOD, t: 3100, luminance: 45 })).toBe('none');
    expect(distinct(feed(det, 3133, 6000, { ...GOOD, luminance: 45 }))).toEqual(['none']);
  });
});
