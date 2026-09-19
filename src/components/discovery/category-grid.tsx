import Link from 'next/link';
import { DISCOVERY_CATEGORIES, type CategoryId } from '@/discovery/categories';
import { categoryQuery } from '@/discovery/preset';

/**
 * The discovery grid (1.10.1 section 6).
 *
 * The homepage's answer to "where could I go?" for someone who does not yet
 * know. Each tile is an ordinary link to a search, so choosing one is a
 * navigation: it works before JavaScript, it can be shared, and the back
 * button undoes it.
 *
 * **No photographs, deliberately.** See `docs/imagery-options.md`: wiring an
 * imagery API to decorate eight fixture destinations would add a third party
 * to the render path, an attribution obligation and a rate limit, in order to
 * illustrate data that is not real. Typography, colour and scale carry it
 * instead — and a discovery surface that works without imagery only improves
 * when imagery arrives, where one that needs photographs to be legible was
 * never designed.
 */

/**
 * Each tile's wash.
 *
 * A gradient rather than a flat fill, so a grid of ten tiles has depth without
 * ten photographs. Colour never carries meaning here: every tile states its
 * own name and what it changes, and the wash is decoration.
 */
const WASH: Record<CategoryId, string> = {
  beach: 'from-brand-400/25 to-accent-300/25',
  'city-break': 'from-brand-600/25 to-brand-300/20',
  'food-and-wine': 'from-accent-500/25 to-critical-500/15',
  culture: 'from-brand-700/25 to-accent-300/20',
  nightlife: 'from-brand-800/30 to-brand-500/20',
  adventure: 'from-positive-500/25 to-brand-400/20',
  mountains: 'from-brand-300/25 to-surface-sunken',
  'warm-escape': 'from-accent-500/30 to-caution-500/20',
  budget: 'from-positive-500/20 to-brand-300/15',
  luxury: 'from-brand-900/30 to-accent-700/20',
};

export interface CategoryGridProps {
  /** Today, so a seasonal category points at the next occurrence. */
  today: string;
  /** The traveller's own defaults, which a category may not override. */
  defaults?: Readonly<Record<string, string>>;
}

export function CategoryGrid({ today, defaults }: CategoryGridProps) {
  return (
    <section aria-labelledby="discovery-heading" className="flex flex-col gap-5">
      <div className="max-w-2xl">
        <h2 id="discovery-heading" className="text-ink font-display text-display-sm">
          Not sure where yet?
        </h2>
        <p className="text-ink-muted mt-2">
          Pick the kind of trip. Each one changes how every result is ranked — not which
          destinations exist, but which of them actually suit you.
        </p>
      </div>

      {/*
        A list, because it is one: ten sibling choices. A grid of bare links
        tells a screen reader nothing about how many there are or where they end.
      */}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DISCOVERY_CATEGORIES.map((category) => (
          <li key={category.id}>
            <Link
              href={`/?${categoryQuery({ category, today, defaults })}`}
              className={`border-border group relative flex h-full flex-col justify-end gap-1 overflow-hidden rounded-[--radius-surface] border bg-gradient-to-br p-5 ${WASH[category.id]} ease-standard duration-settled hover:shadow-floating transition-[box-shadow,transform] hover:-translate-y-0.5 motion-reduce:hover:translate-y-0`}
            >
              <span className="text-ink font-display text-xl">{category.title}</span>
              <span className="text-ink-muted text-sm">{category.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
