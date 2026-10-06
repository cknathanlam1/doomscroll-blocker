# UI spec: the push-up challenge as built in the web prototype

This is the complete visual and interaction spec of the web prototype **as it
is built today**, written so an iOS agent can rebuild it in SwiftUI without
reading the web code. Portrait iPhone is the target. Laptop-only differences
are collected in §9.

- **Visual target:** `docs/screenshots/phone-*.jpg`. This file gives the
  numbers, words, states and timings behind those images.
- **Sources** (all paths under `web-prototype/`): `index.html` (every element
  and static string), `src/styles.css` (every size and colour),
  `src/app.ts` (flow, events, speech, timers), `src/ui/*.ts` (screens,
  overlay, debug panel, settings), `src/demo/*.ts` (demo mode),
  `src/platform/speech.ts`, `src/platform/camera.ts`,
  `src/core/trackingIssue.ts`.
- **When this file and the code disagree, the code wins.** Counting
  behaviour is specified in `docs/ALGORITHM.md`; this file only covers what
  the UI does with the counter's output.

**Conventions**
- `px` in the web = `pt` in iOS: at the same 390 pt screen width, 1 CSS px =
  1 pt. "Phone" numbers below are for the base (portrait) stylesheet.
- **Measured layout** figures (y = …) are computed from the CSS for a
  **390 × 844 pt** screen with **zero safe-area insets**, which is how all
  phone screenshots were captured. They were checked against the screenshots
  and agree within about 2 pt. On a real notched iPhone add the safe-area
  insets (see §1.6).
- Screenshot pixels → points: `phone-01/02/03/04/06` are 780 × 1688 (÷ 2);
  `phone-05/07/08/09` are 488 × 1055 (÷ 1.251). Both are 390 × 844 pt.
  `laptop-*` are about 800 × 500 (downscaled).
- Strings in `code` or quotes are verbatim. Curly quotes, `·`, `…`, `—`,
  `›` and `✕` are real Unicode characters, so copy them exactly.
- The design rule behind everything on the camera screens: **it is read from
  about 3 ft away with the phone on the floor.** Giant numbers, high
  contrast, one instruction at a time, almost no words.

---

## 1. Design tokens

### 1.1 Colours

Core tokens (`:root` in `src/styles.css`; the same values are hard-coded in
`src/ui/overlay.ts` and `src/ui/chart.ts` for canvas drawing):

| Token | Hex | Role |
| --- | --- | --- |
| `--page` | `#0B0B0D` | Page background of every non-camera screen ("one dark world") |
| `--panel` | `#17171B` | Cards, settings group, camera-error steps card |
| `--panel2` | `#202026` | Secondary button, "YouTube is locked" pill, icon tiles, segmented/stepper backgrounds, step-number circles |
| `--line` | `#2C2C33` | Separators in the settings group |
| `--fg` | `#F5F5F2` | Primary text (warm white) |
| `--mute` | `#8E8E96` | Secondary text, ghost buttons |
| `--dim` | `#55555D` | Tertiary text, spinner track, disabled stepper button, diagram floor line |
| `--volt` | `#FFD43B` | **The one accent.** Count, figure, depth line, gauge mark, primary buttons, Success background, icons in tips |
| `--volt-ink` | `#191300` | Text and icons on volt |
| `--volt-soft` | `rgba(255,212,59,0.14)` | Defined, currently unused |
| `--ok` | `#32D74B` | "You're in frame" bar, corner brackets, switch "on", confident joints in debug |
| `--warn` | `#FF9F0A` | "Go lower", "Didn't count", partial rep (figure, depth line, gauge), chest cue |
| `--bad` | `#FF453A` | Camera-off icon, env banner, error badge, unsure joints in debug |

Other literal colours used (exact values):

| Value | Where |
| --- | --- |
| `#000000` | Camera stage background; `theme-color` while on the stage |
| `#636366` | Selected segment in segmented controls |
| `#FFFFFF` | Switch knob |
| `#03230A` | Text and check icon on the green "You're in frame" bar |
| `#1D0F00` | Text and icon on the orange "Go lower" cue |
| `#FFB4AE` | Env-banner text; error-log entry headings |
| `#D9D9DC` | Debug panel body text |
| `rgba(255,255,255,0.18)` | Unfilled segment in the segment bar |
| `rgba(255,255,255,0.14)` | Gauge track; 1 px inner outline of the voice chip |
| `rgba(255,255,255,0.16)` | 1 px inner outline of toast and debug chip |
| `rgba(255,255,255,0.42)` | "Give up" text |
| `rgba(255,255,255,0.5)` | Ghost silhouette dashed outline |
| `rgba(0,0,0,0.55)` | Voice chip and demo tag background |
| `rgba(0,0,0,0.6)` | "Paused" pill, debug chip, DEPTH tag (idle/partial) background |
| `rgba(0,0,0,0.62)` | Chest cue background |
| `rgba(0,0,0,0.74)` | Debug panel body background (plus 6 px backdrop blur) |
| `rgba(0,0,0,0.75)` | Toast background |
| `rgba(0,0,0,0.25)` | Fill inside the overlay head circle |
| `rgba(255,159,10,0.2)` | "Didn't count" pill background |
| `rgba(255,159,10,0.5)` | 1 px inner outline of the chest cue |
| `rgba(255,212,59,0.45)` | 1 px inner outline of the demo tag |
| `rgba(23,23,27,0.86)` | Placement diagram card (plus 8 px backdrop blur) |
| `rgba(5,5,4,0.9)` | "Too dark" overlay |
| `rgba(11,11,13,0.92)` | Loading overlay |
| `rgba(11,11,13,0.94)` | "Tap to resume" overlay |
| `rgba(255,69,58,0.14)` + inner 1 px `rgba(255,69,58,0.4)` | Env banner (web only) |
| `#151210 → #2A241E (58%) → #4A4034 (74%) → #3A3128 (100%)`, vertical, plus radial `rgba(255,220,170,0.10)` | Demo's fake camera picture (§5.4) |
| `#16110D`, `#120E0B`, `#1A140F` | Demo silhouette body, torso, head (§3.8) |

Status-bar / browser chrome colour per screen (`THEME_COLORS` in
`src/ui/screens.ts`): Start `#0B0B0D`, camera stage `#000000`, Success
`#FFD43B`, Gave up `#0B0B0D`, Camera error `#0B0B0D`. On iOS use
`.preferredColorScheme(.dark)` / light status-bar content everywhere except
**Success, which needs dark status-bar content** (it is volt).

### 1.2 Fonts

| Use | Family | Weights used |
| --- | --- | --- |
| UI text | System font (`-apple-system`, i.e. SF Pro) | 500, 600, 650, 700, 750, 800 |
| Numerals and display words (count, countdown, hero, "+1", "GO LOWER", "CAN'T SEE YOU", "TOO DARK", "TAP TO RESUME", "SCROLL EARNED.", DEPTH labels, "/10", "PROTOTYPE", stepper value, "~3 FT") | **Barlow Condensed** | 800 (ExtraBold), 900 (Black), 900 italic (Black Italic, only "SCROLL EARNED.") |
| Debug text, env line | Monospace (`ui-monospace`, SF Mono) | 400, 600 |

**Barlow Condensed** is an OFL (SIL Open Font License) Google Font. The web
loads it from Google Fonts; iOS must **bundle** it. Only three files are
needed, from `github.com/google/fonts/tree/main/ofl/barlowcondensed`:
`BarlowCondensed-ExtraBold.ttf`, `BarlowCondensed-Black.ttf`,
`BarlowCondensed-BlackItalic.ttf`. Include `OFL.txt` in the app bundle or
its acknowledgements.

Register them at launch. This works with a generated Info.plist
(`GENERATE_INFOPLIST_FILE`):

```swift
import CoreText

enum AppFonts {
    static func register() {
        for name in ["BarlowCondensed-ExtraBold", "BarlowCondensed-Black", "BarlowCondensed-BlackItalic"] {
            guard let url = Bundle.main.url(forResource: name, withExtension: "ttf") else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
        // Batch alternative: CTFontManagerRegisterFontURLs(urls as CFArray, .process, true, nil)
    }
}
// Use: Font.custom("BarlowCondensed-Black", size: 200)
// Check the PostScript names once with UIFont.fontNames(forFamilyName: "Barlow Condensed").
```

Alternatively, list the three files under `UIAppFonts` in the Info.plist. In
XcodeGen that goes under the target's `info.properties`.

**System font weights:** SwiftUI's named weights are 500 = `.medium`,
600 = `.semibold`, 700 = `.bold`, 800 = `.heavy`. iOS Safari renders the
in-between CSS weights 650 and 750 exactly, because SF Pro is variable. To
match exactly, use `UIFont.systemFont(ofSize:weight: UIFont.Weight(0.35))`
for 650 (between semibold 0.3 and bold 0.4) and `UIFont.Weight(0.48)` for
750. Otherwise use `.semibold` for 650 and `.bold` for 750.

**Shared numeral style** (CSS class `.big`): Barlow Condensed **900**,
`line-height: 0.82`, `letter-spacing: -0.02em`, tabular figures. In
SwiftUI: `.font(.custom("BarlowCondensed-Black", size: s))`,
`.monospacedDigit()`, `.tracking(-0.02 * s)`. The 0.82 line height means the
text box is only 0.82 × s tall, so neighbouring elements sit tight against
the glyphs. SwiftUI can't set line height below the font's natural height,
so give these Texts a fixed frame height of `0.82 * s` with bottom
alignment, or use negative padding, and compare against the screenshots.

Letter-spacing in `em` → SwiftUI `.tracking(em × fontSize)`.

### 1.3 Type scale (phone)

"Sys" = system font. Sizes in pt. LH = line height (multiplier).

| Element (DOM id / class) | Font | Size | Weight | LH | Tracking | Case | Colour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Body default | Sys | 15 | 400 | 1.45 | | | fg |
| Start hero number `#hero-reps` `.hero-n` | Barlow | `clamp(150, 46% of screen width, 220)` = **179.4** at 390 wide | 900 | 0.82 | −0.02em | | volt |
| "PUSH-UPS" `.hero-unit` | Barlow | 52 | 900 | 0.9 | | UPPER | fg |
| "to open YouTube" `.hero-sub` | Sys | 20 | 650 | 1.45 | | | fg |
| Start note `.hero-note` | Sys | 14 | 400 | 1.4 | | | mute |
| Pills `.pill` | Sys | 13 | 650 | | | | per pill |
| "PROTOTYPE" `.pill.proto` | Barlow | 13 | 800 | | +0.08em | UPPER | mute |
| Buttons `.btn` | Sys | 17 (Start `.xl`: 19) | 650 | | | | per variant |
| Ghost buttons `.btn.ghost` | Sys | 15 | 500 (`.ink` variant: 650) | | | | mute / volt-ink |
| Tip `.tip` | Sys | 13.5 | 400 | 1.4 | | | mute |
| "SETTINGS" `.glabel2` | Sys | 12.5 | 500 | | +0.04em | UPPER | mute |
| Settings rows `.group .it` | Sys | 15 | 400 | | | | fg |
| Settings footer `.gfoot` | Sys | 12 | 400 | 1.35 | | | mute |
| Segmented buttons `.seg button` | Sys | 13 | 600 | | | | mute; selected fg |
| Stepper value `#set-reps` | Barlow | 20 | 800 | | | | fg |
| Stepper −/+ | Sys | 20 | 400 | 1 | | | fg (disabled: dim) |
| Big headline `.h-xl` (Gave up, Camera error) | Sys | 30 | 800 | 1.08 | −0.02em | | fg |
| Placement title `.h-l` "Prop it up" | Sys | 22 | 750 | 1.12 | −0.015em | | fg |
| Body text `.txt` | Sys | 15 | 400 | 1.4 | | | mute |
| Small text `.small` | Sys | 12.5 | 400 | 1.4 | | | mute |
| Steps `.steps li` | Sys | 14 | 400 | 1.35 | | | fg |
| Step number badge | Sys | 13 | 700 | | | | volt on panel2 |
| Placement hint `#place-hint` `.hint` | Sys | 26 | 800 | 1.12 | −0.01em | | fg |
| "You're in frame" `.inframe` | Sys | 20 | 800 | | | | `#03230A` on ok |
| "Hold plank." `.cd-label` | Sys | 22 | 700 | 1.2 | | | fg |
| "Starting in" `.cd-label span` | Sys | 22 | 500 | 1.2 | | | mute |
| Countdown digit `#cd-n` | Barlow | `min(150, 20% of screen height)` = **150** at 844 tall | 900 | 0.82 | −0.02em | | volt |
| Voice chip `#voice` | Sys | 13 | 650 | | | | fg; the word in volt |
| Count `#count` | Barlow | `min(200, 27% of screen height)` = **200** at 844 tall (paused: 110) | 900 | 0.82 | −0.02em | | volt (paused: fg) |
| "/10" `#count-of` `.of` | Barlow | 58 (paused: 36) | 800 | 1 | | | fg at 92% opacity |
| "DEPTH" gauge label `.glabel` | Barlow | 14 | 800 | | | UPPER | volt |
| "GO LOWER" `#cue` | Barlow | 40 | 900 | | +0.01em | UPPER | `#1D0F00` on warn |
| Chest cue `#chest-cue` | Sys | 17 | 750 | 1.45 | | | warn |
| Paused title `#lost-title` | Barlow | 56 | 900 | 0.9 | | UPPER | fg |
| Paused tips `.lost-tips` | Sys | 16 | 600 | 1.45 | | | fg |
| "TOO DARK" `.dark-title` | Barlow | 60 | 900 | 0.9 | | UPPER | fg |
| "Turn on a light / or face a window" `.dark-sub` | Sys | 19 | 650 | 1.45 | | | fg |
| "+1" `.plus-one` | Barlow | `clamp(56, 11% of screen height, 128)` = **92.8** at 844 tall | 900 | 1 | | | volt |
| "Give up" `#btn-giveup` | Sys | 13 | 500 | | | | white 42% |
| Toast `#stage-toast` | Sys | 15 | 600 | | | | fg |
| Demo tag `.demo-tag` | Sys | 11.5 | 700 (button 800) | | +0.02em | | volt (button: volt-ink on volt) |
| Loading message `#loading-msg` | Sys | 20 | 750 | | | | fg |
| "TAP TO RESUME" `.resume-t` | Barlow | 48 | 900 | 0.95 | | UPPER | fg |
| "SCROLL EARNED." `.succ-title` | Barlow **italic** | 40 | 900 | 1 | | UPPER | volt-ink |
| "15:00" `.succ-time` | Barlow | 132 | 900 | 0.82 | −0.02em | | volt-ink |
| "YouTube unlocked / for 15 minutes" `.succ-sub` | Sys | 22 | 750 | 1.2 | | | volt-ink |
| Prototype note `.succ-note` | Sys | 13 | 600 | | | | volt-ink 70% |
| Stats line `.succ-stats` | Sys | 15 | 700 | | | | volt-ink 80% |
| DEPTH tag on the depth line (canvas) | Barlow | `round(13 × k)` (§3.3) | 800 | | | UPPER | §3.6 |
| Debug panel | Mono | 11 | 400 (chip 600) | 1.4 | | | `#D9D9DC` |

