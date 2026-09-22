import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { watchRequests } from './support/requests';

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

const A_SEARCH =
  '/?origins=VIE&destinations=AYT%2C+CHQ%2C+SPU&earliestDeparture=2026-06-01' +
  '&latestReturn=2026-06-30&minNights=4&maxNights=7&passengers=2&currency=EUR' +
  '&targetBudget=650&maxBudget=850&travelStyle=balanced&optimisationMode=best_value';

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

test.describe('discovery', () => {
  test('opens on the world, priced, for someone who does not know where they want to go', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { level: 1, name: /See where you can go/ }),
    ).toBeVisible();
    // The globe in words: a region of destinations, each with a price and its
    // provenance, before anyone has typed anything.
    const rail = page.getByRole('region', { name: /destinations, ranked by/ });
    await expect(rail).toBeVisible();
    expect(await rail.getByRole('listitem').count()).toBeGreaterThan(1);
    await expect(rail.getByText('Demo data').first()).toBeVisible();
    await expect(rail.getByText(/Priced for \d travellers? from VIE/)).toBeVisible();
  });

  test('offers the lenses as links across the top of the search', async ({ page }) => {
    await page.goto('/');

    const lenses = page.getByRole('navigation', { name: 'Kind of trip' });
    await expect(lenses).toBeVisible();
    await expect(lenses.getByRole('link', { name: /Beach escapes/ })).toBeVisible();
  });

  test('picking a lens runs a search ranked that way', async ({ page }) => {
    // Section 6: choosing a category must immediately affect the search.
    await page.goto('/');
    await settled(page);
    await page.getByRole('link', { name: /Travel cheaply/ }).click();

    // A lens is a whole search, fanned out across every destination the
    // catalogue can price, and this is the first one the server has run. The
    // default timeout is for a page that is already there; this is waiting on
    // work, and on a machine running several browsers at once it is slower
    // than the assertion below it.
    await expect(page.getByRole('heading', { name: /trips? match|No trip matched/ })).toBeVisible({
      timeout: 20_000,
    });
    await page.locator('summary', { hasText: 'More options' }).click();
    await expect(page.getByRole('combobox', { name: 'Optimise for' })).toHaveValue('cheapest');
  });

  test('keeps the globe on the page once there are results', async ({ page }) => {
    // The results are a continuation of the globe, not a different page.
    await page.goto(A_SEARCH);

    await expect(
      page.getByRole('heading', { level: 1, name: /Your trips, on the map/ }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: /destinations, ranked by/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /trips? match/ })).toBeVisible();
  });

  test('works with the keyboard and carries nothing hidden', async ({ page }) => {
    await page.goto('/');
    await settled(page);

    const lens = page.getByRole('link', { name: /City breaks/ });
    await lens.focus();
    await expect(lens).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/travelStyle=explore/);
    await page.locator('summary', { hasText: 'More options' }).click();
    await expect(page.getByRole('combobox', { name: 'Travel style' })).toHaveValue('explore');
  });
});

