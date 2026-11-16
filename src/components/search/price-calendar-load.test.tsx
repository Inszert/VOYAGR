import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PriceCalendar, type PriceCalendarLoad } from './price-calendar';

/**
 * The calendar asks the vendor for every day of the months on screen.
 *
 * What is defended: a month in flight shows a shimmer rather than an empty
 * cell; a month that answers shows a price on every day it has one, and
 * nothing on the days it has not; the month after is fetched before it is
 * paged to; and a month that fails leaves a usable calendar and says so.
 */

const LOAD: PriceCalendarLoad = {
  origin: 'VIE',
  destinations: ['AYT'],
  currency: 'EUR',
  passengers: 1,
  minNights: 2,
  maxNights: 14,
  today: '2026-11-14',
  hrefTemplate: '/explore?departureDate=__DEPARTURE__&returnDate=__RETURN__',
};

/** Every day of the month but the 5th, 20 euro cheaper on the 12th. */
function month(name: string) {
  const days: Record<string, unknown> = {};
  const [year, mm] = name.split('-').map(Number) as [number, number];
  const count = new Date(Date.UTC(year, mm, 0)).getUTCDate();

  for (let day = 1; day <= count; day += 1) {
    if (day === 5) continue;
    const date = `${name}-${String(day).padStart(2, '0')}`;
    const amount = day === 12 ? 90 : 110;
    days[date] = {
      returnDate: `${name}-${String(Math.min(day + 3, 28)).padStart(2, '0')}`,
      exact: `€${amount}.00`,
      whole: `€${amount}`,
      perPerson: `€${amount}`,
      amount,
    };
  }

  // The 5th has no return fare, only a single flight out.
  const oneWay = { [`${name}-05`]: { exact: '€28.00', perPerson: '€28', amount: 28 } };

  return { month: name, passengers: 1, days, oneWay, reason: null };
}

function stubFetch(handler: (month: string) => Response | Promise<Response>) {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const name = new URL(url, 'http://x').searchParams.get('month')!;
      asked.push(name);
      return handler(name);
    }),
  );
  return asked;
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const renderCalendar = () =>
  render(
    <PriceCalendar
      options={[]}
      load={LOAD}
      selected={null}
      cheapestKey={null}
      bestValueKey={null}
      clearHref={null}
      chips={[]}
    />,
  );

afterEach(() => vi.unstubAllGlobals());

describe('PriceCalendar loading', () => {
  it('shows a shimmer, not an empty cell, until the month answers', async () => {
    let release: (value: Response) => void = () => {};
    stubFetch(() => new Promise<Response>((resolve) => (release = resolve)));

    renderCalendar();

    expect((await screen.findAllByLabelText(/loading price/i)).length).toBeGreaterThan(10);
    expect(screen.queryByLabelText(/16 November 2026, loading/i)).not.toBeNull();
    // A day already gone is not waited for.
    expect(screen.queryByLabelText(/13 November 2026, loading/i)).toBeNull();

    await act(async () => release(json(month('2026-11'))));
  });

  it('prices every day the vendor has, and none the vendor has not', async () => {
    // Return fares only: no one-way fare stands in for the missing 5th.
    stubFetch((name) => json({ ...month(name), oneWay: {} }));

    renderCalendar();

    // December: 31 days, one without data. Read off the DOM rather than by
    // role and name: computing a name for every cell of two months is slow.
    const cells = () => [...document.querySelectorAll('[role="gridcell"]')];
    const priced = () =>
      cells().filter((cell) => /December 2026, flights only/.test(cell.textContent ?? ''));

    await waitFor(() => expect(priced()).toHaveLength(30));
    expect(
      cells().some((cell) => cell.getAttribute('aria-label') === '5 December 2026, no price yet'),
    ).toBe(true);
    expect(screen.queryByLabelText(/loading price/i)).toBeNull();
  });

  it('marks the cheapest day of each month in words as well as with a mark', async () => {
    stubFetch((name) => json(month(name)));

    renderCalendar();

    const cell = await screen.findByRole('gridcell', {
      name: /12 December 2026.*cheapest flight this month/,
    });
    expect(cell.textContent).toContain('▼');
  });

  it('fetches the month after the two on screen before it is paged to', async () => {
    const asked = stubFetch((name) => json(month(name)));

    renderCalendar();
    await waitFor(() => expect(asked).toHaveLength(3));
    expect(new Set(asked)).toEqual(new Set(['2026-11', '2026-12', '2027-01']));

    fireEvent.click(screen.getAllByRole('button', { name: 'Next month' })[0]!);

    // One month further on, and nothing is asked twice.
    await waitFor(() => expect(asked).toHaveLength(4));
    expect(asked).toContain('2027-02');
    expect(new Set(asked).size).toBe(asked.length);
  });

  it('a failing month leaves a usable calendar and says so', async () => {
    stubFetch(() => new Response('{}', { status: 500 }));

    renderCalendar();

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/could not be loaded/);
    expect(screen.queryByLabelText(/loading price/i)).toBeNull();
    // Still a calendar: days are there, with no price on them.
    expect(screen.getByRole('gridcell', { name: /16 November 2026, no price/ })).toBeTruthy();
  });

  it('a priced day links to a search for those exact dates', async () => {
    stubFetch((name) => json(month(name)));

    renderCalendar();
    fireEvent.click(
      await screen.findByRole('gridcell', { name: /12 December 2026, flights only/ }),
    );

    await waitFor(() =>
      expect(screen.getByRole('gridcell', { name: /15 December 2026/ }).getAttribute('href')).toBe(
        '/explore?departureDate=2026-12-12&returnDate=2026-12-15',
      ),
    );
  });

  it('shows a one-way fare as "one way from", never as a return price, and not as a choice', async () => {
    stubFetch((name) => json(month(name)));

    renderCalendar();

    const day = await screen.findByRole('gridcell', {
      name: '5 December 2026, no return fare seen; one way from €28 per person',
    });
    expect(day.tagName).toBe('SPAN');
    expect(day.textContent).toContain('€28');
    expect(day.getAttribute('aria-label')).not.toMatch(/whole trip|flights only|cheapest/);
  });
});
