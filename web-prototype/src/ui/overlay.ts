/**
 * Draws the body figure (figure.ts) and the depth line on a transparent
 * canvas laid exactly over the camera picture.
 *
 * The <video> is scaled by CSS `object-fit`: `cover` on phones (fills the
 * screen, edges cropped) and `contain` on laptops (the whole picture is
 * visible, with dark bars). Figure points are in the coordinates of the
 * FULL, unmirrored camera image, so we compute where that full image lands
 * on screen (fitRect) and map through it. The selfie mirror is done by CSS
 * on both the video and this canvas, never in the numbers; only text is
 * flipped back so it stays readable.
 *
 * Look (from the design's skeleton): volt lines with round caps, a head
 * circle with a dark see-through fill, joint dots with a black outline, and
 * a thinner, fainter torso. Everything scales with the size of the picture
 * on screen, so it reads the same on a phone and on a laptop 3 ft away.
 */
import { canvasDpr, clamp } from './dom';
import { shoulderMid, type Figure, type FigurePoint } from './figure';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How the picture is fitted into its box; must match the video's CSS `object-fit`. */
export type FitMode = 'cover' | 'contain';

/**
 * Where a vw×vh picture is drawn inside a bw×bh box (centred, like CSS
 * object-fit): `cover` scales it up until the box is full (edges cropped),
 * `contain` until it just fits (bars on two sides). Pure.
 */
export function fitRect(vw: number, vh: number, bw: number, bh: number, mode: FitMode): Rect {
  if (vw <= 0 || vh <= 0 || bw <= 0 || bh <= 0) return { x: 0, y: 0, w: bw, h: bh };
  const scale = mode === 'cover' ? Math.max(bw / vw, bh / vh) : Math.min(bw / vw, bh / vh);
  const w = vw * scale;
  const h = vh * scale;
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h };
}

/** fitRect for `object-fit: cover` (kept for older callers). */
export function coverRect(vw: number, vh: number, bw: number, bh: number): Rect {
  return fitRect(vw, vh, bw, bh, 'cover');
}

/** normal = volt, warn = orange (after a partial rep), faint = barely visible (too dark). */
export type SkeletonStyle = 'normal' | 'warn' | 'faint';

/**
 * idle = waiting for the shoulders to get there (dashed), reached = this rep
 * went deep enough (solid, glowing), partial = this rep stopped short (orange).
 */
export type DepthLineState = 'idle' | 'reached' | 'partial';

/** The line the chest must cross for a rep to count. y in image heights (unmirrored, y down). */
export interface DepthLine {
  y: number;
  state: DepthLineState;
}

/** Debug-only extras: hand level and the current shoulder height (image heights). */
export interface DepthGuide {
  wristY: number;
  shoulderY: number | null;
}

export interface DrawOptions {
  style: SkeletonStyle;
  /** Colour joints by detector confidence (debug view): green = confident, red = guessing. */
  byConfidence: boolean;
  depthLine: DepthLine | null;
  guide: DepthGuide | null;
  /** The canvas is mirrored by CSS (selfie view); text is flipped back so it reads normally. */
  mirrored: boolean;
  /** Paint a soft dark body under the figure (the demo has no real person in the picture). */
  silhouette: boolean;
}

// Same values as the CSS tokens (canvas can't read CSS variables cheaply).
const VOLT = '#FFD43B';
const WARN = '#FF9F0A';
const OK = '#32D74B';
const BAD = '#FF453A';
const INK = '#191300';

/** At or above this confidence a joint is drawn solid; it's also the counter's own visibility bar. */
const SURE = 0.5;
/** Below this a joint is not drawn at all in the normal view (it's a pure guess). */
const SHOWN = 0.15;
/**
 * Stroke sizes below are the design's, which was drawn for a ~400 px wide
 * phone screen. They grow with the picture's smaller visible side, so the
 * figure keeps its proportions on a laptop.
 */
const DESIGN_SIDE_PX = 420;

type Pt = { x: number; y: number };

