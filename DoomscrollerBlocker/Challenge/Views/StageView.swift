import SwiftUI

/// The camera stage (UI_SPEC §1.8): picture, figure/depth-line canvas, vignette, scrims, then the
/// Placement or Challenge layer, and the overlays that sit above them.
struct StageView: View {
    @ObservedObject var session: ChallengeSession
    var onGiveUp: () -> Void
    var onExitDemo: () -> Void
    var onCancelLoading: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var snap: CounterSnapshot? { session.snapshot }
    private var paused: Bool { snap?.phase == .paused }
    private var inChallenge: Bool {
        switch snap?.phase {
        case .counting?, .paused?, .complete?: return true
        default: return false
        }
    }
    private var now: Double { snap?.features.t ?? 0 }
    private var cueOn: Bool { inChallenge && ChallengeUI.cueOn(now: now, cueUntil: session.cueUntil, paused: paused) }

    var body: some View {
        // The outer reader keeps the safe area, so it reports the real insets; the stage itself ignores it.
        GeometryReader { outer in
            stage(insets: outer.safeAreaInsets).ignoresSafeArea()
        }
        .background(Color.black.ignoresSafeArea())
    }

    private func stage(insets: EdgeInsets) -> some View {
        GeometryReader { geo in
            let size = geo.size
            let edge = insets
            ZStack {
                // 1-2. Picture
                if session.source == .demo {
                    DemoBackdrop()
                } else {
                    Color.black
                    CameraPreview(session: session.camera.session)
                }

                // 3. Figure, depth line, silhouette
                StageOverlay(
                    frame: session.frame,
                    style: session.issue == .tooDark ? .faint : (cueOn ? .warn : .normal),
                    depthLineY: inChallenge && !paused ? snap?.depthLineY : nil,
                    depthLineState: ChallengeUI.depthLineState(attempt: session.attempt, cueOn: cueOn),
                    isDemo: session.source == .demo,
                    byConfidence: session.debug,
                    guideHandY: session.debug && inChallenge ? snap?.features.wristMid?.y : nil,
                    guideShoulderY: session.debug && inChallenge ? snap?.features.shoulderMid?.y : nil
                )

                // 4-5. Vignette and scrims
                Vignette()
                VStack(spacing: 0) {
                    LinearGradient(stops: [
                        .init(color: .black.opacity(0.82), location: 0),
                        .init(color: .black.opacity(0.45), location: 0.6),
                        .init(color: .black.opacity(0), location: 1),
                    ], startPoint: .top, endPoint: .bottom)
                        .frame(height: insets.top + 300)
                    Spacer(minLength: 0)
                    LinearGradient(colors: [.black.opacity(0), .black.opacity(0.85)], startPoint: .top, endPoint: .bottom)
                        .frame(height: insets.bottom + 240)
                }
                .allowsHitTesting(false)

                // 6. Placement or Challenge
                if inChallenge {
                    ChallengeLayer(session: session, size: size, insets: edge)
                } else {
                    PlacementLayer(session: session, size: size, insets: edge)
                }

                // 7. Too dark (Give up stays above it)
                if session.issue == .tooDark { TooDarkOverlay() }

                // 8. Toast, demo tag, Give up
                if let toast = session.toast {
                    Toast(text: toast)
                        .padding(.horizontal, 16)
                        .padding(.leading, insets.leading)
                        .padding(.trailing, insets.trailing)
                        .frame(width: size.width, height: size.height, alignment: .top)
                        .padding(.top, size.height * 0.45)
                        .frame(width: size.width, height: size.height, alignment: .top)
                }
                bottomRow(size: size, insets: insets)

                // 9. Debug panel (developer setting, off by default)
                if session.debug {
                    DebugPanel(session: session, maxBodyHeight: size.height * 0.46)
                        .padding(.leading, insets.leading + 8)
                        .padding(.trailing, insets.trailing + 8)
                        .padding(.bottom, insets.bottom + 10)
                        .frame(width: size.width, height: size.height, alignment: .bottomLeading)
                }

                // 10-11. Loading and "Tap to resume"
                if session.loadingMessage != nil {
                    LoadingOverlay(message: session.loadingMessage ?? "", onCancel: onCancelLoading)
                }
                if session.needsTapToResume {
                    ResumeOverlay(action: session.tapToResume)
                }
            }
            .frame(width: size.width, height: size.height)
            #if DEBUG
            .overlay { stepGestures }
            #endif
        }
    }

    // MARK: Give up, demo tag

    private func bottomRow(size: CGSize, insets: EdgeInsets) -> some View {
        ZStack(alignment: .bottom) {
            Button(action: onGiveUp) {
                Text("Give up")
                    .font(.ui(13, 500))
                    .foregroundStyle(Color.white.opacity(0.42))
                    .padding(.vertical, 12)
                    .padding(.horizontal, 18)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .padding(.bottom, insets.bottom + 10)

            if session.source == .demo {
                HStack {
                    Spacer()
                    DemoTag(showLabel: ChallengeUI.demoTagShowsLabel(screenWidth: size.width), onExit: onExitDemo)
                }
                .padding(.trailing, insets.trailing + 14)
                .padding(.bottom, insets.bottom + 16)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .bottom)
    }

    #if DEBUG
    /// Debug-only frame stepping for the demo when it is paused (`-demoManual`): tap = 1 frame, long press = 30.
    @ViewBuilder private var stepGestures: some View {
        if session.source == .demo, session.demoPaused {
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { session.demoStep(1) }
                .onLongPressGesture { session.demoStep(30) }
                .padding(.bottom, 120)
                .padding(.top, 60)
        }
    }
    #endif
}

// MARK: - Backdrop, vignette

/// The demo's fake camera picture (UI_SPEC §5.4).
struct DemoBackdrop: View {
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                LinearGradient(stops: [
                    .init(color: Color(hex: 0x151210), location: 0),
                    .init(color: Color(hex: 0x2A241E), location: 0.58),
                    .init(color: Color(hex: 0x4A4034), location: 0.74),
                    .init(color: Color(hex: 0x3A3128), location: 1),
                ], startPoint: .top, endPoint: .bottom)
                // radial-gradient(ellipse 120% 60% at 50% 28%, rgba(255,220,170,.10), transparent 60%)
                Rectangle()
                    .fill(RadialGradient(colors: [Color(red: 1, green: 220 / 255, blue: 170 / 255, opacity: 0.10), .clear],
                                         center: .center, startRadius: 0, endRadius: 50))
                    .frame(width: 100, height: 100)
                    .scaleEffect(x: 0.72 * w / 50, y: 0.36 * h / 50)
                    .position(x: w / 2, y: 0.28 * h)
            }
        }
        .accessibilityHidden(true)
    }
}

