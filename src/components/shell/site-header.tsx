'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Icon, Sheet, SheetClose, SheetContent, SheetTrigger } from '@/components/ui';

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
  /** The notification bell, for somebody signed in. Rendered once, at every width. */
  bell?: React.ReactNode;
  /** The account links as the wide header shows them. Rendered on the server. */
  account: React.ReactNode;
  /** The developer data switch, for the wide header. */
  dataSwitch?: React.ReactNode;
  /** The one action the phone header keeps in view: sign up, or the account. */
  primaryAction: React.ReactNode;
  /** The account links as the menu sheet lists them. */
  menuAccount: React.ReactNode;
  /** The data switch again, for the menu sheet (null when it is disabled). */
  menuDataSwitch?: React.ReactNode;
}

export function SiteHeader({
  bell,
  account,
  dataSwitch,
  primaryAction,
  menuAccount,
  menuDataSwitch,
}: SiteHeaderProps) {
  const pathname = usePathname();
  const onStage = STAGE_ROUTES.has(pathname);
  const [scrolled, setScrolled] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    if (!onStage) return;

    const update = () => setScrolled(window.scrollY > 24);
    update();

    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [onStage]);

  // A link in the sheet that goes somewhere closes it. Adjusting state while
  // rendering is React's documented way to reset state when an input changes.
  const [sheetPath, setSheetPath] = React.useState(pathname);
  if (sheetPath !== pathname) {
    setSheetPath(pathname);
    setMenuOpen(false);
  }

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
        One row at every width: 56px below 1024, 72px from there.

        Below 1024 the navigation lives in a sheet behind a Menu button, so the
        row is the wordmark and, on the right, the bell, the one action that
        matters and the menu. Wrapping the navigation onto a second line - the
        earlier answer - clipped "Trips" at 390 and "Create account" at 768.
      */}
      <div className="text-text mx-auto flex h-14 w-full max-w-[1216px] items-center justify-between gap-3 px-4 sm:px-5 lg:h-[72px] lg:gap-4 lg:px-12">
        {/* `-my-2 py-2`: a taller target, in the same visual position. */}
        <Link href="/" className="group -my-2 flex shrink-0 items-center gap-2.5 py-2">
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
          className="mr-auto ml-8 hidden items-center gap-1 text-[14px] lg:flex"
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
        <div className="stage-scope ml-auto flex items-center gap-2 lg:ml-0 lg:gap-3">
          {bell}
          <div className="hidden items-center gap-3 lg:flex">
            {dataSwitch}
            {account}
          </div>
          <div className="flex items-center lg:hidden">{primaryAction}</div>

          <div className="lg:hidden">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="voyagr-panel text-text ease-standard duration-quick grid size-11 place-items-center rounded-(--radius-control) transition-colors hover:text-(--color-stage-accent)"
                >
                  <Icon name="menu" size={1.1} />
                  <span className="sr-only">Menu</span>
                </button>
              </SheetTrigger>
              <SheetContent title="Menu" className="stage-scope">
                <div className="border-border flex h-14 shrink-0 items-center justify-between border-b px-4">
                  <span aria-hidden="true" className="font-display text-[18px]">
                    Menu
                  </span>
                  <SheetClose asChild>
                    <button
                      type="button"
                      className="text-ink-muted hover:text-ink ease-standard duration-quick -mr-2 inline-flex h-11 items-center rounded-(--radius-control) px-3 text-sm transition-colors"
                    >
                      Close
                    </button>
                  </SheetClose>
                </div>

                <nav aria-label="Primary" className="flex flex-col px-2 py-2">
                  {PRIMARY.map((item) => {
                    const current = pathname === item.href;

                    return (
                      <SheetClose asChild key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={current ? 'page' : undefined}
                          className={cn(
                            'ease-standard duration-quick flex min-h-12 items-center rounded-(--radius-control) px-3 text-[16px] transition-colors',
                            current
                              ? 'text-ink bg-white/[0.06] font-medium'
                              : 'text-ink-muted hover:text-ink',
                          )}
                        >
                          {item.label}
                        </Link>
                      </SheetClose>
                    );
                  })}
                </nav>

                <div className="border-border mx-4 border-t" />

                <div className="flex flex-col gap-1 px-2 py-3">{menuAccount}</div>

                {menuDataSwitch ? (
                  <div className="border-border mt-auto border-t px-4 py-4">{menuDataSwitch}</div>
                ) : null}
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}
