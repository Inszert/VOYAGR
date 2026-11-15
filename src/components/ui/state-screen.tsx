import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * A whole-page state: offline, an error, a page that is not there.
 *
 * One illustration, one sentence, one action - and nothing else. The three
 * situations have the same shape on purpose, so the product fails the same way
 * wherever it does, and the person is never asked to read a paragraph to find
 * the button.
 *
 * The illustration is a line drawing in the page's own ink: a planet, the arc
 * of a route, and one mark that says which situation this is. Inline SVG, so
 * the offline page can draw it with no network at all. It is decoration; the
 * heading carries the meaning.
 */

export type StateScreenKind = 'offline' | 'error' | 'not-found';

function Illustration({ kind }: { kind: StateScreenKind }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 160 160"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      className="size-36 sm:size-40"
    >
      <circle cx="80" cy="84" r="52" className="text-border-strong" />
      <ellipse cx="80" cy="84" rx="22" ry="52" className="text-border" />
      <path d="M28 84h104M36 62h88M36 106h88" className="text-border" />
      {kind === 'offline' ? (
        <>
          <path d="M44 128 118 40" className="text-caution-ink" strokeWidth="2" />
          <circle cx="118" cy="40" r="3.5" className="text-caution-ink" fill="currentColor" />
        </>
      ) : null}
      {kind === 'not-found' ? (
        <>
          <path
            d="M30 40c18-22 54-30 84-12"
            strokeDasharray="3 5"
            className="text-brand-ink"
            strokeWidth="1.75"
          />
          <circle cx="114" cy="28" r="3.5" className="text-brand-ink" fill="currentColor" />
          <path d="M104 18l10 10-10 10" className="text-brand-ink" strokeWidth="1.75" />
        </>
      ) : null}
      {kind === 'error' ? (
        <>
          <path d="M80 62v26" className="text-critical-ink" strokeWidth="2.25" />
          <circle cx="80" cy="102" r="2.5" className="text-critical-ink" fill="currentColor" />
        </>
      ) : null}
    </svg>
  );
}

export function StateScreen({
  kind,
  title,
  description,
  action,
  footnote,
  className,
}: {
  kind: StateScreenKind;
  title: string;
  /** The one sentence. */
  description: React.ReactNode;
  /** The one action: a link or a button. */
  action: React.ReactNode;
  /** Something small and optional, such as an error reference. */
  footnote?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby="state-title"
      className={cn(
        'mx-auto flex min-h-[60svh] max-w-md flex-col items-center justify-center gap-5 py-10 text-center',
        className,
      )}
    >
      <Illustration kind={kind} />

      <h1
        id="state-title"
        className="font-display text-display-sm sm:text-display-md text-ink text-balance"
      >
        {title}
      </h1>

      <p className="text-ink-muted max-w-[44ch] text-[0.9375rem] leading-relaxed">{description}</p>

      <div className="mt-1">{action}</div>

      {footnote ? <p className="text-dim text-xs">{footnote}</p> : null}
    </section>
  );
}
