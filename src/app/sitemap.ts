import type { MetadataRoute } from 'next';
import { getEnv } from '@/lib/env';

/**
 * The public pages, and only the public ones.
 *
 * Deliberately short. A sitemap listing every search permutation would be a
 * sitemap of pages that do not exist until somebody asks for them, and it
 * would invite a crawler to spend our provider quota generating them.
 *
 * Omitted entirely when no base URL is configured: a sitemap of relative
 * paths is invalid, and an invalid one is worse than none.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getEnv().PUBLIC_BASE_URL;
  if (!base) return [];

  const now = new Date();

  return [
    { url: base, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/explore`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${base}/stays`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${base}/status`, lastModified: now, changeFrequency: 'weekly', priority: 0.2 },
  ];
}
