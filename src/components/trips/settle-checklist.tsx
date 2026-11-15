'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * "Settle up", as a list to tick off.
 *
 * Every transfer arrives already worked out by `src/core/expenses` and already
 * formatted: this component receives the sentence and the figure as text and
 * adds nothing up. A tick only records that the payment has been made; it
 * changes no balance and nothing on the server, so it is kept in this browser
 * alone and the page says so. A checkbox that looked like it settled the
 * ledger for everyone would be a claim nobody made.
 */

export interface SettleItem {
  /** Stable across renders for the same payment: who, to whom, how much, in what. */
  readonly key: string;
  readonly from: string;
  readonly to: string;
  /** Already formatted by `format(Money)`. */
  readonly amount: string;
}

const CHANGE_EVENT = 'voyagr:settled-change';

function subscribe(notify: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, notify);
  window.addEventListener('storage', notify);
  return () => {
    window.removeEventListener(CHANGE_EVENT, notify);
    window.removeEventListener('storage', notify);
  };
}

function readStored(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '[]';
  } catch {
    return '[]';
  }
}

function parseStored(raw: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function SettleChecklist({
  tripId,
  currency,
  items,
}: {
  tripId: string;
  currency: string;
  items: readonly SettleItem[];
}) {
  const storageKey = `voyagr:settled:${tripId}:${currency}`;

  // What this browser remembers, read as an external store: the server cannot
  // know it, so the first render is unticked and the client then catches up.
  const stored = React.useSyncExternalStore(
    subscribe,
    () => readStored(storageKey),
    () => '[]',
  );
  const done = React.useMemo(() => parseStored(stored), [stored]);

  const toggle = (key: string, checked: boolean) => {
    const next = new Set(done);
    if (checked) next.add(key);
    else next.delete(key);

    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      // Storage is blocked: nothing is remembered, and nothing pretends otherwise.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return (
    <ul aria-label={`Payments in ${currency}`} className="flex flex-col">
      {items.map((item) => {
        const id = `settle-${storageKey}-${item.key}`;
        const checked = done.has(item.key);

        return (
          <li key={item.key} className="border-border border-t first:border-t-0">
            <label
              htmlFor={id}
              className="flex min-h-14 cursor-pointer items-center gap-4 py-3 text-sm"
            >
              <input
                id={id}
                type="checkbox"
                checked={checked}
                onChange={(event) => toggle(item.key, event.target.checked)}
                className="border-border-strong accent-brand-500 size-5 shrink-0 rounded-(--radius-control)"
              />
              <span
                className={cn('text-ink min-w-0 flex-1', checked && 'text-ink-muted line-through')}
              >
                {item.from} pays {item.to}
              </span>
              <span
                className={cn(
                  'text-ink shrink-0 text-base font-medium tabular-nums',
                  checked && 'text-ink-muted',
                )}
              >
                {item.amount}
              </span>
              {checked ? <span className="text-positive-ink shrink-0 text-xs">Paid</span> : null}
            </label>
          </li>
        );
      })}
    </ul>
  );
}
