import { Skeleton } from '@/components/ui';

/** One trip while it is being read: the header band, the tabs, then the plan. */
export default function TripLoading() {
  return (
    <div className="flex flex-col gap-8 lg:gap-10">
      <Skeleton className="h-4 w-20" />
      <Skeleton
        className="h-60 rounded-(--radius-shell) sm:h-72 lg:h-80"
        label="Loading the trip"
      />
      <Skeleton className="h-11 w-full max-w-3xl" />
      <div className="flex gap-2 border-b border-(--color-border) pb-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-14">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-72 rounded-(--radius-card)" />
      </div>
    </div>
  );
}
