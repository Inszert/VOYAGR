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

Set in `next.config.ts`, asserted by the end-to-end suite:

| Header                       | Value                                                    |
| ---------------------------- | -------------------------------------------------------- |
| `Content-Security-Policy`    | `default-src 'self'`, `frame-ancestors 'none'`, and more |
| `Strict-Transport-Security`  | 2 years, `includeSubDomains`, `preload`                  |
| `X-Content-Type-Options`     | `nosniff`                                                |
| `X-Frame-Options`            | `DENY`                                                   |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`                        |
| `Permissions-Policy`         | camera, microphone and payment denied                    |
| `Cross-Origin-Opener-Policy` | `same-origin`                                            |

`X-Powered-By` is disabled.

**Known limitation.** The CSP allows `'unsafe-inline'` for scripts and styles, which Next.js'
streaming style and script injection currently requires. Moving to a nonce-based CSP is worthwhile
before handling payments. `'unsafe-eval'` is development-only.

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

Deliberately out of scope for the foundation, and each one blocks its own feature:

- **Authentication and sessions** — arrives with Phase 1.3.
- **Rate limiting** — needed before any public deployment; provider calls cost money, so an abusive
  client is a billing problem as much as a load problem.
- **CSRF protection** — needed once authenticated mutations exist.
- **Audit logging** — needed once bookings or payments do.
- **Nonce-based CSP** — see section 5.
- **Data retention and deletion** — travel history is personal data; a retention policy is required
  before launch, not after.
