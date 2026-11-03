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
