import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = vi.fn();
const setConsent = vi.fn(async (_choice: string) => {});
const reload = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/app/actions/consent', () => ({
  setConsentAction: (choice: string) => setConsent(choice),
}));

import { ConsentBanner, CookieSettingsButton } from './consent-banner';

beforeEach(() => {
  refresh.mockClear();
  setConsent.mockClear();
  reload.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
});

describe('the cookie banner', () => {
  it('is a labelled region with two equal choices and a link to the details', () => {
    render(<ConsentBanner initialChoice={null} />);

    const region = screen.getByRole('region', { name: 'Cookies' });
    expect(region).toHaveTextContent(
      'We use one partner script (Travelpayouts) to track bookings made through our links. No ads profile is built by us.',
    );

    const accept = within(region).getByRole('button', { name: 'Accept' });
    const decline = within(region).getByRole('button', { name: 'Decline' });
    // Same variant, same size: neither is the prominent one.
    expect(accept.className).toBe(decline.className);

    expect(within(region).getByRole('link')).toHaveAttribute('href', '/privacy#cookies');
  });

  it('is not a dialog and does not take focus', () => {
    render(<ConsentBanner initialChoice={null} />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.body).toHaveFocus();
  });

  it('renders nothing once a choice stands', () => {
    render(<ConsentBanner initialChoice="declined" />);
    expect(screen.queryByRole('region', { name: 'Cookies' })).toBeNull();
  });

  it('records a decline, refreshes, and goes away without a reload', async () => {
    const user = userEvent.setup();
    render(<ConsentBanner initialChoice={null} />);

    await user.click(screen.getByRole('button', { name: 'Decline' }));

    expect(setConsent).toHaveBeenCalledWith('declined');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Cookies' })).toBeNull();
  });

  it('reloads on accept, so the document is served under the matching policy', async () => {
    const user = userEvent.setup();
    render(<ConsentBanner initialChoice={null} />);

    await user.click(screen.getByRole('button', { name: 'Accept' }));

    expect(setConsent).toHaveBeenCalledWith('accepted');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('is reopened by the cookie settings control and a withdrawal reloads', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ConsentBanner initialChoice="accepted" />
        <CookieSettingsButton />
      </>,
    );
    expect(screen.queryByRole('region', { name: 'Cookies' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cookie settings' }));
    expect(screen.getByRole('region', { name: 'Cookies' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Decline' }));
    expect(setConsent).toHaveBeenCalledWith('declined');
    // A script already running is only stopped by a fresh document.
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('says so, and stays, when the choice could not be saved', async () => {
    setConsent.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    render(<ConsentBanner initialChoice={null} />);

    await user.click(screen.getByRole('button', { name: 'Accept' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(screen.getByRole('region', { name: 'Cookies' })).toBeVisible();
    expect(reload).not.toHaveBeenCalled();
  });
});
