import { cn } from '@/lib/cn';

/**
 * The people on a trip, as overlapping initials.
 *
 * Initials rather than photographs: the product has never asked anyone for a
 * picture, and a generated face would be a picture of somebody who does not
 * exist standing in for somebody who does. The names are in the accessible
 * text in full, so the discs are decoration.
 */

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

export function MemberAvatars({
  names,
  max = 4,
  size = 'md',
  className,
}: {
  names: readonly string[];
  max?: number;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  const disc =
    size === 'sm'
      ? 'size-7 text-[0.6875rem] -ml-2 first:ml-0'
      : 'size-9 text-xs -ml-2.5 first:ml-0';

  return (
    <div className={cn('flex items-center', className)}>
      <span className="sr-only">
        {names.length === 1 ? 'Travelling: ' : `${names.length} people: `}
        {names.join(', ')}
      </span>
      <span aria-hidden="true" className="flex items-center">
        {shown.map((name, index) => (
          <span
            key={`${name}-${index}`}
            className={cn(
              'bg-surface-sunken text-ink border-bg grid shrink-0 place-items-center rounded-full border-2 font-medium tracking-wide',
              disc,
            )}
          >
            {initialsOf(name)}
          </span>
        ))}
        {rest > 0 ? (
          <span
            className={cn(
              'bg-surface-raised text-ink-muted border-bg grid shrink-0 place-items-center rounded-full border-2 font-medium tabular-nums',
              disc,
            )}
          >
            +{rest}
          </span>
        ) : null}
      </span>
    </div>
  );
}
