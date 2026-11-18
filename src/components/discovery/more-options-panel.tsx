import { Field } from '@/components/ui';
import {
  BudgetFields,
  ExactWindowFields,
  type FieldsetProps,
} from '@/components/search/search-form';
import {
  OPTIMISATION_MODES,
  OPTIMISATION_MODE_LABELS,
  TRAVEL_STYLES,
  TRAVEL_STYLE_LABELS,
} from '@/search/schema';
import { MoreOptionsDone } from './more-options-done';

/**
 * The inside of "More options": one panel, three headed groups.
 *
 * Dates, Trip and Price. Every field that was folded here before is still
 * here, under the same name and submitting the same value; what changed is how
 * it is asked. A choice between a few things is a set of radios and a yes or
 * no is a checkbox, each in its own 44px row with its label beside it, and the
 * chosen row says so in words ("Selected") and with a mark, so colour is never
 * the only signal. The radios and checkboxes are native inputs, so the form
 * submits them with or without JavaScript, and the fold needs none either.
 *
 * Only the Done button is a script: it closes the fold and gives focus back to
 * the button that opened it.
 */

const STOPS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Any number of stops' },
  { value: '0', label: 'Direct only' },
  { value: '1', label: 'Up to 1 stop' },
  { value: '2', label: 'Up to 2 stops' },
  { value: '3', label: 'Up to 3 stops' },
];

const ROW =
  'group/row border-hairline has-[:checked]:border-accent-to has-[:checked]:bg-accent-to/15 has-[:focus-visible]:outline-accent-ink text-text flex min-h-11 cursor-pointer items-center gap-3 rounded-(--radius-control) border px-3 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2';

/** The word and the mark that say a row is the chosen one. Shown by `:has(:checked)` on the row. */
function SelectedMark() {
  return (
    <span className="text-ink ml-auto hidden shrink-0 items-center gap-1 text-xs font-medium group-has-[:checked]/row:inline-flex">
      <span aria-hidden="true">✓</span>
      Selected
    </span>
  );
}

function RadioGroup({
  legend,
  name,
  options,
  value,
}: {
  legend: string;
  name: string;
  options: readonly { value: string; label: string }[];
  value: string;
}) {
  // A value that is none of the options (an old link) falls back to the first,
  // as the dropdown it replaces did, so the group always submits something.
  const chosen = options.some((option) => option.value === value) ? value : options[0]!.value;

  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="text-ink mb-1 text-sm font-medium">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className={ROW}>
          <input
            type="radio"
            name={name}
            value={option.value}
            defaultChecked={option.value === chosen}
            className="accent-accent-to size-5 shrink-0"
          />
          <span className="min-w-0">{option.label}</span>
          <SelectedMark />
        </label>
      ))}
    </fieldset>
  );
}

const TRIP_LENGTHS: readonly { value: string; label: string }[] = [
  { value: 'any', label: 'Any length' },
  { value: 'under', label: 'Under X days' },
  { value: 'over', label: 'Over X days' },
];

/**
 * How long the trip may be: any length, under X days (a maximum of X nights)
 * or over X days (a minimum of X nights), X from 1 to 30. Submitted as
 * `tripLength` and `tripDays`; the server turns them into `maxNights` or
 * `minNights` (see `withTripLength`).
 */
function TripLengthFields({ form, errors }: FieldsetProps) {
  const days = Number(form.value('tripDays'));
  const shown = Number.isInteger(days) && days >= 1 && days <= 30 ? String(days) : '7';

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <RadioGroup
        legend="Trip length"
        name="tripLength"
        value={form.value('tripLength') || 'any'}
        options={TRIP_LENGTHS}
      />
      <Field
        label="Number of days (X), 1 to 30"
        name="tripDays"
        type="number"
        min={1}
        max={30}
        step={1}
        defaultValue={shown}
        error={errors?.minNights ?? errors?.maxNights}
        hint="Used by Under and Over. Under X is at most X nights; Over X is at least X nights."
      />
    </div>
  );
}

function CheckRow({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className={ROW}>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="accent-accent-to size-5 shrink-0"
      />
      <span className="min-w-0">{label}</span>
      <SelectedMark />
    </label>
  );
}

function Group({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <h3
        id={id}
        className="text-dim border-hairline border-b pb-1.5 text-[11px] font-semibold tracking-[0.1em] uppercase"
      >
        {heading}
      </h3>
      {children}
    </section>
  );
}

export function MoreOptionsPanel({
  form,
  errors = {},
  idPrefix,
  className,
}: FieldsetProps & { idPrefix: string; className?: string }) {
  return (
    <div
      className={`border-hairline bg-field mt-2.5 rounded-[14px] border p-4 sm:p-5 ${className ?? ''}`}
    >
      <div className="flex flex-col gap-7">
        <Group id={`${idPrefix}-dates`} heading="Dates">
          <div className="flex flex-col gap-3">
            <p className="text-muted text-sm">
              Your exact travel window. Used when the dates are set to &ldquo;Exact window&rdquo;: a
              window plus a trip length says &ldquo;four to seven nights, any time in June&rdquo;.
            </p>
            <ExactWindowFields form={form} errors={errors} />
          </div>
        </Group>

        <Group id={`${idPrefix}-trip`} heading="Trip">
          <RadioGroup
            legend="Travel style"
            name="travelStyle"
            value={form.value('travelStyle')}
            options={TRAVEL_STYLES.map((style) => ({
              value: style,
              label: TRAVEL_STYLE_LABELS[style],
            }))}
          />
          <RadioGroup
            legend="Optimise for"
            name="optimisationMode"
            value={form.value('optimisationMode')}
            options={OPTIMISATION_MODES.map((mode) => ({
              value: mode,
              label: OPTIMISATION_MODE_LABELS[mode],
            }))}
          />
          <TripLengthFields form={form} errors={errors} />
          <RadioGroup
            legend="Most stops on a flight"
            name="maxStops"
            value={form.value('maxStops')}
            options={STOPS}
          />

          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="text-ink mb-1 text-sm font-medium">Must have</legend>
            <CheckRow
              name="requireDirectFlights"
              label="Direct flights only"
              defaultChecked={form.checked('requireDirectFlights')}
            />
            <CheckRow
              name="requireCheckedBaggage"
              label="Checked baggage must be included"
              defaultChecked={form.checked('requireCheckedBaggage')}
            />
            <CheckRow
              name="requireFreeCancellation"
              label="Hotel must be free to cancel"
              defaultChecked={form.checked('requireFreeCancellation')}
            />
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
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
        </Group>

        <Group id={`${idPrefix}-price`} heading="Price">
          <BudgetFields
            form={form}
            errors={errors}
            include={['currency', 'targetBudget', 'maxBudget', 'reserveBudget']}
          />
        </Group>

        <div className="border-hairline flex justify-end border-t pt-4">
          <MoreOptionsDone />
        </div>
      </div>
    </div>
  );
}
