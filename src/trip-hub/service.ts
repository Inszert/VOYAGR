import { createHash, randomBytes } from 'node:crypto';
import { balances, settleUp, validateExpense, ExpenseError } from '@/core/expenses';
import type { CurrencyBalances, Member, Transfer } from '@/core/expenses';
import { PARTNER_OFFERS, type PartnerCategory, type PartnerOffer } from '@/booking/partners';
import type {
  EmergencyContactRecord,
  PlanItemRecord,
  Repositories,
  TripExpenseRecord,
  TripInput,
  TripInviteRecord,
  TripMemberRecord,
  TripRecord,
} from '@/db/repository';
import { AppError } from '@/lib/errors';
import type {
  ContactFormInput,
  ExpenseFormInput,
  PlanItemFormInput,
  TripDetailsInput,
  TripFormInput,
} from './parse';
import { isPlaceSourceUrl } from './place-url';
import type { PlanItemKind, PlanItemStatus } from './types';

/**
 * The trip hub's rules, and the one place access to a trip is decided.
 *
 * **Authorisation lives here, not in the pages.** An action is an endpoint and
 * anyone can post to it, so every method takes the acting user's id (always
 * from the verified session, never from the request) and starts by proving
 * they sit on the trip. Someone who does not gets NOT_FOUND, the same answer
 * as for a trip that does not exist, so ids cannot be probed.
 *
 * Owner-only: deleting the trip and changing who is on it. Everything else is
 * open to any member, because a shared trip that only one person can edit is
 * not shared.
 */

const CATEGORY_TO_KIND: Readonly<Partial<Record<PartnerCategory, PlanItemKind>>> = {
  transfer: 'transfer',
  esim: 'esim',
  insurance: 'insurance',
  activities: 'activity',
  stay: 'stay',
};

/**
 * Every id here is a UUID the server made. A value of any other shape cannot
 * name a row, so it is "not found" before it reaches a query: Postgres would
 * otherwise answer a malformed id with a type error, a 500 instead of the 404
 * that keeps ids unprobeable.
 */
const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ceilings, so one account cannot fill the database. Generous for a person, fatal for a script. */
export const TRIP_LIMITS = {
  tripsPerUser: 100,
  membersPerTrip: 30,
  inviteDays: 14,
  inviteUses: 10,
  activeInvitesPerTrip: 5,
  contactsPerUser: 20,
} as const;

function tooMany(publicMessage: string): AppError {
  return new AppError('VALIDATION_ERROR', 'Per-account limit reached', { publicMessage });
}

export interface TripAccess {
  readonly trip: TripRecord;
  readonly members: readonly TripMemberRecord[];
  readonly isOwner: boolean;
  /** The viewer's own seat. */
  readonly self: TripMemberRecord;
}

export interface Ledger {
  readonly expenses: readonly TripExpenseRecord[];
  readonly members: readonly Member[];
  readonly balances: readonly CurrencyBalances[];
  readonly settlements: readonly { readonly currency: string; readonly transfers: Transfer[] }[];
}

export interface TripHubServiceOptions {
  readonly repositories: Repositories;
  /** The clock, for the tests. Defaults to the real one. */
  readonly now?: () => Date;
}

