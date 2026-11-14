import { describe, expect, it } from 'vitest';
import type { StayQuery } from '@/core/stay/types';
import { findAllStayLinks } from './fanout';
import { stayLinkOfferSchema } from '../schema';
import {
  buildStayLink,
  createTravelpayoutsLinksProvider,
  linkConfigFrom,
  TravelpayoutsLinksProvider,
  type TravelpayoutsLinkConfig,
} from './travelpayouts-links';
import { getStayProviders, resetStayProviders } from './registry';
import { parseEnv } from '@/lib/env';

const config: TravelpayoutsLinkConfig = {
  marker: 'partner-123',
  programId: '4115',
  campaignId: '77',
};

const query: StayQuery = {
  destination: { code: 'BCN', name: 'Barcelona', position: null, radiusKm: null },
  checkIn: '2026-06-10',
  checkOut: '2026-06-14',
  occupancy: { adults: 2, children: 1, rooms: 1 },
  currency: 'EUR',
};

/** The vendor search the redirect wraps, decoded back out of `u`. */
function wrapped(url: string): URL {
  return new URL(new URL(url).searchParams.get('u')!);
}

describe('buildStayLink', () => {
  it('wraps a vendor search in the Travelpayouts redirect, carrying the marker', () => {
    const url = new URL(buildStayLink(config, query)!);

    expect(url.origin + url.pathname).toBe('https://tp.media/r');
    expect(url.searchParams.get('marker')).toBe('partner-123');
    expect(url.searchParams.get('p')).toBe('4115');
    expect(url.searchParams.get('campaign_id')).toBe('77');
  });

  it('puts the destination, dates and party in the wrapped search', () => {
    const search = wrapped(buildStayLink(config, query)!);

    expect(search.hostname).toBe('www.booking.com');
    expect(search.searchParams.get('ss')).toBe('Barcelona');
    expect(search.searchParams.get('checkin')).toBe('2026-06-10');
    expect(search.searchParams.get('checkout')).toBe('2026-06-14');
    expect(search.searchParams.get('group_adults')).toBe('2');
    expect(search.searchParams.get('group_children')).toBe('1');
    expect(search.searchParams.get('no_rooms')).toBe('1');
  });

  it('encodes the wrapped URL exactly once', () => {
    const raw = buildStayLink(config, query)!;

    // Encoded: the vendor URL is a query value, so it has no bare `?` or `&`
    // of its own after `u=`.
    const afterU = raw.slice(raw.indexOf('u=') + 2);
    expect(afterU).not.toContain('?');
    expect(afterU).not.toContain('&');
    expect(afterU.startsWith('https%3A%2F%2Fwww.booking.com')).toBe(true);
    // And not twice: a double-encoded `%` would read `%25`.
    expect(afterU).not.toContain('%25');
  });

  it('keeps awkward place names intact through the encoding', () => {
    const awkward = {
      ...query,
      destination: { ...query.destination, name: "Saint-Tropez & O'Hara" },
    };
    const url = buildStayLink(config, awkward)!;

    expect(wrapped(url).searchParams.get('ss')).toBe("Saint-Tropez & O'Hara");
  });

  it('falls back to the code when there is no name, and to nothing when there is neither', () => {
    const codeOnly = { ...query, destination: { ...query.destination, name: null } };
    expect(wrapped(buildStayLink(config, codeOnly)!).searchParams.get('ss')).toBe('BCN');

    const nowhere = { ...query, destination: { ...query.destination, name: '  ', code: null } };
    expect(buildStayLink(config, nowhere)).toBeNull();
  });

  it('is deterministic', () => {
    expect(buildStayLink(config, query)).toBe(buildStayLink(config, query));
  });
});

describe('linkConfigFrom', () => {
  const env = {
    AVIASALES_PARTNER_ID: 'partner-123',
    TRAVELPAYOUTS_HOTEL_PROGRAM_ID: '4115',
    TRAVELPAYOUTS_HOTEL_CAMPAIGN_ID: '77',
  };

  it('reads all three identifiers', () => {
    expect(linkConfigFrom(env)).toEqual(config);
  });

  it.each(Object.keys(env))('is null without %s, never a guessed id', (key) => {
    expect(linkConfigFrom({ ...env, [key]: undefined })).toBeNull();
  });
});

describe('the travelpayouts-links stay provider', () => {
  it('returns one link offer with an explicit null price', async () => {
    const result = await new TravelpayoutsLinksProvider(config).searchStayLinks(query);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(1);
    const [offer] = result.value;
    expect(offer?.price).toBeNull();
    expect(offer?.providerId).toBe('travelpayouts-links');
    expect(offer?.destinationName).toBe('Barcelona');
    // It passes the same schema the boundary applies.
    expect(stayLinkOfferSchema.safeParse(offer).success).toBe(true);
  });

  it('lists no priced stays, because it quotes none', async () => {
    const result = await new TravelpayoutsLinksProvider(config).searchStays();

    expect(result).toEqual({ ok: true, value: [] });
  });

  it('is unavailable, with a public message, until it is configured', async () => {
    const result = await new TravelpayoutsLinksProvider(null).searchStayLinks(query);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(result.error.publicMessage).not.toMatch(/4115|partner/);
  });

  it('offers nothing for a stay of no nights', async () => {
    const result = await new TravelpayoutsLinksProvider(config).searchStayLinks({
      ...query,
      checkOut: query.checkIn,
    });

    expect(result).toEqual({ ok: true, value: [] });
  });

  it('declares itself indicative, never live or mock', () => {
    const { metadata } = createTravelpayoutsLinksProvider(parseEnv({ NODE_ENV: 'test' }));

    expect(metadata.kind).toBe('stays');
    expect(metadata.isMock).toBe(false);
    expect(metadata.mode).toBe('indicative');
  });

  it('is found by the fan-out, and an unconfigured one is skipped without failing it', async () => {
    const configured = await findAllStayLinks([new TravelpayoutsLinksProvider(config)], query);
    const unconfigured = await findAllStayLinks([new TravelpayoutsLinksProvider(null)], query);

    expect(configured).toHaveLength(1);
    expect(unconfigured).toEqual([]);
  });
});

describe('stay link schema', () => {
  const valid = {
    id: 'x',
    providerId: 'p',
    displayName: 'P',
    destinationName: 'Barcelona',
    checkIn: '2026-06-10',
    checkOut: '2026-06-14',
    occupancy: { adults: 2, children: 0, rooms: 1 },
    price: null,
    url: 'https://tp.media/r?marker=1',
  };

  it('accepts a link with an explicit null price', () => {
    expect(stayLinkOfferSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses a price, a missing price, and a non-https link', () => {
    expect(
      stayLinkOfferSchema.safeParse({ ...valid, price: { amount: 1, currency: 'EUR' } }).success,
    ).toBe(false);
    const { price: _price, ...withoutPrice } = valid;
    expect(stayLinkOfferSchema.safeParse(withoutPrice).success).toBe(false);
    expect(stayLinkOfferSchema.safeParse({ ...valid, url: 'http://tp.media/r' }).success).toBe(
      false,
    );
    expect(stayLinkOfferSchema.safeParse({ ...valid, url: 'javascript:alert(1)' }).success).toBe(
      false,
    );
  });
});

describe('the stay registry', () => {
  it('resolves travelpayouts-links by name', () => {
    resetStayProviders();
    const providers = getStayProviders(
      parseEnv({ NODE_ENV: 'test', STAY_PROVIDERS: 'travelpayouts-links' }),
    );
    resetStayProviders();

    expect(providers.map((provider) => provider.metadata.id)).toEqual(['travelpayouts-links']);
  });
});
