export type CameraErrorKind = 'denied' | 'notFound' | 'inUse' | 'insecure' | 'unsupported' | 'unknown';

export interface MediaSession {
  /** Stops the camera / video and releases resources. Idempotent. */
  stop(): void;
}

export type CameraResult =
  | { ok: true; session: MediaSession }
  | { ok: false; error: CameraErrorKind; message: string };

/**
 * 640×480 at up to 30 fps is plenty for PoseLandmarker (it downsizes
 * internally) and keeps the phone cooler. No aspect ratio is forced: in
 * portrait iOS hands back a portrait (e.g. 480×640) stream, and the real size
 * is read from video.videoWidth/videoHeight afterwards.
 */
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  // No microphone: requesting audio would switch iOS into a call-style audio
  // session (quieter speech, mic indicator) for no benefit.
  audio: false,
  video: {
    facingMode: 'user',
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 30, max: 30 },
  },
};

const CAMERA_START_TIMEOUT_MS = 10_000;
const FILE_START_TIMEOUT_MS = 15_000;

const MESSAGES: Record<CameraErrorKind, string> = {
  insecure:
    'The camera only works on a secure page. Open the https:// address (including :5173) that the dev server printed, not http://.',
  unsupported: "This browser can't use the camera. Open this page in Safari on iPhone (iOS 16.4 or newer).",
  denied:
    "Camera access is blocked. In Safari, open the page menu at the left of the address bar → (More →) Website Settings → Camera → Allow, then reload. Also check Settings › Apps › Safari › Camera.",
  notFound: 'No front camera was found on this device.',
  inUse: 'The camera is busy. Close other apps or tabs that use it (Camera, FaceTime, another Safari tab), then try again.',
  unknown: "Couldn't start the camera.",
};

const SUPERSEDED = 'A newer camera or video start replaced this one.';

/**
 * The latest start (camera or file) on each <video>. A start that is no
 * longer the latest must not touch the element: e.g. Start → Cancel → Start,
 * where the first permission prompt resolves last, used to attach its stream
 * over the second one and then blank the video when it was stopped.
 */
const latestStart = new WeakMap<HTMLVideoElement, number>();
let startCounter = 0;

/** Marks a new start on `video`; the returned function tells whether it is still the latest. */
function claimVideo(video: HTMLVideoElement): () => boolean {
  const id = ++startCounter;
  latestStart.set(video, id);
  return () => latestStart.get(video) === id;
}

/**
 * Starts the FRONT camera into `video` and resolves once frames are playing.
 * On iOS this must be called from a user gesture (tap handler). If a newer
 * start on the same element begins meanwhile, this one stops its own stream
 * and fails without touching the element.
 */
export async function startCamera(video: HTMLVideoElement): Promise<CameraResult> {
  if (!window.isSecureContext) return failure('insecure');
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') return failure('unsupported');

  const isLatest = claimVideo(video);
  // iOS can black out or mute a stream when a second one is opened, so make
  // sure nothing else is still attached to this element.
  detachMedia(video);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
  } catch (err) {
    const kind = classifyCameraError(err);
    return failure(kind, kind === 'unknown' ? `${MESSAGES.unknown} (${describeError(err)})` : undefined);
  }
  if (!isLatest()) {
    stopStream(stream);
    return failure('unknown', SUPERSEDED);
  }

  prepareVideo(video, false);
  video.srcObject = stream;

  try {
    await startPlayback(video, CAMERA_START_TIMEOUT_MS);
  } catch (err) {
    stopStream(stream);
    if (video.srcObject === stream) video.srcObject = null;
    return failure('unknown', `The camera turned on but the video didn't start (${describeError(err)}). Tap Start to try again.`);
  }
  if (!isLatest()) {
    stopStream(stream);
    if (video.srcObject === stream) video.srcObject = null;
    return failure('unknown', SUPERSEDED);
  }

  let stopped = false;
  return {
    ok: true,
    session: {
      stop(): void {
        if (stopped) return;
        stopped = true;
        stopStream(stream);
        // Only detach if a newer session hasn't already replaced our stream.
        if (video.srcObject === stream) video.srcObject = null;
      },
    },
  };
}

