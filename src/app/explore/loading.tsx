import { Container, Skeleton } from '@/components/ui';

/**
 * The explorer while it works.
 *
 * Shaped like what is about to arrive - the results header, the toolbar and a
 * card with its picture, price and itinerary - so the page does not jump when
 * the answer comes in. Announced once, as one status, not per grey block.
 */
export default function ExploreLoading() {
  return (
    <div className="bg-stage text-stage-ink stage-scope min-h-[70vh] pt-24">
      <Container size="wide" className="flex flex-col gap-6 pb-16">
        <div role="status" aria-label="Looking for trips" className="flex flex-col gap-6">
          <span className="sr-only">Looking for trips</span>
          <div className="flex flex-col gap-3" aria-hidden="true">
            <Skeleton className="h-9 w-64 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>

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
  );
}
