import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Badge.
 *
 * Used for cost confidence ("estimated") and alert severity. Two rules keep it
 * accessible:
 *  - Colour is never the only signal. Each tone ships with its own text, and the
 *    component refuses to render without children.
 *  - A badge that conveys status the surrounding text does not already carry
 *    takes `srPrefix`, so a screen reader hears "Cost confidence: estimated"
 *    rather than a bare word.
 */

export type BadgeTone = 'neutral' | 'brand' | 'positive' | 'caution' | 'critical';

/*
 * Each tone pairs a translucent tint with a scheme-aware ink token. The ink must
 * come from `--color-*-ink` rather than the colour ramp: a ramp value dark
 * enough for a light chip drops below 4.5:1 once the surface behind it is dark.
 */
const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-ink-muted border-border',
  brand: 'bg-brand-500/10 text-brand-ink border-brand-500/30',
  positive: 'bg-positive-500/10 text-positive-ink border-positive-500/30',
  caution: 'bg-caution-500/10 text-caution-ink border-caution-500/30',
  critical: 'bg-critical-500/10 text-critical-ink border-critical-500/30',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Announced before the badge text, for context colour alone would not give. */
  srPrefix?: string;
}

export function Badge({ className, tone = 'neutral', srPrefix, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {srPrefix ? <span className="sr-only">{srPrefix}: </span> : null}
      {children}
    </span>
  );
}
