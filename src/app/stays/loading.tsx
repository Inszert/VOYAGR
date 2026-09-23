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
      <Container size="wide" className="flex flex-col gap-8 py-10">
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

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-5">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="border-border flex overflow-hidden rounded-(--radius-card) border sm:flex-col"
            >
              <Skeleton className="w-28 shrink-0 rounded-none sm:h-[180px] sm:w-full" />
              <div className="flex flex-1 flex-col gap-2.5 p-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="mt-4 ml-auto h-6 w-24" />
              </div>
            </div>
          ))}
        </div>
      </Container>
    </div>
  );
}
