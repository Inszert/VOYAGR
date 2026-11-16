import { addDays, dayOfWeek } from '@/core/dates';
import { distanceMetres } from '@/core/distance';
import type { IsoDate, WeatherOutlook } from '@/core/trip/types';
import type { ThingKind, ThingToDo } from '@/providers/types';

/**
 * "A first plan": a few days of real places, ordered by how far apart they are.
 *
 * **Nothing here is written by a model.** The stops are drawn only from the
 * places the page already lists, so the plan and the list cannot disagree and
 * no place can be added that is not real. The order is a nearest-neighbour walk
 * (great-circle distances from `src/core/distance`), the wording is a fixed
 * phrase per kind of place plus the source's own one-line description, and the
 * distances are the straight line between two stops, said as that.
 *
 * Pure: no I/O, no clock. Dates come in; nothing here asks what day it is.
 */

export const STOP_SLOTS = ['morning', 'afternoon', 'evening'] as const;
export type StopSlot = (typeof STOP_SLOTS)[number];

/** A day needs three stops, and a plan needs at least one day. */
export const STOPS_PER_DAY = STOP_SLOTS.length;

/** A week at most: a longer draft is a page nobody reads. */
export const MAX_PLAN_DAYS = 7;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** What a kind of place is for, said once, when the source gave no description of its own. */
const PURPOSE: Record<ThingKind, string> = {
  sights: 'A sight to see',
  museums: 'A museum to go inside',
  outdoors: 'Time outdoors',
  neighbourhoods: 'A neighbourhood to wander',
  food: 'Somewhere to eat and browse',
  culture: 'A place of culture',
};

/** The kinds worth suggesting when the rain comes, because they have a roof. */
const INDOOR: ReadonlySet<ThingKind> = new Set(['museums', 'culture']);

export interface PlanStop {
  readonly slot: StopSlot;
  readonly place: ThingToDo;
  /** One line: the source's own description, or a fixed phrase for the kind. */
  readonly line: string;
  /** Straight-line metres from the previous stop in the same day, or null for the first. */
  readonly metresFromPrevious: number | null;
}

export interface PlanDay {
  readonly dayNumber: number;
  /** "Thu", or null when the page was opened without dates. */
  readonly weekday: string | null;
  readonly date: IsoDate | null;
  readonly title: string;
  readonly stops: readonly [PlanStop, PlanStop, PlanStop];
  /** A real place with a roof, nearest to the day's stops, or null when the list has none spare. */
  readonly ifItRains: { readonly place: ThingToDo; readonly replaces: ThingToDo } | null;
  /** True when the weather provider says rain is likely that day. */
  readonly rainLikely: boolean;
}

export interface FirstPlan {
  readonly days: readonly PlanDay[];
  /** How many nights were asked for; the plan may cover fewer days than that. */
  readonly nights: number;
}

function between(a: ThingToDo, b: ThingToDo): number {
  return distanceMetres(a, b);
}

/** Nearest unvisited place to `from`, ties broken by the list's own order. */
function nearest(from: ThingToDo, pool: readonly ThingToDo[]): ThingToDo | null {
  let best: ThingToDo | null = null;
  let bestDistance = Infinity;
  for (const candidate of pool) {
    const distance = between(from, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/\.$/, '');

  return trimmed.charAt(0).toLocaleUpperCase('en') + trimmed.slice(1);
}

function lineFor(place: ThingToDo): string {
  return place.description ? `${sentence(place.description)}.` : `${PURPOSE[place.kind]}.`;
}

/**
 * How many days the list can fill, and whether it can fill one at all.
 * Fewer than three places is no plan: the section is not shown.
 */
export function planDayCount(places: number, nights: number): number {
  return Math.min(MAX_PLAN_DAYS, Math.max(0, nights), Math.floor(places / STOPS_PER_DAY));
}

export function buildFirstPlan(input: {
  /** The real places, best known first (the order the page lists them in). */
  readonly things: readonly ThingToDo[];
  readonly nights: number;
  readonly startDate: IsoDate | null;
  readonly weather: readonly WeatherOutlook[];
}): FirstPlan | null {
  const count = planDayCount(input.things.length, input.nights);
  if (count < 1) return null;

  // The most widely documented places fill the plan; the rest stay spare for the rain.
  const chosen = input.things.slice(0, count * STOPS_PER_DAY);
  const spare = input.things.slice(count * STOPS_PER_DAY);
  const unplaced = [...chosen];
  const used = new Set<string>();
  const days: PlanDay[] = [];

  for (let index = 0; index < count; index += 1) {
    // A day starts at the best known place left and gathers its two nearest neighbours,
    // so a day is a neighbourhood rather than a scatter.
    const seed = unplaced.shift();
    if (!seed) break;

    const route: ThingToDo[] = [seed];
    while (route.length < STOPS_PER_DAY) {
      const next = nearest(route[route.length - 1]!, unplaced);
      if (!next) break;
      route.push(next);
      unplaced.splice(unplaced.indexOf(next), 1);
    }
    if (route.length < STOPS_PER_DAY) break;
    for (const place of route) used.add(place.id);

    const stops = route.map((place, position) => ({
      slot: STOP_SLOTS[position]!,
      place,
      line: lineFor(place),
      metresFromPrevious: position === 0 ? null : between(route[position - 1]!, place),
    })) as unknown as PlanDay['stops'];

    const date = input.startDate ? addDays(input.startDate, index) : null;
    const weather = date ? input.weather.find((day) => day.date === date) : undefined;

    days.push({
      dayNumber: index + 1,
      weekday: date ? WEEKDAYS[dayOfWeek(date)]! : null,
      date,
      title: `Around ${seed.name}`,
      stops,
      ifItRains: rainAlternative(route, [...spare, ...input.things.filter((t) => !used.has(t.id))]),
      rainLikely: weather ? weather.precipitationProbability >= 0.5 : false,
    });
  }

  return days.length > 0 ? { days, nights: input.nights } : null;
}

/**
 * A real indoor place for a wet day: the roofed place nearest to the day's route
 * that is not already one of its stops, replacing the stop that has no roof and
 * is furthest from it. Null when the list has nothing spare with a roof.
 */
function rainAlternative(
  route: readonly ThingToDo[],
  candidates: readonly ThingToDo[],
): PlanDay['ifItRains'] {
  const open = route.filter((place) => !INDOOR.has(place.kind));
  if (open.length === 0) return null;

  const inRoute = new Set(route.map((place) => place.id));
  let best: ThingToDo | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (!INDOOR.has(candidate.kind) || inRoute.has(candidate.id)) continue;
    const distance = Math.min(...route.map((stop) => between(stop, candidate)));
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (!best) return null;

  const target = best;
  const replaces = open.reduce((worst, place) =>
    between(place, target) > between(worst, target) ? place : worst,
  );

  return { place: best, replaces };
}
