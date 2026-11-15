import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Disclosure.
 *
 * Native `<details>`/`<summary>`, for the same reason `Select` is native: a
 * server-rendered results page must be readable and expandable before any
 * JavaScript loads. The browser supplies the expand/collapse behaviour, the
 * `aria-expanded` state and keyboard activation, and a printed or
 * find-in-page-searched document can reach the content inside.
 *
 * The one thing browsers do not supply is a visible focus ring on the summary
 * in every engine, so the global `:focus-visible` rule is applied explicitly.
 */

export interface DisclosureProps extends React.HTMLAttributes<HTMLDetailsElement> {
  /** The always-visible label that toggles the content. */
  summary: React.ReactNode;
  defaultOpen?: boolean;
}

export function Disclosure({
  summary,
  defaultOpen = false,
  className,
  children,
  ...props
}: DisclosureProps) {
  return (
    <details
      // Only ever set when open by default. A `false` here is still a prop React
      // owns, and a click that lands before hydration finishes was being undone by it.
      {...(defaultOpen ? { open: true } : {})}
      className={cn('border-border group rounded-(--radius-control) border', className)}
      {...props}
    >
      <summary
        className={cn(
          'text-ink flex cursor-pointer items-center justify-between gap-2 px-4 py-3',
          'text-sm font-medium select-none',
          'hover:bg-surface-sunken rounded-(--radius-control)',
        )}
      >
        {summary}
        {/*
          A caret is decoration: the open state is already announced by the
          browser through the summary's own semantics, so this is hidden rather
          than described.
        */}
        <span
          aria-hidden="true"
          className="text-ink-muted transition-transform group-open:rotate-90"
        >
          &rsaquo;
        </span>
      </summary>

      <div className="border-border border-t px-4 py-4">{children}</div>
    </details>
  );
}
