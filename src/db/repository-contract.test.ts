import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { buildProfile } from '@/core/trip/test-support';
import { AppError } from '@/lib/errors';
import { resetEnvCache } from '@/lib/env';
import { createMemoryRepositories } from './memory';
import { createPostgresRepositories } from './postgres';
import { closePool, query } from './client';
import type { Repositories } from './repository';

/**
 * The repository contract.
 *
 * One suite, run against every backend. Two implementations of an interface
 * that are only ever tested separately are two different interfaces wearing one
 * name, and the bug that finds you is always in the one the tests skipped.
 *
 * Postgres runs only when `TEST_DATABASE_URL` is set and the migrations have
 * been applied. It is skipped otherwise rather than failed: the suite must keep
 * passing with no database, which is the property the whole foundation rests
 * on. A skipped backend is reported, never silently treated as a pass.
 */

const POSTGRES_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

interface Backend {
  readonly name: string;
  readonly create: () => Repositories;
  /** Empty the store between tests. */
  readonly reset: () => Promise<void>;
}

const backends: Backend[] = [
  {
    name: 'memory',
    create: createMemoryRepositories,
    reset: async () => undefined,
  },
];

if (POSTGRES_URL) {
  process.env.DATABASE_URL = POSTGRES_URL;

  // Imports are hoisted and evaluated before this line, and one of them builds
  // a logger, which memoises the environment. Without dropping that cache the
  // pool would be asked for a DATABASE_URL that was read before it was set.
  resetEnvCache();

  backends.push({
    name: 'postgres',
    create: createPostgresRepositories,
    reset: async () => {
      // Truncate rather than delete: cascades clear every dependent table, and
      // a test must not inherit the previous one's rows.
      await query(
        `TRUNCATE users, user_credentials, sessions, user_preferences, trip_searches,
                  travel_watches, price_history, notifications, push_subscriptions
         RESTART IDENTITY CASCADE`,
      );
    },
  });

  afterAll(async () => {
    await closePool();
  });
}

describe('backend coverage', () => {
  it('always covers the in-memory backend', () => {
    expect(backends.map((backend) => backend.name)).toContain('memory');
  });

  /*
   * Skipped rather than absent when no database is configured, so the gap shows
   * up in the test output as a skipped test instead of as silence. Run it with:
   *
   *   TEST_DATABASE_URL=postgresql://... npm run db:migrate
   *   TEST_DATABASE_URL=postgresql://... npm test
   */
  it.skipIf(!POSTGRES_URL)('covers the postgres backend when one is configured', () => {
    expect(backends.map((backend) => backend.name)).toContain('postgres');
  });
});

