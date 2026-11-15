import { Skeleton } from '@/components/ui';

/**
 * Your trips, while they are being read.
 *
 * The page header's three lines and a grid of cards at the card's own 3:2 and
 * footer, so nothing moves when the real list arrives. One element is
 * announced; the rest are shapes.
 */
export default function TripsLoading() {
  return (
    <div className="flex flex-col gap-10 lg:gap-12">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-10 w-64 sm:h-12" label="Loading your trips" />
        <Skeleton className="h-4 w-full max-w-[60ch]" />
      </div>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="border-border overflow-hidden rounded-(--radius-card) border">
            <Skeleton className="aspect-[3/2] rounded-none" />
            <div className="flex items-center justify-between px-4 py-3.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="size-7 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
