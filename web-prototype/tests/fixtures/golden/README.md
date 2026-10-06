# Golden parity fixtures

Exact inputs and the web counter's exact per-frame outputs, so a port of
`src/core` (the Swift + Apple Vision app) can prove it counts **identically**.
The full description (format, comparison rules, a Swift Testing / XCTest
harness, debugging tips) is in the handoff's `docs/ALGORITHM.md`, section
"Golden parity fixtures".

- **Written only by** `npm run golden` (`scripts/golden/exportGolden.test.ts`,
  run through `vitest.golden.config.ts`). Never edit the files by hand.
- **Checked by** `npm test` (`tests/golden.test.ts`): every file is replayed
  through the current `RepCounter` (and once more with mirrored input). If
  `src/core` changes on purpose, run `npm run golden` and commit the files.
- 16 files: `01`–`08` are the core sessions (the real laptop recording with
  targetReps 10 and 30, clean reps, mixed full/partial, absence + pause,
  tired reps, 15 fps + noise + jitter, shallow reps only); `09`–`16` cover the
  remaining branches (countdown restart/cancel, rock back, out-of-plank pause,
  "chest, not head", too slow, 6 fps, a moved phone, wrist dropouts,
  placement hints, a too-fast bounce, the baseline clamp). Each file's
  `description` and `summary` say what happens in it.

## Format `"doomscroller-golden/2"`

```jsonc
{
  "format": "doomscroller-golden/2",
  "name": "03-clean-10-reps-30fps",            // = file name without .json
  "description": "…what the session contains and what must happen…",
  "summary": { "frames": 745, "durationMs": 24800, "finalPhase": "complete",
               "finalCount": 10, "eventCounts": { "rep": 10, … } },  // for humans
  "config": { /* the FULL merged CounterConfig: construct the counter with exactly this */ },
  "frames": [ /* PoseFrame inputs, in order: { "t", "aspect", "joints" } */ ],
  "expected": [ /* one entry per frame: the snapshot after update(frames[i]) */ ]
}
```

- `frames[i]`: `t` in ms (strictly increasing), `aspect` = width / height,
  `joints` = `{ "nose": { "x", "y", "c" }, "leftShoulder": …, … }` (any joint
  may be missing) or `null` when nobody was detected. x and y are in
  image-height units of the unmirrored image, y down. Inputs were rounded
  (x, y to 6 decimals, c to 4, t to 3) BEFORE they were fed to the counter,
  so these are the exact inputs. No `world` joints.
- `expected[i]`, keys in this order: `t`, `phase`, `motion`, `count`,
  `depth`, `rawDepth`, `peakDepth`, `depthSource`, `heightRatio`,
  `baselineRatio`, `shoulderWidthRatio`, `depthLineY`,
  `countdownRemainingMs`, `inFrame`, `plankOk`, `hint`, `events` (every
  `CounterEvent` that update emitted, in order, with all its fields).
  Numbers are rounded to 9 decimals; `null` means null / nil.

## Comparison rules

Fresh `RepCounter(config)` per file, feed `frames` one by one, compare each
snapshot with `expected[i]`:

- **exact:** `phase`, `motion`, `count`, `hint`, `depthSource`, `inFrame`,
  `plankOk`; the number of events, their order, `type`, and their string /
  boolean / integer fields (`reason`, `live`, `count`, `secondsLeft`);
- **within 1e-6:** every other number (`t`, `depth`, `rawDepth`,
  `peakDepth`, `heightRatio`, `baselineRatio`, `shoulderWidthRatio`,
  `depthLineY`, `countdownRemainingMs`, and event `t`, `durationMs`,
  `elapsedMs`, `peakDepth`, `baselineRatio`);
- `null` only matches `null`.

Report the FIRST mismatching frame (both entries side by side, plus the
frames just before it): everything after it is a consequence.
