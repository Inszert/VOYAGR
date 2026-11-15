import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok, type Result } from '@/lib/result';
import type {
  DestinationImage,
  ImageryProvider,
  ImageryRef,
  ImageryResults,
  ImageCredit,
} from './types';

/**
 * Wikimedia imagery.
 *
 * Two requests for a whole page of destinations, whatever its size: one to ask
 * each article for its lead image, one to ask those files who took them. The
 * MediaWiki API takes up to fifty titles at a time, which is why this adapter
 * is shaped around a list.
 *
 * Chosen over the stock-photo APIs for three reasons, recorded in full in
 * `docs/imagery-options.md`: no key to hold, caching is permitted rather than
 * forbidden, and the picture of a city is the one an encyclopaedia chose to
 * illustrate that city with - which is a far stronger claim of correctness
 * than a keyword match against a photo library.
 *
 * Nothing here is rendered directly to a browser. The proxy route serves the
 * bytes from our own origin, so a reader's browser never talks to Wikimedia,
 * the content security policy stays at `'self'`, and the service worker can
 * cache a destination photo like any other asset.
 */

const logger = getLogger('providers.imagery.wikimedia');

/**
 * Wide enough for the widest place one of these is drawn - a 460px editorial
 * panel on a 2x display - and no wider. The cards are a quarter of this, and
 * asking for a 1200px thumbnail to render at 250 is four times the bytes
 * through our own proxy for no visible difference.
 */
const THUMB_WIDTH = 800;

/** The API takes fifty titles per request; stay well inside it. */
const TITLES_PER_REQUEST = 40;

interface WikimediaOptions {
  /** Injected in tests. Defaults to the global. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Identifies this app to Wikimedia, whose User-Agent policy asks for a name
   * and a way to get in touch. A URL, never a person's address.
   */
  readonly userAgent?: string;
  readonly thumbWidth?: number;
}

/** The subset of the API's response this adapter reads. */
interface QueryResponse {
  query?: {
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
    pages?: {
      title?: string;
      missing?: boolean;
      pageimage?: string;
      thumbnail?: { source?: string; width?: number; height?: number };
      original?: { source?: string; width?: number; height?: number };
      description?: string;
      imageinfo?: {
        descriptionurl?: string;
        extmetadata?: Record<string, { value?: unknown } | undefined>;
      }[];
    }[];
  };
}

/**
 * Plain text from a metadata field.
 *
 * `extmetadata` values are HTML fragments - an author is routinely a link
 * wrapping a name, sometimes several. Tags are stripped rather than rendered,
 * because attribution belongs in our own markup and a third party's HTML does
 * not go into a page unexamined.
 */
export function plainText(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > 0 ? text : null;
}

function field(
  extmetadata: Record<string, { value?: unknown } | undefined> | undefined,
  key: string,
): string | null {
  return plainText(extmetadata?.[key]?.value);
}

/** Chunk a list so no request carries more titles than the API accepts. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

/**
 * Follow the API's own title rewriting back to what we asked for.
 *
 * A request for "Reykjavík" can come back as "Reykjavik" (normalised) and then
 * as "Reykjavík, Iceland" (a redirect). Without replaying both hops the
 * response cannot be matched to the destination that prompted it, and an image
 * matched to the wrong destination is the failure this whole module exists to
 * avoid - so an unmatched page is dropped rather than guessed at.
 */
function resolutionMap(response: QueryResponse): Map<string, string> {
  const resolved = new Map<string, string>();

  for (const hop of [...(response.query?.normalized ?? []), ...(response.query?.redirects ?? [])]) {
    resolved.set(hop.from, hop.to);
  }

  return resolved;
}

function finalTitle(requested: string, hops: Map<string, string>): string {
  let title = requested;
  // Two hops is all the API performs (normalise, then redirect); the bound
  // also stops a cyclic redirect pair from spinning here.
  for (let step = 0; step < 4; step += 1) {
    const next = hops.get(title);
    if (next === undefined || next === title) break;
    title = next;
  }
  return title;
}

