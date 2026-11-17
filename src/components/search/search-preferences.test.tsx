// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREFERENCES_KEY, type PreferenceStorage } from '@/lib/preferences';

const replace = vi.fn();
let search = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams(search),
}));

import { SearchPreferences } from './search-preferences';

function fakeStorage(initial?: unknown): PreferenceStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(PREFERENCES_KEY, JSON.stringify(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const saved = {
  origins: ['AMS'],
  destinations: 'anywhere',
  passengers: 2,
  weights: {},
  filters: { fDirect: '1' },
};

beforeEach(() => {
  replace.mockReset();
  search = '';
});
afterEach(cleanup);

describe('SearchPreferences', () => {
  it('replaces an empty URL once from the stored choices', () => {
    const storage = fakeStorage(saved);
    const { rerender } = render(<SearchPreferences storage={storage} />);
    rerender(<SearchPreferences storage={storage} />);

    expect(replace).toHaveBeenCalledTimes(1);
    const [href, options] = replace.mock.calls[0]!;
    expect(href).toContain('/explore?');
    expect(href).toContain('origins=AMS');
    expect(href).toContain('fDirect=1');
    expect(href).not.toContain('departureDate');
    expect(options).toEqual({ scroll: false });
  });

  it('replaces nothing and saves when the URL has parameters', () => {
    search = 'origins=AMS&passengers=3&departureDate=2027-01-01&fDirect=1';
    const storage = fakeStorage();
    render(<SearchPreferences storage={storage} />);

    expect(replace).not.toHaveBeenCalled();
    const stored = JSON.parse(storage.data.get(PREFERENCES_KEY)!);
    expect(stored.origins).toEqual(['AMS']);
    expect(stored.passengers).toBe(3);
    expect(JSON.stringify(stored)).not.toContain('2027');
  });

  it('does nothing when the URL is empty and nothing is stored', () => {
    render(<SearchPreferences storage={fakeStorage()} />);
    expect(replace).not.toHaveBeenCalled();
  });

  it('renders and does not throw when storage is blocked', () => {
    const blocked: PreferenceStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    search = 'origins=AMS';
    render(<SearchPreferences storage={blocked} />);
    expect(screen.getByRole('button', { name: 'Forget my choices' })).toBeTruthy();
  });

  it('forget clears storage and removes the remembered parameters', async () => {
    search = 'origins=AMS&departureDate=2027-01-01&fDirect=1';
    const storage = fakeStorage(saved);
    render(<SearchPreferences storage={storage} />);

    await userEvent.click(screen.getByRole('button', { name: 'Forget my choices' }));

    expect(storage.data.has(PREFERENCES_KEY)).toBe(false);
    expect(replace).toHaveBeenLastCalledWith('/explore?departureDate=2027-01-01', {
      scroll: false,
    });
  });
});
