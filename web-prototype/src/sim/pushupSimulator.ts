/**
 * Geometric push-up simulator for tests.
 *
 * Models a person doing push-ups with their head toward a phone that is
 * propped up on the floor (front camera, spec screen 3), and projects the
 * joints through a pinhole camera into the core PoseFrame format. Ground
 * truth (true elbow angle per frame, which reps were full vs partial) comes
 * from the 3D model, so the counter is tested against real geometry rather
 * than against its own assumptions.
 *
 * World frame: X = camera's right, Y = up (height above floor), Z = forward
 * (away from the camera). The person faces the camera, so the person's LEFT
 * side is at +X and appears on the RIGHT of the unmirrored image.
 */
import type { Joint2D, Joint3D, JointName, Joints2D, Joints3D, PoseFrame } from '../core/types';

export interface SimGeometry {
  /** Camera height above the floor (m). A phone propped on the floor ≈ 0.08–0.15. */
  camHeight: number;
  /** Upward pitch of the camera (deg). Phones lean back a little when propped. */
  tiltDeg: number;
  /** Vertical field of view of the image (deg). */
  vFovDeg: number;
  imageW: number;
  imageH: number;
  /** Horizontal distance from the camera to the person's nose at the top (m). */
  headDistance: number;
  /** Scales all body lengths (1 = average adult). */
  bodyScale: number;
  /** Hand spacing as a multiple of shoulder width (wrist to wrist). */
  handWidthRatio: number;
  /** How far the hands sit behind (toward the feet) the shoulders at the top (m). */
  handOffsetZ: number;
  /** Elbow flare: 0 = elbows straight out to the sides, 90 = tucked back along the body. */
  flareDeg: number;
  /** Elbow angle at the top of each rep (deg). Arms are rarely perfectly straight. */
  topElbowDeg: number;
}

export const DEFAULT_GEOMETRY: SimGeometry = {
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
  topElbowDeg: 172,
};

export interface RepSpec {
  /** Deepest elbow angle reached (deg). ≤ 90 is a full rep; ≥ 120 is clearly partial. */
  minElbowDeg: number;
  downMs?: number;
  bottomHoldMs?: number;
  upMs?: number;
  topRestMs?: number;
  /**
   * Elbow angle the rep comes back up to (default: the full top). A tired
   * user often stops short, e.g. 135°. The NEXT rep then starts from here.
   */
  returnElbowDeg?: number;
}

export type Segment =
  /** Hold the top (plank) position. */
  | { kind: 'hold'; ms: number }
  /** One push-up. */
  | { kind: 'rep'; spec: RepSpec }
  /** Nobody detected (joints = null), e.g. the user walked away. */
  | { kind: 'absent'; ms: number }
  /** Person detected but every joint has low confidence (e.g. a dark room). */
  | { kind: 'lowConfidence'; ms: number; c?: number }
  /** Hold at a fixed elbow angle (e.g. resting at the bottom). */
  | { kind: 'holdAt'; elbowDeg: number; ms: number }
  /**
   * Head nod while the body stays at the top: ONLY the nose moves, down by
   * `dropM` metres (smoothstep down, hold, back up). Tests "chest, not head".
   */
  | { kind: 'headBob'; dropM: number; downMs?: number; holdMs?: number; upMs?: number }
  /**
   * Rocking back toward child's pose instead of pushing up: the upper body
   * (shoulders, head, elbows, hips) slides `backM` metres AWAY from the camera
   * and `dropM` metres down, hands fixed, then returns. Shoulders shrink in
   * the image, so the shoulder-width ratio exposes it.
   */
  | { kind: 'rockBack'; backM: number; dropM: number; downMs?: number; holdMs?: number; upMs?: number };

export interface SimOptions {
  geometry?: Partial<SimGeometry>;
  fps?: number;
  /** Gaussian jitter added to every 2D joint, in pixels. */
  noisePx?: number;
  /** Probability per frame that one random joint's confidence collapses. */
  dropoutRate?: number;
  seed?: number;
  /** Timestamp of the first frame (ms). */
  startT?: number;
  /** Include 3D world joints (MediaPipe-style, hip-centred, y-down). */
  includeWorld?: boolean;
  /**
   * Uniform jitter (±ms) added to each frame's timestamp, like a browser
   * delivering frames unevenly. Clamped below half a frame so timestamps stay
   * strictly increasing. 0 (default) leaves timestamps exact.
   */
  timeJitterMs?: number;
  /** Probability per frame that the frame is skipped entirely (variable frame rate). */
  frameDropRate?: number;
}

