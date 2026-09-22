'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getEnv } from '@/lib/env';
import {
  DATA_SOURCE_COOKIE,
  dataSourceSwitchEnabled,
  parseDataSource,
} from '@/providers/data-source';
import { getLogger } from '@/lib/logger';

/**
 * Change which data source serves this browser.
 *
 * A Server Action rather than a route handler, for the reason the auth
 * actions give: Next verifies the request origin for an action, which is the
 * CSRF protection a cookie-setting POST needs.
 *
 * It sets a cookie and revalidates. It does not fetch anything, and it holds
 * no credential - the browser never learns which vendor is configured, let
 * alone a key for one. The only thing crossing the wire is the word `api` or
 * the word `mock`.
 */

const log = getLogger('app.data-source');

export async function setDataSourceAction(formData: FormData): Promise<void> {
  // Checked on the server, not just hidden in the UI. A flag that only
  // removes a control leaves the behaviour reachable by anyone who posts.
  if (!dataSourceSwitchEnabled(getEnv())) return;

  const source = parseDataSource(String(formData.get('source') ?? ''));
  if (!source) return;

  const store = await cookies();

  store.set(DATA_SOURCE_COOKIE, source, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // A session cookie: the switch is a thing you do while working, not a
    // preference you set once and forget you set.
    ...(getEnv().NODE_ENV === 'production' ? { secure: true } : {}),
  });

  log.info({ source }, 'data source switched');

  /*
   * Everything, because every page that prices anything is affected: the
   * globe's snapshot, the trip results, the stay search. The pages are
   * dynamic already, so this is about dropping the router cache in the
   * browser rather than about a build artefact.
   */
  revalidatePath('/', 'layout');
}
