import { describe, expect, it, vi } from 'vitest';
import { imageryCodeForPlace, imageryRefFor } from './catalogue';
import { createWikimediaImagery } from './wikimedia';

/**
 * The imagery adapter.
 *
 * The suite runs offline, so every request here is stubbed - which is also the
 * only honest way to test the failure paths that matter. The claims under test
 * are the ones a wrong answer would break silently: that a photograph is
 * matched to the destination that asked for it even when the source renames
 * the article, that an article without a picture is a normal `null` rather
 * than an error, and that a failed lookup loses the whole page of imagery
 * rather than half of it.
 */

const PAGES_RESPONSE = {
  query: {
    normalized: [{ from: 'Reykjavík', to: 'Reykjavik' }],
    redirects: [{ from: 'Reykjavik', to: 'Reykjavík, Iceland' }],
    pages: [
      {
        title: 'Reykjavík, Iceland',
        pageimage: 'Reykjavik.jpg',
        description: 'Capital of Iceland',
        thumbnail: {
          source: 'https://upload.example/thumb/Reykjavik.jpg',
          width: 1200,
          height: 800,
        },
      },
      {
        title: 'Antalya',
        pageimage: 'Antalya.jpg',
        thumbnail: { source: 'https://upload.example/thumb/Antalya.jpg', width: 1200, height: 675 },
      },
      { title: 'Nowhere', missing: true },
    ],
  },
};

const FILES_RESPONSE = {
  query: {
    pages: [
      {
        title: 'File:Reykjavik.jpg',
        imageinfo: [
          {
            descriptionurl: 'https://commons.example/File:Reykjavik.jpg',
            extmetadata: {
              Artist: { value: '<a href="/user">A Photographer</a>' },
              LicenseShortName: { value: 'CC BY-SA 4.0' },
            },
          },
        ],
      },
      {
        title: 'File:Antalya.jpg',
        imageinfo: [
          { descriptionurl: 'https://commons.example/File:Antalya.jpg', extmetadata: {} },
        ],
      },
    ],
  },
};

function stubFetch(responses: unknown[]) {
  const calls: URL[] = [];
  let index = 0;

  const fetcher = vi.fn(async (input: URL | RequestInfo) => {
    calls.push(new URL(String(input)));
    const body = responses[Math.min(index, responses.length - 1)];
    index += 1;

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return { fetcher: fetcher as unknown as typeof globalThis.fetch, calls };
}

const refs = [
  { code: 'KEF', title: 'Reykjavík', lang: 'en' },
  { code: 'AYT', title: 'Antalya', lang: 'en' },
  { code: 'XXX', title: 'Nowhere', lang: 'en' },
];

describe('the Wikimedia imagery adapter', () => {
  it('matches a photograph to the destination that asked for it, through a rename', async () => {
    const { fetcher } = stubFetch([PAGES_RESPONSE, FILES_RESPONSE]);
    const result = await createWikimediaImagery({ fetch: fetcher }).lookup(refs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // "Reykjavík" was normalised and then redirected before the API answered.
    // Following neither hop would attach Iceland's photograph to nothing, or
    // worse, to whichever page happened to come back first.
    const iceland = result.value.get('KEF');
    expect(iceland?.url).toBe('https://upload.example/thumb/Reykjavik.jpg');
    expect(iceland?.width).toBe(1200);
    expect(iceland?.description).toBe('Capital of Iceland');
  });

  it('strips the markup out of an author before it can reach a page', async () => {
    const { fetcher } = stubFetch([PAGES_RESPONSE, FILES_RESPONSE]);
    const result = await createWikimediaImagery({ fetch: fetcher }).lookup(refs);

    if (!result.ok) throw new Error('expected a result');
    expect(result.value.get('KEF')?.credit).toEqual({
      author: 'A Photographer',
      licence: 'CC BY-SA 4.0',
      pageUrl: 'https://commons.example/File:Reykjavik.jpg',
    });
  });

  it('reports an unknown author as null rather than inventing one', async () => {
    const { fetcher } = stubFetch([PAGES_RESPONSE, FILES_RESPONSE]);
    const result = await createWikimediaImagery({ fetch: fetcher }).lookup(refs);

    if (!result.ok) throw new Error('expected a result');
    expect(result.value.get('AYT')?.credit.author).toBeNull();
    expect(result.value.get('AYT')?.credit.licence).toBeNull();
  });

  it('answers null for an article that has no picture', async () => {
    const { fetcher } = stubFetch([PAGES_RESPONSE, FILES_RESPONSE]);
    const result = await createWikimediaImagery({ fetch: fetcher }).lookup(refs);

    if (!result.ok) throw new Error('expected a result');
    expect(result.value.has('XXX')).toBe(true);
    expect(result.value.get('XXX')).toBeNull();
  });

  it('asks for every article in one request, not one request each', async () => {
    const { fetcher, calls } = stubFetch([PAGES_RESPONSE, FILES_RESPONSE]);
    await createWikimediaImagery({ fetch: fetcher }).lookup(refs);

    // Two: one for the articles, one for the files behind them. Sixteen
    // destinations must not be sixteen round trips.
    expect(calls).toHaveLength(2);
    expect(calls[0]?.searchParams.get('titles')).toBe('Reykjavík|Antalya|Nowhere');
  });

  it('fails as a whole rather than illustrating half a page', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 503 }));
    const result = await createWikimediaImagery({
      fetch: fetcher as unknown as typeof globalThis.fetch,
    }).lookup(refs);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROVIDER_ERROR');
  });

  it('makes no request at all when there is nothing to look up', async () => {
    const { fetcher, calls } = stubFetch([PAGES_RESPONSE]);
    const result = await createWikimediaImagery({ fetch: fetcher }).lookup([]);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('the imagery catalogue', () => {
  it('names an article by hand for a destination rather than searching for one', () => {
    // The whole correctness argument rests on this being a fixed association.
    expect(imageryRefFor('spu')).toEqual({ code: 'SPU', title: 'Split, Croatia', lang: 'en' });
  });

  it('has nothing to say about a destination nobody has chosen an article for', () => {
    expect(imageryRefFor('ZZZ')).toBeNull();
  });

  it('finds a typed place only by exact name, never by a partial one', () => {
    expect(imageryCodeForPlace(' barcelona ')).toBe('BCN');
    expect(imageryCodeForPlace('Split')).toBe('SPU');
    expect(imageryCodeForPlace('Barc')).toBeNull();
    // Named, not matched: their articles lead with a flag or a map, so the
    // entries point at an article with a photograph and the name is an alias.
    expect(imageryCodeForPlace('Bali')).toBe('DPS');
    expect(imageryCodeForPlace('singapore')).toBe('SIN');
    expect(imageryCodeForPlace('Hong Kong')).toBe('HKG');
    expect(imageryCodeForPlace('Maldives')).toBe('MLE');
    expect(imageryCodeForPlace('')).toBeNull();
  });
});