export interface TruthSample {
  t: number;
  /** True mean elbow angle (deg), or null when absent. */
  elbowDeg: number | null;
  /** True shoulder height above the floor (m), or null when absent. */
  shoulderHeight: number | null;
}

export interface SimRep {
  minElbowDeg: number;
  /** minElbowDeg ≤ 90. */
  full: boolean;
  tStart: number;
  tEnd: number;
}

export interface SimResult {
  frames: PoseFrame[];
  truth: TruthSample[];
  reps: SimRep[];
  geometry: SimGeometry;
}

// ---------------------------------------------------------------------------
// Small vector helpers

interface V3 {
  x: number;
  y: number;
  z: number;
}
const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
const add = (a: V3, b: V3): V3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: V3, b: V3): V3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: V3, s: number): V3 => v(a.x * s, a.y * s, a.z * s);
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: V3): number => Math.sqrt(dot(a, a));
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const w = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
}

const smoothstep = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

// ---------------------------------------------------------------------------
// Body model

interface Body {
  shoulderWidth: number;
  upperArm: number;
  forearm: number;
  /** Toe-to-shoulder-joint length of the rigid plank. */
  plankLength: number;
  wristHeight: number;
  toeHeight: number;
}

function bodyFor(g: SimGeometry): Body {
  const s = g.bodyScale;
  return {
    shoulderWidth: 0.38 * s,
    upperArm: 0.3 * s,
    forearm: 0.27 * s,
    plankLength: 1.4 * s,
    wristHeight: 0.05,
    toeHeight: 0.05,
  };
}

/** Offsets applied on top of the model pose (headBob / rockBack segments). */
interface PoseMod {
  /** Shift of the whole upper body: shoulders, head, hips; elbows follow via IK. Hands stay put. */
  upper?: V3;
  /** Extra shift of the nose only. */
  nose?: V3;
}

/**
 * The person's pose is fully determined by one scalar: the plank angle α
 * (body line vs the floor, pivoting at the toes). Hands are fixed on the floor.
 */
class PushupModel {
  readonly body: Body;
  readonly wristL: V3;
  readonly wristR: V3;
  readonly toe: V3;
  readonly alphaTop: number;
  readonly g: SimGeometry;

  constructor(g: SimGeometry) {
    this.g = g;
    const b = (this.body = bodyFor(g));
    const handHalf = (b.shoulderWidth * g.handWidthRatio) / 2;
    const lateral = handHalf - b.shoulderWidth / 2;
    // Shoulder-to-wrist distance at the top for the requested elbow angle.
    const dTop = Math.sqrt(
      b.upperArm ** 2 + b.forearm ** 2 - 2 * b.upperArm * b.forearm * Math.cos((g.topElbowDeg * Math.PI) / 180),
    );
    const vert = Math.sqrt(Math.max(1e-6, dTop ** 2 - lateral ** 2 - g.handOffsetZ ** 2));
    const shoulderYTop = b.wristHeight + vert;
    this.alphaTop = Math.asin((shoulderYTop - b.toeHeight) / b.plankLength);
    // Nose sits ~0.17 m ahead of the shoulder line; place the hands accordingly.
    const shoulderZTop = g.headDistance + 0.17 * g.bodyScale;
    const wristZ = shoulderZTop + g.handOffsetZ;
    this.wristL = v(handHalf, b.wristHeight, wristZ);
    this.wristR = v(-handHalf, b.wristHeight, wristZ);
    this.toe = v(0, b.toeHeight, shoulderZTop + b.plankLength * Math.cos(this.alphaTop));
  }

  /** Unit vector along the body from the toes toward the head. */
  private bodyDir(alpha: number): V3 {
    return v(0, Math.sin(alpha), -Math.cos(alpha));
  }

  shoulderMid(alpha: number): V3 {
    return add(this.toe, mul(this.bodyDir(alpha), this.body.plankLength));
  }

  shoulders(alpha: number): { L: V3; R: V3 } {
    const m = this.shoulderMid(alpha);
    const h = this.body.shoulderWidth / 2;
    return { L: add(m, v(h, 0, 0)), R: add(m, v(-h, 0, 0)) };
  }

