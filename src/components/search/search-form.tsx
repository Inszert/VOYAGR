import {
  AmountSlider,
  Button,
  Card,
  DateField,
  Disclosure,
  Field,
  NumberStepperField,
  RadioChip,
  Select,
} from '@/components/ui';
import { FLEXIBILITY_HINTS, FLEXIBILITY_LABELS, FLEXIBILITY_PRESETS } from '@/search/flexibility';
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
 *
 * The fieldsets are exported on their own because the homepage's compact
 * search shows a handful of them in the open and the rest behind "More
 * options". One set of markup per field, so the two forms cannot drift apart
 * on a label, a hint or a validation message.
 */

export interface SearchFormProps {
  /** Raw submitted values, echoed back so a rejected form keeps what was typed. */
  values: Readonly<Record<string, string | undefined>>;
  /**
   * The signed-in user's saved preferences, as form values.
   *
   * Sits between what was submitted and the system defaults: what you typed
   * wins, then what you saved, then what we guessed for a stranger.
   */
  defaults?: Readonly<Record<string, string>>;
  errors?: SearchFormErrors;
}

export const SEARCH_FORM_DEFAULTS: Readonly<Record<string, string>> = {
  origins: 'VIE',
  destinations: 'AYT, CHQ, SPU',
  flexibility: 'custom',
  departureDate: '2026-06-06',
  returnDate: '2026-06-13',
  earliestDeparture: '2026-06-01',
  latestReturn: '2026-06-30',
  minNights: '2',
  maxNights: '7',
  passengers: '2',
  currency: 'EUR',
  targetBudget: '650',
  maxBudget: '850',
  travelStyle: 'balanced',
  optimisationMode: 'best_value',
};

/**
 * How a form reads its values.
 *
 * What was typed wins, then what was saved, then the system default. Once a
 * form has been submitted its checkboxes are authoritative, including the ones
 * left unticked: falling back to a saved preference then would re-tick a box
 * the user had just deliberately cleared.
 */
export interface FormReader {
  readonly submitted: boolean;
  value(name: string): string;
  checked(name: string): boolean;
}

export function readForm(
  values: Readonly<Record<string, string | undefined>>,
  defaults: Readonly<Record<string, string>> = {},
  systemDefaults: Readonly<Record<string, string>> = SEARCH_FORM_DEFAULTS,
): FormReader {
  // A GET form always submits its text inputs, so this marks a real submission.
  const submitted = typeof values.origins === 'string';

  return {
    submitted,
    value: (name) => values[name] ?? defaults[name] ?? systemDefaults[name] ?? '',
    checked: (name) => {
      const source = submitted ? values : { ...defaults, ...values };
      return source[name] === 'on' || source[name] === 'true';
    },
  };
}

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
        // `shrink-0`, because a flex item shrinks below its own size by
        // default: a long label was squeezing these 20px boxes to 13px, so
        // the product shipped oval checkboxes.
        className="border-border-strong text-brand-600 size-5 shrink-0 rounded-(--radius-control) border"
      />
      {label}
    </label>
  );
}

export interface FieldsetProps {
  form: FormReader;
  errors?: SearchFormErrors;
}

/** Section 8: flexible dates are not an advanced option. */
export function FlexibilityChips({ form }: FieldsetProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-ink text-sm font-medium">How flexible are the dates?</legend>
      <div className="flex flex-wrap gap-2">
        {FLEXIBILITY_PRESETS.map((preset) => (
          <RadioChip
            key={preset}
            name="flexibility"
            value={preset}
            label={FLEXIBILITY_LABELS[preset]}
            hint={FLEXIBILITY_HINTS[preset]}
            defaultChecked={form.value('flexibility') === preset}
          />
        ))}
        <RadioChip
          name="flexibility"
          value="custom"
          label="Exact window"
          hint="Use the travel window set below."
          defaultChecked={form.value('flexibility') === 'custom'}
        />
      </div>
    </fieldset>
  );
}

/** The four window fields "Exact window" reads. */
export function ExactWindowFields({ form, errors = {} }: FieldsetProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <DateField
        label="Earliest departure"
        name="earliestDeparture"
        defaultValue={form.value('earliestDeparture')}
        error={errors.earliestDeparture}
        required
      />
      <DateField
        label="Latest return"
        name="latestReturn"
        defaultValue={form.value('latestReturn')}
        error={errors.latestReturn}
        required
      />
      <Field
        label="Shortest trip (nights)"
        name="minNights"
        type="number"
        min={1}
        max={60}
        defaultValue={form.value('minNights')}
        error={errors.minNights}
        required
      />
      <Field
        label="Longest trip (nights)"
        name="maxNights"
        type="number"
        min={1}
        max={60}
        defaultValue={form.value('maxNights')}
        error={errors.maxNights}
        required
      />
    </div>
  );
}

