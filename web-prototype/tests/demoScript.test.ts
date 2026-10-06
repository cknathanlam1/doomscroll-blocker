/**
 * "Watch a demo" runs a scripted, simulated person through the REAL counter.
 * These tests check that the script still tells its whole story with the
 * app's own settings (if a counter change breaks the demo, this fails rather
 * than the demo quietly getting stuck on screen), and that the simulated
 * person stays inside the part of the picture a phone actually shows.
 */
import { describe, expect, it } from 'vitest';
import { RepCounter } from '../src/core/repCounter';
import { TrackingIssueDetector } from '../src/core/trackingIssue';
import type { CounterEvent, PoseFrame, TrackingIssue } from '../src/core/types';
import { buildDemoSession, DEMO_START_T, demoSegments } from '../src/demo/demoScript';
import { fitRect } from '../src/ui/overlay';
import { counterConfigFor, DEFAULT_SETTINGS, tuningFor } from '../src/ui/settings';

/** The App waits this long after 'complete' before showing Success (App.SUCCESS_DELAY_MS). */
const SUCCESS_DELAY_MS = 600;

interface DemoRun {
  events: CounterEvent[];
  issues: TrackingIssue[];
  frames: PoseFrame[];
  finalCount: number;
}

/** Plays the demo the way App does: counter with the default settings, then the tracking-issue detector. */
function playDemo(target: number, wholeFrameVisible: boolean): DemoRun {
  const settings = { ...DEFAULT_SETTINGS, reps: target };
  const counter = new RepCounter(counterConfigFor(settings, tuningFor(settings.depth)));
  const tracking = new TrackingIssueDetector();
  const session = buildDemoSession(target, { wholeFrameVisible });
  const events: CounterEvent[] = [];
  const issues: TrackingIssue[] = [];
  let finalCount = 0;
  for (const frame of session.frames) {
    const snap = counter.update(frame);
    events.push(...snap.events);
    finalCount = snap.count;
    issues.push(
      tracking.update({
        t: frame.t,
        present: snap.features.present,
        inFrame: snap.inFrame,
        shoulderConfidence: snap.features.shoulderConfidence,
        luminance: null, // the demo's fake picture has no brightness
      }),
    );
  }
  return { events, issues, frames: session.frames, finalCount };
}

/** Index of the first event of this type at or after `from` (-1 if none). */
function indexOf(events: CounterEvent[], type: CounterEvent['type'], from = 0): number {
  for (let i = from; i < events.length; i++) if (events[i]?.type === type) return i;
  return -1;
}

describe('demo script', () => {
  for (const target of [5, 10, 30]) {
    for (const wholeFrameVisible of [true, false]) {
      const layout = wholeFrameVisible ? 'laptop (whole picture)' : 'phone (cropped picture)';

      it(`tells the whole story for ${target} reps, ${layout}`, () => {
        const { events, issues, frames, finalCount } = playDemo(target, wholeFrameVisible);
        const reps = events.filter((e) => e.type === 'rep');

        // Exactly the target: the shallow rep must never count.
        expect(finalCount).toBe(target);
        expect(reps).toHaveLength(target);

        // start → 3 good reps → shallow rep → out of view (paused) → back → more reps → complete.
        const start = indexOf(events, 'start');
        expect(start).toBeGreaterThanOrEqual(0);
        const partial = indexOf(events, 'partial', start);
        expect(partial).toBeGreaterThan(start);
        expect(events.slice(start, partial).filter((e) => e.type === 'rep')).toHaveLength(3);
        const paused = indexOf(events, 'paused', partial);
        expect(paused).toBeGreaterThan(partial);
        const pausedEvent = events[paused];
        expect(pausedEvent?.type === 'paused' && pausedEvent.reason).toBe('lost');
        const resumed = indexOf(events, 'resumed', paused);
        expect(resumed).toBeGreaterThan(paused);
        expect(events.slice(partial, resumed).filter((e) => e.type === 'rep')).toHaveLength(0);
        const complete = indexOf(events, 'complete', resumed);
        expect(complete).toBeGreaterThan(resumed);

        // The App shows Success by frame time SUCCESS_DELAY_MS after 'complete' (that's what
        // the dev hook's step() relies on), so frames must keep coming that long.
        const completeEvent = events[complete];
        const lastT = frames[frames.length - 1]?.t ?? 0;
        expect(completeEvent?.type).toBe('complete');
        expect(lastT - (completeEvent?.t ?? Infinity)).toBeGreaterThanOrEqual(SUCCESS_DELAY_MS);

        // The fake picture is never "too dark", and tracking is fine at the end.
        expect(issues).not.toContain('tooDark');
        expect(issues[issues.length - 1]).toBe('none');
      });
    }
  }

  it('also completes for targets below the partial-rep part (1–3 reps)', () => {
    for (const target of [1, 2, 3]) {
      const { events, finalCount } = playDemo(target, true);
      expect(finalCount).toBe(target);
      expect(events.some((e) => e.type === 'complete')).toBe(true);
      // Too few reps for the shallow-rep and walk-away part of the story.
      expect(demoSegments(target).some((s) => s.kind === 'rep' && s.spec.minElbowDeg > 100)).toBe(false);
    }
  });

  it('starts its clock at DEMO_START_T and is the same every time', () => {
    const a = buildDemoSession(10, { wholeFrameVisible: true });
    const b = buildDemoSession(10, { wholeFrameVisible: true });
    expect(a.frames[0]?.t).toBe(DEMO_START_T);
    expect(b.frames).toEqual(a.frames);
  });

  it('keeps the person inside the visible picture', () => {
    // Laptop: the whole picture shows (object-fit: contain).
    // Phone: object-fit: cover on a tall screen crops the sides. 390×844 (iPhone 12–15)
    // is about the narrowest screen shape there is, so it crops the most.
    const screens = [
      { wholeFrameVisible: true, w: 1280, h: 800, mode: 'contain' as const },
      { wholeFrameVisible: false, w: 390, h: 844, mode: 'cover' as const },
    ];
    for (const screen of screens) {
      const session = buildDemoSession(10, { wholeFrameVisible: screen.wholeFrameVisible });
      const { imageW, imageH } = session.geometry;
      const r = fitRect(imageW, imageH, screen.w, screen.h, screen.mode);
      // Visible part of the picture, as fractions of its width/height.
      const x0 = Math.max(0, -r.x / r.w);
      const x1 = Math.min(1, (screen.w - r.x) / r.w);
      for (const frame of session.frames) {
        if (!frame.joints) continue;
        for (const j of Object.values(frame.joints)) {
          if (!j || j.c < 0.5) continue;
          const fx = j.x / frame.aspect;
          expect(fx).toBeGreaterThanOrEqual(x0);
          expect(fx).toBeLessThanOrEqual(x1);
          expect(j.y).toBeGreaterThanOrEqual(0);
          expect(j.y).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