  elbowAngle(alpha: number): number {
    const { L } = this.shoulders(alpha);
    const d = len(sub(L, this.wristL));
    const { upperArm: a, forearm: f } = this.body;
    const cos = (a * a + f * f - d * d) / (2 * a * f);
    return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
  }

  /** Plank angle that produces the given elbow angle (bisection; elbow angle grows with α). */
  alphaForElbow(elbowDeg: number): number {
    let lo = 0.01;
    let hi = this.alphaTop;
    if (elbowDeg >= this.elbowAngle(hi)) return hi;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (this.elbowAngle(mid) > elbowDeg) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  }

  /** Two-link IK: elbow position, bending outward/backward per flareDeg. */
  private elbow(shoulder: V3, wrist: V3, side: 1 | -1): V3 {
    const { upperArm: a, forearm: f } = this.body;
    const sw = sub(shoulder, wrist);
    const d = Math.min(len(sw), a + f - 1e-6);
    const u = norm(sw);
    const flare = (this.g.flareDeg * Math.PI) / 180;
    // Preferred bend direction: out to the side, back toward the feet, slightly up.
    const pref = norm(v(side * Math.cos(flare), 0.25, Math.sin(flare)));
    const ortho = norm(sub(pref, mul(u, dot(pref, u))));
    const along = (f * f - a * a + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, f * f - along * along));
    return add(wrist, add(mul(u, along), mul(ortho, h)));
  }

  /** True elbow angle for an arbitrary shoulder position (used by the non-rep segments). */
  elbowAngleAt(shoulder: V3, wrist: V3): number {
    const d = len(sub(shoulder, wrist));
    const { upperArm: a, forearm: f } = this.body;
    const cos = (a * a + f * f - d * d) / (2 * a * f);
    return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
  }

  /**
   * Joint positions for plank angle `alpha`. The optional `mod` (added for the
   * headBob / rockBack segments) shifts the upper body and/or the nose; with
   * no `mod` the pose is exactly the original model.
   */
  joints3D(alpha: number, mod?: PoseMod): Record<JointName, V3> {
    const upper = mod?.upper ?? v(0, 0, 0);
    const shoulders = this.shoulders(alpha);
    const L = add(shoulders.L, upper);
    const R = add(shoulders.R, upper);
    const dir = this.bodyDir(alpha);
    const mid = add(this.shoulderMid(alpha), upper);
    const s = this.g.bodyScale;
    // Head: ahead of the shoulders along the body, and a bit above the body line.
    const nose = add(add(add(mid, mul(dir, 0.17 * s)), v(0, 0.06 * s, 0)), mod?.nose ?? v(0, 0, 0));
    const hipMid = add(mid, mul(dir, -0.5 * s));
    const hipHalf = 0.16 * s;
    return {
      nose,
      leftShoulder: L,
      rightShoulder: R,
      leftElbow: this.elbow(L, this.wristL, 1),
      rightElbow: this.elbow(R, this.wristR, -1),
      leftWrist: this.wristL,
      rightWrist: this.wristR,
      leftHip: add(hipMid, v(hipHalf, 0, 0)),
      rightHip: add(hipMid, v(-hipHalf, 0, 0)),
    };
  }
}

// ---------------------------------------------------------------------------
// Camera

class Camera {
  private readonly c: V3;
  private readonly fwd: V3;
  private readonly up: V3;
  private readonly fpx: number;
  private readonly g: SimGeometry;

  constructor(g: SimGeometry) {
    this.g = g;
    const t = (g.tiltDeg * Math.PI) / 180;
    this.c = v(0, g.camHeight, 0);
    this.fwd = v(0, Math.sin(t), Math.cos(t));
    this.up = v(0, Math.cos(t), -Math.sin(t));
    this.fpx = g.imageH / 2 / Math.tan((g.vFovDeg * Math.PI) / 360);
  }

  /** Camera-space coords: x right, y DOWN, z forward. */
  toCamera(p: V3): V3 {
    const d = sub(p, this.c);
    return v(d.x, -dot(d, this.up), dot(d, this.fwd));
  }

  /** Pixel coordinates (unmirrored, y-down). */
  project(p: V3): { px: number; py: number; inFront: boolean } {
    const q = this.toCamera(p);
    const z = Math.max(q.z, 1e-3);
    return {
      px: this.g.imageW / 2 + (this.fpx * q.x) / z,
      py: this.g.imageH / 2 + (this.fpx * q.y) / z,
      inFront: q.z > 0.05,
    };
  }
}

