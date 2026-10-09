import SwiftUI

/// One floating "+1" (UI_SPEC §2.4.10).
struct PlusOneItem: Identifiable, Equatable {
    let id = UUID()
    let start: Date
    /// Centre of the text at the start of the animation, in screen points.
    let anchor: CGPoint
}

/// Challenge (wireframe 4, S2, S4; UI_SPEC §2.4): segment bar, chips, the giant count, the DEPTH gauge,
/// the "Go lower" and chest cues, and the paused state. The camera, figure and depth line are drawn
/// below this layer.
struct ChallengeLayer: View {
    @ObservedObject var session: ChallengeSession
    var size: CGSize
    var insets: EdgeInsets

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var bump: CGFloat = 1
    @State private var plusOnes: [PlusOneItem] = []

    private var snap: CounterSnapshot? { session.snapshot }
    private var paused: Bool { snap?.phase == .paused }
    private var now: Double { snap?.features.t ?? 0 }
    private var cueOn: Bool { ChallengeUI.cueOn(now: now, cueUntil: session.cueUntil, paused: paused) }
    private var chestOn: Bool {
        ChallengeUI.chestCueOn(now: now, chestUntil: session.chestUntil, cueOn: cueOn, paused: paused)
    }
    private var target: Int { snap?.target ?? session.config.targetReps }
    private var count: Int { snap?.count ?? 0 }

    var body: some View {
        ZStack(alignment: .topLeading) {
            VStack(spacing: 0) {
                SegmentBar(count: count, target: target)
                    .padding(.bottom, 10)
                chips
                counter
                    .padding(.top, paused ? 8 : -6)
                if paused {
                    ghost
                    Spacer(minLength: 0)
                    lostBlock
                } else {
                    mid
                }
            }
            .padding(.top, insets.top + 14)
            .padding(.leading, insets.leading + 16)
            .padding(.trailing, insets.trailing + 16)
            .padding(.bottom, insets.bottom + 58)

            // The "+1"s float above everything else of the layer.
            ForEach(plusOnes) { item in
                PlusOneView(item: item, fontSize: ChallengeUI.plusOneFontSize(screenHeight: size.height))
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .onChange(of: session.repTick) { _, tick in
            if tick == 0 { plusOnes = [] } else { onRep() }
        }
    }

    // MARK: Chips row (right-aligned, gap 8)

    private var chips: some View {
        HStack(spacing: 8) {
            Spacer(minLength: 0)
            if paused {
                Pill(background: .black.opacity(0.6)) {
                    IconView(icon: .pause, size: 15, color: Theme.fg)
                    Text("Paused").foregroundStyle(Theme.fg)
                }
            }
            if cueOn {
                Pill(background: Theme.warn.opacity(0.2)) {
                    Text("Didn't count").foregroundStyle(Theme.warn)
                }
            }
            if session.speak, !cueOn, !paused {
                VoiceChip(word: session.voiceWord ?? "Go", pulse: session.voicePulse)
            }
        }
        .frame(height: 30)
    }

    // MARK: The count

    private var counter: some View {
        let big = paused ? 110 : ChallengeUI.countFontSize(screenHeight: size.height)
        return HStack(alignment: .bottom, spacing: 2) {
            BarlowText(text: String(count), size: big, color: paused ? Theme.fg : Theme.volt,
                       lineHeight: 0.82, trackingEm: -0.02, digits: true)
                .scaleEffect(bump)
                .textShadow(blur: 30, y: 4, .black.opacity(0.6))
            BarlowText(text: "/\(target)", size: paused ? 36 : 58, color: Theme.fg.opacity(0.92),
                       weight: .extraBold, lineHeight: 1)
                .padding(.bottom, paused ? 6 : 10)
            Spacer(minLength: 0)
        }
        .opacity(paused ? 0.5 : 1)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.3), value: paused)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(count) of \(target) push-ups")
    }

    // MARK: Mid area: gauge, cues

