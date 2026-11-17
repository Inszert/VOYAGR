'use client';

import * as React from 'react';
import { Button } from '@/components/ui';

/**
 * Closes the "More options" fold it sits in and hands focus back to the button
 * that opened it, so a keyboard user is not left on a control that just
 * disappeared. The fields stay in the form either way: closing a `details`
 * hides them, it does not remove them, so nothing set inside is lost on submit.
 */
export function MoreOptionsDone() {
  const ref = React.useRef<HTMLButtonElement>(null);

  return (
    <Button
      ref={ref}
      type="button"
      variant="secondary"
      className="min-h-11 w-full sm:w-auto"
      onClick={() => {
        const details = ref.current?.closest('details');
        if (!details) return;
        details.open = false;
        details.querySelector('summary')?.focus();
      }}
    >
      Done
    </Button>
  );
}
