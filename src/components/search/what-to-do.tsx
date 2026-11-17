import { Disclosure, Icon } from '@/components/ui';
import { KIND_ICON, KIND_WORDS, sentenceCase } from '@/components/destination/place-kinds';
import { formatKilometres } from '@/core/distance';
import { placesToShow, loadThingsToDo, type ThingsToDoOutcome } from '@/discovery/things-to-do';
import { resolveDestinationGeo } from '@/search/destination-names';

/**
 * "What to do in {city}", inside "Your trip".
 *
 * The places are the destination page's own list, read through the same loader
 * (`loadThingsToDo`) and the same cache, so the two never disagree. Nothing is
 * added here: a source that is off, down or empty is said in words, never a
 * blank and never a made-up list.
 */

/** How many places the disclosure lists; the destination page has the rest. */
const SHOWN = 8;

export function WhatToDoView({
  outcome,
  city,
  destinationHref,
}: {
  outcome: ThingsToDoOutcome | null;
  city: string;
  destinationHref?: string;
}) {
  const places = outcome?.status === 'ok' ? placesToShow(outcome.things, null, SHOWN) : [];

  return (
    <Disclosure summary={`What to do in ${city}`} className="bg-surface-raised">
      <div className="flex flex-col gap-3 px-4 pb-4">
        {outcome === null ? (
          <p className="text-ink-muted text-sm">
            We do not have a position for {city}, so we cannot list places there yet.
          </p>
        ) : outcome.status === 'absent' ? (
          <p className="text-ink-muted text-sm">
            Places to visit are not switched on here, so we cannot list things to do in {city} yet.
          </p>
        ) : outcome.status === 'unavailable' ? (
          <p className="text-ink-muted text-sm">
            The places service did not answer just now, so we cannot list things to do in {city}.
            Try again in a moment.
          </p>
        ) : places.length === 0 ? (
          <p className="text-ink-muted text-sm">
            The open places data we use has no sights, museums or beaches listed for {city} yet. We
            would rather say so than guess.
          </p>
        ) : (
          <>
            {outcome.sample ? (
              <p className="text-ink-muted text-sm">
                These are samples for demonstration, not real places.
              </p>
            ) : null}
            <ul className="divide-border border-border divide-y border-y">
              {places.map((place) => (
                <li key={place.id} className="flex items-start gap-3 py-2.5">
                  <span
                    aria-hidden="true"
                    className="text-ink-muted mt-0.5 grid size-6 shrink-0 place-items-center"
                  >
                    <Icon name={KIND_ICON[place.kind]} size={0.95} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-ink block text-sm font-medium">{place.name}</span>
                    <span className="text-ink-muted block text-xs">
                      {KIND_WORDS[place.kind]}
                      {place.description ? ` · ${sentenceCase(place.description)}` : ''}
                    </span>
                  </span>
                  <span className="text-ink-muted shrink-0 text-sm tabular-nums">
                    {formatKilometres(place.distanceFromCentreMetres)}
                    <span className="sr-only"> from the centre</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {destinationHref ? (
          <a
            href={`${destinationHref}#things`}
            className="text-tint-ink inline-flex min-h-11 w-fit items-center font-medium underline underline-offset-4"
          >
            See everything to do in {city}
          </a>
        ) : null}
      </div>
    </Disclosure>
  );
}

/** The server half: asks the loader, which never throws, and hands the answer to the view. */
export async function WhatToDo({
  destination,
  city,
  destinationHref,
}: {
  destination: string;
  city: string;
  destinationHref?: string;
}) {
  const geo = resolveDestinationGeo(destination.toUpperCase());
  const outcome = geo
    ? await loadThingsToDo({ destination, destinationName: geo.name, position: geo.position })
    : null;

  return (
    <WhatToDoView outcome={outcome} city={city} {...(destinationHref ? { destinationHref } : {})} />
  );
}
