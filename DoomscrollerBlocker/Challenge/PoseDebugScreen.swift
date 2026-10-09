import SwiftUI
import AVFoundation

/// Milestone M0 spike: the raw Vision joints over the live camera, with confidences, fps,
/// and what the counter makes of them. Also the base of the debug panel.
struct PoseDebugScreen: View {
    @StateObject private var session = ChallengeSession()
    @Environment(\.scenePhase) private var scenePhase
    @State private var log: [String] = []
    @State private var shareURL: URL?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if case .cameraError = session.screen {
                Text("Camera access is off. Turn it on in Settings → Doomscroller Blocker.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white)
                    .padding()
            } else {
                CameraPreview(session: session.camera.session).ignoresSafeArea()
                GeometryReader { geo in
                    JointsOverlay(frame: session.frame, snapshot: session.snapshot, size: geo.size)
                }
                .ignoresSafeArea()
                .allowsHitTesting(false)
            }
        }
        .overlay(alignment: .top) { readout }
        .overlay(alignment: .bottom) { eventLog }
        .navigationTitle("Pose debug")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { session.start(.camera) }
        .onDisappear { session.stop() }
        .onChange(of: session.snapshot?.features.t) { _, _ in
            guard let events = session.snapshot?.events, !events.isEmpty else { return }
            log.append(contentsOf: events.map(Self.describe))
            if log.count > 40 { log.removeFirst(log.count - 40) }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Save recording") {
                    shareURL = session.recordingFileURL()
                }
                .disabled(session.recordedFrames == 0)
            }
        }
        .sheet(isPresented: Binding(get: { shareURL != nil }, set: { if !$0 { shareURL = nil } })) {
            if let shareURL { ShareSheet(url: shareURL) }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { session.resume() } else { session.suspend() }
        }
    }

    private var readout: some View {
        let s = session.snapshot
        return VStack(alignment: .leading, spacing: 2) {
            Text(String(format: "%.0f fps · detect %.0f ms", session.fps, session.detectMs))
            Text("phase \(s?.phase.rawValue ?? "-") · motion \(s?.motion.rawValue ?? "-") · count \(s?.count ?? 0)/\(s?.target ?? 0)")
            Text("hint \(s?.hint?.rawValue ?? "-") · issue \(session.issue.rawValue) · inFrame \(String(s?.inFrame ?? false))")
            Text(String(format: "depth %@ · h %@ · wrists %d",
                        s?.depth.map { String(format: "%.2f", $0) } ?? "-",
                        s?.heightRatio.map { String(format: "%.2f", $0) } ?? "-",
                        s?.features.visibleWrists ?? 0))
            Text(String(format: "peak %.2f · need ≥ %.2f to count · frames %d",
                        s?.peakDepth ?? 0, session.config.downThreshold, session.recordedFrames))
            if let t = s?.countdownRemainingMs { Text(String(format: "countdown %.1f s", t / 1000)) }
        }
        .font(.system(size: 12, design: .monospaced))
        .foregroundStyle(.white)
        .padding(8)
        .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
        .padding(.top, 4)
        .allowsHitTesting(false)
    }
}

extension PoseDebugScreen {
    private var eventLog: some View {
        VStack(alignment: .leading, spacing: 1) {
            ForEach(Array(log.suffix(8).enumerated()), id: \.offset) { _, line in Text(line) }
        }
        .font(.system(size: 11, design: .monospaced))
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
        .padding(8)
        .allowsHitTesting(false)
    }

    static func describe(_ e: CounterEvent) -> String {
        let t = String(format: "%7.1fs", e.t / 1000)
        switch e {
        case .rep(_, let count, let ms, let peak): return "\(t) REP #\(count) (peak \(String(format: "%.2f", peak)), \(Int(ms)) ms)"
        case .partial(_, let peak, let live): return "\(t) GO LOWER – not counted (peak \(String(format: "%.2f", peak)), \(live ? "live" : "at top"))"
        case .repCancelled(_, let reason): return "\(t) rep cancelled: \(reason.rawValue)"
        case .depthReached: return "\(t) depth reached"
        case .paused(_, let reason): return "\(t) paused: \(reason.rawValue)"
        case .countdownTick(_, let n): return "\(t) countdown \(n)"
        default: return "\(t) \(e.type)"
        }
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

/// Raw joints with their confidence: green = trusted by the counter, yellow = borderline, red = ignored.
struct JointsOverlay: View {
    let frame: PoseFrame?
    let snapshot: CounterSnapshot?
    let size: CGSize

    private let bones: [(JointName, JointName)] = [
        (.leftShoulder, .rightShoulder),
        (.leftShoulder, .leftElbow), (.leftElbow, .leftWrist),
        (.rightShoulder, .rightElbow), (.rightElbow, .rightWrist),
        (.leftShoulder, .leftHip), (.rightShoulder, .rightHip), (.leftHip, .rightHip),
    ]

    var body: some View {
        Canvas { ctx, _ in
            guard let frame, let joints = frame.joints else { return }
            let fit = OverlayFit(size: size, aspect: frame.aspect)
            func p(_ n: JointName) -> CGPoint? { joints[n].map { fit.point(x: $0.x, y: $0.y) } }
            for (a, b) in bones {
                guard let pa = p(a), let pb = p(b) else { continue }
                var path = Path()
                path.move(to: pa)
                path.addLine(to: pb)
                ctx.stroke(path, with: .color(.white.opacity(0.35)), lineWidth: 2)
            }
            let vis = snapshot.map { _ in DEFAULT_CONFIG.visibilityThreshold } ?? 0.5
            for name in JointName.allCases {
                guard let j = joints[name], let pt = p(name) else { continue }
                let color: Color = j.c >= 0.5 ? .green : (j.c >= max(0.25, vis * 0.5) ? .yellow : .red)
                ctx.fill(Path(ellipseIn: CGRect(x: pt.x - 6, y: pt.y - 6, width: 12, height: 12)), with: .color(color))
                ctx.draw(Text(String(format: "%.2f", j.c)).font(.system(size: 10, design: .monospaced)).foregroundStyle(.white),
                         at: CGPoint(x: pt.x + 22, y: pt.y - 10))
            }
        }
    }
}
