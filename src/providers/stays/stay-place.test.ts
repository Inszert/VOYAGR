import { describe, expect, it } from 'vitest';
import { loadStayListings } from './listings';
import { resolveStayPlace } from './stay-place';

describe('resolveStayPlace', () => {
  it('prefers the typed city over an airport code the catalogue does not hold', () => {
    // A trip hands over JFK; the catalogue knows New York as EWR, which the hotel list covers.
    const place = resolveStayPlace({ code: 'JFK', name: 'New York' });
    expect(place?.city).toBe('New York');
    expect(place?.code).toBe('EWR');
    expect(loadStayListings({ code: place!.code, centre: place!.centre }).status).toBe('ok');
  });

  it('uses a catalogue code as given', () => {
    expect(resolveStayPlace({ code: 'BCN', name: null })?.code).toBe('BCN');
  });

  it('falls back to the code alone when the name matches nothing', () => {
    expect(resolveStayPlace({ code: 'JFK', name: null })?.code).toBe('JFK');
  });

  it('resolves nothing without a code or a known name', () => {
    expect(resolveStayPlace({ code: null, name: 'Nowhereville' })).toBeNull();
  });
});
