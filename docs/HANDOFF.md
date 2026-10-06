# Handoff: push-up detection → iOS app

Hi Sean! This adds the **push-up counting** part of Doomscroller Blocker,
built and tested as a web prototype, plus everything your AI needs to bring it
into the iOS app.

**What works in the prototype:** the camera sees your head, shoulders and
arms; a 3-2-1 countdown measures your plank; each push-up is counted out loud
with a giant number and a "+1"; shallow reps get "Go lower"; leaving the frame
pauses the set; a dashed depth line shows how low to go. It works on a laptop
webcam and in iPhone Safari.

**What's next:** the same experience natively in your app (Swift + Apple
Vision), hooked into your "YouTube Was Opened" intent and pass.

## 1. See it (5 minutes)

You'll need [Node.js](https://nodejs.org):

```bash
cd web-prototype
npm install
npm run dev:laptop
```

Open **http://localhost:5173** and click **Watch a demo**: a simulated person
does a full set (✕ Exit demo or Esc to leave). Or click **Start** to try it
with your MacBook camera: laptop on the floor, screen tilted back, push-ups
~3 ft away with your head toward it.

## 2. Hand it to your AI

Merge your branch stack first (`camera-preview` → `youtube-button` →
`pass-30min`), so it builds on your latest work. Then open the repo in Claude
Code (it reads `CLAUDE.md` automatically) and say something like:

> Read CLAUDE.md fully, then docs/ALGORITHM.md and docs/UI_SPEC.md, look at
> docs/screenshots and the wireframe. Explain the plan, then start with
> milestone M0: add Vision body-pose detection to CameraScreen and check it
> can track push-ups with the phone propped up on the floor.

With another assistant, give it `CLAUDE.md` first (`AGENTS.md` points tools
like Cursor and Codex there).

## What's here

| | |
| --- | --- |
| `CLAUDE.md` | The plan for the AI: milestones, porting rules, camera/Vision details, how it plugs into your intent + pass |
| `docs/UI_SPEC.md` | Every screen, color, size, word and animation of the challenge |
| `docs/ALGORITHM.md` | Exactly how push-ups are counted, written for translating to Swift |
| `docs/screenshots/` | What the challenge should look like (iPhone and laptop sizes) |
| `docs/wireframe/` | The full product design. Open the `.html` in a browser. |
| `web-prototype/` | The prototype code, 200+ tests, a real recorded workout and "golden" files (`tests/fixtures/golden/`) that prove the Swift version counts identically |

## The plan in short

1. **M0 (first):** can Apple Vision track push-ups filmed from the floor? If
   not, use Google's MediaPipe (what the prototype uses).
2. **M1:** translate the counter to Swift and prove it matches the web version
   exactly.
3. **M2:** the "Watch a demo" mode, so the UI runs in the iOS Simulator
   (which has no camera).
4. **M3:** rebuild the challenge screens to match the screenshots.
5. **M4:** wire it in: YouTube opens → push-ups → success → pass → YouTube.
6. **M5:** record real sets and fine-tune on an iPhone.
7. **Then:** the rest of the wireframe (onboarding, home, settings, Lock
   Screen timer).

One decision for you two: **pass length.** The wireframe says 15 minutes and
the app currently uses 30.
