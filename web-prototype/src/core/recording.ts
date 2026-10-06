import { RepCounter } from './repCounter';
import type { CounterConfig, CounterEvent, CounterPhase, CounterSnapshot, Joints2D, Joints3D, PoseFrame } from './types';

/** One frame of a recorded session (landmarks only — never video). */
export interface RecordingFrame {
  t: number;
  aspect: number;
  joints: Joints2D | null;
  world?: Joints3D | null;
  /** Counter output at record time, for comparison when replaying. */
  depth: number | null;
  phase: CounterPhase;
  count: number;
}

/** A downloadable session recording used to tune the algorithm offline. */
export interface Recording {
  version: 1;
  createdAt: string;
  userAgent: string;
  source: 'camera' | 'file';
  model: string;
  delegate: string;
  config: CounterConfig;
  frames: RecordingFrame[];
  events: CounterEvent[];
}

export function recordingFrameToPoseFrame(f: RecordingFrame): PoseFrame {
  return { t: f.t, aspect: f.aspect, joints: f.joints, world: f.world ?? null };
}

/**
 * Re-runs a recording through a fresh RepCounter with the given config and
 * returns every snapshot. Used by tests and for offline tuning.
 */
export function replayRecording(rec: Recording, config?: Partial<CounterConfig>): CounterSnapshot[] {
  // Start from the config the session was recorded with, then apply overrides
  // (this is how thresholds are tuned offline against real recordings).
  const counter = new RepCounter(rec.config);
  if (config) counter.setConfig(config);
  return rec.frames.map((f) => counter.update(recordingFrameToPoseFrame(f)));
}
