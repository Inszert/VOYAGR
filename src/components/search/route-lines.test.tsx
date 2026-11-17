import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteLines } from './route-lines';

describe('RouteLines', () => {
  it('lists one line of text per pair and counts them', () => {
    render(<RouteLines origins={['VIE', 'BTS']} destinations={['AYT', 'LIS']} />);
    expect(screen.getByText('4 routes shown')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Routes on the globe' });
    expect(list.querySelectorAll('li')).toHaveLength(4);
    expect(screen.getByText('VIE to AYT')).toBeTruthy();
  });

  it('renders nothing when no airport can be placed', () => {
    const { container } = render(<RouteLines origins={['XXX']} destinations={['YYY']} />);
    expect(container.textContent).toBe('');
  });
});
