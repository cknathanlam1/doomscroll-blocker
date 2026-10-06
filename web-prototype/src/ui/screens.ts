/**
 * Screen switching. The whole prototype is one page: each screen is a
 * <section> in index.html that is shown or hidden. (No URL routing on
 * purpose: iOS Safari can reload a camera page on history changes.)
 */
import { byId } from './dom';

export type ScreenId = 'start' | 'stage' | 'success' | 'gaveup' | 'camerror';

const SECTION_IDS: Record<ScreenId, string> = {
  start: 'screen-start',
  stage: 'screen-stage',
  success: 'screen-success',
  gaveup: 'screen-gaveup',
  camerror: 'screen-camerror',
};

/** Browser chrome colour per screen, so the iPhone status area matches the page. */
const THEME_COLORS: Record<ScreenId, string> = {
  start: '#0B0B0D',
  stage: '#000000',
  success: '#FFD43B',
  gaveup: '#0B0B0D',
  camerror: '#0B0B0D',
};

/** Shows one screen and hides the rest. */
export function showScreen(id: ScreenId): void {
  for (const [key, sectionId] of Object.entries(SECTION_IDS)) {
    byId(sectionId).hidden = key !== id;
  }
  document.body.dataset.screen = id;
  // The camera screens must not scroll (the phone is on the floor).
  document.body.classList.toggle('on-stage', id === 'stage');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[id]);
  if (id !== 'stage') window.scrollTo(0, 0);
}