// ---------------------------------------------------------------------------
// Public API

const JOINTS: JointName[] = [
  'nose',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftHip',
  'rightHip',
];

function resolveGeometry(partial?: Partial<SimGeometry>): SimGeometry {
  return { ...DEFAULT_GEOMETRY, ...partial };
}

/**
 * Projects the ideal pose at a given elbow angle (no noise). Handy for
 * checking what heightRatio / depth a given elbow angle produces.
 */
export function poseAtElbow(elbowDeg: number, geometry?: Partial<SimGeometry>, t = 0): PoseFrame {
  const g = resolveGeometry(geometry);
  const model = new PushupModel(g);
  const cam = new Camera(g);
  return frameFor(model, cam, model.alphaForElbow(elbowDeg), t, g, null, 0, 0, false, undefined);
}

/** The elbow angle the model actually has at the top position. */
export function topElbowAngle(geometry?: Partial<SimGeometry>): number {
  const g = resolveGeometry(geometry);
  const m = new PushupModel(g);
  return m.elbowAngle(m.alphaTop);
}

function frameFor(
  model: PushupModel,
  cam: Camera,
  alpha: number,
  t: number,
  g: SimGeometry,
  rng: (() => number) | null,
  noisePx: number,
  dropoutRate: number,
  includeWorld: boolean,
  confidenceOverride: number | undefined,
  mod?: PoseMod,
): PoseFrame {
  const j3 = model.joints3D(alpha, mod);
  const H = g.imageH;
  const aspect = g.imageW / g.imageH;
  const joints: Joints2D = {};
  const dropJoint = rng && rng() < dropoutRate ? JOINTS[Math.floor(rng() * JOINTS.length)] : undefined;
  for (const name of JOINTS) {
    const p = cam.project(j3[name]);
    const nx = rng ? gaussian(rng) * noisePx : 0;
    const ny = rng ? gaussian(rng) * noisePx : 0;
    const px = p.px + nx;
    const py = p.py + ny;
    const inside = p.inFront && px >= 0 && px <= g.imageW && py >= 0 && py <= g.imageH;
    let c = inside ? 0.92 + (rng ? rng() * 0.07 : 0.05) : 0.08;
    if (confidenceOverride !== undefined) c = confidenceOverride;
    if (name === dropJoint) c = 0.15;
    const joint: Joint2D = { x: px / H, y: py / H, c };
    joints[name] = joint;
  }
  let world: Joints3D | null = null;
  if (includeWorld) {
    world = {};
    const hip = mul(add(cam.toCamera(j3.leftHip), cam.toCamera(j3.rightHip)), 0.5);
    for (const name of JOINTS) {
      const q = sub(cam.toCamera(j3[name]), hip);
      const w: Joint3D = { x: q.x, y: q.y, z: q.z };
      world[name] = w;
    }
  }
  return { t, aspect, joints, world };
}

/**
 * Generates a full session from a list of segments, sampled at `fps`.
 * Timestamps start at `startT` and increase by 1000/fps.
 */
