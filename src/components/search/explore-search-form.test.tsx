import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { listAirports } from '@/search/destination-names';
import { CompactSearch } from '@/components/discovery/compact-search';
import { ExploreSearchForm } from './explore-search-form';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

/**
 * The explorer's search against Discover's.
 *
 * What is defended: the two forms are built from the same fields, so every
 * control Discover offers for the search itself is on the explorer's form under
 * the same role and name, and the same choices submit the same parameters.
 */

const TODAY = '2026-09-20';
const VALUES = {
  origins: 'VIE',
  destinations: 'AYT',
  departureDate: '2026-10-04',
  returnDate: '2026-10-11',
  passengers: '2',
  flexibility: 'plus-minus-3',
};

function renderDiscover() {
  return render(
    <CompactSearch
      values={VALUES}
      destinationsDefault="anywhere"
      destinationsHint="Anywhere we can price, or type airport codes."
      airports={listAirports()}
      today={TODAY}
    />,
  );
}

function renderExplore(extra: Record<string, string> = {}) {
  const values = { ...VALUES, ...extra };
  return render(
    <ExploreSearchForm
      label="Change this search"
      values={values}
      submitted={values}
      airports={listAirports()}
      today={TODAY}
      airportCodes={listAirports().map((airport) => airport.code)}
      defaults={{}}
    />,
  );
}

function submission(form: HTMLFormElement): Record<string, string> {
  const sent: Record<string, string> = {};
  for (const element of Array.from(form.elements)) {
    const control = element as HTMLInputElement | HTMLSelectElement;
    if (!control.name) continue;
    if (
      control instanceof HTMLInputElement &&
      (control.type === 'checkbox' || control.type === 'radio') &&
      !control.checked
    ) {
      continue;
    }
    sent[control.name] = control.value;
  }
  return sent;
}

const FIELD_LABELS = ['From', 'To', 'Leaving', 'Back', 'Travellers'];

