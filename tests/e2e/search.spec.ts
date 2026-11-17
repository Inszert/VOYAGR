import { expect, test, type Locator, type Page } from '@playwright/test';
import { axeFindings, waitForEntranceMotion } from './support/axe';
import { watchRequests } from './support/requests';
import { aSearch, closeSearch, hydrated, openSearch } from './support/searches';

/**
 * Search end to end.
 *
 * The claim under test is the one Phase 1.2 is finished against: a user can run
 * a search and understand why the top result ranks first. That means the form
 * works, the results are real, the numbers are explained, and the warnings are
 * visible before anyone clicks anything.
 *
 * The form is a GET form, so a search is also a URL. Several tests navigate
 * straight to one, which is exactly what a shared or bookmarked search does.
 */

// Dates relative to the day the suite runs - see `support/searches`.
const SEARCH = aSearch();
const A_SEARCH = SEARCH.path;

/**
 * The results, once they are on the page.
 *
 * Counting `article`s straight after `goto` read zero on a busy machine: the
 * count does not retry, and the results are not necessarily painted at load.
 * Waiting for the first one is what makes a later count mean something.
 */
async function resultsOn(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByRole('article').first()).toBeVisible();
}

/**
 * Wait until the stage has finished building itself.
 *
 * The globe defers its WebGL setup to the first idle moment, so on a machine
 * running several browsers at once the main thread can be busy for a while
 * after load. A test that presses a link in that window is measuring the
 * machine rather than the product. Waiting for the globe to have drawn is the
 * signal that the page has stopped working.
 */
async function settled(page: import('@playwright/test').Page): Promise<void> {
  // The canvas appears as soon as MapLibre is constructed; a chip appears only
  // once the style has loaded and the markers have been placed, which is the
  // end of the heavy work rather than the start of it.
  await page.locator('a[data-destination]').first().waitFor({ state: 'attached', timeout: 20_000 });
  await page.waitForLoadState('networkidle');

  /*
   * And the panel's own controls are live.
   *
   * A chip proves the globe has mounted; it does not prove the lens row has,
   * and pressing a key on a link whose handler has not attached yet is a test
   * measuring how busy the machine is. The row sets `data-ready` from its own
   * effect, so this waits for the thing under test to be interactive rather
   * than for a proxy that happens to correlate with it.
   */
  await page
    .locator('nav[aria-label="Kind of trip"] [data-ready]')
    .waitFor({ state: 'attached', timeout: 20_000 });
}

/**
 * The first Friday-to-Sunday the form will actually accept, as two dates.
 *
 * The date fields carry `min`, so the browser itself refuses a departure in
 * the past and a return before the trip starts - which is the point of them. A
 * test that types a fixed date is therefore only a test until that date
 * passes, and one that computes a date without reading those bounds fails the
 * moment the form's own defaults move past it. So the bound is read off the
 * page and the weekend is found from there.
 *
 * Counted in UTC, because these are calendar dates and a local-midnight round
 * trip is how they drift by a day.
 */
function weekendOnOrAfter(earliest: string): { friday: string; sunday: string } {
  const day = Date.UTC(
    Number(earliest.slice(0, 4)),
    Number(earliest.slice(5, 7)) - 1,
    Number(earliest.slice(8, 10)),
  );

  // 5 is Friday.
  const friday = day + ((((5 - new Date(day).getUTCDay()) % 7) + 7) % 7) * 86_400_000;
  const iso = (value: number) => new Date(value).toISOString().slice(0, 10);

  return { friday: iso(friday), sunday: iso(friday + 2 * 86_400_000) };
}

/**
 * The trip's summary: the panel beside the legs on a wide screen, the sheet
 * the bottom bar opens on a phone.
 */
async function openSummary(page: Page) {
  // The summary is drawn with the results; asking before they are on the page
  // reads "not there" and sends a desktop down the phone's path.
  await expect(page.getByRole('article').first()).toBeVisible();
  const panel = page.getByRole('complementary', { name: 'Trip summary' });
  if (await panel.isVisible()) return panel;
  await page.locator('#your-trip').scrollIntoViewIfNeeded();
  await page
    .getByRole('button', { name: /per person/ })
    .first()
    .click();
  return page.getByRole('dialog', { name: 'Your trip, in total' });
}

