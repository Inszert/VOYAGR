'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/auth/current-user';
import { explicitPreferencesSchema } from '@/auth/preferences';
import { getRepositories } from '@/db';
import { getLogger } from '@/lib/logger';

/**
 * Saving explicit preferences.
 *
 * Only ever writes the `explicit` side. What the system infers is written by
 * the system, and a user saving their home airport must not silently overwrite
 * or erase it (specification section 31.7).
 */

const log = getLogger('app.preferences-actions');

export interface PreferencesFormState {
  readonly error?: string;
  readonly saved?: boolean;
}

/** An unchecked checkbox submits nothing, which has to read as false. */
function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === 'on';
}

function optionalText(formData: FormData, name: string): string | undefined {
  const value = String(formData.get(name) ?? '').trim();
  return value === '' ? undefined : value;
}

export async function savePreferencesAction(
  _previous: PreferencesFormState,
  formData: FormData,
): Promise<PreferencesFormState> {
  const user = await getCurrentUser();

  // Authorisation is checked here, not in the page that renders the form. An
  // action is an endpoint: anyone can post to it.
  if (!user) {
    return { error: 'Sign in to save your preferences.' };
  }

  const airports = optionalText(formData, 'homeAirports');
  const currency = optionalText(formData, 'currency');
  const passengers = optionalText(formData, 'defaultPassengers');

  const parsed = explicitPreferencesSchema.safeParse({
    ...(airports
      ? {
          homeAirports: airports
            .split(/[\s,]+/)
            .filter(Boolean)
            .map((code) => code.toUpperCase()),
        }
      : {}),
    ...(currency ? { currency: currency.toUpperCase() } : {}),
    ...(passengers ? { defaultPassengers: Number(passengers) } : {}),
    travelStyle: String(formData.get('travelStyle') ?? 'balanced'),
    optimisationMode: String(formData.get('optimisationMode') ?? 'best_value'),
    requireDirectFlights: checkbox(formData, 'requireDirectFlights'),
    requireCheckedBaggage: checkbox(formData, 'requireCheckedBaggage'),
    requireFreeCancellation: checkbox(formData, 'requireFreeCancellation'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Those preferences were not valid.' };
  }

  await getRepositories().preferences.save(user.id, { explicit: parsed.data });
  log.info({ userId: user.id }, 'explicit preferences saved');

  revalidatePath('/account');
  return { saved: true };
}