describe.each(backends)('$name repository contract', (backend) => {
  let repositories: Repositories;

  beforeEach(async () => {
    repositories = backend.create();
    await backend.reset();
  });

  /** Most entities need an owner; this is the shortest way to have one. */
  async function aUser(email = `user-${randomUUID()}@example.invalid`) {
    return repositories.users.create({ id: randomUUID(), email, plan: 'free' });
  }

  describe('users', () => {
    it('round-trips a user', async () => {
      const created = await aUser('Round.Trip@example.invalid');

      expect(created.plan).toBe('free');
      expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(await repositories.users.findById(created.id)).toEqual(created);
    });

    it('finds by email regardless of case', async () => {
      const created = await aUser('Mixed.Case@Example.Invalid');

      expect(await repositories.users.findByEmail('mixed.case@example.invalid')).toEqual(created);
      expect(await repositories.users.findByEmail('MIXED.CASE@EXAMPLE.INVALID')).toEqual(created);
    });

    it('refuses a duplicate email', async () => {
      await aUser('taken@example.invalid');

      await expect(
        repositories.users.create({
          id: randomUUID(),
          email: 'taken@example.invalid',
          plan: 'free',
        }),
      ).rejects.toThrow(AppError);
    });

    it('returns null rather than throwing for an unknown id or email', async () => {
      expect(await repositories.users.findById(randomUUID())).toBeNull();
      expect(await repositories.users.findByEmail('nobody@example.invalid')).toBeNull();
    });

    it('updates the plan and leaves everything else alone', async () => {
      const created = await aUser();
      const updated = await repositories.users.update(created.id, { plan: 'free' });

      expect(updated.id).toBe(created.id);
      expect(updated.email).toBe(created.email);
      expect(updated.createdAt).toBe(created.createdAt);
    });

    it('starts every new account unverified', async () => {
      const created = await aUser();
      expect(created.emailVerifiedAt).toBeNull();
    });

    it('records when an address is verified, and leaves the plan alone', async () => {
      const created = await aUser();
      const now = new Date().toISOString();

      const updated = await repositories.users.update(created.id, { emailVerifiedAt: now });

      expect(updated.emailVerifiedAt).toBe(now);
      expect(updated.plan).toBe(created.plan);
    });

    /*
     * `erase()` had no test anywhere in this suite before this one - found
     * while adding `emailVerificationTokens` to its cascade. Covers what
     * that change touched directly; the full cross-table cascade (watches,
     * price history, notifications, push subscriptions) is still only
     * exercised by the account-deletion end-to-end test, not at the
     * repository level. Noted in progress.md rather than attempted here.
     */
    it('erases the account and reports what it actually removed', async () => {
      const user = await aUser();
      await repositories.credentials.upsert(user.id, 'scrypt$1$2$3$salt$hash');
      await repositories.sessions.create({
        id: randomUUID(),
        userId: user.id,
        tokenHash: 'erase-test-session',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      await repositories.emailVerification.create({
        id: randomUUID(),
        userId: user.id,
        tokenHash: 'erase-test-verification',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      await repositories.passwordReset.create({
        id: randomUUID(),
        userId: user.id,
        tokenHash: 'erase-test-reset',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });

      const summary = await repositories.users.erase(user.id);

      expect(summary.userExisted).toBe(true);
      expect(summary.credentials).toBe(1);
      expect(summary.sessions).toBe(1);
      expect(summary.emailVerificationTokens).toBe(1);
      expect(summary.passwordResetTokens).toBe(1);

      expect(await repositories.users.findById(user.id)).toBeNull();
      expect(await repositories.credentials.findByUserId(user.id)).toBeNull();
      expect(await repositories.sessions.findByTokenHash('erase-test-session')).toBeNull();
      expect(
        await repositories.emailVerification.findByTokenHash('erase-test-verification'),
      ).toBeNull();
      expect(await repositories.passwordReset.findByTokenHash('erase-test-reset')).toBeNull();
    });

    it('reports an erasure of a nonexistent account as "nothing existed", not an error', async () => {
      const summary = await repositories.users.erase(randomUUID());
      expect(summary.userExisted).toBe(false);
    });
  });

  describe('credentials', () => {
    it('stores and replaces a password hash', async () => {
      const user = await aUser();

      expect(await repositories.credentials.findByUserId(user.id)).toBeNull();

      await repositories.credentials.upsert(user.id, 'scrypt$1$2$3$salt$first');
      await repositories.credentials.upsert(user.id, 'scrypt$1$2$3$salt$second');

      const stored = await repositories.credentials.findByUserId(user.id);
      expect(stored?.passwordHash).toBe('scrypt$1$2$3$salt$second');
    });
  });

  describe('sessions', () => {
    async function aSession(userId: string, tokenHash: string, expiresAt: string) {
      return repositories.sessions.create({ id: randomUUID(), userId, tokenHash, expiresAt });
    }

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();

    it('finds a session by its token hash', async () => {
      const user = await aUser();
      const created = await aSession(user.id, 'hash-a', future);

      expect(await repositories.sessions.findByTokenHash('hash-a')).toEqual(created);
      expect(await repositories.sessions.findByTokenHash('hash-b')).toBeNull();
    });

    it('deletes one session without touching the others', async () => {
      const user = await aUser();
      const first = await aSession(user.id, 'hash-a', future);
      await aSession(user.id, 'hash-b', future);

      await repositories.sessions.delete(first.id);

      expect(await repositories.sessions.findByTokenHash('hash-a')).toBeNull();
      expect(await repositories.sessions.findByTokenHash('hash-b')).not.toBeNull();
    });

    it('deletes every session for one user and nobody else', async () => {
      const user = await aUser();
      const other = await aUser();
      await aSession(user.id, 'mine-1', future);
      await aSession(user.id, 'mine-2', future);
      await aSession(other.id, 'theirs', future);

      await repositories.sessions.deleteForUser(user.id);

      expect(await repositories.sessions.findByTokenHash('mine-1')).toBeNull();
      expect(await repositories.sessions.findByTokenHash('mine-2')).toBeNull();
      expect(await repositories.sessions.findByTokenHash('theirs')).not.toBeNull();
    });

    it('sweeps only what has actually expired', async () => {
      const user = await aUser();
      await aSession(user.id, 'expired', past);
      await aSession(user.id, 'live', future);

      const removed = await repositories.sessions.deleteExpired(new Date().toISOString());

      expect(removed).toBe(1);
      expect(await repositories.sessions.findByTokenHash('expired')).toBeNull();
      expect(await repositories.sessions.findByTokenHash('live')).not.toBeNull();
    });
  });

  describe('email verification', () => {
    async function aToken(userId: string, tokenHash: string, expiresAt: string) {
      return repositories.emailVerification.create({
        id: randomUUID(),
        userId,
        tokenHash,
        expiresAt,
      });
    }

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();

    it('finds a token by its hash', async () => {
      const user = await aUser();
      const created = await aToken(user.id, 'hash-a', future);

      expect(await repositories.emailVerification.findByTokenHash('hash-a')).toEqual(created);
      expect(await repositories.emailVerification.findByTokenHash('hash-b')).toBeNull();
    });

    it('deletes one token without touching the others', async () => {
      const user = await aUser();
      const first = await aToken(user.id, 'hash-a', future);
      await aToken(user.id, 'hash-b', future);

      await repositories.emailVerification.delete(first.id);

      expect(await repositories.emailVerification.findByTokenHash('hash-a')).toBeNull();
      expect(await repositories.emailVerification.findByTokenHash('hash-b')).not.toBeNull();
    });

    it('deletes every token for one user and nobody else - a resend invalidates old links', async () => {
      const user = await aUser();
      const other = await aUser();
      await aToken(user.id, 'mine-1', future);
      await aToken(user.id, 'mine-2', future);
      await aToken(other.id, 'theirs', future);

      await repositories.emailVerification.deleteForUser(user.id);

      expect(await repositories.emailVerification.findByTokenHash('mine-1')).toBeNull();
      expect(await repositories.emailVerification.findByTokenHash('mine-2')).toBeNull();
      expect(await repositories.emailVerification.findByTokenHash('theirs')).not.toBeNull();
    });

    it('sweeps only what has actually expired', async () => {
      const user = await aUser();
      await aToken(user.id, 'expired', past);
      await aToken(user.id, 'live', future);

      const removed = await repositories.emailVerification.deleteExpired(new Date().toISOString());

      expect(removed).toBe(1);
      expect(await repositories.emailVerification.findByTokenHash('expired')).toBeNull();
      expect(await repositories.emailVerification.findByTokenHash('live')).not.toBeNull();
    });
  });

  describe('password reset', () => {
    async function aToken(userId: string, tokenHash: string, expiresAt: string) {
      return repositories.passwordReset.create({ id: randomUUID(), userId, tokenHash, expiresAt });
    }

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();

    it('finds a token by its hash', async () => {
      const user = await aUser();
      const created = await aToken(user.id, 'hash-a', future);

      expect(await repositories.passwordReset.findByTokenHash('hash-a')).toEqual(created);
      expect(await repositories.passwordReset.findByTokenHash('hash-b')).toBeNull();
    });

    it('deletes one token without touching the others', async () => {
      const user = await aUser();
      const first = await aToken(user.id, 'hash-a', future);
      await aToken(user.id, 'hash-b', future);

      await repositories.passwordReset.delete(first.id);

      expect(await repositories.passwordReset.findByTokenHash('hash-a')).toBeNull();
      expect(await repositories.passwordReset.findByTokenHash('hash-b')).not.toBeNull();
    });

    it('deletes every token for one user and nobody else - a new request invalidates old links', async () => {
      const user = await aUser();
      const other = await aUser();
      await aToken(user.id, 'mine-1', future);
      await aToken(user.id, 'mine-2', future);
      await aToken(other.id, 'theirs', future);

      await repositories.passwordReset.deleteForUser(user.id);

      expect(await repositories.passwordReset.findByTokenHash('mine-1')).toBeNull();
      expect(await repositories.passwordReset.findByTokenHash('mine-2')).toBeNull();
      expect(await repositories.passwordReset.findByTokenHash('theirs')).not.toBeNull();
    });

    it('sweeps only what has actually expired', async () => {
      const user = await aUser();
      await aToken(user.id, 'expired', past);
      await aToken(user.id, 'live', future);

      const removed = await repositories.passwordReset.deleteExpired(new Date().toISOString());

      expect(removed).toBe(1);
      expect(await repositories.passwordReset.findByTokenHash('expired')).toBeNull();
      expect(await repositories.passwordReset.findByTokenHash('live')).not.toBeNull();
    });
  });

  describe('preferences', () => {
    it('patches each side without disturbing the other', async () => {
      // Saving what the user set must never discard what the system inferred.
      const user = await aUser();

      await repositories.preferences.save(user.id, { explicit: { currency: 'EUR' } });
      await repositories.preferences.save(user.id, { inferred: { likesBeaches: true } });
      await repositories.preferences.save(user.id, { explicit: { defaultPassengers: 2 } });

      const stored = await repositories.preferences.find(user.id);

      expect(stored?.explicit).toEqual({ currency: 'EUR', defaultPassengers: 2 });
      expect(stored?.inferred).toEqual({ likesBeaches: true });
    });

    it('overwrites a key on the side being patched', async () => {
      const user = await aUser();

      await repositories.preferences.save(user.id, { explicit: { currency: 'EUR' } });
      await repositories.preferences.save(user.id, { explicit: { currency: 'GBP' } });

      expect((await repositories.preferences.find(user.id))?.explicit).toEqual({
        currency: 'GBP',
      });
    });

    it('returns null before anything was ever saved', async () => {
      const user = await aUser();
      expect(await repositories.preferences.find(user.id)).toBeNull();
    });
  });

  describe('saved searches', () => {
    it('round-trips a search profile, money and all', async () => {
      const user = await aUser();
      const profile = buildProfile({ targetBudget: money(65000, 'EUR') });

      const created = await repositories.tripSearches.create({
        id: randomUUID(),
        userId: user.id,
        name: 'June somewhere warm',
        profile,
        destinations: ['AYT', 'CHQ'],
      });

      const found = await repositories.tripSearches.findById(created.id);

      // The profile is stored whole so a watch replays the exact constraints it
      // was created with; a budget that came back as a float would be a defect.
      expect(found?.profile).toEqual(profile);
      expect(found?.profile.targetBudget).toEqual({ amount: 65000, currency: 'EUR' });
      // Without these the watch could not replay the search it was made from.
      expect(found?.destinations).toEqual(['AYT', 'CHQ']);
    });

    it('lists only the searches belonging to one user', async () => {
      const user = await aUser();
      const other = await aUser();

      const first = await repositories.tripSearches.create({
        id: randomUUID(),
        userId: user.id,
        name: 'First',
        profile: buildProfile(),
        destinations: ['AYT'],
      });
      const second = await repositories.tripSearches.create({
        id: randomUUID(),
        userId: user.id,
        name: 'Second',
        profile: buildProfile(),
        destinations: ['CHQ'],
      });
      await repositories.tripSearches.create({
        id: randomUUID(),
        userId: other.id,
        name: 'Theirs',
        profile: buildProfile(),
        destinations: ['SPU'],
      });

      const listed = await repositories.tripSearches.listByUser(user.id);

      expect(listed.map((search) => search.name).sort()).toEqual(['First', 'Second']);
      expect(listed.map((search) => search.id)).toContain(first.id);
      expect(listed.map((search) => search.id)).toContain(second.id);
    });

    it('patches a name without losing the profile', async () => {
      const user = await aUser();
      const profile = buildProfile({ minNights: 5 });
      const created = await repositories.tripSearches.create({
        id: randomUUID(),
        userId: user.id,
        name: 'Original',
        profile,
        destinations: ['AYT'],
      });

      const updated = await repositories.tripSearches.update(created.id, { name: 'Renamed' });

      expect(updated.name).toBe('Renamed');
      expect(updated.profile).toEqual(profile);
    });
  });

  describe('travel watches', () => {
    async function aWatch(userId: string, overrides: Record<string, unknown> = {}) {
      const search = await repositories.tripSearches.create({
        id: randomUUID(),
        userId,
        name: 'Watched',
        profile: buildProfile(),
        destinations: ['AYT'],
      });

      return repositories.travelWatches.create({
        id: randomUUID(),
        userId,
        tripSearchId: search.id,
        status: 'active',
        priority: 'normal',
        lastRunAt: null,
        nextRunAt: new Date(Date.now() - 1000).toISOString(),
        bestKnownTotal: null,
        ...overrides,
      });
    }

    it('deletes a saved search together with its watch and everything it recorded', async () => {
      const user = await aUser();
      const watch = await aWatch(user.id);
      await repositories.priceHistory.record({
        watchId: watch.id,
        componentType: 'trip_total',
        componentId: 'candidate-1',
        amount: money(68000, 'EUR'),
        providerId: 'mock-flights',
        observedAt: new Date().toISOString(),
        conditions: null,
      });

      await repositories.tripSearches.delete(watch.tripSearchId);

      expect(await repositories.tripSearches.findById(watch.tripSearchId)).toBeNull();
      expect(await repositories.travelWatches.findById(watch.id)).toBeNull();
      expect(await repositories.priceHistory.listForWatch(watch.id)).toEqual([]);
      // Deleting it again is not an error.
      await repositories.tripSearches.delete(watch.tripSearchId);
    });

    it('round-trips a watch, including a null best-known total', async () => {
      const user = await aUser();
      const created = await aWatch(user.id);

      const found = await repositories.travelWatches.findById(created.id);

      expect(found?.status).toBe('active');
      expect(found?.lastRunAt).toBeNull();
      expect(found?.bestKnownTotal).toBeNull();
    });

    it('stores a best-known total as integer minor units', async () => {
      const user = await aUser();
      const created = await aWatch(user.id, { bestKnownTotal: money(74250, 'EUR') });

      const found = await repositories.travelWatches.findById(created.id);

      // A total that came back as 742.5 would be a float in the money path.
      expect(found?.bestKnownTotal).toEqual({ amount: 74250, currency: 'EUR' });
    });

    it('lists what is due and ignores what is not', async () => {
      const user = await aUser();
      const due = await aWatch(user.id);
      const later = await aWatch(user.id, {
        nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      const paused = await aWatch(user.id, { status: 'paused' });

      const dueNow = await repositories.travelWatches.listDue(new Date().toISOString(), 10);
      const ids = dueNow.map((watch) => watch.id);

      expect(ids).toContain(due.id);
      expect(ids).not.toContain(later.id);
      // A paused watch is not due, however long ago its deadline passed.
      expect(ids).not.toContain(paused.id);
    });

    it('honours the limit on what is due', async () => {
      const user = await aUser();
      await aWatch(user.id);
      await aWatch(user.id);
      await aWatch(user.id);

      expect(await repositories.travelWatches.listDue(new Date().toISOString(), 2)).toHaveLength(2);
    });

    it('patches a watch without disturbing untouched fields', async () => {
      const user = await aUser();
      const created = await aWatch(user.id, { bestKnownTotal: money(50000, 'EUR') });

      const updated = await repositories.travelWatches.update(created.id, { status: 'paused' });

      expect(updated.status).toBe('paused');
      expect(updated.priority).toBe('normal');
      expect(updated.bestKnownTotal).toEqual({ amount: 50000, currency: 'EUR' });
    });

    it('can clear a best-known total back to null', async () => {
      // Distinguishing "not in the patch" from "set to null" is the one place a
      // COALESCE-everything update would silently do the wrong thing.
      const user = await aUser();
      const created = await aWatch(user.id, { bestKnownTotal: money(50000, 'EUR') });

      const updated = await repositories.travelWatches.update(created.id, {
        bestKnownTotal: null,
      });

      expect(updated.bestKnownTotal).toBeNull();
    });
  });

  describe('notifications', () => {
    async function anAlert(userId: string, overrides: Record<string, unknown> = {}) {
      return repositories.notifications.create({
        userId,
        watchId: null,
        severity: 'important',
        title: 'A deal',
        body: 'It got cheaper.',
        url: '/?origins=VIE',
        readAt: null,
        deliveredAt: null,
        ...overrides,
      });
    }

    it('round-trips an alert including where it points', async () => {
      const user = await aUser();
      const created = await anAlert(user.id);

      const found = await repositories.notifications.findById(created.id);

      expect(found?.title).toBe('A deal');
      // Without this the notification lands the user nowhere in particular.
      expect(found?.url).toBe('/?origins=VIE');
      expect(found?.deliveredAt).toBeNull();
    });

    it('stamps delivered and read independently', async () => {
      const user = await aUser();
      const created = await anAlert(user.id);

      await repositories.notifications.markDelivered(created.id, '2026-09-19T12:00:00.000Z');
      expect((await repositories.notifications.findById(created.id))?.readAt).toBeNull();

      await repositories.notifications.markRead(created.id, '2026-09-19T12:30:00.000Z');

      const found = await repositories.notifications.findById(created.id);
      expect(found?.deliveredAt).toBe('2026-09-19T12:00:00.000Z');
      expect(found?.readAt).toBe('2026-09-19T12:30:00.000Z');
    });

    it('returns null for an alert that does not exist', async () => {
      expect(await repositories.notifications.findById(randomUUID())).toBeNull();
    });

    it('lists only one user’s alerts', async () => {
      const user = await aUser();
      const other = await aUser();

      await anAlert(user.id);
      await anAlert(other.id);

      expect(await repositories.notifications.listByUser(user.id)).toHaveLength(1);
    });
  });

  describe('provider requests', () => {
    it('summarises calls per provider, with nearest-rank percentiles', async () => {
      const providerId = `vendor-${randomUUID()}`;
      const since = new Date(Date.now() - 60_000).toISOString();

      for (const [status, durationMs] of [
        ['ok', 100],
        ['ok', 200],
        ['ok', 300],
        ['error', 400],
        ['timeout', 5000],
        ['rate_limited', 50],
      ] as const) {
        await repositories.providerRequests.record({
          providerId,
          kind: 'flights',
          status,
          durationMs,
          resultCount: status === 'ok' ? 10 : null,
        });
      }

      const summary = (await repositories.providerRequests.summarise(since)).find(
        (row) => row.providerId === providerId,
      );

      expect(summary).toEqual({
        providerId,
        kind: 'flights',
        calls: 6,
        errors: 1,
        timeouts: 1,
        rateLimited: 1,
        // Sorted: 50 100 200 300 400 5000. Nearest rank: 3rd and 6th.
        p50Ms: 200,
        p95Ms: 5000,
      });
    });

    it('leaves out calls before the window, and can sweep them', async () => {
      const providerId = `vendor-${randomUUID()}`;
      await repositories.providerRequests.record({
        providerId,
        kind: 'hotels',
        status: 'ok',
        durationMs: 10,
        resultCount: 1,
      });

      const future = new Date(Date.now() + 60_000).toISOString();
      expect(
        (await repositories.providerRequests.summarise(future)).some(
          (row) => row.providerId === providerId,
        ),
      ).toBe(false);

      expect(await repositories.providerRequests.deleteBefore(future)).toBeGreaterThan(0);
    });
  });

  describe('price history', () => {
    async function aWatchId(userId: string) {
      const search = await repositories.tripSearches.create({
        id: randomUUID(),
        userId,
        name: 'Watched',
        profile: buildProfile(),
        destinations: ['AYT'],
      });
      const watch = await repositories.travelWatches.create({
        id: randomUUID(),
        userId,
        tripSearchId: search.id,
        status: 'active',
        priority: 'normal',
        lastRunAt: null,
        nextRunAt: new Date().toISOString(),
        bestKnownTotal: null,
      });
      return watch.id;
    }

    it('records an observation with its provenance intact', async () => {
      const user = await aUser();
      const watchId = await aWatchId(user.id);

      const recorded = await repositories.priceHistory.record({
        watchId,
        componentType: 'trip_total',
        componentId: 'candidate-1',
        amount: money(68000, 'EUR'),
        providerId: 'mock-flights',
        observedAt: '2026-06-01T09:00:00.000Z',
        conditions: '1 cabin bag',
      });

      // A price with no source and timestamp cannot honestly be shown.
      expect(recorded.providerId).toBe('mock-flights');
      expect(recorded.observedAt).toBe('2026-06-01T09:00:00.000Z');
      expect(recorded.conditions).toBe('1 cabin bag');
      expect(recorded.amount).toEqual({ amount: 68000, currency: 'EUR' });
    });

    it('finds the lowest total ever seen for a watch', async () => {
      const user = await aUser();
      const watchId = await aWatchId(user.id);

      for (const [amount, at] of [
        [72000, '2026-06-01T09:00:00.000Z'],
        [65000, '2026-06-02T09:00:00.000Z'],
        [69000, '2026-06-03T09:00:00.000Z'],
      ] as const) {
        await repositories.priceHistory.record({
          watchId,
          componentType: 'trip_total',
          componentId: 'candidate-1',
          amount: money(amount, 'EUR'),
          providerId: 'mock-flights',
          observedAt: at,
          conditions: null,
        });
      }

      const lowest = await repositories.priceHistory.findLowest(watchId, 'trip_total', 'EUR');

      expect(lowest?.amount.amount).toBe(65000);
      expect(lowest?.observedAt).toBe('2026-06-02T09:00:00.000Z');
    });

    it('keeps component types apart', async () => {
      const user = await aUser();
      const watchId = await aWatchId(user.id);

      await repositories.priceHistory.record({
        watchId,
        componentType: 'flight',
        componentId: 'f1',
        amount: money(20000, 'EUR'),
        providerId: 'mock-flights',
        observedAt: '2026-06-01T09:00:00.000Z',
        conditions: null,
      });

      expect(await repositories.priceHistory.findLowest(watchId, 'flight', 'EUR')).not.toBeNull();
      expect(await repositories.priceHistory.findLowest(watchId, 'hotel', 'EUR')).toBeNull();
    });

    it('never compares one currency against another', async () => {
      // 50000 GBP is not cheaper than 60000 EUR, and a repository that ordered
      // by minor units alone would say it was.
      const user = await aUser();
      const watchId = await aWatchId(user.id);

      for (const [amount, currency] of [
        [60000, 'EUR'],
        [50000, 'GBP'],
      ] as const) {
        await repositories.priceHistory.record({
          watchId,
          componentType: 'trip_total',
          componentId: 'candidate-1',
          amount: money(amount, currency),
          providerId: 'voyagr.cost-engine',
          observedAt: '2026-06-01T09:00:00.000Z',
          conditions: null,
        });
      }

      expect(
        (await repositories.priceHistory.findLowest(watchId, 'trip_total', 'EUR'))?.amount,
      ).toEqual(money(60000, 'EUR'));
      expect(
        (await repositories.priceHistory.findLowest(watchId, 'trip_total', 'GBP'))?.amount,
      ).toEqual(money(50000, 'GBP'));
    });

    it('prunes old observations but never the cheapest ever seen', async () => {
      // bestKnownTotal is derived from this table, so dropping the cheapest row
      // would raise it and invent a price rise nobody experienced.
      const user = await aUser();
      const watchId = await aWatchId(user.id);

      for (const [amount, observedAt] of [
        [61000, '2025-01-01T09:00:00.000Z'],
        [72000, '2025-02-01T09:00:00.000Z'],
        [68000, '2026-09-18T09:00:00.000Z'],
      ] as const) {
        await repositories.priceHistory.record({
          watchId,
          componentType: 'trip_total',
          componentId: 'candidate-1',
          amount: money(amount, 'EUR'),
          providerId: 'voyagr.cost-engine',
          observedAt,
          conditions: null,
        });
      }

      const removed = await repositories.priceHistory.pruneOlderThan('2026-06-01T00:00:00.000Z');

      expect(removed).toBe(1);
      expect(
        (await repositories.priceHistory.findLowest(watchId, 'trip_total', 'EUR'))?.amount,
      ).toEqual(money(61000, 'EUR'));
      expect(await repositories.priceHistory.listForWatch(watchId)).toHaveLength(2);
    });

    it('returns null when a watch has no history at all', async () => {
      const user = await aUser();
      const watchId = await aWatchId(user.id);

      expect(await repositories.priceHistory.findLowest(watchId, 'trip_total', 'EUR')).toBeNull();
      expect(await repositories.priceHistory.listForWatch(watchId)).toEqual([]);
    });
  });
});
