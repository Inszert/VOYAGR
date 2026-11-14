'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

/**
 * The site header.
 *
 * Floats over the stage on the pages that have one, transparent until the
 * stage has scrolled underneath it and glass from then on. On every other page
 * it is the same header, solid from the start. The landmarks do not change:
 * one banner, one primary navigation, and the account navigation the server
 * renders into `children`.
 *
 * A client component only for the scroll state and the current path. Nothing
 * here reads the session; that stays on the server.
 */

/** Routes whose first screen is the stage, so the header starts transparent. */
const STAGE_ROUTES = new Set(['/', '/explore']);

/**
 * The primary navigation.
 *
 * Three destinations, and every one of them is a page this product actually
 * has. The reference image carries a fourth; inventing a "Deals" tab that
 * led nowhere would be the first lie in the interface, and the first thing
 * anybody clicked.
 */
const PRIMARY = [
  { href: '/', label: 'Discover' },
  { href: '/explore', label: 'Explore' },
  // Stays is a first-class search, not a thing to be discovered: a travel
  // site that only offers flights until you find a link is a flight site.
  { href: '/stays', label: 'Stays' },
  { href: '/watches', label: 'Watches' },
  { href: '/trips', label: 'Trips' },
] as const;

export interface SiteHeaderProps {
  /** The account navigation, rendered on the server. */
  children: React.ReactNode;
}

export function SiteHeader({ children }: SiteHeaderProps) {
  const pathname = usePathname();
  const onStage = STAGE_ROUTES.has(pathname);
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    if (!onStage) return;

    const update = () => setScrolled(window.scrollY > 24);
    update();

    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [onStage]);

  const transparent = onStage && !scrolled;

  return (
    <header
      data-stage={onStage ? 'true' : undefined}
      className={cn(
        'sticky top-0 z-20 border-b',
        'ease-standard duration-settled transition-[background-color,border-color,box-shadow]',
        transparent
          ? 'border-transparent bg-transparent'
          : 'border-stage-glass-border bg-stage-glass backdrop-blur-glass',
      )}
    >
      {/*
        On a phone the navigation takes its own line.

        A wordmark, three destinations and the account all on one row is four
        things fighting over three hundred and twenty pixels, and the loser is
        always the way in to an account. Wrapping is the honest answer: the
        same links, one line lower.
      */}
      <div className="text-text mx-auto flex w-full max-w-[1216px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 sm:h-[72px] sm:flex-nowrap sm:py-0 md:px-12">
        {/* `-my-2 py-2`: a taller target, in the same visual position. */}
        <Link href="/" className="group -my-2 flex items-center gap-2.5 py-2">
          {/*
            The mark: a four-pointed star, which is what a compass rose and
            a distant sun have in common. Drawn rather than imported, at the
            one size it is ever used, so the header costs no request.
          */}
          <span
            aria-hidden="true"
            className="text-stage-accent ease-standard duration-settled transition-transform motion-safe:group-hover:rotate-90"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-[18px]">
              <path d="M12 1.5 14 9.2a3 3 0 0 0 1.8 1.8l7.7 2-7.7 2a3 3 0 0 0-1.8 1.8l-2 7.7-2-7.7A3 3 0 0 0 8.2 15l-7.7-2 7.7-2A3 3 0 0 0 10 9.2Z" />
            </svg>
          </span>
          <span className="font-display text-[20px] leading-none tracking-tight">Voyagr</span>
        </Link>

        <nav
          aria-label="Primary"
          className="order-last -ml-3 flex w-full items-center gap-1 text-[14px] max-sm:[scrollbar-width:none] max-sm:overflow-x-auto sm:order-none sm:mr-auto sm:ml-8 sm:w-auto"
        >
          {PRIMARY.map((item) => {
            const current = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'ease-standard duration-quick relative px-3 py-2 transition-colors',
                  // The rule under the current page is decoration on top of
                  // `aria-current`, which is what actually says where you
                  // are; the weight change carries it for anyone who cannot
                  // see the rule.
                  current ? 'text-text font-medium' : 'text-muted hover:text-text',
                )}
              >
                {item.label}
                {current ? (
                  <span
                    aria-hidden="true"
                    className="bg-text absolute inset-x-3 -bottom-[6px] h-[2px]"
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/*
          The account navigation and, in development, the data-source switch.
          Both are rendered on the server and handed in, because nothing in
          this header may read the session or the environment.
        */}
        <div className="stage-scope flex items-center gap-3">{children}</div>
      </div>
    </header>
  );
}
