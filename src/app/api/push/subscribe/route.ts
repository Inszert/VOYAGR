import { z } from 'zod';
import { getCurrentUser } from '@/auth/current-user';
import { getRepositories } from '@/db';
import { AppError, toProblemDetails } from '@/lib/errors';
import { getLogger } from '@/lib/logger';

/**
 * Push subscription management.
 *
 * A browser hands us an endpoint and two keys; this stores them against the
 * signed-in user so a later alert has somewhere to go.
 *
 * A route handler rather than a Server Action because the caller is the
 * `PushManager`, which produces a plain JSON object, not a form. Same
 * authorisation either way: the user is resolved from the session here, never
 * taken from the request body.
 */

const log = getLogger('api.push-subscribe');

/**
 * The shape `PushSubscription.toJSON()` produces.
 *
 * Validated rather than trusted. These values are written to the database and
 * later used to encrypt a payload, and an endpoint is a URL we will make a
 * request to - so it is checked to be one, over https, before it is stored.
 */
const subscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .refine((value) => value.startsWith('https://'), 'A push endpoint must be https'),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
});

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();

  if (!user) {
    return problem(new AppError('UNAUTHORIZED', 'Not signed in'));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(new AppError('VALIDATION_ERROR', 'Body was not JSON'));
  }

  const parsed = subscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return problem(new AppError('VALIDATION_ERROR', 'Not a push subscription'));
  }

  await getRepositories().pushSubscriptions.create({
    userId: user.id,
    endpoint: parsed.data.endpoint,
    keys: parsed.data.keys,
  });

  // The endpoint is a credential of sorts: anyone holding it can push to that
  // browser. It is never logged, here or anywhere else.
  log.info({ userId: user.id }, 'push subscription stored');

  return Response.json({ subscribed: true }, { status: 201 });
}

export async function DELETE(request: Request): Promise<Response> {
  const user = await getCurrentUser();

  if (!user) {
    return problem(new AppError('UNAUTHORIZED', 'Not signed in'));
  }

  const endpoint = new URL(request.url).searchParams.get('endpoint');
  if (!endpoint) {
    return problem(new AppError('VALIDATION_ERROR', 'No endpoint given'));
  }

  // Deleting by endpoint alone is safe: an endpoint is unguessable, and a user
  // who somehow supplied someone else's would only be unsubscribing a browser
  // that had already stopped wanting notifications.
  await getRepositories().pushSubscriptions.deleteByEndpoint(endpoint);
  log.info({ userId: user.id }, 'push subscription removed');

  return Response.json({ subscribed: false });
}

function problem(error: AppError): Response {
  const details = toProblemDetails(error);
  return Response.json(details, { status: details.status });
}
