import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PriceCalendar, type PriceCalendarOption } from './price-calendar';
import { FlexibilityChips } from './flexibility-chips';
import { TimeRangeField } from '@/components/ui/time-range-field';

/**
 * The calendar writes a price in a day, and is honest about the days with none.
 */

const option = (
  departure: string,
  returnDate: string,
  amount: number,
  delta: string | null = null,
): PriceCalendarOption => ({
  key: `${departure}..${returnDate}`,
  departure: departure as PriceCalendarOption['departure'],
  returnDate: returnDate as PriceCalendarOption['returnDate'],
  nights: 5,
  exact: `€${amount}.00`,
  whole: `€${amount}`,
  amount,
  delta,
  href: `/explore?fDates=${departure}..${returnDate}`,
});

const OPTIONS = [
  option('2026-12-10', '2026-12-15', 480),
  option('2026-12-12', '2026-12-17', 300),
  option('2026-12-14', '2026-12-19', 620),
];

// Two returns for the same departure, so a reader can compare a shorter stay
// against a longer one once that day is picked.
const SAME_DEPARTURE = [
  option('2026-12-12', '2026-12-16', 300, null),
  option('2026-12-12', '2026-12-18', 338, '+€38'),
];

function renderCalendar(selected: string | null = null) {
  return render(
    <PriceCalendar
      options={OPTIONS}
      selected={selected}
      cheapestKey="2026-12-12..2026-12-17"
      bestValueKey="2026-12-10..2026-12-15"
      clearHref="/explore"
      chips={[
        { label: '± 3 days', href: '/explore?flexibility=plus-minus-3', active: true },
        { label: 'A weekend', href: '/explore?flexibility=weekend', active: false },
      ]}
    />,
  );
}

