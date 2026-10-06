# Doomscroller Blocker: instructions for AI coding assistants

This repo holds two things:

| Where | What | Who |
| --- | --- | --- |
| repo root (`DoomscrollerBlocker/`, `project.yml`, `DoomscrollerBlocker.xcodeproj`) | **The native iOS app** (SwiftUI, XcodeGen, iOS 17+) | Sean (Mac) |
| `web-prototype/` | **A working web prototype of the push-up challenge** (Vite + TypeScript + MediaPipe), 200+ unit tests | Nathan (Windows) |
| `docs/` | Handoff docs: UI spec, algorithm, screenshots, the product wireframe | |

**Your main job (iOS):** build the push-up challenge into the iOS app so it
**counts exactly like** `web-prototype/src/core` and **looks like**
`docs/screenshots/phone-*.jpg`. Then continue with the rest of the wireframe.

Before writing code, read this file completely, then `docs/ALGORITHM.md` and
`docs/UI_SPEC.md`, look at every image in `docs/screenshots/`, and open
`docs/wireframe/doomscroller-blocker-wireframe.html` in a browser.

---

## 0. The product in one paragraph

When the user opens YouTube, an iOS Shortcuts automation runs the app's
**"YouTube Was Opened"** App Intent. If YouTube is locked, the app comes to the
front and the user must do **10 push-ups** in front of the front camera. The
phone is **propped up on the floor about 3 ft (1 m) in front of their head**,
and the user is in a plank with their **head toward the phone**. Every rep is
counted on-device: spoken aloud, shown as a giant number, with a floating "+1".
A full set unlocks YouTube for a pass. Nothing is recorded or uploaded. The
full flow (onboarding, Shortcuts setup, Intercept, Home, Settings, Live
Activity) is in the wireframe.

## 1. Where things stand

### The iOS app (Sean)
The work so far is stacked on branches: `main` ← `camera-preview` ←
`youtube-button` ← `pass-30min`. **The newest is `pass-30min`.** Merge the
stack (or base new work on `pass-30min`) before starting, so you don't build on
an old `main`.

- `YouTubeOpenedIntent.swift` is the Shortcuts action. While a pass is active
  it stays in the background (YouTube is left alone). Otherwise it logs the
  open and calls `continueInForeground`. This is the right design: a plain
  "Open App" automation would bounce back and forth while unlocked.
- `OpenLog.swift` holds the open events plus the pass (`startPass()`,
  `endPass()`, `isPassActive`), persisted in `UserDefaults`.
  `passDuration` is **30 min**, but the wireframe says **15 min** (Settings
  later offers 5/10/15/30). Ask the developers which they want; don't change
  it silently.
- `ContentView.swift` is currently a debug-style list (pass state, log) plus
  an "Open YouTube (30 min pass)" button that starts a pass without push-ups.
  That button is a placeholder for the push-up challenge.
- `CameraPreview.swift` / `CameraScreen` show the front camera
  (`AVCaptureSession`, preset `.high`, `.resizeAspectFill`) with a permission
  flow. **No counting yet.** This is where pose detection plugs in.
- `project.yml` (XcodeGen) is the source of truth for the Xcode project. Run
  `xcodegen` after adding files or targets. Signing uses `Config.xcconfig` +
  a personal `Local.xcconfig` (gitignored).

### The web prototype (Nathan)
Fully working on a laptop webcam and in iPhone Safari: calibration countdown,
rep counting with depth checks ("Go lower"), pause when out of frame, "too
dark", spoken counts, the "+1", a head-and-shoulders figure, a depth line,
success and gave-up screens, a debug panel with live threshold sliders,
landmark recording, and a **"Watch a demo"** mode that plays a simulated person
through the real counter. To see it:

```bash
cd web-prototype
npm install
npm run dev:laptop    # → http://localhost:5173 ; click "Watch a demo" (✕ Exit demo / Esc to leave)
npm test              # 200+ tests, including the golden parity check
npm run golden        # regenerates the golden parity fixtures
```

## 2. What is in `docs/`

