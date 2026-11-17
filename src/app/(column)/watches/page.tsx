import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button, Card, Icon, PageHeader } from '@/components/ui';
import { initials } from '@/components/discovery/initials';
import { countryNameFor } from '@/lib/destination-media';
import { placePictureForCode } from '@/lib/place-image';
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
 * The worker runs them on an adaptive schedule where a shared queue exists;
 * where none does, the page says so, and Check now runs one on demand.
 */

export const metadata: Metadata = {
  title: 'Your watches',
  description: 'Your trip watches, when each one next checks, and how to pause or remove one.',
};

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

  // The picture belongs to the first destination we have one for; a watch of
  // "anywhere" or of an unpictured airport gets the country's initials instead.
  const withPictures = rows.map((row) => {
    const codes = row.search.destinations;
    const picture =
      codes.map((code) => placePictureForCode(code)).find((candidate) => candidate !== null) ??
      null;
    const country = codes.length > 0 ? countryNameFor(codes[0]!) : null;

    return { ...row, picture, initials: initials(country ?? codes[0] ?? '') };
  });

  return (
    <div className="flex flex-col gap-10 lg:gap-12">
      <PageHeader
        eyebrow="Travel Watch"
        title="Your watches"
        description={`${active} of ${user.entitlements.maxActiveWatches} watches active on your ${user.entitlements.planName} plan. Pause one to make room for another.`}
        actions={
          <Button asChild variant="secondary">
            <Link href="/explore">
              <Icon name="search" size={1} />
              Search trips
            </Link>
          </Button>
        }
      />

      <p className="text-ink-muted -mt-4 max-w-[60ch] text-sm leading-relaxed lg:-mt-6">
        Save any search to watch it automatically, or add one by hand below. A watch checks itself
        more often as its trip gets closer, never more than once every{' '}
        {user.entitlements.minRefreshIntervalHours} hours on your plan; use Check now to look
        straight away.
      </p>

      {/*
        Whether anything is actually running them is a deployment fact, not a
        code fact: the worker is a separate process. Saying "we are checking" on
        a page whose worker nobody started would be describing work nobody is
        doing, so the claim is tied to the queue being a shared one.
      */}
      {workerCanRun ? null : (
        <Card as="section" aria-labelledby="not-running-heading" surface="sunken">
          <h2 id="not-running-heading" className="text-ink text-sm font-semibold">
            Background checking is not switched on here
          </h2>
          <p className="text-ink-muted mt-1 max-w-[60ch] text-sm leading-relaxed">
            Your watches are saved and scheduled, but this deployment has no shared job queue, so
            nothing is running them. Use Check now on a watch to look straight away.
          </p>
        </Card>
      )}

      {rows.length === 0 ? (
        <div className="border-border-strong flex flex-col items-center gap-3 rounded-(--radius-card) border border-dashed px-6 py-14 text-center">
          <span
            aria-hidden="true"
            className="border-border-strong text-ink-muted grid size-12 place-items-center rounded-full border"
          >
            <Icon name="bell" size={1.25} />
          </span>
          <h2 className="font-display text-display-sm text-ink">Nothing watched yet</h2>
          <p className="text-ink-muted max-w-[44ch] text-sm leading-relaxed">
            No watches yet. Run a search and save it, and we will keep looking and tell you when a
            materially better trip appears.
          </p>
          <Button asChild className="mt-2">
            <Link href="/explore">
              Search for a trip
              <Icon name="arrow-right" size={1} />
            </Link>
          </Button>
        </div>
      ) : (
        <WatchList
          rows={withPictures}
          pauseAction={pauseWatchAction}
          resumeAction={resumeWatchAction}
          archiveAction={archiveWatchAction}
          deleteAction={deleteWatchAction}
          checkAction={checkWatchNowAction}
        />
      )}

      <AddWatchForm action={addWatchAction} today={new Date().toISOString().slice(0, 10)} />
    </div>
  );
}
