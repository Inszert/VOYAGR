# Runbook

How to run Voyagr and what to do when it misbehaves. Written from the code as of 2026-11-17 (branch
`feat/voyagr-autonomous-product-completion`, after commit `dd9c042`).
Voyagr has never been deployed, so nothing here has been exercised on a real host. Items marked
"not verified" are inferred from the code.

## 1. Processes and services

| Process    | Command                      | Needs                                                                                                               |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Web        | `npm run build`, `npm start` | `NEXT_PUBLIC_APP_URL` (section 1a); Postgres and Redis for anything that must persist                               |
| Worker     | `npm run worker`             | The same `DATABASE_URL`, `REDIS_URL`, `QUEUE_DRIVER=bullmq`, and `NEXT_PUBLIC_APP_URL`                              |
| Migrations | `npm run db:migrate`         | `DATABASE_URL` (and `DATABASE_SSL`); before each release. On Railway, the web service's pre-deploy step (section 7) |

| Service    | Why                                       | Without it                                                   |
| ---------- | ----------------------------------------- | ------------------------------------------------------------ |
| Postgres   | Accounts, watches, notifications, trips   | In-memory, lost on restart                                   |
| Redis      | Shared cache and the BullMQ queue         | Cache per process; worker and web cannot see each other      |
| Aviasales  | Flight prices (`AVIASALES_API_TOKEN`)     | Production refuses to start on a mock flight provider        |
| Resend     | Verification, reset and email-change mail | Production refuses `console`: sends fail and it is logged    |
| Open-Meteo | Weather (keyless)                         | Weather lines degrade                                        |
| Wikidata   | Things to do (keyless, CC0)               | The destination page says it cannot list places yet          |
| Wikimedia  | Place photographs (via our image proxy)   | Places are listed without pictures                           |
| ECB        | FX rates (keyless)                        | A foreign-currency quote is dropped, naming the missing pair |

The worker must be an always-on process. `npm run worker` is `tsx --env-file-if-exists=.env
scripts/worker.mjs` and handles `SIGTERM` and `SIGINT` by finishing in-flight jobs (BullMQ returns
unfinished ones to the queue). It is a separate process from the web server, built from the same
code and given the same environment. It runs the refresh timers in section 3, including the places
round set by `PLACES_REFRESH_HOURS`.

## 1a. Environment variables that matter for deployment

Read from `src/lib/env.ts`. The other variables have defaults that work locally. Secrets are never
printed or logged; the environment report shows only whether each one is set.

| Variable                             | Default                 | Set it when                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_APP_URL`                | `http://localhost:3000` | **Always in production, for the web service, the worker and the build.** Set it to the public `https` address of the site. Verification and reset links are built from it. In production it must be set, non-empty and not a loopback address (`localhost`, `127.x.x.x`, `::1`); otherwise the process refuses to start. |
| `DATABASE_URL`                       | unset (in-memory store) | Persistence. On Railway, use the internal URL. It is a secret.                                                                                                                                                                                                                                                           |
| `DATABASE_SSL`                       | `false`                 | The database needs TLS with certificate checking. `scripts/migrate.mjs` enables TLS only for the exact value `true`.                                                                                                                                                                                                     |
| `REDIS_URL`                          | unset                   | Shared cache and the BullMQ queue. Needed with `QUEUE_DRIVER=bullmq`.                                                                                                                                                                                                                                                    |
| `QUEUE_DRIVER`                       | `memory`                | `bullmq` for the web service and worker to share jobs. Requires `REDIS_URL`.                                                                                                                                                                                                                                             |
| `PRICE_REFRESH_MINUTES`              | `30` (1 to 1440)        | How often the worker re-prices what the front pages show. The worker reads it at start, so restart it after a change. Trade-off in section 5.                                                                                                                                                                            |
| `PLACES_REFRESH_HOURS`               | `168` (1 to 720)        | How often the worker pre-warms things to do. Each round covers at most 40 destinations that are not already fresh, a minute apart. Read at worker start. Longer is kinder to Wikidata.                                                                                                                                   |
| `LITEAPI_SNAPSHOT_ENABLED`           | `false`                 | Turns on the scheduled LiteAPI hotel snapshot in the worker (section 4a). Needs `LITEAPI_API_KEY`. Read at worker start.                                                                                                                                                                                                 |
| `LITEAPI_SNAPSHOT_ORIGINS`           | `BUD,VIE,PRG,LON`       | Departure cities the flight snapshot prices (three-letter codes). Each adds up to 54 flight calls a day at three refreshes. Needs the snapshot flag.                                                                                                                                                                     |
| `LITEAPI_SNAPSHOT_REFRESHES_PER_DAY` | `3` (1 to 24)           | Rounds a day at fixed UTC slots. Each adds 18 rates calls a day for six destinations.                                                                                                                                                                                                                                    |

