import { cn } from '@/lib/cn';

/**
 * "Updated 12 min ago": how old the prices on a page are.
 *
 * Takes an age rather than a timestamp, so it reads no clock and renders the
 * same on the server and in a test. An age that is `null` is a price nobody
 * dated, and it is said that way - never rounded to "just now".
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function describeAge(ageMs: number | null): string {
  if (ageMs === null) return 'Update time unknown';

  // A negative age is clock skew; it is as fresh as anything gets.
  if (ageMs < MINUTE) return 'Updated just now';
  if (ageMs < HOUR) return `Updated ${Math.floor(ageMs / MINUTE)} min ago`;
  if (ageMs < DAY) return `Updated ${Math.floor(ageMs / HOUR)} h ago`;

  return `Updated ${Math.floor(ageMs / DAY)} d ago`;
}

export interface UpdatedAgoProps {
  ageMs: number | null;
  className?: string;
}

export function UpdatedAgo({ ageMs, className }: UpdatedAgoProps) {
  return (
    <p className={cn('text-ink-muted text-xs tabular-nums', className)}>{describeAge(ageMs)}</p>
  );
}