/**
 * The search's own destinations, as they can be reached from the builder.
 *
 * The mock flight source answers one to three flights per route and date, so
 * on any given day the top trip to one place may have nothing to swap to. What
 * is under test is that a swap works when there is one, so this looks through
 * the three places for the first whose top trip has more than one choice for
 * the leg, and fails loudly if none does.
 */
async function tripWithChoices(
  page: Page,
  leg: RegExp,
  change: string,
): Promise<{ region: Locator; options: Locator }> {
  for (const code of ['AYT', 'CHQ', 'SPU']) {
    await page.goto(`${A_SEARCH}&fDest=${code}`);
    const trip = page.locator('#your-trip');
    if ((await trip.count()) === 0) continue;

    const region = trip.getByRole('region', { name: leg }).first();
    await region.getByRole('button', { name: change }).click();
    const options = region.getByRole('radio');
    // Open once its button says so; a place with nothing to swap to says that instead.
    await expect(region.getByRole('button', { name: /^Done changing/ })).toBeVisible();
    if ((await options.count()) > 1) return { region, options };
  }
  throw new Error(`none of the three places had a top trip with another ${change}`);
}

/** The figure a leg's row promised the whole trip would cost, and which row it was. */
async function promisedBy(options: Locator): Promise<{ index: number; trip: string }> {
  const count = await options.count();
  for (let index = 0; index < count; index += 1) {
    if (await options.nth(index).isChecked()) continue;
    const row = await options.nth(index).locator('xpath=ancestor::label').innerText();
    const trip = /trip (€[\d,.]+)/.exec(row)?.[1];
    if (!trip) throw new Error(`a row promised no trip total: ${row}`);
    return { index, trip };
  }
  throw new Error('every row was the current one');
}

test.describe('discovery', () => {
  test('opens on the world, priced, for someone who does not know where they want to go', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { level: 1, name: /See where you can go/ }),
    ).toBeVisible();
    // The globe in words: a region of destinations, each with a price, before
    // anyone has typed anything.
    const rail = page.getByRole('region', { name: /destinations, ranked by/ });
    await expect(rail).toBeVisible();
    expect(await rail.getByRole('listitem').count()).toBeGreaterThan(1);
    await expect(rail.getByText(/Priced for \d travellers? from VIE/)).toBeVisible();

    // D20: honesty is in the words, not a chip. Every price is a "from" price,
    // and nothing on the rail is labelled as demo data.
    await expect(rail.getByRole('link', { name: /, from €\d[\d,.]*/ }).first()).toBeVisible();
    await expect(rail.getByText('Demo data')).toHaveCount(0);
    await expect(rail.getByText('Indicative')).toHaveCount(0);
  });

  test('offers the lenses as links across the top of the search', async ({ page }) => {
    await page.goto('/');

    // The lenses are folded into the search until it is opened.
    const lenses = page.getByRole('navigation', { name: 'Kind of trip' });
    await expect(lenses).toBeHidden();
    await openSearch(page);
    await expect(lenses).toBeVisible();
    await expect(lenses.getByRole('link', { name: /Beach escapes/ })).toBeVisible();
  });

  test('picking a lens runs a search ranked that way', async ({ page }) => {
    // Section 6: choosing a category must immediately affect the search.
    await page.goto('/');
    await settled(page);
    await openSearch(page);
    await page.getByRole('link', { name: /Travel cheaply/ }).click();

    // A lens is a whole search, fanned out across every destination the
    // catalogue can price, and this is the first one the server has run. The
    // default timeout is for a page that is already there; this is waiting on
    // work, and on a machine running several browsers at once it is slower
    // than the assertion below it.
    await expect(page.getByRole('heading', { name: /trips? match|No trip matched/ })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('link', { name: 'Change search' }).click();
    await openSearch(page);
    await page.locator('summary', { hasText: 'More options' }).click();
    await expect(page.getByRole('combobox', { name: 'Optimise for' })).toHaveValue('cheapest');
  });

  test('keeps the globe on the page once there are results', async ({ page }) => {
    // The results are a continuation of the globe, not a different page.
    await page.goto(A_SEARCH);

    await expect(
      page.getByRole('heading', { level: 1, name: /Your trips, on the map/ }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /trips? match/ })).toBeVisible();

    // Every destination of the search is a chip on the same globe, and a link:
    // the canvas is decoration, the facts are in the page.
    await expect(page.locator('a[data-destination]').first()).toBeAttached({ timeout: 20_000 });
    // The search's three places are pins that narrow to them; the other
    // names on the planet are labels that open the search for that place.
    await expect(page.locator('a[data-destination][href*="fDest="]')).toHaveCount(3);
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  });

  test('works with the keyboard and carries nothing hidden', async ({ page }) => {
    await page.goto('/');
    await settled(page);
    await openSearch(page);

    const lens = page.getByRole('link', { name: /City breaks/ });
    await lens.focus();
    await expect(lens).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/travelStyle=explore/);
    await page.getByRole('link', { name: 'Change search' }).click();
    await openSearch(page);
    await page.locator('summary', { hasText: 'More options' }).click();
    await expect(page.getByRole('combobox', { name: 'Travel style' })).toHaveValue('explore');
  });
});

