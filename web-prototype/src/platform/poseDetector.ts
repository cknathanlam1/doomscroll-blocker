import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { PoseFrame } from '../core/types';
import { toPoseFrame } from './mediapipeMapping';
import type { RawLandmark } from './mediapipeMapping';

export type PoseModel = 'lite' | 'full' | 'heavy';
export type Delegate = 'GPU' | 'CPU';

export interface PoseDetectorOptions {
  model: PoseModel;
  /** 'auto' tries GPU first and falls back to CPU. */
  delegate: Delegate | 'auto';
}

export interface PoseDetection {
  frame: PoseFrame;
  /** All 33 landmarks of the first pose (normalized, unmirrored) for drawing; null if none. */
  landmarks: RawLandmark[] | null;
  /** Wall-clock time spent inside detectForVideo. */
  inferenceMs: number;
}

export interface PoseDetector {
  readonly model: PoseModel;
  readonly delegate: Delegate;
  /**
   * Runs pose detection on the video's current frame. The detector keeps
   * timestamps strictly increasing internally, even if callers pass equal
   * or decreasing values (e.g. a looping video file).
   */
  detect(video: HTMLVideoElement, timestampMs: number): PoseDetection;
  close(): void;
}

/**
 * Pinned model files (version /1/, never /latest/) so the model can't change
 * underneath the tuned thresholds. lite ≈ 6 MB, full ≈ 9 MB, heavy ≈ 30 MB.
 */
const MODEL_URLS: Record<PoseModel, string> = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};

/** After this many restarts within RECOVERY_WINDOW_MS we stop trying (each restart leaks memory on WebKit). */
const MAX_RECOVERIES = 3;
const RECOVERY_WINDOW_MS = 60_000;
/** Short pause before a restart so a lost WebGL context has a chance to come back. */
const RECOVERY_DELAY_MS = 250;

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

// Shared by every detector in this page, so switching model/delegate never
// downloads the same thing twice.
let filesetPromise: Promise<WasmFileset> | null = null;
const modelCache = new Map<PoseModel, Promise<Uint8Array>>();

