import type { StayQuery } from '@/core/stay/types';
import type { IsoDate } from '@/core/trip/types';
import type { RecommendationCard } from '@/search/stays/recommendations';
import type { CoveredCity } from '@/search/stays/start-cities';
import { CityCard } from './city-card';
import { RecommendedStayCard } from './recommended-stay-card';
import { StaySearchForm } from './stay-search-form';

/** The stays start screen: search first, then recently priced hotels and the cities we cover. */

export interface StayStartProps {
  readonly query: StayQuery;
  readonly today: IsoDate;
  readonly cards: readonly RecommendationCard[];
  readonly cities: readonly CoveredCity[];
  readonly errors?: Readonly<Record<string, string>>;
}

export function StayStart({ query, today, cards, cities, errors }: StayStartProps) {
  const shown = cards.slice(0, 4);
  const cityName = new Map(cities.map((city) => [city.code, city.name]));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-ink font-display text-display-sm">Find a place to stay</h1>
        <p className="text-ink-muted">Stored hotel prices for the cities we cover</p>
      </header>

      <StaySearchForm query={query} today={today} errors={errors} />

      {shown.length > 0 ? (
        <section aria-labelledby="stay-recent" className="flex flex-col gap-3">
          <h2 id="stay-recent" className="text-ink font-display text-xl">
            Recently priced stays
          </h2>
          <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((card) => (
              <li key={`${card.cityCode}-${card.hotelKey}`}>
                <RecommendedStayCard
                  card={card}
                  cityName={cityName.get(card.cityCode)}
                  adults={query.occupancy.adults}
                  rooms={query.occupancy.rooms}
                  currency={query.currency}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="stay-cities" className="flex flex-col gap-3">
        <h2 id="stay-cities" className="text-ink font-display text-xl">
          {shown.length > 0 ? 'Cities we hold hotels for' : 'Places to start'}
        </h2>
        <ul className="grid list-none gap-4 p-0 sm:grid-cols-3 lg:grid-cols-4">
          {cities.map((city) => (
            <li key={city.code}>
              <CityCard city={city} />
            </li>
          ))}
        </ul>
      </section>

      <p className="text-ink-muted text-sm">
        Prices here are stored, not live. A hotel page lets you check the current price.
      </p>
    </div>
  );
}
