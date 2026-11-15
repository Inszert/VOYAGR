import { Container, Skeleton } from '@/components/ui';
import './home.css';

/**
 * What the page below the hero looks like while it is on its way.
 *
 * Each block has the dimensions of the thing that replaces it - the heading
 * block, the mosaic's 12-column shape on desktop and a rail on a phone, the
 * tall rail, the full-bleed moment - so nothing moves when the real content
 * arrives. Silent to assistive technology except for one status line.
 */

function CardSkeleton({ className }: { className?: string }) {
  return <Skeleton className={`rounded-(--radius-card) ${className ?? ''}`} />;
}

export function HomeSkeleton() {
  return (
    <div aria-busy="true" className="home-scope">
      <p role="status" className="sr-only">
        Loading destinations
      </p>

      <Container size="wide" className="flex flex-col gap-8 py-10 lg:gap-10 lg:py-16">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-10 w-80 max-w-full" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <Skeleton className="h-11 w-full rounded-full lg:w-96" />
        </div>

        {/* Phone and tablet: a rail. */}
        <div className="-mx-5 flex gap-4 overflow-hidden px-5 md:-mx-12 md:px-12 lg:hidden">
          {[0, 1, 2].map((key) => (
            <CardSkeleton key={key} className="aspect-[3/2] w-[78vw] max-w-[21.25rem] shrink-0" />
          ))}
        </div>

        {/* Desktop: the mosaic, lead tile and two companions, then a row of three. */}
        <div className="hidden grid-cols-12 gap-5 lg:grid">
          <CardSkeleton className="col-span-7 row-span-2" />
          <CardSkeleton className="col-span-5 aspect-[3/2]" />
          <CardSkeleton className="col-span-5 aspect-[3/2]" />
          {[0, 1, 2].map((key) => (
            <CardSkeleton key={key} className="col-span-4 aspect-[3/2]" />
          ))}
        </div>

        <div className="flex flex-col gap-5">
          <Skeleton className="h-8 w-64" />
          <div className="-mx-5 flex gap-4 overflow-hidden px-5 md:-mx-12 md:px-12">
            {[0, 1, 2, 3].map((key) => (
              <CardSkeleton key={key} className="aspect-[320/420] w-80 shrink-0" />
            ))}
          </div>
        </div>
      </Container>

      <Skeleton className="min-h-[80svh] w-full rounded-none" />
    </div>
  );
}