/** Loads the MediaPipe WASM runtime + model and creates a VIDEO-mode PoseLandmarker. */
export async function createPoseDetector(
  options: PoseDetectorOptions,
  onProgress?: (message: string) => void,
): Promise<PoseDetector> {
  const report = (message: string): void => {
    try {
      onProgress?.(message);
    } catch {
      // A broken progress callback must not break loading.
    }
  };

  report('Loading body tracking…');
  const fileset = await loadFileset();
  const modelBytes = await loadModel(options.model, report);

  const first = await createWorkingLandmarker(fileset, modelBytes, delegateOrder(options.delegate), report);

  let landmarker: PoseLandmarker | null = first.landmarker;
  let delegate: Delegate = first.delegate;
  let closed = false;
  let recovering = false;
  let gaveUp = false;
  let recoveryTimes: number[] = [];
  // MediaPipe throws (and the graph dies) if a timestamp is not larger than
  // the previous one. The warm-up frame used one already.
  let lastTs = first.warmupTs;
  // Used when the video has no size yet; any value works because there are no joints then.
  let lastAspect = 1;

  report(`Body tracking ready (${delegate})`);

  /** ts = max(requested, last + 1): strictly increasing by at least 1 ms. */
  const nextTimestamp = (requested: number): number => {
    const ts = Number.isFinite(requested) ? Math.max(requested, lastTs + 1) : lastTs + 1;
    lastTs = ts;
    return ts;
  };

  const videoAspect = (video: HTMLVideoElement): number => {
    if (video.videoWidth > 0 && video.videoHeight > 0) lastAspect = video.videoWidth / video.videoHeight;
    return lastAspect;
  };

  /** Which delegates to try when rebuilding after a failure. */
  const recoveryOrder = (): Delegate[] => {
    if (options.delegate !== 'auto') return [options.delegate];
    // In auto mode, a GPU that has failed twice recently is not trusted again.
    if (delegate === 'CPU' || recoveryTimes.length >= 2) return ['CPU'];
    return ['GPU', 'CPU'];
  };

  /**
   * detectForVideo threw: the landmarker is probably broken for good (lost
   * WebGL context after backgrounding, a timestamp error, …). Throw it away
   * and build ONE new one in the background. Frames arriving meanwhile get
   * "nobody detected" results, which the counter treats like a brief dropout.
   */
  const scheduleRecovery = (): void => {
    if (closed || recovering || gaveUp) return;
    const broken = landmarker;
    landmarker = null;
    safeClose(broken);

    const now = performance.now();
    recoveryTimes = recoveryTimes.filter((t) => now - t < RECOVERY_WINDOW_MS);
    if (recoveryTimes.length >= MAX_RECOVERIES) {
      gaveUp = true;
      report('Body tracking keeps failing. Close Safari completely, then open this page again.');
      return;
    }
    recoveryTimes.push(now);
    recovering = true;
    report('Body tracking hit a problem. Restarting it…');
    const order = recoveryOrder();

    window.setTimeout(() => {
      void (async () => {
        try {
          const next = await createWorkingLandmarker(fileset, modelBytes, order, report, () => nextTimestamp(0));
          if (closed) {
            safeClose(next.landmarker);
            return;
          }
          landmarker = next.landmarker;
          delegate = next.delegate;
          report(`Body tracking restarted (${delegate})`);
        } catch (err) {
          console.error('[pose] restarting the landmarker failed', err);
          gaveUp = true;
          report('Body tracking stopped working. Close Safari completely, then open this page again.');
        } finally {
          recovering = false;
        }
      })();
    }, RECOVERY_DELAY_MS);
  };

  const detect = (video: HTMLVideoElement, timestampMs: number): PoseDetection => {
    // Always advance the clock, even for skipped frames, so PoseFrame.t stays
    // strictly increasing for the core too.
    const t = nextTimestamp(timestampMs);
    const aspect = videoAspect(video);
    const lm = landmarker;

    // No usable frame yet (or restarting): report "nobody" without calling
    // MediaPipe — a 0×0 video would make it throw and trigger a needless restart.
    if (!lm || closed || !hasFrame(video)) {
      return { frame: toPoseFrame(undefined, undefined, aspect, t), landmarks: null, inferenceMs: 0 };
    }

    let image: NormalizedLandmark[] | undefined;
    let world: Landmark[] | undefined;
    const t0 = performance.now();
    try {
      // Synchronous form: results are plain arrays we own (no masks to free,
      // since outputSegmentationMasks is false).
      const result = lm.detectForVideo(video, t);
      image = result.landmarks[0];
      world = result.worldLandmarks[0];
    } catch (err) {
      console.error('[pose] detectForVideo failed', err);
      scheduleRecovery();
      return {
        frame: toPoseFrame(undefined, undefined, aspect, t),
        landmarks: null,
        inferenceMs: performance.now() - t0,
      };
    }
    const inferenceMs = performance.now() - t0;

    return {
      frame: toPoseFrame(image, world, aspect, t),
      landmarks: image && image.length > 0 ? image : null,
      inferenceMs,
    };
  };

  return {
    model: options.model,
    // A getter, so the UI shows the CPU after a mid-session fallback.
    get delegate(): Delegate {
      return delegate;
    },
    detect,
    close(): void {
      closed = true;
      safeClose(landmarker);
      landmarker = null;
    },
  };
}

function delegateOrder(choice: Delegate | 'auto'): Delegate[] {
  // An explicit choice is honoured as-is (useful for A/B testing GPU vs CPU).
  return choice === 'auto' ? ['GPU', 'CPU'] : [choice];
}

/** True when the video has a decoded frame with a real size. */
function hasFrame(video: HTMLVideoElement): boolean {
  return video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0;
}

function safeClose(landmarker: PoseLandmarker | null): void {
  if (!landmarker) return;
  try {
    landmarker.close();
  } catch (err) {
    console.warn('[pose] close() failed', err);
  }
}

/**
 * The WASM files are self-hosted: scripts/copy-mediapipe-wasm.mjs copies them
 * into public/mediapipe/wasm, so they always match the installed JS version and
 * load from the PC over the LAN. MediaPipe appends "/<file>" itself, so the
 * URL must NOT end with a slash.
 */
function wasmBaseUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}mediapipe/wasm`, window.location.href).href;
}

async function loadFileset(): Promise<WasmFileset> {
  if (!filesetPromise) {
    filesetPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(wasmBaseUrl());
      await checkWasmIsServed(fileset.wasmLoaderPath);
      return fileset;
    })();
    // Don't cache a failure: the next attempt should try again.
    filesetPromise.catch(() => {
      filesetPromise = null;
    });
  }
  return filesetPromise;
}

/**
 * If the copy script never ran (e.g. the server was started with `npx vite`
 * instead of `npm run dev`), the dev server answers the missing file with the
 * app's index.html and MediaPipe fails with a cryptic error. Catch that here
 * and say what to do instead.
 */
async function checkWasmIsServed(loaderUrl: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(loaderUrl, { method: 'HEAD', cache: 'no-store' });
  } catch {
    return; // Network trouble: let MediaPipe report it with its own error.
  }
  const type = response.headers.get('content-type') ?? '';
  // Other odd statuses (e.g. a server that refuses HEAD) are not treated as "missing".
  if (response.status === 404 || (response.ok && type.includes('text/html'))) {
    throw new Error(
      'The body-tracking files are missing from the server. Stop it and start it again with `npm run dev` (that copies them into public/mediapipe/wasm).',
    );
  }
}

/**
 * Downloads the model once per page and keeps the bytes in memory. That way
 * the GPU→CPU fallback and any mid-set restart reuse them instead of
 * downloading again, and the first (slow) download can show progress.
 */
function loadModel(model: PoseModel, report: (message: string) => void): Promise<Uint8Array> {
  let promise = modelCache.get(model);
  if (!promise) {
    promise = downloadModel(MODEL_URLS[model], model, report);
    modelCache.set(model, promise);
    promise.catch(() => modelCache.delete(model));
  }
  return promise;
}

async function downloadModel(url: string, model: PoseModel, report: (message: string) => void): Promise<Uint8Array> {
  const failed = (detail: string, cause?: unknown): Error =>
    new Error(`Couldn't download the body-tracking model (${model}): ${detail}. Check that the phone is online, then reload.`, {
      cause,
    });

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw failed(err instanceof Error ? err.message : String(err), err);
  }
  if (!response.ok) throw failed(`HTTP ${response.status}`);

  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || total <= 0) {
    report('Downloading body-tracking model…');
    return new Uint8Array(await response.arrayBuffer());
  }

  // Stream it so the user sees progress (first load on a phone can take a while).
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastReported = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const percent = Math.min(99, Math.floor((received / total) * 100));
    if (percent >= lastReported + 10) {
      lastReported = percent;
      report(`Downloading body-tracking model… ${percent}%`);
    }
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

interface CreatedLandmarker {
  landmarker: PoseLandmarker;
  delegate: Delegate;
  /** Timestamp used for the warm-up frame; real frames must use larger ones. */
  warmupTs: number;
}

/**
 * Tries each delegate in order. A delegate only "works" once a warm-up frame
 * has run through it: some GPU problems only show up on the first inference,
 * and the warm-up also moves the slow first-frame setup into the loading screen.
 */
async function createWorkingLandmarker(
  fileset: WasmFileset,
  modelBytes: Uint8Array,
  order: Delegate[],
  report: (message: string) => void,
  warmupTimestamp: () => number = () => 0,
): Promise<CreatedLandmarker> {
  let lastError: unknown = null;
  for (let i = 0; i < order.length; i++) {
    const delegate = order[i];
    if (!delegate) continue;
    report(`Starting body tracking (${delegate})…`);
    let landmarker: PoseLandmarker | null = null;
    try {
      landmarker = await PoseLandmarker.createFromOptions(fileset, {
        // Deliberately no `canvas` option: MediaPipe makes its own. Passing the
        // app's overlay canvas (which already has a 2D context) would throw.
        baseOptions: { modelAssetBuffer: modelBytes, delegate },
        runningMode: 'VIDEO',
        numPoses: 1, // one pose enables MediaPipe's built-in tracking + smoothing
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
      const warmupTs = warmupTimestamp();
      landmarker.detectForVideo(warmupCanvas(), warmupTs);
      return { landmarker, delegate, warmupTs };
    } catch (err) {
      lastError = err;
      console.warn(`[pose] ${delegate} delegate failed`, err);
      safeClose(landmarker);
      const next = order[i + 1];
      if (delegate === 'GPU' && next === 'CPU') report('GPU unavailable, using CPU');
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Body tracking couldn't start (${order.join(' and ')}): ${detail}. Reload the page; if it keeps happening, close Safari completely and reopen it.`,
    { cause: lastError },
  );
}

let warmupImage: HTMLCanvasElement | null = null;

/** A small black image for the warm-up inference (an input image, not MediaPipe's `canvas` option). */
function warmupCanvas(): HTMLCanvasElement {
  if (!warmupImage) {
    warmupImage = document.createElement('canvas');
    warmupImage.width = 64;
    warmupImage.height = 64;
    const ctx = warmupImage.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 64, 64);
    }
  }
  return warmupImage;
}
