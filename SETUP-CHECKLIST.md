# Voyagr - going-live checklist

> **Not yet reflected here:** uncommitted work that was in the tree while this was written (a cookie-consent banner gating the Drive script, a Wikidata places provider with `PLACES_PROVIDER=wikidata` and a `places` cache kind, a `DRIVE_TEST_STUB` test variable). Sections on cookie consent, places and the env table describe commit `0093bcb`; reconcile them when that work is committed.


Rewritten 2026-11-15 against the code at `0093bcb`. Nothing here has been done yet: no host is
chosen, no account created by the code, no deployment made. Tick items as they happen.

Who does what: the accounts, keys and DNS records are the owner's. The table of what each one
unlocks, and the free-tier notes, are in [`WHAT-I-NEED-FROM-YOU.md`](WHAT-I-NEED-FROM-YOU.md); this
file does not repeat them. How to operate the result is in [`docs/runbook.md`](docs/runbook.md).

**Rule that decides most things:** zero paid search API cost. Hosting and a domain may cost money; a
search must not (`docs/provider-policy.md`). **Production never serves mock data**: it refuses to
start on a mock flight, weather or email provider (`docs/finish-plan.md`, decision of record
2026-11-14).

A local `npm install && npm run dev` still works with no `.env` at all, on fixtures and in-memory
storage.

## 1. Accounts and keys

