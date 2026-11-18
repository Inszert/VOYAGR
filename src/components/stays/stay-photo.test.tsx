// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from '@/consent/csp';
import { IMAGE_HOSTS_IN_CSP, StayPhoto, showablePhoto } from './stay-photo';

describe('showablePhoto', () => {
  it('drops http and unparseable URLs', () => {
    expect(showablePhoto({ url: 'http://cdn.example.com/a.jpg', caption: null })).toBe(false);
    expect(showablePhoto({ url: 'not a url', caption: null })).toBe(false);
  });

  it('drops an https host the CSP does not allow', () => {
    expect(showablePhoto({ url: 'https://cdn.example.com/a.jpg', caption: null })).toBe(false);
  });

  it('keeps an https photo from the host the CSP allows, and no other scheme or lookalike', () => {
    expect(showablePhoto({ url: 'https://static.cupid.travel/a.jpg', caption: null })).toBe(true);
    expect(showablePhoto({ url: 'http://static.cupid.travel/a.jpg', caption: null })).toBe(false);
    expect(
      showablePhoto({ url: 'https://static.cupid.travel.evil.example/a.jpg', caption: null }),
    ).toBe(false);
  });

  it('rejects the allowed host with a port, and with credentials', () => {
    expect(showablePhoto({ url: 'https://static.cupid.travel:8443/a.jpg', caption: null })).toBe(
      false,
    );
    expect(
      showablePhoto({ url: 'https://static.cupid.travel@evil.example/a.jpg', caption: null }),
    ).toBe(false);
  });

  it('lists exactly the hosts the CSP names', () => {
    const csp = buildContentSecurityPolicy({ nonce: 'n', isDev: false, driveOrigin: null });
    const imgSrc = csp.split('; ').find((d) => d.startsWith('img-src')) ?? '';
    const hosts = imgSrc
      .split(' ')
      .filter((t) => t.startsWith('https://'))
      .map((t) => new URL(t).hostname)
      // The street map's tile host is a map layer, not a photograph host.
      .filter((host) => host !== 'tile.openstreetmap.org');
    expect([...IMAGE_HOSTS_IN_CSP].sort()).toEqual(hosts.sort());
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
