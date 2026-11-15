# Runbook

> **Not yet reflected here:** uncommitted work that was in the tree while this was written (a cookie-consent banner gating the Drive script, a Wikidata places provider with `PLACES_PROVIDER=wikidata` and a `places` cache kind, a `DRIVE_TEST_STUB` test variable). Sections on cookie consent, places and the env table describe commit `0093bcb`; reconcile them when that work is committed.

How to run Voyagr and what to do when it misbehaves. Written from the code at commit `0093bcb`.
Voyagr has never been deployed, so nothing here has been exercised on a real host. Items marked
"not verified" are inferred from the code.

## 1. Processes and services

| Process    | Command                      | Needs                                                       |
| ---------- | ---------------------------- | ----------------------------------------------------------- |
| Web        | `npm run build`, `npm start` | Env vars; Postgres and Redis for anything that must persist |
| Worker     | `npm run worker`             | The same `DATABASE_URL`, `REDIS_URL`, `QUEUE_DRIVER=bullmq` |
| Migrations | `npm run db:migrate`         | `DATABASE_URL` (and `DATABASE_SSL`), run once per release   |

| Service    | Why                                       | Without it                                                     |
| ---------- | ----------------------------------------- | -------------------------------------------------------------- |
| Postgres   | Accounts, watches, notifications, trips   | In-memory, lost on restart                                     |
| Redis      | Shared cache and the BullMQ queue         | Cache per process; worker and web cannot see each other        |
| Aviasales  | Flight prices (`AVIASALES_API_TOKEN`)     | Production refuses to start on a mock flight provider          |
| Resend     | Verification, reset and email-change mail | Production refuses `console`; the worker also stops at startup |
| Open-Meteo | Weather (keyless)                         | Weather lines degrade                                          |
| ECB        | FX rates (keyless)                        | A foreign-currency quote is dropped, naming the missing pair   |

The worker must be an always-on process. `npm run worker` is `tsx --env-file-if-exists=.env
scripts/worker.mjs` and handles `SIGTERM` and `SIGINT` by finishing in-flight jobs (BullMQ returns
unfinished ones to the queue).

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
`aviasales` has no token; `EMAIL_PROVIDER` is `console`; or any slot resolves to a mock. That is the
intended behaviour; fix the environment, do not set `ALLOW_MOCK_IN_PRODUCTION`.

## 3. Cron and worker operations

There is no external cron. Schedules are timers inside the worker:

| What                       | Schedule                                                                                | Where                          | Sign it ran (log message, logger name)                                                |
| -------------------------- | --------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| Watch scheduler            | every 60 s, plus once at start                                                          | `src/watches/scheduler.ts`     | `initial sweep complete`; `scheduler started`                                         |
| `travel-watch.refresh`     | per due watch                                                                           | `src/watches/refresh.ts`       | per-job logs                                                                          |
| `notification.deliver`     | per notification                                                                        | `src/notifications/deliver.ts` | `notification delivery attempted` (`notifications.deliver`)                           |
| `cache.refresh`            | every `PRICE_REFRESH_MINUTES` (30), staggered across the interval, first round at start | `src/cache/refresh.ts`         | `cache refresh scheduled`, then `cache target refreshed` per target (`cache.refresh`) |
| Expired session sweep      | every 6 h, plus once at start                                                           | `src/worker/maintenance.ts`    | `expired sessions swept` (only when something was removed)                            |
| Price history prune        | every 24 h                                                                              | same                           | `old price observations pruned` (only when something was removed)                     |
| Provider request log prune | every 24 h                                                                              | same                           | `old provider calls pruned`                                                           |

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

Keys: `voyagr:v1:<kind>:<hash>` with kinds `discovery`, `search`, `weather`, `flex`. TTLs are in
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

After a flush the next visit to a page runs the work itself (a full-catalogue discovery search, up
to 2000 provider calls). Prefer waiting for the worker, or restart the worker to run a round at
once (the `recommended` target is first and has no delay).

Cold start at 00:00 UTC. The discovery query is built from today's UTC date, so the key changes at
midnight UTC. The worker computes the new key on its next round, which can be up to the refresh
interval later. Until the new key is written, the first visitor after midnight waits for a live
full-catalogue search, or sees a snapshot without prices if it fails. Mitigations: restart the
worker just after 00:00 UTC; or accept one slow request. This is a known gap, not handled in code,
and not verified on a real deployment.

## 5. Aviasales quota problems

Declared limit: 600 calls per minute (`rateLimitPerMinute` in `src/providers/flights/aviasales.ts`).
The background refresh ceiling is about 24,800 calls per hour at the default interval, against
36,000 available (`docs/architecture.md`, "Quota maths"). Those are ceilings; real use is lower.

