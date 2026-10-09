import SwiftUI
import UIKit

// The full-screen, non-camera screens: Success, Gave up, Camera error (UI_SPEC §2.6 to §2.8).

/// Regular screen (UI_SPEC §1.5): padding safe + 20, a centred block and a bottom stack.
private struct ScreenScaffold<Center: View, Bottom: View>: View {
    var background: Color
    var bottomSpacing: CGFloat = 4
    @ViewBuilder var center: () -> Center
    @ViewBuilder var bottom: () -> Bottom

    var body: some View {
        ZStack {
            background.ignoresSafeArea()
            VStack(spacing: 16) {
                Spacer(minLength: 0)
                center().frame(maxWidth: .infinity, alignment: .leading)
                Spacer(minLength: 0)
                VStack(spacing: bottomSpacing) { bottom() }
            }
            .padding(20)
        }
    }
}

/// The 84 pt rounded icon tile of Gave up and Camera error.
private struct IconTile: View {
    var icon: Icon
    var color: Color = Theme.fg

    var body: some View {
        RoundedRectangle(cornerRadius: 26, style: .continuous)
            .fill(Theme.panel2)
            .frame(width: 84, height: 84)
            .overlay(IconView(icon: icon, size: 44, color: color, weight: .medium))
    }
}

private extension View {
    /// `.h-xl`: 30 / 800, line height 1.08, tracking -0.02em.
    func headlineXL() -> some View {
        font(.ui(30, 800)).tracking(-0.02 * 30).lineSpacing(-3).foregroundStyle(Theme.fg)
    }
}

// MARK: - Success (wireframe 5)

struct SuccessView: View {
    var count: Int
    var elapsedMs: Double
    /// The real pass length (`OpenLog.passDuration`): never hard-coded.
    var passSeconds: TimeInterval
    /// Open YouTube now (the button), or after 3 s on its own.
    var onUnlock: () -> Void

    @State private var secondsLeft = 3
    @State private var fired = false

    var body: some View {
        ScreenScaffold(background: Theme.volt, bottomSpacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                BarlowText(text: "SCROLL EARNED.", size: 40, color: Theme.voltInk, weight: .blackItalic, lineHeight: 1)
                BarlowText(text: ChallengeUI.formatPassTime(seconds: passSeconds), size: 132, color: Theme.voltInk,
                           lineHeight: 0.82, trackingEm: -0.02, digits: true)
                    .padding(.top, 14)
                    .padding(.bottom, 6)
                    .padding(.leading, -4)
                VStack(alignment: .leading, spacing: 0) {
                    Text("YouTube unlocked")
                    Text(ChallengeUI.passSubline(seconds: passSeconds))
                }
                .font(.ui(22, 750))
                .foregroundStyle(Theme.voltInk)
                HStack(spacing: 6) {
                    IconView(icon: .check, size: 18, color: Theme.voltInk.opacity(0.8), weight: .semibold)
                    Text("\(count) push-ups · \(ChallengeUI.formatElapsed(ms: elapsedMs))")
                        .font(.ui(15, 700))
                        .foregroundStyle(Theme.voltInk.opacity(0.8))
                }
                .padding(.top, 22)
            }
            .accessibilityElement(children: .combine)
        } bottom: {
            AppButton(title: "Open YouTube", icon: .out, kind: .black, action: fire)
            Text(secondsLeft > 0 ? "Opening automatically in \(secondsLeft)…" : "Opening…")
                .font(.ui(13, 600))
                .foregroundStyle(Theme.voltInk.opacity(0.7))
                .frame(maxWidth: .infinity)
        }
        .task {
            if DemoDebug.current.noAutoUnlock { return }
            for left in [3, 2, 1] {
                secondsLeft = left
                try? await Task.sleep(for: .seconds(1))
                if Task.isCancelled { return }
            }
            secondsLeft = 0
            fire()
        }
    }

    private func fire() {
        guard !fired else { return }
        fired = true
        onUnlock()
    }
}

// MARK: - Gave up (wireframe 6)

struct GaveUpView: View {
    var onTryAgain: () -> Void
    var onDone: () -> Void
    /// Landmark recording to export, if there is one.
    var recording: (frames: Int, makeFile: () -> URL?)?

    @State private var shareURL: RecordingShareItem?

