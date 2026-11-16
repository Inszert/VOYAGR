import { Container, Skeleton } from '@/components/ui';

/**
 * The stay page while providers are answering.
 *
 * The same shapes as what arrives - the header band, the strip of dates, the
 * row of places - at the same sizes, so nothing jumps when the real page
 * replaces this. One element is announced to assistive technology; the rest
 * are shapes and are hidden from it. The pulse is the base layer's, which
 * reduced motion already stills.
 */
export default function StaysLoading() {
  return (
    <div className="stage-scope bg-bg text-text min-h-screen">
      <Container size="wide" className="flex flex-col gap-8 py-10 lg:gap-10 lg:py-16">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-[12rem] rounded-(--radius-surface) sm:h-[15rem]" />
        </div>

        <Skeleton className="h-20 rounded-(--radius-card)" label="Looking for places to stay" />

        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-60" />
          <div className="grid auto-cols-[minmax(9rem,1fr)] grid-flow-col gap-2 overflow-hidden">
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} className="h-40 rounded-(--radius-card)" />
            ))}
          </div>
        </div>

        {/* The list on the left and the map on the right from 1024px, as the results arrive. */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }, (_, index) => (
              <div
                key={index}
                className="border-border grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 rounded-(--radius-card) border p-3 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:p-4"
              >
                <Skeleton className="aspect-square rounded-(--radius-control)" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
                <Skeleton className="hidden h-6 w-24 sm:block" />
              </div>
            ))}
          </div>
          <Skeleton className="hidden rounded-(--radius-surface) lg:block lg:h-[calc(100vh-72px-2rem)]" />
        </div>
      </Container>
    </div>
  );
}
