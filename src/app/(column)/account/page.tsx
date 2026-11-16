import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Badge, Button, Card, PageHeader } from '@/components/ui';
import { PushToggle } from '@/components/notifications/push-toggle';
import { PasswordForm } from '@/components/auth/password-form';
import { PreferencesForm } from '@/components/auth/preferences-form';
import { AlertPreferencesForm } from '@/components/auth/alert-preferences-form';
import { saveAlertPreferencesAction } from '@/app/actions/alert-preferences';
import { savePreferencesAction } from '@/app/actions/preferences';
import {
  changePasswordAction,
  deleteAccountAction,
  requestEmailChangeAction,
  resendVerificationAction,
  signOutAction,
  signOutEverywhereAction,
} from '@/app/actions/auth';
import { DeleteAccountForm } from '@/components/auth/delete-account-form';
import { EmailChangeForm } from '@/components/auth/email-change-form';
import { ResendVerificationForm } from '@/components/auth/resend-verification-form';
import { getCurrentUser } from '@/auth/current-user';
import { readExplicitPreferences, readInferredPreferences } from '@/auth/preferences';
import { minorUnitExponent, toMajor } from '@/core/money';
import { getEnv } from '@/lib/env';
import { getRepositories } from '@/db';

/**
 * Account page.
 *
 * Three jobs, and the third is the one the specification actually insists on:
 * show who you are, let you set what you like, and show what the system has
 * inferred about you. Section 31.7 requires that last one to be answerable,
 * which is why explicit and inferred preferences are separate fields in the
 * schema rather than one blob nobody can untangle.
 *
 * Entitlements are displayed by resolving them from the plan, never by writing
 * the numbers into the page. That is the same rule the rest of the code follows
 * and the reason a paid tier later is a new row rather than a hunt for
 * hard-coded limits.
 */

export const metadata: Metadata = { title: 'Your account' };

