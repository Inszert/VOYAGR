import Link from 'next/link';
import { Icon } from '@/components/ui';
import { COUNTRIES, type Country } from '@/discovery/countries';
import { MAP_MODES, MAP_MODE_LABELS, type MapMode } from '@/discovery/map-model';

/**
 * The two controls that steer the globe and the rail together.
 *
 * What to rank by, and where to look. They used to sit under the globe as a
 * fieldset and a form stacked on top of each other, which read as leftover
 * admin below the thing it controlled. They belong beside the list they
 * reorder, at the weight of a caption rather than a form.
 *
 * Both are still what they were: the ranking is a set of links, because
 * choosing one navigates and belongs in the URL, and the country is a GET
 * form, so it works before JavaScript and the back button undoes it. Only the
 * dressing changed.
 */

export interface StageControlsProps {
  mode: MapMode;
  modeHref: (mode: MapMode) => string;
  /** Where the country form submits. */
  action: '/' | '/explore';
  /** The current query, minus `country`, carried through as hidden inputs. */
  carry: Readonly<Record<string, string>>;
  counts: Readonly<Record<string, number>>;
  selected: Country | null;
}

export function StageControls({
  mode,
  modeHref,
  action,
  carry,
  counts,
  selected,
}: StageControlsProps) {
  return (
    /*
      `min-w-0`, because this is a flex item and a flex item does not shrink
      below its own content by default.

      The ranking row inside scrolls, so it is allowed to be narrow - but the
      permission has to reach it. Without this the whole group held itself at
      its widest content and pushed the page 23px wider than a 375px phone,
      which is a horizontal scrollbar on every mobile view of the front page.
    */
    <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-3">
      <nav aria-label="Rank by" className="flex max-w-full min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="text-dim hidden shrink-0 text-[11px] tracking-[0.16em] uppercase sm:inline"
        >
          Rank by
        </span>

        {/*
          Faded rather than cut at the right edge, so a row that scrolls looks
          like it scrolls instead of looking broken.
        */}
        <ul className="border-border bg-surface-sunken flex max-w-full [scrollbar-width:none] gap-0.5 overflow-x-auto rounded-(--radius-pill) border [mask-image:linear-gradient(to_right,black_calc(100%_-_1.5rem),transparent)] p-1 sm:[mask-image:none] [&::-webkit-scrollbar]:hidden">
          {MAP_MODES.map((option) => (
            <li key={option} className="shrink-0">
              <Link
                href={modeHref(option)}
                scroll={false}
                aria-current={option === mode ? 'true' : undefined}
                className={[
                  'ease-standard duration-quick inline-flex min-h-11 items-center rounded-(--radius-pill) px-4 text-[13px] whitespace-nowrap transition-colors sm:min-h-9 sm:px-3.5',
                  'focus-visible:outline-accent-ink',
                  option === mode
                    ? 'bg-surface-raised text-ink ring-border-strong font-medium ring-1 ring-inset'
                    : 'text-ink-muted hover:text-ink',
                ].join(' ')}
              >
                {MAP_MODE_LABELS[option]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/*
        One row: the label is the select's own, visually hidden, because
        "Explore a country" beside a list of countries is the list saying its
        own name twice. The button stays visible and named - a select that
        submits on change strands anyone tabbing through it.
      */}
      <form
        method="get"
        action={action}
        className="stage-scope border-border bg-panel has-[select:focus-visible]:outline-accent-ink flex h-11 shrink-0 items-center rounded-(--radius-pill) border pl-3.5 text-[13px] has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-2"
      >
        {Object.entries(carry).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}

        <Icon name="pin" size={1} className="text-muted size-[15px]" aria-hidden="true" />

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
            aria-hidden="true"
          />
        </span>

        <button
          type="submit"
          className="text-muted hover:text-text ease-standard duration-quick focus-visible:outline-accent-ink h-full min-w-11 rounded-r-(--radius-pill) px-3.5 text-[13px] font-medium transition-colors"
        >
          Go
        </button>
      </form>
    </div>
  );
}
