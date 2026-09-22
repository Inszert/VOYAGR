import type { AppError } from '@/lib/errors';
import type { Result } from '@/lib/result';

/**
 * Destination imagery.
 *
 * A photograph is a claim about a place, so it is fetched like any other
 * provider datum: behind an interface, returning a `Result`, with provenance
 * and attribution attached. `docs/imagery-options.md` records why this source
 * was chosen over the stock-photo APIs.
 *
 * **The association is curated; only the picture is live.** A provider is
 * never asked "find me a photo of Bali" - a search like that is how a product
 * ends up showing a beach in Thailand under a Croatian island. It is asked for
 * the lead image of one named encyclopaedia article, chosen by hand in
 * `catalogue.ts`. If that lookup fails the card keeps its gradient, which says
 * nothing rather than something wrong.
 *
 * **The interface takes a list, not a place.** A discovery page needs sixteen
 * images at once, and sixteen single-image adapters is sixteen round trips
 * that all have to be bounded, retried and cached separately. Asking for the
 * batch lets the adapter make one request, which is also what the source's
 * own rate-limit guidance asks for.
 */

/** What to look up: one article, named exactly. */
export interface ImageryRef {
  /** The destination this illustrates, for caching and for the proxy route. */
  readonly code: string;
  /** The article title, as the encyclopaedia spells it. */
  readonly title: string;
  /** Language edition to ask. Two editions can carry different lead images. */
  readonly lang: string;
}

/**
 * Who took the photograph and under what terms.
 *
 * Every field is nullable because the source's metadata is uneven, and an
 * absent author is `null` rather than "Unknown": a name we did not receive is
 * not a name we can print.
 */
export interface ImageCredit {
  /** Plain-text author, markup stripped. Null when the file did not state one. */
  readonly author: string | null;
  /** Short licence name, e.g. "CC BY-SA 4.0". Null when not stated. */
  readonly licence: string | null;
  /** Where a reader can check all of the above. */
  readonly pageUrl: string;
}

export interface DestinationImage {
  readonly code: string;
  /** Absolute URL of the image itself, on the source's own servers. */
  readonly url: string;
  /** Intrinsic size, so the layout does not shift when the image arrives. */
  readonly width: number;
  readonly height: number;
  /**
   * What the picture shows, in the source's words, or null.
   *
   * Used for alternative text. Where it is null the image is decorative and
   * hidden from assistive technology, because "Antalya" repeated on a photo of
   * Antalya inside a card headed Antalya is noise, not description.
   */
  readonly description: string | null;
  readonly credit: ImageCredit;
}

/** What an adapter returns: an entry per destination asked about. */
export type ImageryResults = ReadonlyMap<string, DestinationImage | null>;

export interface ImageryProvider {
  readonly name: string;
  /**
   * The lead image of each article.
   *
   * A `null` entry means the article exists and has no usable image, which is
   * a normal answer. A missing entry means it was not asked about. An error
   * means the lookup itself failed, and the caller degrades to no imagery at
   * all rather than to a partially illustrated page of unknown correctness.
   */
  lookup(
    refs: readonly ImageryRef[],
    signal?: AbortSignal,
  ): Promise<Result<ImageryResults, AppError>>;
}
