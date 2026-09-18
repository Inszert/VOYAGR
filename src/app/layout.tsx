import type { Metadata, Viewport } from 'next';
import { SkipLink } from '@/components/ui';
import { ServiceWorkerRegistrar } from '@/components/pwa/service-worker-registrar';
import './globals.css';

/**
 * Root layout.
 *
 * Establishes the document landmarks every page inherits: a skip link, a banner
 * header, one `<main>` with a stable id, and a contentinfo footer. Pages supply
 * content, never their own landmarks.
 */

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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f9fb' },
    { media: '(prefers-color-scheme: dark)', color: '#111a24' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-surface text-ink min-h-dvh antialiased">
        <SkipLink targetId="main-content" />

        <div className="flex min-h-dvh flex-col">
          <header className="border-border bg-surface-raised border-b">
            <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
              <span className="text-ink text-lg font-semibold tracking-tight">Voyagr</span>
              <span className="text-ink-muted text-sm">Engineering foundation</span>
            </div>
          </header>

          <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
            {children}
          </main>

          <footer className="border-border bg-surface-raised border-t">
            <div className="text-ink-muted mx-auto w-full max-w-5xl px-4 py-6 text-sm">
              Prices and availability are observed from providers and can change. Nothing here is a
              booking.
            </div>
          </footer>
        </div>

        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
