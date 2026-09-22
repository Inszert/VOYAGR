import { getCurrentUser } from '@/auth/current-user';
import { getRepositories } from '@/db';
import { buildPersonalExport } from '@/account/personal-data';

/**
 * Everything we hold about you, as a file.
 *
 * A GET that answers only for the session making it. The user id comes from
 * the verified session and there is no parameter that could name a different
 * one, so there is nothing here to enumerate: the endpoint has exactly one
 * possible answer per caller.
 *
 * `no-store` because the response is entirely personal data and a shared
 * cache holding one is a data breach with a long tail.
 */
export async function GET(): Promise<Response> {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: 'Sign in to export your data.' }, { status: 401 });
  }

  const repositories = await getRepositories();
  const data = await buildPersonalExport(repositories, user.id);

  if (!data) {
    return Response.json({ error: 'Sign in to export your data.' }, { status: 401 });
  }

  /*
   * The filename carries a date and nothing else.
   *
   * An email address in a Content-Disposition header ends up in the
   * downloads folder, in shell history and in any proxy log on the way -
   * which is a lot of places to leave an identifier for the sake of a
   * tidier filename.
   */
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="voyagr-export-${data.meta.generatedAt.slice(0, 10)}.json"`,
      'Cache-Control': 'no-store, private',
    },
  });
}
