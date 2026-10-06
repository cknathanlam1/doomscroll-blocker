/**
 * App orchestration: screens, the camera session, and the per-frame loop
 * that connects the pose detector to the rep counter and the UI.
 *
 * Flow (spec numbers in brackets):
 *   Start ──tap──▶ Stage: loading → Placement [3] → Challenge [4] ──10/10──▶ Success [5]
 *                    │                                                 └─Give up─▶ Gave up [6]
 *                    └─ camera problem ─▶ Camera is off [S1]
 * Placement and Challenge share ONE <video> so the camera never restarts
 * between them; which layer shows is decided by the counter's phase.
 *
 * Three sources feed the same pipeline:
 *   camera / video file:  detector.detect(video) → SourceFrame
 *   demo (no camera):     simulated PoseFrame    → SourceFrame
 * then, per frame:  counter.update(frame) → trackingIssue.update(...)
 *   → recorder.push(...) → events (speech, cues, Success) → render.
 */
import { DEFAULT_CONFIG, RepCounter } from './core/repCounter';
import type { Recording } from './core/recording';
import { TrackingIssueDetector } from './core/trackingIssue';
import type { CounterConfig, CounterEvent, CounterSnapshot, PoseFrame, TrackingIssue } from './core/types';
import { buildDemoSession, type DemoSession } from './demo/demoScript';
import { DemoRunner } from './demo/demoRunner';
import type { DemoHook, DemoState } from './demo/devHook';
import { startCamera, startVideoFile, type CameraErrorKind, type CameraResult, type MediaSession } from './platform/camera';
import { startFrameLoop } from './platform/frameLoop';
import { createLuminanceMeter, type LuminanceMeter } from './platform/luminance';
import { createPoseDetector, type PoseDetection, type PoseDetector } from './platform/poseDetector';
import { createRecorder, saveRecording, type SessionRecorder } from './platform/recorder';
import { countWord, createSpeaker, type Speaker } from './platform/speech';
import { createWakeLock, type ScreenWakeLock } from './platform/wakeLock';
import { cameraErrorCopy } from './ui/cameraErrors';
import { ChallengeView } from './ui/challengeView';
import { DebugPanel } from './ui/debugPanel';
import { detectDevice, type Device } from './ui/device';
import { byId, observeSize, setHidden, setText } from './ui/dom';
import { logError } from './ui/errorLog';
import { figureFromLandmarks, figureFromPoseFrame, type Figure } from './ui/figure';
import { errorText, formatElapsed } from './ui/format';
import { SkeletonOverlay, type DepthGuide, type DepthLine, type FitMode, type SkeletonStyle } from './ui/overlay';
import { PlacementView } from './ui/placementView';
import { showScreen, type ScreenId } from './ui/screens';
import {
  bindSettingsForm,
  counterConfigFor,
  loadSettings,
  saveSettings,
  tuningFor,
  type AppSettings,
  type SettingsForm,
  type Tuning,
} from './ui/settings';

/** Where the pictures come from: the front camera, a clip picked from Photos/Files, or the simulated demo person. */
type Source = { kind: 'camera' } | { kind: 'file'; file: File } | { kind: 'demo' };

type Layer = 'placement' | 'challenge';

/**
 * One frame from any source, ready for the shared pipeline. The demo builds
 * these from simulated poses; the camera from the detector's output.
 */
interface SourceFrame {
  frame: PoseFrame;
  /** What to draw (null = nobody detected). */
  figure: Figure | null;
  /** Size of the picture the figure belongs to, for mapping it onto the screen. */
  sourceW: number;
  sourceH: number;
  inferenceMs: number;
  luminance: number | null;
  /** Detector confidence of [left, right] wrist (debug view), or null when nobody is detected. */
  wristConfidence: readonly [number, number] | null;
  /** For the debug view: which model and processor produced this frame. */
  model: string;
  delegate: string;
}

/** Pause between the last rep and the Success screen, so the final count registers. */
const SUCCESS_DELAY_MS = 600;
/** Luminance is sampled twice a second (it reads pixels, so not every frame). */
const LUMA_EVERY_MS = 500;
/** Below this frame rate the debug view suggests the Lite model. */
const LOW_FPS = 12;
/** Don't say "Lower" again within this time (a partial can be reported live and again at the top). */
const LOWER_REPEAT_MS = 2000;
const TOAST_MS = 4000;
const FIRST_LOAD_MESSAGE = 'Loading body tracking… first time downloads ~10 MB';

// Do-nothing stand-ins, used if a platform feature fails to start, so one
// broken feature (e.g. speech) never takes the whole prototype down.
const NO_SPEECH: Speaker = { supported: false, enabled: false, unlock() {}, say() {}, cancel() {} };
const NO_WAKE_LOCK: ScreenWakeLock = {
  supported: false,
  active: false,
  acquire: () => Promise.resolve(),
  release: () => Promise.resolve(),
};
const NO_RECORDER: SessionRecorder = { recording: false, frameCount: 0, start() {}, push() {}, stop: () => null };

export class App {
  // --- Settings -----------------------------------------------------------
  private settings: AppSettings = loadSettings();
  /** Live depth thresholds (preset from Settings, adjustable with the debug sliders). */
  private tuning: Tuning = tuningFor(this.settings.depth);
  private settingsForm: SettingsForm | null = null;
  /** Phone or laptop: only changes words and tips (layout follows the screen shape in CSS). */
  private readonly device: Device = detectDevice();

  // --- Core algorithm (pure, no DOM) -------------------------------------
  private readonly counter = new RepCounter(counterConfigFor(this.settings, this.tuning));
  private readonly tracking = new TrackingIssueDetector();

