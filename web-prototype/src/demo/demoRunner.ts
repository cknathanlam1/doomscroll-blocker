/**
 * Plays the demo's simulated camera frames, in real time while the page is
 * visible, or one by one on request (step) for automated checks.
 *
 * It plays the role the camera + frame loop play in a real set: it only
 * hands frames to the app, which runs them through the same counter and
 * screens as camera frames.
 */
import type { PoseFrame } from '../core/types';

export interface DemoRunnerCallbacks {
  /** One simulated camera frame, in order. */
  onFrame(frame: PoseFrame): void;
  /** Called once, after the last frame. */
  onEnd(): void;
}

/**
 * After a hiccup (slow device, tab switch) catch up at most this many frames
 * per animation frame, then carry on from there instead of fast-forwarding.
 */
const MAX_FRAMES_PER_TICK = 4;

export class DemoRunner {
  private readonly frames: readonly PoseFrame[];
  private readonly callbacks: DemoRunnerCallbacks;
  private index = 0;
  /** Simulated time already played up to (ms, same clock as frame.t). */
  private clock: number;
  private lastTick = 0;
  private raf: number | null = null;
  private stopped = false;
  private ended = false;
  /** Inside tick(), and whether pause() was called from inside it (then no next tick is scheduled). */
  private inTick = false;
  private pausedInTick = false;

  constructor(frames: readonly PoseFrame[], callbacks: DemoRunnerCallbacks) {
    this.frames = frames;
    this.callbacks = callbacks;
    // Just before the first frame, so the first tick plays it.
    this.clock = (frames[0]?.t ?? 0) - 1;
  }

  /** Frames played so far. */
  get position(): number {
    return this.index;
  }

  get total(): number {
    return this.frames.length;
  }

  get playing(): boolean {
    return this.raf !== null;
  }

  /** Starts (or continues) real-time playback. Simulated time doesn't advance while paused. */
  play(): void {
    if (this.stopped || this.raf !== null || this.ended) return;
    this.lastTick = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.inTick) this.pausedInTick = true;
  }

  /** Ends playback for good (the set was left). Safe to call from inside onFrame. */
  stop(): void {
    this.pause();
    this.stopped = true;
  }

  /**
   * Plays the next `n` frames right now, synchronously, whatever the clock
   * says. Returns how many were played (fewer at the end of the demo).
   */
  step(n: number): number {
    let played = 0;
    const count = Math.max(0, Math.floor(n));
    while (played < count && this.next()) played++;
    return played;
  }

  /** requestAnimationFrame callback (an arrow function so `this` stays bound). */
  private readonly tick = (now: number): void => {
    this.raf = null;
    if (this.stopped) return;
    this.clock += Math.max(0, now - this.lastTick);
    this.lastTick = now;
    this.inTick = true;
    this.pausedInTick = false;
    try {
      let played = 0;
      while (played < MAX_FRAMES_PER_TICK && (this.frames[this.index]?.t ?? Infinity) <= this.clock) {
        if (!this.next()) return;
        played++;
      }
      // Fell behind: don't try to catch up the rest later (that would fast-forward).
      const upcoming = this.frames[this.index];
      if (played === MAX_FRAMES_PER_TICK && upcoming && upcoming.t <= this.clock) this.clock = upcoming.t - 1;
    } finally {
      // Schedule the next tick even if onFrame threw: one bad frame must not
      // end the demo for good. (Unless onFrame paused or restarted playback.)
      this.inTick = false;
      if (!this.stopped && !this.ended && !this.pausedInTick && this.raf === null) {
        this.raf = requestAnimationFrame(this.tick);
      }
    }
  };

  /** Plays one frame. False when there was nothing (more) to play. */
  private next(): boolean {
    if (this.stopped || this.ended) return false;
    const frame = this.frames[this.index];
    if (!frame) {
      this.ended = true;
      this.pause();
      this.callbacks.onEnd();
      return false;
    }
    this.index++;
    this.clock = Math.max(this.clock, frame.t);
    this.callbacks.onFrame(frame);
    if (this.index >= this.frames.length && !this.stopped) {
      this.ended = true;
      this.pause();
      this.callbacks.onEnd();
    }
    return !this.stopped;
  }
}
