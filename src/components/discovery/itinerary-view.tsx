import type { Itinerary } from '@/ai';

/**
 * A drafted plan, day by day.
 *
 * Words only: the guardrail has already refused any draft that named a
 * figure it was not given. It is presented as a starting point - which it
 * is - and says who drafted it, including when that was the placeholder
 * assistant rather than a real model.
 */
export function ItineraryView({
  itinerary,
  nights,
  sample,
  placeholder,
}: {
  itinerary: Itinerary;
  nights: number;
  /** True when no dates were given and the length is only an example. */
  sample: boolean;
  /** True when the assistant is the offline placeholder. */
  placeholder: boolean;
}) {
  return (
    <section aria-labelledby="itinerary-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id="itinerary-heading" className="font-display text-display-sm text-ink">
          A first plan for {nights} {nights === 1 ? 'night' : 'nights'}
        </h2>
        <p className="text-ink-muted max-w-2xl text-sm">
          Drafted {placeholder ? 'by the placeholder assistant' : 'by the assistant'} from the
          places and weather on this page{sample ? ', for an example length of stay' : ''}. A
          starting point to change, not a booking: check opening times before you go.
        </p>
      </div>

      <ol className="grid gap-x-8 gap-y-6 md:grid-cols-2">
        {itinerary.days.map((day) => (
          <li key={day.dayNumber} className="border-tint/50 flex flex-col gap-2 border-t-2 pt-3">
            <p className="text-tint-ink text-xs font-semibold tracking-[0.12em] uppercase">
              Day {day.dayNumber}
            </p>
            <h3 className="font-display text-ink text-lg">{day.title}</h3>
            <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-dim">Morning</dt>
              <dd className="text-ink">{day.morning}</dd>
              <dt className="text-dim">Afternoon</dt>
              <dd className="text-ink">{day.afternoon}</dd>
              <dt className="text-dim">Evening</dt>
              <dd className="text-ink">{day.evening}</dd>
              {day.wetWeatherAlternative ? (
                <>
                  <dt className="text-dim">If it rains</dt>
                  <dd className="text-ink-muted">{day.wetWeatherAlternative}</dd>
                </>
              ) : null}
            </dl>
          </li>
        ))}
      </ol>

      {itinerary.notes.length > 0 ? (
        <ul className="text-ink-muted flex flex-col gap-1 text-sm">
          {itinerary.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
