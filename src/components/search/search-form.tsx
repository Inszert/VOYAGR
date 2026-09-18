import { Button, Card, Field, Select } from '@/components/ui';
import {
  OPTIMISATION_MODES,
  OPTIMISATION_MODE_LABELS,
  TRAVEL_STYLES,
  TRAVEL_STYLE_LABELS,
  type SearchFormErrors,
} from '@/search/schema';

/**
 * The structured search form.
 *
 * A plain GET form, on purpose. It works before JavaScript loads, the resulting
 * search is a URL that can be bookmarked, shared and reloaded, and the back
 * button behaves. Those are the same properties a saved Travel Watch needs in
 * 1.5, so the query string is the structured request in transit.
 *
 * Structured input first: these fields *are* the search profile. The natural
 * language box Phase 2 adds will fill this form in, not bypass it.
 */

export interface SearchFormProps {
  /** Raw submitted values, echoed back so a rejected form keeps what was typed. */
  values: Readonly<Record<string, string | undefined>>;
  errors?: SearchFormErrors;
}

export const SEARCH_FORM_DEFAULTS: Readonly<Record<string, string>> = {
  origins: 'VIE',
  destinations: 'AYT, CHQ, SPU',
  earliestDeparture: '2026-06-01',
  latestReturn: '2026-06-30',
  minNights: '4',
  maxNights: '7',
  passengers: '2',
  currency: 'EUR',
  targetBudget: '650',
  maxBudget: '850',
  travelStyle: 'balanced',
  optimisationMode: 'best_value',
};

/**
 * A checkbox with its label.
 *
 * Local to this form rather than promoted to the design system: it is a native
 * input with a `<label>` around it and nothing else. The moment it needs
 * indeterminate state or a custom mark it becomes a Radix Checkbox in
 * `src/components/ui/` rather than growing here.
 */
function Checkbox({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="text-ink flex items-center gap-3 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="border-border-strong text-brand-600 size-5 rounded-[--radius-control] border"
      />
      {label}
    </label>
  );
}

export function SearchForm({ values, errors = {} }: SearchFormProps) {
  const value = (name: string) => values[name] ?? SEARCH_FORM_DEFAULTS[name] ?? '';
  const checked = (name: string) => values[name] === 'on' || values[name] === 'true';

  return (
    <Card as="section" aria-labelledby="search-form-heading">
      <h2 id="search-form-heading" className="text-ink text-xl font-semibold">
        Describe the trip
      </h2>
      <p className="text-ink-muted mt-1 text-sm">
        Everything is a hard limit except the target budget, which is what a good trip should cost.
      </p>

      {errors.form ? (
        <p role="alert" className="text-critical-500 mt-3 text-sm">
          {errors.form}
        </p>
      ) : null}

      <form method="get" action="/" className="mt-5 flex flex-col gap-6">
        <fieldset className="flex flex-col gap-4">
          <legend className="text-ink text-sm font-semibold">Where and when</legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Departure airports"
              name="origins"
              defaultValue={value('origins')}
              hint="Three-letter codes, separated by commas."
              error={errors.origins}
              required
            />
            <Field
              label="Destinations"
              name="destinations"
              defaultValue={value('destinations')}
              hint="Three-letter codes, separated by commas."
              error={errors.destinations}
              required
            />
            <Field
              label="Earliest departure"
              name="earliestDeparture"
              type="date"
              defaultValue={value('earliestDeparture')}
              error={errors.earliestDeparture}
              required
            />
            <Field
              label="Latest return"
              name="latestReturn"
              type="date"
              defaultValue={value('latestReturn')}
              error={errors.latestReturn}
              required
            />
            <Field
              label="Shortest trip (nights)"
              name="minNights"
              type="number"
              min={1}
              max={60}
              defaultValue={value('minNights')}
              error={errors.minNights}
              required
            />
            <Field
              label="Longest trip (nights)"
              name="maxNights"
              type="number"
              min={1}
              max={60}
              defaultValue={value('maxNights')}
              error={errors.maxNights}
              required
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="text-ink text-sm font-semibold">Who and how much</legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Travellers"
              name="passengers"
              type="number"
              min={1}
              max={9}
              defaultValue={value('passengers')}
              error={errors.passengers}
              required
            />
            <Field
              label="Currency"
              name="currency"
              defaultValue={value('currency')}
              hint="Three-letter code, such as EUR."
              error={errors.currency}
              required
            />
            <Field
              label="Target budget"
              name="targetBudget"
              type="number"
              min={1}
              step="1"
              defaultValue={value('targetBudget')}
              hint="What a good trip should cost, all in."
              error={errors.targetBudget}
              required
            />
            <Field
              label="Maximum budget"
              name="maxBudget"
              type="number"
              min={1}
              step="1"
              defaultValue={value('maxBudget')}
              hint="A hard ceiling. Trips above it are never shown as matches."
              error={errors.maxBudget}
              required
            />
            <Field
              label="Hold back for spending (optional)"
              name="reserveBudget"
              type="number"
              min={0}
              step="1"
              defaultValue={value('reserveBudget')}
              hint="Kept aside for food and whatever the day brings."
              error={errors.reserveBudget}
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="text-ink text-sm font-semibold">What matters to you</legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Travel style"
              name="travelStyle"
              defaultValue={value('travelStyle')}
              error={errors.travelStyle}
              options={TRAVEL_STYLES.map((style) => ({
                value: style,
                label: TRAVEL_STYLE_LABELS[style],
              }))}
            />
            <Select
              label="Optimise for"
              name="optimisationMode"
              defaultValue={value('optimisationMode')}
              error={errors.optimisationMode}
              options={OPTIMISATION_MODES.map((mode) => ({
                value: mode,
                label: OPTIMISATION_MODE_LABELS[mode],
              }))}
            />
            <Field
              label="Minimum hotel review score (optional)"
              name="minHotelReviewScore"
              type="number"
              min={0}
              max={10}
              step="0.1"
              defaultValue={value('minHotelReviewScore')}
              error={errors.minHotelReviewScore}
            />
            <Field
              label="Maximum distance to the beach in metres (optional)"
              name="maxBeachDistanceMetres"
              type="number"
              min={0}
              step="50"
              defaultValue={value('maxBeachDistanceMetres')}
              error={errors.maxBeachDistanceMetres}
            />
          </div>

          <div className="flex flex-col gap-3">
            <Checkbox
              name="requireDirectFlights"
              label="Direct flights only"
              defaultChecked={checked('requireDirectFlights')}
            />
            <Checkbox
              name="requireCheckedBaggage"
              label="Checked baggage must be included"
              defaultChecked={checked('requireCheckedBaggage')}
            />
            <Checkbox
              name="requireFreeCancellation"
              label="Hotel must be free to cancel"
              defaultChecked={checked('requireFreeCancellation')}
            />
          </div>
        </fieldset>

        <div>
          <Button type="submit" size="lg">
            Search trips
          </Button>
        </div>
      </form>
    </Card>
  );
}
