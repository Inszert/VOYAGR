import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Field, Icon, PageHeader, Select } from '@/components/ui';
import { ActionForm } from '@/components/trips/action-form';
import { TripCard } from '@/components/trips/trip-card';
import { createTripAction } from '@/app/actions/trips';
import { getCurrentUser } from '@/auth/current-user';
import { getRepositories } from '@/db';
import { COUNTRIES } from '@/discovery/countries';
import { presentTrip } from '@/trip-hub/present';
import { TripHubService } from '@/trip-hub/service';

/**
 * Your trips: the ones you made and the ones you were added to.
 */

export const metadata: Metadata = {
  title: 'Your trips',
  description: 'The trips you made or were added to, with shared costs and emergency details.',
};

const COUNTRY_OPTIONS = [
  { value: '', label: 'Not sure yet' },
  ...[...COUNTRIES]
    .sort((a, b) => a.shortName.localeCompare(b.shortName))
    .map((country) => ({ value: country.iso2, label: country.name })),
];

export default async function TripsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const repositories = getRepositories();
  const trips = await new TripHubService({ repositories }).listTrips(user.id);
  const cards = await Promise.all(
    trips.map(async (trip) => ({
      trip,
      members: (await repositories.trips.listMembers(trip.id)).map((member) => member.name),
      ...presentTrip(trip),
    })),
  );

  return (
    <div className="flex flex-col gap-10 lg:gap-12">
      <PageHeader
        eyebrow="Trips"
        title="Your trips"
        description="The plan, the shared costs and the emergency details for a trip, in one place. Nothing is marked as booked unless you say so."
      />

      <section aria-labelledby="trip-list-heading" className="flex flex-col gap-5">
        <h2 id="trip-list-heading" className="sr-only">
          {cards.length === 0
            ? 'No trips yet'
            : `${cards.length} ${cards.length === 1 ? 'trip' : 'trips'}`}
        </h2>

        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Your trips">
          {cards.map(({ trip, members, country, dates, nights, picture }, index) => (
            <TripCard
              key={trip.id}
              id={trip.id}
              name={trip.name}
              destination={trip.destination}
              country={country}
              dates={dates}
              nights={nights}
              sharedWithYou={trip.ownerId !== user.id}
              members={members}
              picture={picture}
              priority={index < 3}
            />
          ))}

          <li className="min-w-0">
            <a
              href="#new-trip"
              className="border-border-strong text-ink-muted hover:text-ink hover:bg-surface-raised ease-standard duration-quick flex h-full min-h-[14rem] flex-col items-center justify-center gap-3 rounded-(--radius-card) border border-dashed p-6 text-center transition-colors"
            >
              <span
                aria-hidden="true"
                className="border-border-strong grid size-11 place-items-center rounded-full border"
              >
                <Icon name="plus" size={1.25} />
              </span>
              <span className="text-ink text-base font-medium">New trip</span>
              <span className="max-w-[26ch] text-sm leading-relaxed">
                {cards.length === 0
                  ? 'You have no trips yet. Start one and keep everything about it together.'
                  : 'Start another plan, with its own costs and contacts.'}
              </span>
            </a>
          </li>
        </ul>
      </section>

      <section
        id="new-trip"
        aria-labelledby="new-trip-heading"
        className="border-border bg-surface-raised flex scroll-mt-24 flex-col gap-6 rounded-(--radius-shell) border p-6 sm:p-8"
      >
        <div>
          <h2 id="new-trip-heading" className="font-display text-display-sm text-ink">
            Create a trip
          </h2>
          <p className="text-ink-muted mt-2 max-w-[60ch] text-sm leading-relaxed">
            Choose the country to see its local emergency numbers on the trip.
          </p>
        </div>

        <ActionForm
          action={createTripAction}
          submitLabel="Create trip"
          pendingLabel="Creating…"
          savedMessage="Created."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Trip name" name="name" required maxLength={80} autoComplete="off" />
            <Field
              label="Destination"
              name="destination"
              required
              maxLength={80}
              autoComplete="off"
            />
            <Select
              label="Destination country"
              name="destinationCountry"
              options={COUNTRY_OPTIONS}
              hint="Used to show local emergency numbers."
            />
            <Field
              label="Your name on this trip"
              name="ownerName"
              required
              maxLength={80}
              hint="What the people you share costs with will see."
              autoComplete="off"
            />
            <Field label="Start date" name="startDate" type="date" />
            <Field label="End date" name="endDate" type="date" />
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