`NEXT_PUBLIC_APP_URL` has the `NEXT_PUBLIC_` prefix, but in this repository it is read on the server
through `getEnv()`, not inlined into client code. Changing it therefore needs a restart, and a rebuild
too if the build has already captured it (section 8).

## 2. Starting

Local:

```bash
npm ci
npm run dev          # web, :3000
npm run worker       # second terminal, optional
```

Production-shaped, locally: `npm run build && npx next start -p 3100`. A stale `next start` still
running gives an empty 404 on every route; stop it first.

A production process fails at startup, with the variable named, if: `FLIGHT_PROVIDER` is `mock` or
`aviasales` has no token; any slot resolves to a mock; or `NEXT_PUBLIC_APP_URL` is unset, empty or a
loopback address (section 1a). That is the intended behaviour; fix the environment, do not set
`ALLOW_MOCK_IN_PRODUCTION`, and do not set `NEXT_PUBLIC_APP_URL` to `localhost` to get past it. The
build reads the same variable, because `robots.ts` and `sitemap.ts` are prerendered at build time, so
`npm run build` in production fails with the same message. Read from the code; not exercised by a build
here. A missing email setting does not stop the process (section 6): it is logged at error level and
every send fails.

## 3. Cron and worker operations

There is no external cron. Schedules are timers inside the worker:

| What                        | Schedule                                                                                                           | Where                          | Sign it ran (log message, logger name)                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------- |
| Watch scheduler             | every 60 s, plus once at start                                                                                     | `src/watches/scheduler.ts`     | `initial sweep complete`; `scheduler started`                                         |
| `travel-watch.refresh`      | per due watch                                                                                                      | `src/watches/refresh.ts`       | per-job logs                                                                          |
| `notification.deliver`      | per notification                                                                                                   | `src/notifications/deliver.ts` | `notification delivery attempted` (`notifications.deliver`)                           |
| `cache.refresh`             | every `PRICE_REFRESH_MINUTES` (30), staggered across the interval, first round at start                            | `src/cache/refresh.ts`         | `cache refresh scheduled`, then `cache target refreshed` per target (`cache.refresh`) |
| `cache.refresh` (date roll) | within 30 s of the UTC date changing; a full round, staggered                                                      | `src/cache/refresh.ts`         | `the UTC date changed; starting a cache refresh round` (`cache.refresh`)              |
| `cache.refresh` (places)    | every `PLACES_REFRESH_HOURS` (168), plus once at start; up to 40 destinations, a minute apart, skipping fresh ones | `src/cache/refresh.ts`         | `places target refreshed` per destination (`cache.refresh`)                           |
| Expired session sweep       | every 6 h, plus once at start                                                                                      | `src/worker/maintenance.ts`    | `expired sessions swept` (only when something was removed)                            |
| Price history prune         | every 24 h                                                                                                         | same                           | `old price observations pruned` (only when something was removed)                     |
| Provider request log prune  | every 24 h                                                                                                         | same                           | `old provider calls pruned`                                                           |

