import SwiftUI

// The drawing on top of the camera picture (docs/UI_SPEC.md §3): the head-and-shoulders
// figure, the depth line with its DEPTH tag, the demo's dark silhouette and the debug guide.
// One `Canvas`, fed per frame.

/// Core coordinates (unmirrored image, y down, both axes in image-HEIGHT units) → points
/// on a screen that shows the picture with `.resizeAspectFill` (UI_SPEC §3.2).
/// `OverlayFit` already does the cover maths and the selfie mirror of the live preview;
/// the demo's fake picture is not mirrored, so this flips it back.
struct StageFit {
    let size: CGSize
    let aspect: Double
    let mirrored: Bool
    private let base: OverlayFit

    init(size: CGSize, aspect: Double, mirrored: Bool) {
        self.size = size
        self.aspect = aspect > 0 ? aspect : 0.75
        self.mirrored = mirrored
        base = OverlayFit(size: size, aspect: self.aspect > 0 ? self.aspect : 0.75)
    }

    func point(_ x: Double, _ y: Double) -> CGPoint {
        let p = base.point(x: x, y: y)
        return mirrored ? p : CGPoint(x: size.width - p.x, y: p.y)
    }

    /// Image-height units → points.
    func length(_ u: Double) -> CGFloat { base.length(u) }

    /// Stroke scale `k` (UI_SPEC §3.3): the visible picture's shorter side relative to the 420 pt design.
    var k: CGFloat { clampValue(min(size.width, size.height) / 420, 0.75, 2.4) }
}

enum FigureStyle {
    case normal, warn, faint

    var color: Color { self == .warn ? Theme.warn : Theme.volt }
    /// Base alpha of everything the figure draws.
    var alpha: Double { self == .faint ? 0.18 : 1 }
}

struct StageOverlay: View {
    var frame: PoseFrame?
    var style: FigureStyle = .normal
    /// Image y (core units) the shoulders must reach; nil hides the line (Placement, paused, before calibration).
    var depthLineY: Double?
    var depthLineState: ChallengeUI.DepthLineState = .idle
    /// The demo's fake picture: not mirrored, and a dark silhouette is drawn under the figure.
    var isDemo = false
    /// Debug view: joint dots coloured by confidence.
    var byConfidence = false
    /// Debug guide (hand level and current shoulder height, core y), Challenge layer only.
    var guideHandY: Double?
    var guideShoulderY: Double?

