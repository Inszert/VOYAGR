import { getEnv } from '@/lib/env';

/**
 * A stand-in for the Travelpayouts Drive script, for the end-to-end suite only.
 *
 * Answers 404 unless both `DRIVE_TEST_STUB` and `ALLOW_MOCK_IN_PRODUCTION` are
 * set, which only `playwright.config.ts` does. A real deployment refuses to
 * start with the second, so this route is inert there.
 */
export function GET(): Response {
  const env = getEnv();
  if (!(env.DRIVE_TEST_STUB && env.ALLOW_MOCK_IN_PRODUCTION)) {
    return new Response(null, { status: 404 });
  }

  return new Response('window.__voyagrDriveStub = true;\n', {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
