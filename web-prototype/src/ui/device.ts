/**
 * Phone or computer? Only used to pick the right words ("prop the PHONE up"
 * vs "put your LAPTOP on the floor") and tips (the orientation lock is a
 * phone thing). Layout is decided by CSS from the screen shape, not by this.
 */

export type Device = 'phone' | 'desktop';

/**
 * 'desktop' when there's a mouse/trackpad as the main pointer and the
 * browser isn't a phone or tablet. iPads report a Mac user agent, so they
 * are caught by their touch screen instead.
 */
export function detectDevice(): Device {
  try {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return 'phone';
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'phone'; // iPad in desktop mode
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    return coarse ? 'phone' : 'desktop';
  } catch {
    return 'phone';
  }
}

/** Words that change with the device, for the screens built in TypeScript. */
export interface DeviceWords {
  /** "phone" / "laptop": the thing on the floor. */
  thing: string;
  /** What the user's head points at: "the phone" / "the screen". */
  target: string;
}

export function deviceWords(device: Device): DeviceWords {
  return device === 'desktop' ? { thing: 'laptop', target: 'the screen' } : { thing: 'phone', target: 'the phone' };
}
