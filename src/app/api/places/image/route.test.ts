import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

/**
 * The place-photograph proxy.
 *
 * The question this suite answers is "can a request make this server fetch
 * something that is not a Wikimedia Commons image?". Every case that should say
 * no also asserts that nothing was fetched.
 */

const UPLOAD = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/640px-X.jpg';

const call = (query: string) => GET(new Request(`https://voyagr.test/api/places/image?${query}`));

/** Commons redirects to the stored thumbnail; the thumbnail is the image. */
function commons(
  options: {
    location?: string | null;
    status?: number;
    type?: string;
    body?: Uint8Array;
    length?: string;
  } = {},
) {
  const {
    location = UPLOAD,
    status = 302,
    type = 'image/jpeg',
    body = new Uint8Array([1, 2, 3]),
    length,
  } = options;

  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);

    if (url.startsWith('https://commons.wikimedia.org/')) {
      return new Response(null, {
        status,
        headers: location === null ? {} : { location },
      });
    }

    return new Response(body as unknown as BodyInit, {
      status: 200,
      headers: { 'content-type': type, ...(length ? { 'content-length': length } : {}) },
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/places/image', () => {
  it('serves a Commons thumbnail with long cache headers and a locked-down type', async () => {
    const fetchSpy = commons();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await call('file=Good%20photo.jpg&w=320');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toContain('max-age=604800');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    // Commons first, then the upload host the redirect named - nothing else.
    expect(fetchSpy.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual([
      'commons.wikimedia.org',
      'upload.wikimedia.org',
    ]);
  });

  it('serves the second request from memory', async () => {
    const fetchSpy = commons();
    vi.stubGlobal('fetch', fetchSpy);

    await call('file=Held%20photo.jpg');
    await call('file=Held%20photo.jpg');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['no file', ''],
    ['a traversal', 'file=..%2F..%2Fetc%2Fpasswd.jpg'],
    ['a slash', 'file=a%2Fb.jpg'],
    ['a scheme', 'file=https%3A%2F%2Fevil.example%2Fa.jpg'],
    ['a percent escape', 'file=a%252Fb.jpg'],
    ['a control character', 'file=a%0Ab.jpg'],
    ['an svg', 'file=drawing.svg'],
    ['a pdf', 'file=doc.pdf'],
    ['no extension', 'file=photo'],
    ['an over-long name', `file=${'x'.repeat(300)}.jpg`],
    ['a width that is not offered', 'file=ok.jpg&w=5000'],
    ['a width that is not a number', 'file=ok.jpg&w=abc'],
  ])('refuses %s without fetching anything', async (_label, query) => {
    const fetchSpy = commons();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await call(query);

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['another host', 'https://evil.example/wikipedia/commons/a.jpg'],
    ['a look-alike host', 'https://upload.wikimedia.org.evil.example/wikipedia/commons/a.jpg'],
    ['plain http', 'http://upload.wikimedia.org/wikipedia/commons/a.jpg'],
    ['an internal address', 'http://169.254.169.254/latest/meta-data'],
  ])('does not follow a redirect to %s', async (_label, location) => {
    const fetchSpy = commons({ location });
    vi.stubGlobal('fetch', fetchSpy);

    const response = await call(`file=Redirected%20${encodeURIComponent(_label)}.jpg`);

    expect(response.status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses an answer that is not a redirect, or a redirect with nowhere to go', async () => {
    vi.stubGlobal('fetch', commons({ status: 200 }));
    expect((await call('file=Direct.jpg')).status).toBe(404);

    vi.stubGlobal('fetch', commons({ location: null }));
    expect((await call('file=Nowhere.jpg')).status).toBe(404);
  });

  it.each([
    ['an SVG', 'image/svg+xml'],
    ['HTML', 'text/html'],
    ['a PDF', 'application/pdf'],
    ['no type at all', ''],
  ])('refuses %s from the image host', async (_label, type) => {
    vi.stubGlobal('fetch', commons({ type }));

    const response = await call(`file=Wrong%20type%20${encodeURIComponent(_label)}.jpg`);

    expect(response.status).toBe(404);
  });

  it('refuses an image over the size cap, declared or not', async () => {
    vi.stubGlobal('fetch', commons({ length: String(2 * 1024 * 1024 + 1) }));
    expect((await call('file=Declared%20big.jpg')).status).toBe(404);

    vi.stubGlobal('fetch', commons({ body: new Uint8Array(2 * 1024 * 1024 + 1) }));
    expect((await call('file=Undeclared%20big.jpg')).status).toBe(404);

    vi.stubGlobal('fetch', commons({ body: new Uint8Array(0) }));
    expect((await call('file=Empty.jpg')).status).toBe(404);
  });

  it('answers 404 rather than throwing when the upstream is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    expect((await call('file=Offline.jpg')).status).toBe(404);
  });

  /*
   * The shape Commons answers with since 2026, recorded for "Colosseo 2020.jpg"
   * on 2026-11-15: FilePath redirects to Special:Redirect on Commons itself,
   * which redirects to the thumbnail on `thumb.wikimedia.org`. Every Rome
   * picture failed on the first hop when only one was followed.
   */
  function twoHops(
    final: string,
    second = 'https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/Colosseo_2020.jpg&width=640',
  ) {
    return vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.startsWith('https://commons.wikimedia.org/wiki/Special:FilePath/')) {
        return new Response(null, { status: 302, headers: { location: second } });
      }
      if (url.startsWith('https://commons.wikimedia.org/')) {
        return new Response(null, { status: 302, headers: { location: final } });
      }

      return new Response(new Uint8Array([7, 8, 9]) as unknown as BodyInit, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    });
  }

  it("follows Commons' own second redirect to the thumbnail host", async () => {
    const fetchSpy = twoHops(
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/de/Colosseo_2020.jpg/960px-Colosseo_2020.jpg',
    );
    vi.stubGlobal('fetch', fetchSpy);

    const response = await call('file=Colosseo%202020.jpg&w=640');

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]));
    expect(fetchSpy.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual([
      'commons.wikimedia.org',
      'commons.wikimedia.org',
      'thumb.wikimedia.org',
    ]);
  });

  it('follows a hop on Commons only when it is a file redirect', async () => {
    const fetchSpy = twoHops(
      UPLOAD,
      'https://commons.wikimedia.org/w/index.php?title=Special:UserLogin',
    );
    vi.stubGlobal('fetch', fetchSpy);

    expect((await call('file=Login%20page.jpg')).status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('gives up on a redirect loop on Commons rather than following it forever', async () => {
    const loop = 'https://commons.wikimedia.org/wiki/Special:FilePath/Loop.jpg?width=640';
    const fetchSpy = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: loop } }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    expect((await call('file=Loop.jpg')).status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['spaces', 'Trevi Fountain - Roma.jpg', 'Trevi%20Fountain%20-%20Roma.jpg'],
    ['parentheses', 'Pantheon (Rome) - Right side.jpg', 'Pantheon%20(Rome)%20-%20Right%20side.jpg'],
    ['an apostrophe', "Castel Sant'Angelo at Night.jpg", "Castel%20Sant'Angelo%20at%20Night.jpg"],
    ['an en dash', 'Fontana di Trevi – Roma.jpg', 'Fontana%20di%20Trevi%20%E2%80%93%20Roma.jpg'],
    [
      'accents',
      'Piazza Navona Fontana dei Quattro Fiumi Roma é.JPG',
      'Piazza%20Navona%20Fontana%20dei%20Quattro%20Fiumi%20Roma%20%C3%A9.JPG',
    ],
  ])('asks Commons for a name with %s, escaped once', async (_label, file, escaped) => {
    const fetchSpy = commons();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await call(new URLSearchParams({ file, w: '640' }).toString());

    expect(response.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      `https://commons.wikimedia.org/wiki/Special:FilePath/${escaped}?width=640`,
    );
  });
});
