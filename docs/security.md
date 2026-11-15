# Security

The baseline the foundation establishes, and the rules that keep it.

---

## 1. What this product holds

Not payment details — yet. It does hold:

- **Travel dates and destinations**, which reveal when a home is empty.
- **Email addresses** and account data.
- **Push subscription keys**, which are credentials for reaching a user's device.
- **Provider API credentials**, which cost real money if leaked.

Treat all four as sensitive. The first is the one people underestimate.

---

## 2. Secrets

**Rules**

- No credential is ever committed. `.env*` is gitignored except `.env.example`, which holds inert
  placeholders only.
- Secrets never reach a log, an error message, a build artifact or a client bundle.
- Never put a secret in a `NEXT_PUBLIC_*` variable — that prefix ships to the browser. Of the VAPID
  pair, only the public key carries that prefix.
- Never ask a user to paste a credential into a chat or an issue.
- Production secrets come from the host's secret store, never a file in the repository.

**How this is enforced**

- `src/lib/env.ts` is the only module that reads `process.env`. A Zod schema declares every variable
  the app may read.
- Validation errors name the offending variable but never echo its value — a message quoting a bad
  value can itself leak a secret. There is a test for this.
- `describeEnv()` reduces every key in `SECRET_ENV_KEYS` to a boolean, so a configuration report can
  be logged or returned safely.
- `src/lib/logger.ts` configures pino redaction centrally, covering passwords, tokens, API keys,
  authorization and cookie headers, connection strings and push subscription keys.

---

## 3. Data leaving the server

`src/lib/errors.ts` separates what a user may see from what only logs may see.

- `AppError` carries a `publicMessage` alongside its internal `message`, `context` and `cause`.
- `toProblemDetails()` builds the client response and **omits `context`, `cause` and stack traces
  entirely**. A provider's raw error body never reaches a browser.
- `toLogPayload()` keeps everything, for logs.

The health endpoint (`/api/health`) reports capabilities as **booleans**, never configuration
values. A health endpoint is a favourite reconnaissance target; an end-to-end test asserts it
contains no connection string and no key-shaped string.

---

## 4. Input validation

Every external input is validated at the boundary with Zod. **Model output counts as external
input** — that is what `src/ai/guardrails.ts` exists for:

- `validateParsedRequest()` schema-checks model output and applies cross-field rules. Malformed
  output is discarded, never repaired in place.
- `toSearchProfile()` converts intent into `Money` deterministically. The model says "850"; this
  layer decides that means 85000 minor units.
- `assertNoInventedFigures()` scans generated prose for numbers absent from its source facts and
  discards the text if it finds one.

That last check is also a security control, not only a correctness one: it is the barrier between a
prompt-injected model and a figure a user might act on.

---

## 5. Response headers

Most are static values set in `next.config.ts`, asserted by the end-to-end suite:

