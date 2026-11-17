import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SnapshotStatusLine } from './snapshot-status';

const base = {
  observedAt: '2027-01-10T08:00:00.000Z',
  testPrices: false,
} as const;

describe('SnapshotStatusLine', () => {
  it('says "Updated N hours ago" for a fresh snapshot', () => {
    render(<SnapshotStatusLine status={{ ...base, state: 'fresh', ageHours: 5 }} />);

    expect(screen.getByText('Updated 5 hours ago')).toBeTruthy();
    expect(screen.queryByText(/Test prices/)).toBeNull();
  });

  it('says "Prices last checked N hours ago" for an aging one', () => {
    render(<SnapshotStatusLine status={{ ...base, state: 'aging', ageHours: 20 }} />);

    expect(screen.getByText('Prices last checked 20 hours ago')).toBeTruthy();
  });

  it('says the plain missing line, and no test note even for a sandbox, when nothing is loaded', () => {
    render(
      <SnapshotStatusLine
        status={{ state: 'missing', observedAt: null, ageHours: null, testPrices: true }}
      />,
    );

    expect(screen.getByText('Hotel prices are not loaded for these dates yet.')).toBeTruthy();
    expect(screen.queryByText(/Test prices/)).toBeNull();
  });

  it('makes no age claim when the observation is in the future', () => {
    const { container } = render(
      <SnapshotStatusLine status={{ ...base, state: 'unknown', ageHours: null }} />,
    );

    expect(container.textContent).toBe('');
  });

  it('shows the "Test prices" note, in words, while the data is sandbox', () => {
    render(
      <SnapshotStatusLine status={{ ...base, state: 'fresh', ageHours: 2, testPrices: true }} />,
    );

    expect(screen.getByText('Test prices.')).toBeTruthy();
    expect(screen.getByText('Updated 2 hours ago')).toBeTruthy();
  });

  it('shows the test note on its own, without an age, for an unknown date', () => {
    render(
      <SnapshotStatusLine
        status={{ ...base, state: 'unknown', ageHours: null, testPrices: true }}
      />,
    );

    expect(screen.getByText('Test prices.')).toBeTruthy();
    expect(screen.queryByText(/ago/)).toBeNull();
  });
});
