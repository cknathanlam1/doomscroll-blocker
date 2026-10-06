export interface LuminanceMeter {
  /** Mean luma (0..255) of a small downscaled copy of the current video frame, or null if unavailable. */
  sample(video: HTMLVideoElement): number | null;
}

/** 32×32 = 1024 pixels: plenty for an average, and nearly free to read back. */
const SIZE = 32;

/**
 * Measures how bright the camera picture is, for the "Too dark" state (S3).
 * Call it a few times per second (e.g. every 500 ms), not on every frame:
 * reading pixels back from the GPU is the expensive part.
 */
export function createLuminanceMeter(): LuminanceMeter {
  let ctx: CanvasRenderingContext2D | null = null;

  return {
    sample(video: HTMLVideoElement): number | null {
      try {
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0 || video.videoHeight === 0) {
          return null; // no frame yet
        }
        if (!ctx) {
          const canvas = document.createElement('canvas');
          canvas.width = SIZE;
          canvas.height = SIZE;
          // willReadFrequently keeps the canvas on the CPU, so getImageData
          // doesn't stall waiting for the GPU each time.
          ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return null;
        }
        // Squashing the frame to a square is fine: we only want the average.
        ctx.drawImage(video, 0, 0, SIZE, SIZE);
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          // Rec. 601 luma: green looks brightest to the eye, blue darkest.
          sum += 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
        }
        return sum / (SIZE * SIZE);
      } catch {
        // e.g. the video was torn down mid-call: report "unknown", never throw.
        return null;
      }
    },
  };
}
