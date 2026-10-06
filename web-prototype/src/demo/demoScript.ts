/**
 * "Watch a demo": the scripted person.
 *
 * A simulated push-up set (src/sim/pushupSimulator.ts projects a 3D body
 * through a camera on the floor) that shows every state of the Challenge
 * screen in about 35 seconds (10 reps):
 *   hold a plank → 3-2-1 → 3 good reps → 1 shallow rep ("Go lower", "Didn't
 *   count") → walk out of view ("Can't see you", paused) → come back →
 *   good reps up to the target → Success.
 *
 * The frames go through the REAL RepCounter, so if the counter changes, the
 * demo changes with it (it is a live check, not a recording).
 */
import { simulateSession, type RepSpec, type Segment, type SimResult } from '../sim/pushupSimulator';

/** The simulated camera delivers this many frames per second. */
export const DEMO_FPS = 30;

/**
 * Simulated clock of the first frame (ms). Not 0: the UI keeps a few "until"
 * timestamps that start at 0 meaning "never", and the demo uses this clock as
 * its "now".
 */
export const DEMO_START_T = 1000;

/** How many good reps happen before the shallow one. */
const REPS_BEFORE_PARTIAL = 3;

/** A good, deep rep (elbows to ~75°). Tempo varies a little so it doesn't look robotic. */
function fullRep(i: number): RepSpec {
  return { minElbowDeg: 75, downMs: 700 + (i % 3) * 60, bottomHoldMs: 120, upMs: 650 + (i % 2) * 80, topRestMs: 450 };
}

/**
 * The shallow rep: elbows only reach ~120°. The long rest afterwards keeps
 * the 1.5 s "Go lower" cue on screen before the next thing happens.
 */
const PARTIAL_REP: RepSpec = { minElbowDeg: 120, downMs: 600, bottomHoldMs: 150, upMs: 600, topRestMs: 1300 };

/** The demo's segments for a set of `targetReps` (any target ≥ 1 works). */
export function demoSegments(targetReps: number): Segment[] {
  const target = Math.max(1, Math.round(targetReps));
  const before = Math.min(REPS_BEFORE_PARTIAL, target);
  const after = target - before;
  const segments: Segment[] = [
    // Not in view yet: the placement screen asks to get in frame.
    { kind: 'absent', ms: 1200 },
    // Long enough for the counter to see a steady plank (0.6 s) and run the 3-2-1 (3 s).
    { kind: 'hold', ms: 4500 },
  ];
  for (let i = 0; i < before; i++) segments.push({ kind: 'rep', spec: fullRep(i) });
  if (after > 0) {
    segments.push(
      { kind: 'rep', spec: PARTIAL_REP },
      // Out of view: the set pauses ("Can't see you") but keeps the count.
      { kind: 'absent', ms: 1500 },
      // Back in a plank: the counter resumes after it sees the plank again.
      { kind: 'hold', ms: 1300 },
    );
    for (let i = 0; i < after; i++) segments.push({ kind: 'rep', spec: fullRep(before + i) });
  }
  // Stay in the plank after the last rep so frames keep coming while the
  // Success screen's short delay runs out (see App: success by frame time).
  segments.push({ kind: 'hold', ms: 2500 });
  return segments;
}

/**
 * The simulated set: frames plus the camera geometry (geometry.imageW/H is
 * the picture size, 480x640 portrait like a phone's front camera).
 */
export type DemoSession = SimResult;

export interface DemoOptions {
  /**
   * The whole camera picture is on screen (laptop layout, object-fit:
   * contain). Phones crop the sides of the picture (cover), so there the
   * simulated person stands further back to keep their elbows on screen.
   */
  wholeFrameVisible: boolean;
}

/**
 * Builds the whole demo up front (~1,000 frames for 10 reps; a few ms).
 * A little landmark noise makes the figure wobble like real tracking does.
 */
export function buildDemoSession(targetReps: number, options: DemoOptions = { wholeFrameVisible: false }): DemoSession {
  return simulateSession(demoSegments(targetReps), {
    fps: DEMO_FPS,
    startT: DEMO_START_T,
    noisePx: 1,
    seed: 7,
    // Head-to-camera distance (m). The simulator's default is 0.9 (3 ft).
    geometry: { headDistance: options.wholeFrameVisible ? 1.0 : 1.3 },
  });
}
