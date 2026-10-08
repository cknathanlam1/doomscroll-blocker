import Foundation

// Port of web-prototype/src/sim/pushupSimulator.ts. Same names, constants,
// draw order and branch order; keep the comments, they explain WHY.
//
// Geometric push-up simulator for tests and the demo.
//
// Models a person doing push-ups with their head toward a phone that is
// propped up on the floor (front camera, spec screen 3), and projects the
// joints through a pinhole camera into the core PoseFrame format. Ground
// truth (true elbow angle per frame, which reps were full vs partial) comes
// from the 3D model, so the counter is tested against real geometry rather
// than against its own assumptions.
//
// World frame: X = camera's right, Y = up (height above floor), Z = forward
// (away from the camera). The person faces the camera, so the person's LEFT
// side is at +X and appears on the RIGHT of the unmirrored image.
//
// Pure Swift (Foundation only), so it lives next to Core and runs in unit tests.

struct SimGeometry: Equatable {
    /// Camera height above the floor (m). A phone propped on the floor ≈ 0.08–0.15.
    var camHeight: Double
    /// Upward pitch of the camera (deg). Phones lean back a little when propped.
    var tiltDeg: Double
    /// Vertical field of view of the image (deg).
    var vFovDeg: Double
    var imageW: Double
    var imageH: Double
    /// Horizontal distance from the camera to the person's nose at the top (m).
    var headDistance: Double
    /// Scales all body lengths (1 = average adult).
    var bodyScale: Double
    /// Hand spacing as a multiple of shoulder width (wrist to wrist).
    var handWidthRatio: Double
    /// How far the hands sit behind (toward the feet) the shoulders at the top (m).
    var handOffsetZ: Double
    /// Elbow flare: 0 = elbows straight out to the sides, 90 = tucked back along the body.
    var flareDeg: Double
    /// Elbow angle at the top of each rep (deg). Arms are rarely perfectly straight.
    var topElbowDeg: Double
}

let DEFAULT_GEOMETRY = SimGeometry(
    camHeight: 0.1,
    tiltDeg: 8,
    vFovDeg: 68,
    imageW: 480,
    imageH: 640,
    headDistance: 0.9,
    bodyScale: 1,
    handWidthRatio: 1.35,
    handOffsetZ: 0.08,
    flareDeg: 45,
    topElbowDeg: 172
)

/// TypeScript's `Partial<SimGeometry>`: set only the fields you want to change,
/// e.g. `PartialSimGeometry(headDistance: 1.3)`.
struct PartialSimGeometry: Equatable {
    var camHeight: Double?
    var tiltDeg: Double?
    var vFovDeg: Double?
    var imageW: Double?
    var imageH: Double?
    var headDistance: Double?
    var bodyScale: Double?
    var handWidthRatio: Double?
    var handOffsetZ: Double?
    var flareDeg: Double?
    var topElbowDeg: Double?
}

struct RepSpec: Equatable {
    /// Deepest elbow angle reached (deg). ≤ 90 is a full rep; ≥ 120 is clearly partial.
    var minElbowDeg: Double
    var downMs: Double?
    var bottomHoldMs: Double?
    var upMs: Double?
    var topRestMs: Double?
    /// Elbow angle the rep comes back up to (default: the full top). A tired
    /// user often stops short, e.g. 135°. The NEXT rep then starts from here.
    var returnElbowDeg: Double?

    init(
        minElbowDeg: Double,
        downMs: Double? = nil,
        bottomHoldMs: Double? = nil,
        upMs: Double? = nil,
        topRestMs: Double? = nil,
        returnElbowDeg: Double? = nil
    ) {
        self.minElbowDeg = minElbowDeg
        self.downMs = downMs
        self.bottomHoldMs = bottomHoldMs
        self.upMs = upMs
        self.topRestMs = topRestMs
        self.returnElbowDeg = returnElbowDeg
    }
}

