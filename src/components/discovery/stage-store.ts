import type { GlobeStageProps } from './globe-stage';

/**
 * What the persistent globe is told, and by whom.
 *
 * One globe lives above both stage pages (`src/app/(stage)/layout.tsx`), so a
 * page cannot render it - it can only say what it should show. Two things are
 * published, by two different components, because they change at different
 * times:
 *
 *  - **The slot**: the box on the page the globe should fill. The home page's
 *    slot is its hero, the explorer's is a column. A navigation swaps one slot
 *    for the other and the globe travels between them.
 *  - **The data**: pins, routes, the home airport and the selected country, as
 *    the server computed them for this URL.
 *
 * And one thing is published by the host itself: whether a navigation is in
 * flight, so the old pins can be held at half strength rather than vanish.
 *
 * A module-level store read through `useSyncExternalStore`. There is nothing
 * to provide: the layout is the only place that mounts the host, and a store
 * that lives as long as the module lives as long as the visit.
 */

export type StageVariant = 'stage' | 'explorer';

/** Everything the globe takes except where it sits, which the slot decides. */
export type StageData = Omit<GlobeStageProps, 'variant' | 'className'>;

export interface StageSnapshot {
  readonly data: StageData | null;
  readonly variant: StageVariant;
  /** The element the globe should fill, or null while no page has one. */
  readonly slot: HTMLElement | null;
  /** True from the moment a stage navigation starts until the next page's data lands. */
  readonly pending: boolean;
}

let snapshot: StageSnapshot = { data: null, variant: 'stage', slot: null, pending: false };
const listeners = new Set<() => void>();

function publish(next: Partial<StageSnapshot>): void {
  const merged = { ...snapshot, ...next };
  if (
    merged.data === snapshot.data &&
    merged.variant === snapshot.variant &&
    merged.slot === snapshot.slot &&
    merged.pending === snapshot.pending
  ) {
    return;
  }

  snapshot = merged;
  for (const listener of [...listeners]) listener();
}

export function subscribeStage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getStageSnapshot(): StageSnapshot {
  return snapshot;
}

const SERVER_SNAPSHOT: StageSnapshot = { data: null, variant: 'stage', slot: null, pending: false };

export function getServerStageSnapshot(): StageSnapshot {
  return SERVER_SNAPSHOT;
}

/** A page has a box for the globe. */
export function registerStageSlot(slot: HTMLElement, variant: StageVariant): void {
  publish({ slot, variant });
}

/**
 * The page is going away. The globe stays where it was - the next page is
 * about to register its own slot - unless nothing else has claimed it.
 */
export function releaseStageSlot(slot: HTMLElement): void {
  if (snapshot.slot === slot) publish({ slot: null });
}

/** A page has new things to show. Arrival of data is what ends a pending state. */
export function publishStageData(data: StageData): void {
  publish({ data, pending: false });
}

export function setStagePending(pending: boolean): void {
  publish({ pending });
}
