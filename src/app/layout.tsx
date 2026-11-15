import type { Metadata, Viewport } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import { SkipLink } from '@/components/ui';
import { AccountNav } from '@/components/auth/account-nav';
import { getCurrentUser } from '@/auth/current-user';
import { NotificationCentre } from '@/components/notifications/notification-centre';
import { HeaderPrimaryAction, MenuAccountLinks } from '@/components/shell/header-account';
import { SiteHeader } from '@/components/shell/site-header';
import { DataSourceSwitch } from '@/components/dev/data-source-switch';
import { getActiveDataSource } from '@/providers/request-source';
import { SeasonalAmbience } from '@/components/discovery/seasonal-ambience';
import { ServiceWorkerRegistrar } from '@/components/pwa/service-worker-registrar';
import { AffiliateDrive } from '@/components/shell/affiliate-drive';
import { ConsentBanner, CookieSettingsButton } from '@/components/shell/consent-banner';
import { getConsent } from '@/consent/server';
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
  const [user, dataSource, consent] = await Promise.all([
    getCurrentUser(),
    getActiveDataSource(),
    getConsent(),
  ]);

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
      <AffiliateDrive />

      <body className="bg-surface text-ink min-h-dvh antialiased">
        <SkipLink targetId="main-content" />

        <div className="flex min-h-dvh flex-col">
          <SiteHeader
            bell={user ? <NotificationCentre /> : null}
            account={<AccountNav withBell={false} />}
            /*
              Developer infrastructure, rendered on the server so the client
              never learns which vendor is configured. It removes itself in
              production unless DATA_SOURCE_SWITCH says otherwise.
            */
            dataSwitch={<DataSourceSwitch source={dataSource} />}
            primaryAction={<HeaderPrimaryAction email={user?.email ?? null} />}
            menuAccount={<MenuAccountLinks email={user?.email ?? null} />}
            menuDataSwitch={
              dataSource.switchEnabled ? <DataSourceSwitch source={dataSource} /> : null
            }
          />

          <main id="main-content" className="flex-1">
            {children}
          </main>

          <footer className="border-hairline bg-bg-alt border-t">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-display text-text text-lg tracking-tight">Voyagr</p>
              <div className="flex flex-col gap-3 sm:items-end">
                <p className="text-muted max-w-xl text-sm sm:text-right">
                  Prices and availability are observed from providers and can change. Nothing here
                  is a booking.
                </p>
                <nav aria-label="Legal">
                  <ul className="text-muted flex gap-5 text-sm">
                    <li>
                      <a
                        href="/privacy"
                        className="hover:text-text underline-offset-4 hover:underline"
                      >
                        Privacy
                      </a>
                    </li>
                    <li>
                      <a
                        href="/terms"
                        className="hover:text-text underline-offset-4 hover:underline"
                      >
                        Terms
                      </a>
                    </li>
                    <li>
                      <CookieSettingsButton className="hover:text-text min-h-6 underline-offset-4 hover:underline" />
                    </li>
                    <li>
                      <a
                        href="/status"
                        className="hover:text-text underline-offset-4 hover:underline"
                      >
                        Status
                      </a>
                    </li>
                  </ul>
                </nav>
              </div>
            </div>
          </footer>
        </div>

        <ConsentBanner initialChoice={consent} />
        <SeasonalAmbience />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
