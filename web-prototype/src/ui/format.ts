/** Text formatting shared by the screens and the debug view. */

/** "38 sec", "1 min 05 sec". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} sec`;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min} min ${String(sec).padStart(2, '0')} sec`;
}

/** Fixed-point number, or an en dash when the value is unknown. */
export function fixed(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '–' : value.toFixed(digits);
}

/** Readable text for anything thrown (Error, DOMException, string, …). */
export function errorText(err: unknown): string {
  if (err instanceof Error) {
    if (!err.message) return err.name;
    // A plain Error's name adds nothing; keep names like "NotAllowedError" that explain the cause.
    return err.name === 'Error' ? err.message : `${err.name}: ${err.message}`;
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}
