import { NextResponse } from 'next/server';
import { getAuthService } from '@/auth/current-user';
import { isAppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';

/**
 * The link in a verification email.
 *
 * A plain GET, because that is what a clicked email link does, and there is
 * nothing here for a CSRF check to protect: the token itself is the proof of
 * access to the inbox, visiting the link confirms the address it was sent
 * to, and nothing about the signed-in session (if any) is read or required.
 *
 * `NextResponse.redirect`, not `redirect()` from `next/navigation` - that one
 * is for a render context (a Server Component or a Server Action unwinding
 * its own response) and this is a plain Route Handler, which returns its own
 * `Response` directly. A confirmed address lands on `/email-confirmed`, a
 * page that says so in plain words. A rejected link goes to the account page
 * with a query flag it reads to show a plain-language result - never a JSON
 * error a person clicking an email link has to parse.
 *
 * **The redirect target's host comes from the `Host` header, not
 * `request.url`.** Confirmed by observation, not assumption: `request.url`
 * inside this Route Handler reported a different host (`localhost`) than
 * the one actually requested (`127.0.0.1`), and the session cookie is
 * scoped to the exact host it was set on - a redirect built from the wrong
 * one lands on a page that looks signed out even though verification just
 * succeeded. The `Host` header is what the browser itself sent, so building
 * from it keeps the redirect on the same origin the request arrived on.
 */
const log = getLogger('app.verify-email');

function redirectTo(request: Request, pathname: string, search = ''): NextResponse {
  const url = new URL(request.url);
  const host = request.headers.get('host');
  if (host) url.host = host;
  url.pathname = pathname;
  url.search = search;

  return NextResponse.redirect(url);
}

function toAccount(request: Request, flag: string): NextResponse {
  return redirectTo(request, '/account', `?verified=${flag}`);
}

function toConfirmed(request: Request): NextResponse {
  return redirectTo(request, '/email-confirmed');
}

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token');

  if (!token) return toAccount(request, 'missing-token');

  try {
    await getAuthService().verifyEmail(token);
    return toConfirmed(request);
  } catch (error) {
    if (!isAppError(error)) throw error;

    log.warn({ err: error }, 'email verification link rejected');
    return toAccount(request, 'invalid');
  }
}
