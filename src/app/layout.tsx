import type { Metadata, Viewport } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import { SkipLink } from '@/components/ui';
import { AccountNav } from '@/components/auth/account-nav';
import { SiteHeader } from '@/components/shell/site-header';
import { DataSourceSwitch } from '@/components/dev/data-source-switch';
import { getActiveDataSource } from '@/providers/request-source';
import { SeasonalAmbience } from '@/components/discovery/seasonal-ambience';
import { ServiceWorkerRegistrar } from '@/components/pwa/service-worker-registrar';
import './globals.css';

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
  maximumScale: 5,
  themeColor: '#05070e',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <meta
        {...({
          name: 'impact-site-verification',
          value: 'feca6996-7b98-4739-b366-3f224f7e335e',
        } as React.MetaHTMLAttributes<HTMLMetaElement> & {
          value: string;
        })}
      />

      <body className="bg-surface text-ink min-h-dvh antialiased">
        <SkipLink targetId="main-content" />

        <div className="flex min-h-dvh flex-col">
          <SiteHeader>
            {/*
              Developer infrastructure, rendered on the server so the client
              never learns which vendor is configured. It removes itself in
              production unless DATA_SOURCE_SWITCH says otherwise.
            */}
            <DataSourceSwitch source={await getActiveDataSource()} />
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