Startup lines worth looking for: `worker started`, `maintenance started`, and the warning
`REDIS_URL is not set: cache refreshes are not shared with the web server.` (which means the cache
refresh is useless) or `QUEUE_DRIVER=memory: this worker has its own in-process queue...`.

How to see that it ran:

- `/status` shows cache "Last refresh", "Warm targets N of M" and where the cache is held (Redis or
  "Memory, lost on restart"). Nothing cached yet, or 0 warm targets, after the worker has run for a
  full interval means the worker is not writing to the Redis the web process reads.
- `/status` also lists per-provider call counts, errors, timeouts and rate limits for the last 24
  hours (rows pruned after 30 days).
- Logs are JSON (pino). A failed refresh logs through `cache.refresh`; the queue retries with
  backoff (3 attempts by default) and the old entry keeps being served.

Not built: no job dashboard, no alert on a dead worker, no heartbeat.

## 4. Cache

Keys: `voyagr:v1:<kind>:<hash>` with kinds `discovery`, `search`, `weather`, `flex`, `places`. TTLs are in
`docs/architecture.md`, section 4. The hash is of the query, so keys cannot be listed by meaning.

Inspect (Redis):

```bash
redis-cli --scan --pattern 'voyagr:v1:*' | head
redis-cli --scan --pattern 'voyagr:v1:discovery:*'
redis-cli PTTL <key>          # remaining life; fresh + stale window at write time
redis-cli GET <key>           # JSON envelope: {"v": value, "o": observedAt}
```

Flush one key: `redis-cli DEL <key>`. Flush a kind: scan that pattern and delete each key. Flush all
cache entries: delete `voyagr:v1:*` entries only. **Do not `FLUSHALL` or `FLUSHDB` if Redis also holds
the BullMQ queue** (it does here): that would delete pending jobs. The memory store has no
inspection tool; restart the process.

After a flush a page does not run the work itself: it finds nothing, shows the globe's places with a
"Prices are loading" line, and enqueues the `recommended` refresh for the worker. Restart the worker
to run a round at once (the `recommended` target is first and has no delay). Flushing `places`
entries makes the first visit to a destination wait on Wikidata (15 to 45 seconds) until the worker's
next places round.

At 00:00 UTC. The discovery query is built from today's UTC date, so the key changes at
midnight. This no longer costs a visitor a search: the worker notices the date change within 30 seconds
and starts a refresh round, and until the new day's entry is written a page serves yesterday's, labelled
by its own age ("Updated N min ago"), and never runs the full-catalogue search itself. Look for `the UTC
date changed; starting a cache refresh round` in the worker log just after 00:00. If it is absent, the
worker was down; restart it. Not verified on a real deployment.

## 4a. LiteAPI hotel snapshot

Visitors never call LiteAPI: pages read our own tables (`docs/architecture.md`, section 4.x). Only the
worker calls the vendor, and only when told to.

**Turn it on** (worker service; the web service needs the same `LITEAPI_API_KEY` and `STAY_PROVIDERS=liteapi` so the
reader is registered, but it never sends the key):

1. Apply migration `0013` (`npm run db:migrate`).
2. Set `LITEAPI_API_KEY`, `LITEAPI_SNAPSHOT_ENABLED=true` and, if you want, `LITEAPI_SNAPSHOT_REFRESHES_PER_DAY`
   on the worker. Use `QUEUE_DRIVER=bullmq` in production so the jobs survive a restart.
3. Restart the worker. Look for `liteapi snapshot scheduled` and then `liteapi snapshot round started` in its log.
4. **Only after Nuitee has confirmed in writing that periodic refresh for display is allowed** (owner question Q10).

**What it costs.** Calls a day = destinations x windows x refreshes. The default is 6 x 3 x 3 = **54 rates
calls a day**, at most about $1.08 a day or $32 a month at the worst-case $0.02 a call; hotel content is
free and about six calls a week. Hourly would be 432 a day. Sandbox has the same counts and is reported
free. The daily ceiling refuses a run once the day's calls reach destinations x windows x refreshes plus
one content call a destination.

