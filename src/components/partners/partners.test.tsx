import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PARTNER_OFFERS, offersFor, type PartnerOffer } from '@/booking/partners';
import {
  AffiliateDisclosure,
  AFFILIATE_DISCLOSURE,
  PartnerOfferCard,
  PartnerOfferRow,
  TripExtras,
} from './index';

/**
 * Roles, names and states - never class names.
 *
 * What these defend: every partner link is a real link with the attributes an
 * affiliate link must carry, it says it opens a new tab, no price is shown, and
 * a section with nothing to show is absent rather than empty.
 */

const TODAY = '2026-11-14';

const intui = offersFor('transfer')[0]!;

const withPromo = (expiresOn: string | null): PartnerOffer => ({
  ...intui,
  promo: { code: 'VOYAGR10', expiresOn },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PartnerOfferCard', () => {
  it('is an article named for the partner, with its description', () => {
    render(<PartnerOfferCard offer={intui} today={TODAY} />);

    const card = screen.getByRole('article', { name: 'Intui' });
    expect(within(card).getByRole('heading', { name: 'Intui', level: 4 })).toBeInTheDocument();
    expect(within(card).getByText(intui.description)).toBeInTheDocument();
  });

  it('has one link, to the partner, in a new tab, declared as sponsored', () => {
    render(<PartnerOfferCard offer={intui} today={TODAY} />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);

    const link = screen.getByRole('link', { name: 'Continue to Intui (opens in a new tab)' });
    expect(link).toHaveAttribute('href', 'https://intui.tpk.lv/fpeuqQrG');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')?.split(' ').sort()).toEqual([
      'nofollow',
      'noopener',
      'noreferrer',
      'sponsored',
    ]);
  });

  it('shows no price and no other control', () => {
    const { container } = render(<PartnerOfferCard offer={intui} today={TODAY} />);

    expect(container.textContent).not.toMatch(/[€$£]\s?\d|\d\s?[€$£]/);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders nothing for a link that is not on the allow-list', () => {
    const { container } = render(
      <PartnerOfferCard offer={{ ...intui, url: 'https://example.com/x' }} today={TODAY} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  describe('a promo code', () => {
    it('is shown while it is live, on its last day included', () => {
      render(<PartnerOfferCard offer={withPromo(TODAY)} today={TODAY} />);

      expect(screen.getByText('VOYAGR10')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy code VOYAGR10' })).toBeInTheDocument();
    });

    it('is absent the day after it expires', () => {
      render(<PartnerOfferCard offer={withPromo('2026-11-13')} today={TODAY} />);

      expect(screen.queryByText('VOYAGR10')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('is absent when the offer has none', () => {
      render(<PartnerOfferCard offer={intui} today={TODAY} />);

      expect(screen.queryByText(/promo code/i)).not.toBeInTheDocument();
    });

    it('announces "Copied" in a live region after the copy button is used', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      // After `setup()`, which installs its own clipboard stub over the property.
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

      render(<PartnerOfferCard offer={withPromo(null)} today={TODAY} />);

      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(status).toHaveTextContent('');

      await user.click(screen.getByRole('button', { name: 'Copy code VOYAGR10' }));

      expect(writeText).toHaveBeenCalledWith('VOYAGR10');
      expect(status).toHaveTextContent('Copied');
    });

    it('says so, and leaves the code selectable, when the clipboard is unavailable', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });

      render(<PartnerOfferCard offer={withPromo(null)} today={TODAY} />);
      await user.click(screen.getByRole('button', { name: 'Copy code VOYAGR10' }));

      expect(screen.getByRole('status')).toHaveTextContent(/could not copy/i);
      expect(screen.getByText('VOYAGR10')).toBeInTheDocument();
    });

    it('says so when the clipboard refuses', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('navigator', {
        ...navigator,
        clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      });

      render(<PartnerOfferCard offer={withPromo(null)} today={TODAY} />);
      await user.click(screen.getByRole('button', { name: 'Copy code VOYAGR10' }));

      expect(screen.getByRole('status')).toHaveTextContent(/could not copy/i);
    });

    it('goes quiet again after a moment', async () => {
      vi.useFakeTimers();
      try {
        vi.stubGlobal('navigator', {
          ...navigator,
          clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
        });

        render(<PartnerOfferCard offer={withPromo(null)} today={TODAY} />);
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Copy code VOYAGR10' }));
        });
        expect(screen.getByRole('status')).toHaveTextContent('Copied');

        act(() => {
          vi.advanceTimersByTime(3000);
        });
        expect(screen.getByRole('status')).toHaveTextContent('');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('PartnerOfferRow', () => {
  it('is one link with the same attributes and name as the card', () => {
    render(<PartnerOfferRow offer={intui} />);

    const link = screen.getByRole('link', { name: 'Continue to Intui (opens in a new tab)' });
    expect(link).toHaveAttribute('href', 'https://intui.tpk.lv/fpeuqQrG');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('sponsored'));
  });

  it('says in words that it is a partner link', () => {
    render(<PartnerOfferRow offer={intui} />);

    expect(screen.getByText(/partner link/i)).toBeInTheDocument();
  });

  it('renders nothing for a link that is not on the allow-list', () => {
    const { container } = render(
      <PartnerOfferRow offer={{ ...intui, url: 'http://intui.tpk.lv/x' }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('AffiliateDisclosure', () => {
  it('says the sentence the product promised', () => {
    render(<AffiliateDisclosure />);

    expect(
      screen.getByText(
        'Some links are partner links. If you book through them Voyagr may earn a commission, at no cost to you.',
      ),
    ).toBeInTheDocument();
    expect(AFFILIATE_DISCLOSURE).toMatch(/at no cost to you\.$/);
  });
});

describe('TripExtras', () => {
  it('is a labelled section with the three groups, each under its heading', () => {
    render(<TripExtras offers={PARTNER_OFFERS} today={TODAY} />);

    const section = screen.getByRole('region', { name: 'Sort the rest of the trip' });
    const headings = within(section)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);

    expect(headings).toEqual([
      'Getting from the airport',
      'Stay connected',
      'If your flight is delayed',
    ]);
  });

  it('puts each partner in its own group', () => {
    render(<TripExtras offers={PARTNER_OFFERS} today={TODAY} />);

    const group = (name: string) =>
      screen.getByRole('heading', { name }).parentElement as HTMLElement;

    expect(within(group('Getting from the airport')).getAllByRole('article')).toHaveLength(1);
    expect(within(group('Getting from the airport')).getByRole('article')).toHaveAccessibleName(
      'Intui',
    );
    expect(
      within(group('Stay connected'))
        .getAllByRole('article')
        .map((card) => card.getAttribute('aria-labelledby')),
    ).toEqual(['partner-yesim-esim-heading', 'partner-gigsky-esim-heading']);
    expect(within(group('If your flight is delayed')).getByRole('article')).toHaveAccessibleName(
      'AirHelp',
    );
  });

  it('gives all four partners a link, and every link opens a new tab', () => {
    render(<TripExtras offers={PARTNER_OFFERS} today={TODAY} />);

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://intui.tpk.lv/fpeuqQrG',
      'https://yesim.tpk.lv/ecwWMBgq',
      'https://gigsky.tpk.lv/N27sJpgR',
      'https://airhelp.tpk.lv/pGWVqGU3',
    ]);
    for (const link of links) {
      expect(link).toHaveAccessibleName(/\(opens in a new tab\)$/);
      expect(link).toHaveAttribute('target', '_blank');
    }
  });

  it('carries the disclosure with it', () => {
    render(<TripExtras offers={PARTNER_OFFERS} today={TODAY} />);

    expect(screen.getByText(AFFILIATE_DISCLOSURE)).toBeInTheDocument();
  });

  it('shows only the groups that have an offer', () => {
    render(<TripExtras offers={offersFor('esim')} today={TODAY} />);

    expect(screen.getByRole('heading', { name: 'Stay connected' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Getting from the airport' })).toBeNull();
  });

  it('renders nothing at all - no heading, no disclosure - when there are no offers', () => {
    const { container } = render(<TripExtras offers={[]} today={TODAY} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a category no partner covers', () => {
    const { container } = render(<TripExtras offers={offersFor('insurance')} today={TODAY} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('drops an offer whose link fails vetting, and the group with it', () => {
    const { container } = render(
      <TripExtras offers={[{ ...intui, url: 'https://example.com/x' }]} today={TODAY} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
