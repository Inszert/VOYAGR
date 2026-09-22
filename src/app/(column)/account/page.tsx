import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Badge, Button, Card } from '@/components/ui';
import { PushToggle } from '@/components/notifications/push-toggle';
import { PasswordForm } from '@/components/auth/password-form';
import { PreferencesForm } from '@/components/auth/preferences-form';
import { savePreferencesAction } from '@/app/actions/preferences';
import { changePasswordAction, signOutAction } from '@/app/actions/auth';
import { getCurrentUser } from '@/auth/current-user';
import { readExplicitPreferences, readInferredPreferences } from '@/auth/preferences';
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

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const stored = await getRepositories().preferences.find(user.id);
  const explicit = readExplicitPreferences(stored);
  const inferred = readInferredPreferences(stored);

  const { entitlements } = user;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-ink text-2xl font-semibold tracking-tight">Your account</h1>
          <p className="text-ink-muted mt-2">{user.email}</p>
        </div>

        <form action={signOutAction}>
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      </div>

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

      <PreferencesForm preferences={explicit} action={savePreferencesAction} />

      {/*
        The public key only. The private one never leaves the server, which is
        the entire point of the pair.
      */}
      <PushToggle vapidPublicKey={getEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />

      <PasswordForm action={changePasswordAction} />

      <Card as="section" aria-labelledby="inferred-heading">
        <h2 id="inferred-heading" className="text-ink text-xl font-semibold">
          What we have worked out
        </h2>
        <p className="text-ink-muted mt-1 text-sm">
          Anything the system concluded from how you use it, kept separate from what you told us
          directly. You can always see it, and what you set yourself always wins.
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
  );
}
