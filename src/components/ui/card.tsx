import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Card.
 *
 * A neutral container. It is deliberately a plain `<section>`-or-`<div>` with no
 * implicit heading level: a card in a grid of search results and a card holding
 * a page's only form belong at different levels of the document outline, so the
 * call site passes the right one.
 */

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Render as a `<section>` and label it. Use when the card is a landmark. */
  as?: 'div' | 'section' | 'article';
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, as: Component = 'div', ...props },
  ref,
) {
  return (
    <Component
      ref={ref}
      className={cn(
        'border-border bg-surface-raised rounded-[--radius-card] border p-5',
        className,
      )}
      {...props}
    />
  );
});

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex flex-col gap-1', className)} {...props} />;
}

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level. Chosen by the call site to keep the outline correct. */
  level?: 2 | 3 | 4;
}

export function CardTitle({ className, level = 3, ...props }: CardTitleProps) {
  const Heading = `h${level}` as const;
  return <Heading className={cn('text-ink text-lg font-semibold', className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-ink-muted text-sm', className)} {...props} />;
}
