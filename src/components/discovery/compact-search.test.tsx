import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { listAirports } from '@/search/destination-names';
import { parseSearchForm } from '@/search/schema';
import { CompactSearch } from './compact-search';

/**
 * The compact search.
 *
 * What is defended: a compact submit is a complete search. Every field the
 * schema needs is in the form, labelled, whether it is in the open or behind
 * "More options" - so what the form would submit parses without a single
 * defaulted field the user could not see.
 */

const TODAY_DEFAULTS = {
  departureDate: '2026-10-04',
  returnDate: '2026-10-11',
  earliestDeparture: '2026-09-27',
  latestReturn: '2026-11-26',
  flexibility: 'plus-minus-3',
};

function renderForm(props: Partial<React.ComponentProps<typeof CompactSearch>> = {}) {
  return render(
    <CompactSearch
      values={{}}
      defaults={TODAY_DEFAULTS}
      destinationsDefault="AYT, CHQ, LCA"
      destinationsHint="Everywhere we can price."
      airports={listAirports()}
      today="2026-09-20"
      {...props}
    />,
  );
}

/** What the browser would send: every named control's current value. */
function submission(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {};

  for (const element of Array.from(form.elements)) {
    const control = element as HTMLInputElement | HTMLSelectElement;
    if (!control.name) continue;
    // A browser sends a checkbox or a radio only when it is checked.
    if (
      control instanceof HTMLInputElement &&
      (control.type === 'checkbox' || control.type === 'radio') &&
      !control.checked
    ) {
      continue;
    }
    values[control.name] = control.value;
  }

  return values;
}

describe('CompactSearch date options', () => {
  const OPTIONS = [
    'This month',
    'Exact dates',
    '± 1 day',
    '± 3 days',
    '± 7 days',
    'A weekend',
    'A long weekend',
    'Anytime that month',
  ];

  for (const variant of ['panel', 'bar'] as const) {
    it(`${variant}: shows each option once, inside the calendar, and submits the same value`, async () => {
      const { container } = renderForm({ variant });
      expect(screen.queryByRole('radio', { name: '± 7 days' })).toBeNull();

      await userEvent.click(
        screen.getByRole('button', { name: /Choose leaving and back from a calendar/ }),
      );
      const group = screen.getByRole('radiogroup', { name: 'How flexible are the dates' });
      for (const name of OPTIONS) {
        expect(within(group).getAllByRole('radio', { name })).toHaveLength(1);
        expect(screen.getAllByRole('radio', { name })).toHaveLength(1);
      }

      const form = container.querySelector('form')!;
      expect(submission(form).flexibility).toBe('plus-minus-3');
      await userEvent.click(within(group).getByRole('radio', { name: 'A long weekend' }));
      expect(submission(form).flexibility).toBe('long-weekend');
      await userEvent.click(within(group).getByRole('radio', { name: 'Anytime that month' }));
      expect(submission(form).flexibility).toBe('month');
    }, 20_000);
  }
});

describe('CompactSearch month mode', () => {
  for (const variant of ['panel', 'bar'] as const) {
    it(`${variant}: keeps "Choose exact dates" visible and it returns to the calendar`, async () => {
      const { container } = renderForm({
        variant,
        defaults: { ...TODAY_DEFAULTS, flexibility: 'month' },
      });
      const form = container.querySelector('form')!;
      expect(submission(form).flexibility).toBe('month');
      expect(screen.queryByRole('button', { name: /Choose leaving and back/ })).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Choose exact dates' }));

      // Same value the "Exact dates" chip submits.
      expect(submission(form).flexibility).toBe('exact');
      expect(screen.queryByRole('button', { name: 'Choose exact dates' })).toBeNull();
      await userEvent.click(
        screen.getByRole('button', { name: /Choose leaving and back from a calendar/ }),
      );
      const group = screen.getByRole('radiogroup', { name: 'How flexible are the dates' });
      expect(within(group).getByRole('radio', { name: 'Exact dates' })).toBeChecked();
    }, 20_000);
  }
});

