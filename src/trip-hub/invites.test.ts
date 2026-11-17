import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '@/db/memory';
import type { Repositories } from '@/db/repository';
import { AppError } from '@/lib/errors';
import { TripHubService, hashInviteToken } from './service';

let repositories: Repositories;
let service: TripHubService;
let clockNow: Date;

const tripForm = {
  name: 'Lisbon',
  destination: 'Lisbon',
  destinationCountry: 'PT',
  startDate: null,
  endDate: null,
  ownerName: 'Owner',
};

async function aUser(email = `user-${randomUUID()}@example.invalid`) {
  return repositories.users.create({ id: randomUUID(), email, plan: 'free' });
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

async function setup() {
  const owner = await aUser();
  const trip = await service.createTrip(owner.id, tripForm);
  return { owner, trip };
}

beforeEach(() => {
  clockNow = new Date('2026-06-01T10:00:00.000Z');
  repositories = createMemoryRepositories();
  service = new TripHubService({ repositories, now: () => clockNow });
});

describe('invite links', () => {
  it('stores only a hash of the token, never the token', async () => {
    const { owner, trip } = await setup();
    const { token, invite } = await service.createInvite(owner.id, trip.id);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invite.tokenHash).toBe(hashInviteToken(token));
    expect(JSON.stringify(invite)).not.toContain(token);
    expect(await repositories.tripInvites.findByHash(token)).toBeNull();
  });

  it('lets a signed-in stranger join as a member and open the trip', async () => {
    const { owner, trip } = await setup();
    const guest = await aUser('guest@example.invalid');
    const { token } = await service.createInvite(owner.id, trip.id);

    expect(await code(service.access(guest.id, trip.id))).toBe('NOT_FOUND');
    expect(await service.acceptInvite(guest.id, token)).toEqual({ tripId: trip.id });

    const access = await service.access(guest.id, trip.id);
    expect(access.isOwner).toBe(false);
    expect(access.self.name).toBe('guest');
  });

  it('is idempotent for someone already on the trip and uses nothing up', async () => {
    const { owner, trip } = await setup();
    const guest = await aUser();
    const { token, invite } = await service.createInvite(owner.id, trip.id);

    await service.acceptInvite(guest.id, token);
    await service.acceptInvite(guest.id, token);
    await service.acceptInvite(owner.id, token);

    const members = await repositories.trips.listMembers(trip.id);
    expect(members.filter((m) => m.userId === guest.id)).toHaveLength(1);
    expect((await repositories.tripInvites.findByHash(invite.tokenHash))?.uses).toBe(1);
  });

  it('rejects an expired link after 14 days', async () => {
    const { owner, trip } = await setup();
    const guest = await aUser();
    const { token } = await service.createInvite(owner.id, trip.id);

    clockNow = new Date('2026-06-15T10:00:01.000Z');
    expect(await code(service.acceptInvite(guest.id, token))).toBe('NOT_FOUND');
    expect(await code(service.access(guest.id, trip.id))).toBe('NOT_FOUND');
  });

  it('still works on the last day', async () => {
    const { owner, trip } = await setup();
    const guest = await aUser();
    const { token } = await service.createInvite(owner.id, trip.id);

    clockNow = new Date('2026-06-15T09:59:59.000Z');
    expect(await code(service.acceptInvite(guest.id, token))).toBe('NO_ERROR');
  });

  it('rejects a revoked link', async () => {
    const { owner, trip } = await setup();
    const guest = await aUser();
    const { token, invite } = await service.createInvite(owner.id, trip.id);

    await service.revokeInvite(owner.id, trip.id, invite.id);
    expect(await code(service.acceptInvite(guest.id, token))).toBe('NOT_FOUND');
    expect(await service.activeInviteCount(owner.id, trip.id)).toBe(0);
  });

  it('gives a wrong, malformed or empty token the identical error', async () => {
    const { owner, trip } = await setup();
    const guest = await aUser();
    const { token } = await service.createInvite(owner.id, trip.id);
    const wrong = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

    const messages = new Set<string>();
    for (const attempt of [wrong, 'short', '', 'x'.repeat(43)]) {
      try {
        await service.acceptInvite(guest.id, attempt);
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        messages.add((error as AppError).publicMessage);
      }
    }
    expect(messages.size).toBe(1);
    expect(await code(service.access(guest.id, trip.id))).toBe('NOT_FOUND');
  });

  it('stops after ten people', async () => {
    const { owner, trip } = await setup();
    const { token } = await service.createInvite(owner.id, trip.id);
    for (let i = 0; i < 10; i += 1) {
      await service.acceptInvite((await aUser()).id, token);
    }
    expect(await code(service.acceptInvite((await aUser()).id, token))).toBe('NOT_FOUND');
  });

  it('lets only the owner create or revoke a link', async () => {
    const { owner, trip } = await setup();
    const member = await aUser();
    const stranger = await aUser();
    const { token } = await service.createInvite(owner.id, trip.id);
    await service.acceptInvite(member.id, token);

    expect(await code(service.createInvite(member.id, trip.id))).toBe('FORBIDDEN');
    expect(await code(service.createInvite(stranger.id, trip.id))).toBe('NOT_FOUND');
    expect(await code(service.revokeInvite(member.id, trip.id))).toBe('FORBIDDEN');
    expect(await code(service.revokeInvite(stranger.id, trip.id))).toBe('NOT_FOUND');
    expect(await code(service.activeInviteCount(member.id, trip.id))).toBe('FORBIDDEN');
    // Neither attempt revoked anything.
    expect(await service.activeInviteCount(owner.id, trip.id)).toBe(1);
  });

  it('removes the links with the trip', async () => {
    const { owner, trip } = await setup();
    const { token, invite } = await service.createInvite(owner.id, trip.id);
    await service.deleteTrip(owner.id, trip.id);

    expect(await repositories.tripInvites.findByHash(invite.tokenHash)).toBeNull();
    expect(await code(service.acceptInvite((await aUser()).id, token))).toBe('NOT_FOUND');
  });
});