### 1.4 Shapes and fixed sizes

| Thing | Size / radius |
| --- | --- |
| Button `.btn` | height 52, full width, radius 16, gap 8 between icon and label, icon 18 × 18; pressed: scale 0.98 (0.1 s) |
| Start button `.btn.xl` | height 58 |
| Ghost button `.btn.ghost` | height 44, no background |
| Card `.card` | radius 18, padding 14, background panel |
| Pill `.pill` | height 28, horizontal padding 12, radius 14, gap 6, icon 15 × 15 |
| Voice chip | height 30, padding left 9 / right 11, radius 15, gap 6, icon 16 |
| Icon tile `.tile` | 84 × 84, radius 26, panel2, icon 44 × 44 |
| Standard icon `.ico` | 20 × 20 |
| Settings group | radius 14; rows min-height 48, padding 6 / 14; separator 1 px `--line`, inset 14 from the left, none above the first row |
| Segmented control | panel2, radius 9, padding 2, gap 2; buttons height 30, min-width 48, padding 0 8, radius 7 |
| Stepper | panel2, radius 9, height 34; buttons 44 wide; value min-width 34 |
| Switch | 50 × 30, radius 15, off: panel2 + 1 px inner `--line`; knob 26 × 26 white, 2 px inset, shadow `0 2 4 rgba(0,0,0,.3)`; on: ok, knob moves 20. A native `Toggle` with `.tint(ok)` looks the same. |
| Segment bar | height 7, radius 4, gap 4 |
| Gauge | width 16, radius 8, max height 240 |
| "Go lower" cue | height 64, radius 20, icon 30 |
| Chest cue | padding 10 / 14, radius 14 |
| "You're in frame" bar | height 50, radius 16, icon 24 |
| Corner brackets | 32 long × 5 thick, outer corners rounded by the 18 radius of the box (see phone-02) |
| Ghost silhouette | 200 × 200, 3 pt dashed, corner radii 100/100 (top) and 30/30 (bottom) |
| Too-dark sun disc | 96 diameter, icon 54 |
| Resume disc | 112 diameter, icon 52 (shifted 6 right so the triangle looks centred) |
| Spinner | 40 diameter, 3 pt ring `--dim` with a volt top quarter, 1 s per turn, linear |
| Toast | padding 12 / 14, radius 14 |
| Demo tag | height 26, padding 0 10, radius 13; exit button height 20, padding 0 9, radius 10 |
| Debug chip | height 30, padding 0 10, radius 15, max width 34% of the row |

### 1.5 Spacing and screen padding

| Container | Padding (top, right, bottom, left) | Notes |
| --- | --- | --- |
| Regular screens `.screen` (Start, Success, Gave up, Camera error) | safe + 20 on every side | vertical stack, gap 16, min height = full screen |
| Camera layers `.layer` (Placement, Challenge) | safe-top + 14, safe-right + 16, **safe-bottom + 58**, safe-left + 16 | The 58 keeps the bottom row (Give up, debug chip, demo tag) clear |
| Loading overlay | safe + 32 (top/bottom), safe + 28 (sides) | |
| Resume overlay | 32 | |
| Too-dark overlay | 24 | |

Gaps: `.row` 12, `.g4` 4, `.g8` 8, `.g12` 12. Start hero block padding
10 top / 4 bottom.

### 1.6 Safe areas

The web pads with `env(safe-area-inset-*)` (`--st`, `--sb`, `--sl`, `--sr`).
In iPhone Safari these are about 0 in portrait, so **the screenshots have
no inset**. Natively:
- The camera preview, overlay canvas, vignette, scrims and full-screen
  overlays **ignore** the safe area (`.ignoresSafeArea()`).
- Text and controls on the camera layers sit at **safe-area inset + the
  padding above**. On a Dynamic Island iPhone the segment bar moves down by
  the top inset (about 59 pt), and Give up moves up by the bottom inset (about
  34 pt). That's expected: keep the paddings relative to the safe area.
- The top scrim is `safe-top + 300` tall and the bottom scrim `safe-bottom +
  240`, so they grow with the insets.
- Camera screens never scroll (`body.on-stage { overflow: hidden }`).
  Regular screens scroll if they're taller than the screen (Start does).

### 1.7 Shadows, scrims, vignette

| Effect | CSS | Notes for SwiftUI |
| --- | --- | --- |
| Vignette `.vignette` | `box-shadow: inset 0 0 110px rgba(0,0,0,0.6)` over the whole picture | Darkens the edges, fading inward over about 110 pt. Approximate with `Rectangle().stroke(.black.opacity(0.6), lineWidth: 110).blur(radius: 55)`, clipped, and tune against phone-03 |
| Top scrim `.scrim-top` | height safe-top + 300; vertical gradient `rgba(0,0,0,.82)` at 0% → `rgba(0,0,0,.45)` at 60% → transparent at 100% | `LinearGradient(stops:)` |
| Bottom scrim `.scrim-bot` | height safe-bottom + 240; gradient from the bottom `rgba(0,0,0,.85)` → transparent | |
| Count `.n` and countdown digit | text-shadow `0 4px 30px rgba(0,0,0,.6)` | CSS blur radius ≈ 2 × SwiftUI shadow radius: `.shadow(color: .black.opacity(0.6), radius: 15, y: 4)` |
| Placement title | `0 2px 10px rgba(0,0,0,.6)` | radius 5, y 2 |
| Placement hint, "Hold plank." | `0 2px 12px rgba(0,0,0,.7)` / `0 2px 10px rgba(0,0,0,.7)` | |
| Paused title | `0 2px 16px rgba(0,0,0,.7)` | |
| "+1" | two shadows: `0 0 2px #000` and `0 4px 24px rgba(0,0,0,.65)` | stack two `.shadow` modifiers |
| Debug panel, diagram card | backdrop blur 6 / 8 | `.background(.ultraThinMaterial)` is close enough; or a blur behind the fill colour |

### 1.8 Z-order of the camera stage (bottom → top)

`#screen-stage` is one full-screen container. Everything below is stacked in
it. Later rows draw on top.

