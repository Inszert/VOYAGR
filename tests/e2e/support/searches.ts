import { expect, type Locator, type Page } from '@playwright/test';
import { waitForEntranceMotion } from './axe';

/**
 * Searches the suite runs, and the controls it presses to build them.
 *
 * The dates are relative to the day the suite runs. A fixed window is only a
 * test until its dates pass; after that the date calendar clamps it, the
 * flexible-dates panel has nothing to sample, and a spec that was green last
 * month is red for a reason that has nothing to do with the product. Counted in
 * UTC, because these are calendar dates and a local-midnight round trip is how
 * they drift by a day.
 */

const DAY = 86_400_000;

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
}

export interface SearchUrl {
  /** A path and query, on the explorer, which is where a search lands. */
  readonly path: string;
  /** The `YYYY-MM` the window opens in: what a watch is named after. */
  readonly month: string;
  readonly earliest: string;
  readonly latest: string;
}

export function aSearch(
  destinations = 'AYT, CHQ, SPU',
  root = '/explore',
  /** Days to slide the whole window, for a second search that is not the first. */
  shiftDays = 0,
): SearchUrl {
  const earliest = isoDay(21 + shiftDays);
  const latest = isoDay(50 + shiftDays);
  const query = new URLSearchParams({
    origins: 'VIE',
    destinations,
    earliestDeparture: earliest,
    latestReturn: latest,
    minNights: '4',
    maxNights: '7',
    passengers: '2',
    currency: 'EUR',
    targetBudget: '650',
    maxBudget: '850',
    travelStyle: 'balanced',
    optimisationMode: 'best_value',
  });

  return {
    path: `${root}?${query.toString()}`,
    month: earliest.slice(0, 7),
    earliest,
    latest,
  };
}

/**
 * Open the search's folded controls.
 *
 * On a desktop that is the "Options" toggle on the bar (the lenses, the date
 * flexibility chips and "More options" live behind it). Under 1024px the whole
 * form is folded behind the same toggle, labelled "Edit", and the fields are
 * not in the accessibility tree until it is open. It is one checkbox either
 * way, driven by CSS alone, so there is no hydration to wait for.
 */
export async function openSearch(page: Page): Promise<void> {
  // The bar rises into place on arrival. A press that lands while it is still
  // moving goes down on the label and comes up on whatever slid under the
  // pointer, which is no click at all - so wait for the motion to finish.
  await waitForEntranceMotion(page);

  const toggle = page.getByRole('checkbox', { name: 'Show every search option' });
  if (!(await toggle.isChecked())) {
    // The checkbox is visually hidden so the label can be the control.
    await page.locator('label[for="hero-search-open"]').click();
  }
  await expect(toggle).toBeChecked();
}

/** Fold the search's controls away again, as the same toggle does. */
export async function closeSearch(page: Page): Promise<void> {
  const toggle = page.getByRole('checkbox', { name: 'Show every search option' });
  if (await toggle.isChecked()) {
    await page.locator('label[for="hero-search-open"]').click();
  }
  await expect(toggle).not.toBeChecked();
}

/**
 * Wait until React has taken over this element.
 *
 * A form that is a client component (sign-up, "Watch this trip", the trip hub's
 * forms) submitted before hydration is a native POST whose result the page
 * never shows, so the press is lost and the test then waits for a message that
 * is not coming. React marks every DOM node it has hydrated with a
 * `__reactProps$...` property, so the node about to be pressed carries the
 * proof itself - no guess at how long hydration takes, and no help needed from
 * the product.
 */
export async function hydrated(target: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        target.evaluate((element) =>
          Object.keys(element).some((key) => key.startsWith('__reactProps$')),
        ),
      { message: 'waiting for the page to hydrate', timeout: 30_000 },
    )
    .toBe(true);
}

/**
 * Name the places a search from the front page is for.
 *
 * The front page's "To" opens on "anywhere", and an anywhere search is a path
 * (a country, then one of its airports, then its trips) that lists priced
 * destinations rather than ranked trips. A test that wants ranked trips from
 * the form names its places first, as a person who knows where they are going
 * does.
 */
export async function chooseAPlace(page: Page, places = 'AYT, CHQ, SPU'): Promise<void> {
  await openSearch(page);
  await page.getByRole('combobox', { name: /^To/ }).fill(places);
}
