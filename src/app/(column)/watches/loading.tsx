import { Skeleton } from '@/components/ui';

/** The watches while they are being read: the header, then cards the size of the real ones. */
export default function WatchesLoading() {
  return (
    <div className="flex flex-col gap-10 lg:gap-12">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-10 w-56 sm:h-12" label="Loading your watches" />
        <Skeleton className="h-4 w-full max-w-[60ch]" />
      </div>

      <div className="flex flex-col gap-6">
        {Array.from({ length: 2 }, (_, index) => (
          <div
            key={index}
            className="border-border overflow-hidden rounded-(--radius-card) border md:grid md:grid-cols-[17rem_minmax(0,1fr)] lg:grid-cols-[20rem_minmax(0,1fr)]"
          >
            <Skeleton className="h-44 rounded-none md:h-auto md:min-h-72" />
            <div className="flex flex-col gap-5 p-5 sm:p-6">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-16" />
              <Skeleton className="h-10 w-full max-w-xs" />
              <Skeleton className="h-11 w-48" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
