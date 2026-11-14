'use client';

import * as React from 'react';
import { Toast as RadixToast } from 'radix-ui';

/**
 * A transient message, announced politely.
 *
 * For one thing only: telling someone that something arrived while the page is
 * open, such as a price-drop alert. Anything they must act on stays on the page
 * (the notification centre lists every alert), so a toast that times out
 * loses nothing. Radix owns the live region, the swipe and the pause on hover
 * and focus; the 8 seconds is long enough to read a sentence.
 */

export interface ToastProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** A link to what the message is about. */
  action?: { label: string; href: string };
}

export function Toast({ open, onOpenChange, title, description, action }: ToastProps) {
  return (
    <RadixToast.Provider swipeDirection="right" duration={8000} label="Notification">
      <RadixToast.Root
        open={open}
        onOpenChange={onOpenChange}
        className="voyagr-panel text-text flex flex-col gap-1 rounded-(--radius-shell) p-4 shadow-lg"
      >
        <RadixToast.Title className="text-sm font-semibold">{title}</RadixToast.Title>
        {description ? (
          <RadixToast.Description className="text-muted text-sm">
            {description}
          </RadixToast.Description>
        ) : null}
        <div className="mt-2 flex items-center gap-4 text-sm">
          {action ? (
            <RadixToast.Action asChild altText={action.label}>
              <a href={action.href} className="text-accent-ink underline underline-offset-4">
                {action.label}
              </a>
            </RadixToast.Action>
          ) : null}
          <RadixToast.Close className="text-muted hover:text-text min-h-[44px] min-w-[44px] underline underline-offset-4">
            Dismiss
          </RadixToast.Close>
        </div>
      </RadixToast.Root>
      <RadixToast.Viewport className="fixed right-4 bottom-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm list-none flex-col gap-2 outline-none" />
    </RadixToast.Provider>
  );
}
