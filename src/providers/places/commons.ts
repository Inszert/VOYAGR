import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok, type Result } from '@/lib/result';
import type { FetchLike } from '../http/types';
import type { ImageCredit } from '../imagery/types';
import { plainText } from '../imagery/wikimedia';
import { COMMONS_FILE_NAME } from '../schema';

/**
 * Photographs of places, from Wikimedia Commons.
 *
 * Three small jobs that belong together because they share one rule: the file
 * name is the only thing a caller supplies, and every URL is built from it here
 * rather than taken from a request. That is what stops the image route being an
 * open proxy.
 *
 *  - `commonsThumbnailUrl` names the file the way Commons itself redirects from.
 *  - `isAllowedUpstream` decides whether the place that redirect leads is one we
 *    will fetch from.
 *  - `fetchCommonsCredits` asks who took each picture and under what licence,
 *    for the credits the page owes the photographers.
 */

const log = getLogger('providers.commons');

const API = 'https://commons.wikimedia.org/w/api.php';
const TITLES_PER_REQUEST = 40;

/** The only widths a thumbnail may be asked for: a card, and a card on a dense screen. */
export const THUMBNAIL_WIDTHS = [320, 640, 1280] as const;
export type ThumbnailWidth = (typeof THUMBNAIL_WIDTHS)[number];

/**
 * The hosts a thumbnail's bytes may come from.
 *
 * `upload` is where Commons has always stored files. `thumb` is where it now
 * serves resized ones: measured 2026-11-15, every one of twenty Rome
 * thumbnails ended on `thumb.wikimedia.org/wikipedia/commons/thumb/...`, and
 * refusing it is what left "Things to do" with no pictures at all.
 */
export const UPLOAD_HOSTS: ReadonlySet<string> = new Set([
  'upload.wikimedia.org',
  'thumb.wikimedia.org',
]);

/** How many redirects on Commons itself are followed before the bytes. */
export const MAX_COMMONS_HOPS = 3;

/**
 * `Special:FilePath` is Commons' own "this file, at this width" address; it
 * answers with a redirect to the stored thumbnail. Null for a name that is not
 * a plain Commons image file.
 */
export function commonsThumbnailUrl(file: string, width: ThumbnailWidth): string | null {
  if (!COMMONS_FILE_NAME.test(file)) return null;

  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
}

function parsedHttps(location: string): URL | null {
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return null;
  }

  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    ? url
    : null;
}

/** True for an https URL on an upload host, with no credentials and no odd port. */
export function isAllowedUpstream(location: string): boolean {
  const url = parsedHttps(location);

  return (
    url !== null &&
    UPLOAD_HOSTS.has(url.hostname) &&
    url.pathname.startsWith('/wikipedia/commons/') &&
    !url.pathname.includes('..')
  );
}

/**
 * True for one of Commons' own file redirects, which may be followed on the
 * way to the bytes but never served.
 *
 * `Special:FilePath` used to answer with the thumbnail's address. Since 2026 it
 * answers with a second redirect on Commons -
 * `/w/index.php?title=Special:Redirect/file/<name>&width=640` - and only that
 * one names the image. Following exactly these two shapes, on exactly this
 * host, keeps the route a file fetcher rather than a general proxy.
 */
export function isCommonsRedirectHop(location: string): boolean {
  const url = parsedHttps(location);
  if (url === null || url.hostname !== 'commons.wikimedia.org') return false;

  if (url.pathname.startsWith('/wiki/Special:FilePath/')) return true;
  if (url.pathname.startsWith('/wiki/Special:Redirect/file/')) return true;

  return (
    url.pathname === '/w/index.php' &&
    (url.searchParams.get('title') ?? '').startsWith('Special:Redirect/file/')
  );
}

interface CreditResponse {
  query?: {
    normalized?: { from: string; to: string }[];
    pages?: {
      title?: string;
      imageinfo?: {
        descriptionurl?: string;
        extmetadata?: Record<string, { value?: unknown } | undefined>;
      }[];
    }[];
  };
}

function field(
  metadata: Record<string, { value?: unknown } | undefined> | undefined,
  key: string,
): string | null {
  return plainText(metadata?.[key]?.value);
}

/**
 * Who took each file and under what licence, keyed by the file name as asked.
 *
 * A file the API does not know, or one with no metadata, is simply absent from
 * the map; the page then names the Commons file page instead of an author it
 * does not have. Only a failed request is an error.
 */
export async function fetchCommonsCredits(
  files: readonly string[],
  options: { readonly fetchImpl?: FetchLike; readonly signal?: AbortSignal } = {},
): Promise<Result<Map<string, ImageCredit>, AppError>> {
  const doFetch: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const found = new Map<string, ImageCredit>();
  const valid = [...new Set(files)].filter((file) => COMMONS_FILE_NAME.test(file));

  try {
    for (let start = 0; start < valid.length; start += TITLES_PER_REQUEST) {
      const batch = valid.slice(start, start + TITLES_PER_REQUEST);
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        prop: 'imageinfo',
        iiprop: 'extmetadata|url',
        iiextmetadatafilter: 'Artist|LicenseShortName|Credit',
        titles: batch.map((file) => `File:${file}`).join('|'),
      });

      const response = await doFetch(`${API}?${params.toString()}`, {
        ...(options.signal ? { signal: options.signal } : {}),
        headers: {
          'User-Agent': 'Voyagr/1.0 (https://www.voyagrfind.com)',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return err(
          new AppError('PROVIDER_ERROR', `Commons responded ${response.status}`, {
            context: { status: response.status },
          }),
        );
      }

      const body = (await response.json()) as CreditResponse;
      // The API capitalises and re-spaces titles; follow that back to what was asked.
      const normalised = new Map(body.query?.normalized?.map((hop) => [hop.from, hop.to]));
      const pages = new Map(
        (body.query?.pages ?? []).flatMap((page) =>
          typeof page.title === 'string' ? [[page.title, page] as const] : [],
        ),
      );

      for (const file of batch) {
        const title = `File:${file}`;
        const info = pages.get(normalised.get(title) ?? title)?.imageinfo?.[0];
        if (!info) continue;

        found.set(file, {
          author: field(info.extmetadata, 'Artist') ?? field(info.extmetadata, 'Credit'),
          licence: field(info.extmetadata, 'LicenseShortName'),
          // Goes into an href, so only a Commons page is believed.
          pageUrl:
            info.descriptionurl?.startsWith('https://commons.wikimedia.org/wiki/') === true
              ? info.descriptionurl
              : `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`,
        });
      }
    }

    return ok(found);
  } catch (cause) {
    log.warn({ err: cause, files: valid.length }, 'commons credit lookup failed');

    return err(new AppError('PROVIDER_UNAVAILABLE', 'Commons could not be reached.', { cause }));
  }
}