| Header                       | Value                                   |
| ---------------------------- | --------------------------------------- |
| `Strict-Transport-Security`  | 2 years, `includeSubDomains`, `preload` |
| `X-Content-Type-Options`     | `nosniff`                               |
| `X-Frame-Options`            | `DENY`                                  |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`       |
| `Permissions-Policy`         | camera, microphone and payment denied   |
| `Cross-Origin-Opener-Policy` | `same-origin`                           |

`X-Powered-By` is disabled.

`Content-Security-Policy` is the one exception - it is **not** in `next.config.ts`. It is set in
`src/proxy.ts` (named `middleware.ts` until Next.js 16.4.5 deprecated that file name), because
`script-src` carries a fresh nonce generated per request, which a
static `headers()` list cannot produce (it would hand back the same string to everyone, which is
not a nonce). `'unsafe-inline'` is gone from `script-src`; `style-src` still carries it, because
several components set CSS custom properties via a `style={{ '--x': ... }}` **attribute**, and a
style attribute is gated by `style-src-attr`, which this nonce does not cover - tightening that
needs those components rewritten to use a nonced `<style>` element instead, which is real work with
its own risk, left for its own change. `'unsafe-eval'` is development-only.

**Verified, 3 November 2026, not just configured.** Built the production app, confirmed the
response header carries a nonce (`curl -i`), confirmed every one of Next's own injected `<script>`
tags in the rendered HTML carries that exact nonce (`grep`, all 15 matched), then loaded the
homepage and `/explore` (the globe page, the one most likely to break something subtle) in a real
browser and read the console directly: zero errors, zero warnings, on either. This app injects no
script of its own - no `<script>`, no `dangerouslySetInnerHTML` anywhere in `src/` - so there was
nothing to add a `nonce` prop to; Next's own propagation was the entire mechanism being tested.

Adding a third-party script means widening the CSP. Push back before doing so.

---

## 6. Database

- All queries are parameterised. String interpolation into SQL appears nowhere and must not start.
- `query()` logs the SQL text but **never the parameters**, which routinely hold personal data.
- TLS is configurable via `DATABASE_SSL` and should be on in production.
- The pool has a connection timeout, so an unreachable host fails fast rather than hanging requests.

---

## 7. Notifications

Push subscription keys are credentials. They are stored per user, never logged, and never returned
to any client but the one that created them. Endpoints are truncated in logs.

A subscription that returns 404 or 410 is deleted rather than retried.

---

## 8. Dependencies

CI runs `npm audit --omit=dev --audit-level=high`, so high and critical advisories in production
dependencies fail the build. Lower severities are reported without blocking, which keeps the signal
meaningful. Dependabot groups updates by ecosystem so a framework bump is not reviewed alongside an
unrelated lint bump.

**Known issue:** ESLint is pinned to the 9.x line, which upstream marks end-of-life, because
`eslint-config-next@16` bundles a version of `eslint-plugin-react` that is incompatible with ESLint 10. This is a development-only dependency and is not in the production dependency tree. Revisit when
Next.js ships ESLint 10 support.

---

## 9. Not yet addressed

This section drifted out of date — it still said "Authentication and sessions — arrives with Phase
1.3" after 1.3 shipped sign-in, sessions and account mutations. Corrected 3 November 2026:

- **Rate limiting on the search page itself** — **now a live concern, not only a future one, and a
  real attempt at it this session was reverted rather than shipped.** `/` is a GET-rendered server
  component (`src/app/page.tsx`) that calls `runSearch` straight from `searchParams`; it has no API
  route to attach middleware to in the usual sense, and no rate limit sits in front of it. This
  mattered less while every provider was a mock; it matters now that `FLIGHT_PROVIDER=aviasales` and
  `WEATHER_PROVIDER=open-meteo` are real options (see `docs/provider-evaluation.md`'s 3 November
  update), because an abusive client driving repeated searches spends a rate limit shared across
  every user of the deployment, on providers chosen specifically for having no paid tier to fall
  back on if blocked.

  A per-client fixed-window counter was built and wired into the search path, keyed the same way
  `src/app/actions/auth.ts` already keys sign-in throttling: a hash of `x-forwarded-for`/`x-real-ip`,
  falling back to one shared "unknown-client" bucket when neither header is present. **Running the
  full e2e suite against it immediately failed roughly a dozen search/watch/account tests** -
  because the test harness connects directly to `127.0.0.1` with no proxy in front of it, every
  request resolved to that one shared fallback bucket, and the whole suite's search traffic
  exhausted it within seconds. That is not a test-only artefact: any real deployment with no
  reverse proxy in front of it, or one that does not forward a client IP, or users sharing one
  apparent address behind a NAT, would collapse into the same shared bucket - at which point the
  limiter stops protecting the deployment from one abusive client and starts denying search to
  every legitimate one instead. Reverted rather than patched further under uncertainty about which
  topology this will actually deploy behind; `src/lib/client-key.ts` (the header-parsing helper,
  extracted from `auth.ts` during this attempt) stayed, since sign-in throttling degrading to one
  shared lockout is a far smaller blast radius than search degrading to one shared refusal. Still
  needed before any public deployment with a live provider configured; whoever picks this back up
  should know the deployment's real proxy/header topology _before_ choosing a keying strategy, not
  after discovering the same failure again.

- ~~**CSRF protection**~~ **Verified, 3 November 2026 — not merely assumed.** Built the production
  app, submitted a real sign-in form from `/sign-in` and captured its actual hidden
  `$ACTION_REF_1`/`$ACTION_1:0`/`$ACTION_KEY` fields (the real no-JS submission path, not a
  simulation of one), then replayed that exact payload twice: once with a same-origin `Origin`
  header and once with `http://evil.example.com`. Same-origin reached the action (`200`);
  cross-origin was rejected before the action ran (`500` - Next.js throws rather than returning a
  clean `403` for this, which is untidy but not a gap: the handler never executes either way, and
  the error body is a bare `{"digest":"..."}`, nothing that leaks). Repeated with the
  `Next-Action`/RSC fetch path (the one a JS-enabled browser actually uses) with the same result.
  So: genuinely protected for both submission paths, on the action this app actually ships, not
  inferred from the framework's changelog.
