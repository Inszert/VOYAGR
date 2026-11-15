import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { createMemoryRepositories } from '@/db/memory';
import type { Repositories } from '@/db/repository';
import { AppError } from '@/lib/errors';
import { TRIP_LIMITS, TripHubService } from './service';

let repositories: Repositories;
let service: TripHubService;

async function aUser(email = `user-${randomUUID()}@example.invalid`) {
  return repositories.users.create({ id: randomUUID(), email, plan: 'free' });
}

const tripForm = {
  name: 'Lisbon',
  destination: 'Lisbon',
  destinationCountry: 'PT',
  startDate: null,
  endDate: null,
  ownerName: 'Owner',
};

const itemForm = {
  kind: 'activity' as const,
  title: 'Tram 28',
  date: null,
  startsAt: null,
  price: null,
  status: 'idea' as const,
};

beforeEach(() => {
  repositories = createMemoryRepositories();
  service = new TripHubService({ repositories });
});

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

describe('access', () => {
  it('lets the owner and a linked member in, and keeps a stranger out of every operation', async () => {
    const owner = await aUser();
    const friend = await aUser();
    const stranger = await aUser();
    const trip = await service.createTrip(owner.id, tripForm);
    await service.addMember(owner.id, trip.id, { name: 'Friend', accountEmail: friend.email });

    await expect(service.access(owner.id, trip.id)).resolves.toMatchObject({ isOwner: true });
    await expect(service.access(friend.id, trip.id)).resolves.toMatchObject({ isOwner: false });

    const item = await service.addPlanItem(owner.id, trip.id, itemForm);
    const expense = await service.addExpense(owner.id, trip.id, {
      paidBy: (await service.access(owner.id, trip.id)).self.id,
      amount: money(1000, 'EUR'),
      description: 'x',
      date: '2026-04-10',
      split: { kind: 'equal', memberIds: [(await service.access(owner.id, trip.id)).self.id] },
    });

    // Reads
    expect(await code(service.access(stranger.id, trip.id))).toBe('NOT_FOUND');
    expect(await code(service.listPlan(stranger.id, trip.id))).toBe('NOT_FOUND');
    expect(await code(service.ledger(stranger.id, trip.id))).toBe('NOT_FOUND');
    expect(await code(service.contactsFor(stranger.id, trip.id))).toBe('NOT_FOUND');
    // Writes
    expect(await code(service.addPlanItem(stranger.id, trip.id, itemForm))).toBe('NOT_FOUND');
    expect(await code(service.updatePlanItem(stranger.id, trip.id, item.id, itemForm))).toBe(
      'NOT_FOUND',
    );
    expect(await code(service.removePlanItem(stranger.id, trip.id, item.id))).toBe('NOT_FOUND');
    expect(await code(service.removeExpense(stranger.id, trip.id, expense.id))).toBe('NOT_FOUND');
    expect(await code(service.addPartnerOfferToPlan(stranger.id, trip.id, 'intui-transfer'))).toBe(
      'NOT_FOUND',
    );
    expect(
      await code(service.addMember(stranger.id, trip.id, { name: 'x', accountEmail: null })),
    ).toBe('NOT_FOUND');
    expect(await code(service.deleteTrip(stranger.id, trip.id))).toBe('NOT_FOUND');

    // Nothing changed.
    expect(await repositories.planItems.listByTrip(trip.id)).toHaveLength(1);
    expect(await repositories.trips.findById(trip.id)).not.toBeNull();
  });

  it('answers a missing trip exactly as it answers a forbidden one', async () => {
    const user = await aUser();
    expect(await code(service.access(user.id, randomUUID()))).toBe('NOT_FOUND');
  });

  it('lets a member write but not delete the trip or change who is on it', async () => {
    const owner = await aUser();
    const friend = await aUser();
    const trip = await service.createTrip(owner.id, tripForm);
    await service.addMember(owner.id, trip.id, { name: 'Friend', accountEmail: friend.email });

    await expect(service.addPlanItem(friend.id, trip.id, itemForm)).resolves.toBeDefined();
    expect(await code(service.deleteTrip(friend.id, trip.id))).toBe('FORBIDDEN');
    expect(
      await code(service.addMember(friend.id, trip.id, { name: 'Other', accountEmail: null })),
    ).toBe('FORBIDDEN');
  });

  it('does not reveal whether an email has an account', async () => {
    const owner = await aUser();
    const trip = await service.createTrip(owner.id, tripForm);

    const known = await aUser();
    const a = await service.addMember(owner.id, trip.id, { name: 'A', accountEmail: known.email });
    const b = await service.addMember(owner.id, trip.id, {
      name: 'B',
      accountEmail: 'nobody@example.invalid',
    });
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
  });

  it('does not let an item of one trip be edited through another', async () => {
    const owner = await aUser();
    const one = await service.createTrip(owner.id, tripForm);
    const two = await service.createTrip(owner.id, tripForm);
    const item = await service.addPlanItem(owner.id, one.id, itemForm);

    expect(await code(service.updatePlanItem(owner.id, two.id, item.id, itemForm))).toBe(
      'NOT_FOUND',
    );
    expect(await code(service.removePlanItem(owner.id, two.id, item.id))).toBe('NOT_FOUND');
  });

  it('refuses to remove the owner, or a member who is in the ledger', async () => {
    const owner = await aUser();
    const trip = await service.createTrip(owner.id, tripForm);
    const { self } = await service.access(owner.id, trip.id);
    await service.addMember(owner.id, trip.id, { name: 'Friend', accountEmail: null });
    const friend = (await repositories.trips.listMembers(trip.id)).find(
      (m) => m.name === 'Friend',
    )!;

    expect(await code(service.removeMember(owner.id, trip.id, self.id))).toBe('CONFLICT');

    await service.addExpense(owner.id, trip.id, {
      paidBy: self.id,
      amount: money(1000, 'EUR'),
      description: 'x',
      date: '2026-04-10',
      split: { kind: 'equal', memberIds: [self.id, friend.id] },
    });
    expect(await code(service.removeMember(owner.id, trip.id, friend.id))).toBe('CONFLICT');
  });
});

