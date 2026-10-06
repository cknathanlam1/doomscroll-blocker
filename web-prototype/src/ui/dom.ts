/**
 * Tiny DOM helpers. The camera screens update ~30 times a second, so these
 * only touch the page when a value actually changes (writing the same text
 * or style again still costs the browser work).
 */

/** Returns the element with this id, or throws a clear error if index.html is missing it. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`index.html is missing an element with id="${id}"`);
  return el as T;
}

/** Sets textContent only if it changed. */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Shows/hides with the `hidden` attribute, only if it changed. */
export function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

/** Restarts a one-shot CSS animation (e.g. the count "bump") by re-adding its class. */
export function restartAnimation(el: Element, className: string): void {
  el.classList.remove(className);
  // Reading a layout property forces the browser to notice the removal,
  // so adding the class again starts the animation from the beginning.
  void (el as HTMLElement).offsetWidth;
  el.classList.add(className);
}

/**
 * Calls `onResize(width, height)` with the element's CSS size now and
 * whenever it changes. Caching the size this way avoids reading clientWidth
 * every frame, which can force a slow synchronous layout.
 */
export function observeSize(el: HTMLElement, onResize: (width: number, height: number) => void): void {
  onResize(el.clientWidth, el.clientHeight);
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => onResize(el.clientWidth, el.clientHeight)).observe(el);
  } else {
    window.addEventListener('resize', () => onResize(el.clientWidth, el.clientHeight));
  }
}

/** Device pixel ratio, capped at 2: sharper than 2× isn't visible on a phone and costs fill rate. */
export function canvasDpr(): number {
  return Math.min(2, Math.max(1, window.devicePixelRatio || 1));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
