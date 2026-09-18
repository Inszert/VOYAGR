import { z } from 'zod';
import type { OptimisationMode, TravelStyle } from '@/core/trip/types';

/**
 * AI provider abstraction.
 *
 * The application never imports a vendor SDK. It calls these methods, and a
 * provider module decides whether that means a mock, Anthropic, or something
 * else entirely.
 *
 * The interface is deliberately narrow, and the narrowness is the guardrail.
 * Specification section 23 assigns the model: language parsing, explanation,
 * itinerary drafting and preference inference. It assigns deterministic software
 * everything numeric. So no method here returns a price, a total or an
 * eligibility decision - there is simply no channel through which the model
 * could become the source of truth for one.
 */

// --- Request parsing -------------------------------------------------------

/**
 * The structured search constraints a model may extract from free text.
 *
 * Budgets are plain numbers here because this is *parsed user intent*, not a
 * computed figure: the user said "max 850 euro" and the model is transcribing
 * it. The value is validated and converted to `Money` before any engine sees it.
 */
export const parsedTripRequestSchema = z.object({
  passengers: z.number().int().min(1).max(12),
  minNights: z.number().int().min(1).max(60),
  maxNights: z.number().int().min(1).max(60),
  origins: z.array(z.string().length(3)).max(8),
  /** Free-text regions or destinations; resolved to airports deterministically. */
  destinationHints: z.array(z.string().min(2).max(60)).max(12),
  targetBudgetMajorUnits: z.number().nonnegative().nullable(),
  maxBudgetMajorUnits: z.number().nonnegative().nullable(),
  currency: z.string().length(3),
  travelStyle: z.enum([
    'full_chill',
    'chill',
    'balanced',
    'explore',
    'culture',
    'food',
    'beach',
    'nightlife',
    'adventure',
    'luxury',
  ]),
  optimisationMode: z.enum([
    'cheapest',
    'best_value',
    'nicest_within_budget',
    'maximise_beach_time',
    'maximise_hotel_quality',
    'maximise_food_quality',
    'maximise_exploration',
  ]),
  requireDirectFlights: z.boolean(),
  requireCheckedBaggage: z.boolean(),
  mealsPerDay: z.number().min(0).max(6).nullable(),
  /** How confident the model is that it understood the request, 0-1. */
  confidence: z.number().min(0).max(1),
  /** Anything the model could not determine and the UI should ask about. */
  unresolved: z.array(z.string().max(200)).max(10),
});

export type ParsedTripRequest = z.infer<typeof parsedTripRequestSchema> & {
  readonly travelStyle: TravelStyle;
  readonly optimisationMode: OptimisationMode;
};

// --- Explanation -----------------------------------------------------------

/**
 * Facts handed to the model for an explanation.
 *
 * Already computed, already formatted. The model's job is to put them into a
 * sentence, not to derive them. Passing pre-formatted strings rather than raw
 * numbers is intentional: it removes the opportunity to do arithmetic.
 */
export interface ExplanationFacts {
  readonly destinationName: string;
  readonly nights: number;
  readonly passengers: number;
  /** Pre-formatted total, e.g. "EUR 742.00". */
  readonly formattedTotal: string;
  readonly formattedBudget: string;
  readonly score: number;
  readonly strengths: readonly string[];
  readonly weaknesses: readonly string[];
  readonly warnings: readonly string[];
  readonly usableHours: number;
}

export interface TripExplanation {
  /** One-sentence summary, suitable for a card. */
  readonly headline: string;
  /** Two to four sentences of reasoning. */
  readonly body: string;
  /** Trade-offs the user should weigh before acting. */
  readonly tradeoffs: readonly string[];
}

// --- Itinerary -------------------------------------------------------------

export interface ItineraryRequest {
  readonly destinationName: string;
  readonly nights: number;
  readonly travelStyle: TravelStyle;
  /** Day-by-day weather summary, pre-computed. */
  readonly weatherByDay: readonly string[];
  readonly placeNames: readonly string[];
  readonly mealsPerDay: number;
}

export interface ItineraryDay {
  readonly dayNumber: number;
  readonly title: string;
  readonly morning: string;
  readonly afternoon: string;
  readonly evening: string;
  /** Alternative plan when the weather turns, per specification section 12. */
  readonly wetWeatherAlternative: string | null;
}

export interface Itinerary {
  readonly days: readonly ItineraryDay[];
  readonly notes: readonly string[];
}

// --- Notification wording --------------------------------------------------

export interface AlertCopyRequest {
  readonly severity: 'important' | 'interesting' | 'fyi';
  readonly destinationName: string;
  /** Pre-formatted, e.g. "EUR 240.00 to EUR 197.00". */
  readonly formattedChange: string;
  readonly reason: string;
}

export interface AlertCopy {
  readonly title: string;
  readonly body: string;
}

// --- The provider interface ------------------------------------------------

export interface AiCallOptions {
  readonly signal?: AbortSignal;
  readonly requestId?: string;
}

export interface AiProviderMetadata {
  readonly id: string;
  readonly displayName: string;
  readonly model: string;
  readonly isMock: boolean;
}

export interface AiProvider {
  readonly metadata: AiProviderMetadata;

  /** Turn free text into structured, validated search constraints. */
  parseTripRequest(input: string, options?: AiCallOptions): Promise<ParsedTripRequest>;

  /** Explain an already-scored trip. Receives facts; does not compute them. */
  explainTrip(facts: ExplanationFacts, options?: AiCallOptions): Promise<TripExplanation>;

  /** Draft a day-by-day plan from already-selected places and weather. */
  generateItinerary(request: ItineraryRequest, options?: AiCallOptions): Promise<Itinerary>;

  /** Word an alert whose trigger was already decided deterministically. */
  writeAlertCopy(request: AlertCopyRequest, options?: AiCallOptions): Promise<AlertCopy>;
}
