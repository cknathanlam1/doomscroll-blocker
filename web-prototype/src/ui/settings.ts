/**
 * Prototype settings: stored in localStorage, edited on the Start screen.
 */
import { DEFAULT_CONFIG, DEPTH_PRESETS } from '../core/repCounter';
import type { CounterConfig } from '../core/types';
import type { Delegate } from '../platform/poseDetector';
import { byId, setText } from './dom';

export type DepthPreset = keyof typeof DEPTH_PRESETS;
export type ModelChoice = 'lite' | 'full';
export type DelegateChoice = Delegate | 'auto';

export interface AppSettings {
  /** Reps per set (5–30, spec screen 9). */
  reps: number;
  depth: DepthPreset;
  model: ModelChoice;
  delegate: DelegateChoice;
  speak: boolean;
  debug: boolean;
  /** Record landmarks (never video) so a set can be saved and replayed offline. */
  record: boolean;
  /** Debug panel expanded (a per-phone convenience, not shown in the form). */
  debugOpen: boolean;
}

export const MIN_REPS = 5;
export const MAX_REPS = 30;

export const DEFAULT_SETTINGS: AppSettings = {
  reps: 10,
  depth: 'normal',
  model: 'full',
  delegate: 'auto',
  speak: true,
  debug: true, // on by default while this is a prototype
  record: false,
  debugOpen: false,
};

const STORAGE_KEY = 'pushup-test.settings.v1';

/** Reads saved settings; anything missing or invalid falls back to the default. */
export function loadSettings(): AppSettings {
  let raw: unknown = null;
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch {
    // Private mode / blocked storage / corrupt JSON: just use the defaults.
  }
  return sanitize(raw);
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode); settings then last for this visit only.
  }
}

function sanitize(raw: unknown): AppSettings {
  const s = { ...DEFAULT_SETTINGS };
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Record<string, unknown>;
  if (typeof r.reps === 'number' && Number.isFinite(r.reps)) s.reps = clampReps(r.reps);
  if (r.depth === 'lenient' || r.depth === 'normal' || r.depth === 'strict') s.depth = r.depth;
  if (r.model === 'lite' || r.model === 'full') s.model = r.model;
  if (r.delegate === 'auto' || r.delegate === 'GPU' || r.delegate === 'CPU') s.delegate = r.delegate;
  if (typeof r.speak === 'boolean') s.speak = r.speak;
  if (typeof r.debug === 'boolean') s.debug = r.debug;
  if (typeof r.record === 'boolean') s.record = r.record;
  if (typeof r.debugOpen === 'boolean') s.debugOpen = r.debugOpen;
  return s;
}

function clampReps(n: number): number {
  return Math.min(MAX_REPS, Math.max(MIN_REPS, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Depth thresholds (the three the debug sliders can change live)
// ---------------------------------------------------------------------------

export interface Tuning {
  downThreshold: number;
  upThreshold: number;
  partialMinDepth: number;
}

/** Thresholds for a depth preset; the other two come from the counter defaults. */
export function tuningFor(depth: DepthPreset): Tuning {
  return orderTuning(
    {
      downThreshold: DEPTH_PRESETS[depth],
      upThreshold: DEFAULT_CONFIG.upThreshold,
      partialMinDepth: DEFAULT_CONFIG.partialMinDepth,
    },
    'downThreshold',
  );
}

/**
 * The counter needs upThreshold < partialMinDepth < downThreshold. When one
 * slider moves past another, push the others out of the way (keeping the
 * one the user is dragging where they put it).
 */
export function orderTuning(t: Tuning, changed: keyof Tuning): Tuning {
  const gap = 0.01;
  let up = t.upThreshold;
  let mid = t.partialMinDepth;
  let down = t.downThreshold;
  if (changed === 'downThreshold') {
    mid = Math.min(mid, down - gap);
    up = Math.min(up, mid - gap);
  } else if (changed === 'upThreshold') {
    mid = Math.max(mid, up + gap);
    down = Math.max(down, mid + gap);
  } else {
    up = Math.min(up, mid - gap);
    down = Math.max(down, mid + gap);
  }
  return { downThreshold: round2(down), upThreshold: round2(Math.max(0, up)), partialMinDepth: round2(mid) };
}

/** The part of the counter config the prototype controls. */
export function counterConfigFor(settings: AppSettings, tuning: Tuning): Partial<CounterConfig> {
  return { targetReps: settings.reps, ...tuning };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// The settings card on the Start screen
// ---------------------------------------------------------------------------

export interface SettingsForm {
  /** Re-reads the controls from these settings (after a change made elsewhere). */
  refresh(settings: AppSettings): void;
}

/**
 * Wires the settings card in index.html. `onChange` gets the full new
 * settings and the key that changed; the caller saves and applies them.
 */
export function bindSettingsForm(
  initial: AppSettings,
  onChange: (next: AppSettings, key: keyof AppSettings) => void,
): SettingsForm {
  const root = byId('settings');
  const repsOut = byId('set-reps');
  let current = initial;

  const update = (patch: Partial<AppSettings>, key: keyof AppSettings): void => {
    current = { ...current, ...patch };
    refresh(current);
    onChange(current, key);
  };

  // Reps stepper.
  const stepButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-step]'));
  for (const button of stepButtons) {
    button.addEventListener('click', () => {
      const step = Number(button.dataset.step) || 0;
      update({ reps: clampReps(current.reps + step) }, 'reps');
    });
  }

  // Segmented controls: <div class="seg" data-setting="depth"><button data-value="normal">…
  const segs = Array.from(root.querySelectorAll<HTMLElement>('.seg[data-setting]'));
  for (const seg of segs) {
    seg.addEventListener('click', (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>('button[data-value]');
      const value = button?.dataset.value;
      const key = seg.dataset.setting;
      if (!value || !key) return;
      const next = sanitize({ ...current, [key]: value });
      update(next, key as keyof AppSettings);
    });
  }

  // Switches: <input type="checkbox" data-setting="speak">
  const toggles = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-setting]'));
  for (const input of toggles) {
    input.addEventListener('change', () => {
      const key = input.dataset.setting;
      if (key === 'speak' || key === 'debug' || key === 'record') update({ [key]: input.checked }, key);
    });
  }

  function refresh(s: AppSettings): void {
    current = s;
    setText(repsOut, String(s.reps));
    for (const button of stepButtons) {
      const step = Number(button.dataset.step) || 0;
      button.disabled = (step < 0 && s.reps <= MIN_REPS) || (step > 0 && s.reps >= MAX_REPS);
    }
    for (const seg of segs) {
      const value = String(s[seg.dataset.setting as keyof AppSettings]);
      for (const button of Array.from(seg.querySelectorAll<HTMLButtonElement>('button[data-value]'))) {
        button.setAttribute('aria-pressed', String(button.dataset.value === value));
      }
    }
    for (const input of toggles) {
      const key = input.dataset.setting as keyof AppSettings;
      input.checked = s[key] === true;
    }
  }

  refresh(current);
  return { refresh };
}
