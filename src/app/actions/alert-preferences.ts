'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/auth/current-user';
import { getRepositories } from '@/db';
import { getLogger } from '@/lib/logger';
import { parseAlertPreferences } from '@/notifications/alert-preferences';

/**
 * Saving which price-drop alerts the user wants.
 *
 * Authorisation is checked here, not in the page that renders the form: an
 * action is an endpoint, and anyone can post to it.
 */

const log = getLogger('app.alert-preferences-actions');

export interface AlertPreferencesFormState {
  readonly error?: string;
  readonly saved?: boolean;
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '');
}

export async function saveAlertPreferencesAction(
  _previous: AlertPreferencesFormState,
  formData: FormData,
): Promise<AlertPreferencesFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sign in to save your alert settings.' };

  const parsed = parseAlertPreferences({
    homeAirport: text(formData, 'homeAirport'),
    destinations: text(formData, 'destinations'),
    budget: text(formData, 'budget'),
    currency: text(formData, 'currency'),
    earliestDeparture: text(formData, 'earliestDeparture'),
    latestDeparture: text(formData, 'latestDeparture'),
    // An unchecked box submits nothing, which has to read as off.
    priceDropAlerts: formData.get('priceDropAlerts') === 'on',
  });

  if (!parsed.ok) return { error: parsed.error };

  await getRepositories().alertPreferences.save(user.id, parsed.value);
  log.info({ userId: user.id }, 'alert preferences saved');

  revalidatePath('/account');
  return { saved: true };
}