enum Segment: Equatable {
    /// Hold the top (plank) position.
    case hold(ms: Double)
    /// One push-up.
    case rep(spec: RepSpec)
    /// Nobody detected (joints = nil), e.g. the user walked away.
    case absent(ms: Double)
    /// Person detected but every joint has low confidence (e.g. a dark room). `c` defaults to 0.2.
    case lowConfidence(ms: Double, c: Double? = nil)
    /// Hold at a fixed elbow angle (e.g. resting at the bottom).
    case holdAt(elbowDeg: Double, ms: Double)
    /// Head nod while the body stays at the top: ONLY the nose moves, down by
    /// `dropM` metres (smoothstep down, hold, back up). Tests "chest, not head".
    case headBob(dropM: Double, downMs: Double? = nil, holdMs: Double? = nil, upMs: Double? = nil)
    /// Rocking back toward child's pose instead of pushing up: the upper body
    /// (shoulders, head, elbows, hips) slides `backM` metres AWAY from the camera
    /// and `dropM` metres down, hands fixed, then returns. Shoulders shrink in
    /// the image, so the shoulder-width ratio exposes it.
    case rockBack(backM: Double, dropM: Double, downMs: Double? = nil, holdMs: Double? = nil, upMs: Double? = nil)
}

struct SimOptions {
    var geometry: PartialSimGeometry?
    var fps: Double?
    /// Gaussian jitter added to every 2D joint, in pixels.
    var noisePx: Double?
    /// Probability per frame that one random joint's confidence collapses.
    var dropoutRate: Double?
    var seed: Int?
    /// Timestamp of the first frame (ms).
    var startT: Double?
    /// Include 3D world joints (MediaPipe-style, hip-centred, y-down).
    var includeWorld: Bool?
    /// Uniform jitter (±ms) added to each frame's timestamp, like a browser
    /// delivering frames unevenly. Clamped below half a frame so timestamps stay
    /// strictly increasing. 0 (default) leaves timestamps exact.
    var timeJitterMs: Double?
    /// Probability per frame that the frame is skipped entirely (variable frame rate).
    var frameDropRate: Double?

    init(
        geometry: PartialSimGeometry? = nil,
        fps: Double? = nil,
        noisePx: Double? = nil,
        dropoutRate: Double? = nil,
        seed: Int? = nil,
        startT: Double? = nil,
        includeWorld: Bool? = nil,
        timeJitterMs: Double? = nil,
        frameDropRate: Double? = nil
    ) {
        self.geometry = geometry
        self.fps = fps
        self.noisePx = noisePx
        self.dropoutRate = dropoutRate
        self.seed = seed
        self.startT = startT
        self.includeWorld = includeWorld
        self.timeJitterMs = timeJitterMs
        self.frameDropRate = frameDropRate
    }
}

struct TruthSample: Equatable {
    var t: Double
    /// True mean elbow angle (deg), or nil when absent.
    var elbowDeg: Double?
    /// True shoulder height above the floor (m), or nil when absent.
    var shoulderHeight: Double?
}

struct SimRep: Equatable {
    var minElbowDeg: Double
    /// minElbowDeg ≤ 90.
    var full: Bool
    var tStart: Double
    var tEnd: Double
}

struct SimResult {
    var frames: [PoseFrame]
    var truth: [TruthSample]
    var reps: [SimRep]
    var geometry: SimGeometry
}

// ---------------------------------------------------------------------------
// Small vector helpers

private struct V3 {
    var x: Double
    var y: Double
    var z: Double
}
private func v(_ x: Double, _ y: Double, _ z: Double) -> V3 { V3(x: x, y: y, z: z) }
private func add(_ a: V3, _ b: V3) -> V3 { v(a.x + b.x, a.y + b.y, a.z + b.z) }
private func sub(_ a: V3, _ b: V3) -> V3 { v(a.x - b.x, a.y - b.y, a.z - b.z) }
private func mul(_ a: V3, _ s: Double) -> V3 { v(a.x * s, a.y * s, a.z * s) }
private func dot(_ a: V3, _ b: V3) -> Double { a.x * b.x + a.y * b.y + a.z * b.z }
private func len(_ a: V3) -> Double { dot(a, a).squareRoot() }
private func norm(_ a: V3) -> V3 {
    let l = len(a)
    return mul(a, 1 / (l == 0 ? 1 : l))   // JS: `len(a) || 1`
}

