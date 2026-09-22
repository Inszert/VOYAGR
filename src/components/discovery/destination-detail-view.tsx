import { Card, CardTitle, Tag } from '@/components/ui';
import { groupPlaces, type DestinationDetail } from '@/discovery/destination-detail';

/**
 * A place, as far as we can honestly describe one (1.10.1 section 18).
 *
 * "Feels like discovering a place rather than viewing a database record" is a
 * bar about presentation, so the writing carries it: headings a person would
 * say out loud, an outlook expressed as a range rather than a number, and
 * nothing rendered as an empty section waiting to be filled.
 *
 * What it will not do is clear that bar by inventing the record. Every line
 * here came from an adapter, and the sections with no data are absent rather
 * than empty.
 */

export interface DestinationDetailViewProps {
  detail: DestinationDetail;
}

/** Price tiers as words. The provider's 1-4, which is all it gives. */
const PRICE_LEVEL = ['', 'Inexpensive', 'Moderate', 'Pricey', 'Expensive'] as const;

function walkingMinutes(metres: number): number {
  // 80 metres a minute, which is an unhurried walk. Rounded up, because
  // rounding a walk down is how people miss things.
  return Math.max(1, Math.ceil(metres / 80));
}

export function DestinationDetailView({ detail }: DestinationDetailViewProps) {
  const sections = groupPlaces(detail.places);

  const warmest = detail.weather.reduce<number | null>(
    (highest, day) =>
      highest === null ? day.temperatureMaxC : Math.max(highest, day.temperatureMaxC),
    null,
  );
  const coolest = detail.weather.reduce<number | null>(
    (lowest, day) =>
      lowest === null ? day.temperatureMinC : Math.min(lowest, day.temperatureMinC),
    null,
  );
  const confidence = detail.weather.reduce<number | null>(
    (weakest, day) => (weakest === null ? day.confidence : Math.min(weakest, day.confidence)),
    null,
  );

  return (
    <>
      {/*
        The place is named by the stage header above this, which is where the
        page's one `h1` lives. Repeating it here would be two answers to
        "where am I?" on one page, and a second `h1` in the outline.
      */}
      {detail.unavailable.length > 0 ? (
        <div
          role="status"
          className="border-caution-500/30 bg-caution-500/10 rounded-[--radius-card] border p-4"
        >
          <p className="text-ink text-sm">
            Some of this page is missing: {detail.unavailable.join(', ')} did not answer. What is
            below is incomplete rather than complete.
          </p>
        </div>
      ) : null}

      {detail.weather.length > 0 && warmest !== null && coolest !== null ? (
        <Card as="section" aria-labelledby="weather-heading" elevation="raised">
          <CardTitle id="weather-heading" level={2}>
            While you are there
          </CardTitle>
          <p className="text-ink mt-2">
            {Math.round(coolest)} to {Math.round(warmest)}°C across{' '}
            {detail.weather.length === 1 ? 'the day' : `the ${detail.weather.length} days`}
            {/*
              Section 13: a long-range outlook is climatology and must not be
              dressed as a forecast. Below half confidence it says so.
            */}
            {confidence !== null && confidence < 0.5 ? ', typical for the season' : ''}.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {detail.weather.map((day) => (
              <li key={day.date}>
                <Tag>
                  {day.date.slice(8)}/{day.date.slice(5, 7)} · {Math.round(day.temperatureMaxC)}°C ·{' '}
                  {Math.round(day.precipitationProbability * 100)}% rain
                </Tag>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {sections.map((section) => (
        <Card
          key={section.category}
          as="section"
          aria-labelledby={`places-${section.category}`}
          elevation="raised"
        >
          <CardTitle id={`places-${section.category}`} level={2}>
            {section.heading}
          </CardTitle>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {section.places.map((place) => (
              <li key={place.id} className="border-border rounded-[--radius-card] border p-3">
                <p className="text-ink text-sm font-medium">{place.name}</p>
                <p className="text-ink-muted mt-1 text-sm">
                  {/*
                    Unrated is not "nought out of five". Each fact appears only
                    when the provider actually supplied it.
                  */}
                  {place.rating !== null
                    ? `${place.rating.toFixed(1)} from ${place.ratingCount} reviews`
                    : 'Not rated'}
                  {place.priceLevel !== null ? ` · ${PRICE_LEVEL[place.priceLevel]}` : ''}
                  {place.distanceFromCentreMetres !== null
                    ? ` · ${walkingMinutes(place.distanceFromCentreMetres)} min walk from the centre`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}
