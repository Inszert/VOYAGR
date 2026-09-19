'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/auth/current-user';
import { parseSearchForm } from '@/search/schema';
import { WatchService } from '@/watches/service';
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

  const parsed = parseSearchForm(values);
  if (!parsed.ok) {
    return { error: 'That search is no longer valid, so it was not saved.' };
  }

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
