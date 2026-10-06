/**
 * The paused screen (spec S2) names what is actually blocking the resume.
 * The counter only resumes once the plank check passes, and while paused it
 * reports why not (getInFrame / handsInView / moveCloser / moveBack).
 */
import { describe, expect, test } from 'vitest';
import { pausedCopy } from '../src/ui/challengeView';
import { HINT_COPY } from '../src/ui/placementView';

const words = { target: 'the phone', distance: 'Phone about 3 ft away' };
const oneLine = (title: string): string => title.replace('\n', ' ').toLowerCase();

describe('paused screen copy', () => {
  test('nobody in view → "Can\'t see you"', () => {
    expect(pausedCopy('getInFrame', 'lost', words).title).toBe("Can't\nsee you");
    expect(pausedCopy(null, 'lost', words).title).toBe("Can't\nsee you");
  });

  test('head and shoulders back but no hands → "Hands in view", not "Can\'t see you"', () => {
    // Regression: this showed "Can't see you / Head and shoulders in frame",
    // a fix the user had already done, and the set never resumed.
    const copy = pausedCopy('handsInView', 'lost', words);
    expect(oneLine(copy.title)).toBe(HINT_COPY.handsInView.toLowerCase());
    expect(copy.tip1).toMatch(/hands/i);
  });

  test('too far / too close → the Placement screen\'s words', () => {
    expect(oneLine(pausedCopy('moveCloser', 'lost', words).title)).toBe(HINT_COPY.moveCloser.toLowerCase());
    expect(oneLine(pausedCopy('moveBack', 'outOfPlank', words).title)).toBe(HINT_COPY.moveBack.toLowerCase());
  });

  test('in view but not in a plank → "Back to plank"', () => {
    expect(pausedCopy('backToPlank', 'lost', words).title).toBe('Back to\nplank');
    expect(pausedCopy('backToPlank', 'outOfPlank', words).title).toBe('Back to\nplank');
    expect(pausedCopy(null, 'outOfPlank', words).title).toBe('Back to\nplank');
  });
});
