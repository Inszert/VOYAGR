import { createHash } from 'node:crypto';
import { headers } from 'next/headers';

/**
 * A stable, non-identifying handle for the client making the request.
 *
 * Hashed because it is only ever used as a throttle or rate-limit key: the raw
 * address would be personal data sitting in memory for no added benefit. Only
 * as trustworthy as the proxy in front of the app - `x-forwarded-for` is
 * caller-supplied unless something upstream overwrites it - which is why it
 * narrows a lockout or a limit rather than being the only defence.
 *
 * Shared by sign-in throttling (`src/app/actions/auth.ts`) and search rate
 * limiting (`src/search/rate-limit.ts`): both want the same answer to "which
 * client is this", not two slightly different ones.
 */
export async function resolveClientKey(): Promise<string> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get('x-forwarded-for') ?? '';
  const address = forwarded.split(',')[0]?.trim() || requestHeaders.get('x-real-ip') || '';

  if (!address) return 'unknown-client';
  return createHash('sha256').update(address).digest('hex').slice(0, 32);
}
