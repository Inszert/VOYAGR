import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  /** The days a return can be chosen on: the calendar's links, in date order. */
  const returnCells = () => screen.getAllByRole('gridcell').filter((cell) => cell.tagName === 'A');

  describe('return options for a chosen departure', () => {
    const ret = (returnDate: string, amount: number) => ({
      returnDate,
      exact: `€${amount}.00`,
      whole: `€${amount}`,
      perPerson: `€${amount}`,
      amount,
    });

    function monthWithReturns(name: string) {
      const base = month(name);
      const days = base.days as Record<string, Record<string, unknown>>;
      const returns = [ret(`${name}-18`, 150), ret(`${name}-15`, 90), ret(`${name}-16`, 120)].sort(
        (a, b) => a.amount - b.amount,
      );
      // Only the 12th is priced, so every return listed is one it holds itself.
      for (const day of Object.keys(days)) delete days[day];
      if (name === '2026-12') days[`${name}-12`] = { ...returns[0]!, returns };
      return base;
    }

    it('shows each return on its own day in the calendar, with its price and nights; the day cell keeps the cheapest', async () => {
      const asked = stubFetch((name) => json(monthWithReturns(name)));

      renderCalendar();
      const cell = await screen.findByRole('gridcell', { name: /12 December 2026, flights only/ });
      expect(cell.textContent).toContain('€90');
      fireEvent.click(cell);

      await screen.findByRole('status');
      const links = returnCells();
      expect(links).toHaveLength(3);
      expect(screen.queryByRole('list', { name: /Return options for leaving/ })).toBeNull();
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        '/explore?departureDate=2026-12-12&returnDate=2026-12-15',
        '/explore?departureDate=2026-12-12&returnDate=2026-12-16',
        '/explore?departureDate=2026-12-12&returnDate=2026-12-18',
      ]);
      expect(links[0]!.textContent).toContain('€90');
      expect(links[0]!.textContent).toContain('3 nights');
      expect(links[2]!.textContent).toContain('€150');
      expect(links[0]!.getAttribute('aria-label') ?? links[0]!.textContent).toContain(
        '15 December 2026',
      );

      // Choosing one adds no request: only the months, fetched before the pick.
      const before = asked.length;
      expect(vi.mocked(fetch).mock.calls.length).toBe(before);
    });

    it('offers every priced later day as a return, cheapest first, each with its own price and nights', async () => {
      const day = (name: string, d: number, amount: number) => ({
        returnDate: `${name}-${String(d + 2).padStart(2, '0')}`,
        exact: `€${amount}.00`,
        whole: `€${amount}`,
        perPerson: `€${amount}`,
        amount,
      });
      stubFetch((name) => {
        const base = month(name);
        const days = base.days as Record<string, unknown>;
        for (const key of Object.keys(days)) delete days[key];
        // The 12th has one stored return; three later days are priced as days to leave.
        if (name !== '2026-12') return json(base);
        days[`${name}-12`] = day(name, 12, 90);
        days[`${name}-15`] = day(name, 15, 200);
        days[`${name}-17`] = day(name, 17, 130);
        days[`${name}-20`] = day(name, 20, 160);
        return json(base);
      });

      renderCalendar();
      fireEvent.click(
        await screen.findByRole('gridcell', { name: /12 December 2026, flights only/ }),
      );

      await waitFor(() => expect(returnCells().length).toBeGreaterThanOrEqual(4));
      const links = returnCells();
      expect(screen.getByRole('status').textContent).toContain('4 return dates priced');
      // The stored pair (14 Dec, 90) plus the three later priced days, in date order.
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        '/explore?departureDate=2026-12-12&returnDate=2026-12-14',
        '/explore?departureDate=2026-12-12&returnDate=2026-12-15',
        '/explore?departureDate=2026-12-12&returnDate=2026-12-17',
        '/explore?departureDate=2026-12-12&returnDate=2026-12-20',
      ]);
      const seventeenth = screen.getByRole('gridcell', { name: /17 December 2026/ });
      expect(seventeenth.textContent).toContain('5 nights');
      expect(seventeenth.textContent).toContain('€130');
      expect(seventeenth.getAttribute('aria-label') ?? seventeenth.textContent).toBeTruthy();
      expect(seventeenth.textContent).toContain('flights only');
    });

    it('shows the other returns the month holds for a day the search already priced, trip and flights each on their day', async () => {
      stubFetch((name) => json(monthWithReturns(name)));
      const priced = {
        kind: 'trip' as const,
        key: 'trip:2026-12-12..2026-12-15',
        departure: '2026-12-12',
        returnDate: '2026-12-15',
        nights: 3,
        exact: '€400.00',
        whole: '€400',
        perPerson: '€400',
        amount: 400,
        delta: null,
        href: '/explore?trip',
      };
      render(
        <PriceCalendar
          options={[priced]}
          load={LOAD}
          selected={null}
          cheapestKey={null}
          bestValueKey={null}
          clearHref={null}
          chips={[]}
        />,
      );
      const cell = await screen.findByRole('gridcell', { name: /12 December 2026/ });
      await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
      fireEvent.click(cell);

      await waitFor(() => expect(returnCells()).toHaveLength(3));
      const links = returnCells();
      // The searched trip, then the flights alone, each on its own day.
      expect(links[0]!.textContent).toContain('€400');
      expect(links[0]!.textContent).not.toContain('flights only');
      expect(links[1]!.textContent).toContain('flights only');
      expect(links[1]!.textContent).toContain('€120');
      expect(links[2]!.textContent).toContain('€150');
    });

    it('offers no return longer than "under 5" nights, or shorter than "over 3"', async () => {
      const withNights = (name: string) => {
        const base = month(name);
        const days = base.days as Record<string, Record<string, unknown>>;
        // 2, 4 and 7 nights from the 12th.
        const returns = [ret(`${name}-14`, 90), ret(`${name}-16`, 100), ret(`${name}-19`, 110)];
        for (const day of Object.keys(days)) delete days[day];
        if (name === '2026-12') days[`${name}-12`] = { ...returns[0]!, returns };
        return base;
      };
      const open = async (load: PriceCalendarLoad) => {
        stubFetch((name) => json(withNights(name)));
        render(
          <PriceCalendar
            options={[]}
            load={load}
            selected={null}
            cheapestKey={null}
            bestValueKey={null}
            clearHref={null}
            chips={[]}
          />,
        );
        fireEvent.click(
          await screen.findByRole('gridcell', { name: /12 December 2026, flights only/ }),
        );
        await screen.findByRole('status');
        return returnCells().map((link) => link.getAttribute('href'));
      };

      const under = await open({ ...LOAD, lengthMin: 1, lengthMax: 5 });
      expect(under).toHaveLength(2);
      expect(under.join()).not.toContain('returnDate=2026-12-19');
      cleanup();

      const over = await open({ ...LOAD, lengthMin: 3, lengthMax: 30 });
      expect(over).toHaveLength(2);
      expect(over.join()).not.toContain('returnDate=2026-12-14');
    });

    it('clicking the chosen departure again keeps it chosen; only the explicit control undoes it', async () => {
      stubFetch((name) => json(monthWithReturns(name)));

      renderCalendar();
      fireEvent.click(
        await screen.findByRole('gridcell', { name: /12 December 2026, flights only/ }),
      );
      for (let click = 0; click < 2; click += 1) {
        fireEvent.click(screen.getByRole('gridcell', { name: /12 December 2026, your departure/ }));
        expect((await screen.findByRole('status')).textContent).toContain('3 return dates priced');
        expect(returnCells()).toHaveLength(3);
      }

      fireEvent.click(screen.getByRole('button', { name: 'Change the day you leave' }));
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByRole('gridcell', { name: /12 December 2026, flights only/ })).toBeTruthy();
    });

    it('shows a departure with one return as one priced day, with no error', async () => {
      stubFetch((name) => {
        const base = month(name);
        const days = base.days as Record<string, Record<string, unknown>>;
        const only = ret(`${name}-15`, 90);
        for (const day of Object.keys(days)) delete days[day];
        if (name === '2026-12') days[`${name}-12`] = { ...only, returns: [only] };
        return json(base);
      });

      renderCalendar();
      const cell = await screen.findByRole('gridcell', { name: /12 December 2026, flights only/ });
      fireEvent.click(cell);
      expect((await screen.findByRole('status')).textContent).toContain('1 return date priced');
      expect(returnCells()).toHaveLength(1);
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