| # | Layer | DOM | z-index |
| --- | --- | --- | --- |
| 1 | Stage background: `#000`, or the demo gradient | `.stage` / `.stage.demo` | n/a |
| 2 | Camera picture (hidden in the demo) | `<video id="video">` | auto |
| 3 | Overlay canvas: figure, depth line, silhouette | `canvas#overlay` | 1 |
| 4 | Vignette (after the canvas in the DOM, so it darkens the figure's edges too) | `.vignette` | 1 |
| 5 | Top and bottom scrims (they also darken the figure where it overlaps) | `.scrim-top`, `.scrim-bot` | 2 |
| 6 | Placement **or** Challenge layer. The "+1" is a child of the Challenge layer, so it stays inside this level | `#layer-placement`, `#layer-challenge` | 3 |
| 7 | "Too dark" overlay | `#dark-ov` | 5 |
| 8 | Toast, demo tag, Give up (in that DOM order) | `#stage-toast`, `.demo-tag`, `#btn-giveup` | 6 |
| 9 | Debug panel | `#debug` | 7 |
| 10 | Loading overlay (covers Give up; it has its own Cancel) | `#loading-ov` | 8 |
| 11 | "Tap to resume" overlay | `#resume-ov` | 9 |
| (page) | Error badge (web only) / boot failure (web only) | `#errlog` / `#boot-fail` | 50 / 60 |

So **Give up stays visible and tappable above "Too dark"**, but not above
the loading or resume overlays.

### 1.9 Icons

`index.html` defines an inline SVG sprite (24 × 24 viewBox, stroke 2,
round caps). Port the paths as SwiftUI `Path`s, or use the closest SF
Symbol. The suggestions below are not pixel-identical, so check them in the
SF Symbols app.

| Sprite id | Used for | SF Symbol suggestion |
| --- | --- | --- |
| `i-lock` | "YouTube is locked" pill, Gave-up tile | `lock` |
| `i-camoff` | Camera-error tile (red) | `video.slash` |
| `i-spk` | Voice chip | `speaker.wave.2.fill` |
| `i-check` | "You're in frame", Success stats | `checkmark` |
| `i-play` | "Watch a demo", demo tag, resume disc | `play.fill` |
| `i-pause` | "Paused" pill, hint "Hold still" | `pause.fill` |
| `i-down` | "Go lower" cue | `arrow.down` |
| `i-sun` | "Too dark" disc | `sun.max` |
| `i-move` | Hints "Move closer" / "Move back"; second paused tip | `arrow.up.and.down` |
| `i-person` | Default hint, "Get your head…", "Back to plank"; first paused tip | `person` |
| `i-redo` | Try again / Again | `arrow.counterclockwise` |
| `i-film` | "Test with a video file" | `play.rectangle` |
| `i-warn` | Env banner, error badge | `exclamationmark.triangle` |
| `i-phone` | Phone tip | `iphone` |
| `i-laptop` | Laptop tip | `laptopcomputer` |
| `i-hand` | Hint "Hands in view" | `hand.raised` |
| `i-save` | Save recording | `square.and.arrow.down` |

---

## 2. Screens

### 2.0 Flow and screen switching

```
Start ──Start / Watch a demo / video file──▶ Camera stage
                                              ├─ Loading overlay (camera + body tracking; skipped by the demo)
                                              ├─ Placement layer   (counter phase waiting | countdown)
                                              └─ Challenge layer   (counter phase counting | paused | complete)
Camera stage ──complete + 600 ms──▶ Success ──Again──▶ Camera stage (same source)
             │                             └─Done───▶ Start
             ├─Give up──▶ Gave up ──Try again──▶ Camera stage (same source)
             │                    └─Done─────▶ Start
             ├─camera failed──▶ Camera error ──Try again──▶ Camera stage │ Back──▶ Start
             └─✕ Exit demo / Esc (demo only)──▶ Start
```

- One page with five full-screen sections. `showScreen(id)` in
  `src/ui/screens.ts` shows exactly one: `start` → `#screen-start`, `stage`
  → `#screen-stage`, `success` → `#screen-success`, `gaveup` →
  `#screen-gaveup`, `camerror` → `#screen-camerror`. **Switches are
  instant**, with no transition animation.
- **Placement and Challenge share one camera view**, so the camera never
  restarts between them. Every frame, `App.render` picks the layer from the
  counter's phase: `waiting`/`countdown` → Placement, anything else →
  Challenge. Before the first frame arrives, Placement shows its reset
  state.
- In the iOS app, **Start is replaced by the wireframe's Intercept**
  (screen 2), and Success starts the pass and opens YouTube (CLAUDE.md M4).
  Keep a debug entry point for "Watch a demo".

### 2.1 Start (prototype home): `#screen-start`, screenshot `phone-01-start.jpg`

Regular screen (padding safe + 20, gap 16, scrolls). Top to bottom:

1. **Row** (space-between): pill `"YouTube is locked"` (`.pill.lock`:
   panel2, fg, lock icon 15) and pill `"Prototype"` (`.pill.proto`,
   rendered `PROTOTYPE`: Barlow 800, +0.08em, mute text, 1.5 pt inner
   outline in mute, no fill).
2. **Hero** (`.start-hero`, padding 10 top / 4 bottom, vertical stack, no
   gap):
   - `#hero-reps`: the reps setting (default `10`), volt, Barlow 900,
     `clamp(150, 46% of width, 220)`, shifted 6 left (`margin-left: -6px`).
   - `"push-ups"`, shown uppercase as `PUSH-UPS`, Barlow 900 52, LH 0.9.
   - `"to open YouTube"`, 20/650, 8 below.
   - Note (14, mute, 10 below): `"Your camera counts the reps, right on this
     phone. No video is saved or uploaded."` (laptop: `computer` instead of
     `phone`).
3. **Env banner** `#env-banner` (web only, hidden normally): warning icon +
   text. Phone, not https: `"Open the https:// address — the camera only works
   on https"`. No camera API: `"This browser can't use the camera. Open the
   page in Safari (iOS 16.4+)."` The iOS app doesn't need it.
4. **Buttons** (stack, gap 8):
   - `"Start"` `#btn-start`: primary (volt / volt-ink), height 58, 19 pt.
   - `"Test with a video file"` `#btn-video`: secondary (panel2 / fg) with
     the film icon. Opens a file picker (`video/*`). The clip plays looped,
     unmirrored, through the same pipeline. Optional on iOS.
   - `"Watch a demo"` `#btn-demo`: ghost (mute, 44 tall) with the play icon.
5. **Tip** (13.5, mute, volt icon 20, gap 10). Phone: `"Turn on Portrait
   Orientation Lock, then prop the phone up on the floor ~3 ft away"`.
   Laptop: `"Put your laptop on the floor, screen tilted back, about 3 ft from
   your head"`.
6. **Settings** (6 above): label `"Settings"` (shown `SETTINGS`), then a
   group card `#settings` with rows:
   | Row label | Control | Values (DOM `data-value`) |
   | --- | --- | --- |
   | `Reps` | Stepper `−` `10` `+` (accessibility labels `"Fewer reps"`, `"More reps"`) | 5…30, step 1; − disabled at 5, + at 30 |
   | `Depth` | Segmented | `Lenient` (lenient), `Normal` (normal), `Strict` (strict) |
   | `Model` | Segmented | `Lite` (lite), `Full` (full) |
   | `Processor` | Segmented | `Auto` (auto), `GPU` (GPU), `CPU` (CPU) |
   | `Speak counts` | Switch | |
   | `Debug view` | Switch | |
   | `Record landmarks` | Switch | |

   Footer (12, mute): `"Depth = how low a rep must go. Lite is faster, Full
   is steadier. Recording keeps body points only (never video) so you can save
   them after a set."`
7. `#btn-save-start`: ghost button, hidden unless a landmark recording
   exists. Its label becomes `"Save recording (N frames)"`; the initial HTML
   text is `"Save last recording"`.
8. Env line `#env-line` (mono 10.5, dim, centred), for example
   `"phone · secure ✓ · camera ✓ · speech ✓ · wake lock ✓"`. Web only.

Product mapping: Model/Processor are MediaPipe-only. Depth, Debug view and
Record landmarks are tuning tools. Reps and Speak counts become the
wireframe's Settings (9).

### 2.2 Loading overlay: `#loading-ov` (on the camera stage)

Full-screen over the stage, background `rgba(11,11,13,.92)`, contents
centred, gap 14:
- Spinner `#loading-spin` (40 pt, §1.4).
- Message `#loading-msg` (20/750). One of: `"Starting camera…"`,
  `"Opening video…"`, `"Loading body tracking…"`, `"Restarting camera…"`,
  `"Switching to Lite…"`.
- Sub-line `#loading-sub` (12.5, mute). On a fresh model load it is first
  `"Loading body tracking… first time downloads ~10 MB"`. It is then
  replaced by detector progress: `"Loading body tracking…"`,
  `"Downloading body-tracking model…"`, `"Downloading body-tracking model…
  N%"` (every 10%, capped at 99), `"Starting body tracking (GPU)…"` or
  `"(CPU)…"`, `"GPU unavailable, using CPU"`, `"Body tracking ready (GPU)"`.
  It is cleared when the overlay hides.
- **Error variant**: the spinner hides, the message becomes a title
  (`"Couldn't play that video"`, `"Body tracking didn't start"`, or `"The
  demo didn't start"`), and `#loading-err` shows the error text (`.txt`)
  plus a primary `"Try again"` button `#btn-load-retry` (redo icon, max
  width 340).
- Always present: ghost button `"Cancel"` `#btn-load-cancel` → Start.

The demo skips this overlay; it only appears in the demo for the error
`"The demo didn't start"`. On iOS, model loading is instant (Vision
is built in), so this is mostly the camera-start moment; a spinner plus
`"Starting camera…"` is enough.

### 2.3 Placement (wireframe 3): `#layer-placement`, screenshot `phone-02-placement-countdown.jpg`

Live camera full-screen behind (mirrored selfie view), scrims and vignette
on top, then this layer (padding §1.5). Implemented by
`src/ui/placementView.ts`.

**Element tree (top to bottom):**

1. `.place-head` (vertical stack, gap 8):
   - Row (space-between): title `.h-l` `"Prop it up"` (laptop: `"Laptop on
     the floor"`) with a text shadow, and `"Step back"` (`.small`, 12.5,
     mute). Both are static.
   - **Diagram card** `.card.diagram`: background `rgba(23,23,27,.86)` + 8
     blur, radius 18, padding 10 / 10 / 6. It holds an SVG drawn in a
     **250 × 100 viewBox scaled to the card's inner width** (338 pt on a 390
     screen, so scale 1.352). Port these shapes exactly (phone variant):
     | Shape | Geometry (viewBox units) | Style |
     | --- | --- | --- |
     | Floor | line (4,84) → (246,84) | `#55555D`, width 2 |
     | Head | circle centre (150,54) r 8 | fill `#F5F5F2` |
     | Body | line (140,60) → (28,80) | `#F5F5F2`, width 7, round cap |
     | Arm | line (139,61) → (141,83) | `#F5F5F2`, width 5, round cap |
     | Phone | rect x 220 y 46 w 13 h 36, corner radius 3 | fill `#FFD43B` |
     | Phone stand | line (232,70) → (242,83) | `#FFD43B`, width 3, round cap |
     | Camera dot | circle (226.5,51) r 1.8 | fill `#191300` |
     | Dimension | lines (158,94)→(218,94), (158,90)→(158,98), (218,90)→(218,98) | `#FFD43B`, width 1.5 |
     | `"~3 FT"` | text centred at (188,78), baseline | Barlow 800, 15, `#FFD43B` |
     | `"Head toward the phone"` | text, start at (6,16) | system 10.5, `#8E8E96` |
     | `"Upright, screen facing you"` | text, end-anchored at (244,16) | system 10.5, `#8E8E96` |

     Laptop variant: same person. The laptop is a base rect (186, 78.5, 42
     × 5, r 1.5) plus a screen line (226,80)→(238,46), width 5, round cap,
     with a dot (235.2,54) r 1.5. The dimension runs 158→224, `"~3 FT"` is
     at (172,72), and the labels read `"Head toward the screen"` and
     `"Screen tilted back"`.
2. `#frame-ok` **corner brackets** (only during the countdown). The box
   fills the open area between the card and the bottom block (flexible
   height, min 60, 12 margin above and below, radius 18). Each corner gets
   two green bars (32 × 5 and 5 × 32) forming an L, clipped by the rounded
   corner.
3. `.place-foot` (pushed to the bottom, stack, gap 12). It shows **either**
   the hint **or** the countdown:
   - **Hint** `#place-hint` (when phase = `waiting`): volt icon 36 + text
     26/800, balanced wrapping with no line limit (the longest hint takes 2
     lines on a 390 pt screen), text shadow. Copy comes from
     the counter's `hint` (`HINT_COPY` / `HINT_ICON` in
     `src/ui/placementView.ts`):

     | `snapshot.hint` | Text | Icon |
     | --- | --- | --- |
     | `null` (reset state, before the first frame) | `"Get in a plank, head toward the phone"` (laptop: `…toward the screen`) | person |
     | `getInFrame` | `"Get your head, shoulders and hands in view"` | person |
     | `handsInView` | `"Hands in view"` | hand |
     | `moveCloser` | `"Move closer"` | move |
     | `moveBack` | `"Move back"` | move |
     | `holdStill` | `"Hold still"` | pause |
     | `backToPlank` | `"Back to plank"` | person (never occurs while waiting) |
     | `chestNotHead` | `"Chest down, not just your head"` | down (never occurs while waiting) |

     While waiting, the counter always reports one of the first five
     (`holdStill` also means "in a plank, keep holding": the 3-2-1 starts
     after 0.6 s of a steady plank).
   - **Countdown** `#place-countdown` (when phase = `countdown`; the hint is
     hidden), stack, gap 10:
     - Green bar `.inframe` (50 tall, radius 16, ok background): check icon
       24 + `"You're in frame"` (20/800, `#03230A`), centred.
     - Row `.cd-row` (bottom-aligned, space-between, 4 pt side padding):
       label `"Hold plank."` + line break + `"Starting in"` (22/700; the
       second line mute 500, 8 pt bottom padding), and the digit `#cd-n`
       (volt, Barlow 900, `min(150, 20% of screen height)`, shadow).
     - Digit = `max(1, ceil(countdownRemainingMs / 1000))`, so it shows 3,
       2, 1. Every time the digit changes, including the first `3`, it plays
       the **bump** animation (§4.4).
     - If the plank breaks for more than 0.4 s, the countdown is cancelled
       and the hint comes back. If calibration wasn't steady, the countdown
       **restarts at 3** (spoken again). The counter then reports
       `holdStill`, but the hint stays hidden during the countdown, so the
       user sees the digit jump back to 3.

**Measured layout, 390 × 844 (countdown state, as phone-02):** title row y
14–39 · diagram card y 47–198 (x 16–374) · brackets y 210–591 (x 16–374) ·
green bar y 603–653 · countdown row y 663–786, with the digit box 123 tall
(0.82 × 150) ending at y 786 · Give up and demo tag in the bottom 58 pt.
While waiting, the hint block ends at y 786 (2 lines ≈ 58 tall).

The "Too dark" overlay (§2.5) can also cover Placement. The overlay figure
is drawn on Placement too (§3), but without the depth line (there's no
calibration yet).

### 2.4 Challenge (wireframe 4, S2, S4): `#layer-challenge`, screenshots `phone-03`, `phone-04`, `phone-05`, `phone-06`

Implemented by `src/ui/challengeView.ts`. Layer padding as in §1.5. Three
blocks in a vertical flex: `.ch-top`, `.ch-mid` (fills the remaining
height), and `.lost` (only while paused, pushed to the bottom).

#### 2.4.1 Measured layout, 390 × 844, counting (phone-03)

