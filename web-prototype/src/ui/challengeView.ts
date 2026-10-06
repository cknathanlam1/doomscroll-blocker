/**
 * Spec screen 4, "Challenge", plus its states S2 (paused: can't see you)
 * and S4 (partial rep: "Go lower").
 *
 * The count is the screen. Everything else is glanceable: segment bar,
 * a depth gauge whose volt mark is the depth a rep must reach, and an
 * orange cue when a rep was too shallow.
 */
import type { CounterHint, CounterSnapshot, MotionPhase, PauseReason } from '../core/types';
import { deviceWords, type Device } from './device';
import { byId, clamp, restartAnimation, setHidden, setText } from './dom';
import type { DepthLineState } from './overlay';

/** How long "Go lower" stays up after a partial rep (spec S4: about 1.5 s). */
export const CUE_MS = 1500;

/**
 * The gauge is scaled so the depth threshold sits at 80% of its height (the
 * volt mark in the design); deeper reps fill the top 20%.
 */
const MARK_AT = 0.8;

/** How far (in font sizes) the "+1" rises above its start point while still visible, plus a little margin. */
const PLUS_ONE_RISE = 1.75;

/** How the current rep attempt is going, which colours the gauge. */
type Attempt = 'none' | 'reached' | 'partial';

export class ChallengeView {
  private readonly root = byId('layer-challenge');
  private readonly segs = byId('segs');
  private readonly chips = this.root.querySelector<HTMLElement>('.ch-chips') ?? byId('voice');
  private readonly counter = byId('counter');
  private readonly count = byId('count');
  private readonly of = byId('count-of');
  private readonly voice = byId('voice');
  private readonly voiceWord = byId('voice-word');
  private readonly pausedPill = byId('paused-pill');
  private readonly nocountPill = byId('nocount-pill');
  private readonly gaugeFill = byId('gauge-fill');
  private readonly cue = byId('cue');
  private readonly chestCue = byId('chest-cue');
  private readonly ghost = byId('ghost-sil');
  private readonly lost = byId('lost-block');
  private readonly lostTitle = byId('lost-title');
  private readonly lostTip1 = byId('lost-tip-1');
  private readonly lostTip2 = byId('lost-tip-2');

  private segEls: HTMLElement[] = [];
  private shownCount = -1;
  private attempt: Attempt = 'none';
  private lastMotion: MotionPhase = 'up';
  private partialPeak = 0;
  private cueUntil = 0;
  private chestUntil = 0;
  private pauseReason: PauseReason = 'lost';
  private fillPct = -1;
  private voiceOn = true;
  /** "Head toward the phone" / "Laptop about 3 ft away": copy for the paused screen. */
  private readonly words: { target: string; distance: string };

  constructor(device: Device) {
    const w = deviceWords(device);
    this.words = { target: w.target, distance: `${capitalize(w.thing)} about 3 ft away` };
  }

  /** Prepares for a new set of `target` reps. */
  reset(target: number, voiceOn: boolean): void {
    this.voiceOn = voiceOn;
    this.segEls = Array.from({ length: target }, () => document.createElement('i'));
    this.segs.replaceChildren(...this.segEls);
    setText(this.of, `/${target}`);
    this.shownCount = -1;
    this.attempt = 'none';
    this.lastMotion = 'up';
    this.partialPeak = 0;
    this.cueUntil = 0;
    this.chestUntil = 0;
    this.pauseReason = 'lost';
    this.fillPct = -1;
    this.setVoiceWord('Go', false);
    for (const el of this.root.querySelectorAll('.plus-one')) el.remove();
  }

  setVoiceOn(on: boolean): void {
    this.voiceOn = on;
  }

  /** "Counting aloud · “Seven”" — pulses the chip so the spoken word is visible too. */
  setVoiceWord(word: string, pulse = true): void {
    setText(this.voiceWord, `“${word}”`);
    if (pulse) restartAnimation(this.voice, 'say');
  }

  onRep(): void {
    restartAnimation(this.counter, 'bump');
  }

  /**
   * A big "+1" that pops up at `at` (viewport pixels, just above the head)
   * and floats away, so every counted rep is visible from the floor without
   * reading the counter. Falls back to the middle of the screen.
   */
  plusOne(at: { x: number; y: number } | null): void {
    const box = this.root.getBoundingClientRect();
    const x = at ? at.x - box.left : box.width / 2;
    const y = at ? at.y - box.top : box.height * 0.45;
    const el = document.createElement('span');
    el.className = 'plus-one';
    el.textContent = '+1';
    el.setAttribute('aria-hidden', 'true');
    // Keep it fully on screen (head near the top edge, or off to one side).
    el.style.left = `${clamp(x, 60, Math.max(60, box.width - 60))}px`;
    this.root.append(el);
    // It rises ~1.7× its height while visible (styles.css @keyframes plus-one),
    // so start low enough that it never reaches the segment bar and chips or
    // leaves the screen. (Its size comes from CSS, so measure it.)
    const fontPx = Number.parseFloat(getComputedStyle(el).fontSize) || 96;
    const chips = this.chips.getBoundingClientRect();
    const minTop = Math.max(0, chips.bottom - box.top) + PLUS_ONE_RISE * fontPx;
    el.style.top = `${clamp(y, minTop, Math.max(minTop, box.height - 80))}px`;
    const remove = (): void => el.remove();
    el.addEventListener('animationend', remove, { once: true });
    window.setTimeout(remove, 1500); // in case animations are off or the tab is hidden
  }

