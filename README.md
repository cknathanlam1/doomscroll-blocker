# Doomscroller Blocker

Earn your scroll: do push-ups before YouTube opens. See the product brief for scope.

## Current state
Detects that YouTube was opened (via an iOS Shortcuts automation) and logs the time.

## Run on your iPhone
1. Open `DoomscrollerBlocker.xcodeproj` in Xcode.
2. Select the project, then the target, then **Signing & Capabilities**. Pick your own Team and change the Bundle Identifier to something unique (free accounts cannot share one).
3. Plug in the iPhone, enable Developer Mode, choose it as the run destination, press Run.
4. Shortcuts app, Automation, New, App, YouTube, Is Opened, Run Immediately, then add the action **YouTube Was Opened**.
5. Open YouTube. The app should come to the front and log a line.

`project.yml` is the source for the Xcode project (`brew install xcodegen && xcodegen`). Optional: copy `Local.xcconfig.example` to `Local.xcconfig` to keep personal signing out of git.
