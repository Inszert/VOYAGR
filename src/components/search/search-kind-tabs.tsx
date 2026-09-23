import { cn } from '@/lib/cn';

/**
 * The first question: what are you actually looking for?
 *
 * Asked before any field is shown, because the fields differ and guessing
 * wrong wastes somebody's time. Hotels in particular must not be something
 * to discover later - a travel search that only offers flights until you
 * find a link is a flight search wearing a bigger name.
 *
 * Links rather than buttons, and one per URL. The choice is part of the
 * address, so it survives a reload, a bookmark and the back button, and it
 * works with no JavaScript - which is the same rule every other search
 * control here follows.
 */

export type SearchKind = 'flights' | 'stays' | 'both';

export const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  flights: 'Flights',
  stays: 'Hotels',
  both: 'Flights + Hotels',
};

const ICON: Record<SearchKind, string> = {
  flights: '✈️',
  stays: '🏨',
  both: '✈️🏨',
};

export interface SearchKindTabsProps {
  readonly active: SearchKind;
  /** Where each choice goes. */
  readonly hrefFor: (kind: SearchKind) => string;
  readonly className?: string;
}

export function SearchKindTabs({ active, hrefFor, className }: SearchKindTabsProps) {
  return (
    <nav aria-label="What are you looking for?" className={cn('flex flex-col gap-2', className)}>
      <p className="text-dim text-[11px] font-medium tracking-[0.08em] uppercase">
        What are you looking for?
      </p>

      <ul className="flex flex-wrap gap-2">
        {(Object.keys(SEARCH_KIND_LABEL) as SearchKind[]).map((kind) => {
          const current = kind === active;

          return (
            <li key={kind}>
              <a
                href={hrefFor(kind)}
                /*
                 * `aria-current` rather than a visual cue alone. Which tab is
                 * active must be available to a screen reader and must not
                 * depend on the border being visible.
                 */
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'border-hairline focus-visible:outline-accent-to inline-flex items-center gap-2 rounded-(--radius-pill) border px-3.5 py-2 text-sm transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2',
                  current
                    ? 'bg-panel-2 text-text border-(--color-accent-to) font-medium'
                    : 'text-muted hover:text-text',
                )}
              >
                <span aria-hidden="true">{ICON[kind]}</span>
                {SEARCH_KIND_LABEL[kind]}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
