/**
 * The body figure drawn over the camera (src/ui/figure.ts), how the picture
 * is fitted to the screen (fitRect), and the overlay redrawing itself after
 * a resize (a resized canvas is wiped by the browser).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoseFrame } from '../src/core/types';
import type { RawLandmark } from '../src/platform/mediapipeMapping';
import { figureFromLandmarks, figureFromPoseFrame, shoulderMid, type Figure } from '../src/ui/figure';
import { fitRect, SkeletonOverlay, type DrawOptions } from '../src/ui/overlay';

/** MediaPipe face points used for the head. */
const NOSE = 0;
const LEFT_EYE = 2;
const RIGHT_EYE = 5;
const LEFT_EAR = 7;
const RIGHT_EAR = 8;

/**
 * 33 landmarks (normalized 0..1) for a person facing a 4:3 portrait camera:
 * shoulders 0.2 apart (in image widths), ears 0.14 apart, eyes 0.06 apart.
 * (The head is nearer the camera than the shoulders, so it looks big; and
 * wide enough here that the ear and eye sizes beat the shoulder minimum.)
 */
function landmarks(overrides: Record<number, Partial<RawLandmark>> = {}): RawLandmark[] {
  const lm: RawLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  const set = (i: number, x: number, y: number): void => {
    lm[i] = { x, y, z: 0, visibility: 0.9 };
  };
  set(NOSE, 0.5, 0.3);
  set(LEFT_EYE, 0.53, 0.28);
  set(RIGHT_EYE, 0.47, 0.28);
  set(LEFT_EAR, 0.57, 0.29);
  set(RIGHT_EAR, 0.43, 0.29);
  set(11, 0.6, 0.45); // left shoulder
  set(12, 0.4, 0.45); // right shoulder
  set(13, 0.66, 0.6);
  set(14, 0.34, 0.6);
  set(15, 0.68, 0.75);
  set(16, 0.32, 0.75);
  set(23, 0.58, 0.9);
  set(24, 0.42, 0.9);
  for (const [i, o] of Object.entries(overrides)) {
    const base = lm[Number(i)];
    if (base) lm[Number(i)] = { ...base, ...o };
  }
  return lm;
}

const ASPECT = 0.75; // 480×640 portrait
const SW = 0.2 * ASPECT; // shoulder width in image heights

describe('figureFromLandmarks', () => {
  it('converts x to image heights (x · aspect) and keeps y', () => {
    const fig = figureFromLandmarks(landmarks(), ASPECT);
    expect(fig.aspect).toBe(ASPECT);
    expect(fig.joints.leftShoulder?.x).toBeCloseTo(0.6 * ASPECT, 9);
    expect(fig.joints.leftShoulder?.y).toBeCloseTo(0.45, 9);
    expect(fig.joints.leftShoulder?.c).toBeCloseTo(0.9, 9);
  });

  it('puts the head on the ear midpoint when both ears are confident', () => {
    const fig = figureFromLandmarks(landmarks(), ASPECT);
    expect(fig.head?.x).toBeCloseTo(0.5 * ASPECT, 9);
    expect(fig.head?.y).toBeCloseTo(0.29, 9);
    // 0.55 × ear distance (bigger than the 0.28 × shoulder-width minimum here)
    expect(0.55 * 0.14 * ASPECT).toBeGreaterThan(0.28 * SW);
    expect(fig.head?.r).toBeCloseTo(0.55 * 0.14 * ASPECT, 9);
  });

  it('never makes the head smaller than 0.28 × shoulder width', () => {
    const fig = figureFromLandmarks(landmarks({ [LEFT_EAR]: { x: 0.51 }, [RIGHT_EAR]: { x: 0.49 } }), ASPECT);
    expect(fig.head?.r).toBeCloseTo(0.28 * SW, 9);
  });

  it('falls back to the eyes when an ear is unsure, then to the nose', () => {
    const eyes = figureFromLandmarks(landmarks({ [LEFT_EAR]: { visibility: 0.2 } }), ASPECT);
    expect(eyes.head?.y).toBeCloseTo(0.28, 9);
    expect(1.3 * 0.06 * ASPECT).toBeGreaterThan(0.28 * SW);
    expect(eyes.head?.r).toBeCloseTo(1.3 * 0.06 * ASPECT, 9);

    const nose = figureFromLandmarks(
      landmarks({ [LEFT_EAR]: { visibility: 0.2 }, [RIGHT_EYE]: { visibility: 0.1 } }),
      ASPECT,
    );
    expect(nose.head?.y).toBeCloseTo(0.3, 9);
    expect(nose.head?.r).toBeCloseTo(0.28 * SW, 9);
  });

  it('gives points outside the picture confidence 0, and treats a missing visibility as seen', () => {
    const fig = figureFromLandmarks(landmarks({ 15: { x: 1.2 }, 16: { visibility: Number.NaN } }), ASPECT);
    expect(fig.joints.leftWrist?.c).toBe(0);
    expect(fig.joints.rightWrist?.c).toBe(1);
  });

  it('skips non-finite points and survives a bad aspect', () => {
    const fig = figureFromLandmarks(landmarks({ 13: { x: Number.NaN } }), 0);
    expect(fig.joints.leftElbow).toBeUndefined();
    expect(fig.aspect).toBe(1);
  });
});

