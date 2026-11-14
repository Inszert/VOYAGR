import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, EmptyState, Field, Select } from '@/components/ui';
import { ActionForm } from '@/components/trips/action-form';
import { createTripAction } from '@/app/actions/trips';
import { getCurrentUser } from '@/auth/current-user';
import { getRepositories } from '@/db';
import { shortDateRange } from '@/lib/display-date';
import { COUNTRIES } from '@/discovery/countries';
import { TripHubService } from '@/trip-hub/service';

/**
 * Your trips: the ones you made and the ones you were added to.
 */

export const metadata: Metadata = { title: 'Your trips' };

const COUNTRY_OPTIONS = [
  { value: '', label: 'Not sure yet' },
  ...[...COUNTRIES]
    .sort((a, b) => a.shortName.localeCompare(b.shortName))
    .map((country) => ({ value: country.iso2, label: country.shortName })),
];

export default async function TripsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const trips = await new TripHubService({ repositories: getRepositories() }).listTrips(user.id);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display-md text-ink">Your trips</h1>
        <p className="text-ink-muted mt-3 max-w-2xl">
          Keep the plan, the shared costs and the emergency details for a trip in one place. Nothing
          here is marked as booked unless you say so.
        </p>
      </div>

      {trips.length === 0 ? (
        <EmptyState title="No trips yet" description="Create one below to start a plan." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" aria-label="Your trips">
          {trips.map((trip) => (
            <li key={trip.id}>
              <Card>
                <h2 className="text-ink text-lg font-medium">
                  <Link href={`/trips/${trip.id}`} className="underline-offset-4 hover:underline">
                    {trip.name}
                  </Link>
                </h2>
                <p className="text-ink-muted mt-1 text-sm">
                  {trip.destination}
                  {trip.startDate && trip.endDate
                    ? ` · ${shortDateRange(trip.startDate, trip.endDate)}`
                    : ''}
                  {trip.ownerId === user.id ? '' : ' · shared with you'}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card as="section" aria-labelledby="new-trip-heading">
        <h2 id="new-trip-heading" className="text-ink mb-4 text-lg font-medium">
          Create a trip
        </h2>
        <ActionForm action={createTripAction} submitLabel="Create trip" savedMessage="Created.">
          <div className="grid gap-4 sm:grid-cols-2">
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
      </Card>
    </div>
  );
}