describe('the explorer form', () => {
  it('exposes every search control Discover does, by role and name', async () => {
    for (const render_ of [renderDiscover, renderExplore]) {
      const { unmount } = render_();

      for (const label of FIELD_LABELS) {
        expect(screen.getByLabelText(new RegExp(`^${label}\\b`))).toBeInTheDocument();
      }
      expect(screen.getByRole('button', { name: 'Anywhere' })).toBeInTheDocument();
      expect(screen.getByText('Regions')).toBeInTheDocument();
      expect(screen.getByRole('spinbutton', { name: /Travellers/ })).toBeInTheDocument();

      // The date options are in the calendar, every one of them.
      await userEvent.click(
        screen.getByRole('button', { name: /Choose leaving and back from a calendar/ }),
      );
      const group = screen.getByRole('radiogroup', { name: 'How flexible are the dates' });
      for (const name of [
        'This month',
        'Exact dates',
        '± 1 day',
        '± 3 days',
        '± 7 days',
        'A weekend',
        'A long weekend',
        'Anytime that month',
      ]) {
        expect(within(group).getByRole('radio', { name })).toBeInTheDocument();
      }

      // The month is chosen in the calendar itself, so there is no separate Month select.
      const flexGroup = screen.getByRole('radiogroup', { name: 'How flexible are the dates' });
      const calendarGroup = screen.getByRole('group', { name: 'Trip length' }).parentElement!;
      expect(screen.queryByLabelText('Month', { selector: 'select' })).toBeNull();
      expect(calendarGroup).toContainElement(flexGroup);
      expect(calendarGroup).toContainElement(screen.getByRole('group', { name: 'Trip length' }));
      expect(screen.getAllByLabelText('Trip length').length).toBeGreaterThan(0);
      // The trip length is chosen in the calendar, beside the days, and Not set is checked by default.
      const length = screen.getByRole('group', { name: 'Trip length' });
      for (const name of ['Not set', 'Under X days', 'Over X days']) {
        const choice = within(length).getByRole('radio', { name: new RegExp(name) });
        expect(choice).toBeInTheDocument();
        if (name === 'Not set') expect(choice).toBeChecked();
        else expect(choice).not.toBeChecked();
      }
      expect(screen.getByLabelText(/Number of days/)).toHaveValue(null);
      unmount();
    }
  }, 30_000);

  it('says Anywhere in an empty To, and an empty To is not refused', () => {
    const { container } = render(
      <ExploreSearchForm
        label="Start a search"
        values={{}}
        submitted={{}}
        airports={listAirports()}
        today={TODAY}
        airportCodes={[]}
        defaults={{ origins: 'VIE', departureDate: '2026-10-04', returnDate: '2026-10-11' }}
      />,
    );
    const to = screen.getByLabelText(/^To\b/);
    expect(to).toHaveAttribute('placeholder', 'Anywhere');
    expect(to).toHaveValue('');
    expect(to).not.toBeRequired();
    expect(container.querySelector('form')).toBeTruthy();
  });

  it('has a Search button that is disabled, with the reason in words, while From is empty', () => {
    render(
      <ExploreSearchForm
        label="Start a search"
        values={{}}
        submitted={{}}
        airports={listAirports()}
        today={TODAY}
        airportCodes={[]}
        defaults={{ origins: '', departureDate: '2026-10-04', returnDate: '2026-10-11' }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    expect(screen.getByText('Add a departure airport')).toBeInTheDocument();
  });

  it('submits the same parameters as Discover for the same choices', async () => {
    const discover = renderDiscover();
    const discoverForm = discover.container.querySelector('form')!;
    // The same choices on each: a month search of five nights, at most four days.
    await userEvent.click(
      screen.getByRole('button', { name: /Choose leaving and back from a calendar/ }),
    );
    await userEvent.click(screen.getByRole('radio', { name: /Under X days/ }));
    await userEvent.click(screen.getByRole('radio', { name: 'Anytime that month' }));
    await userEvent.selectOptions(
      screen.getByLabelText('Trip length', { selector: 'select' }),
      '5',
    );
    const sentByDiscover = submission(discoverForm);
    discover.unmount();

    const explore = renderExplore();
    const exploreForm = explore.container.querySelector('form')!;
    await userEvent.click(
      screen.getByRole('button', { name: /Choose leaving and back from a calendar/ }),
    );
    await userEvent.click(screen.getByRole('radio', { name: /Under X days/ }));
    await userEvent.click(screen.getByRole('radio', { name: 'Anytime that month' }));
    await userEvent.selectOptions(
      screen.getByLabelText('Trip length', { selector: 'select' }),
      '5',
    );
    const sentByExplore = submission(exploreForm);

    // Every parameter the explorer sends is one Discover sends, with the same value.
    for (const [name, value] of Object.entries(sentByExplore)) {
      expect(sentByDiscover[name], name).toBe(value);
    }
    // And the fields of the search itself are all there.
    for (const name of [
      'origins',
      'destinations',
      'departureDate',
      'returnDate',
      'passengers',
      'flexibility',
      'monthStart',
      'tripNights',
      'tripLength',
      'tripDays',
    ]) {
      expect(sentByExplore, name).toHaveProperty(name);
    }
    expect(sentByExplore.flexibility).toBe('month');
    expect(sentByExplore.tripNights).toBe('5');
    expect(sentByExplore.tripLength).toBe('under');
  }, 30_000);

  it('turns the calendar into month tiles for Anytime that month, and a tile sets monthStart', async () => {
    const { container } = renderExplore();
    const form = container.querySelector('form')!;
    await userEvent.click(
      screen.getByRole('button', { name: /Choose leaving and back from a calendar/ }),
    );
    expect(screen.queryByRole('group', { name: 'Month' })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Anytime that month' }));

    const tiles = screen.getByRole('group', { name: 'Month' });
    expect(within(tiles).getAllByRole('button')).toHaveLength(12);
    // The days are gone while the calendar is a month picker.
    expect(screen.queryByRole('grid')).toBeNull();

    const tile = within(tiles).getByRole('button', { name: /^December 2026/ });
    await userEvent.click(tile);
    expect(submission(form).flexibility).toBe('month');
    expect(submission(form).monthStart).toBe('2026-12-01');
  }, 30_000);

  it('announces the picked day in words, as the departure and then the return', async () => {
    renderExplore();
    await userEvent.click(
      screen.getByRole('button', { name: /Choose leaving and back from a calendar/ }),
    );
    const days = screen.getAllByRole('gridcell').filter((cell) => !cell.hasAttribute('disabled'));
    await userEvent.click(days[5]!);
    expect(
      screen.getByRole('gridcell', { name: /, your departure, selected$/ }),
    ).toBeInTheDocument();
    await userEvent.click(days[8]!);
    expect(screen.queryByRole('gridcell', { name: /, your departure, selected$/ })).toBeNull();
  }, 30_000);
});
