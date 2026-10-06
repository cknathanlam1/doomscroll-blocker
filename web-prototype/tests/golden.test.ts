/**
 * Golden parity CHECK (runs with `npm test`).
 *
 * tests/fixtures/golden/*.json hold exact input frames and the web counter's
 * per-frame output (format: tests/fixtures/golden/README.md). They are
 * WRITTEN only by `npm run golden` (scripts/golden/exportGolden.test.ts).
 * This file re-runs every fixture through the current RepCounter and fails if
 * the output changed, so the web counter and the files (and therefore the
 * Swift port that is tested against them) can't drift apart silently. After
 * an INTENTIONAL change to src/core: `npm run golden`, then commit the files.
 *
 * The comparison below is the reference for the Swift parity test: exact
 * for phase / motion / count / depthSource / inFrame / plankOk / hint and the
 * event types and string/boolean fields, numbers within 1e-6, null only
 * equals null.
 */
import { describe, expect, test } from 'vitest';
import { DEFAULT_CONFIG, RepCounter } from '../src/core/repCounter';
import type { CounterConfig, CounterSnapshot, PoseFrame } from '../src/core/types';
import { mirrorFrame } from './helpers';

const GOLDEN_FORMAT = 'doomscroller-golden/2';
const TOLERANCE = 1e-6;

const EXACT_FIELDS = ['phase', 'motion', 'count', 'depthSource', 'inFrame', 'plankOk', 'hint'] as const;
const NUMERIC_FIELDS = [
  't',
  'depth',
  'rawDepth',
  'peakDepth',
  'heightRatio',
  'baselineRatio',
  'shoulderWidthRatio',
  'depthLineY',
  'countdownRemainingMs',
] as const;

type ExactField = (typeof EXACT_FIELDS)[number];
type NumericField = (typeof NUMERIC_FIELDS)[number];
type Expected = Record<ExactField, string | number | boolean | null> &
  Record<NumericField, number | null> & { events: Record<string, unknown>[] };

interface GoldenFile {
  format: string;
  name: string;
  description: string;
  config: CounterConfig;
  frames: PoseFrame[];
  expected: Expected[];
}

const files = import.meta.glob<GoldenFile>('./fixtures/golden/*.json', { eager: true, import: 'default' });
const goldens = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, file]) => ({ path, file }));

/** The same fields, taken from a live snapshot. */
function actualOf(s: CounterSnapshot): Expected {
  return {
    t: s.features.t,
    phase: s.phase,
    motion: s.motion,
    count: s.count,
    depth: s.depth,
    rawDepth: s.rawDepth,
    peakDepth: s.peakDepth,
    depthSource: s.depthSource,
    heightRatio: s.heightRatio,
    baselineRatio: s.baselineRatio,
    shoulderWidthRatio: s.shoulderWidthRatio,
    depthLineY: s.depthLineY,
    countdownRemainingMs: s.countdownRemainingMs,
    inFrame: s.inFrame,
    plankOk: s.plankOk,
    hint: s.hint,
    events: s.events.map((e) => ({ ...e })),
  };
}

const sameNumber = (a: unknown, b: unknown): boolean =>
  a === null || b === null ? a === b : typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= TOLERANCE;

/** The first difference between an expected and an actual entry, or null when they match. */
function firstMismatch(exp: Expected, act: Expected): string | null {
  for (const k of EXACT_FIELDS) {
    if (exp[k] !== act[k]) return `${k}: expected ${JSON.stringify(exp[k])}, got ${JSON.stringify(act[k])}`;
  }
  for (const k of NUMERIC_FIELDS) {
    if (!sameNumber(exp[k], act[k])) return `${k}: expected ${JSON.stringify(exp[k])}, got ${JSON.stringify(act[k])}`;
  }
  if (exp.events.length !== act.events.length) {
    return `events: expected ${JSON.stringify(exp.events)}, got ${JSON.stringify(act.events)}`;
  }
  for (let i = 0; i < exp.events.length; i++) {
    const e = exp.events[i] ?? {};
    const a = act.events[i] ?? {};
    const keys = new Set([...Object.keys(e), ...Object.keys(a)]);
    for (const key of keys) {
      const ev = e[key];
      const av = a[key];
      const ok = typeof ev === 'number' || typeof av === 'number' ? sameNumber(ev ?? null, av ?? null) : ev === av;
      if (!ok) return `events[${i}].${key}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`;
    }
  }
  return null;
}

/** Feeds the frames to a fresh counter and returns the first mismatching frame (with context), or null. */
function replay(file: GoldenFile, frames: PoseFrame[]): string | null {
  const counter = new RepCounter(file.config);
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const exp = file.expected[i];
    if (!frame || !exp) return `frame ${i}: missing frame or expected entry`;
    const act = actualOf(counter.update(frame));
    const diff = firstMismatch(exp, act);
    if (diff) {
      return [
        `${file.name}: first mismatch at frame ${i} (t = ${frame.t}): ${diff}`,
        `  expected: ${JSON.stringify(exp)}`,
        `  actual:   ${JSON.stringify(act)}`,
        `If src/core changed on purpose: npm run golden, then commit tests/fixtures/golden.`,
      ].join('\n');
    }
  }
  return null;
}

describe('golden parity fixtures (tests/fixtures/golden)', () => {
  test('the eight core sessions (01–08) are present', () => {
    const names = goldens.map((g) => g.file.name);
    for (const prefix of ['01-', '02-', '03-', '04-', '05-', '06-', '07-', '08-']) {
      expect(names.some((n) => n.startsWith(prefix)), prefix).toBe(true);
    }
  });

  for (const { path, file } of goldens) {
    describe(file.name, () => {
      test('file is well formed (format, full config, one expected entry per frame)', () => {
        expect(file.format).toBe(GOLDEN_FORMAT);
        expect(path.endsWith(`/${file.name}.json`)).toBe(true);
        // The FULL merged config, so a port never depends on its own defaults.
        expect(Object.keys(file.config).sort()).toEqual(Object.keys(DEFAULT_CONFIG).sort());
        expect(file.expected).toHaveLength(file.frames.length);
      });

      test('the current RepCounter reproduces every frame', () => {
        expect(replay(file, file.frames)).toBeNull();
      });

      test('a mirrored copy of the input gives the same output', () => {
        // x → aspect − x with left/right labels swapped (a mirrored video).
        // The counter must not depend on which side is which.
        expect(replay(file, file.frames.map(mirrorFrame))).toBeNull();
      });
    });
  }
});