| Element | Frame (pt) |
| --- | --- |
| Segment bar `#segs` | x 16–374, y 14–21 (N segments, gap 4; at N = 10 each is 32.2 wide) |
| Chips row `.ch-chips` | right-aligned at x 374, y 31–61 (min height 30) |
| Count box `#counter` | starts x 16; y 55–219 (the row is pulled up 14 pt, `margin-top: -14px`); the digit box is 164 tall (0.82 × 200); "/10" is bottom-aligned with 10 pt bottom padding (text y ≈ 151–209) |
| `.ch-mid` | y 219–786 |
| "DEPTH" label `.glabel` | top y 219, right edge x 384 (10 pt past the layer's right padding) |
| Gauge `#gauge` | x 362–378, y 241–481 (240 tall: `top 22`, `bottom 84`, capped at 240) |
| Gauge mark | y 288–291 (3 tall at 20% from the top = **80% from the bottom**) |
| "Go lower" cue `#cue` | x 16–346, y 714–778 (`left 0`, `right 28`, `bottom 8` inside `.ch-mid`) |
| Chest cue `#chest-cue` | x 16–346, bottom y 768, about 45 tall |
| Give up | centred x 195; bottom y 834 (safe-bottom + 10); 12/18 padding around 13 pt text |
| Demo tag | right edge x 376 (safe-right + 14), bottom y 828 (safe-bottom + 16), 26 tall |
| Debug chip | left x 8, bottom y 834, 30 tall |

When the screen height changes, `.ch-mid` absorbs it. The count font
shrinks only below 741 pt screen height (27% rule).

#### 2.4.2 Segment bar: `#segs`

- One `<i>` per target rep (created in `reset(target)`), equal widths, gap
  4, height 7, radius 4.
- Segment `i` is "on" (volt) when `i < count`, otherwise
  `rgba(255,255,255,.18)`. Colour change animates over 0.25 s.

#### 2.4.3 Chips row (right-aligned, gap 8, DOM order left → right)

| Chip | DOM | Look | Visible when |
| --- | --- | --- | --- |
| `"Paused"` with pause icon | `#paused-pill` `.pill.paused-pill` | pill, `rgba(0,0,0,.6)`, fg | phase = `paused` |
| `"Didn't count"` (no icon) | `#nocount-pill` `.pill.nocount` | pill, `rgba(255,159,10,.2)`, warn text | "Go lower" cue is on and not paused |
| Voice chip `Counting aloud · “Seven”` | `#voice` (word in `#voice-word`) | 30 tall, `rgba(0,0,0,.55)`, 1 pt inner outline white 14%, speaker icon 16 volt, the word volt | voice on (Speak counts setting **and** speech supported) **and** cue off **and** not paused |

- Voice chip text = `"Counting aloud · "` + `“` + word + `”` (curly
  quotes). The word is set by `setVoiceWord`: `Go` on reset (no pulse) and
  at `start`, then the count word (`One` … `Thirty`), or `Lower`.
- **Pulse** (`say` animation) each time a word is set (except on reset): the
  inner outline starts as a 2 pt volt ring and eases out to the normal 1 pt
  white-14% outline over **0.7 s, ease-out**.
- "Lower" is set while the cue is showing, which hides the chip. The chip
  reappears afterwards showing `“Lower”` until the next word.

#### 2.4.4 The count: `#counter`, `#count`, `#count-of`

- Row, bottom-aligned, gap 2, pulled up 14 pt. `#count` = `snapshot.count`;
  `#count-of` = `"/" + target` (e.g. `/10`).
- Count: volt, Barlow 900, `min(200, 27% of screen height)`, shadow
  `0 4 30 rgba(0,0,0,.6)`. "/N": Barlow 800, 58, LH 1, fg at 92% opacity,
  10 pt bottom padding.
- **Bump on each counted rep** (`.counter.bump .n`): the digits scale from
  **1.18 → 1** over **0.45 s** with `cubic-bezier(0.2, 1.6, 0.4, 1)`, which
  overshoots below 1 and settles. The scale anchor is the centre of the
  digit box; only the number scales, not "/N".
- **Paused** (`.challenge.paused`): the whole row goes to 50% opacity and
  loses the −14 offset. The count becomes **110** and **fg** (not volt); "/N"
  becomes 36 with 6 bottom padding. Opacity, size and colour animate over
  **0.3 s**.

#### 2.4.5 DEPTH gauge: `#gauge`, `#gauge-fill`, label `.glabel`

- Label `"DEPTH"` (Barlow 800 14, volt) at the top-right of `.ch-mid`.
- Track: 16 wide, radius 8, `rgba(255,255,255,.14)`, clipped. Height
  `min(240, ch-mid height − 106)`, starting 22 below the top of `.ch-mid`.
  Its right edge sticks 4 pt out past the layer's content edge into the
  side padding (`right: -4px`), i.e. 12 pt from the screen edge. The label's
  right edge sticks out 10 pt (`right: -10px`), i.e. 6 pt from the screen
  edge.
- **Mark**: a 3 pt volt bar across the full track width, top edge at
  `20% − 1 pt`, so its centre is at **80% of the height from the bottom**.
  It sits above the fill.
- **Fill** (from the bottom, radius 8, height in whole percent):
  ```
  full = downThreshold / 0.8          // so depth == downThreshold lands exactly on the mark
  frac = clamp((snapshot.depth ?? 0) / full, 0, 1)
  if cueOn && attempt == partial: frac = max(frac, clamp(partialPeak / full, 0, 1))  // hold at the partial's peak
  height = round(frac * 100) %
  ```
  `downThreshold` is the live tuning value: 0.25 normal (full 0.3125), 0.21
  lenient, 0.29 strict, or a debug-slider value.
- **Fill colour** from the view's `attempt` state:
  - white (`#F5F5F2`) normally (`none`);
  - **volt** once the counter emits `depthReached` (`attempt = reached`).
    It stays volt through the rep and after it, until the next descent
    starts;
  - **orange** while the "Go lower" cue shows after a `partial`;
  - `attempt` resets to `none` when `snapshot.motion` changes from `up` to
    anything else (a new descent).
- Hidden while paused (gauge, label and cue).

#### 2.4.6 Depth line and figure

On the camera picture, under the layers. See §3. The depth line shows only
in the Challenge layer, not while paused, and only once `depthLineY` exists
(after calibration).

#### 2.4.7 "Go lower" cue (wireframe S4): `#cue`, screenshot `phone-05-go-lower-partial-rep.jpg`

- Orange (`--warn`) rounded bar, 64 tall, radius 20, x from the left
  padding to 28 short of the right padding, 8 above the bottom of `.ch-mid`.
  Down-arrow icon 30 + `"Go lower"` shown as `GO LOWER` (Barlow 900, 40,
  +0.01em, `#1D0F00`), centred, gap 8, never wraps.
- Always in the tree; it shows and hides by **fading**: off = opacity 0 and
  moved 8 pt down; on = opacity 1, no offset; 0.2 s transition on both
  properties.
- On while `now < cueUntil`, where `cueUntil = partialEventTime + 1500 ms`
  (`CUE_MS`). Forced off while paused.
- While on: the "Didn't count" pill shows, the voice chip hides, the gauge
  is orange and held at the partial's peak, the **figure is orange** and the
  **depth line is orange dashed** (§3).
- Speech `"Lower"` (§4.3) is rate-limited to once per 2 s. The visual cue
  re-arms on every `partial` event.

#### 2.4.8 Chest-not-head cue: `#chest-cue`

- Small card: `rgba(0,0,0,.62)`, 1 pt inner orange outline at 50%, radius
  14, padding 10 / 14, text `"Chest down, not just your head"` (17/750,
  warn, centred). Same horizontal span as the cue, 18 above the bottom of
  `.ch-mid`.
- Shows for **1.5 s after the last frame whose `snapshot.hint ==
  'chestNotHead'`** (`chestUntil = now + 1500`). The counter itself keeps
  that hint for 1.5 s after the head drop (`HINT_LINGER_MS`), so it is
  visible about 3 s after a brief nod. Hidden while the "Go lower" cue is on
  or while paused.
- Appears/disappears instantly (no fade).

#### 2.4.9 Paused (wireframe S2): screenshot `phone-06-paused-cant-see-you.jpg`

When `snapshot.phase == 'paused'`:
- "Paused" pill on; count dimmed and shrunk (§2.4.4); gauge, label and cue
  hidden; depth line hidden; voice chip and "Didn't count" hidden.
- **Ghost silhouette** `#ghost-sil`: `.ch-mid` shrinks to a 210 pt basis
  (it can shrink further on short screens). A 200 × 200 outline is centred
  horizontally, 10 pt below the top of `.ch-mid`, with height `min(200,
  ch-mid height − 10)`. 3 pt dashed `rgba(255,255,255,.5)`, corner radii
  100/100/30/30. Chrome draws the dashes about 5 pt long with 2–3 pt gaps
  (measured on phone-06). Measured: x 95–295, y 169–369.
- **Lost block** `#lost-block` (bottom-aligned, gap 12, measured y ≈
  619–786):
  - Title `#lost-title`: two lines, Barlow 900 56, LH 0.9, uppercase, text
    shadow. The source strings contain a newline.
  - Two tip rows (gap 8; each a volt 20 pt icon + 16/600 text, gap 10). The
    **icons are fixed**: row 1 always has the person icon, row 2 always the
    move icon.
- **Copy** (`pausedCopy(hint, pauseReason, words)` in
  `src/ui/challengeView.ts`), chosen in this order:

  | Condition | Title (`\n` = line break) | Tip 1 | Tip 2 |
  | --- | --- | --- | --- |
  | hint `getInFrame` | `Can't\nsee you` | `Head and shoulders in frame` | `Phone about 3 ft away` |
  | hint `handsInView` | `Hands\nin view` | `Hands on the floor, in the picture` | `Phone about 3 ft away` |
  | hint `moveCloser` | `Move\ncloser` | `Phone about 3 ft away` | `Head toward the phone` |
  | hint `moveBack` | `Move\nback` | `Phone about 3 ft away` | `Head and shoulders in frame` |
  | pause reason `outOfPlank` **or** hint `backToPlank` | `Back to\nplank` | `Hands on the floor, arms straight` | `Head toward the phone` |
  | anything else (e.g. reason `lost`, hint `null` while waiting out the 0.3 s resume) | `Can't\nsee you` | `Head and shoulders in frame` | `Phone about 3 ft away` |

  Laptop words: `Laptop about 3 ft away` and `Head toward the screen`. Note
  that the counter reports `backToPlank` whenever the user is visible but
  not yet in a valid plank, even after a `lost` pause.
- The set resumes by itself: the counter emits `resumed` and the phase
  returns to `counting`. The UI has no special handling, so the next frame
  simply renders the counting state.

#### 2.4.10 The floating "+1": `.plus-one`, screenshots `phone-04-challenge-plus-one.jpg`, `laptop-02`

On every `rep` event a new `<span class="plus-one">+1</span>` is appended to
the Challenge layer (`ChallengeView.plusOne(at)`):

1. **Anchor** (`App.plusOneAnchor`): the head point in core units (image
   heights, unmirrored, y down) is `base = nose` if `features.noseVisible`,
   else `features.shoulderMid`. The anchor is `(base.x, base.y − 0.9 ×
   (features.shoulderWidth ?? 0.2))`, i.e. about one shoulder width above
   the nose. It is mapped to screen points with
   `SkeletonOverlay.clientPoint`: same fit rectangle and mirror as the
   figure (§3.2). If there's no base point, or nothing has been drawn yet,
   the anchor is null.
2. **Placement** in layer coordinates:
   - `x = anchor.x`, or `layerWidth / 2` if null; clamped to `[60,
     max(60, layerWidth − 60)]`.
   - `y = anchor.y`, or `layerHeight × 0.45` if null; clamped to
     `[minTop, max(minTop, layerHeight − 80)]`, where `minTop =
     (chipsRow.bottom − layer.top) + 1.75 × fontSize`. This keeps the
     floating number below the chips row for its whole rise. At 390 × 844:
     font 92.8, chips bottom 61, so `minTop` = 223.5 and the max is 764.
   - `(x, y)` is the **centre** of the text (`translate(-50%, -50%)`).
3. **Look:** `"+1"`, Barlow 900, `clamp(56, 11% of screen height, 128)`,
   LH 1 (box height = font size), volt, two shadows (§1.7), never wraps,
   not interactive, hidden from accessibility.
4. **Animation** `plus-one`, **950 ms**, `forwards`, timing function
   `cubic-bezier(0.2, 0.8, 0.2, 1)`. As in all CSS keyframe animations, the
   timing function applies **to each keyframe segment** separately, per
   property. Offsets are the text's centre relative to the anchor, h = font
   size:

   | Time | Opacity | Centre offset y | Scale |
   | --- | --- | --- | --- |
   | 0 ms (0%) | 0 | +0.2 h (below) | 0.6 |
   | 133 ms (14%) | 1 | 0 | 1.15 |
   | 285 ms (30%) | 1 (held) | −0.1 h | 1.0 |
   | 665 ms (70%) | 1 | (interpolating) | 1.0 |
   | 950 ms (100%) | 0 | **−1.2 h** | 1.0 |

   Transform keyframes are at 0/14/30/100%, so the rise from −0.1 h to
   −1.2 h is one eased segment from 285 to 950 ms. Opacity keyframes are at
   0/14/70/100%, so it holds at 1 until 665 ms and then fades out.
5. **Removal:** on animation end, with a **1.5 s safety timer** in case
   animations are off or the app is in the background. All `+1`s are
   removed when a new set starts. Several can be on screen at once with fast
   reps.
6. **Reduced motion:** no animation. The "+1" shows statically at the
   anchor and is removed after 1.5 s.

#### 2.4.11 Demo tag and exit: `.demo-tag`, screenshots `phone-02/03/04/05/06` (bottom right)

Only in the demo (`.stage.demo`). Bottom-right pill (safe-right + 14,
safe-bottom + 16), 26 tall, `rgba(0,0,0,.55)`, 1 pt inner outline
`rgba(255,212,59,.45)`, volt 11.5/700. It contains:
- a label: play icon 11 + `"Demo"`, plus `"· simulated person"`, which is
  hidden on phones and shown on laptops. **The label is hidden entirely on
  screens ≤ 400 pt wide** (iPhone SE/mini and also 390-wide phones), leaving
  only the button (as in `phone-02` and `phone-04`). The older
  `phone-03/05/06` still show `▶ Demo`; follow the code.
- the button `"✕ Exit demo"` `#btn-demo-exit` (volt background, volt-ink
  text, weight 800, 20 tall, radius 10; tooltip `"Back to the start screen
  (Esc)"`) → Start. **Esc** does the same while on the demo stage.

The pill itself ignores touches; only the button is tappable.

#### 2.4.12 Give up: `#btn-giveup`

Text button `"Give up"` (13/500, white 42%, no background, padding 12 /
18), centred horizontally, safe-bottom + 10 from the bottom. Visible on
Placement and Challenge, above "Too dark". Tap → cancel speech → Gave up
screen.

### 2.5 Too dark (wireframe S3): `#dark-ov`

No screenshot (the demo is never dark; see the wireframe's S3).
- Shown when the tracking-issue detector reports `tooDark`
  (`src/core/trackingIssue.ts`; thresholds in ALGORITHM.md §8). Luminance
  is sampled twice a second. It shows on Placement **and** Challenge, and
  the counter keeps running underneath.
- Full-stage overlay `rgba(5,5,4,.9)`, contents centred, gap 12, padding 24,
  centred text: volt disc 96 with the sun icon 54 (volt-ink) · `"Too dark"`
  shown `TOO DARK` (Barlow 900, 60, LH 0.9) · `"Turn on a light"` + line
  break + `"or face a window"` (19/650).
- The figure underneath is drawn in the **faint** style (§3.5). Give up
  stays on top.
- Appears/disappears instantly (the detector already debounces by 0.7 s).
- `notDetected` (the other tracking issue) is computed but **not shown**.
  The paused screen covers that case.

### 2.6 Success (wireframe 5): `#screen-success`, screenshot `phone-07-success.jpg`

- Full-bleed **volt** (the page background and status bar turn volt too),
  all text volt-ink. Regular padding (safe + 20).
- Centred block (vertical, centred in the free space):
  - `"Scroll earned."` → `SCROLL EARNED.` (Barlow 900 **italic**, 40, LH 1).
  - `"15:00"` (Barlow 900, 132, LH 0.82; margins 14 top, 6 bottom, −4 left).
    **This is static text in `index.html`.** It is not computed from
    anything.
  - `"YouTube unlocked"` + line break + `"for 15 minutes"` (22/750, LH 1.2).
    Also static.
  - `"(prototype — nothing is unlocked yet)"` (13/600, 70%, 8 above).
    Prototype only.
  - Stats row `#succ-stats` (22 above, 15/700, 80%, check icon 18, gap 6):
    `"{count} push-ups · {elapsed}"`. `elapsed = formatElapsed(ms)`: under
    60 s it reads `"38 sec"`, otherwise `"1 min 05 sec"` (seconds
    zero-padded). `count` and `elapsedMs` come from the `complete` event.
    The demo gives `10 push-ups · 26 sec`.
- Bottom (stack, gap 8): `"Again"` `#btn-again` (black button: volt-ink
  background, volt text, redo icon) → a new set with the **same source**
  (camera, file or demo). `"Done"` `#btn-succ-done` (ghost, volt-ink 650,
  80% opacity) → Start. `"Save recording (N frames)"` `#btn-save-succ`
  (ghost ink) only if a recording exists.
- Entering Success also speaks `"Scroll earned"`.
- **Pass length is a pending product decision:** the wireframe and the
  prototype say **15:00 / 15 minutes**, while the iOS app's
  `OpenLog.passDuration` is **30 minutes**. In the app, render the time
  and the sub-line from the real pass duration (e.g. `30:00` / `for 30
  minutes`), and ask the developers which length to ship. The wireframe's
  Success also has `"Open YouTube"` plus `"Opening automatically in 3…"`
  instead of Again/Done (see §7).

### 2.7 Gave up (wireframe 6): `#screen-gaveup`, screenshot `phone-08-gave-up.jpg`

Regular screen (page background):
- Centred block (gap 12): icon tile (84, radius 26, panel2, lock icon 44 in
  fg) · `"YouTube stays locked"` (`.h-xl`, 30/800) · `"No push-ups, no
  scroll. Fair trade. It'll be here when you're ready."` (`.txt`, 15, mute)
  · `"Head anywhere else you like. YouTube unlocks after a full set."`
  (`.small`, 12.5, mute).
- Bottom (stack, gap 4): `"Try again"` `#btn-tryagain` (primary, redo
  icon) → new set, same source · `"Done"` `#btn-gaveup-done` (ghost) →
  Start · `"Save recording (N frames)"` `#btn-save-gaveup` if a recording
  exists.

### 2.8 Camera error (wireframe S1): `#screen-camerror`, screenshot `phone-09-camera-off.jpg`

Regular screen. Centred block (gap 12): tile with the camera-off icon in
**red** · title `#camerr-title` (`.h-xl`) · body `#camerr-body` (`.txt`) ·
a card holding a numbered list `#camerr-steps` (gap 12; each step = 26 pt
circle with the number, 13/700 volt on panel2, then 14 pt text, gap 10) ·
note `#camerr-note` (`.small`, hidden when empty) · detail `#camerr-detail`
(mono 11.5; **only for kind `unknown`**, showing the raw error message).
Bottom (gap 4): `"Try again"` `#btn-camerr-retry` (primary, redo icon) →
new set, same source; `"Back"` `#btn-camerr-back` (ghost) → Start.

Copy per `CameraErrorKind` (`src/ui/cameraErrors.ts`). The kind comes from
the getUserMedia error name: `NotAllowedError`/`SecurityError` → denied,
`NotFoundError`/`OverconstrainedError` → notFound,
`NotReadableError`/`AbortError` → inUse, anything else → unknown, plus
insecure (not https) and unsupported (no camera API).

**iPhone (Safari)** copy:

| Kind | Title | Body | Steps | Note |
| --- | --- | --- | --- | --- |
| `denied` | `Camera is off` | `We need it to count your reps. Video stays on this iPhone and is never saved.` | 1 `In Safari, tap the page menu button at the left of the address bar (older iOS: aA)` · 2 `Tap Website Settings (on newer iOS it is under More)` · 3 `Set Camera to Allow, then tap Try again below` | `Still blocked? Settings › Apps › Safari › Camera › Allow` |
| `insecure` | `Open the https:// address` | `The camera only works on secure pages, and this one was opened with http://.` | 1 `On your PC, find the line "Network: https://…:5173" printed by npm run dev` · 2 `Type that exact address (with https:// and :5173) into Safari` · 3 `If Safari warns the connection is not private, tap Show Details › visit this website` | |
| `notFound` | `No camera found` | `This device didn't report a front camera we can use.` | 1 `On a computer, plug in or enable a webcam, then tap Try again` · 2 `Or go Back and use "Test with a video file"` | |
| `inUse` | `Camera is busy` | `Another app or tab is using the camera right now.` | 1 `Close the Camera app, FaceTime, or other Safari tabs that use the camera` · 2 `Then tap Try again` | |
| `unsupported` | `Camera isn't available here` | `This browser doesn't let web pages use the camera.` | 1 `Open this page in Safari on the iPhone (iOS 16.4 or newer)` · 2 `Or go Back and use "Test with a video file"` | |
| `unknown` | `Camera didn't start` | `Something went wrong while turning the camera on.` | 1 `Tap Try again` · 2 `If it keeps failing, close this Safari tab and open the page again` | (raw message in the mono detail line) |

The laptop copy (Chrome/Edge on Windows) is in the same file
(`DESKTOP_COPY`). phone-09 was captured with an older wording of the
`denied` steps; the table above is current.

**For the iOS app** (wireframe S1): `insecure`/`unsupported` don't exist.
`denied`/restricted should say `Camera is off` with the same body and the
path `Settings › Doomscroller Blocker › Camera`. Use an `"Open Settings"`
primary button (`UIApplication.openSettingsURLString`) and `"Give up"` as
the ghost button, per the wireframe. Keep `Camera is busy` (session
interrupted / in use by another app) and `Camera didn't start` (anything
else).

### 2.9 "Tap to resume" overlay: `#resume-ov`

A full-stage **button** (`rgba(11,11,13,.94)`, centred, gap 16, padding
32): volt disc 112 with play icon 52 · `"Tap to resume"` → `TAP TO RESUME`
(Barlow 900, 48, LH 0.95) · `"The camera pauses when the screen locks or you
switch apps. Your count is kept."` (`.small`). It shows only when the
automatic camera restart after returning to the page fails (iOS Safari
often needs a fresh tap). Tap → `"Restarting camera…"` loading → back to
the set. On iOS, restarting `AVCaptureSession` on `scenePhase == .active`
normally just works, so this is a fallback.

### 2.10 Toast: `#stage-toast`

On the stage: x from 16 to 16 from the right (plus insets), top edge at 45%
of the stage height, padding 12 / 14, radius 14, `rgba(0,0,0,.75)`, 1 pt
inner outline white 16%, 15/600 centred. Shows for **4 s**; a new toast
replaces the text and restarts the timer. Not interactive. Messages:
- `"The screen may lock: set Settings › Display & Brightness › Auto-Lock to 5
  minutes"`: phone, camera source, when the screen wake lock couldn't be
  taken. On iOS, set `isIdleTimerDisabled = true` during a set instead and
  drop this toast.
- `"Demo finished. Tap Give up to leave."`: demo frames ran out without
  Success (only if the counter missed reps).
- Detector messages that arrive after loading has finished, e.g. `"Body
  tracking hit a problem. Restarting it…"`, `"Body tracking restarted
  (GPU)"`, `"Body tracking keeps failing. Close Safari completely, then open
  this page again."` These are web/MediaPipe only.

### 2.11 Debug panel: `#debug`, screenshot `laptop-03-debug-view.jpg`

Shown on the stage when Settings › Debug view is on. **That setting is ON
by default in the prototype** (`DEFAULT_SETTINGS.debug = true`). With it
on, the overlay also colours joints by confidence (§3.7). **The phone
screenshots were taken with it off, and that is the look to ship.** Make
the iOS debug panel a developer setting, off by default.

- **Phone layout:** a bar at the bottom (left/right 8 + insets, bottom
  safe-bottom + 10) with, on the left, the **summary chip** `#dbg-toggle`
  (30 tall, `rgba(0,0,0,.6)`, 1 pt outline white 16%, mono 600 11, max 34%
  wide). It reads `"debug"` until data arrives, then `"{fps}fps {ms}ms"`
  (rounded) + ` ▴`; the chevron rotates 180° when open. On the right is the
  orange chip `"Slow · switch to Lite"` `#dbg-lite`, shown when fps < 12
  after 3 one-second windows on a non-Lite model (not in the demo). Tapping
  the summary chip opens the body **above** the bar (max height 46% of the
  screen, scrolls). The open/closed state persists (`debugOpen`).
- **Body** `#dbg-body` (`rgba(0,0,0,.74)`, blur 6, radius 14, padding 10,
  mono 11, `#D9D9DC`):
  1. **Stats** `#dbg-stats`, refreshed at most every 200 ms, 12 lines:
     ```
     model  {model}/{delegate} · {source} {videoW}×{videoH}
     speed  {fps 1dp} fps · {inferenceMs 1dp} ms inference
     phase  {phase} / {motion} · count {count}/{target}
     depth  {depth 3dp}  raw {rawDepth 3dp}  peak {peakDepth 3dp}
     src    {depthSource|–} · down {downThreshold 2dp}
     h      {heightRatio 3dp}  hTop {baselineRatio 3dp}
     sw     ratio {shoulderWidthRatio 2dp}  frac {shoulderWidthFrac 2dp}  tilt {shoulderTiltDeg}°
     elbow  2D {elbowAngle2D}°  3D {elbowAngle3D}°
     conf   sh {shoulderConfidence 2dp}  wr {left 2dp}/{right 2dp}  upper {upperBodyConfidence 2dp}
     seen   inFrame {✓|✗} plank {✓|✗} wrists {visibleWrists} nose {✓|✗}
     light  {luminance rounded|–} / 255
     hint   {hint|–} · issue {issue}
     ```
     Unknown numbers show `–` (en dash). Angles are rounded to whole
     degrees.
  2. **Depth chart** `#dbg-chart` (76 tall, radius 8, white 5% background):
     the last **10 s** of smoothed depth as a 1.5 pt white line (gaps where
     depth is null). The y range runs from −0.05 at the bottom to
     `max(0.5, 1.6 × downThreshold)` at the top, with 4 pt padding.
     Horizontal lines: `upThreshold` (white 55%, dashed 3/3), `partialMinDepth`
     (warn, dashed 3/3), `downThreshold` (volt, solid), all 1 pt. Dots of
     radius 3.5 at each `rep` (volt) or `partial` (warn), placed at their
     peak depth.
  3. Legend (10, mute): `down` `partial` `up` `rep` `didn't count`.
  4. **Sliders** (label 52 wide · slider · value 36 wide, 2-decimal):
     `down` 0.10–0.50, `partial` 0.04–0.40, `up` 0.00–0.25, step 0.01. They
     apply live to the counter without resetting the count. They are kept
     ordered `up < partial < down` with a 0.01 gap (the dragged one wins;
     `orderTuning` in `src/ui/settings.ts`). Changing Settings › Depth
     resets them to the preset.
  5. `EVENTS` heading (10, uppercase, +0.06em, mute) and the last **8**
     events, newest first: `rep` lines in volt, `partial` lines in warn. The
     format is `"{seconds since the first frame, 1dp}s "` + one of: `rep #3 ·
     peak 0.46 · 1.4s`, `didn't count · peak 0.14` (+ ` (turned back)` if
     live), `countdown 2`, `start · hTop 1.49`, `rep cancelled (lost)`,
     `paused (lost)`, `complete · 10 in 26.4s`, or the bare event type
     (`inFrame`, `depthReached`, `resumed`, `countdownCancelled`).
  6. `RECORDING` heading and one line: `"off (the demo is simulated)"`,
     `"● recording · N frames"`, `"off (Settings › Record landmarks)"`, or
     `"on — starts with the next set"`.
- Debug also draws the **guide** on the Challenge layer (§3.4).

### 2.12 Web-only chrome (don't port)

- **Error badge** `#errlog`: red pill top-right (`"1 error"` / `"N
  errors"`) opening a panel with `Copy` / `Clear` / `Close`. It exists
  because there's no Web Inspector on Windows. Use the Xcode console.
- **Boot failure** `#boot-fail`: `"The app didn't start"`, `"Reload the
  page. If it keeps happening, copy this for the developer:"`, `"Reload"`.
- **Env banner and env line** on Start.

---

## 3. Overlay drawing (`src/ui/figure.ts`, `src/ui/overlay.ts`)

A transparent canvas exactly covers the camera picture. Each frame it draws,
in this order: **(debug guide) → depth line + DEPTH tag → (demo silhouette)
→ figure**. In SwiftUI, use one `Canvas` over the preview.

### 3.1 Units

Figure points use the core's units: **image heights of the unmirrored
source image**, x ∈ [0, aspect], y ∈ [0, 1], y down, `aspect = sourceW /
sourceH`. Each point has a confidence `c` in 0…1, and 0 means not seen or
outside the image.

### 3.2 Fit rectangle and the selfie mirror

```
fitRect(vw, vh, bw, bh, mode):            // centred, like CSS object-fit
  if any size <= 0: return (0, 0, bw, bh)
  scale = mode == cover ? max(bw/vw, bh/vh) : min(bw/vw, bh/vh)
  w = vw*scale; h = vh*scale
  return (x: (bw-w)/2, y: (bh-h)/2, w, h)

r = fitRect(aspect, 1, canvasW, canvasH, fit)   // aspect = sourceW/sourceH (else figure.aspect)
toScreen(p) = (r.x + (p.x / aspect) * r.w,  r.y + p.y * r.h)
visible part: left = max(0, r.x), right = min(canvasW, r.x + r.w), top = max(0, r.y), bottom = min(canvasH, r.y + r.h)
```

- **Phones use `cover`** (fills the screen, edges cropped). This matches
  `AVLayerVideoGravity.resizeAspectFill`. Laptops use `contain`.
- Example: a 480 × 640 portrait source on 390 × 844 → scale 1.31875,
  picture 633 × 844, x = −121.5. About 60 pt of the picture is cropped off
  each side.
- **Mirror:** for the live camera only (not the demo, not a video file) the
  web mirrors the video and the canvas with CSS `scaleX(-1)`. Points are
  never mirrored in the data. On iOS the simplest equivalent is to map
  `screenX = canvasW − toScreen(p).x` when mirrored and draw text normally.
  The web's canvas has to un-flip its text; iOS doesn't.
- `clientPoint(x, y, aspect)` (used for the "+1") is the same mapping plus
  the mirror, in window coordinates. It uses the last drawn frame's source
  size.

### 3.3 Stroke scale `k`

`k = clamp(min(right − left, bottom − top) / 420, 0.75, 2.4)`, i.e. the
visible picture's shorter side relative to the 420 pt phone the design was
drawn for. At 390 × 844 with cover, k = 390/420 = **0.929**. Every width,
radius, dash and font size below is multiplied by `k` unless marked fixed.

### 3.4 Debug guide (debug view, Challenge layer only)

Fixed sizes, not scaled by `k`:
- Hand level: a line across the visible picture at `y = features.wristMid.y`,
  width 2, dash [8, 6], `rgba(255,255,255,.4)`.
- Current shoulder height (`features.shoulderMid.y`): two white ticks,
  width 3, 28 long, at the left and right edges of the visible picture.

### 3.5 Figure

**Building a Figure** (`figure.ts`):
- Joints: left/right shoulder, elbow, wrist, hip. Each point keeps its
  confidence, set to 0 if it falls outside the image.
- **Head circle** from MediaPipe landmarks (live camera). Pairs count only
  when **both** points have c ≥ 0.5. `sw` = shoulder-to-shoulder distance,
  or 0 if a shoulder is missing.
  1. If both ears pass: centre = ear midpoint, r = `max(0.55 × earDistance,
     0.28 × sw)`, c = min of the two.
  2. Else if both eyes pass: centre = eye midpoint, r = `max(1.3 ×
     eyeDistance, 0.28 × sw)`.
  3. Else, if the nose exists (any confidence): centre = nose, r = `0.28 ×
     sw`, c = nose confidence.
  Apple Vision also returns `leftEar`, `rightEar`, `leftEye`, `rightEye` and
  `nose`, so port the same rule.
- From a core `PoseFrame` (the demo, recordings): the head is the nose with
  `r = 0.28 × sw`. Returns null when `joints` is null.

**Style:** `normal` = volt `#FFD43B`, base alpha 1 · `warn` = orange
`#FF9F0A`, base alpha 1 (while the "Go lower" cue shows, Challenge only) ·
`faint` = volt, base alpha **0.18** (while "Too dark"). Lines use round caps
and round joins.

**Confidence thresholds:** `SURE = 0.5` (solid), `SHOWN = 0.15` (below
this, not drawn in the normal view).

Drawing order and rules:

| Part | Drawn when | Look |
| --- | --- | --- |
| **Torso** | shoulder midpoint, left hip and right hip **all ≥ 0.5** | Line from the shoulder midpoint to the hip midpoint, plus the hip-to-hip line: width 2.5k, solid, alpha base × 0.45. Hip dots radius 3k, filled, alpha base × 0.5 |
| **Shoulder line** | `min(c) ≥ 0.15` | width 5.5k |
| **Upper arms, forearms** (shoulder→elbow, elbow→wrist, both sides) | `min(c) ≥ 0.15` | width 4.5k |
| (any limb above) if `min(c) ≥ 0.5` | | solid, alpha base × 1, full width |
| (any limb above) if `0.15 ≤ min(c) < 0.5` | | **dashed** [6k, 7k], alpha base × 0.55, width × 0.75 |
| **Neck** | head drawn, shoulder midpoint c ≥ 0.15, and the distance from the head centre to the shoulder midpoint > radius + 2 | From the circle's edge (towards the shoulder midpoint) to the shoulder midpoint. If head c ≥ 0.5 and midpoint c ≥ 0.5: width 4k, solid, alpha base. Otherwise width 3k, dashed [6k, 7k], alpha base × 0.55 |
| **Head circle** | head exists, `head.c > 0`, and (`head.c ≥ 0.15` or debug) | Radius `max(head.r × r.h, 10k)`. Fill `rgba(0,0,0,.25)`, stroke width 4k in the style colour (debug: confidence colour). If c ≥ 0.5: solid, alpha base. Otherwise dashed [7k, 6k], alpha base × 0.6 |
| **Joint dots** (shoulders, elbows, wrists; not hips) | c > 0 and (c ≥ 0.15 or debug) | Radius 5.5k. **Sure** (≥ 0.5): filled in the style colour, 2k black outline, alpha base. **Unsure**: hollow ring, fill `rgba(0,0,0,.35)` with a 2.5k style-colour outline, alpha base × 0.6. **Debug**: filled with the confidence colour, 2k black outline, alpha base |

The neck is drawn before the head circle in the same step. Dots are drawn
last, on top.

### 3.6 Depth line (Challenge only, not paused, after calibration)

Input: `snapshot.depthLineY`, the image y (core units) the shoulder midpoint
must reach for depth = `downThreshold` (formula in ALGORITHM.md). Screen y =
`r.y + depthLineY × r.h`. Skip it if not finite or outside the canvas.
It spans the visible picture's left to right, with butt caps.

| State (`ChallengeView.depthLineState`) | When | Line | DEPTH tag |
| --- | --- | --- | --- |
| `idle` | default | volt, **dashed** [12k, 9k], width 3k, alpha 0.85 | background `rgba(0,0,0,.6)`, text volt |
| `reached` | after `depthReached`, until the next descent starts | volt, **solid**, width 4k, **glow**: shadow volt, blur 14k | background volt, text `#191300` |
| `partial` | after a `partial`, while the 1.5 s cue shows | **orange**, dashed [12k, 9k], width 3k, alpha 0.85 | background `rgba(0,0,0,.6)`, text orange |

**DEPTH tag:** text `"DEPTH"`, Barlow 800, size `round(13k)`. Pill width =
text width + 2 × 6k, height = font size + 6k, fully rounded. It sits at the
**left edge of the screen** (`left + 10k`), its bottom 5k above the line,
with the text vertically centred. It is never mirrored. Screenshots: idle is
not captured; reached in phone-03/04; partial in phone-05.

### 3.7 Debug confidence colours

With Debug view on (the `byConfidence` option), joint dots and the head
stroke use **green `#32D74B` if c ≥ 0.5, red `#FF453A` otherwise**, and
every joint with c > 0 is drawn, even below 0.15. Limbs keep the style
colour.

### 3.8 Demo silhouette

Only in the demo, drawn under the figure, so the fake camera picture seems
to contain a person. It needs both shoulders. `sw` = their on-screen
distance. The whole layer gets a blur of `max(2, 0.06 × sw)` and alpha 0.9,
with round caps. Confidence is not checked.

| Part | Colour | Width / radius |
| --- | --- | --- |
| Torso: shoulder midpoint → hip midpoint (if both hips exist) | `#120E0B` | 0.40 × sw |
| Shoulder line | `#16110D` | 0.33 × sw |
| Upper arms | `#16110D` | 0.22 × sw |
| Forearms | `#16110D` | 0.18 × sw |
| Head disc | `#1A140F` | radius `head.r × r.h + 0.06 × sw` |

---

## 4. Behaviour and timing

### 4.1 Counter events → UI (`App.handleEvent`, `src/app.ts`)

Events come from `snapshot.events` each frame. They are handled before that
frame is rendered.

| Event | UI reaction | Speech |
| --- | --- | --- |
| `countdownTick` (secondsLeft 3, then 2, then 1; a restarted countdown emits 3 again) | The digit is driven by `countdownRemainingMs`, not by this event | `"3"`, `"2"`, `"1"` (only for secondsLeft > 0) |
| `start` | The layer switches to Challenge on this frame; voice word `Go` (pulse) | `"Go"` |
| `depthReached` | `attempt = reached` → gauge volt, depth line solid and glowing | none |
| `rep` (count n) | Count updates + **bump**; segment n fills; voice word = count word (pulse); **"+1"** at the head | `countWord(n)`: `"One"`, `"Two"` … `"Twenty-one"` … `"Thirty"` (digits above 30) |
| `partial` (peakDepth, live) | `attempt = partial`; `partialPeak = max(peak, previous peak if the cue is still on, else 0)`; `cueUntil = now + 1500` → "Go lower", "Didn't count", orange gauge, figure and line | `"Lower"` only if more than **2000 ms** have passed since the last "Lower" (then also voice word `Lower`) |
| `paused` (reason) | Stores the reason for the paused copy. The paused look itself follows `phase == 'paused'` | none |
| `complete` (count, elapsedMs) | Schedules Success 600 ms later (§4.2). Meanwhile Challenge keeps rendering 10/10 | none |
| `resumed`, `inFrame`, `countdownCancelled`, `repCancelled` | Nothing (debug event list only) | none |

`now` is the frame clock: the camera's `performance.now()`, or the demo's
`frame.t`. All UI timers (cue, chest cue, "Lower" limit) compare against it,
so stepping the demo frame by frame shows each cue for the right number of
frames.

### 4.2 Success timing

When `complete` arrives: `pendingSuccess.at = event.t + 600` and a 600 ms
timer starts. Success shows on **whichever comes first**: the timer, or a
frame with `t ≥ at`. Showing it stops the camera/demo, releases the wake
lock, fills the stats, then speaks `"Scroll earned"`. The 600 ms lets the
final "10", its bump, "Ten" and the "+1" register first.

### 4.3 All spoken phrases

`"3"`, `"2"`, `"1"`, `"Go"`, `"One"`…`"Thirty"`, `"Lower"`, `"Scroll earned"`.
They are spoken only when Settings › Speak counts is on (default on).

Web engine details (`src/platform/speech.ts`), with the iOS equivalent:
- Language `en-US`, rate **1.1** (10% faster than the default). The voice is
  the system default en-US voice, else "Samantha", else a local en-US
  voice. Novelty voices (Bubbles, Zarvox, …) are never picked.
  `AVSpeechUtterance` uses a different rate scale (default 0.5), so start
  around 0.53 and tune by ear.
- **Newest phrase wins:** if a phrase is still queued when a new one comes,
  the queue is cancelled and only the new phrase is spoken. A spoken count
  must never lag behind the reps. On iOS: `stopSpeaking(at: .immediate)`
  if `isSpeaking` and a backlog would form.
- Speech is cancelled on Give up, Exit demo/Done (go home), and when the
  app goes to the background.
- Audio session: `playback`, so it speaks with the silent switch on, while
  speech is enabled. On iOS: `AVAudioSession` `.playback` with
  `.duckOthers`.
- Web only: a silent `"Ready"` at volume 0.01 inside the Start tap unlocks
  iOS Safari speech. Not needed natively.

### 4.4 Animations and transitions

| What | Spec |
| --- | --- |
| Count bump / countdown digit bump (`@keyframes bump`) | scale 1.18 → 1.0, **0.45 s**, `cubic-bezier(0.2, 1.6, 0.4, 1)` (overshoot). Restarted from the beginning on every trigger. SwiftUI: set the scale to 1.18 without animation, then animate to 1 with `.timingCurve(0.2, 1.6, 0.4, 1, duration: 0.45)`, or use a `keyframeAnimator` |
| Voice chip pulse (`@keyframes say`) | inner ring 2 pt volt → 1 pt white 14%, **0.7 s ease-out** |
| "+1" | §2.4.10 (950 ms) |
| "Go lower" cue | opacity and 8 pt slide, **0.2 s** |
| Segment fill | colour, **0.25 s** |
| Paused count shrink/dim | opacity, font size, colour, **0.3 s** |
| Spinner | 1 turn/s, linear |
| Button press | scale 0.98, 0.1 s |
| Switch | 0.2 s |
| Everything shown/hidden with the `hidden` attribute (pills, chest cue, ghost, lost block, overlays, layers, screens) | **instant**, no transition |
| Reduced motion (`prefers-reduced-motion`) | **all** animations and transitions off. iOS: respect `accessibilityReduceMotion` |

### 4.5 Timing constants in one place

| Constant | Value | Source |
| --- | --- | --- |
| Steady plank before the 3-2-1 | 600 ms | `calibrationHoldMs` |
| Countdown | 3000 ms | `countdownMs` |
| Plank may break during the countdown for | 400 ms | `COUNTDOWN_GATE_GRACE_MS` |
| Body lost → pause / back → resume | 500 ms / 300 ms | `lostAfterMs` / `resumeAfterMs` |
| "Go lower" cue, chest cue (view) | 1500 ms | `CUE_MS` |
| Chest hint linger (counter) | 1500 ms | `HINT_LINGER_MS` |
| "Lower" spoken at most every | 2000 ms | `LOWER_REPEAT_MS` |
| Success after `complete` | 600 ms | `SUCCESS_DELAY_MS` |
| Toast | 4000 ms | `TOAST_MS` |
| "+1" animation / safety removal | 950 ms / 1500 ms | styles.css / challengeView |
| Luminance sample interval | 500 ms | `LUMA_EVERY_MS` |
| Too-dark / not-detected debounce | 700 ms | `debounceMs` |
| Debug text refresh | 200 ms | `TEXT_EVERY_MS` |
| "Slow · switch to Lite" | fps < 12 after 3 one-second windows | `LOW_FPS` |

### 4.6 Visibility (screen lock, app switch) → `scenePhase`

- Page hidden (or `pagehide`) while on the stage → **suspend**: stop the
  frame loop, stop the camera, cancel speech. **The count, calibration and
  counter state are kept** (the counter is not reset).
- Page visible again → if suspended: the demo just continues. The camera
  shows `"Restarting camera…"` and restarts by itself. If that fails, "Tap
  to resume" appears (§2.9).
- iOS: on `.background`/`.inactive`, stop the `AVCaptureSession` and the
  speech; on `.active`, restart the session. Keep `isIdleTimerDisabled =
  true` while on the stage and reset it when leaving (the web uses the
  Screen Wake Lock API the same way).

### 4.7 Buttons and what they do

| Button | Where | Action |
| --- | --- | --- |
| Start | Start | New set from the **camera** (speech and wake lock unlocked in the tap) |
| Watch a demo | Start | New set from the **demo** |
| Test with a video file | Start | File picker, then a new set from the **file** |
| Give up | Stage | Cancel speech → stop session → **Gave up** |
| ✕ Exit demo / Esc | Demo stage | Cancel speech → stop session → **Start** |
| Again | Success | New set from the **same source** |
| Done | Success | **Start** |
| Try again | Gave up | New set from the **same source** (camera → loading → Placement) |
| Done | Gave up | **Start** (wireframe: Home) |
| Try again / Back | Camera error | New set from the same source / Start |
| Try again / Cancel | Loading error | New set from the same source / Start |
| Tap to resume | Resume overlay | Restart the camera, keep the count |
| Save recording | Start / Success / Gave up | Exports the last landmark recording as JSON (share sheet on touch devices, direct download on a laptop). iOS: `ShareLink` |

"New set" always means: stop any previous session, show the stage, reset
the counter and every view (`ChallengeView.reset(target, voiceOn)`,
`PlacementView.reset()`), and start from Placement. The URL parameter
`?demo` starts the demo at page load.

### 4.8 Settings persistence

`localStorage["pushup-test.settings.v1"]` holds one JSON object. Invalid or
missing fields fall back to the defaults:

| Field | Type / values | Default |
| --- | --- | --- |
| `reps` | integer, clamped 5…30 (rounded) | 10 |
| `depth` | `lenient` (0.21) / `normal` (0.25) / `strict` (0.29) → `downThreshold` | `normal` |
| `model` | `lite` / `full` | `full` |
| `delegate` | `auto` / `GPU` / `CPU` | `auto` |
| `speak` | bool | true |
| `debug` | bool | **true** |
| `record` | bool | false |
| `debugOpen` | bool (debug panel expanded) | false |

The debug-slider tuning is **not** persisted; it resets to the depth preset
on reload. iOS: `@AppStorage` keys for reps, depth, speak and debug.
Model/delegate are MediaPipe-only.

---

## 5. Demo mode ("Watch a demo")

### 5.1 Why the iOS app needs it

**The iOS Simulator has no camera.** The demo feeds a scripted, simulated
person through the **real** `RepCounter`. Without a device, it is the only
way to see every Challenge state: countdown, reps, "+1", "Go lower", paused,
Success. It also works as a live regression check: if the counter changes,
the demo's story changes too (`tests/demoScript.test.ts` asserts the story
for 5, 10 and 30 reps). Port `web-prototype/src/sim/pushupSimulator.ts`,
`src/demo/demoScript.ts` and `src/demo/demoRunner.ts` (CLAUDE.md M2).

### 5.2 The script (`src/demo/demoScript.ts`)

```
DEMO_FPS = 30
DEMO_START_T = 1000          // first frame's t (ms); not 0, because the UI uses 0 as "never" for its until-timestamps
REPS_BEFORE_PARTIAL = 3

fullRep(i) = { minElbowDeg: 75, downMs: 700 + (i % 3) * 60, bottomHoldMs: 120,
               upMs: 650 + (i % 2) * 80, topRestMs: 450 }
PARTIAL_REP = { minElbowDeg: 120, downMs: 600, bottomHoldMs: 150, upMs: 600, topRestMs: 1300 }

demoSegments(target):
  target = max(1, round(target)); before = min(3, target); after = target - before
  [ absent 1200 ms,                      // not in view: Placement asks to get in frame
    hold 4500 ms ]                       // steady plank (0.6 s) + 3-2-1 (3 s)
  + fullRep(0..before-1)
  + (after > 0 ? [ PARTIAL_REP,          // shallow rep → "Go lower"; its 1.3 s rest keeps the cue visible
                   absent 1500 ms,       // walks out → paused "Can't see you"
                   hold 1300 ms ]        // back in plank → resumes
                 + fullRep(before..target-1) : [])
  + [ hold 2500 ms ]                     // keeps frames coming while Success's 600 ms delay runs out

buildDemoSession(target, { wholeFrameVisible }) =
  simulateSession(demoSegments(target), {
    fps: 30, startT: 1000, noisePx: 1, seed: 7,
    geometry: { headDistance: wholeFrameVisible ? 1.0 : 1.3 } })   // phone (cover) → 1.3 m, laptop (contain) → 1.0 m
```

- `wholeFrameVisible` is true when the picture uses `contain` (laptop). On
  phones `cover` crops the sides, so the simulated person stands further
  back (1.3 m instead of the simulator's default 0.9 m) to keep the elbows
  on screen.
- Simulator geometry (`DEFAULT_GEOMETRY`): camera 0.10 m above the floor,
  tilted up 8°, vertical FOV 68°, **image 480 × 640 (portrait)**, body scale
  1, hands 1.35 × shoulder width apart, hands 0.08 m behind the shoulders,
  elbow flare 45°, top elbow angle 172°. Gaussian landmark noise is 1 px,
  from a seeded RNG (`makeRng(7)`).
- Segment frames: `for (e = 0; e < ms; e += 1000/30)`, one frame each, and
  t advances 33.33 ms per frame. An `absent` frame is `{ t, aspect: 0.75,
  joints: null }`.
- Ten reps = **1031 frames**, t = 1000 … 35333 ms.

### 5.3 Exact timeline (target 10, phone geometry, default settings)

Measured by running the script through the real counter (frame index,
t in ms). The laptop geometry gives the same timeline within one frame; its
first rep lands at #212 / t 8067.

| Frame | t (ms) | Counter | What the UI shows |
| --- | --- | --- | --- |
| #0 | 1000 | waiting, hint `getInFrame` | Placement: "Get your head, shoulders and hands in view" |
| #36 | 2200 | hint `holdStill` | "Hold still" |
| #54 | 2800 | `inFrame`, countdown, tick 3 | "You're in frame", brackets, digit 3 (bump); says "3" |
| #84 | 3800 | tick 2 | digit 2; says "2" |
| #115 | 4833 | tick 1 | digit 1; says "1" |
| #145 | 5833 | `start` (hTop 1.485, depthLineY 0.423) | Challenge 0/10; says "Go" |
| #186 / #211 | 7200 / 8033 | depthReached / **rep 1** | gauge volt, line glows / "1", "+1", "One" |
| #274 | 10133 | rep 2 | |
| #337 | 12233 | rep 3 | |
| #389 | 13967 | **partial** (peak 0.136, live) | "Go lower", "Didn't count", orange until t 15467; says "Lower" |
| #437 | 15567 | hint `getInFrame` (body gone) | |
| #452 | 16067 | **paused** (lost) | "Can't see you", ghost outline, dimmed 3/10 |
| #483 | 17100 | hint null (back in plank) | still paused, waiting out the 0.3 s resume |
| #493 | 17433 | **resumed** | counting again |
| #565 #627 #691 #750 #813 #876 | 19833 21900 24033 26000 28100 30200 | reps 4–9 | |
| #937 | 32233 | **rep 10 + complete** (elapsed 26400 ms) | "10", "+1", "Ten" |
| ≈ #955 | ≥ 32833 | | **Success** "10 push-ups · 26 sec"; says "Scroll earned"; the demo stops |

(The tracking-issue detector briefly reports `notDetected` around the
absences, which the UI does not show.)

### 5.4 Demo presentation

- **No camera, no loading overlay, no recording.** The stage gets the
  `.demo` class: the video is hidden and the stage background is the
  design's fake camera picture. The background has two layers. Top: a
  radial gradient, ellipse 120% × 60% centred at (50%, 28%), from
  `rgba(255,220,170,0.10)` to transparent at 60%. Below it: a vertical
  linear gradient `#151210` 0% → `#2A241E` 58% → `#4A4034` 74% → `#3A3128`
  100%.
- **Not mirrored.** The figure comes from `figureFromPoseFrame` (nose head)
  and sits on the dark silhouette (§3.8). Luminance is null, so it's never
  "too dark".
- The demo tag and "✕ Exit demo" (§2.4.11). The debug panel shows
  `model demo/simulated` and `inference 0 ms`.
- **Playback** (`DemoRunner`): in real time from the display clock (rAF).
  After a hiccup it plays at most **4 frames per tick** and then carries on
  from there, so it never fast-forwards. It pauses while the app is in the
  background and continues afterwards. `onEnd` fires once after the last
  frame.
- **Dev hook** (dev server only): `window.__demo = { start(), step(n = 1),
  state() }`. `start()` begins a demo set in manual mode (no real-time
  playback); `step(n)` plays the next n frames synchronously and renders
  them; `state()` returns `{ screen, layer, phase, count, target, hint,
  issue, depthLineY, frame, frames }`. iOS equivalent: a debug-only
  launch argument or debug menu that starts the demo, plus a step control
  (or a test hook), so the UI can be checked in the Simulator and in UI
  tests without waiting in real time.

---

## 6. Web element → recommended SwiftUI construct

| Web | SwiftUI |
| --- | --- |
| Five `<section>` screens + `showScreen` (instant switch) | `enum AppScreen { start/intercept, stage, success, gaveUp, cameraError }` and a `switch` in the root view; no navigation animations |
| `.screen` (padding safe + 20, vertical gap 16) | `VStack(spacing: 16)` + `.padding(20)` inside the safe area; `ScrollView` for Start |
| Camera stage `#screen-stage` | `ZStack` { preview, overlay `Canvas`, vignette, scrims, layer, overlays }; preview/overlay/vignette/scrims `.ignoresSafeArea()` |
| `<video object-fit: cover>` + CSS mirror | `AVCaptureVideoPreviewLayer` (`.resizeAspectFill`) in a `UIViewRepresentable`; the front-camera preview is mirrored, so mirror the overlay mapping too (§3.2) |
| `canvas#overlay` (figure, depth line, DEPTH tag, silhouette) | `Canvas { ctx, size in … }` fed by an `@Observable` model updated per frame; dashes via `StrokeStyle(dash:)`; glow via `ctx.addFilter(.shadow(color:radius:))`; silhouette blur via `ctx.addFilter(.blur(radius:))` in a separate layer; DEPTH tag via `ctx.draw(Text(...))` |
| `.vignette`, `.scrim-top`, `.scrim-bot` | §1.7 (`LinearGradient` stops; a blurred stroke for the vignette) |
| `.layer` with paddings | `VStack(spacing: 0)` with `.padding(.top, 14)`, `.padding(.horizontal, 16)`, `.padding(.bottom, 58)` inside the safe area |
| Segment bar `#segs` | `HStack(spacing: 4) { ForEach(0..<target) { RoundedRectangle(cornerRadius: 4).fill(i < count ? volt : .white.opacity(0.18)).frame(height: 7) } }` + `.animation(.linear(duration: 0.25), value: count)` |
| Pills / voice chip | `HStack(spacing: 6)` + `.padding(.horizontal, 12).frame(height: 28).background(Capsule().fill(...))`; voice pulse = a `Capsule().strokeBorder` overlay animated from 2 pt volt to 1 pt white 14% |
| Count `#count` + bump | `Text("\(count)")` Barlow Black, `.monospacedDigit()`, `.scaleEffect(bump)` + `.timingCurve(0.2, 1.6, 0.4, 1, duration: 0.45)`, or `keyframeAnimator(trigger: count)` |
| Gauge | `GeometryReader` → `ZStack(alignment: .bottom)` track capsule + fill capsule (height = frac × H) + mark at 80% |
| "Go lower" `#cue` | `RoundedRectangle(cornerRadius: 20)` + label; `.opacity(cueOn ? 1 : 0).offset(y: cueOn ? 0 : 8).animation(.easeInOut(duration: 0.2), value: cueOn)` |
| `hidden` attribute toggles | plain `if` (no `.transition`) |
| Ghost silhouette | `UnevenRoundedRectangle(topLeadingRadius: 100, bottomLeadingRadius: 30, bottomTrailingRadius: 30, topTrailingRadius: 100).stroke(.white.opacity(0.5), style: StrokeStyle(lineWidth: 3, dash: [5, 2.5]))` |
| Paused title with `\n` | `Text(title.uppercased())` (the string contains `\n`) |
| "+1" | An array of `PlusOne(id, point)` in an overlay `ZStack`; each `Text("+1").position(point)` with a `keyframeAnimator` (separate tracks for opacity, offset and scale, §2.4.10); remove after 0.95 s (safety 1.5 s) |
| Placement diagram SVG | A `Canvas`/`Path` drawing in the 250 × 100 coordinate space scaled to width, with `Text` overlays for the labels (§2.3) |
| Corner brackets `#frame-ok` | `Canvas`, or four L-shaped `Path`s, in a flexible-height frame |
| "Too dark", loading, resume overlays | Full-screen `ZStack` layers with the given colours; custom spinner (`Circle().trim` rotating) or `ProgressView().tint(volt)` |
| Toast | Overlay + `.task(id:) { try? await Task.sleep(for: .seconds(4)); hide() }` |
| Buttons `.btn.pri/.sec/.blk/.ghost` | One `ButtonStyle` per variant (height 52/58/44, radius 16, pressed scale 0.98) |
| Segmented `.seg` / stepper / switch | Custom `HStack` of buttons (selected `#636366`), or `Picker(.segmented)`; `Stepper` or custom; `Toggle` + `.tint(ok)` |
| Settings card | `VStack` in a `RoundedRectangle(cornerRadius: 14)` with dividers, or `Form` with `.insetGrouped` |
| `localStorage` settings | `@AppStorage` |
| `speechSynthesis` | `AVSpeechSynthesizer` (§4.3) |
| `visibilitychange` / `pagehide` | `@Environment(\.scenePhase)` |
| Screen Wake Lock | `UIApplication.shared.isIdleTimerDisabled` |
| `requestVideoFrameCallback` frame loop | `AVCaptureVideoDataOutputSampleBufferDelegate` |
| Luminance (32 × 32 average of a frame) | Mean of a downsampled Y plane of the `CVPixelBuffer`, every 500 ms |
| Landmark recording download / share | `ShareLink` with the JSON file |
| `window.__demo`, `?demo`, Esc | Debug-only launch argument / menu + step hook; `.onKeyPress(.escape)` (hardware keyboard / Simulator) |
| Reduced-motion CSS | `@Environment(\.accessibilityReduceMotion)` |

---

## 7. Wireframe coverage

Wireframe: `docs/wireframe/doomscroller-blocker-wireframe.html` (open it in
a browser) and `doomscroller-blocker-wireframe-text.md`.

| Wireframe screen | Prototype status | Where | Differences from the wireframe |
| --- | --- | --- | --- |
| **1a** Welcome | Not yet | | iOS phase 2 |
| **1b** Camera primer | Not yet | | iOS phase 2 (the iOS permission alert follows it) |
| **1c** Shortcuts guide | Not yet | | iOS phase 2 |
| **1d** Test it | Not yet | | iOS phase 2 |
| **2** Intercept | Partial | Start screen (§2.1) | The hero block matches ("YouTube is locked" pill, big "10", "PUSH-UPS", "to open YouTube"). The prototype adds a PROTOTYPE pill, a different note (wireframe: `Unlocks for 15 min. Your feed can wait 40 seconds.`), the video-file and demo buttons, a setup tip and a Settings card. It has **no Give up button**. Hero size `clamp(150, 46vw, 220)` vs the wireframe's 230 |
| **3** Phone placement | Implemented | §2.3, phone-02 | The live camera is **full-screen behind** the diagram (wireframe: a 262 pt preview card under it). Adds the one-line hint while not in frame, a corner-bracket box filling the free area, a bigger countdown (150 vs 72 digit, 22 vs 15 label), and a laptop variant |
| **4** Challenge | Implemented | §2.4, phone-03/04 | Adds the body figure, depth line with DEPTH tag, floating "+1", and chest-not-head cue. The gauge sits at y 241–481 (240 tall) vs the wireframe's 286 + 170; its mark spans the track. The wireframe's in-screen "Scroll earned 10" overlay is replaced by the Success screen after 600 ms |
| **5** Success | Implemented | §2.6, phone-07 | Larger type (40 / 132 / 22 vs 34 / 118 / 21; stats 15/700/80% vs 13/600/75%). Adds `(prototype — nothing is unlocked yet)`. **Again / Done** instead of `Open YouTube` + `Opening automatically in 3…`. **"15:00 / for 15 minutes" is static**, while the iOS app's pass is currently **30 min**: product decision pending, ask the developers |
| **6** Gave up | Implemented | §2.7, phone-08 | Same copy. Done → Start (wireframe: Home). Try again → camera restart → Placement (matches). Adds Save recording when a recording exists |
| **7** Home | Not yet | | Will grow out of the iOS app's current log screen |
| **S1** Camera denied | Implemented (web variant) | §2.8, phone-09 | Six error kinds with Safari/Chrome steps, and Try again / Back. The wireframe has one card `Settings › Doomscroller Blocker › Camera` with `Open Settings` / `Give up`; follow the wireframe in the app |
| **S2** Body not detected | Implemented, extended | §2.4.9, phone-06 | Five copy variants from the counter's hint (Can't see you / Hands in view / Move closer / Move back / Back to plank). The "Paused" pill is in the chips row above the count (wireframe: right of the count on the same row) |
| **S3** Poor lighting | Implemented | §2.5 (no screenshot) | Same look. Triggered by luminance + a confidence pattern (ALGORITHM.md §8); covers Placement too |
| **S4** Partial rep | Implemented, extended | §2.4.7, phone-05 | Adds an orange figure and an orange dashed depth line. "Lower" is spoken at most every 2 s; the cue lasts 1.5 s as specified |
| **8** Home with stats | Not yet | | |
| **9** Settings | Partial | Start › Settings card | Reps stepper 5–30 and Speak counts match. Exercise (Push-ups/Squats) and Unlock for (5/10/15/30) are missing. Depth, Model, Processor, Debug view and Record landmarks are prototype-only |
| **10** Add app | Not yet | | |
| **11a** Live Activity (Lock Screen) | Not yet | | |
| **11b** Dynamic Island | Not yet | | |
| **11c** Time's up | Not yet | | |

---

## 8. Checklist for the iOS rebuild

1. Bundle and register Barlow Condensed (ExtraBold, Black, BlackItalic).
2. Stage = preview (aspect fill, mirrored) + `Canvas` overlay using the §3.2
   mapping, with k from §3.3.
3. Drive everything from `CounterSnapshot` + events exactly as in §4.1.
   Use the frame timestamp as "now" for the cue timers.
4. Placement ↔ Challenge purely from `snapshot.phase`. Success 600 ms after
   `complete`.
5. Port the demo (§5) first so all of this can be built in the Simulator,
   and compare with the timeline in §5.3.
6. Compare side by side with `docs/screenshots/phone-*.jpg` at 390 × 844 pt
   (no insets), then check on a notched device with real safe areas.

---

## 9. Laptop-only differences (brief)

The device type (`detectDevice()` in `src/ui/device.ts`: phone unless the
main pointer is a mouse and the UA isn't a phone or tablet) only changes
**words**:
- `"Laptop on the floor"` title, laptop diagram;
- `"Get in a plank, head toward the screen"`;
- paused tips `Laptop about 3 ft away` / `Head toward the screen`;
- the laptop tip on Start, `computer` in the Start note;
- desktop camera-error copy;
- no wake-lock toast;
- recordings download directly instead of opening the share sheet.

**Layout** changes come from the screen shape, `@media (min-aspect-ratio:
1/1) and (min-width: 700px)`:
- The stage spans the whole window, and the video uses **`contain`**
  (whole picture, dark bars). The overlay follows, and the demo person
  stands at 1.0 m.
- Layer padding is 18 / 24 / 64 / 24, and the top scrim is 42% of the
  height.
- Bigger type:

  | Element | Laptop size |
  | --- | --- |
  | Placement title | 28 |
  | Hint | `clamp(26, 4.6vh, 42)`, icon 46 |
  | "You're in frame" | 62 tall, 26 pt |
  | Countdown label | `clamp(22, 3.8vh, 34)` |
  | Countdown digit | `clamp(120, 26vh, 260)` |
  | Segments | 10 tall |
  | Chips | 38–40 tall, 17 pt |
  | Count | `clamp(120, 28vh, 300)` |
  | "/N" | `clamp(44, 8vh, 88)` |
  | Gauge | 24 wide, max 46vh |
  | "Go lower" cue | 92 tall, 64 pt, centred, width `min(600, 78%)` |
  | Chest cue | 24 pt |
  | Ghost | 260 |
  | Paused title | `clamp(56, 11vh, 100)` |
  | Tips | 21 |
  | Too dark | 84 / 24 |
  | Give up | 16 |
  | Toast | 18, centred, max 560 |

- The demo tag moves **bottom-left** and shows `· simulated person`.
- The debug panel docks as a column on the right (`min(340px, 34vw)`); the
  picture, figure and layers move left to make room (`laptop-03`).
- On wide windows the regular screens are a centred column, max 480 wide,
  with 44 top / 36 bottom padding.