test.describe('running a search', () => {
  test('submits the form and returns ranked trips', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Search trips' }).click();

    await expect(page.getByRole('heading', { name: /trips? match/ })).toBeVisible();
    await expect(page.getByRole('article').first()).toBeVisible();

    // A GET form means the search survives a reload and can be shared.
    await expect(page).toHaveURL(/origins=VIE/);
  });

  test('restores a search from its URL', async ({ page }) => {
    await page.goto(A_SEARCH);

    await expect(page.getByRole('heading', { name: /trips? match/ })).toBeVisible();
    await expect(page.getByRole('combobox', { name: /^From/ })).toHaveValue('VIE');
  });

  test('draws each flight as a route, the way the globe does', async ({ page }) => {
    await page.goto(A_SEARCH);

    const top = page.getByRole('article').first();

    // Both legs, each with the clock times the provider gave and what the
    // routing actually is. The shape of the journey is the thing somebody
    // comparing trips reads, and it is the shape they clicked to get here.
    await expect(top.getByText(/^\d{2}:\d{2}$/).first()).toBeVisible();
    expect(await top.getByText(/^\d{2}:\d{2}$/).count()).toBeGreaterThanOrEqual(4);
    await expect(top.getByText(/\d+h( \d+m)? · (direct|\d+ stops? in)/).first()).toBeVisible();

    // And the price says what it is worth against the limit that was set.
    await expect(top.getByText(/(under|over) your maximum/)).toBeVisible();
  });

  test('explains why the top result ranks where it does', async ({ page }) => {
    await page.goto(A_SEARCH);

    const top = page.getByRole('article').first();

    await expect(top.getByRole('heading', { name: 'Why this trip?' })).toBeVisible();

    // The score breaks down into the factors that produced it, on demand.
    const scoreDisclosure = top.getByText(/How the score of \d+ was calculated/);
    await scoreDisclosure.click();
    await expect(top.getByRole('rowheader', { name: 'Budget fit' })).toBeVisible();
    await expect(top.getByText('Complete Trip Value Score')).toBeVisible();
  });

  test('shows every cost line with its confidence', async ({ page }) => {
    await page.goto(A_SEARCH);

    const top = page.getByRole('article').first();
    await top.getByText('Full cost breakdown').click();

    await expect(top.getByRole('columnheader', { name: 'Confidence' })).toBeVisible();
    await expect(top.getByText('Of which quoted by a provider')).toBeVisible();
    // An estimate must never be presentable as a quote.
    await expect(top.getByText('Quoted').first()).toBeVisible();
  });

  test('shows the No-Surprise warnings without the user opening anything', async ({ page }) => {
    await page.goto(A_SEARCH);

    const top = page.getByRole('article').first();
    await expect(top.getByRole('heading', { name: 'Before you book' })).toBeVisible();
  });

  test('keeps a rejected form usable and says what was wrong', async ({ page }) => {
    await page.goto('/');

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

  test('offers alternative flights priced as whole trips', async ({ page }) => {
    // Phase 1.10: a swap recalculates everything, and the list says what the
    // trip would cost and score - never just what the flight costs.
    await page.goto(A_SEARCH);

    const top = page.getByRole('article').first();

    // Scoped to this panel: a bare `.first()` on the card would happily match
    // text inside one of the other, still-closed disclosures. Located by the
    // `details` element the Disclosure component is documented to render,
    // because browsers do not agree on exposing it as a named `group` role.
    const panel = top.locator('details', { hasText: 'Change the flight' });
    await panel.getByText('Change the flight').click();

    await expect(panel.getByText('Chosen')).toBeVisible();
    await expect(panel.getByText(/total/).first()).toBeVisible();
    await expect(panel.getByText(/score \d+/).first()).toBeVisible();
  });

  test('offers alternative hotels the same way', async ({ page }) => {
    await page.goto(A_SEARCH);

    const top = page.getByRole('article').first();
    const panel = top.locator('details', { hasText: 'Change the hotel' });
    await panel.getByText('Change the hotel').click();

    await expect(panel.getByText(/cheaper|more|Same price/).first()).toBeVisible();
  });

  test('says plainly that the data is not real', async ({ page }) => {
    // 1.10.1 section 4: never pretend mock data is live data. Every provider
    // is a fixture today, and the page has to lead with that.
    await page.goto(A_SEARCH);

    await expect(page.getByRole('note')).toContainText('these trips are not real');
    await expect(page.getByRole('note')).toContainText('Nothing here can be booked');

    // And beside the price itself, not only at the top of the page.
    await expect(page.getByRole('article').first().getByText('Demo data')).toBeVisible();
  });

  test('narrows results without searching again', async ({ page }) => {
    // Section 10. Filters remove trips the search already paid for; re-running
    // it per chip would cost provider calls.
    await page.goto(A_SEARCH);
    const before = await page.getByRole('article').count();

    // Clicked by its label, which is what a user does: the input itself is
    // visually hidden so the chip can be styled, and only the label is a
    // pointer target.
    await page.getByText('Direct only').click();
    await page.getByRole('button', { name: 'Apply filters' }).click();

    await expect(page.getByRole('checkbox', { name: 'Direct only' })).toBeChecked();
    // The filter is in the URL, so the narrowed view is shareable.
    await expect(page).toHaveURL(/fDirect=on/);
    // And the search behind it is unchanged.
    await expect(page).toHaveURL(/origins=VIE/);

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
    // The at-a-glance figures a card should carry.
    await expect(top.getByText('Airport transfer').first()).toBeVisible();
    await expect(top.getByText('Weather').first()).toBeVisible();
  });

  test('is operable by keyboard alone', async ({ page }) => {
    await page.goto(A_SEARCH);

    const summary = page.getByText('Full cost breakdown').first();
    await summary.focus();
    await expect(summary).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.getByRole('columnheader', { name: 'Confidence' }).first()).toBeVisible();
  });

  test('has no detectable accessibility violations with results on screen', async ({ page }) => {
    await page.goto(A_SEARCH);
    await expect(page.getByRole('article').first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const findings = results.violations.flatMap((violation) =>
      violation.nodes.map(
        (node) => `${violation.id} at ${node.target.join(' ')} — ${node.failureSummary?.trim()}`,
      ),
    );

    expect(findings).toEqual([]);
  });
});

test.describe('flexible dates', () => {
  test('shows what the dates are worth, and says what it sampled', async ({ page }) => {
    await page.goto(A_SEARCH);

    const section = page.getByRole('region', { name: 'What the dates are worth' });
    await expect(section).toBeVisible();

    // The sample is stated. Eight rows presented as a whole calendar would be
    // a chart lying about its own resolution.
    await expect(section.getByText(/Priced \d+ of the \d+ date combinations/)).toBeVisible();
  });

  test('narrows to one set of dates without running another search', async ({ page }) => {
    await page.goto(A_SEARCH);

    const section = page.getByRole('region', { name: 'What the dates are worth' });
    const before = await page.getByRole('article').count();

    await section.getByRole('link').first().click();

    await expect(page).toHaveURL(/fDates=/);
    // The search itself is untouched, so no provider call was made for this.
    await expect(page).toHaveURL(/origins=VIE/);
    expect(await page.getByRole('article').count()).toBeLessThanOrEqual(before);

    await expect(page.getByRole('link', { name: 'Show every date' })).toBeVisible();
  });

  test('offers the flexibility presets without opening anything', async ({ page }) => {
    await page.goto('/');

    const flexibility = page.getByRole('combobox', { name: 'Dates' });
    await expect(flexibility).toBeVisible();
    await expect(flexibility.locator('option', { hasText: 'A long weekend' })).toHaveCount(1);
  });

  test('a weekend search returns only weekend trips', async ({ page }) => {
    await page.goto('/');

    const leaving = page.getByLabel('Leaving');
    const back = page.getByLabel('Back', { exact: true });

    // The return's `min` is the later of the two bounds, so it is the one to
    // clear. Read from the page rather than assumed, because it is the form's
    // own default departure date and that moves with the calendar.
    const earliest = (await back.getAttribute('min')) ?? (await leaving.getAttribute('min'));
    expect(earliest).toBeTruthy();

    const { friday, sunday } = weekendOnOrAfter(earliest!);
    await leaving.fill(friday);
    await back.fill(sunday);
    await page.getByRole('combobox', { name: 'Dates' }).selectOption('weekend');
    await page.getByRole('button', { name: 'Search trips' }).click();

    await expect(page).toHaveURL(/flexibility=weekend/);

    const section = page.getByRole('region', { name: 'What the dates are worth' });
    await expect(section).toBeVisible();

    // Every window offered departs on a Friday or Saturday and returns on a
    // Sunday. Saturday to Monday is two nights from a Saturday, which is a day
    // off work rather than a weekend.
    for (const text of await section.getByRole('link').allInnerTexts()) {
      expect(text).toMatch(/^(Fri|Sat) /);
      expect(text).toContain('Sun ');
    }
  });

  test('has no accessibility violations across the date comparison', async ({ page }) => {
    await page.goto(A_SEARCH);
    await expect(page.getByRole('region', { name: 'What the dates are worth' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('[aria-labelledby="date-options-heading"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});

test.describe('the globe', () => {
  test('answers "where can I go" without any JavaScript drawing it', async ({ page }) => {
    // The canvas is decoration; the rail is the content. Every destination on
    // the globe is here too, in the same order, with the same figures.
    await page.goto(A_SEARCH);

    const rail = page.getByRole('region', { name: /destinations, ranked by/ });
    await expect(rail).toBeVisible();

    const entries = rail.getByRole('listitem');
    expect(await entries.count()).toBeGreaterThan(1);
  });

  test('explains why each destination appears', async ({ page }) => {
    await page.goto(`${A_SEARCH}&mapMode=cheapest`);

    const rail = page.getByRole('region', { name: /ranked by cheapest/ });
    // Section 14: do not hide the optimisation logic.
    await expect(rail.getByText(/Cheapest trip found here/).first()).toBeVisible();
  });

  test('reorders when the ranking changes, and says so in the URL', async ({ page }) => {
    await page.goto(A_SEARCH);

    await page.getByRole('link', { name: 'Fastest' }).click();

    await expect(page).toHaveURL(/mapMode=fastest/);
    const rail = page.getByRole('region', { name: /ranked by fastest/ });
    await expect(rail.getByText(/in the air, there and back/).first()).toBeVisible();
  });

  test('narrows to a destination without running another search', async ({ page }) => {
    await page.goto(A_SEARCH);

    const rail = page.getByRole('region', { name: /destinations, ranked by/ });
    await rail
      .getByRole('link', { name: /^Show only trips to/ })
      .first()
      .click();

    await expect(page).toHaveURL(/fDest=[A-Z]{3}/);
    await expect(page).toHaveURL(/origins=VIE/);
  });

  test('says what it cannot yet compare', async ({ page }) => {
    await page.goto(A_SEARCH);

    const rail = page.getByRole('region', { name: /destinations, ranked by/ });
    await expect(rail.getByText('Flights only for now')).toBeVisible();
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

  test('puts every price on the globe as a link that says where it came from', async ({ page }) => {
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
    const listed = rail.getByRole('list', { name: 'Destinations' });
    expect(await chips.count()).toBe(await listed.getByRole('listitem').count());

    const chip = visible.first();
    await expect(chip).toContainText('Demo data');
    await expect(chip).toHaveAttribute('href', /destinations=[A-Z]{3}/);
  });

  test('selects a country without the globe, and narrows the rail to it', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('combobox', { name: 'Explore a country' }).selectOption('ESP');
    await page.getByRole('button', { name: 'Go' }).click();

    await expect(page).toHaveURL(/country=ESP/);
    await expect(page.getByRole('region', { name: /1 place priced in Spain/ })).toBeVisible();
    // The search follows the selection: its destinations are Spain's airports.
    await expect(page.getByRole('combobox', { name: /^To/ })).toHaveValue('PMI');

    await page.getByRole('link', { name: /Show the whole world/ }).click();
    await expect(page).not.toHaveURL(/country=/);
  });

  test('says plainly when a country has nothing priced', async ({ page }) => {
    await page.goto('/?country=KAZ');

    await expect(
      page.getByRole('heading', { name: 'Nothing priced in Kazakhstan yet' }),
    ).toBeVisible();
  });

  test('has no accessibility violations across the stage and the rail', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    // Judged on the settled page, after the entrance motion has finished.
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => {
        // An ambient loop never finishes, by design: the weather drifting over
        // the page runs for as long as the page is open. What this is waiting
        // for is the entrance motion to have settled, so a card is not sampled
        // mid-fade and reported as low contrast - which is a question only the
        // finite animations can answer.
        const timing = animation.effect?.getComputedTiming();
        if (timing && timing.iterations === Infinity) return true;

        return animation.playState === 'finished';
      }),
    );

    const results = await new AxeBuilder({ page })
      .include('[aria-labelledby="stage-heading"]')
      .include('[aria-labelledby="rail-heading"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const findings = results.violations.flatMap((violation) =>
      violation.nodes.map(
        (node) => `${violation.id} at ${node.target.join(' ')} — ${node.failureSummary?.trim()}`,
      ),
    );

    expect(findings).toEqual([]);
  });
});