/// A random-number source returning a Double in [0, 1), like `Math.random`.
typealias Rng = () -> Double

/// Deterministic PRNG (mulberry32). UInt32 wrapping arithmetic matches JS
/// `Math.imul` and `>>> 0` exactly, so the sequence is bit-identical to the web's.
func makeRng(_ seed: Int) -> Rng {
    var s = UInt32(truncatingIfNeeded: seed)   // JS: seed >>> 0
    return {
        s = s &+ 0x6D2B79F5
        var t = s
        t = (t ^ (t >> 15)) &* (t | 1)
        t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
        return Double(t ^ (t >> 14)) / 4294967296
    }
}

private func gaussian(_ rng: Rng) -> Double {
    let u = max(rng(), 1e-12)
    let w = rng()
    return (-2 * log(u)).squareRoot() * cos(2 * Double.pi * w)
}

private func smoothstep(_ x: Double) -> Double {
    let c = min(1, max(0, x))
    return c * c * (3 - 2 * c)
}

/// `for (let e = 0; e < ms; e += dt)` with the same accumulating doubles, so
/// the frame count is identical to the web's.
private func forEachStep(_ ms: Double, _ dt: Double, _ body: (Double) -> Void) {
    var e = 0.0
    while e < ms {
        body(e)
        e += dt
    }
}

// ---------------------------------------------------------------------------
// Body model

private struct Body {
    var shoulderWidth: Double
    var upperArm: Double
    var forearm: Double
    /// Toe-to-shoulder-joint length of the rigid plank.
    var plankLength: Double
    var wristHeight: Double
    var toeHeight: Double
}

private func bodyFor(_ g: SimGeometry) -> Body {
    let s = g.bodyScale
    return Body(
        shoulderWidth: 0.38 * s,
        upperArm: 0.3 * s,
        forearm: 0.27 * s,
        plankLength: 1.4 * s,
        wristHeight: 0.05,
        toeHeight: 0.05
    )
}

/// Offsets applied on top of the model pose (headBob / rockBack segments).
private struct PoseMod {
    /// Shift of the whole upper body: shoulders, head, hips; elbows follow via IK. Hands stay put.
    var upper: V3?
    /// Extra shift of the nose only.
    var nose: V3?
}

/// The person's pose is fully determined by one scalar: the plank angle α
/// (body line vs the floor, pivoting at the toes). Hands are fixed on the floor.
private final class PushupModel {
    let body: Body
    let wristL: V3
    let wristR: V3
    let toe: V3
    let alphaTop: Double
    let g: SimGeometry

    init(_ g: SimGeometry) {
        self.g = g
        let b = bodyFor(g)
        body = b
        let handHalf = (b.shoulderWidth * g.handWidthRatio) / 2
        let lateral = handHalf - b.shoulderWidth / 2
        // Shoulder-to-wrist distance at the top for the requested elbow angle.
        let dTop = (b.upperArm * b.upperArm + b.forearm * b.forearm - 2 * b.upperArm * b.forearm * cos((g.topElbowDeg * Double.pi) / 180)).squareRoot()
        let vert = max(1e-6, dTop * dTop - lateral * lateral - g.handOffsetZ * g.handOffsetZ).squareRoot()
        let shoulderYTop = b.wristHeight + vert
        alphaTop = asin((shoulderYTop - b.toeHeight) / b.plankLength)
        // Nose sits ~0.17 m ahead of the shoulder line; place the hands accordingly.
        let shoulderZTop = g.headDistance + 0.17 * g.bodyScale
        let wristZ = shoulderZTop + g.handOffsetZ
        wristL = v(handHalf, b.wristHeight, wristZ)
        wristR = v(-handHalf, b.wristHeight, wristZ)
        toe = v(0, b.toeHeight, shoulderZTop + b.plankLength * cos(alphaTop))
    }