  // --- Platform services ---------------------------------------------------
  private readonly speaker = safeCreate('speech', createSpeaker, NO_SPEECH);
  private readonly wakeLock = safeCreate('wake lock', createWakeLock, NO_WAKE_LOCK);
  private readonly luminance = safeCreate<LuminanceMeter | null>('luminance', createLuminanceMeter, null);
  private readonly recorder = safeCreate('recorder', () => createRecorder(), NO_RECORDER);

  // --- Page elements -------------------------------------------------------
  private readonly video = byId<HTMLVideoElement>('video');
  private readonly overlayCanvas = byId<HTMLCanvasElement>('overlay');
  private readonly stage = byId('screen-stage');
  private readonly placementLayer = byId('layer-placement');
  private readonly challengeLayer = byId('layer-challenge');
  private readonly darkOverlay = byId('dark-ov');
  private readonly resumeOverlay = byId('resume-ov');
  private readonly toast = byId('stage-toast');
  private readonly loadingOverlay = byId('loading-ov');
  private readonly loadingSpin = byId('loading-spin');
  private readonly loadingMsg = byId('loading-msg');
  private readonly loadingSub = byId('loading-sub');
  private readonly loadingErr = byId('loading-err');
  private readonly loadingErrText = byId('loading-err-text');
  private readonly overlay = new SkeletonOverlay(this.overlayCanvas);
  private readonly placement = new PlacementView(this.device);
  private readonly challenge = new ChallengeView(this.device);
  private readonly debug: DebugPanel;

  // --- Pose detector (created once, reused across sets) -------------------
  private detector: PoseDetector | null = null;
  private detectorKey = '';
  private pendingDetector: { key: string; promise: Promise<PoseDetector> } | null = null;
  /**
   * Bumped for every detector load (and when a load is abandoned), so progress
   * messages from an abandoned load don't show up in the current one.
   */
  private detectorLoadId = 0;

  // --- Current session -----------------------------------------------------
  private screen: ScreenId = 'start';
  private source: Source = { kind: 'camera' };
  private media: MediaSession | null = null;
  private stopFrames: (() => void) | null = null;
  private layer: Layer | null = null;
  /**
   * Bumped whenever a session starts or ends. Async steps (camera start,
   * model download) compare it before acting, so a late result from an
   * abandoned attempt (user tapped Give up while loading) is ignored.
   */
  private runId = 0;
  /** The camera was stopped because the page was hidden; the count is kept. */
  private suspended = false;
  /** A camera restart after suspend() is in flight (only one at a time). */
  private restarting = false;
  /**
   * startSet() has run for this session. Until then the camera may be on but
   * body tracking is still loading, and finishStart() starts the set.
   */
  private setStarted = false;
  /** The set is complete; Success shows once this frame time (or timer) is reached. */
  private pendingSuccess: { at: number; count: number; elapsedMs: number } | null = null;
  private successTimer = 0;
  private toastTimer = 0;
  private lastRecording: Recording | null = null;
  private lastSnap: CounterSnapshot | null = null;

  // --- Demo (no camera, no detector) -------------------------------------
  private demo: DemoRunner | null = null;
  private demoSession: DemoSession | null = null;
  /** The dev hook is stepping the demo: don't also play it in real time. */
  private demoManual = false;

  // --- Per-frame bookkeeping -------------------------------------------------
  private fps = 0;
  private fpsFrames = 0;
  private fpsWindowStart = 0;
  private fpsWindows = 0;
  private inferenceMs = 0;
  private luma: number | null = null;
  private lumaAt = -Infinity;
  private issue: TrackingIssue = 'none';
  private lastLowerAt = -Infinity;

  constructor() {
    this.speaker.enabled = this.settings.speak;
    this.debug = new DebugPanel(this.tuning, {
      onTuning: (tuning) => this.applyTuning(tuning),
      onSwitchToLite: () => this.switchToLite(),
      onOpenChange: (open) => {
        this.settings = { ...this.settings, debugOpen: open };
        saveSettings(this.settings);
        // The settings card keeps its own copy; without this its next change would save the old debugOpen.
        this.settingsForm?.refresh(this.settings);
      },
    });
  }

  /** Wires up the page and shows the Start screen (or starts the demo for ?demo). */
  start(): void {
    // CSS shows the phone or laptop wording (.only-phone / .only-desktop) from this.
    document.body.dataset.device = this.device;
    this.settingsForm = bindSettingsForm(this.settings, (next, key) => this.onSettingsChange(next, key));
    this.debug.setOpen(this.settings.debugOpen);
    this.wireButtons();
    // The canvas (not the stage) is observed: it shrinks when the debug panel docks beside it on a laptop.
    observeSize(this.overlayCanvas, (w, h) => {
      this.overlay.setSize(w, h);
      this.overlay.setFit(this.videoFit());
    });
    document.addEventListener('visibilitychange', () => this.onVisibilityChange());
    // Leaving the page (or Safari putting it in its back/forward cache): turn the camera off.
    window.addEventListener('pagehide', () => {
      if (this.media || this.demo) this.suspend();
    });
    this.renderStartScreen();
    showScreen('start');
    if (new URLSearchParams(window.location.search).has('demo')) this.beginSet({ kind: 'demo' });
  }

  // =========================================================================
  // Buttons
  // =========================================================================