const SECTIONS = [
  { id: 'plan', label: 'Your plan' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'security', label: 'Email and password' },
  { id: 'inferred', label: 'What we have worked out' },
  { id: 'data', label: 'Your data' },
] as const;

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const stored = await getRepositories().preferences.find(user.id);
  const explicit = readExplicitPreferences(stored);
  const inferred = readInferredPreferences(stored);

  const alerts = await getRepositories().alertPreferences.find(user.id);

  const { entitlements } = user;
  const params = await searchParams;
  const verified = params.verified;
  const emailChanged = params.emailChanged;
  const emailChangeFailed = emailChanged === 'invalid' || emailChanged === 'missing-token';
  // Set by sign-up when the account was made and its verification email was not sent.
  const verificationUnsent = params.verification === 'unsent' && !user.emailVerified;

  return (
    <div className="flex flex-col gap-10 lg:gap-12">
      <PageHeader
        eyebrow="Account"
        title="Your account"
        description={user.email}
        actions={
          <form action={signOutAction}>
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
        }
      />

      {/* What the page has to say about the address itself, in live regions. */}
      {user.emailVerified && !verified && !emailChangeFailed ? null : (
        <div className="flex max-w-[60ch] flex-col gap-2">
          {verificationUnsent ? (
            <p role="status" className="text-caution-ink text-sm">
              Account created. We could not send the verification email yet — you can resend it from
              your account page.
            </p>
          ) : null}
          {user.emailVerified ? null : (
            <div className="flex flex-col gap-2">
              <p className="text-caution-ink text-sm">This address has not been confirmed yet.</p>
              <ResendVerificationForm action={resendVerificationAction} />
            </div>
          )}
          {verified === '1' ? (
            <p role="status" className="text-positive-ink text-sm">
              Email confirmed.
            </p>
          ) : null}
          {verified === 'invalid' ? (
            <p role="alert" className="text-critical-ink text-sm">
              That verification link was not valid or has expired. Use the button below to get a new
              one.
            </p>
          ) : null}
          {emailChangeFailed ? (
            <p role="alert" className="text-critical-ink text-sm">
              That email change link was not valid or has expired. Request a new one below.
            </p>
          ) : null}
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-24 flex flex-col gap-1 text-sm">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="text-ink-muted hover:text-ink ease-standard duration-quick -mx-2 block rounded-(--radius-control) px-2 py-2 transition-colors"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex max-w-2xl min-w-0 flex-col gap-8">
          <div id="plan" className="scroll-mt-24">
            <Card as="section" aria-labelledby="plan-heading">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="plan-heading" className="text-ink text-xl font-semibold">
                  Your plan
                </h2>
                <Badge tone="brand" srPrefix="Plan">
                  {entitlements.planName}
                </Badge>
              </div>

              <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Trips you can watch at once</dt>
                  <dd className="text-ink tabular-nums">{entitlements.maxActiveWatches}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Saved searches</dt>
                  <dd className="text-ink tabular-nums">{entitlements.maxSavedSearches}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Checked no more often than</dt>
                  <dd className="text-ink tabular-nums">
                    every {entitlements.minRefreshIntervalHours} hours
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Destinations per search</dt>
                  <dd className="text-ink tabular-nums">{entitlements.maxDestinationsPerSearch}</dd>
                </div>
              </dl>
            </Card>
          </div>

          <div id="preferences" className="scroll-mt-24">
            <PreferencesForm preferences={explicit} action={savePreferencesAction} />
          </div>

          <div id="alerts" className="flex scroll-mt-24 flex-col gap-8">
            {/*
        The public key only. The private one never leaves the server, which is
        the entire point of the pair.
      */}
            <PushToggle vapidPublicKey={getEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />

            <AlertPreferencesForm
              action={saveAlertPreferencesAction}
              values={{
                homeAirport: alerts?.homeAirport ?? explicit.homeAirports?.[0] ?? '',
                destinations: alerts?.destinations.join(', ') ?? '',
                // Display only: the stored figure is integer minor units.
                budget: alerts?.budget
                  ? toMajor(alerts.budget).toFixed(minorUnitExponent(alerts.budget.currency))
                  : '',
                currency: alerts?.budget?.currency ?? explicit.currency ?? 'EUR',
                earliestDeparture: alerts?.earliestDeparture ?? '',
                latestDeparture: alerts?.latestDeparture ?? '',
                // No row means every alert, as it did before the settings existed.
                priceDropAlerts: alerts?.priceDropAlerts ?? true,
              }}
            />
          </div>

          <div id="security" className="flex scroll-mt-24 flex-col gap-8">
            <EmailChangeForm action={requestEmailChangeAction} />

            <PasswordForm action={changePasswordAction} />
          </div>

          <div id="inferred" className="scroll-mt-24">
            <Card as="section" aria-labelledby="inferred-heading">
              <h2 id="inferred-heading" className="text-ink text-xl font-semibold">
                What we have worked out
              </h2>
              <p className="text-ink-muted mt-1 text-sm">
                Anything the system concluded from how you use it, kept separate from what you told
                us directly. You can always see it, and what you set yourself always wins.
              </p>

              {inferred.length === 0 ? (
                <p className="text-ink mt-4 text-sm">
                  Nothing yet. We have not drawn any conclusions about how you like to travel.
                </p>
              ) : (
                <dl className="mt-4 flex flex-col gap-2 text-sm">
                  {inferred.map((entry) => (
                    <div key={entry.key} className="flex justify-between gap-4">
                      <dt className="text-ink-muted">{entry.key}</dt>
                      <dd className="text-ink">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Card>
          </div>

          <div id="data" className="scroll-mt-24">
            {/*
        Your data, in and out.

        The export route and the erasure action both existed and nothing on
        the page reached either, which made the promise in the privacy notice
        one the product could not keep. The download is a plain link to the
        route, so it works without JavaScript and the browser saves the file.
      */}
            <Card as="section" aria-labelledby="data-heading">
              <h2 id="data-heading" className="text-ink text-xl font-semibold">
                Your data
              </h2>
              <p className="text-ink-muted mt-1 text-sm">
                Everything Voyagr holds about you, as one file. What it contains is described in the{' '}
                <a href="/privacy" className="text-accent-ink underline underline-offset-4">
                  privacy notice
                </a>
                .
              </p>
              <div className="mt-4">
                <Button asChild variant="secondary">
                  <a href="/api/account/export" download>
                    Download my data
                  </a>
                </Button>
              </div>

              <div className="border-border mt-6 border-t pt-6">
                <h3 className="text-ink text-base font-semibold">Sessions</h3>
                <p className="text-ink-muted mt-2 text-sm">
                  If you think another device might be signed in to your account, end every session
                  at once - this one included, so you will need to sign in again here too.
                </p>
                <form action={signOutEverywhereAction} className="mt-3">
                  <Button type="submit" variant="secondary">
                    End every session
                  </Button>
                </form>
              </div>

              <div className="border-border mt-6 border-t pt-6">
                <h3 className="text-critical-ink text-base font-semibold">Delete this account</h3>
                <div className="mt-2">
                  <DeleteAccountForm action={deleteAccountAction} email={user.email} />
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
