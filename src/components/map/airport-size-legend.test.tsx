// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AirportSizeLegend } from './airport-size-legend';

describe('AirportSizeLegend', () => {
  it('names every size in words', () => {
    render(<AirportSizeLegend />);
    expect(screen.getByRole('list', { name: 'Airport sizes' })).toBeTruthy();
    expect(screen.getByText('Large airport')).toBeTruthy();
    expect(screen.getByText('Medium airport')).toBeTruthy();
    expect(screen.getByText('Small airport')).toBeTruthy();
  });
});
