'use client';

import * as React from 'react';
import type { ImageCredit } from '@/providers/imagery/types';
import type { ThingToDo } from '@/providers/types';
import type { PlanTrip } from '@/components/search/add-to-plan';
import { PlaceSheet } from './place-sheet';

/**
 * The places of one destination, shared by every section that names one.
 *
 * "Things to do" and "A first plan" are two views of one list, and a place
 * clicked in either opens the same detail sheet. So the list, its credits and
 * the open place live here, once; the sheet is mounted once, and the address
 * carries `?place=<id>` so a place can be linked to and the back button leaves
 * it as people expect.
 */

interface PlacesState {
  readonly things: readonly ThingToDo[];
  readonly credits: Readonly<Record<string, ImageCredit>>;
  readonly city: string;
  readonly centre: readonly [number, number];
  readonly planTrips: readonly PlanTrip[] | null;
  readonly openId: string | null;
  readonly open: (id: string) => void;
  readonly close: () => void;
  /** The place a card or a dot is pointing at, so the other can answer. */
  readonly hoverId: string | null;
  readonly setHoverId: (id: string | null) => void;
}

const PlacesContext = React.createContext<PlacesState | null>(null);

export function usePlaces(): PlacesState {
  const value = React.useContext(PlacesContext);
  if (!value) throw new Error('usePlaces() needs a PlacesProvider');

  return value;
}

function writePlace(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('place', id);
  else url.searchParams.delete('place');
  window.history.replaceState(window.history.state, '', url);
}

export function PlacesProvider({
  things,
  credits,
  city,
  centre,
  planTrips,
  initialPlaceId,
  children,
}: {
  things: readonly ThingToDo[];
  credits: Readonly<Record<string, ImageCredit>>;
  city: string;
  centre: readonly [number, number];
  planTrips: readonly PlanTrip[] | null;
  /** From `?place=`; ignored when it names nothing in the list. */
  initialPlaceId: string | null;
  children: React.ReactNode;
}) {
  const [openId, setOpenId] = React.useState<string | null>(() =>
    initialPlaceId && things.some((thing) => thing.id === initialPlaceId) ? initialPlaceId : null,
  );
  const [hoverId, setHoverId] = React.useState<string | null>(null);

  const open = React.useCallback((id: string) => {
    setOpenId(id);
    writePlace(id);
  }, []);
  const close = React.useCallback(() => {
    setOpenId(null);
    writePlace(null);
  }, []);

  const value = React.useMemo<PlacesState>(
    () => ({ things, credits, city, centre, planTrips, openId, open, close, hoverId, setHoverId }),
    [things, credits, city, centre, planTrips, openId, open, close, hoverId],
  );

  return (
    <PlacesContext.Provider value={value}>
      {children}
      <PlaceSheet />
    </PlacesContext.Provider>
  );
}
