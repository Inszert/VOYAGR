import type { PlanTrip } from '@/components/search/add-to-plan';
import type { IsoDate, WeatherOutlook } from '@/core/trip/types';
import { buildFirstPlan } from '@/discovery/first-plan';
import type { ThingsToDoOutcome } from '@/discovery/things-to-do';
import type { ThingKind } from '@/providers/types';
import { FirstPlanSection } from './first-plan-section';
import type { TripStyle } from './style-order';
import { PlacesProvider } from './places-context';
import { ThingsToDoSection } from './things-to-do-section';

/**
 * Awaits the places the page started loading, then lays out everything that is
 * made of them: "Things to do" and "A first plan", sharing one list and one
 * detail sheet. Nothing else on the page waits for it.
 *
 * Renders nothing when there is no real list - a source that is off, down or
 * empty is the page's honest "cannot tell you yet" note, never a made-up list.
 */
export async function PlacesBoundary({
  outcome,
  city,
  centre,
  kind,
  style = null,
  hrefFor,
  planTrips,
  initialPlaceId,
  nights,
  startDate,
  weather,
}: {
  outcome: Promise<ThingsToDoOutcome>;
  city: string;
  centre: readonly [number, number];
  kind: ThingKind | null;
  style?: TripStyle | null;
  hrefFor: (kind: ThingKind | null) => string;
  planTrips: readonly PlanTrip[] | null;
  initialPlaceId: string | null;
  nights: number;
  /** Null when the page was opened without dates; the plan is then an example length. */
  startDate: IsoDate | null;
  weather: readonly WeatherOutlook[];
}) {
  const resolved = await outcome;
  if (resolved.status !== 'ok' || resolved.things.length === 0) return null;

  const plan = buildFirstPlan({ things: resolved.things, nights, startDate, weather });

  return (
    <PlacesProvider
      things={resolved.things}
      credits={resolved.credits}
      city={city}
      centre={centre}
      planTrips={planTrips}
      initialPlaceId={initialPlaceId}
    >
      <ThingsToDoSection
        outcome={resolved}
        city={city}
        hrefFor={hrefFor}
        kind={kind}
        style={style}
      />
      {plan ? <FirstPlanSection plan={plan} sample={startDate === null} /> : null}
    </PlacesProvider>
  );
}
