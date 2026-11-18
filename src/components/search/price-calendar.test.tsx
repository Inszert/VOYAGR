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
  // The fixtures are for two travellers.
  perPerson: `€${amount / 2}`,
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
      travellers={2}
      chips={[
        { label: '± 3 days', href: '/explore?flexibility=plus-minus-3', active: true },
        { label: 'A weekend', href: '/explore?flexibility=weekend', active: false },
      ]}
    />,
  );
}

describe('PriceCalendar', () => {
  it('writes the whole-trip price per person in every day, and the party total in its name', () => {
    renderCalendar();

    const day = screen.getAllByRole('gridcell', {
      name: /12 December 2026, whole trip €150 per person, €300.00 for 2 travellers/,
    })[0]!;
    const visible = [...day.querySelectorAll('[aria-hidden="true"]')]
      .map((part) => part.textContent)
      .join(' ');
    expect(visible).toContain('€150');
    expect(visible).not.toContain('€300');
    // The basis is said once, in the legend.
    expect(screen.getByText('Prices per person, for 2 travellers')).toBeTruthy();
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
        travellers={2}
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
      screen.getAllByRole('gridcell', {
        name: /16 December 2026, whole trip €150 per person, €300.00 for 2 travellers/,
      })[0]!.textContent,
    ).not.toContain('+€');

    const dearer = screen.getAllByRole('gridcell', {
      name: /18 December 2026, whole trip €169 per person, €338.00 for 2 travellers, 5 nights, \+€38 against the cheapest return/,
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
    expect(day.textContent).toContain('€150');
    expect(day.textContent).not.toContain('✈');
  });

  it('moves by day, week and month from the keyboard, with one tab stop', () => {
    renderCalendar();

    const cell = (day: string) =>
      document.querySelector<HTMLElement>(`[role="gridcell"][data-day="${day}"]`)!;

    // One day in the whole grid is where Tab lands; the rest are reached by arrows.
    expect(document.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);

    cell('2026-12-10').focus();
    fireEvent.keyDown(cell('2026-12-10'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cell('2026-12-11'));

    fireEvent.keyDown(cell('2026-12-11'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cell('2026-12-18'));

    // Monday to Sunday of that week: 2026-12-18 is a Friday.
    fireEvent.keyDown(cell('2026-12-18'), { key: 'Home' });
    expect(document.activeElement).toBe(cell('2026-12-14'));
    fireEvent.keyDown(cell('2026-12-14'), { key: 'End' });
    expect(document.activeElement).toBe(cell('2026-12-20'));

    fireEvent.keyDown(cell('2026-12-20'), { key: 'PageDown' });
    expect(document.activeElement).toBe(cell('2027-01-20'));
  });

  it('shows the dates as words, and folds the calendar behind a button on a phone', () => {
    render(
      <PriceCalendar
        options={OPTIONS}
        selected="2026-12-10..2026-12-15"
        cheapestKey={null}
        bestValueKey={null}
        clearHref="/explore"
        chips={[]}
        travellers={2}
      />,
    );

    expect(screen.getByText('Thu 10 Dec')).toBeTruthy();
    expect(screen.getByText(/Tue 15 Dec/)).toBeTruthy();

    const toggle = screen.getByRole('button', { name: 'Change dates' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(
      screen.getByRole('button', { name: 'Hide the calendar' }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('says in words which day is the departure and which the return', () => {
    renderCalendar('2026-12-10..2026-12-15');

    expect(
      screen.getAllByRole('gridcell', { name: /10 December 2026.*your departure/ }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('gridcell', { name: /15 December 2026, whole trip.*your return/ }).length,
    ).toBeGreaterThan(0);
  });

  it('offers each flexibility as a link, and says which is on', () => {
    renderCalendar();

    const group = screen.getByRole('group', { name: 'Date options' });

    expect(
      within(group)
        .getByRole('link', { name: /± 3 days/ })
        .getAttribute('aria-current'),
    ).toBe('true');
    expect(within(group).getByRole('link', { name: 'A weekend' }).getAttribute('href')).toContain(
      'flexibility=weekend',
    );
  });
});

describe('PriceCalendar date options', () => {
  it('draws each option once, inside the calendar, when shortcuts and presets overlap', () => {
    render(
      <PriceCalendar
        options={OPTIONS}
        selected={null}
        cheapestKey={null}
        bestValueKey={null}
        clearHref={null}
        shortcuts={[
          { label: 'This month', href: '/explore?flexibility=month', active: false },
          { label: '± 3 days', href: '/explore?flexibility=plus-minus-3', active: true },
        ]}
        chips={[
          { label: '± 3 days', href: '/explore?flexibility=plus-minus-3', active: true },
          { label: 'A weekend', href: '/explore?flexibility=weekend', active: false },
          { label: 'Anytime that month', href: '/explore?flexibility=month', active: false },
        ]}
      />,
    );

    const calendar = screen.getByRole('group', { name: 'Calendar' });
    const options = within(calendar).getByRole('group', { name: 'Date options' });
    for (const name of ['This month', '± 3 days', 'A weekend', 'Anytime that month']) {
      expect(within(calendar).getAllByRole('link', { name: new RegExp(`^${name}`) })).toHaveLength(
        1,
      );
      expect(
        options.contains(within(calendar).getByRole('link', { name: new RegExp(`^${name}`) })),
      ).toBe(true);
    }
    expect(screen.queryByRole('group', { name: 'How flexible are your dates' })).toBeNull();
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
    expect(screen.getAllByRole('radio')).toHaveLength(9);
  });

  it('lists every option once, in the one row, with no More control', () => {
    const { container } = render(<FlexibilityChips name="flexibility" />);

    expect(container.querySelectorAll('details, summary')).toHaveLength(0);
    const names = screen.getAllByRole('radio').map((radio) => radio.closest('label')!.textContent);
    expect(names).toEqual([
      'This month',
      'Exact dates',
      '± 1 day',
      '± 3 days',
      '± 7 days',
      'A weekend',
      'A long weekend',
      'Anytime that month',
      'Exact window',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('submits the same values the explore shortcuts set', () => {
    const { container } = render(
      <form>
        <FlexibilityChips name="flexibility" today="2026-11-18" />
        <select name="monthStart" defaultValue="2026-12-01">
          <option value="2026-11-18">November</option>
          <option value="2026-12-01">December</option>
        </select>
      </form>,
    );
    const form = container.querySelector('form')!;
    const value = () => new FormData(form).get('flexibility');
    const month = () => new FormData(form).get('monthStart');

    fireEvent.click(screen.getByRole('radio', { name: 'A long weekend' }));
    expect(value()).toBe('long-weekend');
    fireEvent.click(screen.getByRole('radio', { name: '± 7 days' }));
    expect(value()).toBe('plus-minus-7');
    fireEvent.click(screen.getByRole('radio', { name: 'Anytime that month' }));
    expect(value()).toBe('month');
    expect(month()).toBe('2026-12-01');
    fireEvent.click(screen.getByRole('radio', { name: 'This month' }));
    expect(value()).toBe('month');
    expect(month()).toBe('2026-11-18');
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

describe('PriceCalendar date shortcuts', () => {
  const shortcuts = [
    {
      label: 'This month',
      href: '/explore?flexibility=month&monthStart=2026-11-01',
      active: false,
    },
    { label: '± 3 days', href: '/explore?flexibility=plus-minus-3', active: true },
    { label: '± 7 days', href: '/explore?flexibility=plus-minus-7', active: false },
    { label: 'Any date', href: '/explore?flexibility=month&monthStart=2026-12-01', active: false },
  ];

  function renderWithShortcuts() {
    return render(
      <PriceCalendar
        options={OPTIONS}
        selected={null}
        cheapestKey={null}
        bestValueKey={null}
        clearHref={null}
        chips={[]}
        shortcuts={shortcuts}
      />,
    );
  }

  it('shows the four shortcuts without opening anything', () => {
    renderWithShortcuts();

    const group = screen.getByRole('group', { name: 'Date options' });
    for (const name of ['This month', '± 3 days', '± 7 days', 'Any date']) {
      expect(within(group).getByRole('link', { name: new RegExp(`^${name}`) })).toBeTruthy();
    }
    // Not behind the "Change dates" button, which is still closed.
    expect(screen.getByRole('button', { name: /Change dates/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('sets the same flexibility value the existing control sets', () => {
    renderWithShortcuts();

    const group = screen.getByRole('group', { name: 'Date options' });
    const href = within(group)
      .getByRole('link', { name: /^± 3 days/ })
      .getAttribute('href')!;
    expect(new URL(href, 'https://x.test').searchParams.get('flexibility')).toBe('plus-minus-3');

    // The value the form's own radio for the same choice submits.
    const { unmount } = render(<FlexibilityChips name="flexibility" />);
    expect((screen.getByRole('radio', { name: '± 3 days' }) as HTMLInputElement).value).toBe(
      'plus-minus-3',
    );
    unmount();
  });

  it('says which one is on, in words and by a mark', () => {
    renderWithShortcuts();

    const group = screen.getByRole('group', { name: 'Date options' });
    const active = within(group).getByRole('link', { name: /^± 3 days\s*\(selected\)/ });
    expect(active.getAttribute('aria-current')).toBe('true');
    expect(active.textContent).toContain('✓');
    expect(screen.getByText(/showing ± 3 days/)).toBeTruthy();
  });
});
