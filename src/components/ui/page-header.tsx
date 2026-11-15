import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * The header every page of the product opens with.
 *
 * An eyebrow naming where you are, a display title, and one supporting line.
 * The same three on every surface is what makes a page read as part of the
 * site rather than a page that happens to be on it. The eyebrow is muted
 * rather than accented: the title is the loudest thing here.
 *
 * `level` is 1 for a page and 2 for a section that wants the same treatment;
 * a page has one `<h1>`.
 */

export interface PageHeaderProps {
  eyebrow?: string;
  title: React.ReactNode;
  /** One sentence, held to a 60-character measure. */
  description?: React.ReactNode;
  /** Controls that belong to the page as a whole, set on the right from `md`. */
  actions?: React.ReactNode;
  level?: 1 | 2;
  id?: string;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  level = 1,
  id,
  className,
}: PageHeaderProps) {
  const Heading = `h${level}` as 'h1';

  return (
    <header
      className={cn(
        'flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-10',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-dim text-[0.6875rem] font-medium tracking-[0.18em] uppercase">
            {eyebrow}
          </p>
        ) : null}

        <Heading
          id={id}
          className={cn(
            'font-display text-display-sm sm:text-display-md text-ink text-balance',
            eyebrow && 'mt-3',
          )}
        >
          {title}
        </Heading>

        {description ? (
          <p className="text-ink-muted mt-3 max-w-[60ch] text-[0.9375rem] leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>

      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
