# What I need from you

Everything here is something I can't create myself (accounts, keys, DNS). **The code works without
all of it** and I keep building; each item switches a feature from "degraded, honestly labelled" to
"live" the moment you paste the value into `.env` (local) or your host's environment (production).
Nothing is ever hardcoded. Never paste a key into chat or commit it.

Rule I followed: **free tier first.** Every service below has a free plan that is enough to launch.

## How to hand me a key

1. Create the account (link below).
2. Copy the key into `.env` under the exact variable name shown.
3. Tell me "added X" (or just run the app: `/api/health` and `/status` report which slots are live).

## Needed — in priority order

| #   | What                                                  | Free?                                                    | Variable(s)                                         | What it unlocks                                    |
| --- | ----------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------- |
| 1   | Travelpayouts / Aviasales token + partner ID          | Yes (you already have these)                             | `AVIASALES_API_TOKEN`, `AVIASALES_PARTNER_ID`       | Real flights, price calendar, affiliate links      |
| 2   | **Resend** account + verified domain `voyagrfind.com` | Yes: 3,000 emails/month, 100/day                         | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`           | Welcome/verification, password reset, email change |
| 3   | DNS records for email (see below)                     | Free (your registrar)                                    | — (DNS only)                                        | Emails land in the inbox instead of spam           |
| 4   | **Redis** (Upstash free or your host's)               | Yes: Upstash free tier                                   | `REDIS_URL`, `QUEUE_DRIVER=bullmq`                  | Shared cache + background refresh worker           |
| 5   | **Postgres** (Neon or Supabase free)                  | Yes: free tiers                                          | `DATABASE_URL`                                      | Accounts, watches and alert prefs that persist     |
| 6   | Web Push VAPID keys                                   | Free, self-generated: `npx web-push generate-vapid-keys` | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Browser push alerts                                |
| 7   | A priced hotel feed (optional, see note)              | Free to start — **verify at signup**, terms change       | `STAY_PROVIDERS=...`, key name given by the adapter | Real nightly prices, so trip totals can be all-in  |
| 8   | Higgsfield connection                                 | You said unlimited plan                                  | — (MCP login)                                       | Generated destination imagery and hero video       |
| 9   | Deployment host env (Railway/Render/Vercel + worker)  | Free tiers exist; the worker needs an always-on process  | all of the above                                    | Production                                         |

### Note on hotels (important)

Travelpayouts **closed Hotellook and its hotel API on 20 Oct 2025**. There is no free hotel price
API inside Travelpayouts any more. What I'm building:

- **Now, free:** hotel links through Travelpayouts' remaining hotel programs (e.g. Booking.com,
  Agoda), carrying your partner ID. They earn commission but carry **no price**, so the stay shows
  as "not included" in the total and the site never says "all in" unless it is true.
- **For real prices, free to start (pick one, I'll wire it):**
  - **LiteAPI** (hotel rates API, free sandbox, commission model) — recommended; check signup terms.
  - **Amadeus Self-Service** (free test tier) — check current availability; the self-service
    programme has been changing.
  - **Booking.com Demand API** — free but needs approval; slowest.
    Tell me which account you get and paste the key; the adapter slot is ready.

### Note on weather

Open-Meteo needs **no key** and is free for non-commercial use. If Voyagr earns money (affiliate
commission counts), their terms ask for a commercial plan — a few euros a month. I'd budget for
it before launch. The code does not read an Open-Meteo key yet; that needs a small change when you get one.

### Note on Higgsfield

In this session the Higgsfield MCP server was **not connected** (only a login stub was
available). Please run `/mcp` in Claude Code and authenticate "higgsfield", then I can generate
imagery in Phase 6. If it stays unavailable I keep the existing Wikimedia photos and the
current imagery pipeline, and no destination ships without an image.

## DNS records for `voyagrfind.com` (email)

Resend shows the **exact** values after you add the domain (`resend.com/domains`) — paste those.
The shape is always:

| Type | Host                | Value                                                                           |
| ---- | ------------------- | ------------------------------------------------------------------------------- |
| TXT  | `send`              | `v=spf1 include:amazonses.com ~all` (Resend shows the exact SPF for its sender) |
| MX   | `send`              | `feedback-smtp.<region>.amazonses.com`, priority 10 (copy from Resend)          |
| TXT  | `resend._domainkey` | the long `p=MIGf...` DKIM public key Resend gives you                           |
| TXT  | `_dmarc`            | `v=DMARC1; p=none; rua=mailto:dmarc@voyagrfind.com; pct=100` (tighten later)    |

Start `_dmarc` at `p=none`, watch reports for two weeks, then move to `p=quarantine`.

## Decisions I made so you don't have to

Recorded with reasons in `docs/finish-plan.md`. If you disagree with any, tell me — otherwise
nothing is needed from you.

## Things only you can do

- Own the domain and DNS (above).
- Choose the hotel feed (above) and accept its terms.
- Approve the production host spend, if any.
- Legal pages (`/privacy`, `/terms`) review before launch: I draft, I'm not your lawyer.

## Update 2026-11-14: partners, and three things to decide

### Affiliate programs worth checking (one per need, free to join)

From what I know of these programs, not verified against today's terms. Most are inside
Travelpayouts, so commission is paid to you there; the Travelpayouts agent is checking which ones
your account can actually join. Tick or strike each:

| Need                 | First pick                      | Alternative                  | Note                                                   |
| -------------------- | ------------------------------- | ---------------------------- | ------------------------------------------------------ |
| Hotels               | Booking.com (via Travelpayouts) | Trip.com, Hotels.com         | Links only; no price feed without a separate hotel API |
| Hotel prices (API)   | LiteAPI                         | Booking.com Demand API       | The only route to a real "flight + stay" total         |
| Car rental           | DiscoverCars                    | Localrent, EconomyBookings   |                                                        |
| Transfers / taxis    | Intui (you have it)             | Kiwitaxi, GetTransfer        |                                                        |
| Tours and activities | GetYourGuide                    | Viator, Tiqets, Klook        | Also a source for the "things to do" list              |
| eSIM                 | Yesim, GigSky (you have both)   | Airalo                       |                                                        |
| Travel insurance     | EKTA                            | VisitorsCoverage, SafetyWing | Check which countries each one sells to                |
| Flight compensation  | AirHelp (you have it)           | Compensair                   |                                                        |
| Trains and buses     | 12Go                            | Omio, Rail Europe            |                                                        |
| Luggage storage      | Radical Storage                 | Bounce                       |                                                        |
| Events (dated)       | Ticketmaster Discovery API      |                              | Free key; feeds the events group in "things to do"     |

### Decide

1. **Cookie consent.** The Travelpayouts Drive script and affiliate links set tracking cookies.
   For EU visitors that needs a consent banner before the script loads. I recommend I build one
   (Drive loads only after "accept"); say if you would rather load it unconditionally.
2. **Deploy.** Drive's "Verify installation" only passes after the next deploy of this branch.
3. **Postal address for emails** (`EMAIL_POSTAL_ADDRESS`): optional now that email is
   transactional only.

### No longer needed

`UNSUBSCRIBE_SECRET` and the weekly digest: dropped, since email is now only for password reset
and welcome/verification.
