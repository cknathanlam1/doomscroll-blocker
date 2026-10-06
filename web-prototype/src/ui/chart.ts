/**
 * Debug sparkline: smoothed depth over the last 10 seconds, with the three
 * thresholds as horizontal lines and a dot for every counted rep (volt) or
 * partial rep (orange). Seeing the curve next to the lines is the quickest
 * way to tune downThreshold on real push-ups.
 */
import { canvasDpr } from './dom';
import type { Tuning } from './settings';

export type ChartMark = 'rep' | 'partial';

interface Sample {
  t: number;
  depth: number | null;
}

interface Mark {
  t: number;
  kind: ChartMark;
  depth: number;
}

const VOLT = '#FFD43B';
const WARN = '#FF9F0A';

export class DepthChart {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly windowMs: number;
  private samples: Sample[] = [];
  private marks: Mark[] = [];
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement, windowMs = 10_000) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.windowMs = windowMs;
  }

  setSize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = canvasDpr();
    const w = Math.round(cssW * this.dpr);
    const h = Math.round(cssH * this.dpr);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  reset(): void {
    this.samples = [];
    this.marks = [];
  }

  /** Adds one frame's smoothed depth (t in the counter's milliseconds). */
  push(t: number, depth: number | null): void {
    this.samples.push({ t, depth });
    this.trim(t);
  }

  mark(t: number, kind: ChartMark, depth: number): void {
    this.marks.push({ t, kind, depth });
  }

  draw(now: number, tuning: Tuning): void {
    const ctx = this.ctx;
    // The size normally arrives via setSize(); measure once if it hasn't yet (panel just opened).
    if (this.cssW === 0) this.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    if (!ctx || this.cssW === 0 || this.cssH === 0) return;
    const w = this.cssW;
    const h = this.cssH;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Vertical scale: a bit above the depth threshold, so the interesting range fills the chart.
    const yMin = -0.05;
    const yMax = Math.max(0.5, tuning.downThreshold * 1.6);
    const pad = 4;
    const yOf = (d: number): number => {
      const clamped = Math.min(yMax, Math.max(yMin, d));
      return pad + (1 - (clamped - yMin) / (yMax - yMin)) * (h - 2 * pad);
    };
    const xOf = (t: number): number => ((t - (now - this.windowMs)) / this.windowMs) * w;

    // Threshold lines.
    const line = (d: number, colour: string, dash: number[]): void => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(0, yOf(d));
      ctx.lineTo(w, yOf(d));
      ctx.stroke();
    };
    line(tuning.upThreshold, 'rgba(255,255,255,.55)', [3, 3]);
    line(tuning.partialMinDepth, WARN, [3, 3]);
    line(tuning.downThreshold, VOLT, []);
    ctx.setLineDash([]);

    // Depth curve (gaps where depth was unknown).
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let penDown = false;
    for (const s of this.samples) {
      if (s.depth === null) {
        penDown = false;
        continue;
      }
      const x = xOf(s.t);
      const y = yOf(s.depth);
      if (penDown) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      penDown = true;
    }
    ctx.stroke();

    // Rep / partial markers at their peak depth.
    for (const m of this.marks) {
      ctx.fillStyle = m.kind === 'rep' ? VOLT : WARN;
      ctx.beginPath();
      ctx.arc(xOf(m.t), yOf(m.depth), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private trim(now: number): void {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.samples.length && (this.samples[i]?.t ?? Infinity) < cutoff) i++;
    if (i > 0) this.samples.splice(0, i);
    this.marks = this.marks.filter((m) => m.t >= cutoff);
  }
}