- **Audit logging** — needed once bookings or payments do.
- **Nonce-based CSP** — see section 5.
- **Data retention and deletion** — travel history is personal data; a retention policy is required
  before launch, not after.

**Zero-billing policy, enforced 4 November 2026.** An audit found `FLIGHT_PROVIDER=duffel` active
in a real build of this environment, directly contradicting the project owner's "no paid API,
ever" decision already recorded in `docs/provider-evaluation.md`. Fixed the same day: Duffel has
no selectable value in `FLIGHT_PROVIDER` any more, the registry has no code path that can build
the adapter, and `src/providers/registry.test.ts` proves zero outbound calls for every unapproved
or unknown provider configuration, with a `fetch` spy rather than an assumption. The current,
code-synchronised status of every provider now lives in `docs/provider-policy.md`.

**A likely-relevant finding for whoever next debugs the Postgres `ECONNRESET` issue above the
database section**: `src/db/client.ts`'s connection pool was cached on a plain module-level `let`,
the same pattern already proven, in `src/db/index.ts`, to split into two independent instances
across Next.js App Router's Route-Handler/Server-Action module boundary. For a repository cache
that meant two empty in-memory stores; for a real `pg.Pool` it would mean two independent pools of
up to `DATABASE_POOL_MAX` connections each against the same database — a second real connection
source that would not show up by inspecting `DATABASE_POOL_MAX` alone. Moved to `globalThis`
(4 November 2026), the same fix pattern, with lifecycle tests in `src/db/client.test.ts`. This
does not explain the `ECONNRESET` on its own — the symptom (a reset within milliseconds, before
any query's response, consistent with the real Postgres process itself ending the connection
rather than a network-level failure) is also consistent with `DATABASE_SSL` being unset against a
host that requires TLS, which is the first thing worth trying and needs no code change, only a
setting in the real deployment's environment. Not verified either way by this audit: that needs
the real `DATABASE_URL`, which is outside what this audit can read.

The same review found three further module-level singletons worth the same scrutiny:
`src/auth/throttle.ts` (the sign-in rate limiter), `src/search/cache.ts` (the search result
cache) and `src/providers/imagery/index.ts` (the Wikimedia lookup cache and its concurrency
limiter). All three were moved to `globalThis`. The imagery module is the one where the risk was
confirmed real rather than theoretical: its callers already span a Route Handler
(`/api/imagery/[code]`) and several Server Components, which is exactly the split
`src/db/index.ts` proved happens — and a split limiter would have silently doubled the concurrent
request rate against Wikimedia, breaking this module's own documented "one request at a time"
promise to a free service we depend on behaving politely toward.

---

