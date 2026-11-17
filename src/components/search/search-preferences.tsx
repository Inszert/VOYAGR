'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  REMEMBERED_PARAMS,
  clearPreferences,
  paramsFromPreferences,
  preferencesFromParams,
  readPreferences,
  writePreferences,
  type PreferenceStorage,
} from '@/lib/preferences';

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Remembers the explore choices in this browser, and restores them on a bare visit.
 *
 * Restores once, only when the address carries no search parameters at all; saves whenever the
 * parameters change; and offers one button to forget it all. The dates are never kept.
 */
export function SearchPreferences({ storage }: { storage?: PreferenceStorage | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const restored = useRef(false);
  const query = searchParams.toString();

  useEffect(() => {
    const store = storage === undefined ? browserStorage() : storage;

    if (!restored.current) {
      restored.current = true;
      if (query === '') {
        const saved = readPreferences(store);
        if (saved) {
          router.replace(`${pathname}?${paramsFromPreferences(saved).toString()}`, {
            scroll: false,
          });
          return;
        }
      }
    }

    const current = preferencesFromParams(new URLSearchParams(query));
    if (current) writePreferences(store, current);
  }, [query, pathname, router, storage]);

  function forget() {
    clearPreferences(storage === undefined ? browserStorage() : storage);
    const next = new URLSearchParams(query);
    for (const key of REMEMBERED_PARAMS) next.delete(key);
    const rest = next.toString();
    router.replace(rest ? `${pathname}?${rest}` : pathname, { scroll: false });
  }

  return (
    <button
      type="button"
      onClick={forget}
      className="text-tint-ink focus-visible:outline-tint-ink inline-flex min-h-11 w-fit items-center text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      Forget my choices
    </button>
  );
}