**What flights cost.** Calls a day = origins x destinations x windows x refreshes. The default is 4 x 6 x 3 x 3 =
216 at most (an origin that is also a destination is skipped, so about 189 are made), at EUR 0.005 a call beyond
the 1,500:1 ratio: about EUR 1.08 a day, about EUR 32 a month. Each extra origin adds up to 54 a day. The flights
ceiling is counted apart from the hotel one, so neither job can starve the other. `FLIGHT_PROVIDER=liteapi` on the web
service reads the stored rows only.

**Turn it off.** Unset `LITEAPI_SNAPSHOT_ENABLED` (or set it to `false`) and restart the worker: no
scheduler starts, and any job still queued records `disabled` and calls nothing. Stored rows stay and age
out to "Hotel prices are not loaded for these dates yet." within a day.

**See what happened.** Every run is a row in `liteapi_refresh_runs`:

```sql
SELECT destination_code, check_in, status, calls_made, error_code, started_at
  FROM liteapi_refresh_runs ORDER BY started_at DESC LIMIT 20;
SELECT COALESCE(SUM(calls_made), 0) FROM liteapi_refresh_runs
 WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'utc');
```

`error_code` is an error code only (for example `PROVIDER_TIMEOUT`), never a message. A failed run keeps the
previous row. The worker log (`liteapi-snapshot.job`) carries the run id, destination, window, code and calls
made, and never the key.

**Test prices.** With a sandbox key (`sand_...`) the page shows a "Test prices" note beside the freshness line.

## 5. Aviasales quota problems

Declared limit: `rateLimitPerMinute: 600` in `src/providers/flights/aviasales.ts`. The vendor's own
limit is 600 calls per rolling window per API token (see "How a 429 is handled" below). The background
refresh ceiling is about 24,800 calls per hour at the default interval, against 36,000 available
(`docs/architecture.md`, "Quota maths"). Those are ceilings; real use is lower.

How a 429 is handled (`fetchHonouringRateLimit` in `src/providers/flights/aviasales.ts`):

- The Travelpayouts Data API answers an over-limit call with a bare `429` and the headers
  `x-rate-limit`, `x-rate-limit-remaining` and `x-rate-limit-reset` (seconds until the window frees).
  The reset was measured between about 7 and 55 seconds.
- The 600 is shared per token. The web service and the worker both spend from it when they use the same
  `AVIASALES_API_TOKEN`. The limiters in this code (`src/lib/concurrency.ts`) live in each process's
  memory, so neither process sees the other's calls. Judge the quota on the combined spend.
- The adapter waits once and retries when the reset is 8 seconds or less (it sleeps the reset plus
  250 ms). A longer reset, or a second 429, is returned as an error. The call fails as
  `PROVIDER_UNAVAILABLE` and the search degrades. Nothing retries beyond that, and no alert is raised.

Symptoms of trouble:

- `/status` shows rising `rate limits` or `errors` for the flights provider, or timeouts.
- Logs show `aviasales rate limited` (warn, with the limit, remaining and reset headers) and
  `aviasales one-way error status` with status 429. The search then degrades (fewer results, a reason
  shown) and does not fail outright.
- The front page shows older prices than usual ("Updated N min ago" growing) while the worker is up.
- The price calendar returns no days with "Prices for this month could not be loaded."

What to do, in order:

1. Raise `PRICE_REFRESH_MINUTES` (for example 60). It halves the background spend. Restart the
   worker; it reads the value at start.
2. If that is not enough, shorten the target list in `src/cache/targets.ts` (`POPULAR_ORIGINS`,
   `COLLECTIONS`). That is a code change with its quota arithmetic, and `src/cache/refresh.test.ts`
   checks the default stays inside the limit.
