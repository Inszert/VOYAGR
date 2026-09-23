import { describe, expect, it } from 'vitest';
import { cn } from './cn';

/**
 * Class merging.
 *
 * Defended: our own display sizes are font sizes, so a colour beside one
 * never removes it - the bug that shrank a hotel's name on its colour band.
 */
describe('cn', () => {
  it('keeps a display size beside a text colour', () => {
    expect(cn('font-display text-display-md', 'text-white')).toBe(
      'font-display text-display-md text-white',
    );
  });

  it('still lets a later font size replace an earlier one', () => {
    expect(cn('text-display-sm', 'text-display-md')).toBe('text-display-md');
    expect(cn('text-lg', 'text-display-lg')).toBe('text-display-lg');
  });
});