## 10. Review of the 2026-11-15 run (`bd03e10..HEAD`)

Scope: the Resend email driver and templates, the send throttles, `/api/price-calendar`,
`/api/notifications`, the trip hub, the partner allow-list and hand-off, the image paths, the
notification centre, the CSP, the shared-globe client navigation, log redaction and the CSRF posture
of server actions. Every item below was traced from the input to where it ends up; the ones marked
fixed have a test that fails without the fix. Anything not demonstrated is labelled as such.

### Cookie consent and the third-party script (a change, not a finding)

The Travelpayouts Drive script used to load for every production visitor. It now loads only for a
request that carries `voyagr-consent=accepted`:

- `AffiliateDrive` renders the tag server-side from the cookie, so before a choice, or after a
  decline, there is no `<script>` in the HTML and no request to `emrldco.com`.
- `src/proxy.ts` names `https://emrldco.com` in `script-src` and `connect-src` only for that same
  request (`src/consent/csp.ts`, `src/consent/drive.ts`). Everyone else gets a policy that does not
  mention it. Both decisions come from one pure function, so they cannot disagree.
- The cookie holds one word (`accepted` or `declined`), lasts 12 months, is `SameSite=Lax`, `Secure`
  in production, and is not HttpOnly (the banner reads it). It is set by a server action, so Next's
  origin check is the CSRF defence: another site cannot accept on a visitor's behalf.
- Accepting reloads the page rather than calling only `router.refresh()`. A CSP belongs to the
  document response, so a refreshed render cannot make an already-loaded page allow a new origin;
  without the reload the browser would block the script it had just been told it could load.
- Test seam: `DRIVE_TEST_STUB` swaps the vendor URL for a same-origin stub, and is honoured only
  together with `ALLOW_MOCK_IN_PRODUCTION`, which a real deployment refuses to start with. A stray
  value on a live site changes nothing (unit-tested).
- Link-outs to `tpk.lv` / `tp.media` are plain links and need no consent; the privacy page says so.

### Findings

| #   | Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                   | Status               |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | High     | `/api/price-calendar` is unauthenticated and every distinct query is a cache miss that fans out to the flight vendor (2 calls per destination for a by-month vendor, up to about 30 otherwise, 5 destinations). Nothing bounded the number of distinct queries: any month, origin or currency. The concurrency limiter bounds how many calls run at once, not how many queue behind them. | Fixed                |
| 2   | Medium   | Both throttles (`SignInThrottle`, `SendThrottle`) keep one map entry per caller-chosen key (an email typed into a form) and `prune()` was never called anywhere. A loop of distinct addresses grows memory without limit.                                                                                                                                                                 | Fixed                |
| 3   | Medium   | The send throttle's per-client limit keys on the first `x-forwarded-for` value, which a caller can set when no proxy overwrites it. Rotating it removes the client limit; only the per-address limit (3 an hour) remains, so one machine can mail many different addresses.                                                                                                               | Needs owner          |
| 4   | Medium   | `POST /api/push/subscribe` accepted any `https` URL as a push endpoint, and the server later POSTs to it: a signed-in user could aim server-side requests at an internal host (blind SSRF). Not in this diff but on the notification path.                                                                                                                                                | Fixed                |
| 5   | Medium   | The image proxy fetched a URL taken from a Wikipedia API response without checking its host. A poisoned response could point it at an internal address and have the bytes served back. Not in this diff; reviewed with the image paths.                                                                                                                                                   | Fixed                |
| 6   | Low      | Trip, item, expense and contact ids that were not UUIDs reached Postgres and failed with a type error (a 500) instead of the 404 the service promises. Not an access bypass; it made probing distinguishable.                                                                                                                                                                             | Fixed                |
| 7   | Low      | No ceilings on trips per account, people per trip or emergency contacts per account: a script could fill the database through three authenticated forms.                                                                                                                                                                                                                                  | Fixed                |
| 8   | Low      | The Resend driver trusted `to`, `subject` and header values. All come from validated sources today, so no injection is demonstrated, but a loosened upstream validator would turn one mail into mail to a list, or inject a header.                                                                                                                                                       | Fixed (defence)      |
| 9   | Low      | The notification bell renders `notification.url` in an `href`. The pipeline writes app-relative paths, but the column is free text; a `javascript:` or `//host` value would have been rendered.                                                                                                                                                                                           | Fixed (defence)      |
| 10  | Low      | Log redaction did not cover email addresses, one-time links or token hashes. Nothing logs them today (every `log.*` call was checked), but a future `{ email }` or `{ link }` would have gone out in clear.                                                                                                                                                                               | Fixed (defence)      |
| 11  | Low      | An owner can add a registered user to a trip by typing their email; they are linked at once, with no acceptance step, and then see the trip name, place, dates and ledger. The response is identical whether or not the address has an account, so this is not an enumeration oracle; the issue is consent, not disclosure.                                                               | Needs owner          |
| 12  | Low      | Provider-supplied flight and hotel `deepLink` values may be `http:` as well as `https:` (intended for a local sandbox). In production a plain-HTTP link is a worse link, not an injection.                                                                                                                                                                                                | Accepted risk        |
| 13  | Info     | In-process state: both throttles, the price-calendar limiter and the load budget are per process, so a multi-instance deployment multiplies every allowance by the instance count.                                                                                                                                                                                                        | Accepted (as before) |