    private var mid: some View {
        GeometryReader { geo in
            let h = geo.size.height
            let trackH = ChallengeUI.gaugeHeight(midHeight: h)
            ZStack(alignment: .topTrailing) {
                // DEPTH label: right edge 10 pt past the layer padding; gauge 4 pt past it.
                BarlowText(text: "DEPTH", size: 14, color: Theme.volt, weight: .extraBold, lineHeight: 1.2)
                    .offset(x: 10)
                DepthGauge(
                    height: trackH,
                    percent: ChallengeUI.gaugePercent(
                        depth: snap?.depth, downThreshold: session.config.downThreshold,
                        cueOn: cueOn, attempt: session.attempt, partialPeak: session.partialPeak),
                    attempt: session.attempt,
                    cueOn: cueOn
                )
                .offset(x: 4, y: 22)
            }
            .frame(width: geo.size.width, height: h, alignment: .topTrailing)

            if chestOn {
                Text("Chest down, not just your head")
                    .font(.ui(17, 750))
                    .foregroundStyle(Theme.warn)
                    .multilineTextAlignment(.center)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 14)
                    .frame(maxWidth: .infinity)
                    .background(.black.opacity(0.62), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.warn.opacity(0.5), lineWidth: 1))
                    .padding(.trailing, 28)
                    .frame(width: geo.size.width, height: h, alignment: .bottom)
                    .padding(.bottom, 18)
                    .frame(width: geo.size.width, height: h, alignment: .bottom)
            }

            // Always in the tree; fades and slides.
            HStack(spacing: 8) {
                IconView(icon: .down, size: 30, color: Theme.warnInk, weight: .heavy)
                BarlowText(text: "GO LOWER", size: 40, color: Theme.warnInk, lineHeight: 1.1, trackingEm: 0.01)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 64)
            .background(Theme.warn, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .padding(.trailing, 28)
            .opacity(cueOn ? 1 : 0)
            .offset(y: cueOn ? 0 : 8)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: cueOn)
            .frame(width: geo.size.width, height: h, alignment: .bottom)
            .padding(.bottom, 8)
            .frame(width: geo.size.width, height: h, alignment: .bottom)
            .accessibilityHidden(!cueOn)
        }
    }

    // MARK: Paused

    private var ghost: some View {
        GeometryReader { geo in
            UnevenRoundedRectangle(topLeadingRadius: 100, bottomLeadingRadius: 30, bottomTrailingRadius: 30, topTrailingRadius: 100)
                .stroke(Color.white.opacity(0.5), style: StrokeStyle(lineWidth: 3, dash: [5, 2.5]))
                .frame(width: 200, height: min(200, max(0, geo.size.height - 10)))
                .frame(maxWidth: .infinity)
                .padding(.top, 10)
        }
        .frame(maxHeight: 210)
        .accessibilityHidden(true)
    }

    private var lostBlock: some View {
        let copy = ChallengeUI.pausedCopy(hint: snap?.hint, reason: session.pauseReason)
        let lines = copy.title.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    BarlowText(text: line.uppercased(), size: 56, color: Theme.fg, lineHeight: 0.9)
                }
            }
            .textShadow(blur: 16, y: 2, .black.opacity(0.7))
            VStack(alignment: .leading, spacing: 8) {
                tip(.person, copy.tip1)
                tip(.move, copy.tip2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func tip(_ icon: Icon, _ text: String) -> some View {
        HStack(spacing: 10) {
            IconView(icon: icon, size: 20, color: Theme.volt)
            Text(text).font(.ui(16, 600)).foregroundStyle(Theme.fg)
        }
    }

    // MARK: A counted rep

    private func onRep() {
        let fontSize = ChallengeUI.plusOneFontSize(screenHeight: size.height)
        // Anchor: about one shoulder width above the head, mapped like the figure.
        var anchor: CGPoint?
        if let snap, let frame = session.frame, let core = ChallengeUI.plusOneAnchorCore(features: snap.features) {
            let fit = StageFit(size: size, aspect: frame.aspect, mirrored: session.source == .camera)
            anchor = fit.point(core.x, core.y)
        }
        let chipsBottom = insets.top + 14 + 7 + 10 + 30
        let at = ChallengeUI.plusOnePlacement(anchor: anchor, layer: size, chipsBottom: chipsBottom, fontSize: fontSize)
        let item = PlusOneItem(start: Date(), anchor: at)
        plusOnes.append(item)

        if !reduceMotion {
            var t = Transaction(animation: nil)
            t.disablesAnimations = true
            withTransaction(t) { bump = 1.18 }
            let scale = DemoDebug.current.animationScale
            DispatchQueue.main.async {
                withAnimation(.timingCurve(0.2, 1.6, 0.4, 1, duration: 0.45 * scale)) { bump = 1 }
            }
        }

        let ttl = ChallengeUI.plusOneSafetyMs * DemoDebug.current.animationScale / 1000
        Task {
            try? await Task.sleep(for: .seconds(ttl))
            plusOnes.removeAll { $0.id == item.id }
        }
    }
}

// MARK: - Pieces

/// One segment per target rep (UI_SPEC §2.4.2).
struct SegmentBar: View {
    var count: Int
    var target: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<max(1, target), id: \.self) { i in
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(i < count ? Theme.volt : Color.white.opacity(0.18))
                    .frame(height: 7)
            }
        }
        .animation(reduceMotion ? nil : .linear(duration: 0.25), value: count)
        .accessibilityHidden(true)
    }
}