test.describe('running a search', () => {
  test('submits the form and returns ranked trips', async ({ page }) => {
    await page.goto('/');
    await waitForEntranceMotion(page);

    await page.getByRole('button', { name: 'Search trips' }).click();

    await expect(page.getByRole('heading', { name: /trips? match/ })).toBeVisible();
    await expect(page.getByRole('article').first()).toBeVisible();

    // A GET form means the search survives a reload and can be shared.
    await expect(page).toHaveURL(/origins=VIE/);
  });

  test('restores a search from its URL', async ({ page }) => {
    // The address a search from the form produces, dates and all.
    await page.goto(`${A_SEARCH}&departureDate=${SEARCH.earliest}&returnDate=${SEARCH.latest}`);

    await expect(page.getByRole('heading', { name: /trips? match/ })).toBeVisible();
    // The results carry no form; the one "Change search" opens is filled in
    // from the URL, so nothing about the search is lost on the way.
    await page.getByRole('link', { name: 'Change search' }).click();
    await openSearch(page);
    await expect(page.getByRole('combobox', { name: /^From/ })).toHaveValue('VIE');
    await expect(page.getByRole('combobox', { name: /^To/ })).toHaveValue('AYT, CHQ, SPU');
    await expect(page.getByLabel('Leaving')).toHaveValue(SEARCH.earliest);
    await expect(page.getByLabel('Back', { exact: true })).toHaveValue(SEARCH.latest);
  });

  test('keeps an old address on the front page working', async ({ page }) => {
    // Searches used to live at `/`. Links people saved or shared must still
    // land on their results rather than on an empty form.
    await page.goto(A_SEARCH.replace('/explore', '/'));

    await expect(page).toHaveURL(/\/explore\?/);
    await expect(page.getByRole('heading', { name: /trips? match/ })).toBeVisible();
  });

  test('draws each flight as a leg of one journey, with its own times', async ({ page }) => {
    await page.goto(A_SEARCH);

    const top = page.getByRole('article').first();

    // Both legs, each with the clock times the provider gave and what the
    // routing actually is: two clock faces, there and back - never the
    // departure printed twice for the arrival.
    for (const name of [/^Outbound/, /^Return/]) {
      const leg = top.getByRole('region', { name }).first();
      await expect(leg).toContainText(/\d{2}:\d{2}[\s\S]*\d{2}:\d{2}/);
      await expect(leg.getByText(/^\d+h( \d+m)?$/).first()).toBeVisible();
      await expect(leg.getByText(/^(Direct|\d+ stops?( in .+)?)$/).first()).toBeVisible();
    }

    // And the price says what it is worth against the limit that was set.
    const summary = await openSummary(page);
    await expect(summary.getByText(/(under|over) your maximum/)).toBeVisible();
    await expect(summary.getByText(/^Total for \d travellers?$/)).toBeVisible();
  });

  test('explains why the top result ranks where it does', async ({ page }) => {
    await page.goto(A_SEARCH);

    const top = page.getByRole('article').first();

    // The score and its reasons are one click away, never absent.
    await expect(top.getByRole('heading', { name: 'Why this trip?' })).toBeVisible();
    await top.getByText(/How the score of \d+ adds up/).click();
    await expect(top.getByRole('rowheader', { name: 'Budget fit' })).toBeVisible();
    await expect(top.getByText('Complete Trip Value Score')).toBeVisible();
  });

  test('shows every cost line with its confidence', async ({ page }) => {
    await page.goto(A_SEARCH);

    const top = page.getByRole('article').first();
    await top.getByText('Full cost breakdown').click();

    await expect(top.getByRole('columnheader', { name: 'Confidence' })).toBeVisible();
    await expect(top.getByText('Of which quoted by a provider')).toBeVisible();
    // An estimate must never be presentable as a quote: every line carries its
    // own confidence, and at least one of them is a provider's quote.
    await expect(top.getByRole('cell', { name: /Quoted/ }).first()).toBeVisible();
  });

  test('shows the No-Surprise warnings without the user opening anything', async ({ page }) => {
    await page.goto(A_SEARCH);

    const top = page.getByRole('article').first();
    await expect(top.getByRole('heading', { name: 'Good to know' })).toBeVisible();
    // A checklist in words, not "Severity" badges.
    await expect(top.getByText(/Severity/)).toHaveCount(0);
  });

  test('keeps a rejected form usable and says what was wrong', async ({ page }) => {
    await page.goto('/');

    await openSearch(page);
    const origins = page.getByRole('combobox', { name: /^From/ });
    await origins.fill('VIENNA');
    await page.getByRole('button', { name: 'Search trips' }).click();

    await expect(origins).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Use three-letter airport codes, such as VIE.')).toBeVisible();
    // What the user typed comes back, rather than being thrown away.
    await expect(origins).toHaveValue('VIENNA');
  });

  test('explains an empty result set instead of showing nothing', async ({ page }) => {
    await page.goto(
      A_SEARCH.replace('targetBudget=650', 'targetBudget=40').replace(
        'maxBudget=850',
        'maxBudget=60',
      ),
    );

    await expect(page.getByRole('heading', { name: 'No trip matched' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Close, but outside your limits' }),
    ).toBeVisible();
    await expect(page.getByText(/exceeds the maximum budget/).first()).toBeVisible();
  });

  test('offers alternative flights priced as whole trips, and swaps one in', async ({ page }) => {
    // Phase 1.10: a swap recalculates everything, and each option says what
    // the whole trip would cost with it - never just what the flight costs.
    const { region, options } = await tripWithChoices(page, /^Outbound/, 'Change outbound flight');

    await expect(options.first()).toBeVisible();
    // The current choice in a word, not by colour alone.
    await expect(region.getByText('Selected')).toBeVisible();
    await expect(region.getByText(/^trip €[\d,.]+$/).first()).toBeVisible();
    await expect(region.getByText(/^(\+ €|− €)[\d,.]+$|^same price$/).first()).toBeVisible();

    // Choosing one swaps it in, and the total becomes the figure the row promised.
    const { index, trip } = await promisedBy(options);
    const chosen = await options.nth(index).getAttribute('value');
    await options.nth(index).check();

    await expect(page).toHaveURL(/tFlight=/);
    await expect(page.getByRole('radio', { checked: true }).first()).toHaveValue(chosen ?? '');
    await expect(
      page.locator('[aria-live="polite"]').filter({ hasText: /Trip total is now/ }),
    ).toContainText(trip);
  });

  test('offers alternative hotels the same way, and swaps one in', async ({ page }) => {
    const { region, options } = await tripWithChoices(page, /^Stay/, 'Change stay');

    await expect(region.getByText(/^(\+ €|− €)[\d,.]+$|^same price$/).first()).toBeVisible();

    const { index, trip } = await promisedBy(options);
    const chosen = await options.nth(index).getAttribute('value');
    await options.nth(index).check();

    await expect(page).toHaveURL(/tHotel=/);
    await expect(page.getByRole('radio', { checked: true }).first()).toHaveValue(chosen ?? '');
    await expect(
      page.locator('[aria-live="polite"]').filter({ hasText: /Trip total is now/ }),
    ).toContainText(trip);
  });

  test('carries no demo banner or source badge on a trip', async ({ page }) => {
    // D20: honesty is in the words - "from", "Updated", and what a total
    // leaves out - not in a chip. Provenance stays in the data model.
    await page.goto(A_SEARCH);

    await expect(page.getByRole('note')).toHaveCount(0);
    const card = await openSummary(page);
    await expect(card.getByText('from', { exact: true })).toBeVisible();
    await expect(card.getByText('Demo data')).toHaveCount(0);
    await expect(card.getByText('DEMO', { exact: false })).toHaveCount(0);
  });

  test('narrows results without searching again', async ({ page }) => {
    // Section 10. Filters remove trips the search already paid for; re-running
    // it per chip would cost provider calls.
    await page.goto(A_SEARCH);
    await resultsOn(page);
    const before = await page.getByRole('article').count();

    // On a phone the filter panel starts closed behind its "Filters" toggle; on
    // desktop it starts open. Wait for hydration first, because the server HTML
    // shows the panel open and only the client closes it on a phone.
    const filtersToggle = page.getByRole('button', { name: 'Filters', exact: true });
    await hydrated(filtersToggle);
    if ((await filtersToggle.getAttribute('aria-expanded')) === 'false') {
      await filtersToggle.click();
    }

    // Clicked by its label, which is what a user does: the input itself is
    // visually hidden so the chip can be styled, and only the label is a
    // pointer target.
    await page
      .getByText(/^Narrow these results/)
      .first()
      .click();
    await page.locator('label', { hasText: 'Direct only' }).click();
    await page.getByRole('button', { name: 'Apply filters' }).click();

    await expect(page.getByRole('checkbox', { name: 'Direct only' })).toBeChecked();
    // The filter is in the URL, so the narrowed view is shareable.
    await expect(page).toHaveURL(/fDirect=on/);
    // And the search behind it is unchanged.
    await expect(page).toHaveURL(/origins=VIE/);

    await resultsOn(page);
    const after = await page.getByRole('article').count();
    expect(after).toBeLessThanOrEqual(before);
  });

  test('says when its filters hid everything, and offers a way back', async ({ page }) => {
    await page.goto(`${A_SEARCH}&fMaxTotal=1`);

    await expect(page.getByRole('heading', { name: 'Your filters hid every trip' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Clear the filters' })).toBeVisible();
  });

  test('explains a trip in words rather than as a score', async ({ page }) => {
    await page.goto(A_SEARCH);

    const top = page.getByRole('article').first();
    await expect(top.getByRole('heading', { name: 'Why this trip?' })).toBeVisible();
    // The score is explained in a sentence before it is a number.
    await expect(top.getByText(/\d+ out of 100/)).toBeVisible();
    // The weather, in words, and honest about being typical rather than forecast.
    await expect(top.getByText(/typical for these dates|forecast/i).first()).toBeVisible();
    // And what the trip costs, line by line, is one disclosure away.
    await top.getByText('Full cost breakdown').click();
    await expect(top.getByRole('columnheader', { name: 'Confidence' })).toBeVisible();
    // The transfer is a line of its own there, counted or said to be left out.
    const table = top.getByRole('table').filter({
      has: page.getByRole('columnheader', { name: 'Confidence' }),
    });
    await expect(table.getByRole('rowheader', { name: 'Airport transfer' })).toBeVisible();
  });

  test('is operable by keyboard alone', async ({ page }) => {
    await page.goto(A_SEARCH);
    await expect(page.getByRole('article').first()).toBeVisible();

    // A disclosure opens with Enter.
    const summary = page.getByText('Full cost breakdown').first();
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('columnheader', { name: 'Confidence' }).first()).toBeVisible();
  });

  test('changing a leg works from the keyboard, and keeps its place', async ({ page }) => {
    const { region, options } = await tripWithChoices(page, /^Outbound/, 'Change outbound flight');
    // Fold it from its own button, as a keyboard user would, to start from rest.
    const toggle = region.getByRole('button', { name: /changing the outbound flight$/ });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(options.first()).toBeHidden();
    await expect(region.getByRole('button', { name: 'Change outbound flight' })).toBeFocused();

    // Enter opens it; Tab reaches the sort chips and then the choices.
    await page.keyboard.press('Enter');
    await expect(options.first()).toBeVisible();
    for (let step = 0; step < 6; step += 1) {
      if ((await page.evaluate(() => document.activeElement?.getAttribute('type'))) === 'radio') {
        break;
      }
      await page.keyboard.press('Tab');
    }
    await expect(page.locator(':focus')).toHaveAttribute('type', 'radio');

    // An arrow key chooses the next one, and the page that follows still has
    // the keyboard where it was: on a choice, not on the body.
    const before = await page.locator(':focus').getAttribute('value');
    await page.keyboard.press('ArrowDown');
    await expect(page).toHaveURL(/tFlight=/);
    await expect(page.locator(':focus')).toHaveAttribute('type', 'radio');
    await expect(page.locator(':focus')).not.toHaveAttribute('value', before ?? '');

    // Escape folds the panel and hands focus back to its button.
    await page.keyboard.press('Escape');
    await expect(options.first()).toBeHidden();
    await expect(region.getByRole('button', { name: 'Change outbound flight' })).toBeFocused();
  });

  test('has no detectable accessibility violations with results on screen', async ({ page }) => {
    await page.goto(A_SEARCH);
    await expect(page.getByRole('article').first()).toBeVisible();

    await waitForEntranceMotion(page);

    expect(await axeFindings(page)).toEqual([]);
  });
});

test.describe('the trip summary on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('is a bar with the total, and a sheet that holds focus and gives it back', async ({
    page,
  }) => {
    await page.goto(A_SEARCH);
    await expect(page.getByRole('article').first()).toBeVisible();

    // Away from the trip there is no bar; at it, there is, and it names the total.
    const bar = page.getByRole('button', { name: /per person/ }).first();
    await expect(bar).toBeHidden();
    await page.locator('#your-trip').scrollIntoViewIfNeeded();
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(/€[\d,.]+/);

    // Opened from the keyboard, the sheet is a dialog that the focus stays inside.
    await bar.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: 'Your trip, in total' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/^Total for \d travellers?$/)).toBeVisible();
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab');
      expect(await sheet.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }

    // Escape closes it and the keyboard is back on the bar.
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(bar).toBeFocused();
  });
});