| Path | What | Use it for |
| --- | --- | --- |
| `docs/ALGORITHM.md` | Port-ready reference of the push-up counter: formulas, state machine, every constant and why, Swift/Vision notes, golden-test format | Writing `Core/` |
| `docs/UI_SPEC.md` | Every screen of the web prototype as built: tokens, sizes, copy, states, animations, overlay drawing, timing, and a wireframe-coverage table | Writing the challenge UI |
| `docs/screenshots/phone-*.jpg` | The prototype at iPhone size: start, placement/countdown, challenge, "+1", "Go lower", paused, success, gave up, camera off | **The visual target** |
| `docs/screenshots/laptop-*.jpg` | The same on a laptop, plus the debug view | Reference |
| `docs/wireframe/` | The original product wireframe (HTML + text) | Screens the prototype doesn't have yet |
| `docs/HANDOFF.md` | A plain-language intro for humans | |
| `web-prototype/tests/fixtures/laptop-session-1.json` | A REAL recorded set (landmarks only, 13 push-ups) | Parity test |
| `web-prototype/tests/fixtures/golden/*.json` | Exact inputs + the web counter's exact per-frame outputs | Parity tests for the Swift port |

**When sources disagree:** behaviour → `web-prototype/src/core` and its tests
win over prose. Look of the challenge screens → `docs/screenshots` +
`docs/UI_SPEC.md` win over the wireframe (the prototype refined it). Screens
the prototype doesn't have → the wireframe.

## 3. Plan (milestones, in order)

Show each milestone to the developers on a real iPhone before moving on.

### M0: Spike: can Vision track this pose? (FIRST, about half a day)
The biggest technical risk is the camera angle: a plank seen **head-on from
10–15 cm off the floor** is strongly foreshortened. In `CameraScreen`, add an
`AVCaptureVideoDataOutput`, run `VNDetectHumanBodyPoseRequest` on each frame,
and draw the raw joints with their confidence and the fps. Test real push-ups
with the phone propped up on the floor ~3 ft away.
- **Pass:** shoulders and at least one wrist are tracked with sensible
  confidence through full reps at ≥15 fps.
- **If Vision struggles:** use the **MediaPipe Tasks iOS SDK**
  (`MediaPipeTasksVision` via CocoaPods; `PoseLandmarker` with
  `pose_landmarker_full.task`). It returns exactly the same 33 landmarks as the
  web prototype, which makes parity easiest. Keep the backend behind a
  protocol so either one can feed the core.

### M1: Port the core and prove parity
Port `web-prototype/src/core/*.ts` to `DoomscrollerBlocker/Core/*.swift` **line
by line** (rules in §4). Add a unit-test target (§7) and the parity tests.
- **Pass:** every golden fixture matches (phase, motion, count, hint, events
  exactly every frame; numbers within 1e-6). Replaying `laptop-session-1.json`
  gives **13 reps, 0 partials** (targetReps 30), or 10 reps then `complete`
  (targetReps 10).

### M2: Simulator and demo mode
Port `web-prototype/src/sim/pushupSimulator.ts` and `web-prototype/src/demo/*`.
The **iOS Simulator has no camera**, so the demo is how anyone sees the real
challenge UI without a device. Add a debug-only way to step frames, like the
web's `window.__demo.step(n)`.

