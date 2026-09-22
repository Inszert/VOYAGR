import Link from 'next/link';
import { Button, DateRangeField, Field, Icon, Select } from '@/components/ui';
import {
  BudgetFields,
  ExactWindowFields,
  PreferenceFields,
  readForm,
  type SearchFormProps,
} from '@/components/search/search-form';
import { AirportInput } from '@/components/search/airport-input';
import { DISCOVERY_CATEGORIES } from '@/discovery/categories';
import { categoryQuery } from '@/discovery/preset';
import type { AirportSuggestion } from '@/search/destination-names';
import { FLEXIBILITY_LABELS, FLEXIBILITY_PRESETS } from '@/search/flexibility';
import { LensSlider } from './lens-slider';
import { SearchKindTabs } from '@/components/search/search-kind-tabs';
import { AnywhereButton } from '@/components/search/anywhere-button';
import { SwapEndpoints } from './swap-endpoints';

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
}: CompactSearchProps) {
  const form = readForm(values, { ...defaults, destinations: destinationsDefault });
  const style = form.value('travelStyle');

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
                    <Link
                      href={`/?${categoryQuery({ category, today, defaults: lensDefaults ?? defaults })}`}
                      aria-current={active ? 'true' : undefined}
                      title={category.description}
                      className={[
                        'ease-standard duration-quick inline-flex items-center rounded-[--radius-pill] px-3.5 py-2 text-[13px] whitespace-nowrap transition-colors',
                        'focus-visible:outline-accent-ink',
                        active
                          ? 'bg-field border-hairline text-text border font-medium'
                          : 'text-muted hover:text-text border border-transparent',
                      ].join(' ')}
                    >
                      {category.title}
                      <span className="sr-only">. {category.description}</span>
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
        <SearchKindTabs
          active="flights"
          hrefFor={(kind) =>
            kind === 'stays' ? '/stays' : kind === 'both' ? '/stays?with=flights' : '/'
          }
          className="px-2.5 pt-2.5"
        />

        <form method="get" action={action} className="flex flex-col gap-2.5">
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
              <div className="relative grid sm:grid-cols-3">
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

                <Cell>
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
                  {/*
                    "Anywhere" is a real answer to "where to?".
                    
                    A search that only accepts three-letter codes serves
                    people who already know where they are going, which is
                    the opposite of what this product is for. The word
                    expands to every destination we can actually price, so
                    it is a promise we can keep rather than a wildcard.
                  */}
                  <p className="mt-1">
                    <AnywhereButton targetName="destinations" />
                  </p>
                </Cell>

                <Cell>
                  <Field
                    label="Travellers"
                    name="passengers"
                    type="number"
                    min={1}
                    max={9}
                    defaultValue={form.value('passengers')}
                    error={errors.passengers}
                    bare
                    required
                  />
                </Cell>

                {/* A third of the way across is exactly the first divider. */}
                <SwapEndpoints
                  from="origins"
                  to="destinations"
                  className="bg-field border-hairline text-muted hover:text-text focus-visible:outline-accent-ink ease-standard duration-quick absolute top-1/2 left-1/3 z-10 hidden size-[30px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border transition-colors sm:grid"
                />
              </div>

              <div className="border-hairline grid border-t sm:grid-cols-3">
                {/*
                  The browser enforces the order. `min` on the departure stops
                  a trip being booked into the past and `min` on the return
                  stops one ending before it starts, both before a request is
                  made. The schema still checks on the server, because a
                  client-side constraint is a convenience and never a
                  guarantee.
                */}
                <Cell rule={false} className="sm:col-span-2">
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

                <Cell>
                  <Select
                    label="Dates"
                    name="flexibility"
                    defaultValue={form.value('flexibility')}
                    hint="Widens the two dates beside this."
                    bare
                    options={[
                      ...FLEXIBILITY_PRESETS.map((preset) => ({
                        value: preset,
                        label: FLEXIBILITY_LABELS[preset],
                      })),
                      { value: 'custom', label: 'Exact window' },
                    ]}
                  />
                </Cell>
              </div>
            </div>

            <Button
              type="submit"
              variant="cta"
              className="mt-2.5 h-12 w-full rounded-[--radius-pill] px-5 text-[14px] font-medium sm:absolute sm:top-1/2 sm:right-0 sm:mt-0 sm:w-auto sm:-translate-y-1/2"
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
            <summary className="border-hairline text-muted hover:text-text hover:border-border-strong ease-standard duration-quick focus-visible:outline-accent-ink inline-flex cursor-pointer list-none items-center gap-2 rounded-[--radius-pill] border px-3.5 py-1.5 text-[13px] transition-colors select-none [&::-webkit-details-marker]:hidden">
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
