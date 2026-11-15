import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { bestSaving, flexOptions, type FlexDayPrice } from '@/core/flex-dates';
import { money } from '@/core/money';
import { FlexDatesStrip } from './flex-dates-strip';

/**
 * The strip says what moving the trip costs, and is honest about days nobody priced.
 */

const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const AT = '2026-11-14T11:30:00.000Z';

function strip(prices: Record<string, number>, windowDays = 3) {
  const map = new Map<string, FlexDayPrice>(
    Object.entries(prices).map(([day, amount]) => [
      day,
      { price: money(amount, 'EUR'), observedAt: AT },
    ]),
  );
  const options = flexOptions({
    departureDate: '2026-12-10',
    returnDate: '2026-12-15',
    windowDays,
    prices: map,
    now: NOW,
  });

  return render(
    <FlexDatesStrip
      options={options}
      best={bestSaving(options)}
      ageMs={30 * 60_000}
      hrefFor={(option) => `/explore?d=${option.departureDate}&r=${option.returnDate}`}
    />,
  );
}

describe('FlexDatesStrip', () => {
  it('says the saving in a sentence and how old the prices are', () => {
    strip({ '2026-12-10': 30000, '2026-12-08': 21600 });

    expect(screen.getByText('Leave 2 days earlier and save €84.')).toBeTruthy();
    expect(screen.getByText('Updated 30 min ago')).toBeTruthy();
  });

  it('says one day, not one days', () => {
    strip({ '2026-12-10': 30000, '2026-12-11': 21600 });

    expect(screen.getByText('Leave 1 day later and save €84.')).toBeTruthy();
  });

  it('has no sentence when nothing is materially cheaper', () => {
    strip({ '2026-12-10': 30000, '2026-12-11': 29900 });

    expect(screen.queryByText(/and save/)).toBeNull();
  });

  it('shows 2N+1 cells', () => {
    strip({ '2026-12-10': 30000 });

    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });

  it('marks the chosen day with aria-current and with words, not colour', () => {
    strip({ '2026-12-10': 30000, '2026-12-08': 21600 });

    const current = document.querySelector('[aria-current="true"]') as HTMLElement;
    expect(current.getAttribute('aria-label')).toMatch(/Thu 10 Dec/);
    expect(within(current).getByText('Your dates')).toBeTruthy();
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('writes save, more and no price as words', () => {
    strip({ '2026-12-10': 30000, '2026-12-08': 21600, '2026-12-12': 32000 });

    expect(screen.getByText('Save €84')).toBeTruthy();
    expect(screen.getByText('€20 more')).toBeTruthy();
    expect(screen.getAllByText('No price yet').length).toBe(4);
  });

  it('a priced day is a link to those dates; an unknown day is not a link', () => {
    strip({ '2026-12-10': 30000, '2026-12-08': 21600 });

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.getAttribute('href'))).toContain(
      '/explore?d=2026-12-08&r=2026-12-13',
    );

    const unknown = screen.getByRole('group', { name: /Fri 11 Dec.*no price yet/i });
    expect(unknown.tagName).not.toBe('A');
  });

  it('gives each link an accessible name with the dates, price and difference', () => {
    strip({ '2026-12-10': 30000, '2026-12-08': 21600 });

    expect(
      screen.getByRole('link', { name: /Tue 8 Dec, back Sun 13 Dec, €216\.00, save €84/i }),
    ).toBeTruthy();
  });

  it('an unpriced chosen day still says it is the chosen one', () => {
    strip({ '2026-12-08': 21600 });

    const current = document.querySelector('[aria-current="true"]') as HTMLElement;
    expect(current.tagName).not.toBe('A');
    expect(within(current).getByText('Your dates')).toBeTruthy();
    expect(within(current).getByText('No price yet')).toBeTruthy();
  });

  it('with no prices at all, renders nothing: no heading, no empty cells', () => {
    const { container } = strip({});

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('renders nothing for a window of zero', () => {
    const { container } = strip({ '2026-12-10': 30000 }, 0);

    expect(container.firstChild).toBeNull();
  });
});
