'use server';

import { getLogger } from '@/lib/logger';
import {
  homeRecommendationRequest,
  peekHomeRecommendations,
  refreshHomeRecommendations,
} from '@/search/recommendation-runtime';
import type { RecommendationView } from '@/search/recommendations';

const log = getLogger('app.recommendation-actions');

const MISSING: RecommendationView = {
  status: 'missing',
  items: [],
  generatedAt: null,
  label: 'no data yet',
  refreshed: false,
  refreshFailed: null,
};

const ORIGIN = /^[A-Z]{3}$/;

/**
 * Asks the service to bring the home list up to date. The service makes a Kiwi call only when the
 * stored list is older than 12 h, and a failure keeps the stored list, so this is safe to call on
 * every visit. The origin is validated; the window is derived on the server, not taken from input.
 */
export async function refreshRecommendations(origin: string): Promise<RecommendationView> {
  const code = origin.trim().toUpperCase();
  if (!ORIGIN.test(code)) return { ...MISSING, refreshFailed: 'error' };
  const today = new Date().toISOString().slice(0, 10);
  const request = homeRecommendationRequest(today, code);
  try {
    return await refreshHomeRecommendations(request);
  } catch (error) {
    log.warn({ err: error }, 'recommendation refresh failed');
    // Keep what is stored rather than replacing it with an empty list.
    try {
      return { ...(await peekHomeRecommendations(request)), refreshFailed: 'error' };
    } catch {
      return { ...MISSING, refreshFailed: 'error' };
    }
  }
}
