export interface ScreenWakeLock {
  readonly supported: boolean;
  readonly active: boolean;
  /** Keeps the screen on; re-acquires automatically when the page becomes visible again. */
  acquire(): Promise<void>;
  release(): Promise<void>;
}

/**
 * Keeps the screen from dimming and locking while the phone sits on the floor
 * during a set (iOS 16.4+). Never throws: if the lock can't be taken (old iOS,
 * Home Screen web app before iOS 18.4, request refused) `active` stays false
 * and the UI can suggest raising Settings › Display & Brightness › Auto-Lock.
 *
 * The browser drops the lock whenever the page is hidden (app switch, screen
 * off); it is requested again when the page becomes visible, for as long as
 * acquire() is in effect. Call acquire() from the Start tap the first time:
 * WebKit wants a user gesture for the first request.
 */
export function createWakeLock(): ScreenWakeLock {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  let sentinel: WakeLockSentinel | null = null;
  let wanted = false;
  let pending: Promise<void> | null = null;
  let listening = false;

  const request = (): Promise<void> => {
    if (!supported || !wanted || document.visibilityState !== 'visible') return Promise.resolve();
    if (sentinel && !sentinel.released) return Promise.resolve();
    if (pending) return pending;
    pending = (async () => {
      try {
        // Called synchronously from acquire(), so it still counts as part of the tap.
        const lock = await navigator.wakeLock.request('screen');
        if (!wanted) {
          // release() was called while we were waiting.
          await lock.release();
          return;
        }
        sentinel = lock;
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null;
        });
      } catch (err) {
        console.warn('[wakeLock] could not keep the screen on', err);
      } finally {
        pending = null;
      }
    })();
    return pending;
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible' && wanted) void request();
  };

  return {
    supported,
    get active(): boolean {
      return sentinel !== null && !sentinel.released;
    },
    acquire(): Promise<void> {
      wanted = true;
      if (supported && !listening) {
        document.addEventListener('visibilitychange', onVisibilityChange);
        listening = true;
      }
      return request();
    },
    async release(): Promise<void> {
      wanted = false;
      const lock = sentinel;
      sentinel = null;
      if (lock && !lock.released) {
        try {
          await lock.release();
        } catch (err) {
          console.warn('[wakeLock] release failed', err);
        }
      }
    },
  };
}
