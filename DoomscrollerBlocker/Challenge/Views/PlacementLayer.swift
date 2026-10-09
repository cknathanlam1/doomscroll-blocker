import SwiftUI

/// Placement (wireframe 3, UI_SPEC §2.3): "Prop it up", the diagram, the hint while the user gets in
/// a plank, then "You're in frame" and the 3-2-1 countdown. Lives on top of the live camera.
struct PlacementLayer: View {
    @ObservedObject var session: ChallengeSession
    var size: CGSize
    var insets: EdgeInsets

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var bump: CGFloat = 1

    private var snap: CounterSnapshot? { session.snapshot }
    private var countingDown: Bool { snap?.phase == .countdown }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                HStack {
                    Text("Prop it up")
                        .font(.ui(22, 750))
                        .tracking(-0.015 * 22)
                        .foregroundStyle(Theme.fg)
                        .textShadow(blur: 10, y: 2, .black.opacity(0.6))
                    Spacer()
                    Text("Step back")
                        .font(.ui(12.5))
                        .foregroundStyle(Theme.mute)
                }
                PlacementDiagram()
            }

            // The open area between the card and the bottom block. The green brackets fill it during the countdown.
            Group {
                if countingDown {
                    CornerBrackets().padding(.vertical, 12)
                } else {
                    Color.clear
                }
            }
            .frame(minHeight: 60, maxHeight: .infinity)

            if countingDown { countdown } else { hint }
        }
        .padding(.top, insets.top + 14)
        .padding(.leading, insets.leading + 16)
        .padding(.trailing, insets.trailing + 16)
        .padding(.bottom, insets.bottom + 58)
        .onChange(of: session.countdownTick) { _, _ in playBump() }
    }

    // MARK: Hint (phase = waiting)

    private var hint: some View {
        let h = ChallengeUI.placementHint(snap?.hint)
        return HStack(alignment: .center, spacing: 12) {
            IconView(icon: h.icon, size: 36, color: Theme.volt, weight: .semibold)
            Text(h.text)
                .font(.ui(26, 800))
                .tracking(-0.01 * 26)
                .lineSpacing(-1.9)
                .multilineTextAlignment(.leading)
                .foregroundStyle(Theme.fg)
                .fixedSize(horizontal: false, vertical: true)
                .textShadow(blur: 12, y: 2, .black.opacity(0.7))
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Countdown (phase = countdown)

    private var countdown: some View {
        let digitSize = ChallengeUI.countdownFontSize(screenHeight: size.height)
        let digit = ChallengeUI.countdownDigit(remainingMs: snap?.countdownRemainingMs)
        return VStack(spacing: 10) {
            HStack(spacing: 8) {
                IconView(icon: .check, size: 24, color: Theme.okInk, weight: .heavy)
                Text("You're in frame")
                    .font(.ui(20, 800))
                    .foregroundStyle(Theme.okInk)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(Theme.ok, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Hold plank.")
                        .font(.ui(22, 700))
                        .foregroundStyle(Theme.fg)
                        .textShadow(blur: 10, y: 2, .black.opacity(0.7))
                    Text("Starting in")
                        .font(.ui(22, 500))
                        .foregroundStyle(Theme.mute)
                }
                .padding(.bottom, 8)
                Spacer()
                BarlowText(text: String(digit), size: digitSize, color: Theme.volt, lineHeight: 0.82, trackingEm: -0.02, digits: true)
                    .scaleEffect(bump)
                    .textShadow(blur: 30, y: 4, .black.opacity(0.6))
            }
            .padding(.horizontal, 4)
        }
    }

    private func playBump() {
        guard !reduceMotion else { return }
        var t = Transaction(animation: nil)
        t.disablesAnimations = true
        withTransaction(t) { bump = 1.18 }
        let scale = DemoDebug.current.animationScale
        DispatchQueue.main.async {
            withAnimation(.timingCurve(0.2, 1.6, 0.4, 1, duration: 0.45 * scale)) { bump = 1 }
        }
    }
}

/// The side-view diagram card (UI_SPEC §2.3): a 250 × 100 SVG scaled to the card's inner width.
struct PlacementDiagram: View {
    var body: some View {
        GeometryReader { geo in
            let s = geo.size.width / 250
            Canvas { ctx, _ in
                func P(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: x * s, y: y * s) }
                func line(_ a: CGPoint, _ b: CGPoint, _ color: Color, _ width: Double, cap: CGLineCap = .butt) {
                    var p = Path(); p.move(to: a); p.addLine(to: b)
                    ctx.stroke(p, with: .color(color), style: StrokeStyle(lineWidth: width * s, lineCap: cap))
                }
                // Floor
                line(P(4, 84), P(246, 84), Theme.dim, 2)
                // Person: body, arm, head
                line(P(140, 60), P(28, 80), Theme.fg, 7, cap: .round)
                line(P(139, 61), P(141, 83), Theme.fg, 5, cap: .round)
                ctx.fill(Path(ellipseIn: CGRect(x: 142 * s, y: 46 * s, width: 16 * s, height: 16 * s)), with: .color(Theme.fg))
                // Phone and its stand
                ctx.fill(Path(roundedRect: CGRect(x: 220 * s, y: 46 * s, width: 13 * s, height: 36 * s), cornerRadius: 3 * s),
                         with: .color(Theme.volt))
                line(P(232, 70), P(242, 83), Theme.volt, 3, cap: .round)
                ctx.fill(Path(ellipseIn: CGRect(x: (226.5 - 1.8) * s, y: (51 - 1.8) * s, width: 3.6 * s, height: 3.6 * s)),
                         with: .color(Theme.voltInk))
                // Dimension line
                line(P(158, 94), P(218, 94), Theme.volt, 1.5)
                line(P(158, 90), P(158, 98), Theme.volt, 1.5)
                line(P(218, 90), P(218, 98), Theme.volt, 1.5)
                // Labels
                let ft = ctx.resolve(Text("~3 FT").font(.barlow(15 * s, .extraBold)).foregroundStyle(Theme.volt))
                ctx.draw(ft, at: P(188, 78), anchor: .init(x: 0.5, y: 0.78))
                let l1 = ctx.resolve(Text("Head toward the phone").font(.ui(10 * s)).foregroundStyle(Theme.mute))
                ctx.draw(l1, at: P(6, 16), anchor: .init(x: 0, y: 0.78))
                let l2 = ctx.resolve(Text("Upright, screen facing you").font(.ui(10 * s)).foregroundStyle(Theme.mute))
                ctx.draw(l2, at: P(244, 16), anchor: .init(x: 1, y: 0.78))
            }
        }
        .aspectRatio(2.5, contentMode: .fit)
        .padding(.top, 10)
        .padding(.horizontal, 10)
        .padding(.bottom, 6)
        .background(Theme.panel.opacity(0.86), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .background(.ultraThinMaterial.opacity(0.3), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Prop the phone up about 3 feet from your head, head toward the phone")
    }
}

/// Four green corner brackets (`#frame-ok`): 32 long, 5 thick, following the box's 18 pt rounded corners.
struct CornerBrackets: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
            .strokeBorder(Theme.ok, lineWidth: 5)
            .mask {
                GeometryReader { geo in
                    let w = geo.size.width, h = geo.size.height, l: CGFloat = 32
                    Path { p in
                        p.addRect(CGRect(x: 0, y: 0, width: l, height: l))
                        p.addRect(CGRect(x: w - l, y: 0, width: l, height: l))
                        p.addRect(CGRect(x: 0, y: h - l, width: l, height: l))
                        p.addRect(CGRect(x: w - l, y: h - l, width: l, height: l))
                    }
                }
            }
            .accessibilityHidden(true)
    }
}