export class SkeletonOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private fit: FitMode = 'cover';
  private drewSomething = false;
  /**
   * The last frame drawn, kept so it can be redrawn after a resize. Changing
   * a canvas's size wipes it, and the next video frame may not come soon
   * (demo paused, tab in the background, debug panel docking, zoom/DPR change).
   */
  private last: { figure: Figure | null; sourceW: number; sourceH: number; opts: DrawOptions } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  /** Call when the canvas's CSS size changes (see observeSize). Redraws the last frame at the new size. */
  setSize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = canvasDpr();
    const w = Math.round(cssW * this.dpr);
    const h = Math.round(cssH * this.dpr);
    const resized = this.canvas.width !== w || this.canvas.height !== h;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    if (resized) {
      this.drewSomething = false; // the browser just wiped the canvas
      this.redraw();
    }
  }

  /** Must match the video's CSS object-fit (the app reads it from the page when the layout changes). */
  setFit(mode: FitMode): void {
    if (mode === this.fit) return;
    this.fit = mode;
    this.redraw();
  }

  /** Wipes the canvas and forgets the last frame (the session ended). */
  clear(): void {
    this.last = null;
    this.wipe();
  }

  /**
   * Draws one frame. sourceW × sourceH is the camera picture's size
   * (video.videoWidth/Height); 0 × 0 falls back to the figure's aspect.
   */
  draw(figure: Figure | null, sourceW: number, sourceH: number, opts: DrawOptions): void {
    this.last = { figure, sourceW, sourceH, opts };
    this.paint(figure, sourceW, sourceH, opts);
  }

  /**
   * Where a point of the camera picture (core units: image heights,
   * unmirrored, y down) appears on screen, in viewport pixels — following
   * object-fit and the selfie mirror exactly like the figure. `aspect` is the
   * frame's width / height. Null before the first frame is drawn.
   */
  clientPoint(x: number, y: number, aspect: number): Pt | null {
    const last = this.last;
    if (!last || this.cssW === 0 || this.cssH === 0 || !(aspect > 0)) return null;
    const pictureAspect = last.sourceW > 0 && last.sourceH > 0 ? last.sourceW / last.sourceH : aspect;
    const r = fitRect(pictureAspect, 1, this.cssW, this.cssH, this.fit);
    let px = r.x + (x / aspect) * r.w;
    const py = r.y + y * r.h;
    if (last.opts.mirrored) px = this.cssW - px;
    const box = this.canvas.getBoundingClientRect();
    return { x: box.left + px, y: box.top + py };
  }

  private redraw(): void {
    const last = this.last;
    if (last) this.paint(last.figure, last.sourceW, last.sourceH, last.opts);
  }

  private wipe(): void {
    if (!this.ctx || !this.drewSomething) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drewSomething = false;
  }

  private paint(figure: Figure | null, sourceW: number, sourceH: number, opts: DrawOptions): void {
    const ctx = this.ctx;
    this.wipe();
    // The size normally arrives via setSize(); measure once if it hasn't yet (first frame after showing).
    if (this.cssW === 0) this.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    if (!ctx || this.cssW === 0 || this.cssH === 0) return;
    if (!figure && !opts.depthLine) return;
    this.drewSomething = true;

    // Work in CSS pixels; the transform scales up to the sharper backing store.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const aspect = sourceW > 0 && sourceH > 0 ? sourceW / sourceH : (figure?.aspect ?? 1);
    const r = fitRect(aspect, 1, this.cssW, this.cssH, this.fit);
    // The part of the picture that is actually on screen.
    const left = Math.max(0, r.x);
    const right = Math.min(this.cssW, r.x + r.w);
    const top = Math.max(0, r.y);
    const bottom = Math.min(this.cssH, r.y + r.h);
    const k = clamp(Math.min(right - left, bottom - top) / DESIGN_SIDE_PX, 0.75, 2.4);
    const view: View = { r, left, right, k };

    if (opts.guide) this.drawGuide(ctx, view, opts.guide);
    if (opts.depthLine) this.drawDepthLine(ctx, view, opts.depthLine, opts.mirrored);
    if (figure) {
      if (opts.silhouette) drawSilhouette(ctx, view, figure);
      drawFigure(ctx, view, figure, opts);
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  /**
   * The depth line: a horizontal line across the picture at the height the
   * shoulders must sink to. Drawn under the figure so you can see your
   * shoulders cross it.
   */
  private drawDepthLine(ctx: CanvasRenderingContext2D, v: View, line: DepthLine, mirrored: boolean): void {
    const y = v.r.y + line.y * v.r.h;
    if (!Number.isFinite(y) || y < 0 || y > this.cssH) return;
    const { k } = v;
    const reached = line.state === 'reached';
    const colour = line.state === 'partial' ? WARN : VOLT;

    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineCap = 'butt';
    if (reached) {
      ctx.lineWidth = 4 * k;
      ctx.shadowColor = VOLT;
      ctx.shadowBlur = 14 * k;
    } else {
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 3 * k;
      ctx.setLineDash([12 * k, 9 * k]);
    }
    ctx.beginPath();
    ctx.moveTo(v.left, y);
    ctx.lineTo(v.right, y);
    ctx.stroke();
    ctx.restore();

    // "DEPTH" tag at the left edge of the SCREEN (the canvas may be mirrored).
    const fontPx = Math.round(13 * k);
    ctx.save();
    ctx.font = `800 ${fontPx}px 'Barlow Condensed', system-ui, sans-serif`;
    const text = 'DEPTH';
    const padX = 6 * k;
    const tagW = ctx.measureText(text).width + padX * 2;
    const tagH = fontPx + 6 * k;
    const screenX = v.left + 10 * k;
    ctx.translate(mirrored ? this.cssW - screenX : screenX, y - tagH - 5 * k);
    if (mirrored) ctx.scale(-1, 1); // un-mirror the text
    ctx.fillStyle = reached ? colour : 'rgba(0,0,0,.6)';
    roundRect(ctx, 0, 0, tagW, tagH, tagH / 2);
    ctx.fill();
    ctx.fillStyle = reached ? INK : colour;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, padX, tagH / 2 + 0.5);
    ctx.restore();
  }

  /** Debug extras: hand level (white dashes) and ticks at both edges for the current shoulder height. */
  private drawGuide(ctx: CanvasRenderingContext2D, v: View, guide: DepthGuide): void {
    const y = (value: number): number => v.r.y + value * v.r.h;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.beginPath();
    ctx.moveTo(v.left, y(guide.wristY));
    ctx.lineTo(v.right, y(guide.wristY));
    ctx.stroke();
    ctx.restore();
    if (guide.shoulderY !== null) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      const sy = y(guide.shoulderY);
      ctx.beginPath();
      ctx.moveTo(v.left, sy);
      ctx.lineTo(v.left + 28, sy);
      ctx.moveTo(v.right - 28, sy);
      ctx.lineTo(v.right, sy);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** Where the picture is on screen, and the stroke scale. */
interface View {
  r: Rect;
  left: number;
  right: number;
  k: number;
}

function toScreen(v: View, fig: Figure, p: FigurePoint): Pt {
  // x is in image heights: divide by the aspect to get 0..1 of the width.
  return { x: v.r.x + (p.x / fig.aspect) * v.r.w, y: v.r.y + p.y * v.r.h };
}

function drawFigure(ctx: CanvasRenderingContext2D, v: View, fig: Figure, opts: DrawOptions): void {
  const { k } = v;
  const colour = opts.style === 'warn' ? WARN : VOLT;
  const base = opts.style === 'faint' ? 0.18 : 1;
  const j = fig.joints;
  const P = (p: FigurePoint): Pt => toScreen(v, fig, p);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /**
   * One limb. Confident → solid; unsure → thinner, dimmed and dashed, so you
   * can see what the tracker is guessing; a pure guess is skipped.
   */
  const segment = (a: FigurePoint | undefined | null, b: FigurePoint | undefined | null, width: number): void => {
    if (!a || !b) return;
    const c = Math.min(a.c, b.c);
    if (c < SHOWN) return;
    const sure = c >= SURE;
    const A = P(a);
    const B = P(b);
    ctx.globalAlpha = base * (sure ? 1 : 0.55);
    ctx.strokeStyle = colour;
    ctx.lineWidth = (sure ? width : width * 0.75) * k;
    ctx.setLineDash(sure ? [] : [6 * k, 7 * k]);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  };

  // Torso: hips are often out of view in this camera angle, so the torso is
  // thin and faint (as in the design) and only drawn when actually seen.
  const mid = shoulderMid(fig);
  const lh = j.leftHip;
  const rh = j.rightHip;
  if (mid && lh && rh && Math.min(mid.c, lh.c, rh.c) >= SURE) {
    const hipMid: FigurePoint = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, c: Math.min(lh.c, rh.c) };
    const S = P(mid);
    const H = P(hipMid);
    const L = P(lh);
    const R = P(rh);
    ctx.globalAlpha = base * 0.45;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2.5 * k;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(S.x, S.y);
    ctx.lineTo(H.x, H.y);
    ctx.moveTo(L.x, L.y);
    ctx.lineTo(R.x, R.y);
    ctx.stroke();
    ctx.globalAlpha = base * 0.5;
    ctx.fillStyle = colour;
    for (const p of [L, R]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Shoulders (the line the counter watches) and arms.
  segment(j.leftShoulder, j.rightShoulder, 5.5);
  segment(j.leftShoulder, j.leftElbow, 4.5);
  segment(j.leftElbow, j.leftWrist, 4.5);
  segment(j.rightShoulder, j.rightElbow, 4.5);
  segment(j.rightElbow, j.rightWrist, 4.5);

  // Head circle + neck (from the circle's edge down to the shoulder midpoint).
  const head = fig.head;
  if (head && (head.c >= SHOWN || opts.byConfidence) && head.c > 0) {
    const sure = head.c >= SURE;
    const C = P(head);
    const radius = Math.max(head.r * v.r.h, 10 * k);
    if (mid && mid.c >= SHOWN) {
      const M = P(mid);
      const dist = Math.hypot(M.x - C.x, M.y - C.y);
      if (dist > radius + 2) {
        const ux = (M.x - C.x) / dist;
        const uy = (M.y - C.y) / dist;
        const neckSure = sure && mid.c >= SURE;
        ctx.globalAlpha = base * (neckSure ? 1 : 0.55);
        ctx.strokeStyle = colour;
        ctx.lineWidth = (neckSure ? 4 : 3) * k;
        ctx.setLineDash(neckSure ? [] : [6 * k, 7 * k]);
        ctx.beginPath();
        ctx.moveTo(C.x + ux * radius, C.y + uy * radius);
        ctx.lineTo(M.x, M.y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = base * (sure ? 1 : 0.6);
    ctx.setLineDash(sure ? [] : [7 * k, 6 * k]);
    ctx.lineWidth = 4 * k;
    ctx.strokeStyle = opts.byConfidence ? confidenceColour(head.c) : colour;
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath();
    ctx.arc(C.x, C.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Joint dots on top. Debug view: every seen joint, green if confident, red if guessing.
  ctx.setLineDash([]);
  const dots: Array<FigurePoint | undefined> = [
    j.leftShoulder,
    j.rightShoulder,
    j.leftElbow,
    j.rightElbow,
    j.leftWrist,
    j.rightWrist,
  ];
  for (const p of dots) {
    if (!p || p.c <= 0 || (!opts.byConfidence && p.c < SHOWN)) continue;
    const sure = p.c >= SURE;
    const D = P(p);
    ctx.beginPath();
    ctx.arc(D.x, D.y, 5.5 * k, 0, Math.PI * 2);
    if (opts.byConfidence) {
      ctx.globalAlpha = base;
      ctx.fillStyle = confidenceColour(p.c);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2 * k;
      ctx.stroke();
    } else if (sure) {
      ctx.globalAlpha = base;
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2 * k;
      ctx.stroke();
    } else {
      // Unsure: a hollow ring instead of a solid dot.
      ctx.globalAlpha = base * 0.6;
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fill();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2.5 * k;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * A soft, dark body shape under the figure (the design's fake camera
 * picture). Widths are proportional to the on-screen shoulder width so the
 * body grows and shrinks with the person.
 */
function drawSilhouette(ctx: CanvasRenderingContext2D, v: View, fig: Figure): void {
  const j = fig.joints;
  const mid = shoulderMid(fig);
  if (!mid || !j.leftShoulder || !j.rightShoulder) return;
  const P = (p: FigurePoint): Pt => toScreen(v, fig, p);
  const L = P(j.leftShoulder);
  const R = P(j.rightShoulder);
  const sw = Math.hypot(L.x - R.x, L.y - R.y);
  if (sw <= 0) return;
  ctx.save();
  // Canvas blur is missing on older Safari; the body is then just sharper.
  if ('filter' in ctx) ctx.filter = `blur(${Math.max(2, sw * 0.06)}px)`;
  ctx.globalAlpha = 0.9;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#16110d';
  const limb = (a: FigurePoint | undefined, b: FigurePoint | undefined, width: number): void => {
    if (!a || !b) return;
    const A = P(a);
    const B = P(b);
    ctx.lineWidth = width * sw;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  };
  const lh = j.leftHip;
  const rh = j.rightHip;
  if (lh && rh) {
    ctx.strokeStyle = '#120e0b';
    limb(mid, { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, c: 1 }, 0.4);
    ctx.strokeStyle = '#16110d';
  }
  limb(j.leftShoulder, j.rightShoulder, 0.33);
  limb(j.leftShoulder, j.leftElbow, 0.22);
  limb(j.leftElbow, j.leftWrist, 0.18);
  limb(j.rightShoulder, j.rightElbow, 0.22);
  limb(j.rightElbow, j.rightWrist, 0.18);
  if (fig.head) {
    const C = P(fig.head);
    ctx.fillStyle = '#1a140f';
    ctx.beginPath();
    ctx.arc(C.x, C.y, fig.head.r * v.r.h + sw * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Green = confident (the counter uses it), red = the tracker is guessing. */
function confidenceColour(c: number): string {
  return c >= SURE ? OK : BAD;
}

/** ctx.roundRect where available (Safari 16+), else a plain rectangle. */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, radius);
  else ctx.rect(x, y, w, h);
}
