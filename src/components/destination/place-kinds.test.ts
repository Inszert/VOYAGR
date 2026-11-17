import { describe, expect, it } from 'vitest';
import { KIND_LABELS } from '@/discovery/things-to-do';
import { KIND_WORDS } from './place-kinds';

describe('KIND_WORDS', () => {
  it('says the same as the server-side labels', () => {
    expect(KIND_WORDS).toEqual(KIND_LABELS);
  });

  it('has the Beaches group', () => {
    expect(KIND_WORDS.beaches).toBe('Beaches');
  });
});