### M3: Challenge UI parity
Build the challenge screens per `docs/UI_SPEC.md`, matching
`docs/screenshots/phone-*.jpg`: Placement (setup tips, hints, "You're in
frame", countdown), Challenge (segment bar, voice chip, giant count, DEPTH
gauge, depth line, body figure, "+1", "Go lower" + "Didn't count",
chest-not-head cue, paused "Can't see you" / "Hands in view" / "Move
closer" / "Move back" / "Back to plank", too dark), Success, Gave up, Camera
off, and a debug panel.
- **Pass:** side by side with the phone screenshots, nobody can tell which is
  which at arm's length.

### M4: Wire it into the app flow
`YouTubeOpenedIntent` (locked) → app in front → **Intercept** (wireframe
screen 2: "10 push-ups to open YouTube", Start / Give up) → Placement →
Challenge → **Success** → `OpenLog.shared.startPass()` → open `youtube://`
automatically after 3 s (wireframe screen 5). Give up → wireframe screen 6.
Replace the placeholder "Open YouTube (30 min pass)" button with this flow
(keeping a debug path is fine). Also: live camera → pose → `PoseFrame` →
`RepCounter`, spoken counts, idle timer off during a set, "too dark" from
luminance, pause/resume on `scenePhase`, and **recording export** (share the
same JSON `Recording` format as the web) so real sets can be sent back for
tuning.
- **Pass:** open YouTube → do 10 real push-ups → YouTube opens, and stays open
  for the pass. Shallow reps say "Go lower"; walking away pauses.

### M5: On-device tuning
Record real sets (normal, tired, shallow, walking away, dim room). Replay them
through the Swift core in tests and tune the Vision-specific thresholds (§5).
Add good recordings as fixtures.

### Phase 2: the rest of the wireframe
Onboarding (1a welcome, 1b camera primer, 1c Shortcuts guide, 1d test), Home
(7, which grows out of today's log screen), Settings (9: reps, exercise, unlock
time), Add app (10), Live Activity / Dynamic Island (11a–c), stats (8). See the
coverage table in `docs/UI_SPEC.md`. An alternative to Shortcuts for later:
the Screen Time API (`FamilyControls` / `ManagedSettings` / `DeviceActivity`)
can shield YouTube directly, but it needs Apple's Family Controls entitlement
for distribution, so check the current requirements first.

## 4. Porting rules for `Core/` (non-negotiable)

- **Translate, don't redesign.** Keep the same type, field and function names,
  the same constants and `DEFAULT_CONFIG` values, and the same branch order.
  Keep the comments: they explain *why* each rule exists and were learned
  from testing.
- **Double everywhere** (JavaScript numbers are 64-bit floats).
- **Time is milliseconds from frame timestamps** (`CMSampleBuffer`
  presentation time → ms, strictly increasing). Never count frames: iPhone
  frame rates vary.
- **No UIKit, AVFoundation or Vision in `Core/`.** Keep it pure Swift, so it
  runs in unit tests and stays identical to the web version.
- `CounterEvent` becomes an `enum` with associated values. `CounterSnapshot`
  and `Features` become structs. `Recording` becomes `Codable` and must decode
  the web's JSON files as-is.
- **Get parity first; no "improvements" while porting.** Any later behaviour
  change must be made in both implementations, with the golden files
  regenerated from the web version (`npm run golden`), so the two never drift.

## 5. Coordinate and camera conventions (the usual source of bugs)

The core only sees a `PoseFrame` (see `docs/ALGORITHM.md`):
- **Unmirrored** camera image, **y pointing down**, and **both axes in units
  of the image height** (x ∈ [0, aspect], y ∈ [0, 1], aspect = width / height
  of the upright frame).
- `c` = confidence 0…1, and **0 for joints that are missing or outside the
  image**.
- "left"/"right" are the **person's** left and right. The counter is
  symmetric, so mirrored input gives identical counts (tested).

From Vision to `PoseFrame`:
- Vision points are normalized with the **origin at the bottom-left**:
  `y_core = 1 − y_vision` and `x_core = x_vision × aspect`.
- Have the capture connection deliver **upright, unmirrored** portrait
  buffers: `videoRotationAngle = 90` (iOS 17),
  `automaticallyAdjustsVideoMirroring = false`, `isVideoMirrored = false`. Then
  pass `.up` to `VNImageRequestHandler`. Check once: raise your **right** hand
  and `rightWrist` should move.
- The preview layer stays the usual mirrored selfie view. Mirror the overlay
  the same way, but never mirror text. On phones the preview uses
  `.resizeAspectFill` (cover); map the overlay with the same fit math (see
  `docs/UI_SPEC.md`, overlay section).
- Use a lighter capture preset than `.high` (for example `.hd1280x720` or
  `.vga640x480`). Vision downsamples anyway, and it saves battery and heat.
- **Confidence thresholds don't transfer.** The web tuned
  `visibilityThreshold` 0.5 and `wristVisibilityThreshold` 0.4 on MediaPipe
  `visibility`. Start Vision at around **0.3 / 0.25**, show confidences in the
  debug panel, and tune from recordings (M5).
- MediaPipe smooths landmarks over time; Vision is per-frame and jumpier. If
  needed, smooth per joint **in the adapter, not in the core**.
- Run Vision on the video-output delegate's serial queue with
  `alwaysDiscardsLateVideoFrames = true`, and publish snapshots to the main
  actor for SwiftUI.

## 6. Web → iOS equivalents

| Web prototype (`web-prototype/src/...`) | iOS |
| --- | --- |
| `platform/camera.ts` (getUserMedia, front, 640×480, 30 fps) | Extend `CameraPreview`: `AVCaptureSession` + `AVCaptureVideoDataOutput` |
| `platform/poseDetector.ts` (MediaPipe PoseLandmarker) | `VNDetectHumanBodyPoseRequest` (or MediaPipe Tasks iOS) |
| `platform/mediapipeMapping.ts` (`toPoseFrame`) | A `VisionMapping.toPoseFrame(observation, aspect, tMs)` |
| `platform/frameLoop.ts` | `AVCaptureVideoDataOutputSampleBufferDelegate` |
| `platform/speech.ts` | `AVSpeechSynthesizer`; `AVAudioSession` `.playback` + `.duckOthers` so counts play with the silent switch on |
| `platform/wakeLock.ts` | `UIApplication.shared.isIdleTimerDisabled` |
| `platform/luminance.ts` | Mean of a downsampled luma (Y) plane of the `CVPixelBuffer`, about twice a second |
| `visibilitychange` | `scenePhase` |
| `ui/settings.ts` (localStorage) | `@AppStorage` / `UserDefaults` |
| `platform/recorder.ts` (download / share sheet) | `ShareLink` with the JSON file |
| `ui/overlay.ts`, `ui/figure.ts` (canvas) | SwiftUI `Canvas` over the preview |
| CSS animations ("+1", count bump, cues) | `withAnimation` / `.transition` / `PhaseAnimator` (timings in UI_SPEC) |
| Barlow Condensed (Google Fonts) | Bundle the OFL font files; register at runtime with `CTFontManagerRegisterFontURLs` (works with `GENERATE_INFOPLIST_FILE`) |

## 7. Tests

Add a unit-test target to `project.yml`, roughly like this (check it with
`xcodegen`):

```yaml
targets:
  DoomscrollerBlocker:
    # ...existing settings...
    scheme:
      testTargets: [DoomscrollerBlockerTests]
  DoomscrollerBlockerTests:
    type: bundle.unit-test
    platform: iOS
    sources:
      - DoomscrollerBlockerTests
      - path: web-prototype/tests/fixtures   # one source of truth for fixtures
        type: folder
        buildPhase: resources
    dependencies:
      - target: DoomscrollerBlocker
    settings:
      base:
        GENERATE_INFOPLIST_FILE: YES
```

Tests to write:
- **Golden parity:** for each `golden/*.json`, feed `frames` through a fresh
  `RepCounter(config)` and compare with `expected[i]` every frame. These must
  match exactly: phase, motion, count, hint, depthSource, inFrame, plankOk and
  events. Numbers must be within 1e-6, and `null` stays `nil`.
- **Fixture replay:** `laptop-session-1.json` gives 13 reps and 0 partials
  (targetReps 30); 10 reps + complete (targetReps 10).
- **Simulator:** port the key cases from `web-prototype/tests/`
  (`repCounter.test.ts`, `flexibleReturn.test.ts`, `robustness.test.ts`):
  - full reps count
  - shallow reps never count, and each gets one "Go lower"
  - long holds produce no events
  - walking away pauses and resumes, keeping the count
  - fast (300 ms) and slow (2 s) reps count
  - tired reps that come back only to 135° still count, and shallow reps
    from that tired top each get "Go lower"
  - a bounce halfway up counts once; pulsing in the bottom half counts at
    most once
  - calibration works at 6 fps
  - mirrored input gives identical counts

## 8. Decisions and known issues

- Thresholds (`downThreshold` 0.25 ≈ a 95–100° elbow, `returnFraction` 0.3, …)
  were tuned on a geometric simulator plus one real laptop session. **Re-tune
  for iPhone + Vision** from recordings (M5), not by intuition.
- A rep counts on the way **back up**: once the user is 70% of the way up from
  their deepest point (and at least back above `partialMinDepth`, about a
  125° elbow), never at the bottom. This came from real data (tired reps
  stopping short); see `returnFraction` in `repCounter.ts` and
  `docs/ALGORITHM.md` §5.
- The 3-2-1 countdown restarts if the user moves (including their hands)
  during it. That's intended: the baseline must come from a still plank.
- Knee push-ups can't be told apart from this camera angle and currently
  count. That's a product decision for later.
- **Pass length:** 15 min (wireframe) vs 30 min (current code). Ask.
- Never save or upload video. Landmark JSON is exported only when the user
  asks.

## 9. Working with the developers

Nathan (web prototype, on Windows) and Sean (iOS, on a Mac) are building this
together. Keep explanations plain, show progress on a real device early (M0),
and ask before making product decisions the wireframe doesn't answer.
