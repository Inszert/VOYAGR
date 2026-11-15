import { Container, Skeleton } from '@/components/ui';
import { EXPLORE_SLOT_CLASS, StageSlot } from '@/components/discovery/stage-slot';

/**
 * The explorer while it works.
 *
 * It covers the results and nothing above them. The planet is not part of
 * this page - it lives in the `(stage)` layout and carries on turning - and
 * what this renders in its place is the empty column the globe will fill, so
 * the globe is already moving to its explorer position while the answer is
 * still being worked out. The skeleton below is shaped like what is about to
 * arrive (the results header, the toolbar and a card with its picture, price
 * and itinerary) so the page does not jump when it does. Announced once, as
 * one status, not per grey block.
 */
export default function ExploreLoading() {
  return (
    <div className="flex flex-col">
      <section className="text-text relative -mt-[72px] overflow-x-clip pt-[72px]">
        <div
          aria-hidden="true"
          className="voyagr-sky pointer-events-none absolute inset-0 -z-10"
          style={{ '--sky-x': '50%', '--sky-y': '56%' } as React.CSSProperties}
        />
        <div
          aria-hidden="true"
          className="voyagr-grid pointer-events-none absolute inset-0 -z-10"
        />

        <Container
          size="wide"
          className="grid grid-cols-[minmax(0,1fr)] items-center gap-6 pt-6 pb-8 lg:grid-cols-[minmax(0,31rem)_minmax(0,1fr)]"
        >
          <div className="flex min-w-0 flex-col gap-3">
            <Skeleton aria-hidden="true" className="h-10 w-72 max-w-full" />
            <Skeleton aria-hidden="true" className="h-4 w-80 max-w-full" />
          </div>

          <StageSlot variant="explorer" className={EXPLORE_SLOT_CLASS} />
        </Container>
      </section>

      <div className="bg-stage text-stage-ink stage-scope">
        <Container size="wide" className="flex flex-col gap-6 pt-6 pb-16">
          <div role="status" aria-label="Looking for trips" className="flex flex-col gap-6">
            <span className="sr-only">Looking for trips</span>

            <Skeleton aria-hidden="true" className="h-16 w-full rounded-(--radius-card)" />

            <div
              aria-hidden="true"
              className="border-border bg-surface-raised grid overflow-hidden rounded-(--radius-surface) border lg:grid-cols-[5fr_6fr]"
            >
              <Skeleton className="min-h-[15rem] rounded-none lg:min-h-[22rem]" />
              <div className="flex flex-col gap-5 p-6">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="h-10 w-44" />
                  <Skeleton className="h-4 w-56 max-w-full" />
                </div>
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
                <Skeleton className="h-12 w-full rounded-(--radius-control) sm:w-56" />
              </div>
            </div>

            <div aria-hidden="true" className="grid gap-4 lg:grid-cols-2">
              {[0, 1].map((key) => (
                <Skeleton key={key} className="h-32 rounded-(--radius-card)" />
              ))}
            </div>
          </div>
        </Container>
      </div>
    </div>
  );
}