    var body: some View {
        Canvas { ctx, size in
            let aspect = frame?.aspect ?? 0.75
            let fit = StageFit(size: size, aspect: aspect, mirrored: !isDemo)
            let k = fit.k
            let figure = frame.flatMap { Figure(frame: $0) }

            drawGuide(&ctx, fit, size)
            if let depthLineY { drawDepthLine(&ctx, fit, size, y: depthLineY, k: k) }
            if isDemo, let figure { drawSilhouette(&ctx, fit, figure) }
            if let figure { drawFigure(&ctx, fit, figure, k: k) }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    // MARK: Debug guide (UI_SPEC §3.4)

    private func drawGuide(_ ctx: inout GraphicsContext, _ fit: StageFit, _ size: CGSize) {
        if let y = guideHandY {
            let sy = fit.point(0, y).y
            var p = Path()
            p.move(to: CGPoint(x: 0, y: sy))
            p.addLine(to: CGPoint(x: size.width, y: sy))
            ctx.stroke(p, with: .color(.white.opacity(0.4)), style: StrokeStyle(lineWidth: 2, dash: [8, 6]))
        }
        if let y = guideShoulderY {
            let sy = fit.point(0, y).y
            var p = Path()
            p.move(to: CGPoint(x: 0, y: sy)); p.addLine(to: CGPoint(x: 28, y: sy))
            p.move(to: CGPoint(x: size.width - 28, y: sy)); p.addLine(to: CGPoint(x: size.width, y: sy))
            ctx.stroke(p, with: .color(.white), style: StrokeStyle(lineWidth: 3))
        }
    }

    // MARK: Depth line (UI_SPEC §3.6)

    private func drawDepthLine(_ ctx: inout GraphicsContext, _ fit: StageFit, _ size: CGSize, y core: Double, k: CGFloat) {
        let y = fit.point(0, core).y
        guard y.isFinite, y >= 0, y <= size.height else { return }
        var line = Path()
        line.move(to: CGPoint(x: 0, y: y))
        line.addLine(to: CGPoint(x: size.width, y: y))

        let color: Color = depthLineState == .partial ? Theme.warn : Theme.volt
        switch depthLineState {
        case .reached:
            ctx.drawLayer { l in
                l.addFilter(.shadow(color: Theme.volt, radius: 7 * k, x: 0, y: 0, blendMode: .normal, options: []))
                l.stroke(line, with: .color(color), style: StrokeStyle(lineWidth: 4 * k, lineCap: .butt))
            }
        case .idle, .partial:
            ctx.stroke(line, with: .color(color.opacity(0.85)),
                       style: StrokeStyle(lineWidth: 3 * k, lineCap: .butt, dash: [12 * k, 9 * k]))
        }

        // DEPTH tag at the left edge of the screen, never mirrored.
        let fontSize = (13 * k).rounded()
        let text = Text("DEPTH").font(.barlow(fontSize, .extraBold))
        let resolved = ctx.resolve(text.foregroundStyle(depthLineState == .reached ? Theme.voltInk : color))
        let tw = resolved.measure(in: CGSize(width: 400, height: 100)).width
        let h = fontSize + 6 * k
        let rect = CGRect(x: 10 * k, y: y - 5 * k - h, width: tw + 12 * k, height: h)
        let bg: Color = depthLineState == .reached ? Theme.volt : .black.opacity(0.6)
        ctx.fill(Path(roundedRect: rect, cornerRadius: h / 2), with: .color(bg))
        ctx.draw(resolved, at: CGPoint(x: rect.midX, y: rect.midY + 0.5), anchor: .center)
    }

    // MARK: Demo silhouette (UI_SPEC §3.8)

    private func drawSilhouette(_ ctx: inout GraphicsContext, _ fit: StageFit, _ f: Figure) {
        guard let ls = f.leftShoulder, let rs = f.rightShoulder else { return }
        let a = fit.point(ls.x, ls.y), b = fit.point(rs.x, rs.y)
        let sw = hypot(a.x - b.x, a.y - b.y)
        let mid = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
        func pt(_ j: FigureJoint?) -> CGPoint? { j.map { fit.point($0.x, $0.y) } }

        ctx.drawLayer { l in
            l.opacity = 0.9
            l.addFilter(.blur(radius: max(2, 0.06 * sw)))
            func seg(_ p: CGPoint?, _ q: CGPoint?, _ width: CGFloat, _ color: UInt32) {
                guard let p, let q else { return }
                var path = Path()
                path.move(to: p); path.addLine(to: q)
                l.stroke(path, with: .color(Color(hex: color)), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
            }
            if let lh = pt(f.leftHip), let rh = pt(f.rightHip) {
                seg(mid, CGPoint(x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2), 0.40 * sw, 0x120E0B)
            }
            seg(a, b, 0.33 * sw, 0x16110D)
            seg(a, pt(f.leftElbow), 0.22 * sw, 0x16110D)
            seg(b, pt(f.rightElbow), 0.22 * sw, 0x16110D)
            seg(pt(f.leftElbow), pt(f.leftWrist), 0.18 * sw, 0x16110D)
            seg(pt(f.rightElbow), pt(f.rightWrist), 0.18 * sw, 0x16110D)
            if let h = f.head {
                let c = fit.point(h.x, h.y)
                let r = fit.length(h.r) + 0.06 * sw
                l.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)), with: .color(Color(hex: 0x1A140F)))
            }
        }
    }

    // MARK: Figure (UI_SPEC §3.5)

    private static let sure = 0.5
    private static let shown = 0.15

    private func drawFigure(_ ctx: inout GraphicsContext, _ fit: StageFit, _ f: Figure, k: CGFloat) {
        let color = style.color
        let base = style.alpha

        func stroke(_ a: CGPoint, _ b: CGPoint, width: CGFloat, alpha: Double, dash: [CGFloat] = []) {
            var p = Path()
            p.move(to: a); p.addLine(to: b)
            ctx.stroke(p, with: .color(color.opacity(alpha)),
                       style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round, dash: dash))
        }
        func scr(_ j: FigureJoint) -> CGPoint { fit.point(j.x, j.y) }

