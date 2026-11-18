import { Icon, NumberStepperField, Select } from '@/components/ui';
import type { FormReader } from '@/components/search/search-form';
import { AirportInput } from '@/components/search/airport-input';
import { FlexibleDateRange } from '@/components/search/flexible-date-range';
import { AnywhereButton } from '@/components/search/anywhere-button';
import { SwapEndpoints } from '@/components/discovery/swap-endpoints';
import type { AirportSuggestion } from '@/search/destination-names';
import { WORLD_REGIONS } from '@/search/world-region-list';

/**
 * The questions of a search, once.
 *
 * Discover's panel and the explorer ask the same things - From, To (and
 * Anywhere), the dates with every way of widening them, the month and trip
 * length of a month search, and how many are going - so they are one component
 * and cannot drift. Each form wraps these in its own `<form>` and adds its own
 * button; what it submits is the same set of names either way.
 */

export { monthOptions } from './month-options';

export const TRIP_NIGHTS = Array.from({ length: 20 }, (_, index) => ({
  value: String(index + 2),
  label: `${index + 2} nights`,
}));

/** The Trip length select that "Anytime that month" asks for; the month is chosen in the calendar. */
export function MonthFields({ tripNights }: { tripNights?: string | undefined }) {
  return (
    <>
      <Select
        label="Trip length"
        name="tripNights"
        defaultValue={tripNights ?? ''}
        options={[{ value: '', label: 'Not set' }, ...TRIP_NIGHTS]}
        bare
      />
    </>
  );
}

/**
 * A cell in the field group.
 *
 * `rule` draws the hairline that stands between this cell and the one before
 * it: down its left edge once the row is side by side, across its top while
 * the cells are stacked. A border on a cell rather than a gap in a grid,
 * because a gap needs a container showing through it and that container was
 * the thing reading as a box.
 */
function Cell({
  children,
  rule = true,
  className = '',
  stacked,
}: {
  children: React.ReactNode;
  rule?: boolean;
  className?: string;
  stacked: boolean;
}) {
  const line = !rule
    ? ''
    : stacked
      ? 'border-hairline border-t'
      : 'border-hairline border-t sm:border-t-0 sm:border-l';
  return <div className={`min-w-0 px-2.5 py-2.5 ${line} ${className}`}>{children}</div>;
}

export interface SearchFieldGroupProps {
  form: FormReader;
  errors?: Readonly<Record<string, string | undefined>>;
  airports: readonly AirportSuggestion[];
  today: string;
  destinationsHint: string;
  /** The search as submitted, for the month and trip length. */
  values: Readonly<Record<string, string | undefined>>;
  /**
   * One column, for a narrow column of the page. The default is Discover's
   * three across; the questions and their names are the same.
   */
  stacked?: boolean;
  /** What "To" shows when it is empty. Not a value: an empty field is anywhere. */
  destinationsPlaceholder?: string;
  /** Whether an empty "To" is refused. Where the placeholder is Anywhere, it is not. */
  destinationsRequired?: boolean;
  /** Whether the two dates are required while they are in use. */
  datesRequired?: boolean;
  /** The destination field's value, when it is not what the form would read. */
  destinationsValue?: string;
}

