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
    // No analytics, no advertising, no tracking cookies: none is loaded
    // anywhere in `src/`. Fonts are self-hosted and photographs proxied.
    body: (
      <>
        <p>
          You can search, browse the globe and compare stays without signing up. A search is a web
          address: the airports, dates, budget and preferences you chose are in the URL, and the
          server uses them to run the search. It does not keep them afterwards unless you save the
          search to an account.
        </p>
        <p>
          There are no analytics, advertising or tracking scripts on Voyagr, and no cookie is set
          for a visitor who is not signed in. Fonts are served from our own address, and destination
          photographs are fetched by our server and passed on, so your browser only talks to Voyagr
          itself while you use the site.
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
        </ul>
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies and storage on your device',
    // `SESSION_COOKIE_NAME` in `src/auth/session.ts`; `DATA_SOURCE_COOKIE` in
    // `src/providers/data-source.ts`; `public/sw.js`.
    body: (
      <>
        <ul>
          <li>
            <strong>voyagr_session</strong> is set when you sign in, and keeps you signed in for up
            to 30 days. It cannot be read by scripts on the page and is not sent to other sites.
            Signing out removes it.
          </li>
          <li>
            <strong>voyagr-data-source</strong> is set only on deployments where the developer
            switch between live and sample data is turned on, and only when you use that switch. It
            records which one you chose.
          </li>
        </ul>
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
    // `src/providers/flights/duffel.ts` (passenger count only);
    // `src/app/api/imagery/[code]/route.ts`.
    body: (
      <>
        <ul>
          <li>
            <strong>Flight data providers.</strong> When live flight data is switched on, a search
            sends the airports, dates and number of passengers to the flight provider this service
            is configured with (Duffel, at the time of writing) to get prices. It sends no name,
            email address or other detail about you.
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
          Hotel, transfer and weather figures are sample data at this stage and involve no outside
          provider. Voyagr does not sell personal data or share it for advertising.
        </p>
      </>
    ),
  },
  {
    id: 'your-rights',
    title: 'Seeing, taking and deleting your data',
    // `/api/account/export`; `deleteAccountAction` -> `users.erase`, which
    // cascades to every table above.
    body: (
      <>
        <p>
          From your account page you can download everything Voyagr holds about you as a single
          file, and you can delete your account. Deleting it removes your email address, password
          hash, preferences, saved searches, watches, their price history, notifications, push
          subscriptions and sessions at once. The only record kept is a count of what was removed,
          with nothing that identifies you.
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
      updated="2026-09-23"
      summary={
        <p>
          Voyagr works without an account and without tracking. If you make an account, it keeps
          what it needs to watch prices for you, tells you exactly what that is below, and removes
          all of it when you ask.
        </p>
      }
      sections={sections}
    />
  );
}
