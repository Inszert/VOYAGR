# Voyagr — Setup Checklist

Generated from a repository audit on 2026-09-18. Source of truth: `docs/PRODUCT-SPECIFICATION.md`.

## Current repository state

- **Contents:** `docs/PRODUCT-SPECIFICATION.md` and `.git` only. No source code, no `package.json`/`pyproject.toml`, no config files, no tests, no CI, no `.env*`, no `.claude/` project config.
- **Git:** local repo, branch `master`, 1 commit (`docs: add product specification`), clean working tree, **no remote configured** (not pushed anywhere yet).
- **Local machine tooling found:** Node v24.15.0, npm 11.12.1, Python 3.10.9, Git 2.39.0. **Not found:** pnpm, yarn, Docker, `psql` client, `redis-cli`, GitHub CLI (`gh`).
- Nothing has been installed, created, or modified as part of this audit.

The spec (§20 Architecture, §26 Development Approach) describes a Next.js/React/TypeScript PWA, a Postgres database, a Redis+BullMQ job queue, an LLM for reasoning, and a set of external provider adapters (flights, hotels, weather, places, transfers). Everything below is derived from that description — nothing here has been invented beyond it.

---

## Required

Needed to bootstrap even the Phase 1 MVP loop (§25): search → complete-trip cost → ranking → saved watch → background refresh → basic alert.

| Item | Why | When | Where/how configured | Placeholder OK? |
|---|---|---|---|---|
| **Node.js runtime** (already installed: v24.15.0) | Spec architecture is Next.js/React/TypeScript (§20). | Before any scaffolding. | Already present on this machine. | N/A |
| **Package manager choice** (npm/pnpm/yarn) | Needed to install and lock dependencies once code exists. | Before first `npm/pnpm init`. | `package.json` + lockfile in repo root. | npm is already available; no install needed to start. |
| **Framework decision: Next.js (App Router) + TypeScript** | Explicit recommendation in §20; frontend and initial backend both live here. | Before scaffolding the app. | Project root (`next.config.*`, `tsconfig.json`). | N/A — this is a decision, not an install. |
| **PostgreSQL database** | System of record for the data model in §21 (users, trips, price history, watches, etc.). | Before persistence/search-saving work (Development step 15 in §26). | Local: install Postgres or run via Docker; connection string in `.env.local` / `DATABASE_URL`. | Yes — local dev can use a throwaway local Postgres instance or a free-tier managed instance (e.g. Neon/Supabase) as a placeholder. |
| **Redis + a queue library (BullMQ)** | Powers background Travel Watch monitoring workers (§17, §20, §26 step 16–17). | Once background/scheduled search work begins (Phase 1 late, Phase 2). | Local Redis instance or managed Redis (e.g. Upstash); `REDIS_URL` env var. | Yes for local dev; a managed free tier works as a placeholder before production scale. |
| **Environment variable / secrets strategy** | All provider keys, DB/queue URLs, and the LLM key must live outside source control. | Immediately once any provider integration starts. | `.env.local` (gitignored) for dev; a secrets manager or host-provided env vars (Vercel/Railway/etc.) for deployed environments. | Use empty/placeholder values in `.env.example`; never commit real keys. |
| **`.gitignore`** | Repo currently has none — first code commit risks leaking `node_modules`, `.env`, build output. | Before the first source-code commit. | Repo root. | N/A |
| **LLM provider access (API key)** | AI responsibilities in §23 (parsing, explanations, itinerary generation) require an LLM. | Once natural-language parsing or AI explanations are built (§26 step 21, Phase 1→2 boundary). | `.env` as `ANTHROPIC_API_KEY` (or provider of choice); never in chat/checklist. | Yes, can be stubbed with a mock/deterministic response function until a real key is supplied. |
| **At least one flight-data provider** | §22, §26 step 12 — MVP needs one flight source. | Phase 1 MVP. | Provider adapter module + API key in env. | Yes — can start against a mocked/fixture adapter that returns sample offers, matching the "provider abstraction" principle in §4. |
| **At least one hotel-data provider** | §22, §26 step 12 — MVP needs one hotel source. | Phase 1 MVP. | Provider adapter module + API key in env. | Yes — same mock-adapter approach as flights. |
| **Test runner** | Spec doesn't mandate one, but deterministic pricing/total-cost logic (§10, §23) needs unit tests to be trustworthy. | As soon as the pricing/scoring engine exists. | e.g. Vitest or Jest, configured in `package.json`. | N/A — decision, not a blocking install. |

## Optional

Improve the product per the spec but aren't required to prove the MVP loop.

