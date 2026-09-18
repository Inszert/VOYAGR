'use client';

import { useEffect } from 'react';

/**
 * Service worker registration.
 *
 * Registers `/sw.js` after the page has loaded, so the registration never
 * competes with first paint.
 *
 * Development is deliberately excluded: a cached app shell during development is
 * a source of confusing stale-content bugs. Run a production build to exercise
 * the PWA behaviour.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
        // A failed registration degrades the PWA; it must not break the page.
        console.warn('Service worker registration failed', error);
      });
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
