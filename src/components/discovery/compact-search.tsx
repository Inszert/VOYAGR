import Link from 'next/link';
import { Button, DateRangeField, Icon, NumberStepperField, Select } from '@/components/ui';
import {
  BudgetFields,
  ExactWindowFields,
  PreferenceFields,
  readForm,
  type SearchFormProps,
} from '@/components/search/search-form';
import { AirportInput } from '@/components/search/airport-input';
import { FlexibilityChips } from '@/components/search/flexibility-chips';
import { DISCOVERY_CATEGORIES } from '@/discovery/categories';
import { categoryQuery } from '@/discovery/preset';
import type { AirportSuggestion } from '@/search/destination-names';
import { LensSlider } from './lens-slider';
import { SearchKindTabs } from '@/components/search/search-kind-tabs';
import { AnywhereButton } from '@/components/search/anywhere-button';
import { WORLD_REGIONS } from '@/search/world-region-list';
import { SwapEndpoints } from './swap-endpoints';
import { shortDate } from '@/lib/display-date';

/**
 * The search, as it appears on the stage.
 *
 * One pane of glass holding three things: the lenses as a row of pills, one
 * inset field group, and the action hanging off its right-hand edge.
 *
 * **The panel has no internal grid.** It used to be a lattice - every cell
 * boxed, rules running in both directions - which read as a spreadsheet laid
 * over the planet. What separates one question from the next now is a single
 * hairline standing between them and nothing else: no cell borders, no box
 * around the group but its own rounded edge.
 *
 * It is the same GET form as the full one, submitting to the same URL with
 * the same field names, so a compact submit is a complete search: nothing is
 * defaulted out of sight, because the defaulted fields are on the page, just
 * folded. The lenses are ordinary links, so choosing one is a navigation that
 * works before JavaScript and that the back button undoes.
 */

export interface CompactSearchProps extends SearchFormProps {
  /** Where the form submits. The homepage and the explorer both run searches. */
  action?: '/' | '/explore';
  /**
   * The destinations to offer when the visitor has not typed any: the whole
   * catalogue, or the airports in the country selected on the globe.
   */
  destinationsDefault: string;
  /** What that default means, in words. */
  destinationsHint: string;
  /** Query parameters to carry through the submission, such as the selected country. */
  carry?: Readonly<Record<string, string>>;
  /** Every airport the catalogue knows, for the two fields that take one. */
  airports: readonly AirportSuggestion[];
  /** Today, so a date cannot be picked in the past. */
  today: string;
  /** The traveller's own defaults, which a lens may not override. */
  lensDefaults?: Readonly<Record<string, string>>;
  /**
   * The page the form is on, when that is not where it submits to. Choosing
   * between flights and the whole trip before searching stays here.
   */
  here?: '/' | '/explore';
  /**
   * `panel` is the full card; `bar` is the front page's one 64px glass bar,
   * pinned to the bottom of the hero, that expands in place. Same form, same
   * field names, same submission.
   */
  variant?: 'panel' | 'bar';
}

/**
 * A cell in the field group.
 *
 * `rule` draws the hairline that stands between this cell and the one before
 * it: down its left edge once the row is side by side, across its top while
 * the cells are stacked on a phone. A border on a cell rather than a gap in a
 * grid, because a gap needs a container showing through it and that container
 * was the thing reading as a box.
 */
