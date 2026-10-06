/**
 * Recordings (src/core/recording.ts) exist so a session filmed on the iPhone
 * can be replayed and re-tuned offline. That only works if replaying gives
 * back what the live counter did, so that is what these tests check, using
 * the app's real recorder (which rounds landmarks to keep files small) and a
 * JSON round trip like a downloaded file.
 */
import { describe, expect, test } from 'vitest';
import { RepCounter } from '../src/core/repCounter';
import { recordingFrameToPoseFrame, replayRecording, type Recording } from '../src/core/recording';
import type { CounterSnapshot, PoseFrame } from '../src/core/types';
import { createRecorder } from '../src/platform/recorder';
import { simulateSession, standardSet, type RepSpec } from './sim/pushupSimulator';
import { eventsOfType } from './helpers';

/** A realistic session: noise, 24 fps with jitter, a dropout, full and partial reps. */
function session(): PoseFrame[] {
  const reps: RepSpec[] = [
    { minElbowDeg: 80 },
    { minElbowDeg: 120 },
    { minElbowDeg: 70, downMs: 400, upMs: 400 },
    { minElbowDeg: 98 },
    { minElbowDeg: 85, bottomHoldMs: 800 },
  ];
  return simulateSession(
    [...standardSet(reps), { kind: 'absent', ms: 1200 }, { kind: 'hold', ms: 1500 }, ...standardSet([{ minElbowDeg: 75 }, { minElbowDeg: 88 }], 0), { kind: 'hold', ms: 800 }],
    { fps: 24, noisePx: 2, timeJitterMs: 6, seed: 42, includeWorld: true },
  ).frames;
}

/** Runs the live counter with the recorder attached, as the app does, and returns both. */
function recordLive(frames: PoseFrame[]): { live: CounterSnapshot[]; recording: Recording } {
  const counter = new RepCounter({ targetReps: 50 });
  const recorder = createRecorder();
  recorder.start({ source: 'camera', model: 'lite', delegate: 'GPU', config: counter.config });
  const live = frames.map((f) => {
    const snap = counter.update(f);
    recorder.push(f, snap);
    return snap;
  });
  const recording = recorder.stop();
  if (!recording) throw new Error('recorder returned nothing');
  // Like saving the file and loading it again.
  return { live, recording: JSON.parse(JSON.stringify(recording)) as Recording };
}

describe('replayRecording', () => {
  test('the session itself is meaningful (counts, partials, a pause)', () => {
    const { live } = recordLive(session());
    const events = live.flatMap((s) => s.events);
    expect(live.at(-1)?.count).toBe(6);
    expect(eventsOfType(events, 'partial').length).toBeGreaterThanOrEqual(1);
    expect(eventsOfType(events, 'paused').map((e) => e.reason)).toEqual(['lost']);
  });

  test('replaying a saved recording reproduces the live counts, phases and events', () => {
    const { live, recording } = recordLive(session());
    const replay = replayRecording(recording);

    expect(replay).toHaveLength(live.length);
    expect(replay.map((s) => s.count)).toEqual(live.map((s) => s.count));
    expect(replay.map((s) => s.phase)).toEqual(live.map((s) => s.phase));
    const types = (snaps: CounterSnapshot[]) => snaps.flatMap((s) => s.events.map((e) => `${e.type}@${e.t.toFixed(2)}`));
    expect(types(replay)).toEqual(recording.events.map((e) => `${e.type}@${e.t.toFixed(2)}`));
    // Landmarks are saved to 4 decimals (≈ 0.1 px), so depth may differ in the 4th decimal.
    for (let i = 0; i < live.length; i++) {
      const a = live[i]?.depth ?? null;
      const b = replay[i]?.depth ?? null;
      if (a === null || b === null) expect(b).toBe(a);
      else expect(Math.abs(a - b)).toBeLessThan(0.005);
    }
    // And the recording's own copy of the counter output agrees with the replay.
    expect(replay.map((s) => s.count)).toEqual(recording.frames.map((f) => f.count));
  });

  test('an unrounded recording replays bit-for-bit', () => {
    const frames = session();
    const counter = new RepCounter();
    const live = frames.map((f) => counter.update(f));
    const recording: Recording = {
      version: 1,
      createdAt: '2026-10-05T00:00:00.000Z',
      userAgent: 'test',
      source: 'file',
      model: 'lite',
      delegate: 'CPU',
      config: counter.config,
      frames: frames.map((f, i) => ({
        t: f.t,
        aspect: f.aspect,
        joints: f.joints,
        world: f.world ?? null,
        depth: live[i]?.depth ?? null,
        phase: live[i]?.phase ?? 'waiting',
        count: live[i]?.count ?? 0,
      })),
      events: live.flatMap((s) => s.events),
    };
    const replay = replayRecording(recording);
    expect(replay.map((s) => s.depth)).toEqual(live.map((s) => s.depth));
    expect(replay.map((s) => s.depthLineY)).toEqual(live.map((s) => s.depthLineY));
    expect(replay.flatMap((s) => s.events)).toEqual(recording.events);
  });

  test('config overrides re-tune the replay (that is what recordings are for)', () => {
    const { recording } = recordLive(session());
    const normal = replayRecording(recording).at(-1)?.count;
    // Stricter depth: the 98° rep (and possibly the 88° one) no longer counts.
    const strict = replayRecording(recording, { downThreshold: 0.33 }).at(-1)?.count ?? NaN;
    // Lower target: completes early and stops counting.
    const short = replayRecording(recording, { targetReps: 3 });
    expect(normal).toBe(6);
    expect(strict).toBeLessThan(6);
    expect(strict).toBeGreaterThanOrEqual(3);
    expect(short.at(-1)?.phase).toBe('complete');
    expect(short.at(-1)?.count).toBe(3);
    // The override did not leak into the recording's own config.
    expect(recording.config.downThreshold).not.toBe(0.33);
  });

  test('a recording made with an older, smaller config still replays (missing fields use defaults)', () => {
    const { recording } = recordLive(session());
    const old = JSON.parse(JSON.stringify(recording)) as Recording;
    const cfg = old.config as unknown as Record<string, unknown>;
    delete cfg.headOnlyDropRatio;
    delete (cfg.smoothing as Record<string, unknown>).dCutoff;
    expect(replayRecording(old).at(-1)?.count).toBe(6);
  });

  test('recordingFrameToPoseFrame maps a missing world to null', () => {
    const pf = recordingFrameToPoseFrame({ t: 5, aspect: 0.75, joints: null, depth: null, phase: 'waiting', count: 0 });
    expect(pf).toEqual({ t: 5, aspect: 0.75, joints: null, world: null });
  });
});
