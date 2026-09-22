import type { Env } from '@/lib/env';

/**
 * Which set of adapters a request is served from.
 *
 * Not a new architecture: the registry has always chosen between a real
 * adapter and a fixture one, from configuration, once per process. This adds
 * exactly one thing - the ability to make that choice **per request**, so a
 * designer can put the site into fixture mode without an environment edit, a
 * restart or a rebuild.
 *
 * Three kinds of "not real" are deliberately kept apart, because collapsing
 * them is how somebody ends up believing a price:
 *
 *  - **`api`** - whatever configuration selected. Today that is Duffel for
 *    flights, and Duffel's own `live_mode` decides whether those offers are
 *    live or sandbox. That distinction belongs to Duffel and is reported as
 *    `live` or `test` provenance; it is not this switch's business.
 *  - **`mock`** - Voyagr's own fixtures, reported as `mock` provenance.
 *  - Neither is ever substituted for the other silently. If `api` is asked
 *    for and no live adapter is configured, the request is served by whatever
 *    configuration actually names and the control says so, rather than the
 *    page quietly showing fixtures under an "API" label.
 */

export type DataSource = 'api' | 'mock';

/**
 * The cookie the switch writes.
 *
 * A cookie rather than a query parameter, because this is not a property of
 * the search. Every other piece of page state here is in the URL so that a
 * link can be shared; a colleague opening a shared search should get the
 * search, not the fixture mode the sender happened to be in.
 */
export const DATA_SOURCE_COOKIE = 'voyagr-data-source';

export function parseDataSource(value: string | undefined | null): DataSource | null {
  return value === 'api' || value === 'mock' ? value : null;
}

/**
 * What configuration alone would produce.
 *
 * `api` when any adapter is something other than a fixture, because that is
 * the state the switch defaults to and must not change. A deployment with no
 * credentials at all is already in fixture mode and the switch starts there.
 */
export function configuredDataSource(env: Env): DataSource {
  return env.FLIGHT_PROVIDER === 'mock' ? 'mock' : 'api';
}

/**
 * Whether the switch is offered at all.
 *
 * Developer infrastructure, so it is on where development happens and off in
 * production unless somebody deliberately turns it on. Not a new required
 * variable: leaving it unset does the right thing in both places, which is
 * what keeps this removable later without touching anything else.
 */
export function dataSourceSwitchEnabled(env: Env): boolean {
  return env.DATA_SOURCE_SWITCH ?? env.NODE_ENV !== 'production';
}