/**
 * Plays a local video file (e.g. a push-up clip recorded with the iPhone
 * Camera app) into `video`, looping, so detection can be tested without
 * doing push-ups live.
 */
export async function startVideoFile(video: HTMLVideoElement, file: File): Promise<MediaSession> {
  const isLatest = claimVideo(video);
  // Switching from the camera to a file turns the camera off.
  detachMedia(video);

  const url = URL.createObjectURL(file);
  prepareVideo(video, true);
  video.src = url;

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    // Only touch the element if it is still showing our file.
    if (video.src === url) {
      video.pause();
      video.removeAttribute('src');
      video.loop = false;
      video.load(); // releases the decoder
    }
    URL.revokeObjectURL(url);
  };

  try {
    await startPlayback(video, FILE_START_TIMEOUT_MS);
  } catch (err) {
    stop();
    throw new Error(
      `Couldn't play "${file.name}" (${describeError(err)}). Try a video recorded with the iPhone Camera app (.mov or .mp4).`,
      { cause: err },
    );
  }
  if (!isLatest()) {
    stop();
    throw new Error(SUPERSEDED);
  }
  return { stop };
}

function failure(error: CameraErrorKind, message?: string): CameraResult {
  return { ok: false, error, message: message ?? MESSAGES[error] };
}

/** Maps getUserMedia errors (DOMException names) to the kinds the UI understands. */
function classifyCameraError(err: unknown): CameraErrorKind {
  switch (errorName(err)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'notFound';
    case 'NotReadableError':
    case 'AbortError':
      return 'inUse';
    default:
      return 'unknown';
  }
}

function errorName(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string') return err.name;
  return '';
}

function describeError(err: unknown): string {
  if (err instanceof Error || err instanceof DOMException) {
    if (err.name && err.message) return `${err.name}: ${err.message}`;
    return err.message || err.name;
  }
  return String(err);
}

/** Attributes iPhone Safari needs to play video inline, silently and without a tap. */
function prepareVideo(video: HTMLVideoElement, loop: boolean): void {
  video.muted = true;
  video.playsInline = true; // without this iPhone opens the video full screen
  video.autoplay = true;
  video.loop = loop;
  // Some WebKit versions only honour the ATTRIBUTES for autoplay rules.
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
}

/** Stops whatever camera stream or file was attached to `video` before. */
function detachMedia(video: HTMLVideoElement): void {
  const previous = video.srcObject;
  if (previous instanceof MediaStream) stopStream(previous);
  if (previous) video.srcObject = null;
  if (video.getAttribute('src')) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** Starts playback and waits until the video has a real size and is playing. */
async function startPlayback(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  const playing = video.play();
  // If waiting for the size fails first, this rejection is reported below
  // instead of as an "unhandled rejection".
  playing.catch(() => {});
  await waitForVideoSize(video, timeoutMs);
  await playing;
}

/** Resolves once videoWidth/videoHeight are known (after 'loadedmetadata'). */
function waitForVideoSize(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      resolve();
      return;
    }
    // iOS sometimes reports the size slightly after 'loadedmetadata', so listen to a few events.
    const events = ['loadedmetadata', 'loadeddata', 'resize', 'playing'] as const;
    const check = (): void => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup();
        resolve();
      }
    };
    const onError = (): void => {
      cleanup();
      reject(new Error(video.error?.message || 'the video could not be loaded'));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`no picture after ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    function cleanup(): void {
      window.clearTimeout(timer);
      for (const name of events) video.removeEventListener(name, check);
      video.removeEventListener('error', onError);
    }
    for (const name of events) video.addEventListener(name, check);
    video.addEventListener('error', onError);
  });
}
