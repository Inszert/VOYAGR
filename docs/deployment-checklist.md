# Deployment checklist

A checklist, not a deployment. Nothing here provisions a resource, chooses a host, or spends
money - those are explicitly the project owner's decisions, not an agent's, and several items
below exist specifically to make sure none of them is made by accident.

## Decisions only a human can make

- **Hosting target** for the Next.js app itself. Not chosen. Any option must be checked for
  unavoidable cost and automatic-billing risk before it is picked, the same bar
  `docs/provider-policy.md` holds every data provider to.
- **PostgreSQL hosting.** Not chosen. `verification-status.json` (2026-09-23) recorded a
  development instance on Railway reached over a public proxy; that is not necessarily where this
  ships. See "Known blocker" below - the current connection, whatever it is pointed at, does not
  work.
- **Redis hosting**, needed once `QUEUE_DRIVER=bullmq` - the app runs correctly without it
  (`src/queue/index.ts` defaults to an in-process driver), but Travel Watch refreshes do not
  survive a restart until it exists.
- **Licence.** Not chosen; the README records this as open.
- **CI trigger for this branch.** `.github/workflows/ci.yml` only runs on push/PR to `main` or
  `master`. This work has happened entirely on `feat/voyagr-autonomous-product-completion`, 18
  commits ahead of `main` as of this audit, and has never run through CI. Opening (or merging) a
  PR is this session's explicit boundary not to cross without approval.

## Known blocker - do not deploy against this until it is resolved

The configured Postgres connection in the audited environment fails on every query with
`ECONNRESET`, immediately, before any protocol-level response - consistent with the server itself
terminating the connection rather than a network failure. See `docs/security.md` section 9 for
the full diagnosis and the two things worth trying first (`DATABASE_SSL=true`; confirming the pool
singleton fix in `src/db/client.ts` didn't mask a second cause). **Do not deploy until
`npm run db:migrate` and a real write have been proven against the actual target**, not inferred
from a successful build - a build succeeds whether or not the database is reachable, by design
(`src/db/client.ts`'s whole point is that nothing connects at import time).

## What already works with zero configuration

- `DATABASE_URL` unset → in-memory repositories. Lost on restart, fine for evaluating the product,
  never acceptable for anything a real user's data should survive.
- `REDIS_URL` unset → in-process queue. Same caveat.
- Every provider defaults to `mock` except imagery (`wikimedia`, free) and email (`console`,
  logs instead of sending). See `docs/provider-policy.md` for the full, current table.
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` unset → push notifications are simply off;
  nothing errors.

## Before flipping any provider from mock to real

1. Check `docs/provider-policy.md` - a provider must say **APPROVED** there, not merely exist in
   code, before it is turned on anywhere real users will reach it.
2. For Aviasales/Travelpayouts specifically: do not enable scheduled/background Travel Watch
   polling against it until its background-polling terms are actually answered (currently
   **PENDING**).
3. For Open-Meteo specifically: re-confirm its "non-commercial use" boundary before this product
   earns revenue (currently **PENDING**).
4. Set `DATABASE_SSL` correctly for the real target - defaults to `false`, and a managed Postgres
   host that requires TLS will very likely reproduce the `ECONNRESET` symptom above if this is
   wrong.

## Pre-flight commands

Run in this order; stop and fix before continuing if any step fails:

```
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run db:migrate   # only once DATABASE_URL points at something real and reachable
npm run test:e2e     # against the real build, not next dev
```

`npm run verify` runs the first five in sequence. None of these commands provisions anything or
spends money on their own; `db:migrate` does write schema to whatever `DATABASE_URL` names, so
only run it against a database you mean to write to.

## What this checklist deliberately does not do

It does not pick a host, does not create an account anywhere, does not accept any vendor's terms,
and does not run `db:migrate` or any live-provider call on your behalf. Those are the lines this
project's own operating rules draw between planning a deployment and performing one.