  private wireButtons(): void {
    const click = (id: string, handler: () => void): void => byId(id).addEventListener('click', handler);
    const fileInput = byId<HTMLInputElement>('file-input');

    click('btn-start', () => this.beginFromGesture({ kind: 'camera' }));
    click('btn-demo', () => this.beginFromGesture({ kind: 'demo' }));
    click('btn-demo-exit', () => this.goHome());
    // Esc also leaves the demo (handy on a laptop).
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.screen === 'stage' && this.source.kind === 'demo') this.goHome();
    });
    click('btn-video', () => {
      // This tap is the user gesture iOS needs for speech + wake lock;
      // the file picker's 'change' event later is not one.
      this.unlockFromGesture();
      fileInput.value = ''; // so choosing the same file again still fires 'change'
      fileInput.click();
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this.beginSet({ kind: 'file', file });
    });
    // Picker closed without choosing a file: don't keep the screen awake on the Start screen.
    fileInput.addEventListener('cancel', () => {
      if (this.screen !== 'stage') this.releaseWakeLock();
    });

    click('btn-giveup', () => this.giveUp());
    click('btn-again', () => this.beginFromGesture(this.source));
    click('btn-succ-done', () => this.goHome());
    click('btn-tryagain', () => this.beginFromGesture(this.source));
    click('btn-gaveup-done', () => this.goHome());
    click('btn-camerr-retry', () => this.beginFromGesture(this.source));
    click('btn-camerr-back', () => this.goHome());
    click('btn-load-retry', () => this.beginFromGesture(this.source));
    click('btn-load-cancel', () => this.goHome());
    click('resume-ov', () => this.resumeFromGesture());
    for (const id of ['btn-save-start', 'btn-save-succ', 'btn-save-gaveup']) click(id, () => this.saveLastRecording());
  }

  // =========================================================================
  // Starting a set
  // =========================================================================

  /**
   * Starts a set from a tap. iOS only allows speech, the wake lock and the
   * camera prompt from inside a user gesture, so those calls happen here
   * synchronously, before anything awaits.
   */
  private beginFromGesture(source: Source): void {
    this.unlockFromGesture();
    this.beginSet(source);
  }

  /** Speech + wake lock must be unlocked synchronously inside a tap handler (iOS rule). */
  private unlockFromGesture(): void {
    this.speaker.enabled = this.settings.speak;
    try {
      this.speaker.unlock();
    } catch (err) {
      logError('speech', err);
    }
    try {
      this.wakeLock.acquire().catch((err: unknown) => logError('wake lock', err));
    } catch (err) {
      logError('wake lock', err);
    }
  }

  private beginSet(source: Source): void {
    this.stopSession();
    const run = this.runId;
    this.source = source;
    this.screen = 'stage';
    // Selfie (mirrored) view only for the live camera; the demo paints a fake camera picture instead of video.
    this.stage.classList.toggle('mirror', source.kind === 'camera');
    this.stage.classList.toggle('demo', source.kind === 'demo');
    // Show the stage (and its <video>) BEFORE starting the camera: iOS won't play into a hidden video.
    showScreen('stage');
    this.overlay.setFit(this.videoFit());
    this.debug.setVisible(this.settings.debug);
    if (source.kind === 'demo') {
      // No camera and no body tracking: the simulated person goes straight in.
      this.startSet();
      return;
    }
    this.showLoading(source.kind === 'camera' ? 'Starting camera…' : 'Opening video…');
    // Both start now, in parallel. openMedia() calls startCamera() synchronously, inside the tap.
    const media = this.openMedia(source);
    const detector = this.ensureDetector();
    void this.finishStart(run, media, detector);
  }

  /** Starts the camera or the video file; never throws. */
  private async openMedia(source: Source): Promise<CameraResult> {
    try {
      if (source.kind === 'camera') return await startCamera(this.video);
      if (source.kind === 'file') return { ok: true, session: await startVideoFile(this.video, source.file) };
      return { ok: false, error: 'unknown', message: 'The demo has no camera.' };
    } catch (err) {
      return { ok: false, error: 'unknown', message: errorText(err) };
    }
  }

  private async finishStart(
    run: number,
    mediaPromise: Promise<CameraResult>,
    detectorPromise: Promise<PoseDetector>,
  ): Promise<void> {
    const media = await mediaPromise;
    if (run !== this.runId) {
      if (media.ok) media.session.stop(); // abandoned while starting
      return;
    }
    if (!media.ok) {
      if (this.source.kind === 'camera') this.showCameraError(media.error, media.message);
      else this.showLoadError("Couldn't play that video", media.message);
      return;
    }
    this.media = media.session;
    if (!this.detector) this.showLoading('Loading body tracking…');

    try {
      await detectorPromise;
    } catch (err) {
      if (run === this.runId) this.showLoadError("Body tracking didn't start", err);
      return;
    }
    if (run !== this.runId) return;
    // While suspended, "Restarting camera…" (or "Tap to resume") stays up; resumeWith() starts the loop.
    if (!this.suspended) this.hideLoading();
    this.startSet();
  }

  /** Fresh counter + UI for a new set (camera and detector are ready, or this is the demo). */
  private startSet(): void {
    this.setStarted = true;
    try {
      this.counter.reset();
      this.counter.setConfig(counterConfigFor(this.settings, this.tuning));
      this.tracking.reset();
    } catch (err) {
      logError('rep counter', err);
    }
    this.placement.reset();
    this.challenge.reset(this.settings.reps, this.voiceEnabled());
    this.debug.resetSet();
    this.resetFrameStats();
    this.issue = 'none';
    this.lastLowerAt = -Infinity;
    this.lastSnap = null;
    if (this.source.kind === 'demo') {
      if (!this.createDemo()) return;
    } else {
      this.startRecorder();
    }
    this.setLayer('placement');
    if (document.visibilityState === 'hidden') {
      this.suspend(); // the phone locked during loading; resume when it's back
      return;
    }
    // The page was hidden while loading and the camera is restarting (or waiting
    // for "Tap to resume"): resumeWith() starts the loop once it's back.
    if (this.suspended) return;
    this.startLoop();
    if (this.source.kind === 'camera') this.checkWakeLock(this.runId);
  }

  /**
   * A phone propped on the floor dims and locks mid-set unless the screen
   * wake lock works (it can't on older iOS, and can be refused). Then tell
   * the user how to keep the screen on.
   */
  private checkWakeLock(run: number): void {
    if (this.device !== 'phone') return;
    this.wakeLock
      .acquire()
      .then(() => {
        if (run === this.runId && this.screen === 'stage' && !this.wakeLock.active) {
          this.showToast('The screen may lock: set Settings › Display & Brightness › Auto-Lock to 5 minutes');
        }
      })
      .catch((err: unknown) => logError('wake lock', err));
  }

  /** Builds the simulated set for the current rep target. False (with a message) if that failed. */
  private createDemo(): boolean {
    try {
      const session = buildDemoSession(this.settings.reps, { wholeFrameVisible: this.videoFit() === 'contain' });
      this.demoSession = session;
      this.demo = new DemoRunner(session.frames, {
        onFrame: (frame) => this.onDemoFrame(frame),
        onEnd: () => {
          // Normally Success has shown by now; this only happens if the counter missed reps.
          if (this.screen === 'stage' && !this.pendingSuccess) this.showToast('Demo finished. Tap Give up to leave.');
        },
      });
      return true;
    } catch (err) {
      this.showLoadError("The demo didn't start", err);
      return false;
    }
  }

  /**
   * Returns the pose detector for the current Model/Processor settings,
   * reusing the loaded one when they haven't changed (loading takes seconds
   * and downloads the model the first time).
   */
  private ensureDetector(): Promise<PoseDetector> {
    const key = `${this.settings.model}/${this.settings.delegate}`;
    if (this.detector && this.detectorKey === key) return Promise.resolve(this.detector);
    if (this.pendingDetector?.key === key) return this.pendingDetector.promise;

    // Settings changed: free the old detector first (phones are short on GPU memory).
    this.closeDetector();
    setText(this.loadingSub, FIRST_LOAD_MESSAGE);
    const options = { model: this.settings.model, delegate: this.settings.delegate };
    // Set before createPoseDetector() runs: it reports its first message synchronously.
    const loadId = ++this.detectorLoadId;
    const onProgress = (message: string): void => {
      // An abandoned load keeps going in the background; its messages don't belong on screen.
      if (loadId === this.detectorLoadId) this.onDetectorProgress(message);
    };
    const promise: Promise<PoseDetector> = createPoseDetector(options, onProgress).then(
      (detector) => {
        if (this.pendingDetector?.promise !== promise) {
          detector.close(); // settings changed again while this one loaded
          throw new Error('Body tracking settings changed while loading. Tap Try again.');
        }
        this.pendingDetector = null;
        this.detector = detector;
        this.detectorKey = key;
        return detector;
      },
      (err: unknown) => {
        if (this.pendingDetector?.promise === promise) this.pendingDetector = null;
        throw err;
      },
    );
    this.pendingDetector = { key, promise };
    // Whoever awaits this reports failures; this just avoids an "unhandled rejection" if nobody does any more.
    promise.catch(() => {});
    return promise;
  }

  private closeDetector(): void {
    const old = this.detector;
    this.detector = null;
    this.detectorKey = '';
    this.pendingDetector = null; // a load still in flight closes itself when it finishes
    this.detectorLoadId++; // ...and its progress messages are ignored from now on
    if (!old) return;
    try {
      old.close();
    } catch (err) {
      logError('pose detector', err);
    }
  }

  /** Progress text while loading; later messages (e.g. "restarting…") appear as a toast. */
  private onDetectorProgress(message: string): void {
    if (!this.loadingOverlay.hidden) {
      // Keep an error message readable: ignore progress from a load still finishing in the background.
      if (this.loadingErr.hidden) setText(this.loadingSub, message);
    } else if (this.screen === 'stage' && this.source.kind !== 'demo') {
      this.showToast(message);
    }
  }

  // =========================================================================
  // The frame loop
  // =========================================================================

  /** Starts delivering frames: the video frame loop, or the demo's clock. Never runs two at once. */
  private startLoop(): void {
    this.stopLoop();
    if (this.source.kind === 'demo') {
      if (!this.demoManual) this.demo?.play();
      return;
    }
    try {
      this.stopFrames = startFrameLoop(this.video, (nowMs) => this.onCameraFrame(nowMs));
    } catch (err) {
      logError('frame loop', err);
    }
  }

  private stopLoop(): void {
    this.stopFrames?.();
    this.stopFrames = null;
    this.demo?.pause();
  }

  /** Runs once per new video frame while a camera screen is showing. */
  private onCameraFrame(nowMs: number): void {
    const detector = this.detector;
    if (!detector) return; // e.g. switching models

    let detection: PoseDetection;
    try {
      detection = detector.detect(this.video, nowMs);
    } catch (err) {
      logError('pose detector', err); // grouped (×N) if it repeats every frame
      return;
    }
    const landmarks = detection.landmarks;
    let figure: Figure | null = null;
    try {
      figure = landmarks ? figureFromLandmarks(landmarks, detection.frame.aspect) : null;
    } catch (err) {
      logError('figure', err);
    }
    const lw = landmarks?.[15];
    const rw = landmarks?.[16];
    this.processFrame(
      {
        frame: detection.frame,
        figure,
        sourceW: this.video.videoWidth,
        sourceH: this.video.videoHeight,
        inferenceMs: detection.inferenceMs,
        luminance: this.sampleLuminance(nowMs),
        wristConfidence: lw && rw ? [lw.visibility, rw.visibility] : null,
        model: detector.model,
        delegate: detector.delegate,
      },
      nowMs,
    );
  }

  /**
   * One simulated frame from the demo. Its timestamp doubles as "now" for
   * the UI's timers (cues, debug refresh), so stepping the demo faster than
   * real time (dev hook) still shows every cue for the right number of frames.
   */
  private onDemoFrame(frame: PoseFrame): void {
    const geometry = this.demoSession?.geometry;
    let figure: Figure | null = null;
    try {
      figure = figureFromPoseFrame(frame);
    } catch (err) {
      logError('figure', err);
    }
    const lw = frame.joints?.leftWrist;
    const rw = frame.joints?.rightWrist;
    this.processFrame(
      {
        frame,
        figure,
        sourceW: geometry?.imageW ?? 0,
        sourceH: geometry?.imageH ?? 0,
        inferenceMs: 0,
        luminance: null, // the fake picture is never too dark
        wristConfidence: lw && rw ? [lw.c, rw.c] : null,
        model: 'demo',
        delegate: 'simulated',
      },
      frame.t,
    );
  }

  /** The shared pipeline: counter → tracking issue → recorder → events → screens. */
  private processFrame(sf: SourceFrame, nowMs: number): void {
    let snap: CounterSnapshot;
    try {
      snap = this.counter.update(sf.frame);
    } catch (err) {
      logError('rep counter', err);
      return;
    }
    this.lastSnap = snap;

    this.measure(nowMs, sf.inferenceMs);
    this.issue = this.updateIssue(sf.frame.t, snap, sf.luminance);
    if (this.source.kind !== 'demo') {
      try {
        this.recorder.push(sf.frame, snap);
      } catch (err) {
        logError('recorder', err);
      }
    }
    // A bug in the UI code must reach the on-screen error badge (logError groups
    // repeats), not only the console, and must not stop the demo's clock.
    try {
      for (const ev of snap.events) this.handleEvent(ev, nowMs, snap, sf);
    } catch (err) {
      logError('frame', err);
    }
    // The set is done and the short pause has passed in frame time (the timer may not have fired yet).
    if (this.pendingSuccess && sf.frame.t >= this.pendingSuccess.at) this.showSuccess();
    // Completing the set may have ended the session.
    if (this.screen !== 'stage') return;
    try {
      this.render(snap, sf, nowMs);
    } catch (err) {
      logError('frame', err);
    }
  }

  private handleEvent(ev: CounterEvent, nowMs: number, snap: CounterSnapshot, sf: SourceFrame): void {
    this.debug.addEvent(ev);
    switch (ev.type) {
      case 'countdownTick':
        if (ev.secondsLeft > 0) this.say(String(ev.secondsLeft));
        break;
      case 'start':
        this.say('Go');
        this.challenge.setVoiceWord('Go');
        break;
      case 'depthReached':
        this.challenge.onDepthReached();
        break;
      case 'rep': {
        const word = spokenCount(ev.count);
        this.say(word);
        this.challenge.setVoiceWord(word);
        this.challenge.onRep();
        this.challenge.plusOne(this.plusOneAnchor(snap, sf));
        break;
      }
      case 'partial':
        this.challenge.onPartial(ev.peakDepth, nowMs);
        if (nowMs - this.lastLowerAt > LOWER_REPEAT_MS) {
          this.lastLowerAt = nowMs;
          this.say('Lower');
          this.challenge.setVoiceWord('Lower');
        }
        break;
      case 'paused':
        this.challenge.onPaused(ev.reason);
        break;
      case 'complete':
        this.scheduleSuccess(ev.count, ev.elapsedMs, ev.t);
        break;
      default:
        break;
    }
  }

  /** Just above the head (or the shoulders) on screen: where the "+1" pops up. */
  private plusOneAnchor(snap: CounterSnapshot, sf: SourceFrame): { x: number; y: number } | null {
    const f = snap.features;
    const base = f.noseVisible && f.nose ? f.nose : f.shoulderMid;
    if (!base) return null;
    const lift = (f.shoulderWidth ?? 0.2) * 0.9;
    return this.overlay.clientPoint(base.x, base.y - lift, sf.frame.aspect);
  }

  private render(snap: CounterSnapshot, sf: SourceFrame, nowMs: number): void {
    // The counter's phase decides the screen: Placement until the set starts, then Challenge.
    const layer: Layer = snap.phase === 'waiting' || snap.phase === 'countdown' ? 'placement' : 'challenge';
    this.setLayer(layer);
    if (layer === 'placement') this.placement.render(snap);
    else this.challenge.render(snap, this.tuning.downThreshold, nowMs);
    setHidden(this.darkOverlay, this.issue !== 'tooDark');

    const style: SkeletonStyle =
      this.issue === 'tooDark' ? 'faint' : layer === 'challenge' && this.challenge.isWarning(nowMs) ? 'warn' : 'normal';
    const debugOn = this.settings.debug;
    // "A rep counts when your chest crosses this line" — always on during the set (hidden while paused:
    // the user isn't there to see it, and the ghost outline takes over).
    const depthLine: DepthLine | null =
      layer === 'challenge' && snap.phase !== 'paused' && snap.depthLineY !== null
        ? { y: snap.depthLineY, state: this.challenge.depthLineState(nowMs) }
        : null;
    try {
      this.overlay.draw(sf.figure, sf.sourceW, sf.sourceH, {
        style,
        byConfidence: debugOn,
        depthLine,
        guide: debugOn && layer === 'challenge' ? debugGuide(snap) : null,
        mirrored: this.source.kind === 'camera',
        silhouette: this.source.kind === 'demo',
      });
    } catch (err) {
      logError('overlay', err);
    }

    if (!debugOn) return;
    this.debug.frame({
      nowMs,
      fps: this.fps,
      inferenceMs: this.inferenceMs,
      model: sf.model,
      delegate: sf.delegate,
      source: this.source.kind,
      videoW: sf.sourceW,
      videoH: sf.sourceH,
      snap,
      issue: this.issue,
      luminance: sf.luminance,
      wristConfidence: sf.wristConfidence,
      tuning: this.tuning,
    });
    const slow = this.fpsWindows >= 3 && this.fps > 0 && this.fps < LOW_FPS;
    this.debug.setLiteSuggestion(slow && this.source.kind !== 'demo' && sf.model !== 'lite');
    this.debug.setRecordingText(this.recordingText());
  }

  private setLayer(layer: Layer | null): void {
    if (layer === this.layer) return;
    this.layer = layer;
    setHidden(this.placementLayer, layer !== 'placement');
    setHidden(this.challengeLayer, layer !== 'challenge');
  }

  /** The video's CSS object-fit (cover on phones, contain on wide screens); the overlay must match it. */
  private videoFit(): FitMode {
    try {
      return getComputedStyle(this.video).objectFit === 'contain' ? 'contain' : 'cover';
    } catch {
      return 'cover';
    }
  }

  private measure(nowMs: number, inferenceMs: number): void {
    // Smoothed inference time (EMA) so the number is readable.
    this.inferenceMs = this.inferenceMs === 0 ? inferenceMs : this.inferenceMs * 0.9 + inferenceMs * 0.1;
    this.fpsFrames += 1;
    if (this.fpsWindowStart === 0) this.fpsWindowStart = nowMs;
    const elapsed = nowMs - this.fpsWindowStart;
    if (elapsed >= 1000) {
      this.fps = (this.fpsFrames * 1000) / elapsed;
      this.fpsFrames = 0;
      this.fpsWindowStart = nowMs;
      this.fpsWindows += 1;
    }
  }

  private resetFrameStats(): void {
    this.fps = 0;
    this.fpsFrames = 0;
    this.fpsWindowStart = 0;
    this.fpsWindows = 0;
    this.inferenceMs = 0;
    this.lumaAt = -Infinity;
    this.luma = null;
  }

  private sampleLuminance(nowMs: number): number | null {
    if (this.luminance && nowMs - this.lumaAt >= LUMA_EVERY_MS) {
      this.lumaAt = nowMs;
      try {
        this.luma = this.luminance.sample(this.video);
      } catch (err) {
        this.luma = null;
        logError('luminance', err);
      }
    }
    return this.luma;
  }

  private updateIssue(t: number, snap: CounterSnapshot, luminance: number | null): TrackingIssue {
    try {
      return this.tracking.update({
        t,
        present: snap.features.present,
        inFrame: snap.inFrame,
        shoulderConfidence: snap.features.shoulderConfidence,
        luminance,
      });
    } catch (err) {
      logError('tracking issue', err);
      return 'none';
    }
  }

  // =========================================================================
  // Ending a set
  // =========================================================================

  /**
   * The target was reached: show Success after a short pause. Whichever comes
   * first wins: the timer (real time) or a frame SUCCESS_DELAY_MS later
   * (frame time, which is what the demo's dev hook advances).
   */
  private scheduleSuccess(count: number, elapsedMs: number, t: number): void {
    if (this.pendingSuccess) return;
    this.pendingSuccess = { at: t + SUCCESS_DELAY_MS, count, elapsedMs };
    const run = this.runId;
    window.clearTimeout(this.successTimer);
    this.successTimer = window.setTimeout(() => {
      this.successTimer = 0;
      if (run === this.runId) this.showSuccess();
    }, SUCCESS_DELAY_MS);
  }

  private showSuccess(): void {
    const done = this.pendingSuccess;
    if (!done || this.screen !== 'stage') return;
    this.pendingSuccess = null;
    setText(byId('succ-stats'), `${done.count} push-ups · ${formatElapsed(done.elapsedMs)}`);
    this.leaveStage('success');
    this.say('Scroll earned');
  }

  private giveUp(): void {
    this.cancelSpeech();
    this.leaveStage('gaveup');
  }

  private goHome(): void {
    this.cancelSpeech();
    this.leaveStage('start');
    this.renderStartScreen();
  }

  /** Ends the camera session and shows another screen. */
  private leaveStage(next: ScreenId): void {
    this.stopSession();
    this.releaseWakeLock();
    this.screen = next;
    showScreen(next);
    this.updateSaveButtons();
  }

  private releaseWakeLock(): void {
    try {
      this.wakeLock.release().catch((err: unknown) => logError('wake lock', err));
    } catch (err) {
      logError('wake lock', err);
    }
  }

  /** Stops the loop, camera, demo and recorder and resets the stage. Safe to call twice. */
  private stopSession(): void {
    this.runId += 1;
    window.clearTimeout(this.successTimer);
    this.successTimer = 0;
    this.pendingSuccess = null;
    this.lastSnap = null; // so __demo.state() doesn't report the previous set while the next one loads
    this.stopLoop();
    this.demo?.stop();
    this.demo = null;
    this.demoSession = null;
    this.demoManual = false;
    this.stopMedia();
    this.stopRecorder();
    this.suspended = false;
    this.restarting = false; // a restart still in flight sees the new runId and backs off
    this.setStarted = false;
    this.overlay.clear();
    this.setLayer(null);
    this.hideLoading();
    setHidden(this.resumeOverlay, true);
    setHidden(this.darkOverlay, true);
    setHidden(this.toast, true);
  }

  private stopMedia(): void {
    const media = this.media;
    this.media = null;
    if (!media) return;
    try {
      media.stop();
    } catch (err) {
      logError('camera', err);
    }
  }

  // =========================================================================
  // Screen lock / app switch
  // =========================================================================

  private onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      if (this.screen === 'stage' && (this.media || this.demo)) this.suspend();
      return;
    }
    // Not while a restart is already running, or while "Tap to resume" shows
    // (the automatic restart failed once; the tap is the way back).
    if (this.screen === 'stage' && this.suspended && !this.restarting && this.resumeOverlay.hidden) {
      void this.resumeAfterVisible();
    }
  }

  /** Page hidden (screen locked, app switched): stop the loop and camera, keep the count. */
  private suspend(): void {
    this.stopLoop();
    this.stopMedia();
    this.suspended = true;
    this.cancelSpeech();
  }

  /** Back from the background: try to restart the camera without a tap. */
  private async resumeAfterVisible(): Promise<void> {
    if (this.source.kind === 'demo') {
      // Nothing to restart: the demo simply carries on where it paused.
      this.suspended = false;
      this.resetFrameStats();
      this.startLoop();
      return;
    }
    const run = this.runId;
    this.restarting = true;
    this.showLoading('Restarting camera…');
    const result = await this.openMedia(this.source);
    if (run === this.runId) this.restarting = false;
    if (run !== this.runId || !this.suspended || document.visibilityState === 'hidden') {
      if (result.ok) result.session.stop();
      return;
    }
    if (!result.ok) {
      // iOS often needs a fresh tap to turn the camera back on.
      this.hideLoading();
      setHidden(this.resumeOverlay, false);
      return;
    }
    this.resumeWith(result.session);
  }

  /** "Tap to resume": a real user gesture, so speech, wake lock and camera are allowed again. */
  private resumeFromGesture(): void {
    if (this.restarting) return; // one camera start at a time (a second one would stop the first)
    this.unlockFromGesture();
    setHidden(this.resumeOverlay, true);
    const run = this.runId;
    this.restarting = true;
    this.showLoading('Restarting camera…');
    void this.openMedia(this.source).then((result) => {
      if (run !== this.runId) {
        if (result.ok) result.session.stop();
        return;
      }
      this.restarting = false;
      if (!result.ok) {
        if (this.source.kind === 'camera') this.showCameraError(result.error, result.message);
        else this.showLoadError("Couldn't play that video", result.message);
        return;
      }
      if (document.visibilityState === 'hidden') {
        // Switched away while it started: stay suspended; coming back restarts it.
        result.session.stop();
        return;
      }
      this.resumeWith(result.session);
    });
  }

  private resumeWith(session: MediaSession): void {
    this.media = session;
    this.suspended = false;
    setHidden(this.resumeOverlay, true);
    this.resetFrameStats();
    if (!this.setStarted) {
      // Left during the first load: body tracking is still loading, and
      // finishStart() starts the set (and the loop) when it's ready.
      this.showLoading('Loading body tracking…');
      return;
    }
    // Switching to Lite was interrupted: keep the spinner until the new model is ready.
    if (this.detector) this.hideLoading();
    else this.showLoading('Loading body tracking…');
    this.startLoop();
  }

  // =========================================================================
  // Loading / errors / toasts
  // =========================================================================

  private showLoading(message: string): void {
    setHidden(this.loadingOverlay, false);
    setHidden(this.loadingSpin, false);
    setHidden(this.loadingErr, true);
    setText(this.loadingMsg, message);
  }

  private hideLoading(): void {
    setHidden(this.loadingOverlay, true);
    setText(this.loadingSub, '');
  }

  private showLoadError(title: string, err: unknown): void {
    this.stopLoop();
    this.stopMedia(); // "Try again" starts everything fresh
    this.suspended = false; // ...so coming back to the page must not restart the camera over this message
    setHidden(this.resumeOverlay, true);
    setHidden(this.loadingOverlay, false);
    setHidden(this.loadingSpin, true);
    setHidden(this.loadingErr, false);
    setText(this.loadingMsg, title);
    setText(this.loadingSub, '');
    setText(this.loadingErrText, typeof err === 'string' ? err : errorText(err));
    if (typeof err !== 'string') logError('loading', err);
  }

  /** Spec S1 and friends: a full screen explaining how to get the camera working. */
  private showCameraError(kind: CameraErrorKind, message: string): void {
    const copy = cameraErrorCopy(kind, this.device);
    setText(byId('camerr-title'), copy.title);
    setText(byId('camerr-body'), copy.body);
    byId('camerr-steps').replaceChildren(
      ...copy.steps.map((step) => {
        const li = document.createElement('li');
        li.textContent = step;
        return li;
      }),
    );
    const note = byId('camerr-note');
    setText(note, copy.note);
    setHidden(note, !copy.note);
    // The steps above already cover the known cases; the raw message only adds something for odd failures.
    setText(byId('camerr-detail'), kind === 'unknown' ? message : '');
    this.leaveStage('camerror');
  }

  private showToast(message: string): void {
    setText(this.toast, message);
    setHidden(this.toast, false);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => setHidden(this.toast, true), TOAST_MS);
  }

  // =========================================================================
  // Settings
  // =========================================================================

  private onSettingsChange(next: AppSettings, key: keyof AppSettings): void {
    const previous = this.settings;
    this.settings = next;
    saveSettings(next);
    if (key === 'depth' && next.depth !== previous.depth) {
      // A new preset replaces any slider tweaks.
      this.tuning = tuningFor(next.depth);
      this.debug.setTuning(this.tuning);
    }
    if (key === 'speak') {
      this.speaker.enabled = next.speak;
      this.challenge.setVoiceOn(this.voiceEnabled());
      if (!next.speak) this.cancelSpeech();
    }
    if (key === 'debug') this.debug.setVisible(next.debug && this.screen === 'stage');
    this.renderStartScreen();
  }

  /** Debug sliders moved: update the counter live, without losing the count. */
  private applyTuning(tuning: Tuning): void {
    this.tuning = tuning;
    try {
      this.counter.setConfig(tuning);
    } catch (err) {
      logError('rep counter', err);
    }
  }

  /** "Slow · switch to Lite": swap the model mid-set; the count and calibration are kept. */
  private switchToLite(): void {
    if (this.source.kind === 'demo') return; // the demo has no model
    this.onSettingsChange({ ...this.settings, model: 'lite' }, 'model');
    this.settingsForm?.refresh(this.settings);
    this.debug.setLiteSuggestion(false);
    const run = this.runId;
    // The loop keeps running but skips frames while there is no detector.
    this.closeDetector();
    this.overlay.clear();
    this.showLoading('Switching to Lite…');
    this.ensureDetector().then(
      () => {
        if (run !== this.runId) return;
        // While suspended, "Restarting camera…" (or "Tap to resume") stays up.
        if (!this.suspended) this.hideLoading();
        this.resetFrameStats();
      },
      (err: unknown) => {
        if (run === this.runId) this.showLoadError("Body tracking didn't start", err);
      },
    );
  }

  private renderStartScreen(): void {
    setText(byId('hero-reps'), String(this.settings.reps));
    const hasCameraApi = typeof navigator.mediaDevices?.getUserMedia === 'function';
    const desktop = this.device === 'desktop';
    const banner = byId('env-banner');
    if (!window.isSecureContext) {
      setText(
        byId('env-banner-text'),
        desktop
          ? 'Open http://localhost:5173 (npm run dev:laptop) — the camera only works on localhost or https'
          : 'Open the https:// address — the camera only works on https',
      );
      setHidden(banner, false);
    } else if (!hasCameraApi) {
      setText(
        byId('env-banner-text'),
        desktop
          ? "This browser can't use the camera. Open the page in Chrome or Edge."
          : "This browser can't use the camera. Open the page in Safari (iOS 16.4+).",
      );
      setHidden(banner, false);
    } else {
      setHidden(banner, true);
    }
    const ok = (b: boolean): string => (b ? '✓' : '✗');
    setText(
      byId('env-line'),
      `${this.device} · secure ${ok(window.isSecureContext)} · camera ${ok(hasCameraApi)} · speech ${ok(this.speaker.supported)} · wake lock ${ok(this.wakeLock.supported)}`,
    );
    this.updateSaveButtons();
  }

  // =========================================================================
  // Speech
  // =========================================================================

  private voiceEnabled(): boolean {
    return this.settings.speak && this.speaker.supported;
  }

  private say(text: string): void {
    if (!this.settings.speak) return;
    try {
      this.speaker.say(text);
    } catch (err) {
      logError('speech', err);
    }
  }

  private cancelSpeech(): void {
    try {
      this.speaker.cancel();
    } catch (err) {
      logError('speech', err);
    }
  }

  // =========================================================================
  // Landmark recording (debug)
  // =========================================================================

  private startRecorder(): void {
    const source = this.source;
    // The demo is simulated: there is nothing real to record.
    if (!this.settings.record || !this.detector || source.kind === 'demo') return;
    let config: CounterConfig;
    try {
      config = this.counter.config;
    } catch {
      config = { ...DEFAULT_CONFIG, ...counterConfigFor(this.settings, this.tuning) };
    }
    try {
      this.recorder.start({
        source: source.kind,
        model: this.detector.model,
        delegate: this.detector.delegate,
        config,
      });
    } catch (err) {
      logError('recorder', err);
    }
  }

  private stopRecorder(): void {
    try {
      if (!this.recorder.recording) return;
      const rec = this.recorder.stop();
      if (rec && rec.frames.length > 0) this.lastRecording = rec;
    } catch (err) {
      logError('recorder', err);
    }
  }

  private recordingText(): string {
    if (this.source.kind === 'demo') return 'off (the demo is simulated)';
    if (this.recorder.recording) return `● recording · ${this.recorder.frameCount} frames`;
    if (!this.settings.record) return 'off (Settings › Record landmarks)';
    return 'on — starts with the next set';
  }

  private updateSaveButtons(): void {
    const rec = this.lastRecording;
    for (const id of ['btn-save-start', 'btn-save-succ', 'btn-save-gaveup']) {
      const button = byId(id);
      setHidden(button, !rec);
      const label = button.querySelector('span');
      if (rec && label) setText(label, `Save recording (${rec.frames.length} frames)`);
    }
  }

  private saveLastRecording(): void {
    const rec = this.lastRecording;
    if (!rec) return;
    try {
      saveRecording(rec).catch((err: unknown) => {
        // Closing the iPhone share sheet without choosing anything is not an error.
        if (!(err instanceof Error && err.name === 'AbortError')) logError('save recording', err);
      });
    } catch (err) {
      logError('save recording', err);
    }
  }

  // =========================================================================
  // Dev-only demo hook (installed by main.ts on the dev server)
  // =========================================================================

  /** window.__demo: run the demo frame by frame from automated checks or the console (see demo/devHook.ts). */
  demoHook(): DemoHook {
    return {
      start: () => {
        this.beginSet({ kind: 'demo' });
        this.demoManual = true;
        this.demo?.pause();
        return this.demoState();
      },
      step: (n = 1) => {
        const demo = this.demo;
        if (demo && this.screen === 'stage') {
          this.demoManual = true;
          demo.pause();
          demo.step(n);
        }
        return this.demoState();
      },
      state: () => this.demoState(),
    };
  }

  private demoState(): DemoState {
    const snap = this.screen === 'stage' ? this.lastSnap : null;
    return {
      screen: this.screen,
      layer: this.layer,
      phase: snap?.phase ?? null,
      count: snap?.count ?? 0,
      target: this.settings.reps,
      hint: snap?.hint ?? null,
      issue: this.issue,
      depthLineY: snap?.depthLineY ?? null,
      frame: this.demo?.position ?? null,
      frames: this.demo?.total ?? null,
    };
  }
}

/** Creates a platform service, falling back to a stand-in (and logging why) if it throws. */
function safeCreate<T>(name: string, create: () => T, fallback: T): T {
  try {
    return create();
  } catch (err) {
    logError(name, err);
    return fallback;
  }
}

/** "Seven" for the voice and the chip; digits if the word table fails. */
function spokenCount(n: number): string {
  try {
    return countWord(n);
  } catch {
    return String(n);
  }
}

/**
 * Debug-only extras around the depth line: the hand level the shoulders sink
 * toward, and the current shoulder height (this frame's raw values, so they
 * wobble a little more than the counter's smoothed depth line).
 */
function debugGuide(snap: CounterSnapshot): DepthGuide | null {
  const f = snap.features;
  if (!f.wristMid) return null;
  return { wristY: f.wristMid.y, shoulderY: f.shoulderMid?.y ?? null };
}