/// "Counting aloud · “Seven”", with the outline pulse each time a word is set (UI_SPEC §2.4.3).
struct VoiceChip: View {
    var word: String
    var pulse: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 0 = a fresh 2 pt volt ring, 1 = the resting 1 pt white outline.
    @State private var ring: Double = 1

    var body: some View {
        HStack(spacing: 6) {
            IconView(icon: .speaker, size: 16, color: Theme.volt)
            (Text("Counting aloud · ").foregroundColor(Theme.fg)
                + Text("“\(word)”").foregroundColor(Theme.volt))
                .font(.ui(13, 650))
        }
        .padding(.leading, 9)
        .padding(.trailing, 11)
        .frame(height: 30)
        .background(.black.opacity(0.55), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.14), lineWidth: 1))
        .overlay(Capsule().strokeBorder(Theme.volt.opacity(1 - ring), lineWidth: 2))
        .onChange(of: pulse) { _, _ in
            guard !reduceMotion else { return }
            var t = Transaction(animation: nil)
            t.disablesAnimations = true
            withTransaction(t) { ring = 0 }
            DispatchQueue.main.async {
                withAnimation(.easeOut(duration: 0.7 * DemoDebug.current.animationScale)) { ring = 1 }
            }
        }
    }
}

/// The DEPTH gauge (UI_SPEC §2.4.5): a track, a fill from the bottom and a mark at 80% of its height.
struct DepthGauge: View {
    var height: CGFloat
    var percent: Int
    var attempt: AttemptLook
    var cueOn: Bool

    private var fillColor: Color {
        if attempt == .reached { return Theme.volt }
        if attempt == .partial && cueOn { return Theme.warn }
        return Theme.fg
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.white.opacity(0.14))
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(fillColor)
                .frame(height: height * CGFloat(percent) / 100)
            // Mark: 3 pt, centred at 80% of the height from the bottom.
            Rectangle()
                .fill(Theme.volt)
                .frame(height: 3)
                .offset(y: -(height * ChallengeUI.gaugeMarkAt) + 1.5)
        }
        .frame(width: 16, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// The floating "+1" (UI_SPEC §2.4.10), driven by the spec's keyframe table so it matches the web exactly.
struct PlusOneView: View {
    var item: PlusOneItem
    var fontSize: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if reduceMotion {
            label(pose: .init(opacity: 1, offsetY: 0, scale: 1))
        } else {
            TimelineView(.animation) { tl in
                let ms = tl.date.timeIntervalSince(item.start) * 1000 / DemoDebug.current.animationScale
                label(pose: ChallengeUI.plusOnePose(atMs: ms))
            }
        }
    }

    private func label(pose: ChallengeUI.PlusOnePose) -> some View {
        BarlowText(text: "+1", size: fontSize, color: Theme.volt, lineHeight: 1)
            .shadow(color: .black, radius: 1)
            .shadow(color: .black.opacity(0.65), radius: 12, y: 4)
            .scaleEffect(pose.scale)
            .opacity(pose.opacity)
            .position(x: item.anchor.x, y: item.anchor.y + pose.offsetY * fontSize)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
