# Doomscroller Blocker: push-up detection prototype

A web page that uses a camera to count push-ups. It's the first building
block of the Doomscroller Blocker app: do 10 push-ups, earn 15 minutes of
YouTube.

You can test it two ways:

- **On your laptop** (quickest): the laptop's webcam, in Chrome or Edge.
- **On your iPhone**: your PC runs the page and the iPhone opens it in Safari
  over Wi-Fi.

Body tracking runs **on the device with the camera**. No video is ever saved
or uploaded.

---

## 1. One-time setup (on your PC)

You need [Node.js](https://nodejs.org) (already installed on this PC). Open a
terminal in this folder and run:

```bash
npm install
```

> **PowerShell says "running scripts is disabled on this system"?** That's a
> Windows default that blocks `npm`'s PowerShell script. Type `npm.cmd`
> instead of `npm` (for example `npm.cmd install`, `npm.cmd run dev`), or use
> Command Prompt instead of PowerShell. To fix it permanently, run
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once and answer `Y`.

## 2. Test on your laptop

```bash
npm.cmd run dev:laptop
```

Open **http://localhost:5173** in **Chrome or Edge** and click **Start**. Allow
the camera when the browser asks. Leave the terminal open while you test;
press `Ctrl+C` to stop.

1. Put the laptop **on the floor**, screen **tilted back** so the webcam looks
   up at you.
2. Get into a plank about **3 ft (1 m)** away with your **head toward the
   screen**. Your head, shoulders and hands should all be in the picture.
3. Then do a set as described in [Do a set](#4-do-a-set).

The page uses the laptop layout: the whole camera picture is shown, and the
count is big enough to read from the floor.

## 3. Test on your iPhone

### Start the page

```bash
npm run dev
```

You'll see something like:

```
  ➜  Local:   https://localhost:5173/
  ➜  Network: https://10.29.155.250:5173/
```

The **Network** address is the one your phone needs. Leave this terminal
open while you test. Press `Ctrl+C` to stop.

(`npm run dev` and `npm run dev:laptop` both use port 5173, so run one at a
time.)

### Open it on your iPhone

1. Put your iPhone on the **same Wi-Fi** as the PC.
2. In **Safari**, type the Network address exactly, including `https://` and
   `:5173`. (With `http://`, Safari only says the server unexpectedly
   dropped the connection.)
3. Safari says **"This Connection Is Not Private"**. That's expected: the
   page uses a security certificate made on your own PC. Tap **Show Details**,
   then **visit this website**, then **Visit Website**.
4. Tap **Start** and allow camera access.

> The page won't load (it spins, then times out)? Your Wi-Fi is probably
> blocking devices from talking to each other. Campus networks often do. See
> [Can't connect](#cant-connect) below.

### Set up the phone

1. Turn on **Portrait Orientation Lock** (Control Center), so the screen
   doesn't rotate when you prop the phone up.
2. Prop the phone up on the floor, **upright, screen facing you**, leaning
   back slightly against something (a shoe or a book).
3. Get into a plank about **3 ft (1 m)** away with your **head toward the
   phone**. Your head, shoulders and hands should all be on screen.
4. The page keeps the screen on by itself. If it says **The screen may
   lock**, set Settings › Display & Brightness › **Auto-Lock** to 5 minutes
   while you test.

## 4. Do a set

1. When it says **You're in frame**, hold still. It counts down 3-2-1 by
   itself and measures your plank height.
2. A dashed **DEPTH** line appears across the picture. Do push-ups: a rep
   counts when your **shoulders sink to the line** (about 90° at the elbows)
   and you come **most of the way back up** (70% of the way from your lowest
   point, and clearly out of the bottom half; you don't need to lock out
   perfectly).
   - The line turns **solid** when you've gone low enough on this rep.
   - Each counted rep pops a big **+1** above your head, and the count is
     spoken aloud.
   - Not low enough? The line and your body outline turn **orange**,
     **Go lower** flashes and the rep doesn't count.
   - Walk out of view and it **pauses**, keeping your count. The paused
     screen says what it's waiting for (can't see you, hands in view, move
     closer or back, back to plank).
3. Reach the target and you get the **Scroll earned** screen.

## 5. Watch a demo (no camera, no push-ups)

Click **Watch a demo** on the start screen (or open
http://localhost:5173/?demo). A simulated person does a set through the
real counter: a plank, the 3-2-1, three good reps, one rep that's too
shallow ("Go lower"), walking out of view (paused), coming back, and reps up
to the target. It's the quickest way to see every screen. Click
**✕ Exit demo** (bottom corner) or press **Esc** to go back to the start
screen.

## 6. The debug view (what all the numbers mean)

The debug view is on by default. It's how we check that detection actually
works. Click the small chip in the bottom corner (bottom right on a laptop,
bottom left on a phone; it says **debug**, then shows the fps) to open the
panel; on a laptop it opens as a column on the right, beside the picture.

- **Body outline**: the dots and lines the tracker sees on your body. Green
  dots mean confident, red means guessing. Guessed joints are also drawn
  dashed.
- **Depth graph**: how low you are over the last 10 seconds. 0 is your plank;
  higher means lower to the floor. The lines are the thresholds: a rep must
  cross the top line ("down"), then come back up past the middle line
  ("partial") or 70% of the way from its lowest point, whichever is higher
  up. The bottom line ("up") is a full lockout; a rep never has to go past it.
  A dip past "partial" that never reaches "down" is a "Go lower".
- **Sliders**: change how strict the counter is, live. The DEPTH line moves
  with the "down" slider.
- **fps**: frames analysed per second. Under ~12 it may miss fast reps; switch
  the model to **Lite** on the start screen.

## 7. Testing without doing push-ups every time

- **Test with a video file**: record a set with the iPhone Camera app (front
  camera, phone on the floor), then choose it from the start screen. The page
  counts reps from the video on a loop.
- **Record landmarks**: turn this on before a set, then tap **Save recording**
  afterwards. It saves a small `.json` file with body positions only, no video.
  On a laptop it goes straight to your **Downloads** folder; on an iPhone the
  share sheet opens (Save to Files). Send these files back to tune the counter
  on real data. `tests/fixtures/laptop-session-1.json` is one of these, and
  the tests replay it.

---

## Can't connect

If the phone can't open the Network address:

- **Use your iPhone's Personal Hotspot** (simplest). On the iPhone: Settings ›
  Personal Hotspot › on. On the PC: connect to the iPhone's hotspot Wi-Fi.
  Run `npm run dev` again and use the new **Network** address it prints
  (it starts with `172.20.10.`).
- **Use a temporary public link** (Cloudflare tunnel). Install the tool once
  with `winget install Cloudflare.cloudflared`. Keep `npm run dev` running and,
  in a second terminal, run `npm run tunnel`. Open the
  `https://….trycloudflare.com` address it prints. There's no certificate
  warning, but anyone with that link can open the page while the tunnel runs.
  Press `Ctrl+C` to close it.
- Windows asked about **Node.js** network access? Allow it.

## Other problems

| You see | Fix |
| --- | --- |
| "Camera is off" (iPhone) | In Safari, tap the page menu button at the left of the address bar (**aA** on older iOS) › **Website Settings** (under **More** on newer iOS) › **Camera** › **Allow**, then **Try again**. |
| "Camera is off" (laptop) | Click the camera icon with the red ✕ at the **right** end of the address bar (or the site settings icon at its left) › **Allow**, then **Try again**. Still blocked? Windows Settings › Privacy & security › Camera. |
| "Camera is busy" (laptop) | Close other apps using the webcam (Teams, Zoom, the Camera app), then **Try again**. |
| Safari says the server unexpectedly dropped the connection (iPhone) | You typed `http://`. Type the address with `https://` and `:5173`. |
| "Open the localhost address" (laptop) | Run `npm.cmd run dev:laptop` and open exactly `http://localhost:5173`. |
| "Too dark" | Turn on a light or face a window. |
| "Can't see you" | Head, shoulders and hands in frame, camera about 3 ft away. |
| "Hands in view", "Move closer" or "Move back" while paused | Do what it says and hold a plank; counting carries on by itself. |
| "The screen may lock" (iPhone) | Settings › Display & Brightness › Auto-Lock › 5 minutes. |
| Counts are spoken too quietly or not at all | Turn up the volume. Spoken counts are optional; the on-screen number is what matters. |
| Page reloaded after the phone locked | Normal during development. Tap **Start** again. |

## For developers

```bash
npm test           # run the unit tests (simulated push-ups, no camera needed)
npm run golden     # after an intentional change to src/core: rewrite tests/fixtures/golden
npm run typecheck  # TypeScript check
npm run build      # production build into dist/
```

- `src/core/`: the push-up counting logic. Pure TypeScript with no browser
  code, so it can be ported to Swift + Apple Vision for the native app.
- `src/platform/`: camera, MediaPipe body tracking, speech, screen wake lock,
  recording.
- `src/app.ts`, `src/ui/`: the screens, the body outline and the DEPTH line.
- `src/sim/pushupSimulator.ts`: models a push-up in 3D and projects it
  through a floor-level camera. The tests use it to check the counter against
  real geometry, and the demo uses it for the simulated person.
- `src/demo/`: the "Watch a demo" script and player.
- `tests/`: unit tests. `tests/fixtures/golden/` holds exact inputs and
  outputs of the counter so the Swift port can prove it counts the same
  (see its README); `npm test` fails if the counter changes without
  `npm run golden`.
- On the dev server only, the browser console has `__demo.start()`,
  `__demo.step(30)` (play 30 demo frames right now) and `__demo.state()`, for
  checking the screens without waiting.