/** A token is 32 random bytes in base64url: 43 characters. Anything else cannot be one. */
const INVITE_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The only thing a stranger or a failed link is ever told, whichever check failed. */
function invalidInvite(): AppError {
  return new AppError('NOT_FOUND', 'Invite not usable', {
    publicMessage: 'This invite link is not valid any more. Ask for a new one.',
  });
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class TripHubService {
  private readonly repositories: Repositories;
  private readonly clock: () => Date;

  constructor(options: TripHubServiceOptions) {
    this.repositories = options.repositories;
    this.clock = options.now ?? (() => new Date());
  }

  // --- Access ----------------------------------------------------------------

  /** The trip, if and only if `userId` owns it or sits on it. */
  async access(userId: string, tripId: string): Promise<TripAccess> {
    const notFound = () =>
      new AppError('NOT_FOUND', 'Trip not found or not accessible', {
        publicMessage: 'That trip could not be found.',
      });

    if (!ID_SHAPE.test(tripId)) throw notFound();

    const trip = await this.repositories.trips.findById(tripId);
    if (!trip) throw notFound();

    const members = await this.repositories.trips.listMembers(tripId);
    const self = members.find((member) => member.userId === userId);
    if (!self) throw notFound();

    return { trip, members, isOwner: trip.ownerId === userId, self };
  }

  private async requireOwner(userId: string, tripId: string): Promise<TripAccess> {
    const access = await this.access(userId, tripId);
    if (!access.isOwner) {
      throw new AppError('FORBIDDEN', 'Only the trip owner can do this', {
        publicMessage: 'Only the person who created the trip can do that.',
      });
    }
    return access;
  }

  // --- Trips -------------------------------------------------------------------

  listTrips(userId: string): Promise<TripRecord[]> {
    return this.repositories.trips.listForUser(userId);
  }

  async createTrip(userId: string, input: TripFormInput): Promise<TripRecord> {
    const existing = await this.repositories.trips.listForUser(userId);
    if (existing.length >= TRIP_LIMITS.tripsPerUser) {
      throw tooMany('You have reached the limit of trips. Delete one you no longer need.');
    }

    const { ownerName, ...fields } = input;
    const record: TripInput = { ownerId: userId, ...fields };
    return this.repositories.trips.create(record, ownerName);
  }

  /** Name, place and dates. Any member may correct them: a shared trip is shared. */
  async updateTrip(userId: string, tripId: string, input: TripDetailsInput): Promise<TripRecord> {
    await this.access(userId, tripId);
    return this.repositories.trips.update(tripId, input);
  }

  async deleteTrip(userId: string, tripId: string): Promise<void> {
    await this.requireOwner(userId, tripId);
    await this.repositories.trips.delete(tripId);
  }

  /**
   * Add a person to the trip.
   *
   * With an account email the person is linked and can then open the trip;
   * without one, or when no account has that email, they are a name on the
   * ledger only. The result is the same either way, so this cannot be used to
   * find out whether an address has an account.
   */
  async addMember(
    userId: string,
    tripId: string,
    input: { name: string; accountEmail: string | null },
  ): Promise<void> {
    const { members } = await this.requireOwner(userId, tripId);

    const name = input.name.trim();
    if (name === '' || name.length > 80) {
      throw new AppError('VALIDATION_ERROR', 'Member name invalid', {
        publicMessage: 'Enter a name of up to 80 characters.',
      });
    }

    if (members.length >= TRIP_LIMITS.membersPerTrip) {
      throw tooMany(`A trip can have up to ${TRIP_LIMITS.membersPerTrip} people.`);
    }

    let linkedUserId: string | null = null;
    const email = input.accountEmail?.trim().toLowerCase();
    if (email) {
      const found = await this.repositories.users.findByEmail(email);
      if (found && !members.some((member) => member.userId === found.id)) {
        linkedUserId = found.id;
      }
    }

    await this.repositories.trips.addMember({ tripId, userId: linkedUserId, name });
  }

  async removeMember(userId: string, tripId: string, memberId: string): Promise<void> {
    const { trip, members } = await this.requireOwner(userId, tripId);
    const target = members.find((member) => member.id === memberId);
    if (!target) return;

    if (target.userId === trip.ownerId) {
      throw new AppError('CONFLICT', 'The owner cannot be removed', {
        publicMessage: 'The person who created the trip cannot be removed from it.',
      });
    }

    // A member in the ledger stays: removing them would leave an expense that
    // names someone who is not there, and balances that no longer add up.
    const expenses = await this.repositories.tripExpenses.listByTrip(tripId);
    const inLedger = expenses.some(
      (expense) => expense.paidBy === memberId || splitMembers(expense).includes(memberId),
    );
    if (inLedger) {
      throw new AppError('CONFLICT', 'Member is part of recorded expenses', {
        publicMessage: 'They are part of recorded expenses, so they cannot be removed.',
      });
    }

    await this.repositories.trips.removeMember(tripId, memberId);
  }

  // --- Invite links ------------------------------------------------------------

  /**
   * Make a link anyone can use to join the trip. Owner only.
   *
   * The token is returned once, here, and only its SHA-256 hash is kept: it
   * cannot be shown again, and nobody reading the database can rebuild a link.
   * Never log it.
   */
  async createInvite(
    userId: string,
    tripId: string,
  ): Promise<{ token: string; invite: TripInviteRecord }> {
    const { trip } = await this.requireOwner(userId, tripId);

    const at = this.clock();
    const active = await this.repositories.tripInvites.listActiveByTrip(trip.id, at.toISOString());
    if (active.length >= TRIP_LIMITS.activeInvitesPerTrip) {
      throw tooMany('There are already several live invite links. Revoke one first.');
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(at.getTime() + TRIP_LIMITS.inviteDays * 86_400_000).toISOString();
    const invite = await this.repositories.tripInvites.create({
      tripId: trip.id,
      tokenHash: hashInviteToken(token),
      createdBy: userId,
      expiresAt,
      maxUses: TRIP_LIMITS.inviteUses,
    });
    return { token, invite };
  }

  /** How many links are live, for the owner's control. Owner only. */
  async activeInviteCount(userId: string, tripId: string): Promise<number> {
    await this.requireOwner(userId, tripId);
    const live = await this.repositories.tripInvites.listActiveByTrip(
      tripId,
      this.clock().toISOString(),
    );
    return live.length;
  }

  /** Switch off one link, or every live link of the trip when `inviteId` is omitted. Owner only. */
  async revokeInvite(userId: string, tripId: string, inviteId?: string): Promise<void> {
    await this.requireOwner(userId, tripId);
    if (inviteId !== undefined && !ID_SHAPE.test(inviteId)) return;
    await this.repositories.tripInvites.revoke(tripId, this.clock().toISOString(), inviteId);
  }

  /**
   * Join the trip named by a link. Any signed-in user.
   *
   * Every way this can fail (no such link, expired, revoked, used up, trip
   * full) is the same plain error, so a link cannot be probed. Someone who is
   * already on the trip is simply sent there and nothing is used up.
   */
  async acceptInvite(userId: string, token: string): Promise<{ tripId: string }> {
    if (typeof token !== 'string' || !INVITE_TOKEN_SHAPE.test(token)) throw invalidInvite();

    const invite = await this.repositories.tripInvites.findByHash(hashInviteToken(token));
    if (!invite) throw invalidInvite();

    const members = await this.repositories.trips.listMembers(invite.tripId);
    if (members.some((member) => member.userId === userId)) return { tripId: invite.tripId };

    if (members.length >= TRIP_LIMITS.membersPerTrip) throw invalidInvite();

    const user = await this.repositories.users.findById(userId);
    if (!user) throw invalidInvite();

    // The one atomic step: revoked, expired and used up are all decided here.
    const claimed = await this.repositories.tripInvites.claim(
      invite.id,
      this.clock().toISOString(),
    );
    if (!claimed) throw invalidInvite();

    const name = (user.email.split('@')[0] ?? '').trim().slice(0, 80) || 'Traveller';
    try {
      await this.repositories.trips.addMember({ tripId: invite.tripId, userId, name });
    } catch (error) {
      // A concurrent accept by the same person: the unique seat already exists.
      const after = await this.repositories.trips.listMembers(invite.tripId);
      if (!after.some((member) => member.userId === userId)) throw error;
    }
    return { tripId: invite.tripId };
  }

  // --- Plan --------------------------------------------------------------------

  async listPlan(userId: string, tripId: string): Promise<PlanItemRecord[]> {
    await this.access(userId, tripId);
    return this.repositories.planItems.listByTrip(tripId);
  }

  async addPlanItem(
    userId: string,
    tripId: string,
    input: PlanItemFormInput,
  ): Promise<PlanItemRecord> {
    await this.access(userId, tripId);
    return this.repositories.planItems.create({
      tripId,
      ...input,
      partnerOfferId: null,
      outboundUrl: null,
    });
  }

  async updatePlanItem(
    userId: string,
    tripId: string,
    itemId: string,
    input: PlanItemFormInput,
  ): Promise<PlanItemRecord> {
    await this.access(userId, tripId);
    await this.requireItem(tripId, itemId);
    // The partner link is not editable here: it came from the registry.
    return this.repositories.planItems.update(itemId, input);
  }

  /** The one-click "I have booked this", which only ever comes from the traveller. */
  async setPlanItemStatus(
    userId: string,
    tripId: string,
    itemId: string,
    status: PlanItemStatus,
  ): Promise<PlanItemRecord> {
    await this.access(userId, tripId);
    await this.requireItem(tripId, itemId);
    return this.repositories.planItems.update(itemId, { status });
  }

  async removePlanItem(userId: string, tripId: string, itemId: string): Promise<void> {
    await this.access(userId, tripId);
    await this.requireItem(tripId, itemId);
    await this.repositories.planItems.delete(itemId);
  }

  /**
   * Save a partner offer to a trip as an idea.
   *
   * Always `idea`. We cannot see what happens on the partner's site, so a click
   * is not a booking and nothing here promotes it to one; the traveller marks
   * it booked themselves. The title and link come from the registry, never from
   * the request.
   */
  async addPartnerOfferToPlan(
    userId: string,
    tripId: string,
    offerId: string,
    offers: readonly PartnerOffer[] = PARTNER_OFFERS,
  ): Promise<PlanItemRecord> {
    await this.access(userId, tripId);

    const offer = offers.find((candidate) => candidate.id === offerId);
    if (!offer) {
      throw new AppError('NOT_FOUND', `No partner offer ${offerId}`, {
        publicMessage: 'That offer is no longer available.',
      });
    }

    return this.repositories.planItems.create({
      tripId,
      kind: CATEGORY_TO_KIND[offer.category] ?? 'other',
      title: `${offer.partner}: ${offer.description}`.slice(0, 140),
      date: null,
      startsAt: null,
      price: null,
      partnerOfferId: offer.id,
      outboundUrl: offer.url,
      status: 'idea',
    });
  }

  /**
   * A place from "Things to do", saved as an idea.
   *
   * Unlike a partner offer, nothing here comes from a registry we hold, so the
   * request's two strings are held to what a place can be: a short single-line
   * name, and a link only to Wikipedia or Wikidata, over https. The link is
   * stored for the traveller to follow, never rendered as a partner link.
   */
  async addPlaceToPlan(
    userId: string,
    tripId: string,
    place: { readonly title: string; readonly kind: 'activity'; readonly url: string | null },
  ): Promise<PlanItemRecord> {
    await this.access(userId, tripId);

    const title = typeof place.title === 'string' ? place.title.trim() : '';
    if (
      place.kind !== 'activity' ||
      title === '' ||
      title.length > 140 ||
      /[\u0000-\u001f\u007f]/.test(title) ||
      (place.url !== null && !isPlaceSourceUrl(place.url))
    ) {
      throw new AppError('VALIDATION_ERROR', 'Invalid place', {
        publicMessage: 'That place could not be added.',
      });
    }

    return this.repositories.planItems.create({
      tripId,
      kind: 'activity',
      title,
      date: null,
      startsAt: null,
      price: null,
      partnerOfferId: null,
      outboundUrl: place.url,
      status: 'idea',
    });
  }

  private async requireItem(tripId: string, itemId: string): Promise<PlanItemRecord> {
    const item = ID_SHAPE.test(itemId) ? await this.repositories.planItems.findById(itemId) : null;
    // An item of another trip is "not found" here: the id is only a claim.
    if (!item || item.tripId !== tripId) {
      throw new AppError('NOT_FOUND', 'Plan item not found', {
        publicMessage: 'That item could not be found.',
      });
    }
    return item;
  }

  // --- Expenses ----------------------------------------------------------------

  /** The checks an expense passes before it is stored, whether new or edited. */
  private async checkExpense(
    userId: string,
    tripId: string,
    input: ExpenseFormInput,
  ): Promise<void> {
    const { members } = await this.access(userId, tripId);
    const known = new Set(members.map((member) => member.id));

    const candidate = { id: 'new', ...input };
    try {
      validateExpense(candidate);
    } catch (error) {
      if (error instanceof ExpenseError) {
        throw new AppError('VALIDATION_ERROR', error.message, { publicMessage: error.message });
      }
      throw error;
    }

    const named = [input.paidBy, ...splitMembers(candidate)];
    if (named.some((id) => !known.has(id))) {
      throw new AppError('VALIDATION_ERROR', 'Expense names someone outside the trip', {
        publicMessage: 'Everyone in an expense must be on the trip.',
      });
    }
  }

  async addExpense(
    userId: string,
    tripId: string,
    input: ExpenseFormInput,
  ): Promise<TripExpenseRecord> {
    await this.checkExpense(userId, tripId, input);
    return this.repositories.tripExpenses.create({ tripId, ...input });
  }

  /**
   * Correct an expense: who paid, how much, in which currency, how it is split.
   *
   * Held to exactly the checks a new one passes. An expense of another trip is
   * "not found" here, because the id in the form is only a claim.
   */
  async updateExpense(
    userId: string,
    tripId: string,
    expenseId: string,
    input: ExpenseFormInput,
  ): Promise<TripExpenseRecord> {
    await this.checkExpense(userId, tripId, input);

    const existing = ID_SHAPE.test(expenseId)
      ? await this.repositories.tripExpenses.findById(expenseId)
      : null;
    if (!existing || existing.tripId !== tripId) {
      throw new AppError('NOT_FOUND', 'Expense not found', {
        publicMessage: 'That expense could not be found.',
      });
    }

    return this.repositories.tripExpenses.update(expenseId, input);
  }

  async removeExpense(userId: string, tripId: string, expenseId: string): Promise<void> {
    await this.access(userId, tripId);
    const expense = ID_SHAPE.test(expenseId)
      ? await this.repositories.tripExpenses.findById(expenseId)
      : null;
    if (!expense || expense.tripId !== tripId) {
      throw new AppError('NOT_FOUND', 'Expense not found', {
        publicMessage: 'That expense could not be found.',
      });
    }
    await this.repositories.tripExpenses.delete(expenseId);
  }

  /** Every figure on the Expenses tab comes from here, which comes from `src/core/expenses`. */
  async ledger(userId: string, tripId: string): Promise<Ledger> {
    const { members } = await this.access(userId, tripId);
    const expenses = await this.repositories.tripExpenses.listByTrip(tripId);
    const people = members.map((member) => ({ id: member.id, name: member.name }));
    const groups = balances(people, expenses);

    return {
      expenses,
      members: people,
      balances: groups,
      settlements: groups.map((group) => ({
        currency: group.currency,
        transfers: settleUp(group),
      })),
    };
  }

  // --- Emergency contacts -----------------------------------------------------

  /**
   * The viewer's own contacts, and only on a trip they sit on.
   *
   * Contacts belong to one person, not to a trip. Another member of the trip
   * does not see them: being on the same trip is not consent to share a
   * parent's phone number.
   */
  async contactsFor(userId: string, tripId: string): Promise<EmergencyContactRecord[]> {
    await this.access(userId, tripId);
    return this.repositories.emergencyContacts.listByUser(userId);
  }

  async addContact(userId: string, input: ContactFormInput): Promise<EmergencyContactRecord> {
    const mine = await this.repositories.emergencyContacts.listByUser(userId);
    if (mine.length >= TRIP_LIMITS.contactsPerUser) {
      throw tooMany(`You can keep up to ${TRIP_LIMITS.contactsPerUser} emergency contacts.`);
    }

    return this.repositories.emergencyContacts.create({ userId, ...input });
  }

  async removeContact(userId: string, contactId: string): Promise<void> {
    if (!ID_SHAPE.test(contactId)) return;
    const contact = await this.repositories.emergencyContacts.findById(contactId);
    // Not yours is not found, and nothing is deleted.
    if (!contact || contact.userId !== userId) return;
    await this.repositories.emergencyContacts.delete(contactId);
  }
}

function splitMembers(expense: { split: TripExpenseRecord['split'] }): string[] {
  const { split } = expense;
  switch (split.kind) {
    case 'equal':
      return [...split.memberIds];
    case 'shares':
      return split.weights.map((entry) => entry.memberId);
    case 'exact':
      return split.amounts.map((entry) => entry.memberId);
  }
}