test.describe('flexible dates', () => {
  test('shows what the dates are worth, and says what it sampled', async ({ page }) => {
    await page.goto(A_SEARCH);

    const section = page.getByRole('region', { name: 'Pick your dates' });
    await expect(section).toBeVisible();

    // The sample is stated. Eight rows presented as a whole calendar would be
    // a chart lying about its own resolution.
    await expect(section.getByText(/Priced \d+ of the \d+ date combinations/)).toBeVisible();
  });

  test('narrows to one set of dates without running another search', async ({ page }) => {
    await page.goto(A_SEARCH);

    const section = page.getByRole('region', { name: 'Pick your dates' });
    await resultsOn(page);
    const before = await page.getByRole('article').count();

    // The picks above the calendar are links that narrow to one set of dates.
    await section.locator('dl a').first().click();

    await expect(page).toHaveURL(/fDates=/);
    // The search itself is untouched, so no provider call was made for this.
    await expect(page).toHaveURL(/origins=VIE/);
    await expect(page.getByRole('link', { name: 'Show every date' })).toBeVisible();
    await resultsOn(page);
    expect(await page.getByRole('article').count()).toBeLessThanOrEqual(before);
  });

  test('offers the flexibility presets without opening anything', async ({ page }) => {
    await page.goto('/');

    // The presets are a radio group on the search itself, one tap each, a
    // fold away from the bar.
    await openSearch(page);
    const flexibility = page.getByRole('radiogroup', { name: 'Dates' }).first();
    await expect(flexibility).toBeVisible();
    await expect(flexibility.getByRole('radio', { name: /A long weekend/ })).toHaveCount(1);
  });

  test('a weekend search returns only weekend trips', async ({ page }) => {
    // A weekend search is a URL like any other, so it is asked for as one: the
    // first Friday-to-Sunday three weeks out, counted in UTC.
    const earliest = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
    const { friday, sunday } = weekendOnOrAfter(earliest);

    // The preset widens the two dates a person typed, so they are in the
    // address - as the search form writes them. A preset without them is
    // refused by design ("Enter the date you would like to leave").
    await page.goto(
      '/explore?origins=VIE&destinations=AYT&earliestDeparture=' +
        friday +
        '&latestReturn=' +
        sunday +
        '&departureDate=' +
        friday +
        '&returnDate=' +
        sunday +
        '&minNights=2&maxNights=2&passengers=2&currency=EUR&targetBudget=650&maxBudget=850' +
        '&travelStyle=balanced&optimisationMode=best_value&flexibility=weekend',
    );

    const section = page.getByRole('region', { name: 'Pick your dates' });
    await expect(section).toBeVisible();

    // Every window offered departs on a Friday or Saturday and returns on a
    // Sunday. Saturday to Monday is two nights from a Saturday, which is a day
    // off work rather than a weekend.
    const picks = await section.locator('dl a').allInnerTexts();
    expect(picks.length).toBeGreaterThan(0);
    for (const text of picks) {
      expect(text).toMatch(/^(Fri|Sat) /);
      expect(text).toContain('Sun ');
    }
  });

  test('has no accessibility violations across the date comparison', async ({ page }) => {
    await page.goto(A_SEARCH);
    await expect(page.getByRole('region', { name: 'Pick your dates' })).toBeVisible();

    expect(
      await axeFindings(page, { include: '[aria-labelledby="date-options-heading"]' }),
    ).toEqual([]);
  });
});