    var body: some View {
        ScreenScaffold(background: Theme.page) {
            VStack(alignment: .leading, spacing: 12) {
                IconTile(icon: .lock)
                Text("YouTube stays locked").headlineXL()
                Text("No push-ups, no scroll. Fair trade. It'll be here when you're ready.")
                    .font(.ui(15)).lineSpacing(3).foregroundStyle(Theme.mute)
                Text("Head anywhere else you like. YouTube unlocks after a full set.")
                    .font(.ui(12.5)).foregroundStyle(Theme.mute)
            }
        } bottom: {
            AppButton(title: "Try again", icon: .redo, kind: .primary, action: onTryAgain)
            AppButton(title: "Done", icon: nil, kind: .ghost, action: onDone)
            if let recording {
                AppButton(title: "Save recording (\(recording.frames) frames)", icon: nil, kind: .ghost) {
                    if let url = recording.makeFile() { shareURL = RecordingShareItem(url: url) }
                }
            }
        }
        .sheet(item: $shareURL) { item in RecordingShareSheet(url: item.url) }
    }
}

struct RecordingShareItem: Identifiable {
    let id = UUID()
    let url: URL
}

struct RecordingShareSheet: UIViewControllerRepresentable {
    var url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

// MARK: - Camera error (wireframe S1)

struct CameraErrorView: View {
    var kind: CameraErrorKind
    var onOpenSettings: () -> Void
    var onTryAgain: () -> Void
    var onGiveUp: () -> Void

    struct Copy {
        var title: String
        var body: String
        var steps: [String]
        var note: String?
        var detail: String?
    }

    /// UI_SPEC §2.8, iOS wording.
    static func copy(for kind: CameraErrorKind) -> Copy {
        switch kind {
        case .denied:
            return Copy(title: "Camera is off",
                        body: "We need it to count your reps. Video stays on this iPhone and is never saved.",
                        steps: [], note: nil, detail: nil)
        case .notFound:
            return Copy(title: "No camera found",
                        body: "This device didn't report a front camera we can use.",
                        steps: ["Close the app and open it again", "If it keeps happening, restart your iPhone"],
                        note: nil, detail: nil)
        case .inUse:
            return Copy(title: "Camera is busy",
                        body: "Another app is using the camera right now.",
                        steps: ["Close the Camera app, FaceTime, or other apps that use the camera", "Then tap Try again"],
                        note: nil, detail: nil)
        case .unknown(let message):
            return Copy(title: "Camera didn't start",
                        body: "Something went wrong while turning the camera on.",
                        steps: ["Tap Try again", "If it keeps failing, close the app and open it again"],
                        note: nil, detail: message.isEmpty ? nil : message)
        }
    }

    var body: some View {
        let copy = Self.copy(for: kind)
        let denied = kind == .denied
        ScreenScaffold(background: Theme.page) {
            VStack(alignment: .leading, spacing: 12) {
                IconTile(icon: .camOff, color: Theme.bad)
                Text(copy.title).headlineXL().padding(.top, 10)
                Text(copy.body).font(.ui(15)).lineSpacing(3).foregroundStyle(Theme.mute)
                if denied {
                    // Wireframe S1: one card with the path to the setting.
                    (Text("Settings › Doomscroller Blocker › ").foregroundColor(Theme.mute)
                        + Text("Camera").bold().foregroundColor(Theme.fg))
                        .font(.ui(13))
                        .padding(.vertical, 10)
                        .padding(.horizontal, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(copy.steps.enumerated()), id: \.offset) { i, step in
                            HStack(alignment: .top, spacing: 10) {
                                Text("\(i + 1)")
                                    .font(.ui(13, 700))
                                    .foregroundStyle(Theme.volt)
                                    .frame(width: 26, height: 26)
                                    .background(Theme.panel2, in: Circle())
                                Text(step)
                                    .font(.ui(14))
                                    .foregroundStyle(Theme.fg)
                                    .frame(minHeight: 26, alignment: .leading)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                if let note = copy.note { Text(note).font(.ui(12.5)).foregroundStyle(Theme.mute) }
                if let detail = copy.detail { Text(detail).font(.mono(11.5)).foregroundStyle(Theme.dim) }
            }
        } bottom: {
            if denied {
                AppButton(title: "Open Settings", icon: .out, kind: .primary, action: onOpenSettings)
            } else {
                AppButton(title: "Try again", icon: .redo, kind: .primary, action: onTryAgain)
            }
            AppButton(title: "Give up", icon: nil, kind: .ghost, action: onGiveUp)
        }
    }
}