    /// Unit vector along the body from the toes toward the head.
    private func bodyDir(_ alpha: Double) -> V3 {
        v(0, sin(alpha), -cos(alpha))
    }

    func shoulderMid(_ alpha: Double) -> V3 {
        add(toe, mul(bodyDir(alpha), body.plankLength))
    }

    func shoulders(_ alpha: Double) -> (L: V3, R: V3) {
        let m = shoulderMid(alpha)
        let h = body.shoulderWidth / 2
        return (add(m, v(h, 0, 0)), add(m, v(-h, 0, 0)))
    }

    func elbowAngle(_ alpha: Double) -> Double {
        let L = shoulders(alpha).L
        let d = len(sub(L, wristL))
        let a = body.upperArm
        let f = body.forearm
        let c = (a * a + f * f - d * d) / (2 * a * f)
        return (acos(min(1, max(-1, c))) * 180) / Double.pi
    }

    /// Plank angle that produces the given elbow angle (bisection; elbow angle grows with α).
    func alphaForElbow(_ elbowDeg: Double) -> Double {
        var lo = 0.01
        var hi = alphaTop
        if elbowDeg >= elbowAngle(hi) { return hi }
        for _ in 0..<60 {
            let mid = (lo + hi) / 2
            if elbowAngle(mid) > elbowDeg { hi = mid } else { lo = mid }
        }
        return (lo + hi) / 2
    }

    /// Two-link IK: elbow position, bending outward/backward per flareDeg.
    private func elbow(_ shoulder: V3, _ wrist: V3, _ side: Double) -> V3 {
        let a = body.upperArm
        let f = body.forearm
        let sw = sub(shoulder, wrist)
        let d = min(len(sw), a + f - 1e-6)
        let u = norm(sw)
        let flare = (g.flareDeg * Double.pi) / 180
        // Preferred bend direction: out to the side, back toward the feet, slightly up.
        let pref = norm(v(side * cos(flare), 0.25, sin(flare)))
        let ortho = norm(sub(pref, mul(u, dot(pref, u))))
        let along = (f * f - a * a + d * d) / (2 * d)
        let h = max(0, f * f - along * along).squareRoot()
        return add(wrist, add(mul(u, along), mul(ortho, h)))
    }

    /// True elbow angle for an arbitrary shoulder position (used by the non-rep segments).
    func elbowAngleAt(_ shoulder: V3, _ wrist: V3) -> Double {
        let d = len(sub(shoulder, wrist))
        let a = body.upperArm
        let f = body.forearm
        let c = (a * a + f * f - d * d) / (2 * a * f)
        return (acos(min(1, max(-1, c))) * 180) / Double.pi
    }

    /// Joint positions for plank angle `alpha`. The optional `mod` (added for the
    /// headBob / rockBack segments) shifts the upper body and/or the nose; with
    /// no `mod` the pose is exactly the original model.
    func joints3D(_ alpha: Double, _ mod: PoseMod? = nil) -> [JointName: V3] {
        let upper = mod?.upper ?? v(0, 0, 0)
        let sh = shoulders(alpha)
        let L = add(sh.L, upper)
        let R = add(sh.R, upper)
        let dir = bodyDir(alpha)
        let mid = add(shoulderMid(alpha), upper)
        let s = g.bodyScale
        // Head: ahead of the shoulders along the body, and a bit above the body line.
        let nose = add(add(add(mid, mul(dir, 0.17 * s)), v(0, 0.06 * s, 0)), mod?.nose ?? v(0, 0, 0))
        let hipMid = add(mid, mul(dir, -0.5 * s))
        let hipHalf = 0.16 * s
        return [
            .nose: nose,
            .leftShoulder: L,
            .rightShoulder: R,
            .leftElbow: elbow(L, wristL, 1),
            .rightElbow: elbow(R, wristR, -1),
            .leftWrist: wristL,
            .rightWrist: wristR,
            .leftHip: add(hipMid, v(hipHalf, 0, 0)),
            .rightHip: add(hipMid, v(-hipHalf, 0, 0)),
        ]
    }
}

