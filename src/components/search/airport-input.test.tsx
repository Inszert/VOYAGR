import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AirportInput } from './airport-input';

const airports = [
  { code: 'BUD', name: 'Budapest', country: 'Hungary', priceable: true },
  { code: 'BTS', name: 'Bratislava', country: 'Slovakia', priceable: true },
  { code: 'BEG', name: 'Belgrade', country: 'Serbia', priceable: true },
  { code: 'BRU', name: 'Brussels', country: 'Belgium', priceable: true },
] as never;

describe('the stand-in "anywhere"', () => {
  it('is selected on focus, so typing a code replaces it', () => {
    render(
      <AirportInput label="To" name="destinations" defaultValue="anywhere" airports={airports} />,
    );
    const field = screen.getByRole('combobox', { name: 'To' }) as HTMLInputElement;
    fireEvent.focus(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe('anywhere'.length);
  });

  it('leaves a typed list alone', () => {
    render(
      <AirportInput label="To" name="destinations" defaultValue="BUD, BTS" airports={airports} />,
    );
    const field = screen.getByRole('combobox', { name: 'To' }) as HTMLInputElement;
    field.setSelectionRange(3, 3);
    fireEvent.focus(field);
    expect(field.selectionStart).toBe(3);
    expect(field.selectionEnd).toBe(3);
  });
});

describe('the airport suggestions', () => {
  it('stay directly under the field as the suggestions change', () => {
    render(
      <AirportInput
        label="To"
        name="destinations"
        airports={airports}
        hint="Type a code or a city."
      />,
    );
    const field = screen.getByRole('combobox', { name: 'To' });

    const hint = screen.getByText('Type a code or a city.');

    fireEvent.change(field, { target: { value: 'B' } });
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(4);
    expectListUnderField(field, list);
    expect(list.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Fewer matches: the same listbox is updated in place, and it is still
    // the list the field points at, still ahead of the hint and still in the
    // field's own box.
    fireEvent.change(field, { target: { value: 'BU' } });
    expect(screen.getByRole('listbox')).toBe(list);
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(within(list).getByRole('option')).toHaveTextContent('BUD');
    expectListUnderField(field, list);
    expect(list.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('announces the highlighted suggestion to assistive technology, not only by its shade', () => {
    render(<AirportInput label="To" name="destinations" airports={airports} />);
    const field = screen.getByRole('combobox', { name: 'To' });

    fireEvent.change(field, { target: { value: 'B' } });
    const first = screen.getByRole('option', { selected: true });
    expect(first).toHaveTextContent('BUD');
    expect(field).toHaveAttribute('aria-activedescendant', first.id);

    fireEvent.keyDown(field, { key: 'ArrowDown' });
    const second = screen.getByRole('option', { selected: true });
    expect(second).toHaveTextContent('BTS');
    expect(first).toHaveAttribute('aria-selected', 'false');
    expect(field).toHaveAttribute('aria-activedescendant', second.id);
  });
});

/**
 * The list is the one the field names, comes straight after it in the page,
 * and sits in the field's own box rather than in the column around it.
 */
function expectListUnderField(field: HTMLElement, list: HTMLElement) {
  expect(field).toHaveAttribute('aria-controls', list.id);
  expect(field.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(field.parentElement).toContainElement(list);
}