test.describe('the globe', () => {
  test('answers "where can I go" without any JavaScript drawing it', async ({ page }) => {
    // The canvas is decoration; the rail is the content. Every destination on
    // the globe is here too, in the same order, with the same figures.
    await page.goto('/');

    const rail = page.getByRole('region', { name: /destinations, ranked by/ });
    await expect(rail).toBeVisible();

    const entries = rail.getByRole('listitem');
    expect(await entries.count()).toBeGreaterThan(1);
    // Each one is a way into a search for that place, with its price in the name.
    await expect(
      rail.getByRole('link', { name: /^Search trips to .+, from €\d/ }).first(),
    ).toHaveAttribute('href', /destinations=[A-Z]{3}/);
  });

  test('explains why each destination appears', async ({ page }) => {
    await page.goto('/explore?mapMode=cheapest');

    const rail = page.getByRole('region', { name: /ranked by cheapest/ });
    // Section 14: do not hide the optimisation logic.
    await expect(rail.getByText(/Cheapest trip found here/).first()).toBeVisible();
  });

  test('reorders when the ranking changes, and says so in the URL', async ({ page }) => {
    await page.goto('/');

    await page
      .getByRole('navigation', { name: 'Rank by' })
      .getByRole('link', { name: 'Fastest' })
      .click();

    await expect(page).toHaveURL(/mapMode=fastest/);
    const rail = page.getByRole('region', { name: /ranked by fastest/ });
    await expect(rail.getByText(/in the air, there and back/).first()).toBeVisible();
  });

  test('narrows to a destination without running another search', async ({ page }) => {
    await page.goto(A_SEARCH);
    await resultsOn(page);

    // On the results the globe's chips are the way to narrow to one place.
    // Only the ones on the near side of the planet can be pressed.
    const chip = page
      .locator('a[data-destination][href*="fDest="]')
      .locator('visible=true')
      .first();
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await expect(chip).toHaveAttribute('href', /fDest=[A-Z]{3}/);
    await chip.click();

    await expect(page).toHaveURL(/fDest=[A-Z]{3}/);
    await expect(page).toHaveURL(/origins=VIE/);
  });

  test('says what it cannot yet compare', async ({ page }) => {
    await page.goto('/');

    const rail = page.getByRole('region', { name: /destinations, ranked by/ });
    await expect(rail.getByText(/Flights only for now/)).toBeVisible();
  });

  test('draws a globe from data we ship, reaching nobody', async ({ page }) => {
    const requests = watchRequests(page);

    await page.goto('/');
    await expect(page.getByRole('region', { name: /destinations, ranked by/ })).toBeVisible();

    // The canvas is present and the style actually loaded - the failure this
    // guards is a map that renders a background and silently never loads a
    // source, which looks like an empty ocean rather than like a bug.
    const canvas = page.locator('.maplibregl-canvas');
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    // The style actually loaded, which is the thing the blank-ocean failure
    // hides: a chip is only placed once the map has a style and a source.
    await expect(page.locator('a[data-destination]').first()).toBeAttached({ timeout: 15_000 });

    // No tile server, no API key, no third party in the render path.
    expect(requests.external).toEqual([]);
  });

  test('puts every price on the globe as a link, in the words of a price', async ({ page }) => {
    await page.goto('/');

    const chips = page.locator('a[data-destination]');
    // Every destination has a chip. Some are hidden at any one moment - behind
    // the planet, or overlapping a better-ranked one - so the visible set is
    // asked for separately rather than assuming the first one is on screen.
    const visible = chips.locator('visible=true');
    await expect(visible.first()).toBeVisible({ timeout: 15_000 });

    // The destinations list by name: the band also holds the ranking
    // controls, which are a list of their own.
    const rail = page.getByRole('region', { name: /destinations, ranked by/ });
    // The mosaic holds the first cards and a second rail the rest, so a
    // destination is a list item in one of the two; together they are the chips.
    const listed = rail.getByRole('list', {
      name: /^(Destinations|From .+ tonight|More places to go)$/,
    });
    expect(await chips.count()).toBe(await listed.getByRole('listitem').count());

    // D20: no provenance chip. A price says "from", and the destination it
    // belongs to is in the link.
    const chip = visible.first();
    await expect(chip).toContainText(/from €\d/);
    await expect(chip).not.toContainText(/Indicative|DEMO/);
    await expect(chip).toHaveAttribute('href', /destinations=[A-Z]{3}/);
  });

  test('selects a country without the globe, and narrows the rail to it', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('combobox', { name: 'Explore a country' }).selectOption('ESP');
    await page.getByRole('button', { name: 'Go' }).click();

    await expect(page).toHaveURL(/country=ESP/);
    await expect(page.getByRole('region', { name: /\d+ places? priced in Spain/ })).toBeVisible();
    // The search follows the selection: its destinations are Spain's airports.
    await openSearch(page);
    await expect(page.getByRole('combobox', { name: /^To/ })).toHaveValue('PMI');
    await expect(page.getByText("Spain's airports, or any codes.")).toBeVisible();

    // Open, the search covers the globe's own controls on a phone; closed again,
    // the way back to the whole world is reachable.
    await closeSearch(page);

    await page
      .getByRole('link', { name: /Show the whole world/ })
      .first()
      .click();
    await expect(page).not.toHaveURL(/country=/);
  });

  test('says plainly when a country has nothing priced', async ({ page }) => {
    // Eritrea has no airport in the catalogue, so nothing there can be priced.
    await page.goto('/?country=ERI');

    await expect(
      page.getByRole('heading', { name: 'Nothing priced in Eritrea yet' }),
    ).toBeVisible();
  });

  test('has no accessibility violations across the stage and the rail', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    // Judged on the settled page, after the entrance motion has finished.
    await waitForEntranceMotion(page);

    expect(
      await axeFindings(page, {
        include: ['[aria-labelledby="stage-heading"]', '[aria-labelledby="rail-heading"]'],
      }),
    ).toEqual([]);
  });
});
