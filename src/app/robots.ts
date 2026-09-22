import type { MetadataRoute } from 'next';
import { getEnv } from '@/lib/env';

/**
 * What a crawler may look at.
 *
 * Public search pages are the point of the site and are open. Everything
 * behind a session is disallowed - not as a security control, which it is
 * not, but because those URLs are useless in an index and a crawler burning
 * provider quota on `/stays?...` variants is a real cost.
 *
 * `/api/` is closed for the same reason: an indexed health endpoint helps
 * nobody.
 */
export default function robots(): MetadataRoute.Robots {
  const base = getEnv().PUBLIC_BASE_URL;

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        disallow: ['/api/', '/account', '/watches', '/sign-in', '/sign-up', '/offline'],
      },
    ],
    ...(base ? { sitemap: `${base}/sitemap.xml`, host: base } : {}),
  };
}