describe('figureFromPoseFrame', () => {
  const frame: PoseFrame = {
    t: 0,
    aspect: ASPECT,
    joints: {
      nose: { x: 0.375, y: 0.3, c: 0.9 },
      leftShoulder: { x: 0.45, y: 0.45, c: 0.9 },
      rightShoulder: { x: 0.3, y: 0.45, c: 0.8 },
      leftWrist: { x: Number.NaN, y: 0.7, c: 0.9 },
    },
  };

  it('returns null when nobody is in the frame', () => {
    expect(figureFromPoseFrame({ t: 0, aspect: ASPECT, joints: null })).toBeNull();
  });

  it('sizes the head from the shoulders (no ears in a PoseFrame) and skips bad joints', () => {
    const fig = figureFromPoseFrame(frame);
    expect(fig?.head).toMatchObject({ x: 0.375, y: 0.3, c: 0.9 });
    expect(fig?.head?.r).toBeCloseTo(0.28 * 0.15, 9);
    expect(fig?.joints.leftWrist).toBeUndefined();
  });

  it('shoulderMid is the midpoint, with the weaker confidence', () => {
    const fig = figureFromPoseFrame(frame);
    expect(fig && shoulderMid(fig)).toEqual({ x: 0.375, y: 0.45, c: 0.8 });
    expect(shoulderMid({ aspect: 1, joints: {}, head: null })).toBeNull();
  });
});

describe('fitRect', () => {
  it('contain: the whole 480×640 picture fits a 1280×800 laptop screen, bars left and right', () => {
    expect(fitRect(480, 640, 1280, 800, 'contain')).toEqual({ x: 340, y: 0, w: 600, h: 800 });
  });

  it('cover: a 390×844 phone screen is filled and the sides are cropped', () => {
    const r = fitRect(480, 640, 390, 844, 'cover');
    expect(r.h).toBeCloseTo(844, 9);
    expect(r.w).toBeCloseTo(633, 9);
    expect(r.x).toBeCloseTo(-121.5, 9);
    expect(r.y).toBeCloseTo(0, 9);
  });

  it('falls back to the whole box for zero sizes (video not loaded yet)', () => {
    expect(fitRect(0, 0, 300, 200, 'cover')).toEqual({ x: 0, y: 0, w: 300, h: 200 });
  });
});

describe('SkeletonOverlay', () => {
  /**
   * A stand-in canvas whose 2D context accepts every call and counts them,
   * enough to see WHETHER the overlay drew (not what it drew).
   */
  function fakeCanvas(): { canvas: HTMLCanvasElement; calls: string[] } {
    const calls: string[] = [];
    const state: Record<string | symbol, unknown> = {
      measureText: () => ({ width: 30 }),
    };
    const ctx = new Proxy(state, {
      get(target, prop) {
        if (prop in target) return target[prop];
        return (..._args: unknown[]) => {
          calls.push(String(prop));
        };
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    });
    const canvas = { width: 300, height: 150, clientWidth: 400, clientHeight: 800, getContext: () => ctx };
    return { canvas: canvas as unknown as HTMLCanvasElement, calls };
  }

  const figure: Figure = figureFromLandmarks(landmarks(), ASPECT);
  const opts: DrawOptions = {
    style: 'normal',
    byConfidence: false,
    depthLine: { y: 0.55, state: 'idle' },
    guide: null,
    mirrored: true,
    silhouette: false,
  };
  const drew = (calls: string[]): boolean => calls.includes('stroke');

  beforeEach(() => {
    // canvasDpr() reads window.devicePixelRatio; the tests run without a browser.
    vi.stubGlobal('window', { devicePixelRatio: 2 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redraws the last frame after a resize (the browser wipes a resized canvas)', () => {
    const { canvas, calls } = fakeCanvas();
    const overlay = new SkeletonOverlay(canvas);
    overlay.setSize(400, 800);
    overlay.draw(figure, 480, 640, opts);
    expect(drew(calls)).toBe(true);

    calls.length = 0;
    overlay.setSize(300, 700); // e.g. the debug panel docked beside the picture
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(1400);
    expect(drew(calls)).toBe(true);

    calls.length = 0;
    overlay.setSize(300, 700); // same size: nothing was wiped, nothing to redraw
    expect(calls).toHaveLength(0);
  });

  it('redraws when the fit changes, but only then', () => {
    const { canvas, calls } = fakeCanvas();
    const overlay = new SkeletonOverlay(canvas);
    overlay.setSize(400, 800);
    overlay.draw(figure, 480, 640, opts);
    calls.length = 0;
    overlay.setFit('cover'); // already cover
    expect(calls).toHaveLength(0);
    overlay.setFit('contain');
    expect(drew(calls)).toBe(true);
  });

  it('forgets the last frame on clear(), so a later resize stays empty', () => {
    const { canvas, calls } = fakeCanvas();
    const overlay = new SkeletonOverlay(canvas);
    overlay.setSize(400, 800);
    overlay.draw(figure, 480, 640, opts);
    overlay.clear();
    calls.length = 0;
    overlay.setSize(500, 900);
    expect(drew(calls)).toBe(false);
  });
});