#### What was done

1. **Price calendar (fixed).** `src/app/api/price-calendar/route.ts` refuses a month outside this
   month through twelve months ahead (400, before any provider work) and limits each client to 60
   requests a minute (429 with `Retry-After`). A request with no client address is not given one
   shared bucket, so a proxy-less deployment does not lock everybody out - the failure recorded in
   section 9. `src/search/day-prices.ts` enforces a per-process budget of 120 cache misses a minute
   (`DAY_PRICE_LOADS_PER_MINUTE`); past it a month answers "could not be loaded", the page degrades
   and the vendor is not called. Cache hits cost nothing. The budget is the real ceiling on spend,
   because the per-client key is only as honest as `x-forwarded-for`. Tests: `route.test.ts` proves
   200 requests with spoofed client keys cause at most 240 provider calls, and that repeating one
   query is one load. Validation of origin, destinations (5 at most), currency and passengers was
   already tight.
2. **Throttle memory (fixed).** Both throttles cap at 10,000 keys (`MAX_THROTTLE_KEYS`), dropping
   expired entries and then the oldest, which forgets one client rather than refusing everybody. The
   new `src/lib/fixed-window.ts` has the same bound.
3. **Push endpoint (fixed).** `src/notifications/push-endpoint.ts` accepts only `https`, default
   port, no credentials and a dotted public hostname: no IP literal (including the cloud metadata
   address), `localhost`, single-label, `.local` or `.internal` host. A vendor allow-list would be
   tighter but would silently break the next browser's push service.
4. **Image proxy (fixed).** `isWikimediaImageUrl` in `src/providers/imagery/url.ts`: `https` on
   `wikimedia.org` only, checked before the fetch and again on the final URL after redirects.
5. **Trip hub ids and ceilings (fixed).** `TripHubService` treats a non-UUID id as not found before
   any query, and caps 100 trips per account, 30 people per trip and 20 contacts per account. The
   actions that create a trip or a contact now turn the limit into a message instead of a 500.
6. **Resend (fixed, defence).** The driver refuses a recipient that is not a single bare mailbox
   (no display name, list, angle bracket, quote, backslash or control character), a subject or
   header value containing a line break, and a malformed header name - before calling the vendor and
   without echoing the value.
7. **Notification links (fixed, defence).** `appRelativeUrl` keeps only a path on this site.
8. **Redaction (fixed).** Added `email`, `newEmail`, `link`, `tokenHash`, `cookie`, `set-cookie`,
   `auth` and `secret` (top level and one level down) to `REDACTED_PATHS`.

