/**
 * On-screen error log.
 *
 * Safari's Web Inspector needs a Mac, so on a Windows + iPhone setup errors
 * would otherwise be invisible. Everything thrown and not caught (window
 * 'error' / 'unhandledrejection'), plus problems the app reports itself via
 * logError(), shows up as a red badge you can tap to read, copy or clear.
 * It works on every screen, independent of the Debug view setting.
 */
import { byId, setHidden, setText } from './dom';
import { errorText } from './format';

interface LoggedError {
  time: string;
  source: string;
  message: string;
  /** How many times this exact error happened (repeats are grouped, not listed). */
  count: number;
}

const MAX_ENTRIES = 40;
const entries: LoggedError[] = [];
let render: () => void = () => {};

/** The boot script in index.html buffers early errors here until we take over. */
type BootWindow = Window & { __bootErrors?: string[] | null };

/** Starts capturing uncaught errors. Call once, as early as possible. */
export function installErrorCapture(): void {
  window.addEventListener('error', (e) => {
    logError('uncaught', e.error ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    logError('promise', e.reason);
  });
  const boot = window as BootWindow;
  for (const message of boot.__bootErrors ?? []) logError('startup', message);
  boot.__bootErrors = null; // stop the boot script from buffering
}

/**
 * Records a problem. Identical errors are grouped (×N) so an error thrown on
 * every video frame can't flood the list or slow the page down.
 */
export function logError(source: string, err: unknown): void {
  const message = describe(err);
  const existing = entries.find((e) => e.source === source && e.message === message);
  if (existing) {
    existing.count += 1;
    existing.time = clockTime();
  } else {
    entries.unshift({ time: clockTime(), source, message, count: 1 });
    if (entries.length > MAX_ENTRIES) entries.pop();
    // Also print it once: Vite's forwardConsole shows it in the PC terminal.
    console.error(`[${source}]`, err);
  }
  render();
}

/** Connects the badge + panel in index.html. */
export function mountErrorLog(): void {
  const root = byId('errlog');
  const badge = byId<HTMLButtonElement>('errlog-badge');
  const countEl = byId('errlog-count');
  const panel = byId('errlog-panel');
  const list = byId<HTMLOListElement>('errlog-list');

  const setOpen = (open: boolean): void => {
    setHidden(panel, !open);
    badge.setAttribute('aria-expanded', String(open));
  };

  render = () => {
    const total = entries.reduce((sum, e) => sum + e.count, 0);
    setHidden(root, entries.length === 0);
    setText(countEl, `${total} ${total === 1 ? 'error' : 'errors'}`);
    if (panel.hidden) return; // only build the list while it's visible
    list.replaceChildren(
      ...entries.map((e) => {
        const li = document.createElement('li');
        const head = document.createElement('b');
        head.textContent = `${e.time} · ${e.source}${e.count > 1 ? ` ×${e.count}` : ''}`;
        li.append(head, document.createTextNode(`\n${e.message}`));
        return li;
      }),
    );
  };

  badge.addEventListener('click', () => {
    setOpen(panel.hidden !== false); // `hidden` can also be the string 'until-found'
    render();
  });
  byId('errlog-close').addEventListener('click', () => setOpen(false));
  byId('errlog-clear').addEventListener('click', () => {
    entries.length = 0;
    setOpen(false);
    render();
  });
  byId('errlog-copy').addEventListener('click', () => {
    const text = entries.map((e) => `${e.time} [${e.source}] ×${e.count}\n${e.message}`).join('\n\n');
    const header = `${navigator.userAgent}\n${location.href}\n\n`;
    navigator.clipboard?.writeText(header + text).catch(() => {
      // Clipboard can be blocked; the text is still on screen to screenshot.
    });
  });
  render();
}

/** Shows the full-screen "The app didn't start" box (index.html) with this error. */
export function showBootFailure(err: unknown): void {
  const box = document.getElementById('boot-fail');
  const text = document.getElementById('boot-fail-text');
  if (!box || !text) return;
  text.textContent = describe(err);
  box.hidden = false;
}

/** Error text plus the top of the stack (file:line), with the page origin trimmed. */
function describe(err: unknown): string {
  let text = errorText(err);
  if (err instanceof Error && err.stack) {
    // Chrome's stack starts with "Name: message"; Safari's is only frames ("fn@url:line:col").
    const frames = err.stack
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith(`${err.name}:`) && !(err.message && line.includes(err.message)))
      .slice(0, 3)
      .map((line) => line.replace(/^at\s+/, '').replace(location.origin, ''));
    if (frames.length) text += `\n  at ${frames.join('\n  at ')}`;
  }
  return text;
}

function clockTime(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}