  onDepthReached(): void {
    this.attempt = 'reached';
  }

  onPartial(peakDepth: number, nowMs: number): void {
    this.attempt = 'partial';
    this.partialPeak = Math.max(peakDepth, nowMs < this.cueUntil ? this.partialPeak : 0);
    this.cueUntil = nowMs + CUE_MS;
  }

  onPaused(reason: PauseReason): void {
    this.pauseReason = reason;
  }

  /** True while the "Go lower" cue is showing (the skeleton turns orange too). */
  isWarning(nowMs: number): boolean {
    return nowMs < this.cueUntil;
  }

  /**
   * How the depth line on the camera should look: solid once this rep went
   * deep enough, orange while "Go lower" shows, dashed otherwise. Same
   * colours as the gauge, so the two always agree.
   */
  depthLineState(nowMs: number): DepthLineState {
    if (this.attempt === 'reached') return 'reached';
    if (this.attempt === 'partial' && nowMs < this.cueUntil) return 'partial';
    return 'idle';
  }

  render(snap: CounterSnapshot, downThreshold: number, nowMs: number): void {
    const paused = snap.phase === 'paused';
    this.root.classList.toggle('paused', paused);
    setHidden(this.pausedPill, !paused);

    if (snap.count !== this.shownCount) {
      this.shownCount = snap.count;
      setText(this.count, String(snap.count));
      this.segEls.forEach((seg, i) => seg.classList.toggle('on', i < snap.count));
    }

    // A new descent starts a new attempt: the gauge goes back to white.
    if (snap.motion !== 'up' && this.lastMotion === 'up') this.attempt = 'none';
    this.lastMotion = snap.motion;

    const cueOn = nowMs < this.cueUntil;
    const full = downThreshold / MARK_AT;
    let frac = clamp((snap.depth ?? 0) / full, 0, 1);
    // While "Go lower" shows, hold the bar at the partial's peak so you can see it stopped short of the line.
    if (cueOn && this.attempt === 'partial') frac = Math.max(frac, clamp(this.partialPeak / full, 0, 1));
    const pct = Math.round(frac * 100);
    if (pct !== this.fillPct) {
      this.fillPct = pct;
      this.gaugeFill.style.height = `${pct}%`;
    }
    this.gaugeFill.classList.toggle('hit', this.attempt === 'reached');
    this.gaugeFill.classList.toggle('warn', this.attempt === 'partial' && cueOn);

    this.cue.classList.toggle('off', !cueOn || paused);
    setHidden(this.nocountPill, !cueOn || paused);
    setHidden(this.voice, !this.voiceOn || cueOn || paused);

    if (snap.hint === 'chestNotHead') this.chestUntil = nowMs + CUE_MS;
    setHidden(this.chestCue, nowMs >= this.chestUntil || cueOn || paused);

    setHidden(this.ghost, !paused);
    setHidden(this.lost, !paused);
    if (paused) {
      const copy = pausedCopy(snap.hint, this.pauseReason, this.words);
      setText(this.lostTitle, copy.title);
      setText(this.lostTip1, copy.tip1);
      setText(this.lostTip2, copy.tip2);
    }
  }
}

/**
 * What the paused screen says. The set only resumes once the plank check
 * passes, so name whatever is actually blocking it: no body, no hands, too
 * far or too close (same words as the Placement screen's hints), or not in a
 * plank yet.
 */
export function pausedCopy(
  hint: CounterHint | null,
  reason: PauseReason,
  words: { target: string; distance: string },
): { title: string; tip1: string; tip2: string } {
  switch (hint) {
    case 'getInFrame':
      return { title: "Can't\nsee you", tip1: 'Head and shoulders in frame', tip2: words.distance };
    case 'handsInView':
      return { title: 'Hands\nin view', tip1: 'Hands on the floor, in the picture', tip2: words.distance };
    case 'moveCloser':
      return { title: 'Move\ncloser', tip1: words.distance, tip2: `Head toward ${words.target}` };
    case 'moveBack':
      return { title: 'Move\nback', tip1: words.distance, tip2: 'Head and shoulders in frame' };
    default:
      break;
  }
  if (reason === 'outOfPlank' || hint === 'backToPlank') {
    return { title: 'Back to\nplank', tip1: 'Hands on the floor, arms straight', tip2: `Head toward ${words.target}` };
  }
  return { title: "Can't\nsee you", tip1: 'Head and shoulders in frame', tip2: words.distance };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
