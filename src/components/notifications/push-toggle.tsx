'use client';

import { useEffect, useState } from 'react';
import { Button, Card } from '@/components/ui';

/**
 * Turning browser notifications on.
 *
 * A client component because everything it touches - permissions, the service
 * worker registration, the `PushManager` - lives only in the browser.
 *
 * Two rules it exists to honour:
 *
 *  - **Never ask on load.** A permission prompt nobody invited is how a site
 *    gets its notifications blocked permanently, and that block is not
 *    reversible from our side. It is asked for only after a deliberate click.
 *  - **Say which state you are in.** "Blocked" is a different problem from "not
 *    set up yet" and needs a different instruction, so they are never collapsed
 *    into one vague message.
 */

type PushState = 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on' | 'working';

export interface PushToggleProps {
  /** The VAPID public key. Absent when the server has none configured. */
  vapidPublicKey: string | null;
}

/**
 * The `PushManager` wants raw bytes, and VAPID keys travel as base64url.
 *
 * Typed as `Uint8Array<ArrayBuffer>` rather than the default, because
 * `applicationServerKey` will not accept a view that might be backed by a
 * `SharedArrayBuffer` - and a plain `Uint8Array` might be.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded.replaceAll('-', '+').replaceAll('_', '/'));

  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function describe(state: PushState): string {
  switch (state) {
    case 'on':
      return 'This device will be told when one of your watched trips gets materially cheaper.';
    case 'off':
      return 'We keep watching either way. Turn this on to hear about a drop without checking back.';
    case 'denied':
      // Not something we can undo; only the user can, in their browser.
      return 'Your browser is blocking notifications for this site. You can change that in its site settings.';
    case 'unsupported':
      return 'This browser does not support push notifications.';
    case 'unconfigured':
      return 'Push notifications are not configured on this server yet.';
    case 'working':
      return 'Checking…';
  }
}

export function PushToggle({ vapidPublicKey }: PushToggleProps) {
  const [state, setState] = useState<PushState>('working');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    /*
     * One async resolver rather than several synchronous `setState` calls.
     *
     * Setting state synchronously inside an effect makes React render twice
     * before the browser paints; doing it once, after the work, does not. The
     * checks also cannot run during server rendering - `Notification` and
     * `navigator.serviceWorker` do not exist there - so they cannot move into
     * a `useState` initialiser either.
     */
    async function resolveState(): Promise<PushState> {
      if (!vapidPublicKey) return 'unconfigured';
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
      if (Notification.permission === 'denied') return 'denied';

      try {
        const registration = await navigator.serviceWorker.ready;
        return (await registration.pushManager.getSubscription()) ? 'on' : 'off';
      } catch {
        return 'off';
      }
    }

    void resolveState().then((next) => {
      // The service worker can take a moment; the user may have navigated away.
      if (!cancelled) setState(next);
    });

    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function enable() {
    setError(null);
    setState('working');

    try {
      // Asked for here, inside a click handler, and nowhere else.
      const permission = await Notification.requestPermission();

      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        // Required by every browser: a push that cannot be shown to the user is
        // not allowed to be silent.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
      });

      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });

      if (!response.ok) throw new Error('The server would not store that subscription.');

      setState('on');
    } catch (cause) {
      setState('off');
      setError(cause instanceof Error ? cause.message : 'Could not turn notifications on.');
    }
  }

  async function disable() {
    setError(null);
    setState('working');

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Unsubscribed in the browser *and* forgotten on the server. Doing only
        // the first leaves us pushing at an endpoint that will never answer.
        await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
          method: 'DELETE',
        });
        await subscription.unsubscribe();
      }

      setState('off');
    } catch (cause) {
      setState('on');
      setError(cause instanceof Error ? cause.message : 'Could not turn notifications off.');
    }
  }

  return (
    <Card as="section" aria-labelledby="push-heading">
      <h2 id="push-heading" className="text-ink text-xl font-semibold">
        Alerts on this device
      </h2>

      <p className="text-ink-muted mt-1 text-sm">{describe(state)}</p>

      <p role="alert" aria-live="polite" className="text-critical-500 mt-2 text-sm empty:hidden">
        {error}
      </p>

      {state === 'off' || state === 'on' || state === 'working' ? (
        <div className="mt-4">
          <Button
            type="button"
            variant={state === 'on' ? 'secondary' : 'primary'}
            loading={state === 'working'}
            onClick={state === 'on' ? disable : enable}
          >
            {state === 'on' ? 'Turn off alerts' : 'Turn on alerts'}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