describe('PriceCalendar', () => {
  it('writes the whole-trip price in every day that was priced', () => {
    renderCalendar();

    const day = screen.getAllByRole('gridcell', {
      name: /12 December 2026, whole trip €300.00/,
    })[0]!;
    expect(day.textContent).toContain('€300');
  });

  it('shows a day nobody priced as unpriced, and does not let it be chosen', () => {
    renderCalendar();

    const unpriced = screen.getAllByRole('gridcell', { name: /11 December 2026, no price/ })[0]!;

    // A span, not a button: unanswered is not cheap, and there is nothing to pick.
    expect(unpriced.tagName).toBe('SPAN');
    expect(unpriced.textContent).not.toMatch(/€/);
  });

  it('marks the cheapest and the best-value dates in words as well as shading', () => {
    renderCalendar();

    expect(
      screen.getAllByRole('gridcell', { name: /12 December 2026.*cheapest/ }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('gridcell', { name: /10 December 2026.*best value/ }).length,
    ).toBeGreaterThan(0);
  });

  it('is two steps: leave first, then a return that is a link to those dates', () => {
    renderCalendar();

    expect(screen.getByText('Choose the day you leave')).toBeTruthy();

    // Choosing the day to leave is a choice made on the page...
    fireEvent.click(screen.getAllByRole('gridcell', { name: /10 December 2026/ })[0]!);
    expect(screen.getByText(/now choose the day you come back/)).toBeTruthy();

    // ...and the day to come back is the link that narrows the results.
    const back = screen.getAllByRole('gridcell', {
      name: /15 December 2026/,
    })[0] as HTMLAnchorElement;
    expect(back.tagName).toBe('A');
    expect(back.getAttribute('href')).toBe('/explore?fDates=2026-12-10..2026-12-15');
  });

  it('shows what a different return costs against the cheapest for that departure', () => {
    render(
      <PriceCalendar
        options={SAME_DEPARTURE}
        selected={null}
        cheapestKey="2026-12-12..2026-12-16"
        bestValueKey={null}
        clearHref={null}
        chips={[]}
      />,
    );

    fireEvent.click(screen.getAllByRole('gridcell', { name: /12 December 2026/ })[0]!);

    // The cheaper return carries no delta - it is the thing everything else
    // is read against, not a saving over itself.
    expect(
      screen.getAllByRole('gridcell', { name: /16 December 2026, whole trip €300.00/ })[0]!
        .textContent,
    ).not.toContain('+€');

    const dearer = screen.getAllByRole('gridcell', {
      name: /18 December 2026, whole trip €338.00, 5 nights, \+€38 against the cheapest return/,
    })[0]!;
    expect(dearer.textContent).toContain('+€38');
  });

  it('shows a flights-only day apart from the trips, and links it to a search of those dates', () => {
    render(
      <PriceCalendar
        options={[
          ...OPTIONS,
          {
            ...option('2026-12-20', '2026-12-25', 150),
            kind: 'flight',
            key: 'flight:2026-12-20..2026-12-25',
            href: '/explore?flexibility=exact&departureDate=2026-12-20&returnDate=2026-12-25',
          },
        ]}
        selected={null}
        cheapestKey="2026-12-12..2026-12-17"
        bestValueKey={null}
        clearHref={null}
        chips={[]}
      />,
    );

    const day = screen.getAllByRole('gridcell', { name: /20 December 2026.*flights only/ })[0]!;
    expect(day.textContent).toContain('✈');
    expect(day.className).toContain('border-dashed');
    // Not the cheapest, however cheap: it is the flights alone.
    expect(day.getAttribute('aria-label') ?? day.textContent).not.toMatch(/cheapest/);

    fireEvent.click(day);
    const back = screen.getAllByRole('gridcell', {
      name: /25 December 2026/,
    })[0] as HTMLAnchorElement;
    expect(back.getAttribute('href')).toContain('flexibility=exact');
  });

  it('prefers a whole trip to a flight alone on the same day', () => {
    render(
      <PriceCalendar
        options={[
          option('2026-12-12', '2026-12-17', 300),
          { ...option('2026-12-12', '2026-12-16', 100), kind: 'flight', key: 'flight:x' },
        ]}
        selected={null}
        cheapestKey={null}
        bestValueKey={null}
        clearHref={null}
        chips={[]}
      />,
    );

    const day = screen.getAllByRole('gridcell', { name: /12 December 2026/ })[0]!;
    expect(day.textContent).toContain('€300');
    expect(day.textContent).not.toContain('✈');
  });

  it('offers each flexibility as a link, and says which is on', () => {
    renderCalendar();

    const group = screen.getByRole('group', { name: 'How flexible are your dates' });

    expect(within(group).getByRole('link', { name: '± 3 days' }).getAttribute('aria-current')).toBe(
      'true',
    );
    expect(within(group).getByRole('link', { name: 'A weekend' }).getAttribute('href')).toContain(
      'flexibility=weekend',
    );
  });
});

describe('FlexibilityChips', () => {
  it('is one choice of real radio buttons, with the given one checked', () => {
    render(<FlexibilityChips name="flexibility" defaultValue="weekend" />);

    expect((screen.getByRole('radio', { name: 'A weekend' }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole('radio', { name: '± 3 days' }) as HTMLInputElement).checked).toBe(
      false,
    );
    // Every preset the search understands, plus the typed window.
    expect(screen.getAllByRole('radio')).toHaveLength(8);
  });
});

describe('TimeRangeField', () => {
  it('says which flight it is and where it leaves from', () => {
    render(
      <TimeRangeField label="Return flight" place="the destination" nameFrom="a" nameTo="b" />,
    );

    const group = screen.getByRole('group', { name: /Return flight/ });
    expect(group.textContent).toContain('leaves the destination');
  });

  it('submits nothing for a range that is the whole day', () => {
    const { container } = render(
      <form>
        <TimeRangeField label="Outbound flight" place="VIE" nameFrom="from" nameTo="to" />
      </form>,
    );

    expect((container.querySelector('input[name="from"]') as HTMLInputElement).value).toBe('');
    expect((container.querySelector('input[name="to"]') as HTMLInputElement).value).toBe('');
  });

  it('submits the hours it was given', () => {
    const { container } = render(
      <form>
        <TimeRangeField
          label="Outbound flight"
          place="VIE"
          nameFrom="from"
          nameTo="to"
          defaultFrom={6}
          defaultTo={14}
        />
      </form>,
    );

    expect((container.querySelector('input[name="from"]') as HTMLInputElement).value).toBe('6');
    expect((container.querySelector('input[name="to"]') as HTMLInputElement).value).toBe('14');
  });

  it('turns a part of the day into one tap', () => {
    const { container } = render(
      <form>
        <TimeRangeField label="Outbound flight" place="VIE" nameFrom="from" nameTo="to" />
      </form>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Evening only' }));

    expect((container.querySelector('input[name="from"]') as HTMLInputElement).value).toBe('18');
    expect((container.querySelector('input[name="to"]') as HTMLInputElement).value).toBe('');
  });
});
