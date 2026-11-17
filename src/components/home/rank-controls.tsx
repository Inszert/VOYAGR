import Link from 'next/link';
import { Icon } from '@/components/ui';
import { cn } from '@/lib/cn';
import { COUNTRIES, type Country } from '@/discovery/countries';
import { MAP_MODES, MAP_MODE_LABELS, type MapMode } from '@/discovery/map-model';

/**
 * What to rank by and where to look, as one quiet row.
 *
 * Behaviour is exactly what it was: the ranking is a set of links, because
 * choosing one navigates and belongs in the URL; the region is a GET form, so
 * it works before JavaScript and the back button undoes it. Only the dressing
 * changed - a segmented control instead of a row of pills beside a form.
 *
 * The selected ranking is `aria-current`, and is also set apart by a boundary
 * and a heavier weight, so it is never colour alone. Every target is 44px on
 * a phone.
 */

export interface RankControlsProps {
  mode: MapMode;
  modeHref: (mode: MapMode) => string;
  /** The current query, minus `country`, carried through as hidden inputs. */
  carry: Readonly<Record<string, string>>;
  counts: Readonly<Record<string, number>>;
  selected: Country | null;
  className?: string;
}

export function RankControls({
  mode,
  modeHref,
  carry,
  counts,
  selected,
  className,
}: RankControlsProps) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-3', className)}>
      <nav aria-label="Rank by" className="max-w-full min-w-0">
        <ul className="border-border bg-surface-sunken flex max-w-full [scrollbar-width:none] gap-0.5 overflow-x-auto rounded-(--radius-pill) border [mask-image:linear-gradient(to_right,black_calc(100%_-_1.5rem),transparent)] p-1 sm:[mask-image:none] [&::-webkit-scrollbar]:hidden">
          {MAP_MODES.map((option) => {
            const current = option === mode;

            return (
              <li key={option} className="shrink-0">
                <Link
                  href={modeHref(option)}
                  scroll={false}
                  aria-current={current ? 'true' : undefined}
                  className={cn(
                    'ease-standard duration-quick inline-flex min-h-11 items-center rounded-(--radius-pill) px-4 text-[13px] whitespace-nowrap transition-colors sm:min-h-9 sm:px-3.5',
                    current
                      ? 'bg-surface-raised text-ink ring-border-strong font-medium ring-1 ring-inset'
                      : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {MAP_MODE_LABELS[option]}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/*
        The select's own label is visually hidden: "Explore a country" beside a
        list of countries is the list saying its own name twice. The button
        stays visible and named - a select that submits on change strands
        anyone tabbing through it.
      */}
      <form
        method="get"
        action="/"
        className="border-border bg-surface-sunken has-[select:focus-visible]:outline-brand-500 flex h-11 max-w-full min-w-0 shrink-0 items-center rounded-(--radius-pill) border pl-3.5 text-[13px] has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-2"
      >
        {Object.entries(carry).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}

        <Icon name="pin" size={1} className="text-ink-muted size-[15px] shrink-0" aria-hidden />

        <label htmlFor="stage-country" className="sr-only">
          Explore a country
        </label>
        {/* The chevron is drawn once, here; the select's own is switched off. */}
        <span className="relative flex min-w-0 items-center">
          <select
            id="stage-country"
            name="country"
            defaultValue={selected?.adm0 ?? ''}
            className="text-ink h-9 max-w-[10.5rem] min-w-0 cursor-pointer appearance-none rounded-none border-0 bg-transparent pr-7 pl-2 text-[13px] shadow-none focus:outline-none sm:max-w-[12rem]"
          >
            <option value="">The whole world</option>
            {COUNTRIES.map((country) => (
              <option key={country.adm0} value={country.adm0}>
                {counts[country.adm0]
                  ? `${country.name} · ${counts[country.adm0]} priced`
                  : country.name}
              </option>
            ))}
          </select>
          <Icon
            name="chevron-down"
            size={1}
            className="text-ink-muted pointer-events-none absolute right-2 size-[14px]"
            aria-hidden
          />
        </span>

        <button
          type="submit"
          className="border-border text-ink-muted hover:text-ink ease-standard duration-quick h-full min-w-11 rounded-r-(--radius-pill) border-l px-3.5 text-[13px] font-medium transition-colors"
        >
          Go
        </button>
      </form>
    </div>
  );
}