| Done | Item                                  | Variables                                                  | Notes                                                                   |
| ---- | ------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| [ ]  | Travelpayouts / Aviasales token       | `AVIASALES_API_TOKEN` (secret)                             | Required: production refuses to start without a live flight provider    |
| [ ]  | Travelpayouts marker                  | `AVIASALES_PARTNER_ID` (public)                            | Affiliate marker in outbound and stay links                             |
| [ ]  | Hotel programme and campaign ids      | `TRAVELPAYOUTS_HOTEL_PROGRAM_ID`, `TRAVELPAYOUTS_HOTEL_CAMPAIGN_ID` | Only for the "Find a stay" links; unset means no stay links     |
| [ ]  | Resend account, verified domain       | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` (secret)         | Required: production refuses `console`                                  |
| [ ]  | Redis                                 | `REDIS_URL` (secret), `QUEUE_DRIVER=bullmq`                | Required in practice: shared cache and queue between web and worker     |
| [ ]  | Postgres                              | `DATABASE_URL` (secret), `DATABASE_SSL`                    | Required in practice: otherwise accounts and trips vanish on restart    |
| [ ]  | Web Push keys (optional)              | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `npm run vapid:generate` prints a pair. Regenerating invalidates every push subscription |
| [ ]  | Priced hotel feed (optional)          | none yet                                                   | No adapter exists. A key alone does nothing; an adapter must be written (`docs/architecture.md`, 5) |
| [ ]  | Domain `voyagrfind.com`               | `NEXT_PUBLIC_APP_URL`, `PUBLIC_BASE_URL`, `EMAIL_FROM`     | `EMAIL_FROM` defaults to `Voyagr <hello@voyagrfind.com>` and must be on the verified domain |
| [ ]  | Postal address for email footers      | `EMAIL_POSTAL_ADDRESS`                                     | Optional; a visible placeholder prints if unset                         |

`AI_PROVIDER=anthropic` is not implemented and fails at startup. Leave `AI_PROVIDER` unset (mock).

## 2. DNS records (email)

Resend shows the exact values after the domain is added; paste those, not the shapes below.

| Done | Type  | Host                | Value                                                              |
| ---- | ----- | ------------------- | ------------------------------------------------------------------ |
| [ ]  | TXT   | `send`              | SPF from Resend                                                    |
| [ ]  | MX    | `send`              | Feedback MX from Resend, priority 10                               |
| [ ]  | TXT   | `resend._domainkey` | DKIM public key from Resend                                        |
| [ ]  | TXT   | `_dmarc`            | `v=DMARC1; p=none; rua=mailto:<your address>; pct=100`, tighten later |

Wait until Resend shows the domain as verified before sending. Also needed, outside DNS: point the
site's hostname at the host, with HTTPS (the CSP has `upgrade-insecure-requests`).

## 3. Host environment variables

Set these on **both** the web and the worker process. The full list with defaults is the table in
[`README.md`](README.md#environment-variables), generated from `src/lib/env.ts`.

Minimum for a live deployment:

```
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://<your origin>
PUBLIC_BASE_URL=https://<your origin>
DATABASE_URL=...            DATABASE_SSL=true      (if the host requires TLS)
REDIS_URL=...               QUEUE_DRIVER=bullmq
FLIGHT_PROVIDER=aviasales   AVIASALES_API_TOKEN=...   AVIASALES_PARTNER_ID=...
EMAIL_PROVIDER=resend       RESEND_API_KEY=...
STAY_PROVIDERS=travelpayouts-links   (with the two Travelpayouts hotel ids)
```

Do not set:

- `ALLOW_MOCK_IN_PRODUCTION` (it exists only for the end-to-end suite and also turns off the
  Travelpayouts Drive script);
- `DATA_SOURCE_SWITCH` (leave unset; the API/MOCK switch then stays hidden in production);
- `FLIGHT_PROVIDER=mock`, `EMAIL_PROVIDER=console`, `HOTEL_PROVIDER=mock`.

`PRICE_REFRESH_MINUTES` (default 30) sets the background Aviasales spend; see the quota maths in
`docs/architecture.md` before lowering it. Secrets come from the host's secret store, never from a
file in the repository. `.env*` other than `.env.example` is gitignored.

## 4. Database

- [ ] Take a backup or snapshot of the target (the app has no backup tooling).
- [ ] `npm run db:migrate` against the production `DATABASE_URL`. Applies `0001` to `0009`
      forward-only; there is no rollback tooling. Needs 0008 (alert preferences) and 0009 (trip hub).
- [ ] Prove a real write works. Migrations 0008 and 0009 have not been run on a real Postgres. A
      build succeeds whether or not the database is reachable, so a green build proves nothing here.
- [ ] If every query fails with `ECONNRESET`, try `DATABASE_SSL=true` first
      (`docs/deployment-checklist.md`).

## 5. Worker process

- [ ] Run `npm run worker` as an always-on process with the same env as web. Free tiers that sleep
      will stop price refresh, watch checks and push delivery.
- [ ] Confirm the log lines `worker started` and `cache refresh scheduled`.
- [ ] Confirm there is no warning `REDIS_URL is not set` or `QUEUE_DRIVER=memory`.

## 6. Deploy

- [ ] `npm run verify` green on the commit (the owner fast-forwards `main` after each part).
- [ ] Build with `npm run build` (not `next build` directly, so the MapLibre worker is copied), then
      `npm start`.
- [ ] Decide the cookie-consent question (section 8) before opening to EU visitors.

## 7. Post-deploy checks

- [ ] `/status`: flights provider is live (not mock); weather live; hotels, transfers and places
      "not available"; cache held in Redis; after one refresh interval, warm targets above 0.
- [ ] `/api/health`: JSON shows `backgroundJobs: "bullmq"`, `redis: true`, `providersFullyMocked:
      false`. **It will probably answer 503 `degraded`** because the `absent` slots report
      `unavailable`; do not wire a restart-on-failure probe to it expecting 200 (not verified on a host).
- [ ] `/`: globe with prices and "Updated N min ago"; no "Demo data", no API/MOCK switch.
- [ ] A search returns trips; totals say "Flights only - stay not included".
- [ ] Sign up: the verification mail arrives; the link signs the account in as verified.
- [ ] Password reset mail arrives.
- [ ] Response carries a `Content-Security-Policy` with a nonce; no CSP errors in the browser console.
- [ ] In the Travelpayouts dashboard, run "Verify installation" for the Drive script (it passes only
      after a deploy).
- [ ] Create a watch and confirm the worker logs a refresh for it (push needs the VAPID pair).

## 8. Decisions only the owner can make

- **Cookie consent.** The Drive script and affiliate links set tracking cookies. There is no consent
  banner; the script loads without consent. Recommendation in `WHAT-I-NEED-FROM-YOU.md`: load it only
  after "accept". Not built.
- **Hosting target** and its spend. Check for automatic billing risk first.
- **Priced hotel feed** and its terms.
- **Open-Meteo commercial use.** The free tier is non-commercial; ask before the site earns revenue.
- **Legal pages.** `/privacy` and `/terms` are drafts and need legal review.
- **Licence.** Not chosen.

## 9. Known gaps, not hidden

From `docs/security.md`, `docs/runbook.md` and the code:

- No rate limiting on the search page. A naive limiter collapsed into one shared bucket behind a
  proxy and was reverted; confirm the real proxy and header topology before trying again.
- Sign-in and email-send throttles are per process, in memory.
- No audit logging. Not needed until booking or payments exist.
- No backups, no rollback tooling, forward-only migrations.
- No worker monitoring. The discovery cache key rolls at 00:00 UTC with no pre-warming.
- CSP keeps `'unsafe-inline'` for styles (a `style=` attribute is set by several components).
- Real email delivery, live Aviasales calendar calls from a host, and migrations 0008 and 0009 are
  not verified.
- No priced hotels, transfers or places data; no AI adapter; no booking or payments.
- Not applicable yet: app-store accounts, merchant-of-record, autonomous booking, multi-region.

## 10. Verification commands

```
npm run verify                              # format check, lint, typecheck, test, build
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e  # production build on fixtures; local Chrome
```

CI is `.github/workflows/ci.yml`, on pushes and pull requests to `main` or `master`.