describe('malformed ids and ceilings', () => {
  it('treats an id that is not a UUID as not found, before any query', async () => {
    const user = await aUser();
    const trip = await service.createTrip(user.id, tripForm);

    for (const bad of ['1', "x'; DROP TABLE trips;--", '../../etc', '', 'a'.repeat(500)]) {
      expect(await code(service.access(user.id, bad))).toBe('NOT_FOUND');
      expect(await code(service.removePlanItem(user.id, trip.id, bad))).toBe('NOT_FOUND');
      expect(await code(service.removeExpense(user.id, trip.id, bad))).toBe('NOT_FOUND');
    }
    // Removing a contact by a malformed id is a quiet no-op, like any id that is not yours.
    await expect(service.removeContact(user.id, 'nope')).resolves.toBeUndefined();
  });

  it('caps how many people a trip, and how many contacts an account, can hold', async () => {
    const user = await aUser();
    const trip = await service.createTrip(user.id, tripForm);

    for (let i = 1; i < TRIP_LIMITS.membersPerTrip; i++) {
      await service.addMember(user.id, trip.id, { name: `Guest ${i}`, accountEmail: null });
    }
    expect(
      await code(service.addMember(user.id, trip.id, { name: 'One too many', accountEmail: null })),
    ).toBe('VALIDATION_ERROR');

    const contact = { name: 'Mum', relation: 'Parent', phone: '+43 1 234 5678' };
    for (let i = 0; i < TRIP_LIMITS.contactsPerUser; i++)
      await service.addContact(user.id, contact);
    expect(await code(service.addContact(user.id, contact))).toBe('VALIDATION_ERROR');
  });

  it('caps how many trips an account can create', async () => {
    const user = await aUser();
    for (let i = 0; i < TRIP_LIMITS.tripsPerUser; i++) await service.createTrip(user.id, tripForm);
    expect(await code(service.createTrip(user.id, tripForm))).toBe('VALIDATION_ERROR');
  });
});

