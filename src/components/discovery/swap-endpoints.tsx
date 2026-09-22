'use client';

import * as React from 'react';
import { Icon } from '@/components/ui';

/**
 * Swap where you are leaving from and where you are going.
 *
 * The one piece of the search bar that cannot be markup. It reaches the two
 * fields through the form it is inside rather than through props, because the
 * fields generate their own ids and neither of them knows the other exists.
 *
 * Both endpoints are React-controlled inputs - they have to be, because the
 * airport suggestions read what is being typed - so assigning `.value` would
 * be overwritten by the next render. The native setter plus an `input` event
 * is what puts a value into a controlled input the way a person typing it
 * would, which is also what keeps the suggestion list honest afterwards.
 */

function write(input: HTMLInputElement, next: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

  setter?.call(input, next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export interface SwapEndpointsProps {
  /** The `name` of the field holding the origins. */
  from: string;
  /** The `name` of the field holding the destinations. */
  to: string;
  className?: string;
}

export function SwapEndpoints({ from, to, className }: SwapEndpointsProps) {
  const swap = (event: React.MouseEvent<HTMLButtonElement>) => {
    const form = event.currentTarget.form;
    if (!form) return;

    const origin = form.elements.namedItem(from);
    const destination = form.elements.namedItem(to);
    if (!(origin instanceof HTMLInputElement) || !(destination instanceof HTMLInputElement)) return;

    const carried = origin.value;
    write(origin, destination.value);
    write(destination, carried);
  };

  return (
    <button
      type="button"
      onClick={swap}
      className={className}
      title="Swap the two ends of the trip"
    >
      <Icon name="swap" size={0.95} className="rotate-90 sm:rotate-0" aria-hidden="true" />
      <span className="sr-only">Swap the origin and the destination</span>
    </button>
  );
}
