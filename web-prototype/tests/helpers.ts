/**
 * Shared helpers for the counter tests: run a simulated session through a
 * RepCounter and summarise what came out.
 */
import { RepCounter } from '../src/core/repCounter';
import type {
  CounterConfig,
  CounterEvent,
  CounterEventType,
  CounterSnapshot,
  JointName,
  Joints2D,
  Joints3D,
  PoseFrame,
} from '../src/core/types';

export interface RunResult {
  snapshots: CounterSnapshot[];
  events: CounterEvent[];
  finalCount: number;
  counter: RepCounter;
}

/** Feeds every frame to a fresh counter (or the given one) and collects all snapshots and events. */
export function runCounter(frames: PoseFrame[], config?: Partial<CounterConfig>, counter?: RepCounter): RunResult {
  const c = counter ?? new RepCounter(config);
  const snapshots: CounterSnapshot[] = [];
  const events: CounterEvent[] = [];
  for (const f of frames) {
    const snap = c.update(f);
    snapshots.push(snap);
    events.push(...snap.events);
  }
  const last = snapshots[snapshots.length - 1];
  return { snapshots, events, finalCount: last ? last.count : 0, counter: c };
}

export function eventsOfType<T extends CounterEventType>(
  events: CounterEvent[],
  type: T,
): Extract<CounterEvent, { type: T }>[] {
  return events.filter((e): e is Extract<CounterEvent, { type: T }> => e.type === type);
}

export function eventTypes(events: CounterEvent[]): CounterEventType[] {
  return events.map((e) => e.type);
}

/** Counts each event type, e.g. { rep: 10, partial: 2 }. */
export function eventHistogram(events: CounterEvent[]): Partial<Record<CounterEventType, number>> {
  const out: Partial<Record<CounterEventType, number>> = {};
  for (const e of events) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
}

const SWAP: Record<JointName, JointName> = {
  nose: 'nose',
  leftShoulder: 'rightShoulder',
  rightShoulder: 'leftShoulder',
  leftElbow: 'rightElbow',
  rightElbow: 'leftElbow',
  leftWrist: 'rightWrist',
  rightWrist: 'leftWrist',
  leftHip: 'rightHip',
  rightHip: 'leftHip',
};

/** A horizontally mirrored copy of a frame (x → aspect - x, left/right labels swapped), like a mirrored video file. */
export function mirrorFrame(f: PoseFrame): PoseFrame {
  let joints: Joints2D | null = null;
  if (f.joints) {
    joints = {};
    for (const [name, j] of Object.entries(f.joints) as [JointName, Joints2D[JointName]][]) {
      if (j) joints[SWAP[name]] = { x: f.aspect - j.x, y: j.y, c: j.c };
    }
  }
  let world: Joints3D | null | undefined = f.world;
  if (f.world) {
    world = {};
    for (const [name, j] of Object.entries(f.world) as [JointName, Joints3D[JointName]][]) {
      if (j) world[SWAP[name]] = { x: -j.x, y: j.y, z: j.z };
    }
  }
  return { t: f.t, aspect: f.aspect, joints, world };
}

/** The deepest smoothed depth reported in [t0, t1). */
export function maxDepthBetween(snaps: CounterSnapshot[], t0: number, t1: number): number {
  let m = -Infinity;
  for (const s of snaps) {
    const t = s.features.t;
    if (t >= t0 && t < t1 && s.depth !== null) m = Math.max(m, s.depth);
  }
  return m;
}
