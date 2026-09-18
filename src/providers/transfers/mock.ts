import { money } from '@/core/money';
import type { TransferOffer } from '@/core/trip/types';
import { ok } from '@/lib/result';
import { deterministicSource, MOCK_OBSERVED_AT } from '../fixtures/deterministic';
import { resolveDestination } from '../fixtures/destinations';
import type {
  ProviderHealth,
  ProviderRequestOptions,
  ProviderResult,
  TransferProvider,
  TransferQuery,
} from '../types';

/**
 * Mock transfer provider.
 *
 * The specification (section 10) explicitly allows a transfer cost to be an
 * estimate rather than a live quote. This adapter returns a small set of modes
 * with plausible durations and prices so the cost engine always has something
 * to work with, and the No-Surprise check has a duration to judge.
 */

interface TransferTemplate {
  readonly mode: TransferOffer['mode'];
  /** Multiplier applied to the destination's baseline transfer duration. */
  readonly durationFactor: number;
  /** Price per party per direction, in EUR cents, before variation. */
  readonly baseCents: number;
  /** Additional cents per passenger beyond the second. */
  readonly perExtraPassengerCents: number;
}

const TEMPLATES: readonly TransferTemplate[] = [
  { mode: 'public', durationFactor: 1.8, baseCents: 500, perExtraPassengerCents: 250 },
  { mode: 'shared', durationFactor: 1.35, baseCents: 1600, perExtraPassengerCents: 700 },
  { mode: 'taxi', durationFactor: 1.0, baseCents: 3200, perExtraPassengerCents: 0 },
  { mode: 'private', durationFactor: 0.95, baseCents: 4200, perExtraPassengerCents: 0 },
];

export class MockTransferProvider implements TransferProvider {
  readonly metadata = {
    id: 'mock-transfers',
    kind: 'transfers',
    displayName: 'Mock Transfer Provider',
    isMock: true,
    rateLimitPerMinute: null,
  } as const;

  async checkHealth(_options?: ProviderRequestOptions): Promise<ProviderHealth> {
    return {
      status: 'healthy',
      checkedAt: MOCK_OBSERVED_AT,
      latencyMs: 0,
      message: 'Mock provider; no network call performed.',
    };
  }

  async searchTransfers(
    query: TransferQuery,
    _options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly TransferOffer[]>> {
    const profile = resolveDestination(query.airport);
    const random = deterministicSource(`${query.airport}|transfer|${query.passengers}`);

    // Longer-haul destinations tend to have airports further from the resort.
    const baselineMinutes = Math.round(18 + profile.typicalFlightMinutes * 0.12);

    const offers: TransferOffer[] = TEMPLATES.map((template, index) => {
      const extraPassengers = Math.max(0, query.passengers - 2);
      const cents = Math.round(
        (template.baseCents + template.perExtraPassengerCents * extraPassengers) *
          random.float(0.9, 1.15),
      );

      return {
        id: `mock-transfer-${query.airport}-${template.mode}-${index}`,
        providerId: this.metadata.id,
        mode: template.mode,
        durationMinutes: Math.round(baselineMinutes * template.durationFactor),
        pricePerDirection: money(cents, query.currency),
        observedAt: MOCK_OBSERVED_AT,
      };
    });

    return ok(offers.sort((a, b) => a.pricePerDirection.amount - b.pricePerDirection.amount));
  }
}

export function createMockTransferProvider(): TransferProvider {
  return new MockTransferProvider();
}
