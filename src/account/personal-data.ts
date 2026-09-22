import type { Repositories } from '@/db/repository';

/**
 * Everything Voyagr holds about one person, as a file they can take away.
 *
 * Built by listing what is actually stored rather than by serialising the
 * database, because those are different things: the database also holds a
 * password hash, session tokens and push-subscription keys, and none of
 * those belong in a download. An export that leaks a session token turns a
 * privacy feature into an account-takeover vector.
 *
 * **The exclusions are the design.** Anything not listed in `PersonalExport`
 * is excluded on purpose, and adding a field to a record does not silently
 * add it here - each one is named.
 */

export interface PersonalExport {
  /** What this file is, so it is readable without our documentation. */
  readonly meta: {
    readonly format: 'voyagr.personal-export';
    readonly version: 1;
    readonly generatedAt: string;
    readonly note: string;
  };
  readonly account: {
    readonly id: string;
    readonly email: string;
    readonly plan: string;
    readonly createdAt: string;
  };
  readonly preferences: unknown;
  readonly savedSearches: readonly unknown[];
  readonly travelWatches: readonly unknown[];
  readonly priceObservations: readonly unknown[];
  readonly notifications: readonly unknown[];
}

/**
 * Collect one user's data.
 *
 * Takes the user id from a verified session, never from a request
 * parameter - the whole file is personal data and an id in a query string
 * would be the most obvious possible IDOR.
 */
export async function buildPersonalExport(
  repositories: Repositories,
  userId: string,
  now: () => Date = () => new Date(),
): Promise<PersonalExport | null> {
  const user = await repositories.users.findById(userId);
  if (!user) return null;

  const watches = await repositories.travelWatches.listByUser(userId);

  /*
   * Observations are reached through the watches, which is also what scopes
   * them: there is no path here that could return a row belonging to anybody
   * else, because every watch id came from this user's own list.
   */
  const observations = (
    await Promise.all(watches.map((watch) => repositories.priceHistory.listForWatch(watch.id)))
  ).flat();

  return {
    meta: {
      format: 'voyagr.personal-export',
      version: 1,
      generatedAt: now().toISOString(),
      note: 'Everything Voyagr stores about this account. Passwords, session tokens and push-notification keys are deliberately excluded.',
    },
    account: {
      id: user.id,
      email: user.email,
      plan: user.plan,
      createdAt: user.createdAt,
    },
    preferences: (await repositories.preferences.find(userId)) ?? null,
    savedSearches: await repositories.tripSearches.listByUser(userId),
    travelWatches: watches,
    priceObservations: observations,
    notifications: await repositories.notifications.listByUser(userId),
  };
}
