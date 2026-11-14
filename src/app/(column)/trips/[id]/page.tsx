import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Button } from '@/components/ui';
import { EmergencySection } from '@/components/trips/emergency-section';
import { ExpensesSection } from '@/components/trips/expenses-section';
import { PlanSection } from '@/components/trips/plan-section';
import { deleteTripAction } from '@/app/actions/trips';
import { getCurrentUser } from '@/auth/current-user';
import { getRepositories } from '@/db';
import { findCountryByIso2 } from '@/discovery/countries';
import { AppError } from '@/lib/errors';
import { shortDateRange } from '@/lib/display-date';
import { emergencyInfoFor } from '@/trip-hub/emergency';
import { TripHubService } from '@/trip-hub/service';

/**
 * One trip: the plan, the shared expenses and the emergency details.
 *
 * Access is decided by `TripHubService`, not here. Someone who is not on the
 * trip gets the same 404 as for a trip that does not exist, so ids cannot be
 * probed.
 */

export const metadata: Metadata = { title: 'Trip' };

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const { id } = await params;
  const service = new TripHubService({ repositories: getRepositories() });

  let access;
  try {
    access = await service.access(user.id, id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const { trip, members, isOwner, self } = access;
  const [items, ledger, contacts] = await Promise.all([
    service.listPlan(user.id, id),
    service.ledger(user.id, id),
    service.contactsFor(user.id, id),
  ]);

  const country = trip.destinationCountry ? findCountryByIso2(trip.destinationCountry) : null;
  const info = emergencyInfoFor(trip.destinationCountry);

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="font-display text-display-md text-ink">{trip.name}</h1>
        <p className="text-ink-muted mt-3">
          {trip.destination}
          {trip.startDate && trip.endDate
            ? ` · ${shortDateRange(trip.startDate, trip.endDate)}`
            : ''}
        </p>
        <nav aria-label="Trip sections" className="mt-4 flex flex-wrap gap-4 text-sm">
          <a href="#plan-heading" className="text-ink underline underline-offset-4">
            Plan
          </a>
          <a href="#expenses-heading" className="text-ink underline underline-offset-4">
            Expenses
          </a>
          <a href="#emergency-heading" className="text-ink underline underline-offset-4">
            Emergency
          </a>
        </nav>
      </header>

      <PlanSection tripId={trip.id} items={items} />

      <ExpensesSection
        tripId={trip.id}
        ledger={ledger}
        members={members}
        isOwner={isOwner}
        selfId={self.id}
        defaultCurrency="EUR"
      />

      <EmergencySection
        tripId={trip.id}
        countryName={country?.shortName ?? null}
        info={info}
        contacts={contacts}
      />

      {isOwner ? (
        <form action={deleteTripAction}>
          <input type="hidden" name="tripId" value={trip.id} />
          <Button type="submit" variant="danger">
            Delete this trip
          </Button>
          <p className="text-ink-muted mt-2 text-sm">
            Removes the plan and the expenses for everyone on the trip. This cannot be undone.
          </p>
        </form>
      ) : null}
    </div>
  );
}
