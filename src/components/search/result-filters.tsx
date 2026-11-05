import { toMajor } from '@/core/money';
import { Button, Field, Select, ToggleChip } from '@/components/ui';
import { FILTER_KEYS, hasActiveFilters, type ResultFilters } from '@/search/filters';

/**
 * Narrowing the results (1.10.1 section 10).
 *
 * A GET form, like the search itself. Toggling a filter is a navigation, so it
 * works before JavaScript, the narrowed view is shareable, and the back button
 * undoes it. The search behind it comes from the page cache, so none of this
 * costs a provider call.
 *
 * The search's own fields ride along as hidden inputs, because a form submits
 * only what it contains and losing the search while narrowing it would be a
 * strange way to filter.
 *
 * **Only filters we can actually apply.** Section 10 also lists train, bus,
 * ferry and car; trip shapes like multi-city and open-jaw; and experience and
 * season categories. Every one of those needs data the product does not have -
 * ground-transport providers, a multi-leg trip type, a place catalogue,
 * seasonal intelligence. They are sections 15 to 22, and Phase 2/3. A control
 * that silently matched everything would be worse than an absent one.
 */

export interface ResultFiltersPanelProps {
  filters: ResultFilters;
  /** The search these filters narrow, carried through untouched. */
  searchValues: Readonly<Record<string, string | undefined>>;
  /** How many results the current filters removed. */
  hidden: number;
  currency: string;
  /** The page the results are on. */
  basePath?: string;
}

const DEPARTURE_OPTIONS = [
  { value: '', label: 'Any time' },
  { value: '6', label: 'After 06:00' },
  { value: '9', label: 'After 09:00' },
  { value: '12', label: 'After 12:00' },
];

const ARRIVAL_OPTIONS = [
  { value: '', label: 'Any time' },
  { value: '18', label: 'By 18:00' },
  { value: '21', label: 'By 21:00' },
  { value: '23', label: 'By 23:00' },
];

export function ResultFiltersPanel({
  filters,
  searchValues,
  hidden,
  currency,
  basePath = '/explore',
}: ResultFiltersPanelProps) {
  /*
   * The same search with every filter key dropped.
   *
   * Built from `FILTER_KEYS` rather than from a prefix, so a filter renamed
   * in `src/search/filters.ts` cannot quietly stop being clearable.
   */
  const clearHref = `${basePath}?${new URLSearchParams(
    Object.entries(searchValues).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && !isFilterKey(entry[0]),
    ),
  ).toString()}`;
  const active = hasActiveFilters(filters);

  return (
    /*
      A region, not a panel.

      This was a raised card the size of a result, which put a second large
      object between the dates and the trips and made narrowing look like as
      big a decision as choosing. Filters are a parameter surface: a hairline,
      a sunken ground and compact controls say so without shouting.
    */
    <section aria-labelledby="filters-heading" className="flex flex-col">
      <div className="flex flex-col gap-1">
        <h2 id="filters-heading" className="font-display text-ink text-xl">
          Narrow these results
        </h2>
        <p className={hidden > 0 ? 'text-tint-ink text-sm' : 'text-ink-muted text-sm'}>
          {hidden > 0
            ? `${hidden} ${hidden === 1 ? 'trip is' : 'trips are'} hidden by your filters`
            : 'Filters narrow what the search already found. They do not search again.'}
        </p>
      </div>

      <form method="get" action={basePath} className="mt-4 flex flex-col gap-5">
        {/*
          The search itself, carried along. A form submits what it contains,
          and losing the search while narrowing it would be a strange way to
          filter. Filter keys are excluded so the live controls below win.
        */}
        {Object.entries(searchValues)
          .filter(([key, value]) => typeof value === 'string' && !isFilterKey(key))
          .map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value as string} />
          ))}

        <fieldset className="flex flex-col gap-3">
          <legend className="text-dim mb-1 text-[11px] font-semibold tracking-[0.08em] uppercase">
            Flights
          </legend>

          <div className="flex flex-wrap gap-2">
            <ToggleChip name="fDirect" label="Direct only" defaultChecked={filters.directOnly} />
            <ToggleChip
              name="fNoSelfTransfer"
              label="One ticket throughout"
              defaultChecked={filters.excludeSelfTransfer}
            />
          </div>

          {/*
            Compact, because "Any time" does not need half the width of a
            result card to say so. A supporting control that is as large as
            the thing it supports is a control competing with it.
          */}
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Leaves"
              name="fDepartAfter"
              defaultValue={filters.departAfterHour === null ? '' : String(filters.departAfterHour)}
              options={DEPARTURE_OPTIONS}
              className="w-full"
            />
            <Select
              label="Lands"
              name="fArriveBefore"
              defaultValue={
                filters.arriveBeforeHour === null ? '' : String(filters.arriveBeforeHour)
              }
              options={ARRIVAL_OPTIONS}
              className="w-full"
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-dim mb-1 text-[11px] font-semibold tracking-[0.08em] uppercase">
            Stay and cost
          </legend>

          <div className="flex flex-wrap gap-2">
            <ToggleChip
              name="fFreeCancel"
              label="Free cancellation"
              defaultChecked={filters.freeCancellationOnly}
            />
            <ToggleChip
              name="fTransferPriced"
              label="Airport transfer priced"
              defaultChecked={filters.requirePricedTransfer}
            />
          </div>

          <div className="flex flex-col gap-3">
            <Field
              label={`Total at least (${currency})`}
              name="fMinTotal"
              type="number"
              min={1}
              step="1"
              defaultValue={filters.minTotal ? String(toMajor(filters.minTotal)) : ''}
              className="w-full"
            />
            <Field
              label={`Total no more than (${currency})`}
              name="fMaxTotal"
              type="number"
              min={1}
              step="1"
              defaultValue={filters.maxTotal ? String(toMajor(filters.maxTotal)) : ''}
              className="w-full"
            />
            <Field
              label="Hotel rated at least"
              name="fMinReview"
              type="number"
              min={0}
              max={10}
              step="0.1"
              defaultValue={filters.minReviewScore === null ? '' : String(filters.minReviewScore)}
              hint="Unrated hotels are hidden when this is set."
              className="w-full"
            />
          </div>
        </fieldset>

        {/*
          Secondary, deliberately.

          There is one primary action on a results page and it is on a trip.
          A filled accent button here is a second one, in a louder colour,
          attached to the least consequential decision on the page.
        */}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary" className="flex-1">
            Apply filters
          </Button>

          {active ? (
            // Only when there is something to clear. A permanently visible
            // "Clear" beside "Apply" is two commands where one applies.
            <Button asChild variant="ghost" size="sm">
              <a href={clearHref}>Clear filters</a>
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function isFilterKey(key: string): boolean {
  return (FILTER_KEYS as readonly string[]).includes(key);
}
