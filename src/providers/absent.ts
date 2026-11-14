import { AppError } from '@/lib/errors';
import { err, ok } from '@/lib/result';
import type { StayProvider } from './stays/types';
import type {
  HotelProvider,
  PlacesProvider,
  ProviderHealth,
  ProviderKind,
  ProviderMetadata,
  TransferProvider,
} from './types';

/**
 * A slot with no data source behind it, said out loud.
 *
 * Production has no live transfer, places or priced-hotel adapter yet, and the
 * only other thing those slots can resolve to is a fixture - which would put
 * invented prices in front of a real traveller. These answer with nothing
 * instead, so the cost engine reports the line as `excluded` rather than as a
 * zero, and the page says the data is not available rather than staying silent
 * about it.
 *
 * Transfers and places answer an empty list: "nothing to list" is a normal
 * result, not a failure, and an error here would be reported as a provider
 * outage on every search. Hotels answer an error, because a trip cannot be
 * assembled without one and an empty page with no reason is the worse outcome.
 */

function absentMetadata<K extends ProviderKind>(kind: K): ProviderMetadata & { kind: K } {
  return {
    id: 'absent',
    kind,
    displayName: 'Not available',
    isMock: false,
    mode: 'absent',
    rateLimitPerMinute: null,
  };
}

async function absentHealth(): Promise<ProviderHealth> {
  return {
    status: 'unavailable',
    checkedAt: new Date().toISOString(),
    latencyMs: null,
    message: 'No data source is configured for this slot.',
  };
}

export function createAbsentTransferProvider(): TransferProvider {
  return {
    metadata: absentMetadata('transfers'),
    checkHealth: absentHealth,
    searchTransfers: async () => ok([]),
  };
}

export function createAbsentPlacesProvider(): PlacesProvider {
  return {
    metadata: absentMetadata('places'),
    checkHealth: absentHealth,
    searchPlaces: async () => ok([]),
  };
}

export function createAbsentHotelProvider(): HotelProvider {
  return {
    metadata: absentMetadata('hotels'),
    checkHealth: absentHealth,
    searchHotels: async () =>
      err(
        new AppError('PROVIDER_UNAVAILABLE', 'No priced hotel provider is configured.', {
          publicMessage: 'Hotel prices are not available yet.',
        }),
      ),
  };
}

/** Stays are fanned out, so this is one provider in a list that answers "nothing configured". */
export function createAbsentStayProvider(): StayProvider {
  return {
    metadata: absentMetadata('stays'),
    searchStays: async () =>
      err(
        new AppError('PROVIDER_UNAVAILABLE', 'No stay provider is configured.', {
          publicMessage: 'Stay prices are not available yet.',
        }),
      ),
  };
}
