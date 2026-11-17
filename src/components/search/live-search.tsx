'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  getServerStageSnapshot,
  getStageSnapshot,
  setStagePending,
  subscribeStage,
} from '@/components/discovery/stage-store';

/**
 * The explorer's search, edited where its results are.
 *
 * Changing where from, where to, the dates or how many are going applies the
 * search on its own, without a button and without leaving the page: the form
 * becomes a new address, and the address is still the search - a link, a
 * reload and the back button all mean what they meant before. Only the parts
 * of the page that depend on the search change; the shell and the globe stay
 * mounted (see `stage-host.tsx`), and the globe's pins and routes are replaced
 * in place when the new page's data arrives.
 *
 * Nothing here is a price. A different party is a different search - a room
 * for three is not one and a half rooms for two - so the figures come back
 * from the server like any other search, and until they do the old ones are
 * marked as being replaced (`LiveResults`) rather than scaled on the client.
 */

import { LIVE_FIELDS, type LiveField } from './live-fields';

export { LIVE_FIELDS };

/** Long enough for a stepper pressed three times to be one search, not three. */
const SETTLE_MS = 450;

/**
 * The address a change produces, from what the form would submit.
 *
 * What the change makes stale goes: a date picked on the old results means
 * nothing on new dates, and a destination narrowed to may not be in the new
 * search. Two dates typed are the dates of the trip, so a window search that
 * gets them reads them as exact dates instead of ignoring them.
 */
export function liveSearchQuery(
  entries: Iterable<readonly [string, string]>,
  changed: ReadonlySet<LiveField>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) params.append(key, value);
  params.delete('edit');

  const dates = changed.has('departureDate') || changed.has('returnDate');
  const places = changed.has('origins') || changed.has('destinations');

  if (dates) {
    params.delete('fDates');
    const flexibility = params.get('flexibility');
    // A window (`custom`, also the default) and a month both ignore the typed dates.
    if (!flexibility || flexibility === 'custom' || flexibility === 'month') {
      params.set('flexibility', 'exact');
    }
  }
  if (places) {
    params.delete('fDest');
    params.delete('fDates');
  }

  return params.toString();
}

function read(form: HTMLFormElement): Record<LiveField, string> {
  const values = {} as Record<LiveField, string>;
  for (const name of LIVE_FIELDS) {
    const field = form.elements.namedItem(name);
    values[name] = field instanceof HTMLInputElement ? field.value : '';
  }
  return values;
}

/**
 * Whether the form says one finished thing.
 *
 * Not while a calendar or a suggestion list is open, not while an airport is
 * still being typed, and not while any field would refuse to submit: half a
 * date or an empty "To" is a search nobody asked for.
 */
function settled(form: HTMLFormElement, typingAllowed: boolean): boolean {
  if (form.querySelector('[aria-expanded="true"]')) return false;

  const active = document.activeElement;
  if (
    !typingAllowed &&
    active instanceof HTMLInputElement &&
    active.form === form &&
    active.getAttribute('role') === 'combobox'
  ) {
    return false;
  }

  if (!form.checkValidity()) return false;

  const { departureDate, returnDate } = read(form);
  // ISO dates order as strings; no `Date` is needed to say which is later.
  return !(departureDate && returnDate && returnDate <= departureDate);
}

export interface LiveSearchFormProps {
  action: '/explore';
  /** The form's accessible name. */
  label: string;
  className?: string;
  children: React.ReactNode;
}

export function LiveSearchForm({ action, label, className, children }: LiveSearchFormProps) {
  const router = useRouter();
  const search = useSearchParams().toString();
  const formRef = React.useRef<HTMLFormElement>(null);
  const baseline = React.useRef<Record<LiveField, string> | null>(null);
  const timer = React.useRef<number | undefined>(undefined);

  /*
   * The fields are uncontrolled, so they keep what was typed across the
   * navigation this form starts - focus and caret included. A navigation it
   * did not start (back, forward, a filter, a lens) is a different search,
   * and the fields are mounted again from it.
   */
  const [pushed, setPushed] = React.useState<string | null>(null);
  const [shown, setShown] = React.useState({ search, generation: 0 });
  if (shown.search !== search) {
    setShown({
      search,
      generation: search === pushed ? shown.generation : shown.generation + 1,
    });
  }

  /*
   * The rest of the search as this form last sent it. The hidden fields only
   * catch up when the server answers, so a second change made before then
   * must build on the first one's address (a window it turned into exact
   * dates, a narrowing it dropped), not on the page it replaced.
   */
  const carried = React.useRef<[string, string][] | null>(null);

  React.useEffect(() => {
    if (formRef.current) baseline.current = read(formRef.current);
    carried.current = null;
  }, [shown.generation]);

  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  const apply = React.useCallback(
    (typingAllowed: boolean) => {
      const form = formRef.current;
      if (!form || !baseline.current || !settled(form, typingAllowed)) return;

      const now = read(form);
      const before = baseline.current;
      const changed = new Set(LIVE_FIELDS.filter((name) => now[name] !== before[name]));
      if (changed.size === 0) return;

      const live = new Set<string>(LIVE_FIELDS);
      const entries: [string, string][] = [];
      for (const [key, value] of new FormData(form)) {
        if (typeof value !== 'string') continue;
        if (live.has(key) || carried.current === null) entries.push([key, value]);
      }
      if (carried.current) entries.push(...carried.current);
      const query = liveSearchQuery(entries, changed);

      carried.current = [...new URLSearchParams(query)].filter(([key]) => !live.has(key));
      baseline.current = now;
      setPushed(query);
      setStagePending(true);
      router.push(`${action}?${query}` as never, { scroll: false });
    },
    [action, router],
  );

  const schedule = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => apply(false), SETTLE_MS);
  };

  return (
    <form
      ref={formRef}
      method="get"
      action={action}
      aria-label={label}
      className={className}
      onChange={schedule}
      onBlur={schedule}
      onKeyDown={(event) => {
        // The first Enter in an airport field picks a suggestion and says so
        // by preventing it; the next one applies what is there now.
        if (event.key !== 'Enter' || event.defaultPrevented) return;
        if (!(event.target instanceof HTMLInputElement)) return;
        event.preventDefault();
        window.clearTimeout(timer.current);
        apply(true);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        window.clearTimeout(timer.current);
        apply(true);
      }}
    >
      <React.Fragment key={shown.generation}>{children}</React.Fragment>
    </form>
  );
}

/**
 * The results while a changed search is on its way.
 *
 * Still there, so the page does not jump, but dimmed and marked busy: they
 * were priced for the search before this one, and nothing on the client may
 * pretend they are the new one's.
 */
export function LiveResults({ children }: { children: React.ReactNode }) {
  const { pending } = React.useSyncExternalStore(
    subscribeStage,
    getStageSnapshot,
    getServerStageSnapshot,
  );

  return (
    <div
      aria-busy={pending || undefined}
      data-pending={pending ? 'true' : 'false'}
      className="ease-standard duration-quick transition-opacity data-[pending=true]:opacity-60"
    >
      {children}
    </div>
  );
}