3. User traffic spends from the same per-provider limiter and is not in the refresh figure. The
   price calendar spends 2 calls per destination per month (at most 5 destinations, so 10), then is
   cached for an hour. It is bounded for an anonymous caller: a month outside this month through twelve
   ahead is a 400, 60 requests a minute per client is a 429 with `Retry-After`, and a per-process
   budget of 120 cache misses a minute (`DAY_PRICE_LOADS_PER_MINUTE`) turns the rest into "could not
   be loaded" without calling the vendor. Raise nothing here without reading `docs/security.md`,
   section 10.
4. A 401 or 403 means the token is wrong or revoked: check `AVIASALES_API_TOKEN` (`npm run
check:calendar` probes a route; not verified in production).
5. The token is a secret; it must not appear in logs, tickets or chat.

## 5a. Google Flights sidecar (optional, owner-approved exception)

Off unless `GOOGLE_FLIGHTS_SIDECAR_URL` is set and the provider is selected. It scrapes Google
Flights against Google's terms; read `services/google-flights/README.md` and the row in
`docs/provider-policy.md` before enabling it anywhere that matters.

Run it next to the app (Python 3.10+):

```
cd services/google-flights
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # bin/ on Linux
VOYAGR_SIDECAR_KEY=<long random> .venv/Scripts/python server.py
curl http://127.0.0.1:8765/health
```

Set `GOOGLE_FLIGHTS_SIDECAR_URL=http://127.0.0.1:8765` and the same key as
`GOOGLE_FLIGHTS_SIDECAR_KEY` for the app. The sidecar is not a process the app supervises; if it is
down, searches lose that source and carry on with Aviasales.

Symptoms, and what they mean:

- **`consent_wall` / "Google Flights is blocking the scraper".** Google served its cookie-consent
  page instead of results (seen on the first real run, from an EU address). No setting in this
  repository fixes it, and the sidecar deliberately does not fake a consent cookie. Treat the source
  as unavailable.
- **`unparsable`.** Google changed its page and `fast-flights` no longer reads it. Check for a newer
  release, bump the pin in `requirements.txt`, re-run `python -m unittest test_server`.
- **`timeout` or sudden empty lists.** Possible soft-block or throttling. Stop the sidecar for a day
  rather than retry harder; a ban is for the address, not the process.
- **`rate_limited` (429).** More than about 20 s of requests queued behind the 3 s spacing. Lower
  traffic; do not lower `VOYAGR_SIDECAR_MIN_INTERVAL`.
- **401.** `GOOGLE_FLIGHTS_SIDECAR_KEY` does not match `VOYAGR_SIDECAR_KEY`.

To turn it off: unset `GOOGLE_FLIGHTS_SIDECAR_URL` (or take `google-flights` out of
`FLIGHT_PROVIDERS`) and stop the process. Nothing else depends on it.

## 5b. Weather (Open-Meteo)

Open-Meteo needs no key. Two paths in `src/providers/weather/open-meteo.ts` treat a `null` from the
vendor differently:

- **Forecast days** (the 16-day horizon): a day is left out of the outlook when the vendor gave `null`
  for any of its maximum or minimum temperature, its rain probability or its wind. Nothing is shown as a
  made-up `0`. A day missing from a forecast strip means the vendor gave no figure for one of those values.
- **Climatology** (months beyond the forecast): a day is skipped when its maximum, minimum or wind is
  `null`, but a `null` precipitation sum is counted as a dry day (`precipitation_sum[index] ?? 0`). It is
  not left out. That disagrees with the forecast rule and is listed under known gaps (section 10).

## 6. Email problems

Drivers and errors are in `docs/architecture.md`, section 7. Only three mails exist: welcome with
the verification link, password reset, email change.

