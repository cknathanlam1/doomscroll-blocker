/**
 * If requestVideoFrameCallback stays silent this long while the video is
 * playing and the page is visible, switch to the requestAnimationFrame
 * fallback. Some WebKit versions stop firing it (e.g. when the video element
 * is hidden or after its source changes) and counting would silently freeze.
 */
const RVFC_STALL_MS = 1500;
const WATCHDOG_INTERVAL_MS = 500;

/**
 * Calls `onFrame` once per NEW video frame. Uses requestVideoFrameCallback
 * when available, else requestAnimationFrame de-duplicated on
 * video.currentTime. Returns a stop function.
 *
 * `nowMs` is performance.now() at delivery time (the same clock the detector
 * uses). A paused video simply delivers nothing until it plays again, and an
 * exception thrown by `onFrame` is logged without ending the loop.
 */
export function startFrameLoop(video: HTMLVideoElement, onFrame: (nowMs: number) => void): () => void {
  let stopped = false;
  let rvfcHandle: number | null = null;
  let rafHandle: number | null = null;
  let watchdog: number | null = null;
  let lastVideoTime = -1;
  let lastDeliveredAt = performance.now();

  const deliver = (): void => {
    lastDeliveredAt = performance.now();
    try {
      onFrame(lastDeliveredAt);
    } catch (err) {
      console.error('[frameLoop] onFrame threw', err);
    }
  };

  // --- requestVideoFrameCallback path (iOS 15.4+): fires once per presented frame.
  const onVideoFrame = (): void => {
    rvfcHandle = null;
    if (stopped) return;
    // Schedule the next callback BEFORE running onFrame, so the loop survives
    // an exception, and a stop() called from inside onFrame can cancel it.
    rvfcHandle = video.requestVideoFrameCallback(onVideoFrame);
    deliver();
  };

  // --- requestAnimationFrame fallback: runs at the display rate (60–120 Hz),
  // so skip ticks where the video hasn't advanced to a new frame.
  const onAnimationFrame = (): void => {
    rafHandle = null;
    if (stopped) return;
    rafHandle = requestAnimationFrame(onAnimationFrame);
    // currentTime changes on every new frame — including when a looping file
    // jumps back to the start — and stands still while paused.
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      deliver();
    }
  };

  const startAnimationFrameLoop = (): void => {
    lastVideoTime = -1;
    rafHandle = requestAnimationFrame(onAnimationFrame);
  };

  const clearWatchdog = (): void => {
    if (watchdog !== null) window.clearInterval(watchdog);
    watchdog = null;
  };

  // `in` check because the DOM typings declare the method as always present,
  // but older Safari (before 15.4) doesn't have it.
  if ('requestVideoFrameCallback' in video) {
    rvfcHandle = video.requestVideoFrameCallback(onVideoFrame);
    watchdog = window.setInterval(() => {
      const now = performance.now();
      const shouldBeDelivering =
        !video.paused &&
        !video.ended &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        document.visibilityState === 'visible';
      if (!shouldBeDelivering) {
        // Paused / hidden / loading: silence is expected, so restart the stall clock.
        lastDeliveredAt = now;
        return;
      }
      if (now - lastDeliveredAt > RVFC_STALL_MS) {
        console.warn('[frameLoop] requestVideoFrameCallback stalled; switching to requestAnimationFrame');
        if (rvfcHandle !== null) video.cancelVideoFrameCallback(rvfcHandle);
        rvfcHandle = null;
        clearWatchdog();
        startAnimationFrameLoop();
      }
    }, WATCHDOG_INTERVAL_MS);
  } else {
    startAnimationFrameLoop();
  }

  return function stop(): void {
    if (stopped) return;
    stopped = true;
    if (rvfcHandle !== null) video.cancelVideoFrameCallback(rvfcHandle);
    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    rvfcHandle = null;
    rafHandle = null;
    clearWatchdog();
  };
}
