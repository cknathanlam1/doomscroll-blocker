# Instructions for AI coding assistants

The full instructions for this repo are in **[CLAUDE.md](CLAUDE.md)**. They
apply to any AI assistant, not only Claude. Read that file completely before
doing anything, then `docs/ALGORITHM.md` and `docs/UI_SPEC.md`.

Summary: the iOS app (SwiftUI, XcodeGen) lives at the repo root, and a working
web prototype of the push-up challenge lives in `web-prototype/`. Build the
challenge into the iOS app so it counts exactly like
`web-prototype/src/core` (prove it with the golden fixtures) and looks like
`docs/screenshots/phone-*.jpg`. Start with milestone M0: can Apple Vision track
a push-up filmed head-on from the floor?