/// `box-shadow: inset 0 0 110px rgba(0,0,0,.6)`: darkens the edges, fading inward.
struct Vignette: View {
    var body: some View {
        Canvas { ctx, size in
            var p = Path()
            p.addRect(CGRect(x: -400, y: -400, width: size.width + 800, height: size.height + 800))
            p.addRect(CGRect(origin: .zero, size: size))
            ctx.addFilter(.blur(radius: 55))
            ctx.fill(p, with: .color(.black.opacity(0.6)), style: FillStyle(eoFill: true))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Small stage pieces

/// "▶ Demo" and "✕ Exit demo" (UI_SPEC §2.4.11).
struct DemoTag: View {
    var showLabel: Bool
    var onExit: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            if showLabel {
                HStack(spacing: 4) {
                    IconView(icon: .play, size: 11, color: Theme.volt)
                    Text("Demo").font(.ui(11.5, 700)).foregroundStyle(Theme.volt)
                }
            }
            Button(action: onExit) {
                HStack(spacing: 3) {
                    IconView(icon: .close, size: 11, color: Theme.voltInk, weight: .heavy)
                    Text("Exit demo").font(.ui(11.5, 800)).foregroundStyle(Theme.voltInk)
                }
                .padding(.horizontal, 9)
                .frame(height: 20)
                .background(Theme.volt, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(.leading, 10)
        .padding(.trailing, 3)
        .frame(height: 26)
        .background(.black.opacity(0.55), in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.volt.opacity(0.45), lineWidth: 1))
    }
}

struct Toast: View {
    var text: String

    var body: some View {
        Text(text)
            .font(.ui(15, 600))
            .foregroundStyle(Theme.fg)
            .multilineTextAlignment(.center)
            .padding(.vertical, 12)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity)
            .background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.white.opacity(0.16), lineWidth: 1))
            .allowsHitTesting(false)
    }
}

/// "Too dark" (wireframe S3, UI_SPEC §2.5).
struct TooDarkOverlay: View {
    var body: some View {
        ZStack {
            Color(red: 5 / 255, green: 5 / 255, blue: 4 / 255, opacity: 0.9)
            VStack(spacing: 12) {
                Circle()
                    .fill(Theme.volt)
                    .frame(width: 96, height: 96)
                    .overlay(IconView(icon: .sun, size: 54, color: Theme.voltInk, weight: .medium))
                BarlowText(text: "TOO DARK", size: 60, color: Theme.fg, lineHeight: 0.9)
                Text("Turn on a light\nor face a window")
                    .font(.ui(19, 650))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Theme.fg)
            }
            .padding(24)
        }
        .ignoresSafeArea()
        .accessibilityElement(children: .combine)
    }
}

/// Spinner + message while the camera starts (UI_SPEC §2.2).
struct LoadingOverlay: View {
    var message: String
    var onCancel: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spin = false

    var body: some View {
        ZStack {
            Color(red: 11 / 255, green: 11 / 255, blue: 13 / 255, opacity: 0.92)
            VStack(spacing: 14) {
                ZStack {
                    Circle().stroke(Theme.dim, lineWidth: 3)
                    Circle().trim(from: 0, to: 0.25).stroke(Theme.volt, style: StrokeStyle(lineWidth: 3, lineCap: .butt))
                        .rotationEffect(.degrees(spin ? 360 : 0))
                }
                .frame(width: 40, height: 40)
                Text(message).font(.ui(20, 750)).foregroundStyle(Theme.fg)
                AppButton(title: "Cancel", icon: nil, kind: .ghost, action: onCancel)
                    .frame(maxWidth: 220)
                    .padding(.top, 6)
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 32)
        }
        .ignoresSafeArea()
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) { spin = true }
        }
    }
}

/// "Tap to resume": the automatic camera restart failed (UI_SPEC §2.9).
struct ResumeOverlay: View {
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Color(red: 11 / 255, green: 11 / 255, blue: 13 / 255, opacity: 0.94)
                VStack(spacing: 16) {
                    Circle()
                        .fill(Theme.volt)
                        .frame(width: 112, height: 112)
                        .overlay(IconView(icon: .play, size: 52, color: Theme.voltInk).offset(x: 6))
                    BarlowText(text: "TAP TO RESUME", size: 48, color: Theme.fg, lineHeight: 0.95)
                    Text("The camera pauses when the screen locks or you switch apps. Your count is kept.")
                        .font(.ui(12.5))
                        .foregroundStyle(Theme.mute)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 300)
                }
                .padding(32)
            }
            .ignoresSafeArea()
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Tap to resume")
    }
}
