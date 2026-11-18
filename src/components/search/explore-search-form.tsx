import { Icon } from '@/components/ui';
import { SearchFieldGroup } from '@/components/search/search-fields';
import { readForm } from '@/components/search/search-form';
import type { SearchFormErrors } from '@/search/schema';
import { LiveSearchForm } from '@/components/search/live-search';
import { OWNED_FIELDS } from '@/components/search/live-fields';
import { TripLengthFields } from '@/components/discovery/more-options-panel';
import type { AirportSuggestion } from '@/search/destination-names';

/**
 * The explorer's search: Discover's questions, applied where the results are.
 *
 * The fields are `SearchFieldGroup`, the same component Discover's panel is
 * made of, so From and To with airport suggestions, Anywhere, every way of
 * widening the dates, the month and trip length of a month search, the trip
 * length limit and the travellers are the same controls with the same names. Only
 * the wrapper differs: this form applies a change to the address, and its
 * button runs the same search Enter does.
 */
export function ExploreSearchForm({
  label,
  values,
  submitted,
  airports,
  today,
  errors = {},
  airportCodes,
  defaults,
}: {
  label: string;
  values: Record<string, string | undefined>;
  submitted: Record<string, string | undefined>;
  airports: readonly AirportSuggestion[];
  today: string;
  errors?: SearchFormErrors;
  airportCodes: readonly string[];
  defaults: Record<string, string>;
}) {
  const form = readForm(values, defaults, today);

  return (
    <LiveSearchForm
      action="/explore"
      label={label}
      airportCodes={airportCodes}
      className="flex flex-col gap-3"
    >
      {Object.entries(values).map(([name, value]) =>
        typeof value === 'string' && name !== 'edit' && !OWNED_FIELDS.includes(name) ? (
          <input key={name} type="hidden" name={name} value={value} />
        ) : null,
      )}
      <SearchFieldGroup
        form={form}
        errors={errors}
        airports={airports}
        today={today}
        destinationsHint="Anywhere we can price, or type airport codes."
        destinationsValue={submitted.destinations ?? ''}
        destinationsPlaceholder="Anywhere"
        destinationsRequired={false}
        datesRequired
        values={values}
        stacked
      />
      <details className="group/more self-start">
        <summary className="border-hairline text-muted hover:text-text hover:border-border-strong ease-standard duration-quick focus-visible:outline-accent-ink inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-(--radius-pill) border px-3.5 py-1.5 text-[13px] transition-colors select-none [&::-webkit-details-marker]:hidden">
          <Icon
            name="plus"
            size={1}
            className="ease-standard duration-settled size-[14px] transition-transform group-open/more:rotate-45"
          />
          Trip length
        </summary>
        <div className="pt-3">
          <TripLengthFields form={form} errors={errors} />
        </div>
      </details>
    </LiveSearchForm>
  );
}