describe('plan', () => {
  it('stores a partner offer as an idea with the registry link, never as booked', async () => {
    const owner = await aUser();
    const trip = await service.createTrip(owner.id, tripForm);

    const item = await service.addPartnerOfferToPlan(owner.id, trip.id, 'intui-transfer');

    expect(item.status).toBe('idea');
    expect(item.kind).toBe('transfer');
    expect(item.partnerOfferId).toBe('intui-transfer');
    expect(item.outboundUrl).toMatch(/^https:\/\//);
    expect(item.price).toBeNull();
  });

  it('adds a place as an idea, with its Wikipedia page as the link', async () => {
    const owner = await aUser();
    const trip = await service.createTrip(owner.id, tripForm);

    const item = await service.addPlaceToPlan(owner.id, trip.id, {
      title: "  Hadrian's Gate ",
      kind: 'activity',
      url: 'https://en.wikipedia.org/wiki/Hadrian%27s_Gate',
    });

    expect(item).toMatchObject({
      kind: 'activity',
      title: "Hadrian's Gate",
      status: 'idea',
      partnerOfferId: null,
      price: null,
      outboundUrl: 'https://en.wikipedia.org/wiki/Hadrian%27s_Gate',
    });
    await expect(
      service.addPlaceToPlan(owner.id, trip.id, { title: 'No page', kind: 'activity', url: null }),
    ).resolves.toMatchObject({ outboundUrl: null });
  });

  it('refuses a place whose name or link is not what a place could be', async () => {
    const owner = await aUser();
    const trip = await service.createTrip(owner.id, tripForm);
    const add = (title: string, url: string | null, kind: 'activity' = 'activity') =>
      code(service.addPlaceToPlan(owner.id, trip.id, { title, kind, url }));

    expect(await add('', null)).toBe('VALIDATION_ERROR');
    expect(await add('x'.repeat(141), null)).toBe('VALIDATION_ERROR');
    expect(await add('x'.repeat(140), null)).toBe('NO_ERROR');
    expect(await add('Two\nlines', null)).toBe('VALIDATION_ERROR');
    expect(await add('Place', 'https://evil.example/wiki/X')).toBe('VALIDATION_ERROR');
    expect(await add('Place', 'http://en.wikipedia.org/wiki/X')).toBe('VALIDATION_ERROR');
    expect(await add('Place', 'https://en.wikipedia.org.evil.example/wiki/X')).toBe(
      'VALIDATION_ERROR',
    );
    expect(await add('Place', 'https://u:p@en.wikipedia.org/wiki/X')).toBe('VALIDATION_ERROR');
    expect(await add('Place', 'javascript:alert(1)')).toBe('VALIDATION_ERROR');
    expect(await add('Place', 'https://de.wikipedia.org/wiki/X')).toBe('NO_ERROR');
    expect(await add('Place', 'https://www.wikidata.org/wiki/Q1')).toBe('NO_ERROR');
    expect(await add('Place', null, 'stay' as 'activity')).toBe('VALIDATION_ERROR');
  });

  it('does not let a stranger add a place to a trip', async () => {
    const owner = await aUser();
    const stranger = await aUser();
    const trip = await service.createTrip(owner.id, tripForm);

    expect(
      await code(
        service.addPlaceToPlan(stranger.id, trip.id, { title: 'X', kind: 'activity', url: null }),
      ),
    ).toBe('NOT_FOUND');
  });

  it('rejects an unknown partner offer', async () => {
    const owner = await aUser();
    const trip = await service.createTrip(owner.id, tripForm);
    expect(await code(service.addPartnerOfferToPlan(owner.id, trip.id, 'nope'))).toBe('NOT_FOUND');
  });

  it('marks booked only when the user submits it, and keeps the partner link when editing', async () => {
    const owner = await aUser();
    const trip = await service.createTrip(owner.id, tripForm);
    const added = await service.addPartnerOfferToPlan(owner.id, trip.id, 'intui-transfer');

    const edited = await service.updatePlanItem(owner.id, trip.id, added.id, {
      ...itemForm,
      kind: 'transfer',
      title: 'Pickup',
      status: 'booked',
    });
    expect(edited.status).toBe('booked');
    expect(edited.partnerOfferId).toBe('intui-transfer');
  });

  it('a manually added item never carries a link', async () => {
    const owner = await aUser();
    const trip = await service.createTrip(owner.id, tripForm);
    const item = await service.addPlanItem(owner.id, trip.id, itemForm);
    expect(item.outboundUrl).toBeNull();
    expect(item.partnerOfferId).toBeNull();
  });
});

describe('expenses', () => {
  async function aGroup() {
    const owner = await aUser();
    const trip = await service.createTrip(owner.id, tripForm);
    await service.addMember(owner.id, trip.id, { name: 'Friend', accountEmail: null });
    const members = await repositories.trips.listMembers(trip.id);
    return { owner, trip, a: members[0]!, b: members[1]! };
  }

  it('builds balances and settle-up from the core, per currency', async () => {
    const { owner, trip, a, b } = await aGroup();
    await service.addExpense(owner.id, trip.id, {
      paidBy: a.id,
      amount: money(1001, 'EUR'),
      description: 'Dinner',
      date: '2026-04-10',
      split: { kind: 'equal', memberIds: [a.id, b.id] },
    });
    await service.addExpense(owner.id, trip.id, {
      paidBy: b.id,
      amount: money(300, 'GBP'),
      description: 'Taxi',
      date: '2026-04-10',
      split: { kind: 'equal', memberIds: [a.id, b.id] },
    });

    const ledger = await service.ledger(owner.id, trip.id);
    expect(ledger.balances.map((g) => g.currency)).toEqual(['EUR', 'GBP']);
    const eur = ledger.settlements.find((s) => s.currency === 'EUR')!;
    // 1001 split two ways: 501 / 500, the odd unit to the lower id.
    expect(eur.transfers).toHaveLength(1);
    expect(eur.transfers[0]!.amount.amount).toBe(a.id < b.id ? 500 : 501);
  });

  it('edits an expense, recomputing the ledger from the core, in the new currency', async () => {
    const { owner, trip, a, b } = await aGroup();
    const saved = await service.addExpense(owner.id, trip.id, {
      paidBy: a.id,
      amount: money(1000, 'EUR'),
      description: 'Dinner',
      date: '2026-04-10',
      split: { kind: 'equal', memberIds: [a.id, b.id] },
    });

    const edited = await service.updateExpense(owner.id, trip.id, saved.id, {
      paidBy: b.id,
      amount: money(2000, 'GBP'),
      description: 'Dinner, with drinks',
      date: '2026-04-11',
      split: { kind: 'equal', memberIds: [a.id, b.id] },
    });

    expect(edited.id).toBe(saved.id);
    expect(edited.createdAt).toBe(saved.createdAt);
    const ledger = await service.ledger(owner.id, trip.id);
    expect(ledger.expenses).toHaveLength(1);
    expect(ledger.balances.map((group) => group.currency)).toEqual(['GBP']);
  });

  it('holds an edited expense to the checks a new one passes, and to its own trip', async () => {
    const { owner, trip, a, b } = await aGroup();
    const other = await service.createTrip(owner.id, tripForm);
    const saved = await service.addExpense(owner.id, trip.id, {
      paidBy: a.id,
      amount: money(1000, 'EUR'),
      description: 'Dinner',
      date: '2026-04-10',
      split: { kind: 'equal', memberIds: [a.id, b.id] },
    });
    const form = {
      paidBy: a.id,
      amount: money(1000, 'EUR'),
      description: 'Dinner',
      date: '2026-04-10',
      split: { kind: 'exact' as const, amounts: [{ memberId: a.id, amount: money(900, 'EUR') }] },
    };

    expect(await code(service.updateExpense(owner.id, trip.id, saved.id, form))).toBe(
      'VALIDATION_ERROR',
    );
    expect(
      await code(
        service.updateExpense(owner.id, other.id, saved.id, {
          ...form,
          split: { kind: 'equal', memberIds: [a.id] },
        }),
      ),
    ).toBe('VALIDATION_ERROR');
  });

  it('lets a member edit the trip name and dates, and nobody else', async () => {
    const owner = await aUser();
    const stranger = await aUser();
    const trip = await service.createTrip(owner.id, tripForm);
    const details = {
      name: 'Lisbon, long weekend',
      destination: 'Lisbon',
      destinationCountry: 'PT',
      startDate: '2026-05-01',
      endDate: '2026-05-04',
    };

    const updated = await service.updateTrip(owner.id, trip.id, details);
    expect(updated).toMatchObject({ name: 'Lisbon, long weekend', startDate: '2026-05-01' });
    expect(await code(service.updateTrip(stranger.id, trip.id, details))).toBe('NOT_FOUND');
  });

  it('rejects exact amounts that do not add up, and people outside the trip', async () => {
    const { owner, trip, a, b } = await aGroup();
    const base = {
      paidBy: a.id,
      amount: money(1000, 'EUR'),
      description: 'x',
      date: '2026-04-10',
    };

    expect(
      await code(
        service.addExpense(owner.id, trip.id, {
          ...base,
          split: {
            kind: 'exact',
            amounts: [
              { memberId: a.id, amount: money(500, 'EUR') },
              { memberId: b.id, amount: money(499, 'EUR') },
            ],
          },
        }),
      ),
    ).toBe('VALIDATION_ERROR');

    expect(
      await code(
        service.addExpense(owner.id, trip.id, {
          ...base,
          split: { kind: 'equal', memberIds: [a.id, randomUUID()] },
        }),
      ),
    ).toBe('VALIDATION_ERROR');
    expect(
      await code(
        service.addExpense(owner.id, trip.id, {
          ...base,
          paidBy: randomUUID(),
          split: { kind: 'equal', memberIds: [a.id] },
        }),
      ),
    ).toBe('VALIDATION_ERROR');

    expect(await repositories.tripExpenses.listByTrip(trip.id)).toEqual([]);
  });
});

describe('emergency contacts', () => {
  it('shows a member only their own contacts, and only on a trip they sit on', async () => {
    const owner = await aUser();
    const friend = await aUser();
    const stranger = await aUser();
    const trip = await service.createTrip(owner.id, tripForm);
    await service.addMember(owner.id, trip.id, { name: 'Friend', accountEmail: friend.email });

    await service.addContact(owner.id, {
      name: 'Mum',
      phone: '+44 20 7946 0000',
      relation: 'Parent',
    });
    await service.addContact(friend.id, {
      name: 'Dad',
      phone: '+49 30 1234567',
      relation: 'Parent',
    });

    expect((await service.contactsFor(owner.id, trip.id)).map((c) => c.name)).toEqual(['Mum']);
    expect((await service.contactsFor(friend.id, trip.id)).map((c) => c.name)).toEqual(['Dad']);
    expect(await code(service.contactsFor(stranger.id, trip.id))).toBe('NOT_FOUND');
  });

  it('will not delete somebody else’s contact', async () => {
    const one = await aUser();
    const two = await aUser();
    const contact = await service.addContact(one.id, {
      name: 'Mum',
      phone: '+44 20 7946 0000',
      relation: 'Parent',
    });

    await service.removeContact(two.id, contact.id);
    expect(await repositories.emergencyContacts.findById(contact.id)).not.toBeNull();

    await service.removeContact(one.id, contact.id);
    expect(await repositories.emergencyContacts.findById(contact.id)).toBeNull();
  });
});