        // Torso: shoulder midpoint to hip midpoint, plus the hip line.
        if let mid = f.shoulderMid, mid.c >= Self.sure, let lh = f.leftHip, let rh = f.rightHip,
           lh.c >= Self.sure, rh.c >= Self.sure {
            let m = scr(mid), a = scr(lh), b = scr(rh)
            let hipMid = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
            stroke(m, hipMid, width: 2.5 * k, alpha: base * 0.45)
            stroke(a, b, width: 2.5 * k, alpha: base * 0.45)
            for p in [a, b] {
                let r = 3 * k
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)),
                         with: .color(color.opacity(base * 0.5)))
            }
        }

        // Shoulder line and limbs.
        func limb(_ a: FigureJoint?, _ b: FigureJoint?, _ width: CGFloat) {
            guard let a, let b else { return }
            let c = min(a.c, b.c)
            guard c >= Self.shown else { return }
            if c >= Self.sure {
                stroke(scr(a), scr(b), width: width * k, alpha: base)
            } else {
                stroke(scr(a), scr(b), width: width * 0.75 * k, alpha: base * 0.55, dash: [6 * k, 7 * k])
            }
        }
        limb(f.leftShoulder, f.rightShoulder, 5.5)
        limb(f.leftShoulder, f.leftElbow, 4.5)
        limb(f.rightShoulder, f.rightElbow, 4.5)
        limb(f.leftElbow, f.leftWrist, 4.5)
        limb(f.rightElbow, f.rightWrist, 4.5)

        // Head and neck.
        if let h = f.head, h.c > 0, h.c >= Self.shown || byConfidence {
            let c = fit.point(h.x, h.y)
            let r = max(fit.length(h.r), 10 * k)
            if let mid = f.shoulderMid, mid.c >= Self.shown {
                let m = scr(mid)
                let d = hypot(m.x - c.x, m.y - c.y)
                if d > r + 2 {
                    let edge = CGPoint(x: c.x + (m.x - c.x) / d * r, y: c.y + (m.y - c.y) / d * r)
                    if h.c >= Self.sure && mid.c >= Self.sure {
                        stroke(edge, m, width: 4 * k, alpha: base)
                    } else {
                        stroke(edge, m, width: 3 * k, alpha: base * 0.55, dash: [6 * k, 7 * k])
                    }
                }
            }
            let circle = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
            ctx.fill(circle, with: .color(.black.opacity(0.25)))
            let headColor = byConfidence ? (h.c >= Self.sure ? Theme.ok : Theme.bad) : color
            if h.c >= Self.sure {
                ctx.stroke(circle, with: .color(headColor.opacity(base)), style: StrokeStyle(lineWidth: 4 * k))
            } else {
                ctx.stroke(circle, with: .color(headColor.opacity(base * 0.6)),
                           style: StrokeStyle(lineWidth: 4 * k, dash: [7 * k, 6 * k]))
            }
        }

        // Joint dots, last, on top.
        for j in [f.leftShoulder, f.rightShoulder, f.leftElbow, f.rightElbow, f.leftWrist, f.rightWrist] {
            guard let j, j.c > 0, j.c >= Self.shown || byConfidence else { continue }
            let p = scr(j)
            let r = 5.5 * k
            let dot = Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r))
            if byConfidence {
                ctx.fill(dot, with: .color((j.c >= Self.sure ? Theme.ok : Theme.bad).opacity(base)))
                ctx.stroke(dot, with: .color(.black.opacity(base)), style: StrokeStyle(lineWidth: 2 * k))
            } else if j.c >= Self.sure {
                ctx.fill(dot, with: .color(color.opacity(base)))
                ctx.stroke(dot, with: .color(.black.opacity(base)), style: StrokeStyle(lineWidth: 2 * k))
            } else {
                ctx.fill(dot, with: .color(.black.opacity(0.35)))
                ctx.stroke(dot, with: .color(color.opacity(base * 0.6)), style: StrokeStyle(lineWidth: 2.5 * k))
            }
        }
    }
}

// MARK: - Figure model (UI_SPEC §3.5)

struct FigureJoint: Equatable {
    var x: Double
    var y: Double
    var c: Double
}

/// The head-and-shoulders figure built from a core `PoseFrame` (nose head, `r = 0.28 × shoulder width`).
struct Figure: Equatable {
    var leftShoulder: FigureJoint?
    var rightShoulder: FigureJoint?
    var leftElbow: FigureJoint?
    var rightElbow: FigureJoint?
    var leftWrist: FigureJoint?
    var rightWrist: FigureJoint?
    var leftHip: FigureJoint?
    var rightHip: FigureJoint?
    /// Head circle: centre and radius in image-height units.
    var head: (x: Double, y: Double, r: Double, c: Double)?

    static func == (a: Figure, b: Figure) -> Bool {
        a.leftShoulder == b.leftShoulder && a.rightShoulder == b.rightShoulder
            && a.leftElbow == b.leftElbow && a.rightElbow == b.rightElbow
            && a.leftWrist == b.leftWrist && a.rightWrist == b.rightWrist
            && a.leftHip == b.leftHip && a.rightHip == b.rightHip
            && a.head?.x == b.head?.x && a.head?.y == b.head?.y && a.head?.r == b.head?.r && a.head?.c == b.head?.c
    }

    /// Nil when no person was detected in this frame.
    init?(frame: PoseFrame) {
        guard let joints = frame.joints else { return nil }
        let aspect = frame.aspect
        func joint(_ n: JointName) -> FigureJoint? {
            guard let j = joints[n] else { return nil }
            // A joint outside the image is not seen, whatever the detector says.
            let inside = j.x >= 0 && j.x <= aspect && j.y >= 0 && j.y <= 1
            return FigureJoint(x: j.x, y: j.y, c: inside ? j.c : 0)
        }
        leftShoulder = joint(.leftShoulder)
        rightShoulder = joint(.rightShoulder)
        leftElbow = joint(.leftElbow)
        rightElbow = joint(.rightElbow)
        leftWrist = joint(.leftWrist)
        rightWrist = joint(.rightWrist)
        leftHip = joint(.leftHip)
        rightHip = joint(.rightHip)
        let sw: Double
        if let l = leftShoulder, let r = rightShoulder { sw = hypot(l.x - r.x, l.y - r.y) } else { sw = 0 }
        if let nose = joint(.nose) {
            head = (nose.x, nose.y, 0.28 * sw, nose.c)
        }
    }

    /// Midpoint of the shoulders, with the lower confidence of the two.
    var shoulderMid: FigureJoint? {
        guard let l = leftShoulder, let r = rightShoulder else { return nil }
        return FigureJoint(x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, c: min(l.c, r.c))
    }
}
