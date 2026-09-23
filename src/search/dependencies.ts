import type { DataSource } from '@/providers/data-source';
import { getProviderRegistry } from '@/providers/registry';
import type { SearchDependencies } from './orchestrator';
import { recordProviderCalls } from './observe';

/**
 * The adapters a search runs against, for one data source.
 *
 * `runSearch` already takes its providers as an argument and only falls back
 * to the registry when nobody passed any - which is what makes the runtime
 * switch a matter of choosing a registry rather than of changing the search.
 * This is the one place that choice is made, so a caller cannot half-switch
 * by handing over the flight provider and forgetting the hotels.
 *
 * Deliberately not a new abstraction: it is three lines that name an existing
 * one, and deleting the switch later means deleting this file.
 */
export function dependenciesFor(source: DataSource): Partial<SearchDependencies> {
  const registry = getProviderRegistry(source);

  return {
    flights: registry.flights,
    hotels: registry.hotels,
    weather: registry.weather,
    transfers: registry.transfers,
    // Every call recorded, per provider, for the status page.
    observe: recordProviderCalls(),
  };
}
