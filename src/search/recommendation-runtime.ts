import { addDays } from '@/core/dates';
import type { IsoDate } from '@/core/trip/types';
import { getRepositories } from '@/db';
import { MCP_DEFAULT_DAILY_BUDGET } from '@/providers/mcp/constants';
import { createMcpClient, type McpClient } from '@/providers/mcp/client';
import {
  createDailyCallBudget,
  RECOMMENDATION_DAILY_CALLS,
  RecommendationService,
  type CallBudget,
  type RecommendationRequest,
  type RecommendationView,
} from './recommendations';

/**
 * The recommendation service as the app uses it.
 *
 * A page render only ever calls `peekHomeRecommendations`, which reads storage. The MCP client is
 * created on the first `callTool` and never before, so a render that finds a list (fresh or stale)
 * builds no client and makes no call. The build is `refreshHomeRecommendations`, reached from a
 * server action after the page has been sent.
 */

declare global {
  var __voyagrRecommendationService: RecommendationService | undefined;
  var __voyagrRecommendationBudget: CallBudget | undefined;
}

/** A client that connects, and is even constructed, only when a tool is actually called. */
export function lazyMcpClient(
  make: () => McpClient = () => createMcpClient({ dailyBudget: MCP_DEFAULT_DAILY_BUDGET }),
): McpClient {
  let real: McpClient | null = null;
  return {
    callTool(name, args) {
      real ??= make();
      return real.callTool(name, args);
    },
    async close() {
      if (real) await real.close();
    },
  };
}

export function getRecommendationService(): RecommendationService {
  globalThis.__voyagrRecommendationBudget ??= createDailyCallBudget(RECOMMENDATION_DAILY_CALLS);
  globalThis.__voyagrRecommendationService ??= new RecommendationService({
    client: lazyMcpClient(),
    lists: getRepositories().recommendationLists,
    offers: getRepositories().kiwiOffers,
    routeGraph: getRepositories().routeGraph,
    budget: globalThis.__voyagrRecommendationBudget,
  });
  return globalThis.__voyagrRecommendationService;
}

/** The home page's list request: the first listed origin, a month of departures, short stays. */
export function homeRecommendationRequest(
  today: IsoDate,
  origin: string,
  currency = 'EUR',
): RecommendationRequest {
  const from = addDays(today, 14);
  return { origin, from, to: addDays(from, 30), minNights: 3, maxNights: 7, adults: 1, currency };
}

/** Storage only. Never calls the MCP. */
export function peekHomeRecommendations(
  request: RecommendationRequest,
  service: RecommendationService = getRecommendationService(),
): Promise<RecommendationView> {
  return service.peek(request);
}

/** Builds only when the stored list is older than 12 h (the service decides). */
export function refreshHomeRecommendations(
  request: RecommendationRequest,
  service: RecommendationService = getRecommendationService(),
): Promise<RecommendationView> {
  return service.ensure(request);
}