export function createWikimediaImagery(options: WikimediaOptions = {}): ImageryProvider {
  const doFetch = options.fetch ?? globalThis.fetch;
  const thumbWidth = options.thumbWidth ?? THUMB_WIDTH;
  const userAgent = options.userAgent ?? 'Voyagr/0.1 (https://voyagr.example; travel search)';

  async function call(
    lang: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<QueryResponse> {
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    for (const [key, value] of Object.entries({
      action: 'query',
      format: 'json',
      formatversion: '2',
      ...params,
    })) {
      url.searchParams.set(key, value);
    }

    const response = await doFetch(url, {
      signal,
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new AppError('PROVIDER_ERROR', `Wikimedia responded ${response.status}`, {
        context: { status: response.status },
      });
    }

    return (await response.json()) as QueryResponse;
  }

  /** Step one: the lead image of each article, and the file it came from. */
  async function leadImages(
    refs: readonly ImageryRef[],
    lang: string,
    signal?: AbortSignal,
  ): Promise<Map<string, { image: Omit<DestinationImage, 'credit'>; file: string | null }>> {
    const found = new Map<
      string,
      { image: Omit<DestinationImage, 'credit'>; file: string | null }
    >();

    for (const batch of chunk(refs, TITLES_PER_REQUEST)) {
      const response = await call(
        lang,
        {
          titles: batch.map((ref) => ref.title).join('|'),
          redirects: '1',
          prop: 'pageimages|description',
          piprop: 'name|thumbnail|original',
          pithumbsize: String(thumbWidth),
        },
        signal,
      );

      const hops = resolutionMap(response);
      const pages = new Map(
        (response.query?.pages ?? [])
          .filter((page) => page.missing !== true && typeof page.title === 'string')
          .map((page) => [page.title as string, page]),
      );

      for (const ref of batch) {
        const page = pages.get(finalTitle(ref.title, hops));
        const picture = page?.thumbnail ?? page?.original;

        if (!page || !picture?.source || !picture.width || !picture.height) continue;

        found.set(ref.code, {
          image: {
            code: ref.code,
            url: picture.source,
            width: picture.width,
            height: picture.height,
            description: plainText(page.description),
          },
          file: page.pageimage ? `File:${page.pageimage}` : null,
        });
      }
    }

    return found;
  }

  /** Step two: who took each file, and under what licence. */
  async function credits(
    files: readonly string[],
    lang: string,
    signal?: AbortSignal,
  ): Promise<Map<string, ImageCredit>> {
    const found = new Map<string, ImageCredit>();

    for (const batch of chunk(files, TITLES_PER_REQUEST)) {
      const response = await call(
        lang,
        {
          titles: batch.join('|'),
          prop: 'imageinfo',
          iiprop: 'extmetadata|url',
          iiextmetadatafilter: 'Artist|LicenseShortName|Credit',
        },
        signal,
      );

      const hops = resolutionMap(response);
      const pages = new Map(
        (response.query?.pages ?? [])
          .filter((page) => typeof page.title === 'string')
          .map((page) => [page.title as string, page]),
      );

      for (const file of batch) {
        const info = pages.get(finalTitle(file, hops))?.imageinfo?.[0];
        if (!info) continue;

        found.set(file, {
          author: field(info.extmetadata, 'Artist') ?? field(info.extmetadata, 'Credit'),
          licence: field(info.extmetadata, 'LicenseShortName'),
          pageUrl:
            info.descriptionurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(file)}`,
        });
      }
    }

    return found;
  }

  return {
    name: 'wikimedia',

    async lookup(
      refs: readonly ImageryRef[],
      signal?: AbortSignal,
    ): Promise<Result<ImageryResults, AppError>> {
      if (refs.length === 0) return ok(new Map());

      // One language per call. The catalogue uses one today; grouping keeps
      // that from being an assumption baked into the request builder.
      const byLang = new Map<string, ImageryRef[]>();
      for (const ref of refs) {
        const group = byLang.get(ref.lang) ?? [];
        group.push(ref);
        byLang.set(ref.lang, group);
      }

      const results = new Map<string, DestinationImage | null>();
      for (const ref of refs) results.set(ref.code, null);

      try {
        for (const [lang, group] of byLang) {
          const leads = await leadImages(group, lang, signal);
          const files = [...leads.values()]
            .map((entry) => entry.file)
            .filter((file): file is string => file !== null);
          const attribution = await credits([...new Set(files)], lang, signal);

          for (const [code, entry] of leads) {
            const credit = entry.file ? attribution.get(entry.file) : undefined;

            results.set(code, {
              ...entry.image,
              credit: credit ?? {
                author: null,
                licence: null,
                pageUrl: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(
                  group.find((ref) => ref.code === code)?.title ?? code,
                )}`,
              },
            });
          }
        }

        return ok(results);
      } catch (cause) {
        // Expected, not exceptional: the page renders without photographs.
        logger.warn({ err: cause, count: refs.length }, 'imagery lookup failed');

        return err(
          cause instanceof AppError
            ? cause
            : new AppError('PROVIDER_UNAVAILABLE', 'Imagery lookup failed', { cause }),
        );
      }
    },
  };
}
