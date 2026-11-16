import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RemotePicture } from './remote-picture';

/**
 * A picture that does not arrive becomes the tile, never an empty box.
 */

describe('RemotePicture', () => {
  it('shows the photograph while it is loading or loaded', () => {
    render(<RemotePicture src="/api/imagery/KZN" alt="Kazan, Russia" fallback={<span>RU</span>} />);

    expect(screen.getByRole('img', { name: 'Kazan, Russia' })).toHaveAttribute(
      'src',
      '/api/imagery/KZN',
    );
    expect(screen.queryByText('RU')).toBeNull();
  });

  it('swaps a failed load for the fallback tile', () => {
    render(<RemotePicture src="/api/imagery/KZN" alt="Kazan, Russia" fallback={<span>RU</span>} />);

    fireEvent.error(screen.getByRole('img', { name: 'Kazan, Russia' }));

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('RU')).toBeInTheDocument();
  });
});
