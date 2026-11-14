'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/auth/current-user';
import { listPlaceableDestinations } from '@/search/destination-names';
import { parseSearchForm } from '@/search/schema';
import { resolveWorldRegion } from '@/search/world-regions';
import { WatchService } from '@/watches/service';
import { refreshWatch } from '@/watches/refresh';
import { getRepositories } from '@/db';
import { isAppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import type { TravelWatchRecord } from '@/db/repository';

/**
 * Saved search and watch actions.
 *
 * Each one re-derives the current user and checks ownership through the
 * service. An action is an endpoint: that a page only renders a button for
 * watches you own says nothing about what can be posted to it.
 */

const log = getLogger('app.watch-actions');

export interface WatchFormState {
  readonly error?: string;
  readonly saved?: boolean;
}

function watchService(): WatchService {
  return new WatchService({ repositories: getRepositories() });
}

function publicMessage(error: unknown, fallback: string): string {
  if (isAppError(error)) return error.publicMessage;
  log.error({ err: error }, 'unexpected watch failure');
  return fallback;
}

/**
 * Save the search currently on screen and start watching it.
 *
 * The form posts back the same query string the search ran with, and it is
 * re-validated here rather than trusted. A saved search is replayed unattended
 * for weeks; storing an unvalidated profile would mean discovering the problem
 * in a background worker at three in the morning.
 */
export async function saveSearchAction(
  _previous: WatchFormState,
  formData: FormData,
): Promise<WatchFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sign in to save a search.' };

  const query = String(formData.get('query') ?? '');
  const name = String(formData.get('name') ?? '');

  const values: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(query)) values[key] = value;

  return saveAndWatch(user, values, name, 'That search is no longer valid, so it was not saved.');
}

/**
 * Validate a search, save it and start watching it.
 *
 * Shared by the two ways a watch begins - saving the search on screen, and
 * describing a trip on the watches page - so both go through exactly the
 * same parser and the same plan limits.
 */
async function saveAndWatch(
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  values: Record<string, string>,
  name: string,
  invalid: string,
): Promise<WatchFormState> {
  // A saved watch may equally have been "anywhere".
  const parsed = parseSearchForm(values, listPlaceableDestinations(), resolveWorldRegion);
  if (!parsed.ok) return { error: invalid };

  try {
    const service = watchService();
    const search = await service.saveSearch(user, {
      name,
      profile: parsed.value.request.profile,
      destinations: parsed.value.request.destinations,
    });

    await service.startWatching(user, search.id);
  } catch (error) {
    return { error: publicMessage(error, 'Could not save that search.') };
  }

  revalidatePath('/watches');
  return { saved: true };
}

/**
 * A watch added by hand, from the watches page.
 *
 * The few things a person has to say - where from, where to, when and for how
 * much - and the rest set to what the form shows next to them. It goes
 * through the same parser as a search, so what cannot be searched cannot be
 * watched either, and the reason comes back in the same words.
 */
export async function addWatchAction(
  _previous: WatchFormState,
  formData: FormData,
): Promise<WatchFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sign in to watch a trip.' };

  const field = (key: string) => String(formData.get(key) ?? '').trim();
  const budget = field('maxBudget');

  const values: Record<string, string> = {
    origins: field('origins').toUpperCase(),
    destinations: field('destinations') || 'anywhere',
    flexibility: 'custom',
    earliestDeparture: field('earliestDeparture'),
    latestReturn: field('latestReturn'),
    minNights: field('minNights') || '3',
    maxNights: field('maxNights') || '7',
    passengers: field('passengers') || '2',
    currency: 'EUR',
    // One figure on this form: the most the whole trip may cost, which is
    // also what it is planned around.
    targetBudget: budget,
    maxBudget: budget,
    travelStyle: 'balanced',
    optimisationMode: 'best_value',
  };

  const name =
    field('name') ||
    `${values.destinations === 'anywhere' ? 'Anywhere' : values.destinations} from ${values.origins}`;

  return saveAndWatch(
    user,
    values,
    name,
    'Those details do not make a trip we can search. Check the airports, the dates and the budget.',
  );
}

/** Stop watching a trip, and forget it and everything it recorded. */
export async function deleteWatchAction(
  _previous: WatchFormState,
  formData: FormData,
): Promise<WatchFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sign in to manage your watches.' };

  try {
    await watchService().deleteWatch(user, String(formData.get('watchId') ?? ''));
  } catch (error) {
    return { error: publicMessage(error, 'Could not delete that watch.') };
  }

  revalidatePath('/watches');
  return { saved: true };
}

/**
 * Check a watch now, rather than at its next scheduled time.
 *
 * The same refresh the background worker runs - the same search, the same
 * price history, the same alert rules - started by the owner instead of the
 * clock. Only an active watch runs; a paused one says so.
 */
export async function checkWatchNowAction(
  _previous: WatchFormState,
  formData: FormData,
): Promise<WatchFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sign in to manage your watches.' };

  const watchId = String(formData.get('watchId') ?? '');
  const repositories = getRepositories();
  const watch = await repositories.travelWatches.findById(watchId);

  if (!watch || watch.userId !== user.id) return { error: 'That watch no longer exists.' };
  if (watch.status !== 'active') return { error: 'Resume this watch to check it.' };

  const result = await refreshWatch(watchId, { repositories });

  revalidatePath('/watches');
  return result.ran ? { saved: true } : { error: 'The check could not run. Try again shortly.' };
}

async function changeStatus(
  watchId: string,
  status: TravelWatchRecord['status'],
): Promise<WatchFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sign in to manage your watches.' };

  try {
    await watchService().setStatus(user, watchId, status);
  } catch (error) {
    return { error: publicMessage(error, 'Could not update that watch.') };
  }

  revalidatePath('/watches');
  return { saved: true };
}

export async function pauseWatchAction(
  _previous: WatchFormState,
  formData: FormData,
): Promise<WatchFormState> {
  return changeStatus(String(formData.get('watchId') ?? ''), 'paused');
}

export async function resumeWatchAction(
  _previous: WatchFormState,
  formData: FormData,
): Promise<WatchFormState> {
  return changeStatus(String(formData.get('watchId') ?? ''), 'active');
}

export async function archiveWatchAction(
  _previous: WatchFormState,
  formData: FormData,
): Promise<WatchFormState> {
  return changeStatus(String(formData.get('watchId') ?? ''), 'archived');
}
