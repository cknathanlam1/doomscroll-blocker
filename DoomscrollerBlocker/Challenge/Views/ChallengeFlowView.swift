import SwiftUI

/// The whole push-up challenge as the user sees it: loading → Placement → Challenge →
/// Success / Gave up / Camera error (docs/UI_SPEC.md §2). Presented full screen by the app flow.
///
/// STUB: the real screens are built in milestone M3.
struct ChallengeFlowView: View {
    @ObservedObject var session: ChallengeSession
    /// Success: the user earned the pass (the app starts it and opens YouTube).
    var onUnlock: () -> Void
    /// Leave the challenge without unlocking (Done / Give up / Back).
    var onClose: () -> Void

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            Text("Challenge UI goes here (M3)\n\(String(describing: session.screen))")
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
        }
    }
}
