import type { Metadata } from 'next';
import { LegalPage, type LegalSection } from '@/components/legal/legal-page';

/**
 * The privacy notice.
 *
 * Every claim here is one the code makes true, and the comment beside each
 * section says where. When the behaviour changes, this page changes with it -
 * a notice that describes last year's software is a notice that is wrong.
 */

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What Voyagr stores about you, why, who else sees it, and how to remove it.',
};

const sections: readonly LegalSection[] = [
  {
    id: 'without-an-account',
    title: 'Searching without an account',
    // No analytics and no advertising of our own. The one partner script loads
    // only after consent (`src/consent/`, `affiliate-drive.tsx`). Fonts are
    // self-hosted and photographs proxied.
    body: (
      <>
        <p>
          You can search, browse the globe and compare stays without signing up. A search is a web
          address: the airports, dates, budget and preferences you chose are in the URL, and the
          server uses them to run the search. It does not keep them afterwards unless you save the
          search to an account.
        </p>
        <p>
          There are no analytics or advertising scripts of our own on Voyagr. The one partner script
          (Travelpayouts, described under <a href="#cookies">Cookies and storage on your device</a>)
          is loaded only if you accept it, and the only cookie set for a visitor who is not signed
          in is the one that remembers that choice. Fonts are served from our own address, and
          destination photographs are fetched by our server and passed on, so until you accept, your
          browser only talks to Voyagr itself while you use the site.
        </p>
      </>
    ),
  },
  {
    id: 'account',
    title: 'What an account stores',
    // `users`, `user_credentials`, `user_preferences`, `trip_searches`,
    // `travel_watches`, `price_history`, `notifications`, `sessions`.
    body: (
      <>
        <p>When you create an account, Voyagr stores:</p>
        <ul>
          <li>
            <strong>Your email address</strong>, to sign you in and to identify the account.
          </li>
          <li>
            <strong>Your password, hashed</strong> with scrypt. The password itself is never stored
            and cannot be read back.
          </li>
          <li>
            <strong>Your travel preferences</strong>: the defaults you set on your account page.
          </li>
          <li>
            <strong>Saved searches and travel watches</strong>, and the prices a watch has observed
            for them over time, so it can tell you when a better trip appears.
          </li>
          <li>
            <strong>Notifications</strong> generated for your watches, and whether you have read
            them.
          </li>
          <li>
            <strong>Sign-in sessions</strong>: a record per signed-in browser that holds a hash of
            its session token and when it expires.
          </li>
          <li>
            <strong>Whether your email address has been confirmed</strong>, and, while a
            confirmation, password reset or email change link is outstanding, a hash of it, when it
            expires and - for an email change only - the new address it points to, so it can be
            moved once you click it. Never the link itself.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies and storage on your device',
    // `CONSENT_COOKIE` in `src/consent/cookie.ts`; `SESSION_COOKIE_NAME` in
    // `src/auth/session.ts`; `DATA_SOURCE_COOKIE` in `src/providers/data-source.ts`;
    // the script in `src/components/shell/affiliate-drive.tsx`; `public/sw.js`.
    body: (
      <>
        <p>These are all of the cookies Voyagr sets:</p>
        <ul>
          <li>
            <strong>voyagr-consent</strong> remembers whether you accepted or declined the partner
            script below. Its value is the single word <em>accepted</em> or <em>declined</em>: no
            identifier and no personal data. It lasts 12 months, is sent only to Voyagr, and is set
            when you press Accept or Decline. You can change your choice at any time with
            &ldquo;Cookie settings&rdquo; in the footer.
          </li>
          <li>
            <strong>voyagr_session</strong> is set when you sign in, and keeps you signed in for up
            to 30 days. It cannot be read by scripts on the page and is not sent to other sites.
            Signing out removes it. It is needed for the sign-in you asked for, so it is set without
            asking.
          </li>
          <li>
            <strong>voyagr-data-source</strong> is set only on deployments where the developer
            switch between live and sample data is turned on, and only when you use that switch. It
            records which one you chose, lasts until you close the browser, and is not set for
            ordinary visitors.
          </li>
        </ul>
        <p>
          <strong>The partner script.</strong> If you accept, Voyagr loads one script from
          Travelpayouts, the affiliate network we are paid through, from the address emrldco.com. It
          is there to tell Travelpayouts that a booking you made on a partner&rsquo;s site came
          through a link on Voyagr, so that the commission is credited. It may set its own cookies
          on Travelpayouts&rsquo; domain and will see your address, browser details and the page you
          are on. Voyagr gives it no name, email address or account information, and builds no
          advertising profile from it. If you decline, or have not chosen, it is not loaded and your
          browser makes no request to Travelpayouts&rsquo; script address. If you later withdraw
          your acceptance, the script stops loading, but cookies it already placed on its own domain
          are Travelpayouts&rsquo; to remove: clear them in your browser, and see their privacy
          notice for how they are used.
        </p>
        <p>
          <strong>Partner links do not need your consent.</strong> A plain link to a partner such as{' '}
          <em>tpk.lv</em> or <em>tp.media</em> is an ordinary link: following it loads that
          partner&rsquo;s website in a new tab, and nothing is sent to it from Voyagr&rsquo;s pages
          before you click. What the partner then does is covered by its own notice.
        </p>
        <p>
          Voyagr also installs a service worker, which keeps copies of pages, map data and
          photographs you have already seen on your device so the site still works offline. Clearing
          this site&rsquo;s data in your browser removes them.
        </p>
      </>
    ),
  },
  {
    id: 'notifications',
    title: 'Push notifications',
    // `push_subscriptions`; delivery through the browser's push service.
    body: (
      <p>
        If you turn on notifications, your browser gives Voyagr an address at its own push service
        (run by the browser&rsquo;s maker) and a key for encrypting messages to it. Voyagr stores
        both against your account and uses them only to send notifications about your watches.
        Turning notifications off, or deleting your account, removes them.
      </p>
    ),
  },
  {
    id: 'third-parties',
    title: 'Who else is involved',
    // `src/providers/flights/duffel.ts` and `aviasales.ts` (route, dates,
    // currency only - Aviasales not even passenger count);
    // `src/providers/weather/open-meteo.ts` (coordinates and dates only);
    // `src/app/api/imagery/[code]/route.ts`; `src/booking/partners.ts` (plain
    // links with no parameter about the visitor).
    body: (
      <>
        <ul>
          <li>
            <strong>Flight data providers.</strong> When live flight data is switched on, a search
            sends the airports, dates and currency to the flight provider this service is configured
            with. It sends no name, email address or other detail about you.
          </li>
          <li>
            <strong>Weather data.</strong> When live weather data is switched on, a search sends a
            destination&rsquo;s coordinates and the dates asked about to Open-Meteo, a weather
            service. Nothing about you accompanies that request.
          </li>
          <li>
            <strong>Wikimedia.</strong> Destination photographs come from Wikimedia Commons. Our
            server fetches them, so Wikimedia sees our server&rsquo;s request, not yours.
          </li>
          <li>
            <strong>Your browser&rsquo;s push service</strong>, if you turn on notifications, as
            described above.
          </li>
        </ul>
        <p>
          Hotel and transfer prices come from no outside provider at this stage, so nothing about
          you is sent anywhere for them. Voyagr does not sell personal data or share it for
          advertising.
        </p>
        <p>
          Some links on Voyagr, such as airport transfers, travel eSIMs and flight compensation, are
          partner links. If you book through one, Voyagr may earn a commission, at no cost to you.
          Following a partner link opens that partner&rsquo;s own website in a new tab; Voyagr does
          not pass your name, email address or account to it, and what the partner collects is
          described in its own privacy notice.
        </p>
      </>
    ),
  },
  {
    id: 'your-rights',
    title: 'Seeing, taking and deleting your data',
    // `/api/account/export`; `deleteAccountAction` -> `users.erase`, which
    // cascades to every table above; `src/worker/maintenance.ts` for the
    // retention periods.
    body: (
      <>
        <p>
          From your account page you can download everything Voyagr holds about you as a single
          file, and you can delete your account. Deleting it removes your email address, password
          hash, preferences, saved searches, watches, their price history, notifications, push
          subscriptions, sessions and any outstanding email confirmation, password reset or email
          change link at once. The only record kept is a count of what was removed, with nothing
          that identifies you.
        </p>
        <p>
          You do not have to delete your account for old data to go. A watch&rsquo;s price history
          is kept for 90 days - long enough to cover a full booking season and answer &ldquo;is this
          actually cheap?&rdquo; - except the single cheapest observation ever seen, which is kept
          regardless so a watch&rsquo;s best-known price can never quietly rise because its evidence
          aged out. A session you have not used in 30 days stops working and is removed
          automatically.
        </p>
        <p>
          Server logs record what the service did, such as that a search ran or a provider timed
          out, and may include your account&rsquo;s internal ID but not your email address.
          Passwords, session tokens and keys are removed before anything is written, and how long
          logs are kept depends on where this service is hosted.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this notice',
    body: (
      <p>
        When Voyagr starts storing or sharing something new, this page changes first, and the date
        at the top says when it last did.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="2026-11-15"
      summary={
        <p>
          Voyagr works without an account and, unless you accept one partner script, without
          third-party tracking. If you make an account, it keeps what it needs to watch prices for
          you, tells you exactly what that is below, and removes all of it when you ask.
        </p>
      }
      sections={sections}
    />
  );
}
