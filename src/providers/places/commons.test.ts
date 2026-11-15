import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../http/types';
import { placeImageUrl } from './image-url';
import { commonsThumbnailUrl, fetchCommonsCredits, isAllowedUpstream } from './commons';

describe('commonsThumbnailUrl', () => {
  it('names the file on Commons at one of the offered widths, escaped', () => {
    expect(commonsThumbnailUrl("Hadrian's Gate.jpg", 640)).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Hadrian's%20Gate.jpg?width=640",
    );
  });

  it('refuses anything that is not a plain image file name', () => {
    for (const name of [
      '../etc/passwd.jpg',
      'a/b.jpg',
      'a\\b.jpg',
      'a%2Fb.jpg',
      'File:a.jpg',
      'plan.svg',
      'doc.pdf',
      'noextension',
      '.jpg',
      '',
      `${'x'.repeat(300)}.jpg`,
      'a\nb.jpg',
      'https://evil.example/a.jpg',
    ]) {
      expect(commonsThumbnailUrl(name, 320), name).toBeNull();
    }
  });
});

describe('isAllowedUpstream', () => {
  it('allows only https on the upload host under the commons path', () => {
    expect(
      isAllowedUpstream(
        'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/640px-X.jpg',
      ),
    ).toBe(true);
  });

  it('refuses another host, a look-alike, another scheme, credentials, a port and a traversal', () => {
    for (const url of [
      'https://evil.example/wikipedia/commons/a.jpg',
      'https://upload.wikimedia.org.evil.example/wikipedia/commons/a.jpg',
      'https://evil.example/@upload.wikimedia.org/wikipedia/commons/a.jpg',
      'http://upload.wikimedia.org/wikipedia/commons/a.jpg',
      'https://user:pw@upload.wikimedia.org/wikipedia/commons/a.jpg',
      'https://upload.wikimedia.org:8443/wikipedia/commons/a.jpg',
      'https://upload.wikimedia.org/other/a.jpg',
      'https://upload.wikimedia.org/wikipedia/commons/%2e%2e/etc/passwd',
      'https://commons.wikimedia.org/wiki/Special:FilePath/a.jpg',
      'not a url',
      '',
    ]) {
      expect(isAllowedUpstream(url), url).toBe(false);
    }
  });
});

describe('placeImageUrl', () => {
  it('is always on our own origin, with the file name escaped', () => {
    const url = placeImageUrl("A & B's.jpg", 320);

    expect(url.startsWith('/api/places/image?')).toBe(true);
    expect(new URL(url, 'https://site.example').searchParams.get('file')).toBe("A & B's.jpg");
    expect(url).not.toContain('wikimedia');
  });
});

describe('fetchCommonsCredits', () => {
  const body = {
    query: {
      normalized: [{ from: 'File:antalya clock.jpg', to: 'File:Antalya clock.jpg' }],
      pages: [
        {
          title: 'File:Antalya clock.jpg',
          imageinfo: [
            {
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Antalya_clock.jpg',
              extmetadata: {
                Artist: {
                  value: '<a href="//commons.wikimedia.org/wiki/User:A">Jane &amp; Co</a>',
                },
                LicenseShortName: { value: 'CC BY-SA 4.0' },
              },
            },
          ],
        },
        {
          title: 'File:Other.jpg',
          imageinfo: [{ extmetadata: {}, descriptionurl: 'https://evil.example/x' }],
        },
        { title: 'File:Missing.jpg' },
      ],
    },
  };

  const reply =
    (status = 200): FetchLike =>
    async () =>
      new Response(JSON.stringify(body), { status });

  it("reads the author and licence, strips markup, and follows the API's title normalisation", async () => {
    const result = await fetchCommonsCredits(['antalya clock.jpg'], { fetchImpl: reply() });

    expect(result.ok && result.value.get('antalya clock.jpg')).toEqual({
      author: 'Jane & Co',
      licence: 'CC BY-SA 4.0',
      pageUrl: 'https://commons.wikimedia.org/wiki/File:Antalya_clock.jpg',
    });
  });

  it('gives null for what the file does not state, and distrusts a page link off Commons', async () => {
    const result = await fetchCommonsCredits(['Other.jpg', 'Missing.jpg'], { fetchImpl: reply() });

    expect(result.ok && result.value.get('Other.jpg')).toEqual({
      author: null,
      licence: null,
      pageUrl: 'https://commons.wikimedia.org/wiki/File:Other.jpg',
    });
    expect(result.ok && result.value.has('Missing.jpg')).toBe(false);
  });

  it('never asks about a name that is not a plain image file', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response(JSON.stringify(body));
    };

    const result = await fetchCommonsCredits(['../x.jpg', 'a|b.jpg'], { fetchImpl });

    expect(calls).toBe(0);
    expect(result.ok && result.value.size).toBe(0);
  });

  it('batches forty titles to a request', async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ query: { pages: [] } }));
    };
    const files = Array.from({ length: 85 }, (_, index) => `File number ${index}.jpg`);

    await fetchCommonsCredits(files, { fetchImpl });

    expect(urls).toHaveLength(3);
  });

  it('is an error result, not a throw, when Commons fails', async () => {
    const down = await fetchCommonsCredits(['a.jpg'], { fetchImpl: reply(503) });
    const thrown = await fetchCommonsCredits(['a.jpg'], {
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });

    expect(down.ok).toBe(false);
    expect(thrown.ok).toBe(false);
  });
});
