import { createLimiterPool } from '@/lib/concurrency';

/**
 * One limiter pool for every scheduled LiteAPI call in the process, keyed on the provider id.
 *
 * Hotels and flights are one vendor behind one account, so they share the one `liteapi` slot:
 * one call at a time. This is background work with no one waiting, and the vendor's own rate
 * limit is not published. A job wraps only its leaf call in `limiterPool.for('liteapi', 1)`.
 */
export const liteapiLimiterPool = createLimiterPool(1);