// ---------------------------------------------------------------------------
// Camera

private final class Camera {
    private let c: V3
    private let fwd: V3
    private let up: V3
    private let fpx: Double
    private let g: SimGeometry

    init(_ g: SimGeometry) {
        self.g = g
        let t = (g.tiltDeg * Double.pi) / 180
        c = v(0, g.camHeight, 0)
        fwd = v(0, sin(t), cos(t))
        up = v(0, cos(t), -sin(t))
        fpx = g.imageH / 2 / tan((g.vFovDeg * Double.pi) / 360)
    }

    /// Camera-space coords: x right, y DOWN, z forward.
    func toCamera(_ p: V3) -> V3 {
        let d = sub(p, c)
        return v(d.x, -dot(d, up), dot(d, fwd))
    }

    /// Pixel coordinates (unmirrored, y-down).
    func project(_ p: V3) -> (px: Double, py: Double, inFront: Bool) {
        let q = toCamera(p)
        let z = max(q.z, 1e-3)
        return (
            g.imageW / 2 + (fpx * q.x) / z,
            g.imageH / 2 + (fpx * q.y) / z,
            q.z > 0.05
        )
    }
}

// ---------------------------------------------------------------------------
// Public API

/// The simulator's joints, in `JOINT_NAMES` order (the RNG draw order depends on it).
private let JOINTS: [JointName] = [
    .nose,
    .leftShoulder,
    .rightShoulder,
    .leftElbow,
    .rightElbow,
    .leftWrist,
    .rightWrist,
    .leftHip,
    .rightHip,
]

private func resolveGeometry(_ partial: PartialSimGeometry?) -> SimGeometry {
    var g = DEFAULT_GEOMETRY
    guard let p = partial else { return g }
    if let x = p.camHeight { g.camHeight = x }
    if let x = p.tiltDeg { g.tiltDeg = x }
    if let x = p.vFovDeg { g.vFovDeg = x }
    if let x = p.imageW { g.imageW = x }
    if let x = p.imageH { g.imageH = x }
    if let x = p.headDistance { g.headDistance = x }
    if let x = p.bodyScale { g.bodyScale = x }
    if let x = p.handWidthRatio { g.handWidthRatio = x }
    if let x = p.handOffsetZ { g.handOffsetZ = x }
    if let x = p.flareDeg { g.flareDeg = x }
    if let x = p.topElbowDeg { g.topElbowDeg = x }
    return g
}

/// Projects the ideal pose at a given elbow angle (no noise). Handy for
/// checking what heightRatio / depth a given elbow angle produces.
func poseAtElbow(_ elbowDeg: Double, _ geometry: PartialSimGeometry? = nil, t: Double = 0) -> PoseFrame {
    let g = resolveGeometry(geometry)
    let model = PushupModel(g)
    let cam = Camera(g)
    return frameFor(model, cam, model.alphaForElbow(elbowDeg), t, g, nil, 0, 0, false, nil, nil)
}

/// The elbow angle the model actually has at the top position.
func topElbowAngle(_ geometry: PartialSimGeometry? = nil) -> Double {
    let g = resolveGeometry(geometry)
    let m = PushupModel(g)
    return m.elbowAngle(m.alphaTop)
}

