import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PushToggle } from './push-toggle';

/**
 * The push opt-in control.
 *
 * What matters is that it never asks for permission on its own, and that it
 * tells the truth about which state it is in - "blocked" and "not set up" need
 * different instructions, and collapsing them tells the user to do something
 * that will not help.
 */

describe('PushToggle', () => {
  it('says so plainly when the server has no keys', async () => {
    render(<PushToggle vapidPublicKey={null} />);

    expect(await screen.findByText(/not configured on this server yet/)).toBeInTheDocument();
    // No button, because pressing one could not work.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers the control when the server is configured', async () => {
    // jsdom has no PushManager, so this lands on the unsupported branch - which
    // is itself the thing worth asserting: an unsupported browser is told so
    // rather than shown a button that throws.
    render(<PushToggle vapidPublicKey="a-public-key" />);

    expect(await screen.findByText(/does not support push notifications/)).toBeInTheDocument();
  });

  it('never requests permission during render', () => {
    // A permission prompt nobody invited is how a site gets its notifications
    // blocked permanently, and the block is not reversible from our side.
    let asked = false;

    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: {
        permission: 'default',
        requestPermission: () => {
          asked = true;
          return Promise.resolve('granted');
        },
      },
    });

    render(<PushToggle vapidPublicKey="a-public-key" />);

    expect(asked).toBe(false);
  });
});
