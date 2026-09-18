import { deterministicSource } from '@/providers/fixtures/deterministic';
import { validateParsedRequest } from '../guardrails';
import type {
  AiCallOptions,
  AiProvider,
  AlertCopy,
  AlertCopyRequest,
  ExplanationFacts,
  Itinerary,
  ItineraryDay,
  ItineraryRequest,
  ParsedTripRequest,
  TripExplanation,
} from '../types';

/**
 * Mock AI provider.
 *
 * Rule-based and deterministic: no network, no credentials, no token cost, and
 * the same input always yields the same output. That makes it usable as a
 * development default *and* as a test double.
 *
 * It is deliberately not clever. Its purpose is to exercise the interface and
 * prove that everything downstream works when the model is swapped out - not to
 * approximate a language model.
 */

const STYLE_KEYWORDS: ReadonlyArray<readonly [RegExp, ParsedTripRequest['travelStyle']]> = [
  [/\b(beach|seaside|coast|sea|sand)\b/i, 'beach'],
  [/\b(chill|relax|lazy|unwind|quiet)\b/i, 'chill'],
  [/\b(explore|sightsee|wander|discover)\b/i, 'explore'],
  [/\b(culture|museum|history|historic)\b/i, 'culture'],
  [/\b(food|cuisine|restaurant|eat|culinary)\b/i, 'food'],
  [/\b(party|nightlife|club|bar)\b/i, 'nightlife'],
  [/\b(hike|adventure|climb|dive|surf)\b/i, 'adventure'],
  [/\b(luxury|five.star|premium|upscale)\b/i, 'luxury'],
];

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  '€': 'EUR',
  $: 'USD',
  '£': 'GBP',
  '₺': 'TRY',
};

/** Pull the passenger count out of phrasings like "2 people" or "for two". */
function parsePassengers(input: string): number {
  const numeric = input.match(
    /\b(\d{1,2})\s*(?:people|persons?|adults?|travellers?|travelers?|pax|guests?)\b/i,
  );
  if (numeric?.[1]) return Math.min(12, Math.max(1, Number.parseInt(numeric[1], 10)));

  const words: Readonly<Record<string, number>> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
  };
  const worded = input.match(/\bfor\s+(one|two|three|four|five|six)\b/i);
  const matched = worded?.[1]?.toLowerCase();
  if (matched && words[matched]) return words[matched];

  if (/\bcouple\b|\bfor two\b/i.test(input)) return 2;
  if (/\bsolo\b|\balone\b|\bjust me\b/i.test(input)) return 1;

  return 2;
}

/** Parse "4-6 nights", "5 nights", "a week". */
function parseNights(input: string): { minNights: number; maxNights: number } {
  const range = input.match(/\b(\d{1,2})\s*[-–to]+\s*(\d{1,2})\s*(?:nights?|days?)\b/i);
  if (range?.[1] && range[2]) {
    const low = Number.parseInt(range[1], 10);
    const high = Number.parseInt(range[2], 10);
    return { minNights: Math.min(low, high), maxNights: Math.max(low, high) };
  }

  const single = input.match(/\b(\d{1,2})\s*(?:nights?|days?)\b/i);
  if (single?.[1]) {
    const nights = Number.parseInt(single[1], 10);
    return { minNights: nights, maxNights: nights };
  }

  if (/\bweek\b/i.test(input)) return { minNights: 6, maxNights: 8 };
  if (/\bweekend\b/i.test(input)) return { minNights: 2, maxNights: 3 };

  return { minNights: 4, maxNights: 7 };
}

/**
 * Pull budget figures out of the text.
 *
 * Note what this does and does not do: it *transcribes* numbers the user wrote.
 * It never invents, rounds or adjusts one. Conversion into `Money` happens later,
 * deterministically, in the guardrail layer.
 */
