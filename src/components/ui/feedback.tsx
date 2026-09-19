import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Loading, empty and error states.
 *
 * The three screens a product spends most of its life showing and least of its
 * design effort on. They are here, in the design system, because a loading
 * state invented per feature is how a product ends up with four spinners.
 */

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** What is loading. Announced once, rather than per shimmering block. */
  label?: string;
}

/**
 * A placeholder for content that is on its way.
 *
 * Silent to assistive technology by default: a screen reader user gains
 * nothing from twelve grey rectangles. The surrounding region announces the
 * wait once, via `label`.
 */
export function Skeleton({ className, label, ...props }: SkeletonProps) {
  return (
    <div
      // `animate-pulse` is already neutralised by the reduced-motion rule in
      // the base layer, so nothing here has to opt out again.
      className={cn('bg-surface-sunken animate-pulse rounded-[--radius-control]', className)}
      aria-hidden={label ? undefined : true}
      {...(label ? { role: 'status', 'aria-label': label } : {})}
      {...props}
    />
  );
}

export interface EmptyStateProps {
  /** Decorative. Never the only way the state is communicated. */
  icon?: React.ReactNode;
  title: string;
  /** What happened, in plain words. */
  description: React.ReactNode;
  /** The thing to do next. An empty state without one is a dead end. */
  action?: React.ReactNode;
  /**
   * `error` when something failed, `empty` when nothing matched.
   *
   * Different states, and collapsing them tells a user their search was too
   * narrow when in fact a provider was down.
   */
  tone?: 'empty' | 'error';
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'empty',
  className,
}: EmptyStateProps) {
  return (
    <div
      // An error is announced; an empty result set is not, because the user
      // just asked for it and is already looking.
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'flex flex-col items-center gap-3 rounded-[--radius-surface] border px-6 py-12 text-center',
        tone === 'error'
          ? 'border-critical-500/30 bg-critical-500/5'
          : 'border-border bg-surface-sunken',
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="text-ink-muted text-3xl">
          {icon}
        </span>
      ) : null}

      <h3
        className={cn('text-lg font-semibold', tone === 'error' ? 'text-critical-ink' : 'text-ink')}
      >
        {title}
      </h3>

      <p className="text-ink-muted max-w-prose text-sm">{description}</p>

      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