function Cell({
  children,
  rule = true,
  className = '',
}: {
  children: React.ReactNode;
  rule?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 px-2.5 py-2.5 ${rule ? 'border-hairline border-t sm:border-t-0 sm:border-l' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * The next twelve months, for choosing "anytime that month".
 *
 * Counted as whole months from today's, so no date is ever built from a `Date`.
 * The current month starts today rather than on the 1st: a month that began
 * last week is not one a person can still leave in.
 */
function monthOptions(today: string): { value: string; label: string }[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;

  return Array.from({ length: 12 }, (_, offset) => {
    const index = month + offset;
    const y = year + Math.floor(index / 12);
    const m = index % 12;

    return {
      value: offset === 0 ? today : `${y}-${String(m + 1).padStart(2, '0')}-01`,
      label: `${MONTH_NAMES[m]} ${y}`,
    };
  });
}

const TRIP_NIGHTS = Array.from({ length: 20 }, (_, index) => ({
  value: String(index + 2),
  label: `${index + 2} nights`,
}));

export function CompactSearch({
  values,
  defaults = {},
  errors = {},
  action = '/',
  destinationsDefault,
  destinationsHint,
  carry = {},
  airports,
  today,
  lensDefaults,
  here = action,
  variant = 'panel',
}: CompactSearchProps) {
  const form = readForm(values, { ...defaults, destinations: destinationsDefault });
  // The whole trip unless flights alone were asked for: the unit is the trip.
  const view = values.view === 'flight' ? 'flight' : 'trip';
  const style = form.value('travelStyle');

  if (variant === 'bar') {
    return (
      <BarSearch
        values={values}
        errors={errors}
        action={action}
        destinationsHint={destinationsHint}
        carry={carry}
        airports={airports}
        today={today}
        lensDefaults={lensDefaults}
        here={here}
        defaults={defaults}
        form={form}
        view={view}
        style={style}
      />
    );
  }

  return (
    <section aria-labelledby="compact-search-heading" className="stage-scope">
      <h2 id="compact-search-heading" className="sr-only">
        Search for a trip
      </h2>

      {/*
        One pane. Its overflow is visible, because the action deliberately
        hangs off the right edge and a panel that clipped it would cut a
        button in half.
      */}
      <div className="voyagr-search flex flex-col gap-2.5 rounded-[20px] p-2.5">
        {/*
          The lenses, as one row of pills. Links, not tabs in the ARIA sense,
          because each one goes somewhere: it is a different search, not a
          different view of this one.

          Ten of them and room for about five, so the row scrolls - and says
          so, with a button at each end. A row that only faded out was a row
          whose fifth word dissolved, which reads as a rendering fault rather
          than as an invitation. See `LensSlider`.
        */}
        <nav aria-label="Kind of trip">
          <LensSlider>
            <ul className="flex gap-1.5 px-1 py-0.5">
              {DISCOVERY_CATEGORIES.map((category) => {
                const active = style === category.travelStyle;

                return (
                  <li key={category.id} className="shrink-0">
                    {/*
                      The description describes; it does not name. Folded into
                      the link's name it made every lens a sentence long, and
                      "Travel cheaply" answered to "Cheapest" beside the map's
                      own Cheapest ranking. It is the link's description now.
                    */}
                    <span id={`lens-${category.id}-description`} className="sr-only">
                      {category.description}
                    </span>
                    <Link
                      href={`${action}?${categoryQuery({ category, today, defaults: lensDefaults ?? defaults })}`}
                      aria-current={active ? 'true' : undefined}
                      aria-describedby={`lens-${category.id}-description`}
                      title={category.description}
                      className={[
                        'ease-standard duration-quick inline-flex items-center rounded-(--radius-pill) px-3.5 py-2 text-[13px] whitespace-nowrap transition-colors',
                        'focus-visible:outline-accent-ink',
                        active
                          ? 'bg-field border-hairline text-text border font-medium'
                          : 'text-muted hover:text-text border border-transparent',
                      ].join(' ')}
                    >
                      {category.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </LensSlider>
        </nav>

        {errors.form ? (
          <p role="alert" className="text-critical-ink px-2 text-[13px]">
            {errors.form}
          </p>
        ) : null}

        {/*
          The first question, asked before any field.

          Hotels must not be something to find later. These are links rather
          than a control, so the choice is part of the address and survives a
          reload, a bookmark and the back button - and works with no
          JavaScript, like every other search control here.
        */}
        {/*
          Flights, or the whole trip, is a way of *reading* the same search -
          which price leads each result - so both stay on this page and on the
          search, carried as `view`. A stay on its own is a different search
          with a different form, and only that one leaves for `/stays`.
        */}
        <SearchKindTabs
          active={view === 'flight' ? 'flights' : 'both'}
          hrefFor={(kind) => {
            if (kind === 'stays') return '/stays';
            const next = new URLSearchParams(
              Object.entries(values).filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === 'string' && entry[0] !== 'view',
              ),
            );
            next.set('view', kind === 'flights' ? 'flight' : 'trip');
            return `${values.origins ? action : here}?${next.toString()}`;
          }}
          className="px-2.5 pt-2.5"
        />

        <form method="get" action={action} className="flex flex-col gap-2.5">
          <input type="hidden" name="view" value={view} />
          {Object.entries(carry).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}

          {/*
            The field group, and the action beside it.

            The right-hand padding is what the button stands in: it is
            positioned rather than placed, so that it sits against the field
            group's own edge rather than in a cell of its own, and the group
            has to stop before it rather than run underneath it.

            It used to hang outside the panel. That is a real device and it is
            the wrong one here: the panel is glass over a planet, so a control
            crossing its edge does not read as deliberate overlap, it reads as
            a button that has escaped the box. It sits inside the padding now.
          */}
          <div className="relative sm:pr-[138px]">
            <div className="bg-field rounded-[14px]">
              {/*
                Two rows of three, on the same three columns.

                They used to be two rows on different columns - the endpoints
                sharing two thirds of the width and the dates splitting all of
                it - so no rule in the second row lined up with a rule in the
                first, and the group read as two controls stacked rather than
                as one. Three and three means every divider runs straight down.

                The swap sits on the rule between the first two, rather than in
                a cell of its own: it is not a seventh question, it is the join
                between two of them.
              */}
              <div className="relative grid sm:grid-cols-[2fr_2fr_1.4fr]">
                <Cell rule={false}>
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
                  Extra left padding, because the swap control is centred on
                  the rule to this cell's left and reaches fifteen pixels into
                  it. Without this the circle sits over the first letter of
                  whatever has been typed.
                */}
                <Cell className="sm:pl-6">
                  <AirportInput
                    label="To"
                    name="destinations"
                    defaultValue={form.value('destinations')}
                    hint={destinationsHint}
                    error={errors.destinations}
                    airports={airports}
                    bare
                    required
                  />
                </Cell>

                {/*
                  "Anywhere" is a real answer to "where to?".

                  A search that only accepts three-letter codes serves people
                  who already know where they are going, which is the
                  opposite of what this product is for. The word expands to
                  every destination we can actually price, so it is a promise
                  we can keep rather than a wildcard.

                  Its own row under "To" rather than stacked inside that
                  cell: the cell is for typing in, and two more controls
                  wedged under the input they were fighting for its width.
                  Regions open over the form rather than inside it, so seven
                  links do not push every field below further down the card.
                  Placed before Travellers in the markup so a phone, which
                  has no columns to place it into, still reads From, To,
                  Anywhere, Travellers in that order.
                */}
                <div className="border-hairline flex items-center gap-3 border-t px-2.5 py-2 sm:col-start-2 sm:border-t-0 sm:pl-6">
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

                {/*
                  A traveller count is two digits and a pair of arrows, not a
                  third of the bar - the column it sits in is its own fifth
                  rather than a third, so From and To keep the room that
                  holds real text.
                */}
                <Cell>
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

                {/*
                  2fr of 5.4fr: the swap control is centred on the rule
                  between From and To, wherever that lands for the ratio
                  above - recompute this if the ratio changes.
                */}
                <SwapEndpoints
                  from="origins"
                  to="destinations"
                  className="bg-field border-hairline text-muted hover:text-text focus-visible:outline-accent-ink ease-standard duration-quick absolute top-1/2 left-[37%] z-10 hidden size-[30px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border transition-colors sm:grid"
                />
              </div>

              {/*
                "Anytime that month" swaps the two dates for a month and a trip
                length. Done with the browser's own `:has()` on the chosen
                option, so it needs no script and the form still works before
                JavaScript arrives. Both pairs are submitted either way; the
                server reads the month only when that preset is chosen.
              */}
              <div className="group border-hairline grid border-t sm:grid-cols-3">
                {/*
                  The browser enforces the order. `min` on the departure stops
                  a trip being booked into the past and `min` on the return
                  stops one ending before it starts, both before a request is
                  made. The schema still checks on the server, because a
                  client-side constraint is a convenience and never a
                  guarantee.
                */}
                <Cell
                  rule={false}
                  className="group-has-[input[name=flexibility][value=month]:checked]:hidden sm:col-span-3"
                >
                  <DateRangeField
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
                  />
                </Cell>

                <Cell
                  rule={false}
                  className="hidden grid-cols-2 gap-2 group-has-[input[name=flexibility][value=month]:checked]:grid sm:col-span-3"
                >
                  <Select
                    label="Month"
                    name="monthStart"
                    defaultValue={values.monthStart ?? ''}
                    options={monthOptions(today)}
                    bare
                  />
                  <Select
                    label="Trip length"
                    name="tripNights"
                    defaultValue={values.tripNights ?? '7'}
                    options={TRIP_NIGHTS}
                    bare
                  />
                </Cell>

                {/*
                  How flexible the dates are, in view under them.

                  Every preset the search understands as a chip, not a
                  dropdown: "a weekend" and "anytime that month" are the first
                  thing somebody flexible decides, and a closed list hid them.
                */}
                <div className="border-hairline min-w-0 border-t px-2.5 py-2.5 sm:col-span-3">
                  <FlexibilityChips name="flexibility" defaultValue={form.value('flexibility')} />
                </div>
              </div>
            </div>

            <Button
              type="submit"
              variant="cta"
              className="mt-2.5 h-12 w-full rounded-(--radius-pill) px-5 text-[14px] font-medium sm:absolute sm:top-1/2 sm:right-0 sm:mt-0 sm:w-auto sm:-translate-y-1/2"
            >
              Search trips
              <Icon name="arrow-right" size={1} className="size-[16px]" />
            </Button>
          </div>

          {/*
            Everything else, folded.

            A `details` rather than a dialog, because the fields inside are
            part of this form and have to submit with it whether or not
            anybody opened the fold - and because the browser supplies the
            whole of the expand-and-collapse behaviour, including before
            JavaScript arrives.
          */}
          <details className="group/more self-center">
            {/*
              A control, not a link.

              It was a line of grey text with a plus in front of it, which is
              how the one thing on the panel that opens the rest of the search
              ends up looking like a footnote. It is a pill like the lenses
              above it now, and the glyph turns when it is open.
            */}
            <summary className="border-hairline text-muted hover:text-text hover:border-border-strong ease-standard duration-quick focus-visible:outline-accent-ink inline-flex cursor-pointer list-none items-center gap-2 rounded-(--radius-pill) border px-3.5 py-1.5 text-[13px] transition-colors select-none [&::-webkit-details-marker]:hidden">
              <Icon
                name="plus"
                size={1}
                className="ease-standard duration-settled size-[14px] transition-transform group-open/more:rotate-45"
              />
              More options
            </summary>

            <div className="border-hairline bg-field mt-2.5 rounded-[14px] border p-5">
              <div className="flex flex-col gap-6 pt-2">
                <fieldset className="flex flex-col gap-3">
                  <legend className="text-text text-sm font-medium">Exact travel window</legend>
                  <p className="text-muted text-sm">
                    Used when the dates are set to &ldquo;Exact window&rdquo;. A window plus a trip
                    length says &ldquo;four to seven nights, any time in June&rdquo;.
                  </p>
                  <ExactWindowFields form={form} errors={errors} />
                </fieldset>

                <fieldset className="flex flex-col gap-3">
                  <legend className="text-text text-sm font-medium">Budget</legend>
                  <BudgetFields
                    form={form}
                    errors={errors}
                    include={['currency', 'targetBudget', 'maxBudget', 'reserveBudget']}
                  />
                </fieldset>

                <fieldset className="flex flex-col gap-3">
                  <legend className="text-text text-sm font-medium">What matters to you</legend>
                  <PreferenceFields form={form} errors={errors} />
                </fieldset>
              </div>
            </div>
          </details>
        </form>
      </div>
    </section>
  );
}

/*
 * The bar.
 *
 * One glass row, 64px tall on a desktop: From, To, the dates, travellers, an
 * Options toggle and the action. Everything else - the kind of trip, flights
 * or the whole trip, how flexible the dates are, the folded fields - lives in a
 * panel that opens upward from the bar, because the bar is pinned to the
 * bottom of the hero and there is nowhere else for it to grow.
 *
 * **The toggle is a checkbox.** A visually hidden, still focusable checkbox
 * with a real label, and CSS `:has()` on the container does the rest. That
 * keeps the bar a server component, keeps every control in the form whether or
 * not it is open, and keeps it working before JavaScript. On a phone the same
 * toggle also reveals the four fields, and the bar shows a one-line summary of
 * them instead.
 *
 * The calendar is the ordinary popover. It opens upward from its trigger and
 * the hero hides the headline while it is open (see `DiscoveryStage`), so it
 * can never be drawn over the words.
 */
function BarSearch({
  values,
  errors,
  action,
  destinationsHint,
  carry,
  airports,
  today,
  lensDefaults,
  here,
  defaults,
  form,
  view,
  style,
}: {
  values: CompactSearchProps['values'];
  errors: NonNullable<CompactSearchProps['errors']>;
  action: '/' | '/explore';
  destinationsHint: string;
  carry: Readonly<Record<string, string>>;
  airports: readonly AirportSuggestion[];
  today: string;
  lensDefaults?: Readonly<Record<string, string>>;
  here: '/' | '/explore';
  defaults: Readonly<Record<string, string>>;
  form: ReturnType<typeof readForm>;
  view: 'flight' | 'trip';
  style: string;
}) {
  const departure = form.value('departureDate');
  const back = form.value('returnDate');
  const travellers = Number(form.value('passengers')) || 1;
  const summary = [
    form.value('origins').split(',')[0]?.trim(),
    departure && back ? `${shortDate(departure)} to ${shortDate(back)}` : null,
    `${travellers} ${travellers === 1 ? 'traveller' : 'travellers'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const cell =
    'min-w-0 px-3 py-2 max-lg:hidden max-lg:group-has-[#hero-search-open:checked]/s:block lg:border-hairline lg:border-l lg:first:border-l-0';

  return (
    <section aria-labelledby="compact-search-heading" className="stage-scope">
      <h2 id="compact-search-heading" className="sr-only">
        Search for a trip
      </h2>

      <div className="voyagr-search group/s relative flex max-h-[calc(100svh-10.5rem)] flex-col rounded-[20px]">
        <input
          id="hero-search-open"
          type="checkbox"
          // Open when the search was refused. Folded, the form has nowhere to show what was
          // wrong: on a phone every field (and so every message) is behind the toggle, and
          // a refused search would look like a button that does nothing.
          defaultChecked={Object.values(errors).some(Boolean)}
          className="sr-only"
          aria-label="Show every search option"
        />

        {errors.form ? (
          <p role="alert" className="text-critical-ink px-4 pt-3 text-[13px]">
            {errors.form}
          </p>
        ) : null}

        {/* The kind of trip, and flights or the whole trip: only when open. */}
        <div className="border-hairline hidden shrink-0 flex-col gap-2 border-b px-3 py-3 group-has-[#hero-search-open:checked]/s:flex">
          <nav aria-label="Kind of trip">
            <LensSlider>
              <ul className="flex gap-1.5 px-1 py-0.5">
                {DISCOVERY_CATEGORIES.map((category) => {
                  const active = style === category.travelStyle;

                  return (
                    <li key={category.id} className="shrink-0">
                      <span id={`lens-${category.id}-description`} className="sr-only">
                        {category.description}
                      </span>
                      <Link
                        href={`${action}?${categoryQuery({ category, today, defaults: lensDefaults ?? defaults })}`}
                        aria-current={active ? 'true' : undefined}
                        aria-describedby={`lens-${category.id}-description`}
                        title={category.description}
                        className={[
                          'ease-standard duration-quick inline-flex min-h-11 items-center rounded-(--radius-pill) px-3.5 py-2 text-[13px] whitespace-nowrap transition-colors',
                          'focus-visible:outline-accent-ink',
                          active
                            ? 'bg-field border-hairline text-text border font-medium'
                            : 'text-muted hover:text-text border border-transparent',
                        ].join(' ')}
                      >
                        {category.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </LensSlider>
          </nav>

          <SearchKindTabs
            active={view === 'flight' ? 'flights' : 'both'}
            hrefFor={(kind) => {
              if (kind === 'stays') return '/stays';
              const next = new URLSearchParams(
                Object.entries(values).filter(
                  (entry): entry is [string, string] =>
                    typeof entry[1] === 'string' && entry[0] !== 'view',
                ),
              );
              next.set('view', kind === 'flights' ? 'flight' : 'trip');
              return `${values.origins ? action : here}?${next.toString()}`;
            }}
            className="px-1"
          />
        </div>

        <form method="get" action={action} className="group/form flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="view" value={view} />
          {Object.entries(carry).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}

          {/* How flexible, and the folded fields: only when open. */}
          <div className="border-hairline hidden min-h-0 flex-col gap-3 overflow-y-auto border-b px-3 py-3 group-has-[#hero-search-open:checked]/s:flex">
            <div className="hidden grid-cols-2 gap-2 group-has-[input[name=flexibility][value=month]:checked]/form:grid">
              <Select
                label="Month"
                name="monthStart"
                defaultValue={values.monthStart ?? ''}
                options={monthOptions(today)}
                bare
              />
              <Select
                label="Trip length"
                name="tripNights"
                defaultValue={values.tripNights ?? '7'}
                options={TRIP_NIGHTS}
                bare
              />
            </div>

            <FlexibilityChips name="flexibility" defaultValue={form.value('flexibility')} />

            <details className="group/more">
              <summary className="border-hairline text-muted hover:text-text hover:border-border-strong ease-standard duration-quick focus-visible:outline-accent-ink inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-(--radius-pill) border px-3.5 py-1.5 text-[13px] transition-colors select-none [&::-webkit-details-marker]:hidden">
                <Icon
                  name="plus"
                  size={1}
                  className="ease-standard duration-settled size-[14px] transition-transform group-open/more:rotate-45"
                />
                More options
              </summary>

              <div className="border-hairline bg-field mt-2.5 max-h-[40vh] overflow-auto rounded-[14px] border p-5">
                <div className="flex flex-col gap-6 pt-2">
                  <fieldset className="flex flex-col gap-3">
                    <legend className="text-text text-sm font-medium">Exact travel window</legend>
                    <p className="text-muted text-sm">
                      Used when the dates are set to &ldquo;Exact window&rdquo;. A window plus a
                      trip length says &ldquo;four to seven nights, any time in June&rdquo;.
                    </p>
                    <ExactWindowFields form={form} errors={errors} />
                  </fieldset>

                  <fieldset className="flex flex-col gap-3">
                    <legend className="text-text text-sm font-medium">Budget</legend>
                    <BudgetFields
                      form={form}
                      errors={errors}
                      include={['currency', 'targetBudget', 'maxBudget', 'reserveBudget']}
                    />
                  </fieldset>

                  <fieldset className="flex flex-col gap-3">
                    <legend className="text-text text-sm font-medium">What matters to you</legend>
                    <PreferenceFields form={form} errors={errors} />
                  </fieldset>
                </div>
              </div>
            </details>
          </div>

          {/* The bar itself. 64px on a desktop. */}
          <div className="flex shrink-0 flex-col lg:h-16 lg:flex-row lg:items-center lg:pr-2.5">
            <div className="relative flex min-w-0 flex-col lg:grid lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2.35fr)_minmax(0,1.15fr)] lg:items-center">
              <div className={cell}>
                <AirportInput
                  label="From"
                  name="origins"
                  defaultValue={form.value('origins')}
                  hint="Type a code or a city."
                  error={errors.origins}
                  airports={airports}
                  bare
                  dropUp
                  required
                />
              </div>

              <div className={`${cell} lg:pl-6`}>
                <AirportInput
                  label="To"
                  name="destinations"
                  defaultValue={form.value('destinations')}
                  hint={destinationsHint}
                  error={errors.destinations}
                  airports={airports}
                  bare
                  dropUp
                  required
                />
              </div>

              <div className={cell}>
                <div className="group-has-[input[name=flexibility][value=month]:checked]/form:hidden">
                  <DateRangeField
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
                  />
                </div>
              </div>

              <div className={cell}>
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
              </div>

              <SwapEndpoints
                from="origins"
                to="destinations"
                className="bg-field border-hairline text-muted hover:text-text focus-visible:outline-accent-ink ease-standard duration-quick absolute top-1/2 left-[18.6%] z-10 hidden size-[30px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border transition-colors lg:grid"
              />
            </div>

            <div className="flex items-center gap-2 p-2 lg:p-0 lg:pl-2">
              <label
                htmlFor="hero-search-open"
                className={`text-muted hover:text-text border-hairline ease-standard duration-quick inline-flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-(--radius-pill) border px-3.5 text-[13px] transition-colors group-has-[#hero-search-open:focus-visible]/s:outline-2 group-has-[#hero-search-open:focus-visible]/s:outline-offset-2 group-has-[#hero-search-open:focus-visible]/s:outline-(--color-brand-500) lg:flex-none`}
              >
                <span className="truncate lg:hidden">{summary}</span>
                <span className="font-medium whitespace-nowrap">
                  <span className="lg:hidden">Edit</span>
                  <span className="max-lg:hidden">Options</span>
                </span>
                <Icon
                  name="chevron-down"
                  size={0.8}
                  className={`ease-standard duration-settled shrink-0 transition-transform group-has-[#hero-search-open:checked]/s:rotate-180`}
                />
              </label>

              <Button
                type="submit"
                variant="cta"
                className="h-12 shrink-0 rounded-(--radius-pill) px-5 text-[14px] font-medium"
              >
                Search trips
                <Icon name="arrow-right" size={1} className="size-[16px]" />
              </Button>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