| Item | Why | When | Where/how configured | Placeholder OK? |
|---|---|---|---|---|
| **Weather API** | §13 Weather Intelligence is a Phase 1/2 ranking input, not required for the very first search→save→alert loop. | Once weather-aware ranking/itinerary lands (§26 step 21+). | Adapter + API key. | Yes, mock or skip initially. |
| **Maps/Places API** | Needed for distance-to-beach/center, restaurant and activity discovery (§11, §12). | Phase 2 (restaurants/activities/itinerary). | Adapter + API key. | Yes. |
| **Transfer/ground-transport provider or estimator** | §9, §10 true-trip-cost needs transfer costs; can start as a rough estimate rather than a live provider. | Phase 1 (estimate) → Phase 2 (real provider). | Adapter + API key or static estimation logic. | Yes — a simple heuristic estimate is explicitly acceptable per §10 ("known, estimated or excluded"). |
| **Web Push infrastructure (VAPID keys, service worker)** | §18 Notifications, §20 PWA. | Once notifications are built (§26 step 19). | `.env` VAPID keys; service worker registered in the Next.js app. | Yes — can be deferred; email notifications could come first. |
| **Email delivery provider** (e.g. Resend, SendGrid, Postmark) | Alternate/additional notification channel (§18). | Same phase as notifications. | API key in env. | Yes, can defer to Web Push only initially. |
| **Docker / docker-compose** | Convenient way to run Postgres + Redis locally without native installs. | Any time during local setup. | `docker-compose.yml` in repo root. | Not installed on this machine currently — optional convenience, not a hard requirement (native installs work too). |
| **CI/CD pipeline** (e.g. GitHub Actions) | No CI exists yet; useful once there's code and tests to protect. | After first meaningful code + tests land. | `.github/workflows/*.yml`. | N/A |
| **Error tracking / observability** (e.g. Sentry) | §20 mentions structured logs, metrics, error tracking, provider-health dashboards. | Once there's a deployed environment. | SDK + DSN in env. | Yes, can defer past MVP. |
| **Restaurant/activity data source** | §11, §12 — richer than what maps/places alone provide. | Phase 2. | Adapter + API key, subject to licensing per §22. | Yes, mock initially. |
| **Payments/merchant integration** | Only needed if a transaction-fee or checkout model (§24.1) is pursued rather than pure affiliate redirect. | Only if/when that monetization path is chosen. | Payment provider (e.g. Stripe) keys in env. | N/A until the business-model decision below is made. |

## Not applicable (given current spec/stage)

| Item | Why it's not applicable now |
|---|---|
| Mobile app store accounts (iOS/Android) | Spec targets a PWA (§20, §29 Phase 3 "Advanced PWA/mobile experience"); no native app is in scope yet. |
| Booking/checkout merchant-of-record setup | §24.1 explicitly notes this requires contract/legal review and is not needed for an MVP that only ranks and links out. |
| Authorized/autonomous booking integrations | Phase 4 feature (§25, §31.14 "Authorized Booking Mode") — explicitly the last stage, gated on legal/payment authorization. |
| Community layer infrastructure (moderation, UGC storage) | §31.12 is explicitly P3/"later-stage," after sufficient user scale. |
| B2B/white-label infrastructure | §24.5, §31 — explicitly future/optional. |
| Multi-region/scale infrastructure (load balancing, sharding, CDN tuning) | Nothing in the spec calls for this before the core loop (§25 Phase 1) is proven; premature at this stage. |

## Needs your decision

Architectural/business choices the spec deliberately leaves open (§20, §24) that determine what gets installed/configured next. None of these were guessed — they're presented as open in the source doc itself.

1. **Package manager**: npm (already on this machine), pnpm, or yarn?
2. **Backend shape**: Next.js API routes only (simplest, matches "initially" in §20), or a separate FastAPI/Node service from day one?
3. **Database hosting for local dev**: native local Postgres install, Docker Compose, or a managed free-tier (Neon/Supabase/RDS)? (Docker isn't currently installed on this machine — relevant if you want that route.)
4. **Redis hosting for local dev**: local install, Docker, or managed (Upstash/Redis Cloud)?
5. **LLM provider**: which model/vendor for the AI responsibilities in §23 (this affects the env var name and SDK dependency)?
6. **First flight and hotel data providers**: which specific APIs/partners to integrate for Phase 1 (§22 lists categories, not named vendors — the spec deliberately avoids picking one)?
7. **Monetization model for MVP**: 0% affiliate-only, subscription-only, or a service-fee/hybrid model (§24)? This affects whether payment/merchant setup is "required" or "not applicable" for MVP.
8. **Notification channel priority**: build Web Push first, email first, or both together (§18)?
9. **Deployment target**: Vercel (natural fit for Next.js), another host, or self-managed? Affects how env vars/secrets are supplied in production.
10. **Repo hosting**: no git remote is currently configured — push to GitHub (and if so, which account/org), GitLab, or keep local-only for now?
11. **Test runner choice**: Vitest, Jest, or another framework?
12. **CI provider**: GitHub Actions (requires the remote decision above) or something else, or skip CI until later?

---

## Audit summary

The repository currently contains nothing but the product specification and an empty git history beyond that one commit — there is no code, config, dependency manifest, test setup, CI, environment file, or Claude Code project configuration to build on. Node, npm, Python, and Git are already available locally; Docker, a Postgres client, a Redis client, and the GitHub CLI are not installed. No secrets, credentials, or remote repository are configured. Bootstrapping the Phase 1 MVP (§25) requires, at minimum: a package-manager and framework scaffold (Next.js/TypeScript per §20), a Postgres database, an LLM API key, and at least one flight and one hotel data source — all of which can start behind placeholders/mocks per the product's own provider-abstraction principle (§4, §20). Redis/BullMQ, weather/maps/transfer providers, notifications, CI, and monetization infrastructure can follow once that core loop exists.

**Decisions that genuinely need your input before implementation starts:** package manager, backend architecture (Next.js-only vs. separate service), local Postgres/Redis hosting approach, LLM vendor, first flight/hotel provider choices, MVP monetization model, notification channel order, deployment target, git remote/repo hosting, test runner, and CI provider. Everything else in this checklist can proceed with reasonable placeholders once you're ready to start building.
