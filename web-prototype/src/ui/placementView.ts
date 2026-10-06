/**
 * Spec screen 3, "Phone placement": diagram on top, live camera behind, one
 * short instruction at the bottom. Once the counter sees a steady plank it
 * runs the 3-2-1 countdown by itself, so the user never touches the phone
 * from the floor. (On a laptop the copy says "laptop"/"screen" instead.)
 */
import type { CounterHint, CounterSnapshot } from '../core/types';
import { deviceWords, type Device } from './device';
import { byId, restartAnimation, setHidden, setText } from './dom';

/** One instruction at a time, in as few words as possible (read from the floor). */
export const HINT_COPY: Record<CounterHint, string> = {
  getInFrame: 'Get your head, shoulders and hands in view',
  handsInView: 'Hands in view',
  moveCloser: 'Move closer',
  moveBack: 'Move back',
  holdStill: 'Hold still',
  backToPlank: 'Back to plank',
  chestNotHead: 'Chest down, not just your head',
};

const HINT_ICON: Record<CounterHint, string> = {
  getInFrame: '#i-person',
  handsInView: '#i-hand',
  moveCloser: '#i-move',
  moveBack: '#i-move',
  holdStill: '#i-pause',
  backToPlank: '#i-person',
  chestNotHead: '#i-down',
};

export class PlacementView {
  private readonly hint = byId('place-hint');
  private readonly hintText = byId('place-hint-text');
  private readonly hintIcon = document.getElementById('place-hint-icon');
  private readonly countdown = byId('place-countdown');
  private readonly digit = byId('cd-n');
  private readonly frameOk = byId('frame-ok');
  private lastDigit = '';
  /** Shown when the counter has no specific instruction yet. */
  private readonly defaultHint: string;

  constructor(device: Device) {
    this.defaultHint = `Get in a plank, head toward ${deviceWords(device).target}`;
  }

  /**
   * Back to the first state (default hint, no countdown). The layer becomes
   * visible before the first frame is analysed, so without this the last
   * set's hint or countdown digit would flash up.
   */
  reset(): void {
    this.lastDigit = '';
    setHidden(this.hint, false);
    setHidden(this.countdown, true);
    setHidden(this.frameOk, true);
    setText(this.hintText, this.defaultHint);
    this.hintIcon?.setAttribute('href', '#i-person');
  }

  render(snap: CounterSnapshot): void {
    const counting = snap.phase === 'countdown';
    setHidden(this.hint, counting);
    setHidden(this.countdown, !counting);
    setHidden(this.frameOk, !counting);

    if (counting) {
      const seconds = Math.max(1, Math.ceil((snap.countdownRemainingMs ?? 0) / 1000));
      const digit = String(seconds);
      if (digit !== this.lastDigit) {
        this.lastDigit = digit;
        setText(this.digit, digit);
        restartAnimation(this.digit, 'tick');
      }
      return;
    }

    this.lastDigit = '';
    const hint = snap.hint;
    setText(this.hintText, hint ? HINT_COPY[hint] : this.defaultHint);
    const icon = hint ? HINT_ICON[hint] : '#i-person';
    if (this.hintIcon && this.hintIcon.getAttribute('href') !== icon) this.hintIcon.setAttribute('href', icon);
  }
}
