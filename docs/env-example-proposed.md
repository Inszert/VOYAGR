# Proposed `.env.example`

Reading and writing `.env.example` was denied by the permission settings in the session that wrote
this, so the content is here instead. To apply it, copy the block below over `.env.example`.
Placeholders only; every variable comes from `src/lib/env.ts`.

```dotenv
# Voyagr environment. Placeholders only: never commit a real value.
# Every variable is optional locally; the app runs on fixtures and in-memory storage with none set.
# `next dev` reads .env.local and .env. `npm run worker` and `npm run db:migrate` read .env only.

# --- Core ---------------------------------------------------------------------
# NODE_ENV is set by Next.js (development, production) and by the test runner.
NEXT_PUBLIC_APP_URL=http://localhost:3000
# Origin of the deployment, for sitemap.xml and robots.txt (no trailing slash needed).
PUBLIC_BASE_URL=
LOG_LEVEL=info

# --- Persistence --------------------------------------------------------------
# Unset means in-memory storage that is lost on restart. Required in production.
DATABASE_URL=
# true to use TLS to Postgres (usually needed on a managed host).
DATABASE_SSL=false
DATABASE_POOL_MAX=10

# --- Queue and cache ----------------------------------------------------------
# One Redis serves the shared cache and the BullMQ queue. Web and worker must share it.
REDIS_URL=
# memory or bullmq. bullmq needs REDIS_URL. Use bullmq in production.
QUEUE_DRIVER=memory
# How often the worker re-prices what the front pages show, in minutes (1 to 1440).
# This sets the background Aviasales spend: see "Quota maths" in docs/architecture.md.
PRICE_REFRESH_MINUTES=30
# How often the worker pre-warms things to do from Wikidata, in hours (1 to 720). 40 destinations a
# round, skipping any still fresh. Keep it long: the query service asks to be asked rarely.
PLACES_REFRESH_HOURS=168

# --- Flights ------------------------------------------------------------------
# mock | live | aviasales. Production refuses mock, and live has no adapter.
FLIGHT_PROVIDER=mock
# Travelpayouts Data API token. Secret. Required when FLIGHT_PROVIDER=aviasales.
AVIASALES_API_TOKEN=
# Travelpayouts affiliate marker. Public; appears in outbound links.
AVIASALES_PARTNER_ID=
# OPTIONAL, OFF BY DEFAULT. Google Flights through the unofficial scraper sidecar in
# services/google-flights/ - an owner-approved exception to docs/provider-policy.md (Google's terms
# do not permit automated access; it can be blocked at any time). Unset means it cannot be reached.
# Even when set, nothing uses it until the provider is selected (see docs/runbook.md, 5a).
GOOGLE_FLIGHTS_SIDECAR_URL=
# Shared secret the sidecar expects in X-Voyagr-Sidecar-Key (set it there as VOYAGR_SIDECAR_KEY).
# Secret. Never logged.
GOOGLE_FLIGHTS_SIDECAR_KEY=
# Days either side shown by the flexible-dates strip (0 to 7).
FLEX_DAYS=3

# --- Stays, hotels, transfers, places -----------------------------------------
# Comma list of: mock, absent, travelpayouts-links. Production defaults to absent.
# travelpayouts-links gives affiliate links with no price and needs the three ids
# (AVIASALES_PARTNER_ID above and the two below).
STAY_PROVIDERS=mock
TRAVELPAYOUTS_HOTEL_PROGRAM_ID=
TRAVELPAYOUTS_HOTEL_CAMPAIGN_ID=
# Priced hotels for trip totals. mock | live | absent. No live adapter exists.
# In production these default to absent, so a cost line is excluded rather than invented.
HOTEL_PROVIDER=mock
TRANSFER_PROVIDER=mock
# Things to do and their photographs. mock | live | absent | wikidata. wikidata is keyless (CC0) and
# is the production default; mock becomes absent in production.
PLACES_PROVIDER=mock

# --- Weather and currency -----------------------------------------------------
# open-meteo is keyless. mock is for tests. Defaults to open-meteo outside a test run.
WEATHER_PROVIDER=open-meteo
# ecb is keyless (daily ECB rates). mock means no rates, so foreign quotes are dropped.
FX_PROVIDER=ecb

# --- Imagery ------------------------------------------------------------------
# wikimedia (photo fallback when no shipped illustration exists) or none.
IMAGERY_PROVIDER=wikimedia

# --- Email (transactional only: verification, password reset, email change) ---
# console writes links to the log. Production refuses console and needs resend.
EMAIL_PROVIDER=console
# Resend API key. Secret. Required when EMAIL_PROVIDER=resend.
RESEND_API_KEY=
# Must be on a domain verified in Resend.
EMAIL_FROM=Voyagr <hello@voyagrfind.com>
EMAIL_REPLY_TO=
# Printed in every email footer. A visible placeholder shows if unset.
EMAIL_POSTAL_ADDRESS=

# --- Web Push -----------------------------------------------------------------
# Generate a pair with: npm run vapid:generate. Regenerating invalidates subscriptions.
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com

# --- AI -----------------------------------------------------------------------
# mock is the only working value. anthropic is rejected by validation until an adapter exists.
AI_PROVIDER=mock
AI_MODEL=claude-sonnet-5
ANTHROPIC_API_KEY=

# --- Switches that must stay off in a real deployment -------------------------
# Shows the runtime API/MOCK switch. Unset means on outside production, off in production.
# DATA_SOURCE_SWITCH=
# Lets a production build serve fixtures. For the end-to-end suite only.
# NEVER SET IN A REAL DEPLOYMENT. It also turns off the Travelpayouts Drive script.
# ALLOW_MOCK_IN_PRODUCTION=false
# TEST ONLY. Makes the consented Drive script load a same-origin stub (/api/test/drive-stub) instead of
# the vendor's host, so the end-to-end suite can prove the cookie-consent gating. Honoured only
# together with ALLOW_MOCK_IN_PRODUCTION; does nothing on a real deployment. NEVER SET THERE.
# DRIVE_TEST_STUB=false
```
