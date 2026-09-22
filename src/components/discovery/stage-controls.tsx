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
    <div className="flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
      <nav aria-label="Rank by" className="flex min-w-0 items-center gap-2">
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
        <ul className="-mx-1 flex [scrollbar-width:none] gap-1.5 overflow-x-auto [mask-image:linear-gradient(to_right,black_94%,transparent)] px-1 py-1">
          {MAP_MODES.map((option) => (
            <li key={option} className="shrink-0">
              <a
                href={modeHref(option)}
                aria-current={option === mode ? 'true' : undefined}
                className={[
                  'ease-standard duration-quick inline-flex rounded-[--radius-pill] px-3 py-1.5 text-[13px] transition-colors',
                  'focus-visible:outline-accent-ink',
                  option === mode ? 'voyagr-cta font-medium' : 'text-muted hover:text-text',
                ].join(' ')}
              >
                {MAP_MODE_LABELS[option]}
              </a>
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
        className="stage-scope border-hairline bg-panel flex h-[38px] shrink-0 items-center rounded-[--radius-pill] border pl-3 text-[13px]"
      >
        {Object.entries(carry).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}

        <Icon name="pin" size={1} className="text-muted size-[15px]" aria-hidden="true" />

        <label htmlFor="stage-country" className="sr-only">
          Explore a country
        </label>
        <select
          id="stage-country"
          name="country"
          defaultValue={selected?.adm0 ?? ''}
          className="text-text focus-visible:outline-accent-ink max-w-[11rem] min-w-0 border-0 bg-transparent px-2 py-1 text-[13px] focus:outline-none"
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

        <button
          type="submit"
          className="border-hairline text-muted hover:text-text ease-standard duration-quick focus-visible:outline-accent-ink h-full rounded-r-[--radius-pill] border-l px-3.5 text-[13px] font-medium transition-colors"
        >
          Go
        </button>
      </form>
    </div>
  );
}