export function SearchFieldGroup({
  form,
  errors = {},
  airports,
  today,
  destinationsHint,
  values,
  stacked = false,
  destinationsPlaceholder,
  destinationsRequired = true,
  datesRequired = false,
  destinationsValue,
}: SearchFieldGroupProps) {
  return (
    <div className="bg-field rounded-[14px]">
      <div
        className={`relative grid ${stacked ? '' : 'sm:grid-cols-[2fr_2fr_1.4fr]'}`}
        data-search-fields={stacked ? 'stacked' : 'row'}
      >
        <Cell rule={false} stacked={stacked}>
          <AirportInput
            label="From"
            name="origins"
            defaultValue={form.value('origins')}
            hint="Type a code or a city."
            error={errors.origins}
            airports={airports}
            bare
            required
          />
        </Cell>

        {/*
          Extra left padding, because the swap control is centred on the rule
          to this cell's left and reaches fifteen pixels into it.
        */}
        <Cell stacked={stacked} className={stacked ? '' : 'sm:pl-6'}>
          <AirportInput
            label="To"
            name="destinations"
            defaultValue={destinationsValue ?? form.value('destinations')}
            {...(destinationsPlaceholder ? { placeholder: destinationsPlaceholder } : {})}
            hint={destinationsHint}
            error={errors.destinations}
            airports={airports}
            bare
            required={destinationsRequired}
          />
        </Cell>

        {/*
          "Anywhere" is a real answer to "where to?": the word expands to every
          destination we can actually price, so it is a promise we can keep.
          Regions open over the form rather than inside it.
        */}
        <div
          className={`border-hairline flex items-center gap-3 border-t px-2.5 py-2 ${
            stacked ? '' : 'sm:col-start-2 sm:border-t-0 sm:pl-6'
          }`}
        >
          <AnywhereButton targetName="destinations" />
          <details className="group relative">
            <summary className="border-hairline text-ink-muted hover:border-border-strong hover:text-ink focus-visible:outline-accent-to ease-standard duration-quick inline-flex cursor-pointer list-none items-center gap-1.5 rounded-(--radius-pill) border px-3 py-1.5 text-xs font-medium transition-colors select-none focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
              Regions
              <Icon
                name="chevron-down"
                size={0.8}
                className="transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="voyagr-popover absolute top-full left-0 z-20 mt-2 grid w-64 grid-cols-2 gap-1.5 p-2.5">
              {WORLD_REGIONS.map((region) => (
                <AnywhereButton
                  key={region.id}
                  targetName="destinations"
                  value={region.id}
                  label={region.label}
                  className="text-left"
                />
              ))}
            </div>
          </details>
        </div>

        <Cell stacked={stacked}>
          <NumberStepperField
            label="Travellers"
            name="passengers"
            min={1}
            max={9}
            defaultValue={form.value('passengers')}
            error={errors.passengers}
            bare
            required
          />
        </Cell>

        {stacked ? null : (
          /*
           * 2fr of 5.4fr: the swap control is centred on the rule between From
           * and To - recompute this if the ratio changes.
           */
          <SwapEndpoints
            from="origins"
            to="destinations"
            className="bg-field border-hairline text-muted hover:text-text focus-visible:outline-accent-ink ease-standard duration-quick absolute top-1/2 left-[37%] z-10 hidden size-[30px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border transition-colors sm:grid"
          />
        )}
      </div>

      {/*
        "Anytime that month" swaps the two dates for a month and a trip length.
        Done with the browser's own `:has()` on the chosen option, so it needs
        no script and the form still works before JavaScript arrives. Both
        pairs are submitted either way; the server reads the month only when
        that preset is chosen.
      */}
      <div className="group border-hairline grid border-t">
        <Cell rule={false} stacked={stacked}>
          <FlexibleDateRange
            startLabel="Leaving"
            startName="departureDate"
            startValue={form.value('departureDate')}
            startError={errors.departureDate}
            endLabel="Back"
            endName="returnDate"
            endValue={form.value('returnDate')}
            endError={errors.returnDate}
            min={today}
            bare
            {...(datesRequired ? { required: true } : {})}
            flexibility={form.value('flexibility')}
            today={today}
            monthStart={values.monthStart}
            tripLength={form.value('tripLength')}
            tripDays={form.value('tripDays')}
            tripLengthError={errors.minNights ?? errors.maxNights}
          />
        </Cell>

        <Cell
          rule={false}
          stacked={stacked}
          className="hidden grid-cols-2 gap-2 group-has-[input[name=flexibility][value=month]:checked]:grid"
        >
          <MonthFields tripNights={values.tripNights} />
        </Cell>
      </div>
    </div>
  );
}
