import { Skeleton } from '@/components/ui';

/** The account page while it is being read: the header, the contents, the first cards. */
export default function AccountLoading() {
  return (
    <div className="flex flex-col gap-10 lg:gap-12">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-10 w-56 sm:h-12" label="Loading your account" />
        <Skeleton className="h-4 w-48" />
      </div>

      <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
        <div className="hidden flex-col gap-2 lg:flex">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-8" />
          ))}
        </div>
        <div className="flex max-w-2xl flex-col gap-8">
          <Skeleton className="h-44 rounded-(--radius-card)" />
          <Skeleton className="h-96 rounded-(--radius-card)" />
        </div>
      </div>
    </div>
  );
}
