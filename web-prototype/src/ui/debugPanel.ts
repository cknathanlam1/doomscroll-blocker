/**
 * Debug view (Settings › Debug view): a collapsible panel on the camera
 * screens (a bottom sheet on phones, a column on the right on laptops) with
 * live numbers, a depth sparkline, threshold sliders, the last few counter
 * events and the recording state.
 *
 * Text is refreshed ~5×/s (not every frame) to keep DOM work low; the
 * sparkline is redrawn every frame while the panel is open.
 */
import type { CounterEvent, CounterSnapshot, TrackingIssue } from '../core/types';
import { DepthChart } from './chart';
import { byId, observeSize, setHidden, setText } from './dom';
import { fixed } from './format';
import { orderTuning, type Tuning } from './settings';

/** Everything the panel shows for one processed frame. */
export interface DebugFrame {
  /** Loop clock (performance.now ms), used for throttling. */
  nowMs: number;
  fps: number;
  inferenceMs: number;
  model: string;
  delegate: string;
  source: 'camera' | 'file' | 'demo';
  videoW: number;
  videoH: number;
  snap: CounterSnapshot;
  issue: TrackingIssue;
  luminance: number | null;
  /** MediaPipe visibility of [left, right] wrist, or null when nobody is detected. */
  wristConfidence: readonly [number, number] | null;
  tuning: Tuning;
}

export interface DebugPanelCallbacks {
  /** A threshold slider moved (already re-ordered so up < partial < down). */
  onTuning(tuning: Tuning): void;
  onSwitchToLite(): void;
  onOpenChange(open: boolean): void;
}

const TEXT_EVERY_MS = 200;
const MAX_EVENTS = 8;

type SliderKey = keyof Tuning;

export class DebugPanel {
  private readonly root = byId('debug');
  private readonly body = byId('dbg-body');
  private readonly toggle = byId<HTMLButtonElement>('dbg-toggle');
  private readonly summary = byId('dbg-summary');
  private readonly liteButton = byId<HTMLButtonElement>('dbg-lite');
  private readonly stats = byId('dbg-stats');
  private readonly eventList = byId<HTMLOListElement>('dbg-events');
  private readonly rec = byId('dbg-rec');
  private readonly chart = new DepthChart(byId<HTMLCanvasElement>('dbg-chart'));
  private readonly sliders: Record<SliderKey, { input: HTMLInputElement; output: HTMLOutputElement }>;

  private tuning: Tuning;
  private open = false;
  private lastTextAt = -Infinity;
  private events: CounterEvent[] = [];
  private eventsDirty = false;
  /** Counter time of the set's first frame, so events read "12.3s" from the start. */
  private t0: number | null = null;

  constructor(initialTuning: Tuning, callbacks: DebugPanelCallbacks) {
    this.tuning = initialTuning;
    this.sliders = {
      downThreshold: this.slider('sl-down'),
      partialMinDepth: this.slider('sl-partial'),
      upThreshold: this.slider('sl-up'),
    };
    for (const key of Object.keys(this.sliders) as SliderKey[]) {
      this.sliders[key].input.addEventListener('input', () => {
        const value = Number(this.sliders[key].input.value);
        this.tuning = orderTuning({ ...this.tuning, [key]: value }, key);
        this.showTuning();
        callbacks.onTuning(this.tuning);
      });
    }
    this.toggle.addEventListener('click', () => {
      this.setOpen(!this.open);
      callbacks.onOpenChange(this.open);
    });
    this.liteButton.addEventListener('click', () => callbacks.onSwitchToLite());
    observeSize(byId('dbg-chart'), (w, h) => this.chart.setSize(w, h));
    this.showTuning();
  }

  setVisible(visible: boolean): void {
    setHidden(this.root, !visible);
  }

  setOpen(open: boolean): void {
    this.open = open;
    setHidden(this.body, !open);
    this.toggle.setAttribute('aria-expanded', String(open));
    if (open) this.lastTextAt = -Infinity; // refresh text right away
  }

  setTuning(tuning: Tuning): void {
    this.tuning = tuning;
    this.showTuning();
  }

  /** Shows the "Slow · switch to Lite" chip (fps < 12 on the Full model). */
  setLiteSuggestion(show: boolean): void {
    setHidden(this.liteButton, !show);
  }

  setRecordingText(text: string): void {
    setText(this.rec, text);
  }

  /** Clears the chart, numbers and event list for a new set (so the last set's fps etc. don't linger). */
  resetSet(): void {
    this.chart.reset();
    this.events = [];
    this.eventsDirty = true;
    this.t0 = null;
    this.lastTextAt = -Infinity;
    setText(this.summary, 'debug');
    setText(this.stats, '');
    this.eventList.replaceChildren();
    setHidden(this.liteButton, true);
  }

  addEvent(ev: CounterEvent): void {
    this.events.unshift(ev);
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
    this.eventsDirty = true;
    if (ev.type === 'rep') this.chart.mark(ev.t, 'rep', ev.peakDepth);
    if (ev.type === 'partial') this.chart.mark(ev.t, 'partial', ev.peakDepth);
  }

