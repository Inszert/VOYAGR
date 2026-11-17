import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

describe('CompactSearch', () => {
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
    // "Dates" is also the heading of a More options group, so name the control by its role.
    expect(screen.getByRole('radiogroup', { name: 'Dates' })).toBeInTheDocument();
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