Symptoms of trouble:

- `/status` shows rising `rate limits` or `errors` for the flights provider, or timeouts.
- Logs show `RATE_LIMITED` provider errors. A search then degrades (fewer results, a reason shown)
  and does not fail outright.
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
   cached for an hour.
4. A 401 or 403 means the token is wrong or revoked: check `AVIASALES_API_TOKEN` (`npm run
check:calendar` probes a route; not verified in production).
5. The token is a secret; it must not appear in logs, tickets or chat.

## 6. Email problems

Drivers and errors are in `docs/architecture.md`, section 7. Only three mails exist: welcome with
the verification link, password reset, email change.

| Symptom                                                                       | Likely cause and action                                                                                                                             |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process will not start: "EMAIL_PROVIDER=console is not allowed in production" | Set `EMAIL_PROVIDER=resend` and `RESEND_API_KEY`                                                                                                    |
| Process will not start: "needs RESEND_API_KEY"                                | The key is unset or empty                                                                                                                           |
| Log: `email rejected by provider` with status 403 or 422                      | The sending domain is not verified in Resend, or `EMAIL_FROM` is not on it. Verify the domain and the SPF, DKIM records (`SETUP-CHECKLIST.md`)      |
| Status 401                                                                    | Wrong or revoked API key                                                                                                                            |
| Status 429                                                                    | Resend's rate limit (the free plan is 100 a day and 3,000 a month, per the owner's notes; check current terms). Mapped to `RATE_LIMITED`, retryable |
| `email request failed` with `aborted: true`                                   | Resend did not answer within 10 s                                                                                                                   |
| User says "I never got it"                                                    | Check Resend's dashboard for the message and any bounce or complaint. Check spam. Our log has only the status and the message id, never the address |
| User told to wait after pressing resend                                       | The app's own throttle: 3 per account and 10 per client per hour, in process memory, per instance. A restart clears it                              |

A failed send never fails the sign-up or reset that triggered it; the user can ask again. Bounce and
complaint handling is Resend's dashboard only; there is no webhook and no suppression list in the
app. Not verified: real delivery to any inbox.

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
2. Set the environment on the host (`SETUP-CHECKLIST.md`), including for the worker process.
3. `npm run db:migrate` against the production database.
4. Build (`npm run build`; the `prebuild` step copies the MapLibre worker into `public/`, and
   skipping it gives a globe with an empty ocean) and start web and worker.
5. Run the post-deploy checks below.

Roll back by redeploying the previous commit. The database does not roll back (section 7).
`NEXT_PUBLIC_*` values are inlined by Next.js at build time where client code uses them; rebuild
after changing one.

## 9. After a deploy

| Check             | Expect                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/status`         | Flights slot is the live provider (not mock); weather live; hotels, transfers and places shown as not available; cache backend "Redis"; after one refresh interval, warm targets above 0 |
| `GET /api/health` | JSON with `capabilities.database`, `redis`, `backgroundJobs: "bullmq"`, `providersFullyMocked: false`. See the warning below                                                             |
| `/`               | The globe, with prices and an "Updated N min ago" line; no "Demo data"; no API/MOCK switch                                                                                               |
| A search          | Results with flights; trips say "Flights only - stay not included" unless a stay is priced                                                                                               |
| Sign-up           | A verification mail arrives                                                                                                                                                              |
| Response headers  | `Content-Security-Policy` with a nonce; `https://emrldco.com` is the only third-party script origin                                                                                      |
| Browser console   | No CSP violations                                                                                                                                                                        |

**`/api/health` will probably return 503 in production.** It reports `degraded` (HTTP 503) unless
every provider's health probe is `healthy`, and the `absent` hotel, transfer and place slots always
answer `unavailable` (`src/providers/absent.ts`). Do not point a host's restart-on-failure health
check at it expecting 200. Read the JSON body, or use `/status`. Not verified on a deployed host.

## 10. Known gaps

- Worker liveness is not monitored; a dead worker shows only as an ageing "Updated" line and `/status`.
- The cache key rolls over at 00:00 UTC with no pre-warming (section 4).
- `HOTEL_REFRESH_MINUTES` is read by nothing; stays are not refreshed.
- Sign-in and email-send throttles are in process memory (per instance, reset on restart). There is
  no rate limit on the search page. No audit log.
- No cookie-consent banner; the Drive script loads in production without consent.
- No priced hotel feed, no live transfers or places, no AI adapter, no booking.
- No backups or rollback tooling.
- Open-Meteo's free tier is non-commercial; the boundary is unresolved.
- Real email delivery, live Aviasales calendar calls from a host, and migrations 0008 and 0009 on
  Postgres are unverified.
