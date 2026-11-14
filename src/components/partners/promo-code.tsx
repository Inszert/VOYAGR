'use client';

import * as React from 'react';
import { Button, Tag } from '@/components/ui';

/** How long "Copied" stays before the line goes quiet again. */
const CONFIRMATION_MS = 2500;

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * A promo code and a button that copies it.
 *
 * The code is real text on the page whatever happens to the button: where the
 * clipboard is unavailable (an insecure origin, a denied permission) the
 * result is said out loud and the code can still be selected by hand. The
 * live region is always in the document and only its text changes, because a
 * region inserted at the moment of the message is often not announced.
 */
export function PromoCode({ code }: { code: string }) {
  const [state, setState] = React.useState<CopyState>('idle');
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    let next: CopyState = 'failed';
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(code);
        next = 'copied';
      }
    } catch {
      next = 'failed';
    }

    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), CONFIRMATION_MS);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-ink-muted text-sm">Promo code</span>
      <Tag tone="brand" className="font-semibold tracking-wider break-all tabular-nums">
        {code}
      </Tag>
      <Button
        type="button"
        variant="secondary"
        size="md"
        onClick={copy}
        aria-label={`Copy code ${code}`}
        className="ease-standard duration-(--duration-quick) active:scale-[0.97] motion-reduce:active:scale-100"
      >
        Copy
      </Button>
      <span aria-live="polite" role="status" className="text-positive-ink text-sm">
        {state === 'copied'
          ? 'Copied'
          : state === 'failed'
            ? 'Could not copy. Select the code.'
            : ''}
      </span>
    </div>
  );
}