function parseBudgets(input: string): {
  target: number | null;
  max: number | null;
  currency: string;
} {
  const currencyMatch = input.match(/[€$£₺]/);
  const symbol = currencyMatch?.[0];
  const isoMatch = input.match(/\b(EUR|USD|GBP|CHF|TRY|HUF|PLN)\b/i);

  const currency = symbol
    ? (CURRENCY_SYMBOLS[symbol] ?? 'EUR')
    : (isoMatch?.[1]?.toUpperCase() ?? 'EUR');

  const amounts = [...input.matchAll(/[€$£₺]?\s?(\d{2,6}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/g)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined)
    .map((value) => Number.parseFloat(value.replaceAll(/[,](?=\d{3}\b)/g, '').replace(',', '.')))
    .filter((value) => Number.isFinite(value) && value >= 50);

  const maxMatch = input.match(
    /\b(?:max(?:imum)?|up to|no more than|under)\b[^\d]{0,12}(\d{2,6})/i,
  );
  const explicitMax = maxMatch?.[1] ? Number.parseFloat(maxMatch[1]) : null;

  if (amounts.length === 0) return { target: null, max: explicitMax, currency };

  const sorted = [...amounts].sort((a, b) => a - b);
  const low = sorted[0] ?? null;
  const high = sorted.at(-1) ?? null;

  if (explicitMax !== null) {
    const target = sorted.find((value) => value < explicitMax) ?? null;
    return { target, max: explicitMax, currency };
  }

  return {
    target: low,
    max: high !== null && high !== low ? high : null,
    currency,
  };
}

function parseStyle(input: string): ParsedTripRequest['travelStyle'] {
  for (const [pattern, style] of STYLE_KEYWORDS) {
    if (pattern.test(input)) return style;
  }
  return 'balanced';
}

function parseOptimisationMode(
  input: string,
  style: ParsedTripRequest['travelStyle'],
): ParsedTripRequest['optimisationMode'] {
  if (/\b(cheapest|lowest price|as cheap as)\b/i.test(input)) return 'cheapest';
  if (/\b(nicest|best hotel|upgrade)\b/i.test(input)) return 'nicest_within_budget';
  if (style === 'beach') return 'maximise_beach_time';
  if (style === 'explore' || style === 'culture') return 'maximise_exploration';
  if (style === 'food') return 'maximise_food_quality';
  if (style === 'luxury') return 'maximise_hotel_quality';
  return 'best_value';
}

/** Region and city words worth passing to destination resolution. */
function parseDestinationHints(input: string): string[] {
  const known = [
    'mediterranean',
    'caucasus',
    'greece',
    'crete',
    'cyprus',
    'turkey',
    'antalya',
    'spain',
    'mallorca',
    'portugal',
    'algarve',
    'croatia',
    'split',
    'georgia',
    'batumi',
    'tbilisi',
  ];

  const hints = known.filter((term) => new RegExp(`\\b${term}\\b`, 'i').test(input));
  return [...new Set(hints)];
}

export class MockAiProvider implements AiProvider {
  readonly metadata = {
    id: 'mock-ai',
    displayName: 'Deterministic Mock AI',
    model: 'rule-based',
    isMock: true,
  } as const;

  async parseTripRequest(input: string, _options?: AiCallOptions): Promise<ParsedTripRequest> {
    const { minNights, maxNights } = parseNights(input);
    const budgets = parseBudgets(input);
    const travelStyle = parseStyle(input);
    const destinationHints = parseDestinationHints(input);

    const unresolved: string[] = [];
    if (budgets.max === null) unresolved.push('Maximum budget was not stated.');
    if (destinationHints.length === 0) unresolved.push('No destination or region was mentioned.');
    if (!/\b(\d{1,2})\s*(?:nights?|days?)\b|week|weekend/i.test(input)) {
      unresolved.push('Trip length was assumed rather than stated.');
    }

    const draft = {
      passengers: parsePassengers(input),
      minNights,
      maxNights,
      origins: [] as string[],
      destinationHints,
      targetBudgetMajorUnits: budgets.target,
      maxBudgetMajorUnits: budgets.max,
      currency: budgets.currency,
      travelStyle,
      optimisationMode: parseOptimisationMode(input, travelStyle),
      requireDirectFlights: /\bdirect\b|\bnon.?stop\b/i.test(input),
      requireCheckedBaggage: /\b(checked bag|luggage|suitcase|hold bag)\b/i.test(input),
      mealsPerDay: parseMealsPerDay(input),
      // Confidence drops with each thing the parser had to assume.
      confidence: Math.max(0.3, 1 - unresolved.length * 0.2),
      unresolved,
    };

    // The mock runs through the same validation as a real provider would, so
    // the guardrail path is exercised in development and in tests.
    return validateParsedRequest(draft);
  }

  async explainTrip(facts: ExplanationFacts, _options?: AiCallOptions): Promise<TripExplanation> {
    const strengths = facts.strengths.slice(0, 2).join(' and ').toLowerCase();
    const weakness = facts.weaknesses[0]?.toLowerCase();

    const headline = `${facts.destinationName} scores ${facts.score} out of 100 for this trip.`;

    const sentences = [
      `${facts.nights} nights in ${facts.destinationName} for ${facts.passengers} at ${facts.formattedTotal}, against a budget of ${facts.formattedBudget}.`,
      strengths ? `It stands out on ${strengths}.` : '',
      weakness ? `The weakest part of the trip is ${weakness}.` : '',
      `That works out to roughly ${facts.usableHours} usable hours at the destination.`,
    ].filter(Boolean);

    return {
      headline,
      body: sentences.join(' '),
      tradeoffs: facts.warnings.slice(0, 3),
    };
  }

  async generateItinerary(request: ItineraryRequest, _options?: AiCallOptions): Promise<Itinerary> {
    const days: ItineraryDay[] = [];
    const places = request.placeNames.length > 0 ? request.placeNames : ['the old town'];

    for (let index = 0; index < request.nights; index += 1) {
      const random = deterministicSource(`${request.destinationName}|itinerary|${index}`);
      const morningPlace = places[index % places.length] ?? places[0];
      const eveningPlace = places[(index + 1) % places.length] ?? places[0];

      days.push({
        dayNumber: index + 1,
        title:
          index === 0
            ? 'Arrival and settling in'
            : `Day ${index + 1} in ${request.destinationName}`,
        morning:
          index === 0
            ? 'Arrive, check in and find somewhere nearby for a first meal.'
            : `Start at ${morningPlace}.`,
        afternoon:
          request.travelStyle === 'beach' ? 'Beach time.' : `Explore around ${morningPlace}.`,
        evening: `Dinner near ${eveningPlace}.`,
        wetWeatherAlternative: random.chance(0.6)
          ? 'If it rains, swap the outdoor plan for an indoor museum or a long lunch.'
          : null,
      });
    }

    return {
      days,
      notes: [
        'Generated by the deterministic mock provider; it is structure, not advice.',
        `Weather assumptions: ${request.weatherByDay.slice(0, 3).join('; ')}`,
      ],
    };
  }

  async writeAlertCopy(request: AlertCopyRequest, _options?: AiCallOptions): Promise<AlertCopy> {
    const prefix =
      request.severity === 'important'
        ? 'Price drop'
        : request.severity === 'interesting'
          ? 'Better option'
          : 'Update';

    return {
      title: `${prefix}: ${request.destinationName}`,
      body: `${request.formattedChange}. ${request.reason}`,
    };
  }
}

function parseMealsPerDay(input: string): number | null {
  const match = input.match(/\b(\d)\s*(?:meals?|restaurant)/i);
  if (match?.[1]) return Math.min(6, Number.parseInt(match[1], 10));
  return null;
}

export function createMockAiProvider(): AiProvider {
  return new MockAiProvider();
}
