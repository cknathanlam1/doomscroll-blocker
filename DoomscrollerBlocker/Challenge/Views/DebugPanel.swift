import SwiftUI

/// Developer panel (UI_SPEC §2.11), off by default (`debug` setting): a chip with fps and latency that
/// opens the live numbers, the threshold sliders and the last counter events.
struct DebugPanel: View {
    @ObservedObject var session: ChallengeSession
    /// The open body takes at most 46% of the screen height and scrolls (UI_SPEC §2.11).
    var maxBodyHeight: CGFloat = 360
    @State private var open = ProcessInfo.processInfo.arguments.contains("-debugOpen")
    @State private var down = 0.25
    @State private var partial = 0.0
    @State private var up = 0.0
    @State private var loaded = false

    private var snap: CounterSnapshot? { session.snapshot }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if open { bodyView }
            Button { open.toggle() } label: {
                Text(chipText)
                    .font(.mono(11, 600))
                    .foregroundStyle(Theme.fg)
                    .lineLimit(1)
                    .padding(.horizontal, 10)
                    .frame(height: 30)
                    .background(.black.opacity(0.6), in: Capsule())
                    .overlay(Capsule().strokeBorder(Color.white.opacity(0.16), lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
        .onAppear { loadTuning() }
    }

    private var chipText: String {
        guard snap != nil else { return "debug" }
        return String(format: "%.0ffps %.0fms", session.fps, session.detectMs) + (open ? " ▾" : " ▴")
    }

    private func loadTuning() {
        guard !loaded else { return }
        loaded = true
        let c = session.config
        down = c.downThreshold; partial = c.partialMinDepth; up = c.upThreshold
    }

    private var bodyView: some View {
        ScrollView {
            bodyContent
        }
        .frame(height: maxBodyHeight)
        .background(.black.opacity(0.74), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var bodyContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(stats).font(.mono(11)).foregroundStyle(Color(hex: 0xD9D9DC)).fixedSize(horizontal: false, vertical: true)
            slider("down", $down, 0.10...0.50) { v in session.updateConfig { $0.downThreshold = v } }
            slider("partial", $partial, 0.04...0.40) { v in session.updateConfig { $0.partialMinDepth = v } }
            slider("up", $up, 0.00...0.25) { v in session.updateConfig { $0.upThreshold = v } }
            Text("EVENTS").font(.mono(10)).foregroundStyle(Theme.mute)
            ForEach(Array(events.enumerated()), id: \.offset) { _, line in
                Text(line.text).font(.mono(11)).foregroundStyle(line.color).lineLimit(1)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func slider(_ label: String, _ value: Binding<Double>, _ range: ClosedRange<Double>, _ apply: @escaping (Double) -> Void) -> some View {
        HStack(spacing: 6) {
            Text(label).font(.mono(11)).foregroundStyle(Color(hex: 0xD9D9DC)).frame(width: 52, alignment: .leading)
            Slider(value: value, in: range, step: 0.01) { _ in apply(value.wrappedValue) }
                .tint(Theme.volt)
            Text(String(format: "%.2f", value.wrappedValue)).font(.mono(11)).foregroundStyle(Color(hex: 0xD9D9DC)).frame(width: 36)
        }
    }

    // MARK: Text

    private func f(_ v: Double?, _ digits: Int = 2) -> String { v.map { String(format: "%.\(digits)f", $0) } ?? "–" }

    private var stats: String {
        guard let s = snap else { return "waiting for the first frame…" }
        let ft = s.features
        let yes = { (b: Bool) in b ? "✓" : "✗" }
        return [
            "model  \(session.source == .demo ? "demo/simulated" : "vision") · \(session.source.rawValueForDebug)",
            "speed  \(f(session.fps, 1)) fps · \(f(session.detectMs, 1)) ms inference",
            "phase  \(s.phase.rawValue) / \(s.motion.rawValue) · count \(s.count)/\(s.target)",
            "depth  \(f(s.depth, 3))  raw \(f(s.rawDepth, 3))  peak \(f(s.peakDepth, 3))",
            "src    \(s.depthSource?.rawValue ?? "–") · down \(f(session.config.downThreshold))",
            "h      \(f(s.heightRatio, 3))  hTop \(f(s.baselineRatio, 3))",
            "sw     ratio \(f(s.shoulderWidthRatio))  frac \(f(ft.shoulderWidthFrac))  tilt \(ft.shoulderTiltDeg.map { String(Int($0.rounded())) } ?? "–")°",
            "elbow  2D \(ft.elbowAngle2D.map { String(Int($0.rounded())) } ?? "–")°  3D \(ft.elbowAngle3D.map { String(Int($0.rounded())) } ?? "–")°",
            "conf   sh \(f(ft.shoulderConfidence))  upper \(f(ft.upperBodyConfidence))",
            "seen   inFrame \(yes(s.inFrame)) plank \(yes(s.plankOk)) wrists \(ft.visibleWrists) nose \(yes(ft.noseVisible))",
            "hint   \(s.hint?.rawValue ?? "–") · issue \(session.issue.rawValue)",
        ].joined(separator: "\n")
    }

    private var events: [(text: String, color: Color)] {
        let all = session.debugEvents
        let t0 = all.first?.t ?? 0
        return all.suffix(8).reversed().map { e in
            let s = String(format: "%.1fs ", (e.t - t0) / 1000)
            switch e {
            case .rep(_, let n, let ms, let peak):
                return (s + "rep #\(n) · peak \(f(peak)) · \(f(ms / 1000, 1))s", Theme.volt)
            case .partial(_, let peak, let live):
                return (s + "didn't count · peak \(f(peak))" + (live ? " (turned back)" : ""), Theme.warn)
            case .countdownTick(_, let n): return (s + "countdown \(n)", Color(hex: 0xD9D9DC))
            case .start(_, let b): return (s + "start · hTop \(f(b))", Color(hex: 0xD9D9DC))
            case .complete(_, let n, let ms): return (s + "complete · \(n) in \(f(ms / 1000, 1))s", Color(hex: 0xD9D9DC))
            default: return (s + e.type, Color(hex: 0xD9D9DC))
            }
        }
    }
}

private extension FrameSourceKind {
    var rawValueForDebug: String { self == .camera ? "camera" : "demo" }
}
