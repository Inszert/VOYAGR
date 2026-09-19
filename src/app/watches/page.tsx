import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui';
import { WatchList } from '@/components/watches/watch-list';
import { archiveWatchAction, pauseWatchAction, resumeWatchAction } from '@/app/actions/watches';
import { getCurrentUser } from '@/auth/current-user';
import { getRepositories } from '@/db';
import { WatchService } from '@/watches/service';

/**
 * Travel Watches.
 *
 * The page a user comes to in order to answer "is it still looking?". Every
 * active watch says when it will next check, because a watch that cannot say
 * that is indistinguishable from one that quietly stopped.
 *
 * Nothing runs the watches yet. The scheduler and the workers are 1.6, so a
 * watch here will sit at "due now" until then, and the page says so rather than
 * implying work is happening that is not.
 */

export const metadata: Metadata = { title: 'Your watches' };

export default async function WatchesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const service = new WatchService({ repositories: getRepositories() });
  const rows = await service.listForUser(user.id);

  const active = rows.filter((row) => row.watch.status === 'active').length;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-ink text-2xl font-semibold tracking-tight">Your watches</h1>
        <p className="text-ink-muted mt-2 max-w-2xl">
          {active} of {user.entitlements.maxActiveWatches} watches active on your{' '}
          {user.entitlements.planName} plan. Pause one to make room for another.
        </p>
      </div>

      {/*
        Said plainly rather than implied. Until 1.6 there is no scheduler, so a
        watch sits at its deadline without anything picking it up, and a page
        that showed a countdown would be describing work nobody is doing.
      */}
      <Card as="section" aria-labelledby="not-running-heading">
        <h2 id="not-running-heading" className="text-ink text-sm font-semibold">
          Background checking is not switched on yet
        </h2>
        <p className="text-ink-muted mt-1 text-sm">
          Your watches are saved and scheduled, but nothing is running them in the background yet.
          Use “Run this search now” to check a trip in the meantime.
        </p>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <p className="text-ink text-sm">
            No watches yet.{' '}
            <Link href="/" className="text-brand-ink underline underline-offset-4">
              Run a search
            </Link>{' '}
            and save it to have us keep looking.
          </p>
        </Card>
      ) : (
        <WatchList
          rows={rows}
          pauseAction={pauseWatchAction}
          resumeAction={resumeWatchAction}
          archiveAction={archiveWatchAction}
        />
      )}
    </div>
  );
}