| Symptom                                                                                | Likely cause and action                                                                                                                             |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Log at startup: "EMAIL_PROVIDER=console is not allowed in production"; no mail is sent | Set `EMAIL_PROVIDER=resend` and `RESEND_API_KEY`                                                                                                    |
| Log at startup: "EMAIL_PROVIDER=resend needs RESEND_API_KEY"; no mail is sent          | The key is unset or empty                                                                                                                           |
| Log: `email rejected by provider` with status 403 or 422                               | The sending domain is not verified in Resend, or `EMAIL_FROM` is not on it. Verify the domain and the SPF, DKIM records (`SETUP-CHECKLIST.md`)      |
| Status 401                                                                             | Wrong or revoked API key                                                                                                                            |
| Status 429                                                                             | Resend's rate limit (the free plan is 100 a day and 3,000 a month, per the owner's notes; check current terms). Mapped to `RATE_LIMITED`, retryable |
| `email request failed` with `aborted: true`                                            | Resend did not answer within 10 s                                                                                                                   |
| User says "I never got it"                                                             | Check Resend's dashboard for the message and any bounce or complaint. Check spam. Our log has only the status and the message id, never the address |
| User told to wait after pressing resend                                                | The app's own throttle: 3 per account and 10 per client per hour, in process memory, per instance. A restart clears it                              |

A failed send never fails the sign-up or reset that triggered it; the user can ask again. Bounce and
complaint handling is Resend's dashboard only; there is no webhook and no suppression list in the
app. Not verified: real delivery to any inbox.

**Previewing the emails without sending any.** From the repository root:

```bash
npx tsx scripts/preview-emails.mjs              # writes .email-previews/
npx tsx scripts/preview-emails.mjs <folder>     # or into a folder of your choice
```

Open `index.html` in the output folder; it links the three rendered mails (`welcome.html`,
`password-reset.html`, `email-change.html`), built from the real templates in
`src/email/templates/transactional.ts` with sample values. The script sends nothing and does not read
`.env`, the database or a mail transport. `.email-previews/` is gitignored. Run it with `npx tsx`, not
`node`, because the templates are TypeScript.

## 7. Database migrations

`npm run db:migrate` reads `.env` (or the host environment), connects with `DATABASE_URL`
(`DATABASE_SSL=true` for TLS with certificate verification), creates `schema_migrations` if missing,
and applies each file in `src/db/migrations/` that is not recorded there, in name order. Current
files: `0001` to `0009`.

- **Forward-only.** There are no down migrations and no rollback tooling. To undo a change, write a
  new migration.
