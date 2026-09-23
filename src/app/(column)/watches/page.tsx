import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui';
import { WatchList } from '@/components/watches/watch-list';
import {
  addWatchAction,
  archiveWatchAction,
  checkWatchNowAction,
  deleteWatchAction,
  pauseWatchAction,
  resumeWatchAction,
} from '@/app/actions/watches';
import { AddWatchForm } from '@/components/watches/add-watch-form';
import { getCurrentUser } from '@/auth/current-user';
import { getCapabilities } from '@/lib/env';
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

  // An in-process queue in the web server is not reachable by a worker, so a
  // watch would sit at its deadline forever. Only a shared queue means the
  // scheduling shown here corresponds to anything.
  const workerCanRun = getCapabilities().bullmq;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display-md text-ink">Your watches</h1>
        <p className="text-ink-muted mt-3 max-w-2xl">
          {active} of {user.entitlements.maxActiveWatches} watches active on your{' '}
          {user.entitlements.planName} plan. Pause one to make room for another.
        </p>
        {/*
          The two ways a watch begins, and what happens after, in one line.
        */}
        <p className="text-ink-muted mt-2 max-w-2xl text-sm">
          Save any search to watch it automatically, or add one by hand below. A watch checks itself
          every {user.entitlements.minRefreshIntervalHours} hours at most; use Check now to look
          straight away.
        </p>
      </div>

      {/*
        Whether anything is actually running them is a deployment fact, not a
        code fact: the worker is a separate process. Saying "we are checking" on
        a page whose worker nobody started would be describing work nobody is
        doing, so the claim is tied to the queue being a shared one.
      */}
      {workerCanRun ? null : (
        <Card as="section" aria-labelledby="not-running-heading">
          <h2 id="not-running-heading" className="text-ink text-sm font-semibold">
            Background checking is not switched on here
          </h2>
          <p className="text-ink-muted mt-1 text-sm">
            Your watches are saved and scheduled, but this deployment has no shared job queue, so
            nothing is running them. Use Check now on a watch to look straight away.
          </p>
        </Card>
      )}

      <AddWatchForm action={addWatchAction} today={new Date().toISOString().slice(0, 10)} />

      {rows.length === 0 ? (
        <Card>
          <p className="text-ink text-sm">
            No watches yet.{' '}
            <Link href="/explore" className="text-tint-ink underline underline-offset-4">
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
          deleteAction={deleteWatchAction}
          checkAction={checkWatchNowAction}
        />
      )}
    </div>
  );
}
