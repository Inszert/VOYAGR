import { cookies } from 'next/headers';
import { getEnv } from '@/lib/env';
import {
  configuredDataSource,
  dataSourceSwitchEnabled,
  DATA_SOURCE_COOKIE,
  parseDataSource,
  type DataSource,
} from './data-source';

/**
 * Which data source this request is being served from.
 *
 * The only file under `src/providers/` that knows a request exists, which is
 * the point of keeping it separate: adapters stay pure and testable, and the
 * one place that reads a cookie is named after what it does. `next/headers`
 * is server-only by construction - importing it from a client component is a
 * build error - so nothing here can reach the browser.
 *
 * **The selection and the truth are reported separately.** A cookie saying
 * `api` on a deployment with no credentials does not make fixtures into API
 * data. `effective` is what will actually answer, and the control renders
 * that rather than what was asked for - otherwise the switch becomes the
 * exact thing it was built to prevent, a label that disagrees with the data
 * underneath it.
 */

export interface ActiveDataSource {
  /** What the switch is set to, or what configuration implies if it is unset. */
  readonly selected: DataSource;
  /** What configuration alone can serve. */
  readonly configured: DataSource;
  /** What this request will be served from. */
  readonly effective: DataSource;
  /** Whether the switch is offered at all. */
  readonly switchEnabled: boolean;
}

export async function getActiveDataSource(): Promise<ActiveDataSource> {
  const env = getEnv();
  const configured = configuredDataSource(env);
  const switchEnabled = dataSourceSwitchEnabled(env);

  /*
   * With the switch off the cookie is ignored entirely rather than merely
   * hidden. A flag that only removes a control leaves the behaviour it
   * controlled reachable by anyone who kept the cookie.
   */
  if (!switchEnabled) {
    return { selected: configured, configured, effective: configured, switchEnabled };
  }

  const store = await cookies();
  const selected = parseDataSource(store.get(DATA_SOURCE_COOKIE)?.value) ?? configured;

  return {
    selected,
    configured,
    // Asking for fixtures always works. Asking for the API cannot conjure
    // credentials that are not there.
    effective: selected === 'mock' ? 'mock' : configured,
    switchEnabled,
  };
}
