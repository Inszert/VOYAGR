import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { createMemoryRepositories } from '@/db/memory';
import { buildPersonalExport } from './personal-data';

describe('buildPersonalExport: trip hub', () => {
  it('includes the person’s trips and emergency contacts, and not another member’s names', async () => {
    const repositories = createMemoryRepositories();
    const me = await repositories.users.create({
      id: randomUUID(),
      email: 'me@example.invalid',
      plan: 'free',
    });
    const host = await repositories.users.create({
      id: randomUUID(),
      email: 'host@example.invalid',
      plan: 'free',
    });

    const mine = await repositories.trips.create(
      {
        ownerId: me.id,
        name: 'Mine',
        destination: 'Lisbon',
        destinationCountry: 'PT',
        startDate: null,
        endDate: null,
      },
      'Me',
    );
    const theirs = await repositories.trips.create(
      {
        ownerId: host.id,
        name: 'Theirs',
        destination: 'Porto',
        destinationCountry: 'PT',
        startDate: null,
        endDate: null,
      },
      'Host Person',
    );
    await repositories.trips.addMember({ tripId: theirs.id, userId: me.id, name: 'Me too' });
    await repositories.planItems.create({
      tripId: theirs.id,
      kind: 'other',
      title: 'Host-only plan',
      date: null,
      startsAt: null,
      price: money(100, 'EUR'),
      partnerOfferId: null,
      outboundUrl: null,
      status: 'idea',
    });
    await repositories.emergencyContacts.create({
      userId: me.id,
      name: 'Mum',
      phone: '+44 7700 900123',
      relation: 'Parent',
    });

    const data = await buildPersonalExport(repositories, me.id);
    expect(data).not.toBeNull();

    const text = JSON.stringify(data);
    expect(text).toContain('+44 7700 900123');
    expect(text).toContain(mine.id);
    expect(text).toContain(theirs.id);
    expect(text).not.toContain('Host Person');
    expect(text).not.toContain('Host-only plan');
    expect(text).not.toContain('host@example.invalid');
  });
});
