import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Button, Disclosure, Field, Icon, PlacePicture, Select } from '@/components/ui';
import { initials } from '@/components/discovery/initials';
import { ActionForm } from '@/components/trips/action-form';
import { EmergencySection } from '@/components/trips/emergency-section';
import { ExpensesSection } from '@/components/trips/expenses-section';
import { InviteControl } from '@/components/trips/invite-control';
import { MemberAvatars } from '@/components/trips/member-avatars';
import { PlanSection } from '@/components/trips/plan-section';
import { isTripTab } from '@/components/trips/trip-tab';
import { TripTabs } from '@/components/trips/trip-tabs';
import { deleteTripAction, updateTripAction } from '@/app/actions/trips';
import { getCurrentUser } from '@/auth/current-user';
import { getRepositories } from '@/db';
import { COUNTRIES, findCountryByIso2 } from '@/discovery/countries';
import { AppError } from '@/lib/errors';
import { emergencyInfoFor } from '@/trip-hub/emergency';
import { presentTrip } from '@/trip-hub/present';
import { TripHubService } from '@/trip-hub/service';

/**
 * One trip: the plan, the shared money and the emergency details.
 *
 * Access is decided by `TripHubService`, not here. Someone who is not on the
 * trip gets the same 404 as for a trip that does not exist, so ids cannot be
 * probed.
 */

export const metadata: Metadata = { title: 'Trip' };

const COUNTRY_OPTIONS = [
  { value: '', label: 'Not sure yet' },
  ...[...COUNTRIES]
    .sort((a, b) => a.shortName.localeCompare(b.shortName))
    .map((country) => ({ value: country.iso2, label: country.name })),
];

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const { id } = await params;
  const { tab } = await searchParams;
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

  const activeInvites = isOwner ? await service.activeInviteCount(user.id, id) : 0;
  const country = trip.destinationCountry ? findCountryByIso2(trip.destinationCountry) : null;
  const info = emergencyInfoFor(trip.destinationCountry);
  const { dates, nights, picture } = presentTrip(trip);

  return (
    <div className="flex flex-col gap-8 lg:gap-10">
      <Link
        href="/trips"
        className="text-ink-muted hover:text-ink ease-standard duration-quick -mb-2 inline-flex min-h-11 w-fit items-center gap-1.5 text-sm transition-colors"
      >
        <Icon name="chevron-left" size={1} />
        All trips
      </Link>

      <header className="relative isolate overflow-hidden rounded-(--radius-shell) border border-(--color-border)">
        <div className="@container relative h-60 sm:h-72 lg:h-80">
          <PlacePicture
            picture={picture}
            initials={initials(country?.name ?? trip.destination)}
            priority
            sizes="(min-width: 1280px) 1216px, 100vw"
            className="absolute inset-0"
          />
          <div
            aria-hidden="true"
            className="from-bg via-bg/50 absolute inset-0 bg-gradient-to-t to-transparent"
          />

          <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 p-5 sm:p-8">
            <div className="min-w-0">
              <p className="text-ink-muted text-[0.6875rem] font-medium tracking-[0.18em] uppercase">
                {country ? `${trip.destination}, ${country.name}` : trip.destination}
              </p>
              <h1 className="font-display text-display-sm sm:text-display-md text-ink mt-2 text-balance">
                {trip.name}
              </h1>
              <p className="text-ink mt-2 text-sm tabular-nums">
                {dates ? (
                  <>
                    {dates}
                    {nights ? <span className="text-ink-muted"> &middot; {nights}</span> : null}
                  </>
                ) : (
                  <span className="text-ink-muted">Dates not set</span>
                )}
              </p>
            </div>
            <MemberAvatars names={members.map((member) => member.name)} />
          </div>
        </div>
      </header>

      <Disclosure summary="Edit trip details" className="max-w-3xl">
        <ActionForm
          action={updateTripAction}
          submitLabel="Save details"
          savedMessage="Trip updated."
          hidden={{ tripId: trip.id }}
          resetOnSave={false}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Trip name"
              name="name"
              required
              maxLength={80}
              autoComplete="off"
              defaultValue={trip.name}
            />
            <Field
              label="Destination"
              name="destination"
              required
              maxLength={80}
              autoComplete="off"
              defaultValue={trip.destination}
            />
            <Select
              label="Destination country"
              name="destinationCountry"
              options={COUNTRY_OPTIONS}
              defaultValue={trip.destinationCountry ?? ''}
              hint="Used to show local emergency numbers."
            />
            <div className="hidden sm:block" />
            <Field
              label="Start date"
              name="startDate"
              type="date"
              defaultValue={trip.startDate ?? ''}
            />
            <Field label="End date" name="endDate" type="date" defaultValue={trip.endDate ?? ''} />
          </div>
        </ActionForm>
      </Disclosure>

      <TripTabs
        initial={isTripTab(tab) ? tab : 'plan'}
        plan={<PlanSection tripId={trip.id} items={items} />}
        money={
          <ExpensesSection
            tripId={trip.id}
            ledger={ledger}
            members={members}
            isOwner={isOwner}
            selfId={self.id}
            defaultCurrency="EUR"
          />
        }
        emergency={
          <EmergencySection
            tripId={trip.id}
            countryName={country?.name ?? null}
            info={info}
            contacts={contacts}
          />
        }
      />

      {isOwner ? <InviteControl tripId={trip.id} activeCount={activeInvites} /> : null}

      {isOwner ? (
        <form action={deleteTripAction} className="border-border mt-4 border-t pt-8">
          <input type="hidden" name="tripId" value={trip.id} />
          <p className="text-ink-muted mb-3 max-w-[60ch] text-sm leading-relaxed">
            Removes the plan and the expenses for everyone on the trip. This cannot be undone.
          </p>
          <Button type="submit" variant="danger">
            Delete this trip
          </Button>
        </form>
      ) : null}
    </div>
  );
}