  frame(f: DebugFrame): void {
    const t = f.snap.features.t;
    if (this.t0 === null) this.t0 = t;
    this.chart.push(t, f.snap.depth);
    if (!this.open) {
      if (f.nowMs - this.lastTextAt >= TEXT_EVERY_MS) {
        this.lastTextAt = f.nowMs;
        setText(this.summary, summaryText(f));
      }
      return;
    }
    this.chart.draw(t, f.tuning);
    if (f.nowMs - this.lastTextAt < TEXT_EVERY_MS) return;
    this.lastTextAt = f.nowMs;
    setText(this.summary, summaryText(f));
    setText(this.stats, statsText(f));
    if (this.eventsDirty) this.renderEvents();
  }

  private renderEvents(): void {
    this.eventsDirty = false;
    const t0 = this.t0 ?? 0;
    this.eventList.replaceChildren(
      ...this.events.map((ev) => {
        const li = document.createElement('li');
        li.className = ev.type;
        li.textContent = describeEvent(ev, t0);
        return li;
      }),
    );
  }

  private showTuning(): void {
    for (const key of Object.keys(this.sliders) as SliderKey[]) {
      const { input, output } = this.sliders[key];
      const value = this.tuning[key];
      if (Number(input.value) !== value) input.value = String(value);
      setText(output, value.toFixed(2));
    }
  }

  private slider(id: string): { input: HTMLInputElement; output: HTMLOutputElement } {
    return { input: byId<HTMLInputElement>(id), output: byId<HTMLOutputElement>(`${id}-v`) };
  }
}

/** Short text for the collapsed chip: it shares the bottom row with Give up, so keep it tiny. */
function summaryText(f: DebugFrame): string {
  return `${Math.round(f.fps)}fps ${Math.round(f.inferenceMs)}ms`;
}

function statsText(f: DebugFrame): string {
  const s = f.snap;
  const ft = s.features;
  const yes = (b: boolean): string => (b ? '✓' : '✗');
  const deg = (v: number | null): string => (v === null ? '–' : `${Math.round(v)}°`);
  const wrists = f.wristConfidence ? `${fixed(f.wristConfidence[0])}/${fixed(f.wristConfidence[1])}` : '–';
  return [
    `model  ${f.model}/${f.delegate} · ${f.source} ${f.videoW}×${f.videoH}`,
    `speed  ${f.fps.toFixed(1)} fps · ${f.inferenceMs.toFixed(1)} ms inference`,
    `phase  ${s.phase} / ${s.motion} · count ${s.count}/${s.target}`,
    `depth  ${fixed(s.depth, 3)}  raw ${fixed(s.rawDepth, 3)}  peak ${fixed(s.peakDepth, 3)}`,
    `src    ${s.depthSource ?? '–'} · down ${f.tuning.downThreshold.toFixed(2)}`,
    `h      ${fixed(s.heightRatio, 3)}  hTop ${fixed(s.baselineRatio, 3)}`,
    `sw     ratio ${fixed(s.shoulderWidthRatio)}  frac ${fixed(ft.shoulderWidthFrac)}  tilt ${deg(ft.shoulderTiltDeg)}`,
    `elbow  2D ${deg(ft.elbowAngle2D)}  3D ${deg(ft.elbowAngle3D)}`,
    `conf   sh ${fixed(ft.shoulderConfidence)}  wr ${wrists}  upper ${fixed(ft.upperBodyConfidence)}`,
    `seen   inFrame ${yes(s.inFrame)} plank ${yes(s.plankOk)} wrists ${ft.visibleWrists} nose ${yes(ft.noseVisible)}`,
    `light  ${f.luminance === null ? '–' : Math.round(f.luminance)} / 255`,
    `hint   ${s.hint ?? '–'} · issue ${f.issue}`,
  ].join('\n');
}

function describeEvent(ev: CounterEvent, t0: number): string {
  const at = `${((ev.t - t0) / 1000).toFixed(1)}s `;
  switch (ev.type) {
    case 'rep':
      return `${at}rep #${ev.count} · peak ${ev.peakDepth.toFixed(2)} · ${(ev.durationMs / 1000).toFixed(1)}s`;
    case 'partial':
      return `${at}didn't count · peak ${ev.peakDepth.toFixed(2)}${ev.live ? ' (turned back)' : ''}`;
    case 'countdownTick':
      return `${at}countdown ${ev.secondsLeft}`;
    case 'start':
      return `${at}start · hTop ${ev.baselineRatio.toFixed(2)}`;
    case 'repCancelled':
      return `${at}rep cancelled (${ev.reason})`;
    case 'paused':
      return `${at}paused (${ev.reason})`;
    case 'complete':
      return `${at}complete · ${ev.count} in ${(ev.elapsedMs / 1000).toFixed(1)}s`;
    default:
      return `${at}${ev.type}`;
  }
}