describe('CompactSearch', () => {
  it('puts the month and trip length where the dates are, not in the folded options', () => {
    const { container } = renderForm({ variant: 'bar' });
    const month = container.querySelector<HTMLInputElement>('input[name="monthStart"]')!;
    const nights = container.querySelector<HTMLSelectElement>('select[name="tripNights"]')!;
    const leaving = container.querySelector<HTMLInputElement>('input[name="departureDate"]')!;
    // One field each, so the form submits one month and one length.
    expect(container.querySelectorAll('[name="monthStart"]')).toHaveLength(1);
    // The month is chosen in the calendar, so there is no month select in the bar.
    expect(container.querySelector('select[name="monthStart"]')).toBeNull();
    // Not in the options panel that stays shut until it is opened.
    expect(month.closest('.border-b')).toBeNull();
    expect(nights.closest('.border-b')).toBeNull();
    // Beside the dates, in the same cell.
    expect(month.closest('div.relative, div[class*="cell"]') ?? month.parentElement).toBeTruthy();
    expect(leaving.closest('form')).toBe(month.closest('form'));
  });

  it('starts folded when nothing was refused', () => {
    // On a phone every field - and so every message about one - is behind the
    // toggle. Left folded, a refused search looks like a button that does nothing.
    renderForm({ variant: 'bar' });
    expect(screen.getByRole('checkbox', { name: 'Show every search option' })).not.toBeChecked();
  });

  it('shows the toggle already open when a field was refused', () => {
    renderForm({
      variant: 'bar',
      errors: { origins: 'Use three-letter airport codes, such as VIE.' },
    });
    expect(screen.getByRole('checkbox', { name: 'Show every search option' })).toBeChecked();
  });

  it('labels every visible control', () => {
    renderForm();

    // The bar labels each cell in as few words as a cell has room for.
    for (const label of ['From', 'To', 'Leaving', 'Back', 'Travellers']) {
      expect(screen.getByLabelText(new RegExp(`^${label}\\b`))).toBeInTheDocument();
    }
    // The date options are inside the calendar, not a second list beside the dates.
    expect(screen.queryByRole('radiogroup', { name: /flexible/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Search trips' })).toBeInTheDocument();
  });

  it('submits a complete search, with nothing defaulted out of sight', () => {
    const { container } = renderForm();
    const form = container.querySelector('form')!;

    const parsed = parseSearchForm(submission(form));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.request.destinations).toEqual(['AYT', 'CHQ', 'LCA']);
    expect(parsed.value.request.profile.origins).toEqual(['VIE']);
    // The preset widened the two dates by three days either side.
    expect(parsed.value.request.profile.earliestDeparture).toBe('2026-10-01');
  });

  it('keeps the advanced fields in the form, behind a disclosure', () => {
    renderForm();

    expect(screen.getByText('More options')).toBeInTheDocument();
    // Travel style is a set of radios now, not a dropdown: same field name, same values.
    expect(screen.getByRole('group', { name: 'Travel style' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Target budget/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Earliest departure/)).toBeInTheDocument();
  });

  describe('the More options panel', () => {
    it('is three headed groups with a Done button', () => {
      renderForm();

      for (const heading of ['Dates', 'Trip', 'Price']) {
        expect(screen.getByRole('heading', { name: heading, level: 3 })).toBeInTheDocument();
      }
      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    });

    it('asks each choice as a real, labelled radio or checkbox', () => {
      renderForm();

      for (const group of ['Travel style', 'Optimise for', 'Most stops on a flight']) {
        const radios = within(screen.getByRole('group', { name: group })).getAllByRole('radio');
        expect(radios.length).toBeGreaterThan(1);
        // Exactly one is chosen, so the group always submits something.
        expect(radios.filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(1);
      }

      for (const label of [
        'Direct flights only',
        'Checked baggage must be included',
        'Hotel must be free to cancel',
      ]) {
        expect(screen.getByRole('checkbox', { name: new RegExp(label) })).toBeInTheDocument();
      }
    });

    it('says the chosen option in words, and submits the value it always did', () => {
      const { container } = renderForm({ values: { maxStops: '0' } });

      const direct = screen.getByRole('radio', { name: /Direct only/ });
      expect(direct).toBeChecked();
      // The word is in the row; the stylesheet shows it for the checked one.
      expect(direct.closest('label')).toHaveTextContent('Selected');
      expect(submission(container.querySelector('form')!)).toMatchObject({ maxStops: '0' });
    });
  });

  describe('trip length', () => {
    const request = (form: HTMLFormElement) => {
      const parsed = parseSearchForm(submission(form));
      if (!parsed.ok) throw new Error('the search did not parse');
      return parsed.value.request.profile;
    };

    const openCalendar = () =>
      userEvent.click(
        screen.getByRole('button', { name: /Choose leaving and back from a calendar/ }),
      );

    it('offers Not set, Under X days and Over X days in the calendar, none chosen, with a labelled number field', async () => {
      renderForm();
      await openCalendar();
      const group = screen.getByRole('group', { name: 'Trip length' });
      for (const name of ['Not set', 'Under X days', 'Over X days']) {
        const choice = within(group).getByRole('radio', { name: new RegExp(name) });
        expect(choice).toBeInTheDocument();
        expect(choice).not.toBeChecked();
      }
      const days = screen.getByLabelText(/Number of days/);
      expect(days).toHaveAttribute('min', '1');
      expect(days).toHaveAttribute('max', '30');
    });

    it('Under 5 chosen in the calendar submits a maximum of 5 nights', async () => {
      const { container } = renderForm();
      await openCalendar();
      await userEvent.click(screen.getByRole('radio', { name: /Under X days/ }));
      const days = screen.getByLabelText(/Number of days/);
      await userEvent.clear(days);
      await userEvent.type(days, '5');
      const form = container.querySelector('form')!;
      expect(submission(form)).toMatchObject({ tripLength: 'under', tripDays: '5' });
      expect(request(form).maxNights).toBe(5);
    });

    it('Over 3 chosen in the calendar submits a minimum of 3 nights', async () => {
      const { container } = renderForm();
      await openCalendar();
      await userEvent.click(screen.getByRole('radio', { name: /Over X days/ }));
      const days = screen.getByLabelText(/Number of days/);
      await userEvent.clear(days);
      await userEvent.type(days, '3');
      expect(request(container.querySelector('form')!).minNights).toBe(3);
    });

    it('with no length set, no nights limit is submitted', () => {
      const { container } = renderForm();
      const form = container.querySelector('form')!;
      const sent = submission(form);
      expect(sent).not.toHaveProperty('tripLength');
      expect(sent).not.toHaveProperty('tripDays');
      // Nothing from the length control reaches the search: the nights are the form's own.
      const { minNights, maxNights } = sent;
      expect(Number(minNights)).toBeLessThanOrEqual(Number(maxNights));
    });

    it('an explicit tripLength in the address is still honoured', async () => {
      const { container } = renderForm({ values: { tripLength: 'over', tripDays: '4' } });
      const form = container.querySelector('form')!;
      expect(submission(form)).toMatchObject({ tripLength: 'over', tripDays: '4' });
      expect(request(form).minNights).toBe(4);
      await openCalendar();
      expect(screen.getByRole('radio', { name: /Over X days/ })).toBeChecked();
    });

    it('says in words which month holds the selected day', async () => {
      renderForm({ values: { departureDate: '2030-06-10', returnDate: '2030-06-15' } });
      await openCalendar();
      expect(screen.getAllByText('Selected').length).toBeGreaterThan(0);
      expect(screen.getByText('June 2030').parentElement).toHaveTextContent(/June 2030\s*Selected/);
    });
  });

  it('carries the globe selection through as hidden inputs', () => {
    const { container } = renderForm({ carry: { country: 'ESP', mapMode: 'cheapest' } });
    const form = container.querySelector('form')!;

    expect(submission(form)).toMatchObject({ country: 'ESP', mapMode: 'cheapest' });
  });

  it('prefers what was typed over the destination default', () => {
    renderForm({ values: { origins: 'BTS', destinations: 'SPU' } });

    expect(screen.getByLabelText(/^To\b/)).toHaveValue('SPU');
    expect(screen.getByLabelText(/^From/)).toHaveValue('BTS');
  });

  it('shows a form-level error where it can be read', () => {
    renderForm({ errors: { form: 'That search cannot describe a trip.' } });

    // Every field carries its own always-present live region, so the form's
    // message is found by its text and checked to be in one.
    expect(screen.getByText('That search cannot describe a trip.')).toHaveAttribute(
      'role',
      'alert',
    );
  });
});