private func frameFor(
    _ model: PushupModel,
    _ cam: Camera,
    _ alpha: Double,
    _ t: Double,
    _ g: SimGeometry,
    _ rng: Rng?,
    _ noisePx: Double,
    _ dropoutRate: Double,
    _ includeWorld: Bool,
    _ confidenceOverride: Double?,
    _ mod: PoseMod?
) -> PoseFrame {
    let j3 = model.joints3D(alpha, mod)
    let H = g.imageH
    let aspect = g.imageW / g.imageH
    var joints = Joints2D()
    var dropJoint: JointName?
    // JS: `rng && rng() < dropoutRate ? JOINTS[floor(rng() * n)] : undefined`
    // (one draw for the test, a second only when it hits).
    if let rng, rng() < dropoutRate {
        dropJoint = JOINTS[Int((rng() * Double(JOINTS.count)).rounded(.down))]
    }
    for name in JOINTS {
        let p = cam.project(j3[name]!)
        let nx = rng != nil ? gaussian(rng!) * noisePx : 0
        let ny = rng != nil ? gaussian(rng!) * noisePx : 0
        let px = p.px + nx
        let py = p.py + ny
        let inside = p.inFront && px >= 0 && px <= g.imageW && py >= 0 && py <= g.imageH
        var c = inside ? 0.92 + (rng != nil ? rng!() * 0.07 : 0.05) : 0.08
        if let o = confidenceOverride { c = o }
        if name == dropJoint { c = 0.15 }
        joints[name] = Joint2D(x: px / H, y: py / H, c: c)
    }
    var world: Joints3D?
    if includeWorld {
        var w = Joints3D()
        let hip = mul(add(cam.toCamera(j3[.leftHip]!), cam.toCamera(j3[.rightHip]!)), 0.5)
        for name in JOINTS {
            let q = sub(cam.toCamera(j3[name]!), hip)
            w[name] = Joint3D(x: q.x, y: q.y, z: q.z)
        }
        world = w
    }
    return PoseFrame(t: t, aspect: aspect, joints: joints, world: world)
}

