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

/**
 * How far off the page a card sits.
 *
 * Four steps, not a free-form shadow. Elevation is a hierarchy - what is on
 * top of what - and a product where any component can invent its own depth has
 * no hierarchy, just a lot of shadows.
 */
export type CardElevation = 'flat' | 'raised' | 'floating' | 'lifted';

/** Which surface layer the card is painted on. */
export type CardSurface = 'raised' | 'sunken' | 'overlay';

const ELEVATION_CLASSES: Record<CardElevation, string> = {
  flat: '',
  raised: 'shadow-raised',
  floating: 'shadow-floating',
  lifted: 'shadow-lifted',
};

const SURFACE_CLASSES: Record<CardSurface, string> = {
  raised: 'bg-surface-raised',
  sunken: 'bg-surface-sunken',
  // Glass. The backdrop filter is progressive: where it is unsupported the
  // surface colour alone still meets contrast, so nothing becomes unreadable.
  overlay: 'bg-surface-overlay backdrop-blur-glass',
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Render as a `<section>` and label it. Use when the card is a landmark. */
  as?: 'div' | 'section' | 'article';
  elevation?: CardElevation;
  surface?: CardSurface;
  /** Editorial radius and padding, for a card that carries a page. */
  feature?: boolean;
  /** Lift on hover. Only for a card that is itself a link or a button. */
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    className,
    as: Component = 'div',
    elevation = 'flat',
    surface = 'raised',
    feature = false,
    interactive = false,
    ...props
  },
  ref,
) {
  return (
    <Component
      ref={ref}
      className={cn(
        'border-border border',
        feature ? 'rounded-[--radius-surface] p-7' : 'rounded-[--radius-card] p-5',
        SURFACE_CLASSES[surface],
        ELEVATION_CLASSES[elevation],
        interactive &&
          'ease-standard duration-settled hover:shadow-floating transition-[box-shadow,transform] hover:-translate-y-0.5 motion-reduce:hover:translate-y-0',
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
  /** Use the display face. For a heading that carries a page, not a section. */
  display?: boolean;
}

export function CardTitle({ className, level = 3, display, ...props }: CardTitleProps) {
  const Heading = `h${level}` as const;

  return (
    <Heading
      className={cn(
        'text-ink',
        display ? 'font-display text-display-sm' : 'text-lg font-semibold',
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-ink-muted text-sm', className)} {...props} />;
}