export function simulateSession(segments: Segment[], options: SimOptions = {}): SimResult {
  const g = resolveGeometry(options.geometry);
  const fps = options.fps ?? 30;
  const dt = 1000 / fps;
  const rng = makeRng(options.seed ?? 1);
  const noisePx = options.noisePx ?? 0;
  const dropoutRate = options.dropoutRate ?? 0;
  const includeWorld = options.includeWorld ?? false;
  const model = new PushupModel(g);
  const cam = new Camera(g);

  const frames: PoseFrame[] = [];
  const truth: TruthSample[] = [];
  const reps: SimRep[] = [];
  let t = options.startT ?? 0;

  // Frame drops / timestamp jitter. The RNG is only consulted when these
  // options are on, so existing seeds still produce identical sessions.
  const timeJitterMs = Math.min(Math.max(0, options.timeJitterMs ?? 0), dt * 0.45);
  const frameDropRate = options.frameDropRate ?? 0;
  const push = (make: (stamp: number) => { frame: PoseFrame; truth: TruthSample }) => {
    const dropped = frameDropRate > 0 && rng() < frameDropRate;
    if (!dropped) {
      const stamp = timeJitterMs > 0 ? t + (rng() * 2 - 1) * timeJitterMs : t;
      const out = make(stamp);
      frames.push(out.frame);
      truth.push(out.truth);
    }
    t += dt;
  };

  const emitPose = (alpha: number, confidenceOverride?: number, mod?: PoseMod) => {
    push((stamp) => {
      const frame = frameFor(model, cam, alpha, stamp, g, rng, noisePx, dropoutRate, includeWorld, confidenceOverride, mod);
      let elbowDeg = model.elbowAngle(alpha);
      let shoulderHeight = model.shoulderMid(alpha).y;
      if (mod?.upper) {
        elbowDeg = model.elbowAngleAt(add(model.shoulders(alpha).L, mod.upper), model.wristL);
        shoulderHeight += mod.upper.y;
      }
      return { frame, truth: { t: stamp, elbowDeg, shoulderHeight } };
    });
  };

  /** Where a rep that stopped short of the top left off (null = at the top). */
  let resumeAlpha: number | null = null;
  for (const seg of segments) {
    if (seg.kind !== 'rep') resumeAlpha = null;
    if (seg.kind === 'hold') {
      for (let e = 0; e < seg.ms; e += dt) emitPose(model.alphaTop);
    } else if (seg.kind === 'holdAt') {
      const a = model.alphaForElbow(seg.elbowDeg);
      for (let e = 0; e < seg.ms; e += dt) emitPose(a);
    } else if (seg.kind === 'absent') {
      for (let e = 0; e < seg.ms; e += dt) {
        push((stamp) => ({
          frame: { t: stamp, aspect: g.imageW / g.imageH, joints: null, world: null },
          truth: { t: stamp, elbowDeg: null, shoulderHeight: null },
        }));
      }
    } else if (seg.kind === 'lowConfidence') {
      for (let e = 0; e < seg.ms; e += dt) emitPose(model.alphaTop, seg.c ?? 0.2);
    } else if (seg.kind === 'headBob' || seg.kind === 'rockBack') {
      const downMs = seg.downMs ?? 600;
      const holdMs = seg.holdMs ?? 600;
      const upMs = seg.upMs ?? 600;
      // k = 0 → normal top pose, k = 1 → fully nodded / rocked back.
      const modAt = (k: number): PoseMod =>
        seg.kind === 'headBob' ? { nose: v(0, -seg.dropM * k, 0) } : { upper: v(0, -seg.dropM * k, seg.backM * k) };
      for (let e = 0; e < downMs; e += dt) emitPose(model.alphaTop, undefined, modAt(smoothstep(e / downMs)));
      for (let e = 0; e < holdMs; e += dt) emitPose(model.alphaTop, undefined, modAt(1));
      for (let e = 0; e < upMs; e += dt) emitPose(model.alphaTop, undefined, modAt(1 - smoothstep(e / upMs)));
    } else {
      const s = seg.spec;
      const downMs = s.downMs ?? 700;
      const holdMs = s.bottomHoldMs ?? 100;
      const upMs = s.upMs ?? 700;
      const restMs = s.topRestMs ?? 400;
      const aStart = resumeAlpha ?? model.alphaTop;
      const aEnd = s.returnElbowDeg !== undefined ? model.alphaForElbow(s.returnElbowDeg) : model.alphaTop;
      const aBot = model.alphaForElbow(s.minElbowDeg);
      const tStart = t;
      for (let e = 0; e < downMs; e += dt) emitPose(aStart + (aBot - aStart) * smoothstep(e / downMs));
      for (let e = 0; e < holdMs; e += dt) emitPose(aBot);
      for (let e = 0; e < upMs; e += dt) emitPose(aBot + (aEnd - aBot) * smoothstep(e / upMs));
      const tEnd = t;
      for (let e = 0; e < restMs; e += dt) emitPose(aEnd);
      resumeAlpha = s.returnElbowDeg !== undefined ? aEnd : null;
      reps.push({ minElbowDeg: s.minElbowDeg, full: s.minElbowDeg <= 90, tStart, tEnd });
    }
  }
  return { frames, truth, reps, geometry: g };
}

/** Convenience: hold a plank long enough to calibrate, then do `reps`. */
export function standardSet(reps: RepSpec[], holdMs = 4500): Segment[] {
  return [{ kind: 'hold', ms: holdMs }, ...reps.map((spec): Segment => ({ kind: 'rep', spec }))];
}
