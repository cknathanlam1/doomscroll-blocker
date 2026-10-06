export interface Speaker {
  readonly supported: boolean;
  enabled: boolean;
  /** Call synchronously inside a user-gesture handler (iOS requires it before any speech). */
  unlock(): void;
  /** Speaks short text. interrupt=true cancels anything queued first. No-op when disabled/unsupported. */
  say(text: string, opts?: { interrupt?: boolean }): void;
  cancel(): void;
}

/**
 * Speaking right after cancel() in the same tick is silently dropped by
 * WebKit (bug 191745), so after a cancel we wait this long before speaking.
 */
const RESTART_DELAY_MS = 80;
/**
 * Our phrases are all short (< 2 s). If the engine still claims to be busy
 * this long after we last queued something, it is stuck: start over.
 */
const STUCK_MS = 4000;
const RATE = 1.1;

/**
 * Novelty / robotic voices that iOS and macOS list as "en-US". Never pick
 * these automatically — "Seven" in the Bubbles voice is not motivating.
 */
const NOVELTY_VOICES =
  /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Fred|Junior|Kathy|Ralph)\b/i;

/**
 * The Audio Session API (Safari 16.4+/iOS 17) is not in TypeScript's DOM
 * typings yet, hence this narrow type for the one property we touch.
 */
type NavigatorWithAudioSession = Navigator & { audioSession?: { type: string } };

/**
 * Sets the page's audio session type when the browser supports it.
 * 'playback' makes speech play even with the Ring/Silent switch set to silent
 * (like a video would), but it also PAUSES the user's music or podcast while
 * the page is active. 'auto' gives that back.
 */
function setAudioSessionType(type: 'playback' | 'auto'): void {
  try {
    const session = (navigator as NavigatorWithAudioSession).audioSession;
    if (session) session.type = type;
  } catch {
    // Older Safari or a read-only property: speech still works with the ringer on.
  }
}

/**
 * Text-to-speech for counts and short cues, tuned for iPhone Safari.
 * Speech is best-effort: the on-screen count is the primary feedback, and
 * when speech falls behind only the NEWEST phrase is kept, so a spoken count
 * never lags behind the reps.
 */
export function createSpeaker(): Speaker {
  const synth: SpeechSynthesis | null =
    typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
      ? window.speechSynthesis
      : null;

  let enabled = true;
  let unlockedOnce = false;
  let voice: SpeechSynthesisVoice | null = null;
  let restartTimer: number | null = null;
  let restartText: string | null = null;
  let lastQueuedAt = 0;
  // Hold references to recently queued utterances: browsers can garbage-collect
  // an utterance mid-sentence, which cuts the speech off.
  let recent: SpeechSynthesisUtterance[] = [];

  /** Picks an en-US voice once the voice list is available (it loads late on iOS). */
  const pickVoice = (): void => {
    if (!synth || voice) return;
    const voices = synth.getVoices();
    if (voices.length === 0) return; // try again on 'voiceschanged' or the next say()
    const isUsEnglish = (v: SpeechSynthesisVoice): boolean => v.lang.replace('_', '-').toLowerCase() === 'en-us';
    const usable = voices.filter((v) => isUsEnglish(v) && !NOVELTY_VOICES.test(v.name));
    voice =
      usable.find((v) => v.default) ??
      usable.find((v) => v.name.startsWith('Samantha')) ??
      usable.find((v) => v.localService) ??
      usable[0] ??
      null; // null: let the system choose from utterance.lang
  };
  // Older WebKit doesn't make speechSynthesis an EventTarget; pickVoice() also
  // runs before every phrase, so missing this event is harmless.
  if (synth && typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', pickVoice);

  const makeUtterance = (text: string): SpeechSynthesisUtterance => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = RATE;
    if (voice) u.voice = voice;
    return u;
  };

  const queue = (u: SpeechSynthesisUtterance): void => {
    if (!synth) return;
    // iOS can leave the engine paused after an interruption such as a phone call.
    if (synth.paused) synth.resume();
    recent = [...recent.slice(-2), u];
    lastQueuedAt = performance.now();
    synth.speak(u);
  };

  const speakNow = (text: string): void => {
    pickVoice();
    queue(makeUtterance(text));
  };

  const clearRestart = (): void => {
    if (restartTimer !== null) window.clearTimeout(restartTimer);
    restartTimer = null;
    restartText = null;
  };

  /** Throws away anything queued or playing and speaks `text` as soon as it is safe. */
  const speakFresh = (text: string): void => {
    if (!synth) return;
    restartText = text;
    if (restartTimer !== null) return; // a restart is already scheduled; it will speak the newest text
    if (!synth.speaking && !synth.pending) {
      restartText = null;
      speakNow(text);
      return;
    }
    synth.cancel();
    recent = [];
    restartTimer = window.setTimeout(() => {
      const next = restartText;
      restartTimer = null;
      restartText = null;
      if (next && enabled) speakNow(next);
    }, RESTART_DELAY_MS);
  };

  const cancel = (): void => {
    clearRestart();
    recent = [];
    synth?.cancel();
  };

  return {
    supported: synth !== null,

    get enabled(): boolean {
      return enabled;
    },
    set enabled(value: boolean) {
      enabled = value;
      if (!value) {
        cancel();
        setAudioSessionType('auto'); // let the user's music play again
      } else if (unlockedOnce) {
        setAudioSessionType('playback');
      }
    },

    unlock(): void {
      // Only claim the 'playback' session (which pauses the user's music) if
      // we are actually going to talk.
      if (enabled) setAudioSessionType('playback');
      unlockedOnce = true;
      if (!synth) return;
      // iOS only allows speech after speak() has been called inside a user
      // gesture. This must happen synchronously — before any await — in the
      // tap handler. A real word at near-zero volume is used because some
      // WebKit versions skip empty utterances without unlocking.
      pickVoice();
      const u = makeUtterance('Ready');
      u.volume = 0.01;
      queue(u);
    },

    say(text: string, opts?: { interrupt?: boolean }): void {
      if (!synth || !enabled) return;
      const phrase = text.trim();
      if (!phrase) return;
      const busy = synth.speaking || synth.pending;
      const stuck = busy && performance.now() - lastQueuedAt > STUCK_MS;
      if (opts?.interrupt || synth.pending || restartTimer !== null || stuck) {
        // Interrupt requested, or a backlog is waiting (e.g. an older count
        // word): drop it rather than letting counts lag behind the reps.
        speakFresh(phrase);
      } else {
        // Idle, or one short phrase still playing: queue right behind it.
        speakNow(phrase);
      }
    },

    cancel,
  };
}

const COUNT_WORDS: readonly string[] = [
  'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty',
  'Twenty-one', 'Twenty-two', 'Twenty-three', 'Twenty-four', 'Twenty-five',
  'Twenty-six', 'Twenty-seven', 'Twenty-eight', 'Twenty-nine', 'Thirty',
];

/** "One", "Two", … for spoken counts; falls back to digits above the table. */
export function countWord(n: number): string {
  if (Number.isInteger(n) && n >= 1) return COUNT_WORDS[n - 1] ?? String(n);
  return String(n);
}