#### Reviewed and found sound

- **Email templates.** Every value goes through `escapeHtml`; links through `assertSafeUrl`
  (absolute `http(s)` only, throws otherwise); the subject through `singleLine`. Verification,
  reset and change-of-email links are built from `NEXT_PUBLIC_APP_URL`, never from the `Host`
  header, so a forged `Host` cannot redirect a reset link to an attacker. The new address in an
  email-change mail is escaped like any other text. The key is not logged, and neither is Resend's
  error body.
- **Trip hub authorisation.** Every action starts from `getCurrentUser()` and passes the session's
  user id to the service; no handler trusts an id in a form. `access()` answers a trip you are not
  on exactly as it answers a missing one. Plan items and expenses are checked against the trip in
  the request (`item.tripId !== tripId` is "not found"), so an id from another trip is not an IDOR.
  Contacts belong to the person, not the trip, and are listed and deleted only by their owner.
  Member deletion is scoped `trip_id = $1 AND id = $2`. All SQL is parameterised. Adding a member by
  email returns the same result whether or not the address has an account.
- **Partner links.** `isAllowedPartnerUrl` is `https`, no credentials, host equal to or a dotted
  subdomain of `tpk.lv` / `tp.media` (`evil-tpk.lv` fails). A plan item's partner URL comes from the
  registry by offer id, never from the request, and "Add to my plan" always creates an `idea`. The
  stay link builder encodes the destination once as a query value on a fixed redirect host.
- **`/api/notifications`.** Authenticated, scoped to the session user, `no-store`, at most 30 rows,
  polled once a minute and on focus. Marking read checks ownership.
- **Shared-globe navigation.** The click and submit interceptors in `stage-host.tsx` act only when
  the target's origin equals the page's and its path is `/` or `/explore`, and push
  `pathname + search + hash`, never the original string. GET forms only. Anything else is left to
  the browser. No open redirect found.
- **CSP.** Baseline unchanged (`frame-ancestors 'none'`, `base-uri` and `form-action` `'self'`, no
  `unsafe-inline` or `unsafe-eval` in production `script-src`), now covered by unit tests. The
  service worker never serves cached HTML, so a page cached under one consent state is not replayed
  under another.
- **Server actions and CSRF.** The trip, notification and consent mutations are server actions, so
  Next's origin check applies, and the session cookie is `SameSite=Lax`. The only other state
  changes are `POST` and `DELETE /api/push/subscribe`, which are cookie-authenticated JSON and are
  not reachable from a cross-site form under `Lax`.

#### Needs owner

- **Finding 3: client identity behind a proxy.** Decide the deployment topology and make the proxy
  overwrite `x-forwarded-for` (or give the app a trusted-proxy setting). Until then per-client
  limits narrow a noisy client and do not stop a determined one; the per-address limit and the
  price-calendar load budget are what hold. A global cap on outbound email an hour would bound it
  regardless; it was not added because it lets one abuser deny reset mail to everyone, which is a
  product decision.
- **Finding 11: invitations.** Linking a registered user to a trip without their acceptance is a
  design choice. If strangers adding strangers becomes a nuisance, the fix is an accept step and
  showing a trip only after it.
- **Per-process state.** Moving the throttles, the calendar limiter and the load budget to Redis
  belongs with the queue's move; the interfaces are small.
- **Legal.** The privacy text describes what the code does. Whether Drive's cookies and the consent
  wording satisfy the operator's legal basis is for the owner to confirm; the code cannot know.

#### Not verified

- Behaviour against a live Resend account, the real Travelpayouts script (the e2e build uses the
  stub and never contacts the real host), or a real Postgres (the SQL was read; the repository
  contract tests run on the in-memory implementation).
- Whether the real Drive script sets cookies or contacts hosts beyond `emrldco.com`. If it does the
  CSP blocks them until each is added deliberately.
