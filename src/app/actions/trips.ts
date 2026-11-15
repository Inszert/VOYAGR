'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/current-user';
import { getRepositories } from '@/db';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import {
  parseContactForm,
  parseExpenseForm,
  parsePlanItemForm,
  parseTripDetails,
  parseTripForm,
} from '@/trip-hub/parse';
import { TripHubService } from '@/trip-hub/service';
import { PLAN_ITEM_STATUSES, type PlanItemStatus } from '@/trip-hub/types';

/**
 * The trip hub's Server Actions.
 *
 * Server Actions rather than route handlers, for the CSRF reason in
 * `src/app/actions/auth.ts`: Next checks the request's Origin against the
 * host, and the session cookie is `sameSite: lax`. On top of that, every action
 * here starts from `getCurrentUser()` and hands the user's id to
 * `TripHubService`, which decides access. A trip id in a form is a claim, not
 * an authorisation.
 *
 * Nothing here logs a name, a phone number or a description; ids only.
 */

const log = getLogger('app.trip-actions');

export interface TripFormState {
  readonly error?: string;
  readonly saved?: boolean;
}

const SIGN_IN = 'Sign in to use your trips.';

function service(): TripHubService {
  return new TripHubService({ repositories: getRepositories() });
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** What the person may be told: the public message of an AppError, never its detail. */
function messageFor(error: unknown): string {
  if (error instanceof AppError && error.code !== 'INTERNAL_ERROR') return error.publicMessage;
  throw error;
}

async function run(
  formData: FormData,
  work: (userId: string, tripId: string) => Promise<void>,
  path?: (tripId: string) => string,
): Promise<TripFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: SIGN_IN };

  const tripId = field(formData, 'tripId');
  try {
    await work(user.id, tripId);
  } catch (error) {
    return { error: messageFor(error) };
  }

  revalidatePath(path ? path(tripId) : `/trips/${tripId}`);
  return { saved: true };
}

// --- Trips -----------------------------------------------------------------

export async function createTripAction(
  _previous: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: SIGN_IN };

  const parsed = parseTripForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const trip = await service().createTrip(user.id, parsed.value);
  log.info({ userId: user.id, tripId: trip.id }, 'trip created');

  redirect(`/trips/${trip.id}`);
}

/** Rename the trip, change where it goes or move its dates. */
export async function updateTripAction(
  _previous: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const parsed = parseTripDetails(formData);
  if (!parsed.ok) return { error: parsed.error };

  const result = await run(formData, async (userId, tripId) => {
    await service().updateTrip(userId, tripId, parsed.value);
  });

  // The list shows the name and the dates too.
  if (result.saved) revalidatePath('/trips');
  return result;
}

export async function deleteTripAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  await service().deleteTrip(user.id, field(formData, 'tripId'));
  log.info({ userId: user.id }, 'trip deleted');

  revalidatePath('/trips');
  redirect('/trips');
}

export async function addMemberAction(
  _previous: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  return run(formData, (userId, tripId) =>
    service().addMember(userId, tripId, {
      name: field(formData, 'name'),
      accountEmail: field(formData, 'accountEmail') || null,
    }),
  );
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const tripId = field(formData, 'tripId');
  await service().removeMember(user.id, tripId, field(formData, 'memberId'));
  revalidatePath(`/trips/${tripId}`);
}

// --- Plan ------------------------------------------------------------------

export async function addPlanItemAction(
  _previous: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const parsed = parsePlanItemForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  return run(formData, async (userId, tripId) => {
    await service().addPlanItem(userId, tripId, parsed.value);
  });
}

export async function updatePlanItemAction(
  _previous: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const parsed = parsePlanItemForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  return run(formData, async (userId, tripId) => {
    await service().updatePlanItem(userId, tripId, field(formData, 'itemId'), parsed.value);
  });
}

/**
 * "I have booked this."
 *
 * The only road to `booked`, and it starts with the traveller pressing a
 * button. A click on a partner link never reaches here.
 */
export async function setPlanItemStatusAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const status = field(formData, 'status') as PlanItemStatus;
  if (!PLAN_ITEM_STATUSES.includes(status)) return;

  const tripId = field(formData, 'tripId');
  await service().setPlanItemStatus(user.id, tripId, field(formData, 'itemId'), status);
  revalidatePath(`/trips/${tripId}`);
}

export async function removePlanItemAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const tripId = field(formData, 'tripId');
  await service().removePlanItem(user.id, tripId, field(formData, 'itemId'));
  revalidatePath(`/trips/${tripId}`);
}

export type AddToPlanResult =
  { readonly ok: true; readonly itemId: string } | { readonly ok: false; readonly error: string };

/**
 * "Add to my plan", for the UI to wire to a partner offer or a trip card.
 *
 * Creates an `idea`, never a `booked`: we cannot see what happens on a
 * partner's site, so nothing is added silently and nothing claims a booking.
 * Only the offer id and trip id come from the caller; the title and link come
 * from the partner registry.
 */
export async function addToMyPlanAction(input: {
  readonly offerId: string;
  readonly tripId: string;
}): Promise<AddToPlanResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: SIGN_IN };

  try {
    const item = await service().addPartnerOfferToPlan(user.id, input.tripId, input.offerId);
    revalidatePath(`/trips/${input.tripId}`);
    return { ok: true, itemId: item.id };
  } catch (error) {
    return { ok: false, error: messageFor(error) };
  }
}

// --- Expenses --------------------------------------------------------------

export async function addExpenseAction(
  _previous: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: SIGN_IN };

  const tripId = field(formData, 'tripId');
  try {
    const { members } = await service().access(user.id, tripId);
    const parsed = parseExpenseForm(
      formData,
      members.map((member) => member.id),
    );
    if (!parsed.ok) return { error: parsed.error };

    await service().addExpense(user.id, tripId, parsed.value);
  } catch (error) {
    return { error: messageFor(error) };
  }

  revalidatePath(`/trips/${tripId}`);
  return { saved: true };
}

export async function updateExpenseAction(
  _previous: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: SIGN_IN };

  const tripId = field(formData, 'tripId');
  try {
    const { members } = await service().access(user.id, tripId);
    const parsed = parseExpenseForm(
      formData,
      members.map((member) => member.id),
    );
    if (!parsed.ok) return { error: parsed.error };

    await service().updateExpense(user.id, tripId, field(formData, 'expenseId'), parsed.value);
  } catch (error) {
    return { error: messageFor(error) };
  }

  revalidatePath(`/trips/${tripId}`);
  return { saved: true };
}

export async function removeExpenseAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const tripId = field(formData, 'tripId');
  await service().removeExpense(user.id, tripId, field(formData, 'expenseId'));
  revalidatePath(`/trips/${tripId}`);
}

// --- Emergency contacts -----------------------------------------------------

export async function addContactAction(
  _previous: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: SIGN_IN };

  const parsed = parseContactForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  await service().addContact(user.id, parsed.value);
  log.info({ userId: user.id }, 'emergency contact added');

  revalidatePath('/trips', 'layout');
  return { saved: true };
}

export async function removeContactAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  await service().removeContact(user.id, field(formData, 'contactId'));
  revalidatePath('/trips', 'layout');
}
