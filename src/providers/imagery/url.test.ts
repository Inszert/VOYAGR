import { describe, expect, it } from 'vitest';
import { imageryUrlFor, isWikimediaImageUrl } from './url';

describe('isWikimediaImageUrl', () => {
  it('accepts https on Wikimedia', () => {
    expect(
      isWikimediaImageUrl(
        'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/X.jpg/800px-X.jpg',
      ),
    ).toBe(true);
  });

  it.each([
    'http://upload.wikimedia.org/x.jpg',
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost/x.jpg',
    'https://upload.wikimedia.org.evil.example/x.jpg',
    'https://evilwikimedia.org/x.jpg',
    'https://user:pw@upload.wikimedia.org/x.jpg',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'not a url',
    '',
  ])('refuses %s', (value) => {
    expect(isWikimediaImageUrl(value)).toBe(false);
  });
});

describe('imageryUrlFor', () => {
  it('stays on our own origin', () => {
    expect(imageryUrlFor('lis')).toBe('/api/imagery/LIS');
  });
});
