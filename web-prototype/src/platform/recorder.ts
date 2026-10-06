import { JOINT_NAMES } from '../core/types';
import type { Recording, RecordingFrame } from '../core/recording';
import type { CounterConfig, CounterEvent, CounterSnapshot, Joints2D, Joints3D, PoseFrame } from '../core/types';

export interface RecorderMeta {
  source: 'camera' | 'file';
  model: string;
  delegate: string;
  config: CounterConfig;
}

export interface SessionRecorder {
  readonly recording: boolean;
  readonly frameCount: number;
  start(meta: RecorderMeta): void;
  /** Appends a frame (landmarks + counter output). Ignored when not recording. */
  push(frame: PoseFrame, snapshot: CounterSnapshot): void;
  /** Stops and returns the recording (null if never started). */
  stop(): Recording | null;
}

/** 9000 frames ≈ 5 minutes at 30 fps (≈ 3–4 MB of JSON). */
const DEFAULT_MAX_FRAMES = 9000;

/**
 * Records landmarks + counter output (never video) so a session on the
 * iPhone can be replayed and tuned offline (see core/recording.ts).
 *
 * When `maxFrames` is reached the recorder stops taking frames AND events,
 * so the two always cover the same stretch of time; stop() still returns
 * everything collected up to that point.
 */
export function createRecorder(maxFrames: number = DEFAULT_MAX_FRAMES): SessionRecorder {
  const limit = Number.isFinite(maxFrames) && maxFrames > 0 ? Math.floor(maxFrames) : DEFAULT_MAX_FRAMES;
  let meta: RecorderMeta | null = null;
  let createdAt = '';
  let frames: RecordingFrame[] = [];
  let events: CounterEvent[] = [];
  let active = false;

  return {
    get recording(): boolean {
      return active;
    },
    get frameCount(): number {
      return frames.length;
    },

    start(m: RecorderMeta): void {
      // Copy the config so later tweaks during the session don't rewrite history.
      meta = { ...m, config: structuredClone(m.config) };
      createdAt = new Date().toISOString();
      frames = [];
      events = [];
      active = true;
    },

    push(frame: PoseFrame, snapshot: CounterSnapshot): void {
      if (!active) return;
      if (frames.length >= limit) {
        active = false; // full: see the note above
        return;
      }
      const f: RecordingFrame = {
        t: round(frame.t, 2),
        aspect: round(frame.aspect, 4),
        joints: compactJoints2D(frame.joints),
        depth: snapshot.depth === null ? null : round(snapshot.depth, 4),
        phase: snapshot.phase,
        count: snapshot.count,
      };
      const world = compactJoints3D(frame.world);
      if (world) f.world = world; // left out when absent to keep files small
      frames.push(f);
      for (const e of snapshot.events) events.push({ ...e });
    },

    stop(): Recording | null {
      active = false;
      if (!meta) return null;
      return {
        version: 1,
        createdAt,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        source: meta.source,
        model: meta.model,
        delegate: meta.delegate,
        config: meta.config,
        frames,
        events,
      };
    },
  };
}

/**
 * Saves a recording as JSON. On iPhone uses the share sheet (navigator.share
 * with a File) when available so it can be saved to Files / AirDropped;
 * otherwise falls back to an <a download> link.
 *
 * Call it directly from a tap handler: the share sheet only opens during a
 * user gesture. Closing the sheet without saving is not an error.
 */
export async function saveRecording(rec: Recording): Promise<void> {
  const name = `pushups-${fileTimestamp(rec.createdAt)}.json`;
  const file = new File([JSON.stringify(rec)], name, { type: 'application/json' });

  // Share sheet only on touch devices (iPhone: Save to Files / AirDrop). On a
  // laptop, Chrome/Edge would open the Windows share dialog, which can't save
  // a file, so download straight to the Downloads folder instead.
  const touchDevice = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  if (touchDevice && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // user closed the sheet
      // Anything else (e.g. NotAllowedError because the tap "expired"): fall back to a download.
      console.warn('[recorder] share failed, downloading instead', err);
    }
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking right away can cancel the download on iOS; give it time.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** "2026-10-05T18:24:03.123Z" → "2026-10-05T18-24-03" (safe in file names everywhere). */
function fileTimestamp(iso: string): string {
  const source = iso || new Date().toISOString();
  return source.slice(0, 19).replace(/:/g, '-');
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** Only the core joints, rounded to 4 decimals (≈ 0.1 px): plenty for tuning, much smaller files. */
function compactJoints2D(joints: Joints2D | null): Joints2D | null {
  if (!joints) return null;
  const out: Joints2D = {};
  for (const name of JOINT_NAMES) {
    const j = joints[name];
    if (j) out[name] = { x: round(j.x, 4), y: round(j.y, 4), c: round(j.c, 4) };
  }
  return out;
}

function compactJoints3D(world: Joints3D | null | undefined): Joints3D | null {
  if (!world) return null;
  const out: Joints3D = {};
  for (const name of JOINT_NAMES) {
    const w = world[name];
    if (w) out[name] = { x: round(w.x, 4), y: round(w.y, 4), z: round(w.z, 4) };
  }
  return out;
}
