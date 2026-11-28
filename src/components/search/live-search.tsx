'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  getServerStageSnapshot,
  getStageSnapshot,
  setStagePending,
  subscribeStage,
} from '@/components/discovery/stage-store';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

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

import { FORM_FIELDS, LIVE_FIELDS, type FormField, type LiveField } from './live-fields';
import { AIRPORT_PICKED_EVENT } from './airport-input';

export { LIVE_FIELDS };

/** Long enough for a stepper pressed three times to be one search, not three. */
const SETTLE_MS = 450;

/** The pause after the last change before two valid places search on their own. */
export const PLACES_SETTLE_MS = 400;

const AIRPORT_CODE = /^[A-Za-z]{3}$/;

/**
 * Whether every origin and every destination is a finished airport code.
 *
 * A code counts when it is three letters and the catalogue knows it, so a
 * half-typed "BU" never does and neither does the word "anywhere". Nothing is
 * known without a catalogue, and then only a picked suggestion searches early.
 */
export function placesComplete(
  form: HTMLFormElement,
  known: ReadonlySet<string> | undefined,
): boolean {
  if (!known) return false;
  const { origins, destinations } = read(form);
  for (const value of [origins, destinations]) {
    const codes = value
      .split(/[\s,]+/)
      .map((code) => code.trim())
      .filter(Boolean);
    if (codes.length === 0) return false;
    if (!codes.every((code) => AIRPORT_CODE.test(code) && known.has(code.toUpperCase()))) {
      return false;
    }
  }
  return true;
}

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
  changed: ReadonlySet<LiveField | FormField>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) params.append(key, value);
  params.delete('edit');

  const dates = changed.has('departureDate') || changed.has('returnDate');
  const places = changed.has('origins') || changed.has('destinations');
  // A different spread of dates or length of trip is a different search too.
  const spread = FORM_FIELDS.some((name) => changed.has(name));

  if (spread) params.delete('fDates');
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

