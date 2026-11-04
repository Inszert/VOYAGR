import { NextResponse } from 'next/server';
import { getAuthService } from '@/auth/current-user';
import { isAppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';

/**
 * The link sent to a *new* email address to confirm moving an account to it.
 *
 * Same shape as `/api/verify-email` and for the same reasons: a plain GET,
 * because that is what a clicked email link does; the redirect target's
 * host comes from the literal `Host` header rather than `request.url`, for
 * the reason recorded in that file's own comment (and confirmed here too,
 * not merely copied: `request.url` reported a different host than the one
 * actually requested, during that feature's own testing).
 *
 * Signs the browser that clicks this out, same as every other path that
 * calls `AuthService`'s session-invalidating methods - if this browser was
 * signed in under the old address, it now is not, and must sign in again
 * under the new one.
 */
const log = getLogger('app.confirm-email-change');

function toAccount(request: Request, flag: string): NextResponse {
  const url = new URL(request.url);
  const host = request.headers.get('host');
  if (host) url.host = host;
  url.pathname = '/account';
  url.search = `?emailChanged=${flag}`;

  return NextResponse.redirect(url);
}

function toSignIn(request: Request): NextResponse {
  const url = new URL(request.url);
  const host = request.headers.get('host');
  if (host) url.host = host;
  url.pathname = '/sign-in';
  url.search = '?emailChanged=1';

  return NextResponse.redirect(url);
}

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token');

  if (!token) return toAccount(request, 'missing-token');

  try {
    await getAuthService().confirmEmailChange(token);
    return toSignIn(request);
  } catch (error) {
    if (!isAppError(error)) throw error;

    log.warn({ err: error }, 'email change confirmation rejected');
    return toAccount(request, 'invalid');
  }
}
