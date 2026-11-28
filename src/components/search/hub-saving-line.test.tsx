import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HubSavingLine } from './hub-saving-line';

describe('HubSavingLine', () => {
  it('says what is saved, the transfer, and that it is an estimate', () => {
    render(
      <HubSavingLine
        saving={{
          origin: 'VIE',
          code: 'BTS',
          savingMinor: 7400,
          transferMinor: 2500,
          currency: 'EUR',
        }}
      />,
    );
    const text = screen.getByText(/Cheaper from BTS/).parentElement!.textContent!;
    expect(text).toContain('€74.00');
    expect(text).toContain('€25.00 transfer (estimate)');
  });

  it('renders nothing without a saving', () => {
    const { container } = render(<HubSavingLine saving={null} />);
    expect(container.textContent).toBe('');
  });
});