- Take a backup (your host's snapshot or `pg_dump`) before running against production. The app has
  no backup tooling.
- A migration that fails stops the run and exits non-zero; later files are not attempted. The files
  carry their own `BEGIN`/`COMMIT` and their `CREATE TABLE` statements use `IF NOT EXISTS`; read the
  failing file before rerunning, because the `ALTER TABLE` statements were not checked for
  idempotence.
- **Pre-deploy on Railway.** The web service's pre-deploy command is `npm run db:migrate`. That is set in
  the Railway dashboard; the repository has no Railway configuration file. `DATABASE_URL` is Railway's
  internal URL, reachable only from inside the Railway project, so the migration runs there and not from
  a laptop. The script exits non-zero on failure (`process.exitCode = 1`). Check in the Railway deploy
  log that a failed pre-deploy stops the rollout; not verified here. The worker is not covered by that
  step, so deploy it after the migration has succeeded, or run `npm run db:migrate` by hand first.
- **Which migrations run.** Current files are `0001` to `0009`. Any file added later in
  `src/db/migrations/` runs the same way: the runner applies every file whose name is not in
  `schema_migrations`, in name order, so no list needs editing.
- Run it before starting a new web or worker version that needs the new schema. Migration 0008
  (alert preferences) and 0009 (trip hub) are required for the account alert settings and `/trips`.
  Neither has been applied to a real Postgres yet.
- Postgres `ECONNRESET` on every query was seen on a development database (2026-11); `DATABASE_SSL=true`
  was the first thing to try. Not resolved on that database. See `docs/deployment-checklist.md`.

## 8. Deploying from main

The owner fast-forwards `main` after each finished part (push the branch, fast-forward `main`);
`.github/workflows/ci.yml` runs on pushes and pull requests to `main` or `master`. No host is chosen
and no deploy pipeline exists in the repository. When one is chosen:

1. `npm run verify` is green on the commit.
2. Set the environment on the host (`SETUP-CHECKLIST.md`), including for the worker process. Set
   `NEXT_PUBLIC_APP_URL` to the public `https` address before the build (section 1a).
3. `npm run db:migrate` against the production database. On Railway this is the web service's
   pre-deploy step (section 7).
4. Build (`npm run build`; the `prebuild` step copies the MapLibre worker into `public/`, and
   skipping it gives a globe with an empty ocean) and start web and worker.
5. Run the post-deploy checks below.

Roll back by redeploying the previous commit. The database does not roll back (section 7).
`NEXT_PUBLIC_*` values are inlined by Next.js at build time where client code uses them; rebuild
after changing one. In this repository `NEXT_PUBLIC_APP_URL` is read on the server (section 1a), and the
build reads it too, so rebuild after changing it.

## 9. After a deploy

| Check             | Expect                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/status`         | Flights slot is the live provider (not mock); weather and places live; hotels and transfers shown as Absent; cache backend "Redis"; after one refresh interval, warm targets above 0 |
| `GET /api/health` | 200 and `status: ok`, with `capabilities.database`, `redis`, `backgroundJobs: "bullmq"`, `providersFullyMocked: false`, and `hotels` and `transfers` as `absent`                     |
| `/`               | The globe, with prices and an "Updated N min ago" line; no "Demo data"; no API/MOCK switch                                                                                           |
| A search          | Results with flights; trips say "Flights only - stay not included" unless a stay is priced                                                                                           |
| Sign-up           | A verification mail arrives                                                                                                                                                          |
| Response headers  | `Content-Security-Policy` with a nonce; `https://emrldco.com` appears in it only on a request that carries `voyagr-consent=accepted`                                                 |
| Browser console   | No CSP violations                                                                                                                                                                    |

**`/api/health` is 200 in a healthy production deployment.** Its `status` is `ok` (HTTP 200) when every
configured live provider answers healthy and any configured database is reachable. It is `degraded`
(HTTP 503) when a configured database is unreachable or a _configured_ provider is not healthy. An
absent slot is configuration, not an outage: the hotel and transfer slots in production, and places when
`PLACES_PROVIDER=absent`, are listed with status `absent` and do not degrade it. So a host's
restart-on-failure health check can use it. A real outage of Aviasales, Open-Meteo or Wikidata does turn
it 503, which is the intended signal. If the check itself throws, it answers 500 with problem details.
Unit-tested; not verified on a deployed host.

`/status` (`src/app/(column)/status/page.tsx`) is the operator page. It shows which providers are
connected, the cache backend and its last refresh and warm targets, and each provider's calls, errors,
timeouts and rate limits over the last day. Call rows are pruned after 30 days.

## 10. Known gaps

- Worker liveness is not monitored; a dead worker shows only as an ageing "Updated" line and `/status`.
- Stays are not refreshed; there is no stay provider to refresh.
- Things to do are pre-warmed 40 destinations a round; the whole catalogue takes several rounds at the default `PLACES_REFRESH_HOURS`.
- Climatology counts a `null` precipitation day as dry, where the forecast leaves such a day out (section 5b).
- The Aviasales limiters are per process, so the web service and the worker cannot see each other's calls
  against the shared 600-per-window token limit (section 5).
- Sign-in and email-send throttles are in process memory (per instance, reset on restart). There is
  no rate limit on the search page. No audit log.
- No priced hotel feed, no live transfers, no AI adapter, no booking. Places are live from Wikidata but carry no restaurants, prices or reviews.
- No backups or rollback tooling.
- Open-Meteo's free tier is non-commercial; the boundary is unresolved.
- Real email delivery, live Aviasales calendar calls from a host, and migrations 0008 and 0009 on
  Postgres are unverified.
