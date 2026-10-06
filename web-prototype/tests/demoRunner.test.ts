/**
 * The demo player (src/demo/demoRunner.ts) with a fake requestAnimationFrame,
 * so real-time playback can be driven step by step in Node.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { DemoRunner } from '../src/demo/demoRunner';
import type { PoseFrame } from '../src/core/types';

let queue: { id: number; cb: FrameRequestCallback }[] = [];
let nextId = 1;
const g = globalThis as unknown as {
  requestAnimationFrame?: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
};
const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };

beforeEach(() => {
  queue = [];
  g.requestAnimationFrame = (cb) => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  g.cancelAnimationFrame = (id) => {
    queue = queue.filter((q) => q.id !== id);
  };
});

afterEach(() => {
  g.requestAnimationFrame = saved.raf;
  g.cancelAnimationFrame = saved.caf;
});

/** Runs the pending animation frames once, at time `now`. */
function animationFrame(now: number): void {
  const due = queue;
  queue = [];
  for (const q of due) q.cb(now);
}

const frames: PoseFrame[] = Array.from({ length: 10 }, (_, i) => ({ t: i * 100, aspect: 0.75, joints: null }));

describe('DemoRunner', () => {
  test('plays frames in real time from the animation-frame clock', () => {
    const played: number[] = [];
    const runner = new DemoRunner(frames, { onFrame: (f) => played.push(f.t), onEnd: () => {} });
    runner.play();
    const start = performance.now();
    animationFrame(start + 150);
    expect(played).toEqual([0, 100]);
  });

  test('an error in one frame does not stop the demo for good', () => {
    // Regression: the exception escaped tick() before the next animation
    // frame was requested, so playback silently stopped forever.
    const played: number[] = [];
    let ended = false;
    const runner = new DemoRunner(frames, {
      onFrame: (f) => {
        played.push(f.t);
        if (f.t === 200) throw new Error('UI bug');
      },
      onEnd: () => {
        ended = true;
      },
    });
    runner.play();
    const start = performance.now();
    expect(() => animationFrame(start + 250)).toThrow('UI bug');
    expect(runner.playing).toBe(true);
    for (let i = 1; i <= 10 && !ended; i++) animationFrame(start + 250 + i * 300);
    expect(played).toEqual(frames.map((f) => f.t));
    expect(ended).toBe(true);
  });

  test('pause() from inside a frame is respected', () => {
    let runner: DemoRunner | null = null;
    const played: number[] = [];
    runner = new DemoRunner(frames, {
      onFrame: (f) => {
        played.push(f.t);
        if (f.t === 100) runner?.pause();
      },
      onEnd: () => {},
    });
    runner.play();
    animationFrame(performance.now() + 150);
    expect(runner.playing).toBe(false);
    expect(queue).toHaveLength(0);
  });
});
