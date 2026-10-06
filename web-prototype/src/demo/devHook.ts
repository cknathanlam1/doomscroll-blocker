/**
 * Dev-server-only test hook for the demo: `window.__demo`.
 *
 * Automated checks (and you, from the browser console) can run the whole
 * demo frame by frame without waiting for animation frames, which a hidden
 * or background browser tab doesn't deliver:
 *
 *   __demo.start()        // like tapping "Watch a demo"
 *   __demo.step(300)      // play the next 300 simulated frames (10 s) right now
 *   __demo.state()        // { screen: 'stage', phase: 'counting', count: 3, … }
 *
 * Stepping switches the demo to manual: it stops playing by itself until the
 * next start. Never installed in a production build.
 */
import type { CounterHint, CounterPhase, TrackingIssue } from '../core/types';

/** A snapshot of where the app and the demo are. */
export interface DemoState {
  /** Which screen is showing: 'start' | 'stage' | 'success' | 'gaveup' | 'camerror'. */
  screen: string;
  /** On the camera stage: 'placement' or 'challenge' (null elsewhere). */
  layer: string | null;
  phase: CounterPhase | null;
  count: number;
  target: number;
  hint: CounterHint | null;
  issue: TrackingIssue;
  /** Where the depth line is (image heights), null before calibration. */
  depthLineY: number | null;
  /** Frames played / total, or null when no demo is loaded. */
  frame: number | null;
  frames: number | null;
}

export interface DemoHook {
  /** Starts a fresh demo set (manual: it waits for step()). */
  start(): DemoState;
  /** Plays the next n frames synchronously (default 1) and renders them. */
  step(n?: number): DemoState;
  state(): DemoState;
}

type HookWindow = Window & { __demo?: DemoHook };

export function installDemoHook(hook: DemoHook): void {
  (window as HookWindow).__demo = hook;
}
