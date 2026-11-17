// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StayPhoto, showablePhoto } from './stay-photo';

describe('showablePhoto', () => {
  it('drops http and unparseable URLs', () => {
    expect(showablePhoto({ url: 'http://cdn.example.com/a.jpg', caption: null })).toBe(false);
    expect(showablePhoto({ url: 'not a url', caption: null })).toBe(false);
  });

  it('drops an https host the CSP does not allow', () => {
    expect(showablePhoto({ url: 'https://cdn.example.com/a.jpg', caption: null })).toBe(false);
  });

  it('keeps a same-origin path', () => {
    expect(showablePhoto({ url: '/api/photo/a.jpg', caption: null })).toBe(true);
    expect(showablePhoto({ url: '//cdn.example.com/a.jpg', caption: null })).toBe(false);
  });
});

describe('StayPhoto', () => {
  it('shows the hotel name as text when the photo cannot load', () => {
    render(
      <StayPhoto
        seed="k"
        hotelName="Hotel Lisboa"
        photo={{ url: 'https://cdn.example.com/a.jpg', caption: null }}
      />,
    );
    expect(screen.getByText('Hotel Lisboa')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('gives a shown image alt text from the caption, else the hotel name', () => {
    const { rerender } = render(
      <StayPhoto
        seed="k"
        hotelName="Hotel Lisboa"
        photo={{ url: '/api/photo/a.jpg', caption: 'The lobby' }}
      />,
    );
    expect(screen.getByRole('img', { name: 'The lobby' })).toBeTruthy();

    rerender(
      <StayPhoto
        seed="k"
        hotelName="Hotel Lisboa"
        photo={{ url: '/api/photo/a.jpg', caption: null }}
      />,
    );
    expect(screen.getByRole('img', { name: 'Photo of Hotel Lisboa' })).toBeTruthy();
  });
});