/** The shared form's other fields, as they would submit. */
function readExtras(form: HTMLFormElement): Record<FormField, string> {
  const data = new FormData(form);
  const values = {} as Record<FormField, string>;
  for (const name of FORM_FIELDS) {
    values[name] = data
      .getAll(name)
      .map((value) => (typeof value === 'string' ? value : ''))
      .join('|');
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
function settled(form: HTMLFormElement, typingAllowed: boolean, placesDone = false): boolean {
  // Suggestions still open under a finished code are not a reason to wait.
  const open = placesDone
    ? '[aria-expanded="true"]:not(input[name="origins"]):not(input[name="destinations"])'
    : '[aria-expanded="true"]';
  if (form.querySelector(open)) return false;

  const active = document.activeElement;
  if (
    !typingAllowed &&
    !placesDone &&
    active instanceof HTMLInputElement &&
    active.form === form &&
    active.getAttribute('role') === 'combobox'
  ) {
    return false;
  }

  if (!form.checkValidity()) return false;

  // A month search has no dates to order.
  if (readExtras(form).flexibility === 'month') return true;
  const { departureDate, returnDate } = read(form);
  // ISO dates order as strings; no `Date` is needed to say which is later.
  return !(departureDate && returnDate && returnDate <= departureDate);
}

/**
 * What the form still needs, in words, or null when it can search.
 *
 * Read off the fields themselves, so it agrees with `settled`: the first field
 * that would refuse to submit names itself. The wording is ours because a
 * browser's own message is not on the page.
 */
const MISSING_WORDS: Record<LiveField, string> = {
  origins: 'Add a departure airport',
  destinations: 'Add a destination',
  departureDate: 'Add a departure date',
  returnDate: 'Add a return date',
  passengers: 'Choose 1 to 9 travellers',
};

export function missingFromForm(form: HTMLFormElement): string | null {
  for (const name of LIVE_FIELDS) {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement && !field.checkValidity()) return MISSING_WORDS[name];
  }
  const { departureDate, returnDate } = read(form);
  if (
    readExtras(form).flexibility !== 'month' &&
    departureDate &&
    returnDate &&
    returnDate <= departureDate
  ) {
    return 'Choose a return date after the departure date';
  }
  return form.checkValidity() ? null : 'Complete the form to search';
}

export interface LiveSearchFormProps {
  action: '/explore';
  /** The form's accessible name. */
  label: string;
  className?: string;
  children: React.ReactNode;
  /**
   * The airport codes the catalogue knows. With them, two finished places
   * search on their own after a short pause; without them, only a picked
   * suggestion, the button or Enter does.
   */
  airportCodes?: readonly string[];
}

export function LiveSearchForm({
  action,
  label,
  className,
  children,
  airportCodes,
}: LiveSearchFormProps) {
  const known = React.useMemo(
    () => (airportCodes ? new Set(airportCodes.map((code) => code.toUpperCase())) : undefined),
    [airportCodes],
  );
  const router = useRouter();
  const search = useSearchParams().toString();
  const formRef = React.useRef<HTMLFormElement>(null);
  const baseline = React.useRef<Record<LiveField, string> | null>(null);
  const baselineExtras = React.useRef<Record<FormField, string> | null>(null);
  const timer = React.useRef<number | undefined>(undefined);
  const missingId = React.useId();
  // Unknown until the form has mounted: before that the button is enabled, and
  // the browser's own validation still guards a submit without JavaScript.
  const [missing, setMissing] = React.useState<string | null>(null);
  const refreshMissing = React.useCallback(() => {
    if (formRef.current) setMissing(missingFromForm(formRef.current));
  }, []);

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
    if (formRef.current) {
      baseline.current = read(formRef.current);
      baselineExtras.current = readExtras(formRef.current);
    }
    carried.current = null;
    refreshMissing();
  }, [shown.generation, refreshMissing]);

  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  const apply = React.useCallback(
    (typingAllowed: boolean, placesDone = false) => {
      const form = formRef.current;
      if (!form || !baseline.current || !settled(form, typingAllowed, placesDone)) return;

      const now = read(form);
      const before = baseline.current;
      const extras = readExtras(form);
      const extrasBefore = baselineExtras.current ?? extras;
      const changed = new Set<LiveField | FormField>([
        ...LIVE_FIELDS.filter((name) => now[name] !== before[name]),
        ...FORM_FIELDS.filter((name) => extras[name] !== extrasBefore[name]),
      ]);
      if (changed.size === 0) return;

      // What this change takes from the form; the rest rides along as it was sent.
      const live = new Set<string>([...LIVE_FIELDS, ...FORM_FIELDS.filter((n) => changed.has(n))]);
      const entries: [string, string][] = [];
      for (const [key, value] of new FormData(form)) {
        if (typeof value !== 'string') continue;
        if (live.has(key) || carried.current === null) entries.push([key, value]);
      }
      if (carried.current) {
        entries.push(...carried.current.filter(([key]) => !live.has(key)));
      }
      const query = liveSearchQuery(entries, changed);

      carried.current = [...new URLSearchParams(query)].filter(
        ([key]) => !(LIVE_FIELDS as readonly string[]).includes(key),
      );
      baseline.current = now;
      baselineExtras.current = extras;
      setPushed(query);
      setStagePending(true);
      router.push(`${action}?${query}` as never, { scroll: false });
    },
    [action, router],
  );

  /*
   * A suggestion that was picked is a finished edit: apply it now, without
   * waiting for the field to be left. Typing alone never reaches here.
   */
  React.useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const onPicked = () => {
      window.clearTimeout(timer.current);
      refreshMissing();
      apply(true);
    };
    form.addEventListener(AIRPORT_PICKED_EVENT, onPicked);
    return () => form.removeEventListener(AIRPORT_PICKED_EVENT, onPicked);
  }, [apply, refreshMissing]);

  const schedule = () => {
    window.clearTimeout(timer.current);
    // Two finished places search after their own, shorter pause, even while
    // the field is still focused. `apply` compares against what was last sent,
    // so the same values never search twice.
    const done = formRef.current ? placesComplete(formRef.current, known) : false;
    timer.current = window.setTimeout(
      () => apply(false, done),
      done ? PLACES_SETTLE_MS : SETTLE_MS,
    );
  };

  return (
    <form
      ref={formRef}
      method="get"
      action={action}
      aria-label={label}
      className={className}
      onChange={() => {
        refreshMissing();
        schedule();
      }}
      onInput={refreshMissing}
      onBlur={() => {
        refreshMissing();
        schedule();
      }}
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
      {/*
        The same search Enter runs, as a button, whether or not there are
        results yet. It is disabled only while the form could not search, and
        then the reason is on the page in words, not only in the colour.
      */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-2">
        <Button type="submit" disabled={missing !== null} aria-describedby={missingId}>
          Search
        </Button>
        <p id={missingId} aria-live="polite" className="text-ink-muted text-sm">
          {missing}
        </p>
      </div>
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

/*
 * The filter panel's show/hide, shared between the button in the toolbar and
 * the panel further down the page. The server render is open, so without
 * JavaScript the filters are there; on a phone-width screen the first client
 * render closes it, so the trips come first.
 */
const DESKTOP_QUERY = '(min-width: 1024px)';

interface FiltersState {
  open: boolean;
  toggle: () => void;
  panelId: string;
}

const FiltersContext = React.createContext<FiltersState | null>(null);

function useFilters(): FiltersState {
  const value = React.useContext(FiltersContext);
  if (!value) throw new Error('FiltersToggle and FiltersPanel belong inside FiltersDisclosure');
  return value;
}

function subscribeDesktop(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getDesktopSnapshot(): boolean {
  if (typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function getDesktopServerSnapshot(): boolean {
  return true;
}

export function FiltersDisclosure({ children }: { children: React.ReactNode }) {
  const panelId = React.useId();
  const [chosen, setChosen] = React.useState<boolean | null>(null);
  const isDesktop = React.useSyncExternalStore(
    subscribeDesktop,
    getDesktopSnapshot,
    getDesktopServerSnapshot,
  );
  const open = chosen ?? isDesktop;

  const value = React.useMemo(
    () => ({ open, panelId, toggle: () => setChosen(!open) }),
    [open, panelId],
  );
  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function FiltersToggle({ className }: { className?: string }) {
  const { open, toggle, panelId } = useFilters();
  return (
    <Button
      type="button"
      variant="secondary"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={toggle}
      className={className}
    >
      Filters
      <Icon
        name="chevron-down"
        className={cn('size-4 transition-transform', open && 'rotate-180')}
      />
    </Button>
  );
}

/**
 * The results, and the rail that holds the filters. From 1024px the rail sits
 * at the far right edge of the page, outside the centred results column, the
 * way a sidebar does; the results give up only as much width as the rail needs
 * beyond the free margin. The layout measures how far its own right edge is
 * from the page edge (`--rail-gap`) so the rail can land exactly on it,
 * scrollbar included. Closing the filters gives the whole width back.
 */
export function FiltersLayout({
  className,
  hasPanel,
  children,
}: {
  className?: string;
  hasPanel: boolean;
  children: React.ReactNode;
}) {
  const { open } = useFilters();
  const ref = React.useRef<HTMLDivElement>(null);
  const railed = open && hasPanel;
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !railed) return;
    const measure = () => {
      const gap = document.documentElement.clientWidth - el.getBoundingClientRect().right;
      el.style.setProperty('--rail-gap', `${Math.max(0, Math.floor(gap))}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    return () => {
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [railed]);
  return (
    <div
      ref={ref}
      className={cn(
        className,
        /*
         * `--rail-gap` starts at what the wide container's geometry gives (its 1216px
         * ceiling, centred, with 3rem of padding either side) and is then replaced by the
         * measured figure. Starting it at 0 made the server-rendered column 70px narrower
         * than the hydrated one, and the whole results column reflowed, a page's height
         * changing by hundreds of pixels, a moment after it first painted.
         */
        railed &&
          'lg:relative lg:pr-[max(0px,calc(21rem-var(--rail-gap)))] lg:[--rail-gap:calc(max(0px,(100vw-1216px)/2)+3rem)]',
      )}
    >
      {children}
    </div>
  );
}

/** The side-panel card: the filters, shown and hidden by the Filters button. */
export function FiltersPanel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { open, panelId } = useFilters();
  return (
    <aside
      id={panelId}
      aria-label="Filters"
      hidden={!open}
      className="lg:absolute lg:top-0 lg:bottom-0 lg:left-[calc(100%+var(--rail-gap,0px)-20rem)] lg:w-80"
    >
      <div className={className}>{children}</div>
    </aside>
  );
}
