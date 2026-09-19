/**
 * Recorded HTTP, for testing a live adapter without a live provider.
 *
 * A live adapter's hard parts are not the happy path: they are pagination,
 * a 429 with a `Retry-After`, a truncated body, a price that expired between
 * two calls. None of those can be produced on demand from a real API, and all
 * of them have to be in the test suite.
 *
 * So a real exchange is recorded once, committed, and replayed forever. The
 * fixture is the evidence: "this is what the vendor actually sent", not "this
 * is what we imagined the vendor sends".
 *
 * Vendor-agnostic on purpose. Nothing here knows about any provider, so the
 * same harness serves whichever is chosen.
 */

/** A request, reduced to what decides which fixture answers it. */
export interface RecordedRequest {
  readonly method: string;
  /** Absolute URL, with the query string; secrets are redacted before storage. */
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
}

export interface RecordedResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface RecordedExchange {
  readonly request: RecordedRequest;
  readonly response: RecordedResponse;
  /** When it was recorded, so a stale fixture can be spotted. */
  readonly recordedAt: string;
  /** Free text: what this fixture exists to prove. */
  readonly note?: string;
}

export interface Cassette {
  /** Filename-safe identifier, also the file's basename. */
  readonly name: string;
  readonly provider: string;
  /**
   * Ordered. A cassette with two exchanges for the same request replays them in
   * turn, which is how a paginated sequence or a price that changed between
   * calls is expressed.
   */
  readonly exchanges: readonly RecordedExchange[];
}

/** The subset of `fetch` an adapter is allowed to depend on. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
