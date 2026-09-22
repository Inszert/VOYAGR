import type { Metadata, Viewport } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import { SkipLink } from '@/components/ui';
import { AccountNav } from '@/components/auth/account-nav';
import { SiteHeader } from '@/components/shell/site-header';
import { SeasonalAmbience } from '@/components/discovery/seasonal-ambience';
import { ServiceWorkerRegistrar } from '@/components/pwa/service-worker-registrar';
import './globals.css';

/**
 * Root layout.
 *
 * Establishes the document landmarks every page inherits: a skip link, a banner
 * header, one `<main>` with a stable id, and a contentinfo footer. Pages supply
 * content, never their own landmarks.
 *
 * `<main>` no longer constrains width. The discovery stage bleeds to the
 * viewport edge; every page that reads as a column says so with `Container`,
 * or lives in the `(column)` route group whose layout does it for them.
 */

/*
 * Two faces, self-hosted.
 *
 * `next/font/google` fetches these at build time and serves them from our own
 * origin, so `font-src` stays `'self'`, no reader's browser contacts Google,
 * and there is no layout shift while a stylesheet is fetched from a third
 * party. Both are variable fonts, so every weight in the design comes from one
 * file per face rather than one file per weight.
 *
 * They are exposed as custom properties rather than classes, because the type
 * scale is already expressed as `--font-sans` and `--font-display` tokens that
 * every component reads through `font-sans` and `font-display`. Swapping a
 * face is a change to two lines in `globals.css`, not to a component.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Voyagr',
    template: '%s — Voyagr',
  },
  description:
    'Voyagr keeps searching for a better complete trip after you close the tab, and tells you when it finds one.',
  applicationName: 'Voyagr',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Voyagr',
    statusBarStyle: 'default',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Deliberately not locking zoom: pinch-zoom is an accessibility requirement.
  maximumScale: 5,
  /*
   * One colour, because there is one scheme. The browser paints its own
   * chrome with this on a phone, and a pale bar over a night page is the
   * first thing anybody sees on the way in.
   */
  themeColor: '#05070e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body className="bg-surface text-ink min-h-dvh antialiased">
        <SkipLink targetId="main-content" />

        <div className="flex min-h-dvh flex-col">
          {/*
            The account navigation is a server component that reads the
            session; the header around it is a client component that reads the
            scroll position. Passing one into the other keeps identity on the
            server and the chrome on the client.
          */}
          <SiteHeader>
            <AccountNav />
          </SiteHeader>

          <main id="main-content" className="flex-1">
            {children}
          </main>

          <footer className="border-hairline bg-bg-alt border-t">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-display text-text text-lg tracking-tight">Voyagr</p>
              <p className="text-muted max-w-xl text-sm">
                Prices and availability are observed from providers and can change. Nothing here is
                a booking.
              </p>
            </div>
          </footer>
        </div>

        <SeasonalAmbience />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
