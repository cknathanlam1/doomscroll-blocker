import SwiftUI

/// The warning that appears when YouTube is opened and locked (wireframe 2, "Intercept"),
/// police-tape style: a siren glow, hazard stripes, and a short wait before the push-ups start
/// by themselves. "Start now" skips the wait; "Give up" leaves.
struct InterceptView: View {
    let reps: Int
    /// Seconds of warning before the challenge starts by itself.
    var waitSeconds: Double = 5
    var onStart: () -> Void
    var onGiveUp: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appearedAt = Date()

    init(reps: Int, waitSeconds: Double = 5, onStart: @escaping () -> Void, onGiveUp: @escaping () -> Void) {
        self.reps = reps
        self.waitSeconds = waitSeconds
        self.onStart = onStart
        self.onGiveUp = onGiveUp
        AppFonts.register()
    }

    var body: some View {
        TimelineView(.animation) { timeline in
            let elapsed = timeline.date.timeIntervalSince(appearedAt)
            let left = max(0, waitSeconds - elapsed)
            ZStack {
                Theme.page.ignoresSafeArea()
                Siren(phase: reduceMotion ? 0.5 : elapsed, still: reduceMotion)
                    .ignoresSafeArea()
                VStack(spacing: 0) {
                    HazardTape().frame(height: 34)
                    Spacer(minLength: 12)
                    VStack(spacing: 6) {
                        Text("WARNING!")
                            .font(.barlow(104, .black))
                            .foregroundStyle(Theme.bad)
                            .textShadow(blur: 24, y: 0, Theme.bad.opacity(0.55))
                            .minimumScaleFactor(0.6)
                            .lineLimit(1)
                        Text("YOU'RE ABOUT TO DOOMSCROLL")
                            .font(.barlow(38, .extraBold))
                            .foregroundStyle(Theme.volt)
                            .multilineTextAlignment(.center)
                            .lineSpacing(-4)
                    }
                    .padding(.horizontal, 20)
                    Spacer(minLength: 12)
                    VStack(spacing: 10) {
                        Text("\(reps) push-ups to open YouTube")
                            .font(.ui(22, 750))
                            .foregroundStyle(Theme.fg)
                        Text("Prop the phone up on the floor, about 3 ft from your head.")
                            .font(.ui(14, 500))
                            .foregroundStyle(Theme.mute)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.horizontal, 28)
                    Spacer(minLength: 16)
                    VStack(spacing: 10) {
                        Text("Starting in \(max(1, Int(ceil(left))))")
                            .font(.barlow(34, .extraBold))
                            .foregroundStyle(Theme.fg)
                            .monospacedDigit()
                        ProgressBar(fraction: min(1, elapsed / waitSeconds))
                            .frame(height: 8)
                    }
                    .padding(.horizontal, 28)
                    Spacer(minLength: 18)
                    VStack(spacing: 4) {
                        AppButton(title: "Start now", icon: nil, kind: .primary, height: 58, action: onStart)
                        AppButton(title: "Give up", icon: nil, kind: .ghost, action: onGiveUp)
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
                    HazardTape().frame(height: 34)
                }
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            appearedAt = Date()
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
        }
        .task {
            try? await Task.sleep(for: .seconds(waitSeconds))
            guard !Task.isCancelled else { return }
            onStart()
        }
    }
}

/// Alternating red / blue glows, like a patrol car.
private struct Siren: View {
    var phase: Double
    var still: Bool

    var body: some View {
        let a = still ? 0.5 : (sin(phase * 2 * .pi * 1.6) + 1) / 2
        ZStack {
            RadialGradient(colors: [Theme.bad.opacity(0.55 * a), .clear],
                           center: .topLeading, startRadius: 10, endRadius: 520)
            RadialGradient(colors: [Color(hex: 0x2F6BFF).opacity(0.55 * (1 - a)), .clear],
                           center: .topTrailing, startRadius: 10, endRadius: 520)
        }
    }
}

/// Diagonal yellow / black caution tape.
private struct HazardTape: View {
    var body: some View {
        Canvas { ctx, size in
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Theme.volt))
            let stripe: CGFloat = 26
            var x: CGFloat = -size.height
            while x < size.width + size.height {
                var p = Path()
                p.move(to: CGPoint(x: x, y: size.height))
                p.addLine(to: CGPoint(x: x + stripe / 2, y: size.height))
                p.addLine(to: CGPoint(x: x + stripe / 2 + size.height, y: 0))
                p.addLine(to: CGPoint(x: x + size.height, y: 0))
                p.closeSubpath()
                ctx.fill(p, with: .color(Theme.voltInk))
                x += stripe
            }
        }
        .clipped()
        .ignoresSafeArea(edges: .horizontal)
    }
}

private struct ProgressBar: View {
    var fraction: Double
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.panel2)
                Capsule().fill(Theme.bad).frame(width: geo.size.width * fraction)
            }
        }
    }
}