/** Currency and the budgets. Travellers and the ceiling are shown elsewhere by the compact form. */
export function BudgetFields({
  form,
  errors = {},
  include = ['passengers', 'currency', 'targetBudget', 'maxBudget', 'reserveBudget'],
}: FieldsetProps & { include?: readonly string[] }) {
  const has = (name: string) => include.includes(name);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {has('passengers') ? (
        <NumberStepperField
          label="Travellers"
          name="passengers"
          min={1}
          max={9}
          defaultValue={form.value('passengers')}
          error={errors.passengers}
          required
        />
      ) : null}
      {has('currency') ? (
        <Field
          label="Currency"
          name="currency"
          defaultValue={form.value('currency')}
          hint="Three-letter code, such as EUR."
          error={errors.currency}
          required
        />
      ) : null}
      {has('targetBudget') ? (
        <AmountSlider
          label="Target budget"
          name="targetBudget"
          min={100}
          max={3000}
          step={10}
          defaultValue={form.value('targetBudget')}
          hint="What a good trip should cost. Anything we cannot price is named, not counted."
          error={errors.targetBudget}
          required
        />
      ) : null}
      {has('maxBudget') ? (
        <AmountSlider
          label="Maximum budget"
          name="maxBudget"
          min={100}
          max={4000}
          step={10}
          defaultValue={form.value('maxBudget')}
          hint="A hard ceiling. Trips above it are never shown as matches."
          error={errors.maxBudget}
          required
        />
      ) : null}
      {has('reserveBudget') ? (
        <AmountSlider
          label="Hold back for spending (optional)"
          name="reserveBudget"
          min={0}
          max={1000}
          step={10}
          defaultValue={form.value('reserveBudget')}
          hint="Kept aside for food and whatever the day brings."
          error={errors.reserveBudget}
        />
      ) : null}
    </div>
  );
}

/** Style, optimisation and the hard requirements. */
export function PreferenceFields({ form, errors = {} }: FieldsetProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Travel style"
          name="travelStyle"
          defaultValue={form.value('travelStyle')}
          error={errors.travelStyle}
          options={TRAVEL_STYLES.map((style) => ({
            value: style,
            label: TRAVEL_STYLE_LABELS[style],
          }))}
        />
        <Select
          label="Optimise for"
          name="optimisationMode"
          defaultValue={form.value('optimisationMode')}
          error={errors.optimisationMode}
          options={OPTIMISATION_MODES.map((mode) => ({
            value: mode,
            label: OPTIMISATION_MODE_LABELS[mode],
          }))}
        />
        <Select
          label="Most stops on a flight"
          name="maxStops"
          defaultValue={form.value('maxStops')}
          error={errors.maxStops}
          options={[
            { value: '', label: 'Any number of stops' },
            { value: '0', label: 'Direct only' },
            { value: '1', label: 'Up to 1 stop' },
            { value: '2', label: 'Up to 2 stops' },
            { value: '3', label: 'Up to 3 stops' },
          ]}
        />
        <Field
          label="Minimum hotel review score (optional)"
          name="minHotelReviewScore"
          type="number"
          min={0}
          max={10}
          step="0.1"
          defaultValue={form.value('minHotelReviewScore')}
          error={errors.minHotelReviewScore}
        />
        <Field
          label="Maximum distance to the beach in metres (optional)"
          name="maxBeachDistanceMetres"
          type="number"
          min={0}
          step="50"
          defaultValue={form.value('maxBeachDistanceMetres')}
          error={errors.maxBeachDistanceMetres}
        />
      </div>

      <div className="flex flex-col gap-3">
        <Checkbox
          name="requireDirectFlights"
          label="Direct flights only"
          defaultChecked={form.checked('requireDirectFlights')}
        />
        <Checkbox
          name="requireCheckedBaggage"
          label="Checked baggage must be included"
          defaultChecked={form.checked('requireCheckedBaggage')}
        />
        <Checkbox
          name="requireFreeCancellation"
          label="Hotel must be free to cancel"
          defaultChecked={form.checked('requireFreeCancellation')}
        />
      </div>
    </div>
  );
}

export function SearchForm({ values, defaults = {}, errors = {} }: SearchFormProps) {
  const form = readForm(values, defaults);

  return (
    <Card as="section" aria-labelledby="search-form-heading" elevation="raised">
      <h2 id="search-form-heading" className="text-ink text-xl font-semibold">
        Describe the trip
      </h2>
      <p className="text-ink-muted mt-1 text-sm">
        Everything is a hard limit except the target budget, which is what a good trip should cost.
      </p>

      {errors.form ? (
        <p role="alert" className="text-critical-ink mt-3 text-sm">
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
              defaultValue={form.value('origins')}
              hint="Three-letter codes, separated by commas."
              error={errors.origins}
              required
            />
            <Field
              label="Destinations"
              name="destinations"
              defaultValue={form.value('destinations')}
              hint="Three-letter codes, separated by commas."
              error={errors.destinations}
              required
            />
            <DateField
              label="Leaving"
              name="departureDate"
              defaultValue={form.value('departureDate')}
              error={errors.departureDate}
            />
            <DateField
              label="Coming back"
              name="returnDate"
              defaultValue={form.value('returnDate')}
              error={errors.returnDate}
            />
          </div>

          {/*
            Section 8: flexible dates are not an advanced option.

            So they sit here, in the open, directly under the two dates they
            widen - not behind the disclosure, which holds the exact window
            instead. Most people do not care which week; the ones who do can
            still say so, one level down.
          */}
          <FlexibilityChips form={form} />
        </fieldset>

        <Disclosure summary="Set an exact travel window">
          <p className="text-ink-muted text-sm">
            Used when &ldquo;Exact window&rdquo; is chosen above. A window plus a trip length says
            &ldquo;four to seven nights, any time in June&rdquo; - which the presets cannot express.
          </p>
          <div className="mt-4">
            <ExactWindowFields form={form} errors={errors} />
          </div>
        </Disclosure>

        <fieldset className="flex flex-col gap-4">
          <legend className="text-ink text-sm font-semibold">Who and how much</legend>
          <BudgetFields form={form} errors={errors} />
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="text-ink text-sm font-semibold">What matters to you</legend>
          <PreferenceFields form={form} errors={errors} />
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
