/**
 * Search orchestration.
 *
 * `runSearch` is the entry point: a `SearchProfile` and a destination list in,
 * ranked and costed trips out. The rest is exported for tests and for the UI
 * layer, which has to be able to explain how a result set was produced.
 */

export { runSearch, type SearchDependencies } from './orchestrator';
export { buildSearchPlan, enumerateDateWindows, sampleEvenly } from './plan';
export { candidateId } from '@/core/trip/identity';
export {
  assembleRouteCandidates,
  interleave,
  selectTransfer,
  weatherForWindow,
  type RouteAssemblyInput,
} from './assemble';
export {
  DEFAULT_SEARCH_LIMITS,
  type DateWindow,
  type ProviderIssue,
  type RankedTrip,
  type SearchDiagnostics,
  type SearchLimits,
  type SearchOutcome,
  type SearchPlan,
  type SearchRequest,
} from './types';