/// Generates a full session from a list of segments, sampled at `fps`.
/// Timestamps start at `startT` and increase by 1000/fps.
func simulateSession(_ segments: [Segment], _ options: SimOptions = SimOptions()) -> SimResult {
    let g = resolveGeometry(options.geometry)
    let fps = options.fps ?? 30
    let dt = 1000 / fps
    let rng = makeRng(options.seed ?? 1)
    let noisePx = options.noisePx ?? 0
    let dropoutRate = options.dropoutRate ?? 0
    let includeWorld = options.includeWorld ?? false
    let model = PushupModel(g)
    let cam = Camera(g)

    var frames: [PoseFrame] = []
    var truth: [TruthSample] = []
    var reps: [SimRep] = []
    var t = options.startT ?? 0

    // Frame drops / timestamp jitter. The RNG is only consulted when these
    // options are on, so existing seeds still produce identical sessions.
    let timeJitterMs = min(max(0, options.timeJitterMs ?? 0), dt * 0.45)
    let frameDropRate = options.frameDropRate ?? 0
    func push(_ make: (Double) -> (frame: PoseFrame, truth: TruthSample)) {
        let dropped = frameDropRate > 0 && rng() < frameDropRate
        if !dropped {
            let stamp = timeJitterMs > 0 ? t + (rng() * 2 - 1) * timeJitterMs : t
            let out = make(stamp)
            frames.append(out.frame)
            truth.append(out.truth)
        }
        t += dt
    }

    func emitPose(_ alpha: Double, _ confidenceOverride: Double? = nil, _ mod: PoseMod? = nil) {
        push { stamp in
            let frame = frameFor(model, cam, alpha, stamp, g, rng, noisePx, dropoutRate, includeWorld, confidenceOverride, mod)
            var elbowDeg = model.elbowAngle(alpha)
            var shoulderHeight = model.shoulderMid(alpha).y
            if let upper = mod?.upper {
                elbowDeg = model.elbowAngleAt(add(model.shoulders(alpha).L, upper), model.wristL)
                shoulderHeight += upper.y
            }
            return (frame, TruthSample(t: stamp, elbowDeg: elbowDeg, shoulderHeight: shoulderHeight))
        }
    }

    /// Where a rep that stopped short of the top left off (nil = at the top).
    var resumeAlpha: Double?
    for seg in segments {
        if case .rep = seg {} else { resumeAlpha = nil }
        switch seg {
        case .hold(let ms):
            forEachStep(ms, dt) { _ in emitPose(model.alphaTop) }
        case .holdAt(let elbowDeg, let ms):
            let a = model.alphaForElbow(elbowDeg)
            forEachStep(ms, dt) { _ in emitPose(a) }
        case .absent(let ms):
            forEachStep(ms, dt) { _ in
                push { stamp in
                    (
                        PoseFrame(t: stamp, aspect: g.imageW / g.imageH, joints: nil, world: nil),
                        TruthSample(t: stamp, elbowDeg: nil, shoulderHeight: nil)
                    )
                }
            }
        case .lowConfidence(let ms, let c):
            forEachStep(ms, dt) { _ in emitPose(model.alphaTop, c ?? 0.2) }
        case .headBob(_, let downMsOpt, let holdMsOpt, let upMsOpt),
             .rockBack(_, _, let downMsOpt, let holdMsOpt, let upMsOpt):
            let downMs = downMsOpt ?? 600
            let holdMs = holdMsOpt ?? 600
            let upMs = upMsOpt ?? 600
            // k = 0 → normal top pose, k = 1 → fully nodded / rocked back.
            func modAt(_ k: Double) -> PoseMod {
                switch seg {
                case .headBob(let dropM, _, _, _): return PoseMod(upper: nil, nose: v(0, -dropM * k, 0))
                case .rockBack(let backM, let dropM, _, _, _): return PoseMod(upper: v(0, -dropM * k, backM * k), nose: nil)
                default: return PoseMod()
                }
            }
            forEachStep(downMs, dt) { e in emitPose(model.alphaTop, nil, modAt(smoothstep(e / downMs))) }
            forEachStep(holdMs, dt) { _ in emitPose(model.alphaTop, nil, modAt(1)) }
            forEachStep(upMs, dt) { e in emitPose(model.alphaTop, nil, modAt(1 - smoothstep(e / upMs))) }
        case .rep(let s):
            let downMs = s.downMs ?? 700
            let holdMs = s.bottomHoldMs ?? 100
            let upMs = s.upMs ?? 700
            let restMs = s.topRestMs ?? 400
            let aStart = resumeAlpha ?? model.alphaTop
            let aEnd = s.returnElbowDeg != nil ? model.alphaForElbow(s.returnElbowDeg!) : model.alphaTop
            let aBot = model.alphaForElbow(s.minElbowDeg)
            let tStart = t
            forEachStep(downMs, dt) { e in emitPose(aStart + (aBot - aStart) * smoothstep(e / downMs)) }
            forEachStep(holdMs, dt) { _ in emitPose(aBot) }
            forEachStep(upMs, dt) { e in emitPose(aBot + (aEnd - aBot) * smoothstep(e / upMs)) }
            let tEnd = t
            forEachStep(restMs, dt) { _ in emitPose(aEnd) }
            resumeAlpha = s.returnElbowDeg != nil ? aEnd : nil
            reps.append(SimRep(minElbowDeg: s.minElbowDeg, full: s.minElbowDeg <= 90, tStart: tStart, tEnd: tEnd))
        }
    }
    return SimResult(frames: frames, truth: truth, reps: reps, geometry: g)
}

/// Convenience: hold a plank long enough to calibrate, then do `reps`.
func standardSet(_ reps: [RepSpec], holdMs: Double = 4500) -> [Segment] {
    [.hold(ms: holdMs)] + reps.map { Segment.rep(spec: $0) }
}
