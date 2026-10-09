import SwiftUI
import AVFoundation

/// The whole push-up challenge as the user sees it: loading → Placement → Challenge →
/// Success / Gave up / Camera error (docs/UI_SPEC.md §2). Presented full screen by the app flow.
///
/// The flow owner only supplies the two exits:
/// - `onUnlock`: Success. The user earned the pass (the app starts it and opens YouTube). Called by the
///   "Open YouTube" button, or on its own 3 s after Success appears.
/// - `onClose`: leave without unlocking (Done / Give up / Back / Exit demo / Cancel).
struct ChallengeFlowView: View {
    @ObservedObject var session: ChallengeSession
    /// Success: the user earned the pass (the app starts it and opens YouTube).
    var onUnlock: () -> Void
    /// Leave the challenge without unlocking (Done / Give up / Back).
    var onClose: () -> Void

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL

    init(session: ChallengeSession, onUnlock: @escaping () -> Void, onClose: @escaping () -> Void) {
        self.session = session
        self.onUnlock = onUnlock
        self.onClose = onClose
        AppFonts.register()
    }

    var body: some View {
        ZStack {
            Theme.page.ignoresSafeArea()
            switch session.screen {
            case .idle:
                Color.clear
            case .loading, .stage:
                StageView(
                    session: session,
                    onGiveUp: { session.giveUp() },
                    onExitDemo: { exit() },
                    onCancelLoading: { exit() }
                )
            case .success(let count, let elapsedMs):
                SuccessView(count: count, elapsedMs: elapsedMs, passSeconds: OpenLog.passDuration, onUnlock: onUnlock)
            case .gaveUp:
                GaveUpView(
                    onTryAgain: { session.start(session.source) },
                    onDone: { exit() },
                    recording: recordingInfo
                )
            case .cameraError(let kind):
                CameraErrorView(
                    kind: kind,
                    onOpenSettings: openSettings,
                    onTryAgain: { session.start(session.source) },
                    onGiveUp: { exit() }
                )
            }
        }
        // Light status-bar content everywhere except Success, which is volt and needs dark content.
        .preferredColorScheme(isSuccess ? .light : .dark)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                // Back from Settings with the camera allowed: carry on by itself.
                if case .cameraError(.denied) = session.screen,
                   AVCaptureDevice.authorizationStatus(for: .video) == .authorized {
                    session.start(session.source)
                } else {
                    session.resume()
                }
            } else {
                session.suspend()
            }
        }
    }

    private var isSuccess: Bool {
        if case .success = session.screen { return true }
        return false
    }

    private var recordingInfo: (frames: Int, makeFile: () -> URL?)? {
        guard session.source == .camera, session.recordedFrames > 0 else { return nil }
        return (session.recordedFrames, { session.recordingFileURL() })
    }

    private func exit() {
        session.stop()
        onClose()
    }

    private func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
    }
}
