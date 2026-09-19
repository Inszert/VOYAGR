import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

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

test.describe('discovery', () => {
  test('offers a way in for someone who does not know where they want to go', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Not sure where yet?' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Beach escapes/ })).toBeVisible();
  });

  test('picking a category runs a search ranked that way', async ({ page }) => {
    // Section 6: choosing a category must immediately affect the search.
    await page.goto('/');
    await page.getByRole('link', { name: /Travel cheaply/ }).click();

    await expect(page.getByRole('combobox', { name: 'Optimise for' })).toHaveValue('cheapest');
    await expect(page.getByRole('heading', { name: /trips? match|No trip matched/ })).toBeVisible();
  });

  test('steps out of the way once there are results', async ({ page }) => {
    // Ten ways to discard the search you just ran is not discovery.
    await page.goto(A_SEARCH);

    await expect(page.getByRole('heading', { name: 'Not sure where yet?' })).toHaveCount(0);
  });

  test('works with the keyboard and carries nothing hidden', async ({ page }) => {
    await page.goto('/');

    const tile = page.getByRole('link', { name: /City breaks/ });
    await tile.focus();
    await expect(tile).toBeFocused();

    await page.keyboard.press('Enter');
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
    await expect(page.getByRole('textbox', { name: /Departure airports/ })).toHaveValue('VIE');
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

    const origins = page.getByRole('textbox', { name: /Departure airports/ });
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

    const group = page.getByRole('group', { name: 'How flexible are the dates?' });
    await expect(group).toBeVisible();
    await expect(group.getByText('A long weekend')).toBeVisible();
  });

  test('a weekend search returns only weekend trips', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel('Leaving').fill('2026-06-05');
    await page.getByLabel('Coming back').fill('2026-06-07');
    // The input is visually hidden, so the label is clicked - which is what a
    // user does anyway.
    await page.getByText('A weekend', { exact: true }).click();
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

test.describe('the discovery map', () => {
  test('answers "where can I go" without any JavaScript drawing it', async ({ page }) => {
    // The globe is decoration; this list is the content. Every destination on
    // the map is here too, in the same order, with the same figures.
    await page.goto(A_SEARCH);

    const section = page.getByRole('region', { name: 'Where you can go' });
    await expect(section).toBeVisible();

    const entries = section.getByRole('listitem');
    expect(await entries.count()).toBeGreaterThan(1);
  });

  test('explains why each destination appears', async ({ page }) => {
    await page.goto(`${A_SEARCH}&mapMode=cheapest`);

    const section = page.getByRole('region', { name: 'Where you can go' });
    // Section 14: do not hide the optimisation logic.
    await expect(section.getByText(/Cheapest trip found here/).first()).toBeVisible();
  });

  test('reorders when the ranking changes, and says so in the URL', async ({ page }) => {
    await page.goto(A_SEARCH);

    const section = page.getByRole('region', { name: 'Where you can go' });
    await section.getByRole('link', { name: 'Fastest' }).click();

    await expect(page).toHaveURL(/mapMode=fastest/);
    await expect(section.getByText(/in the air, there and back/).first()).toBeVisible();
  });

  test('narrows to a destination without running another search', async ({ page }) => {
    await page.goto(A_SEARCH);

    const section = page.getByRole('region', { name: 'Where you can go' });
    await section.getByRole('listitem').first().getByRole('link').click();

    await expect(page).toHaveURL(/fDest=[A-Z]{3}/);
    await expect(page).toHaveURL(/origins=VIE/);
    await expect(page.getByRole('link', { name: 'Show every destination' })).toBeVisible();
  });

  test('says what it cannot yet compare', async ({ page }) => {
    await page.goto(A_SEARCH);

    const section = page.getByRole('region', { name: 'Where you can go' });
    await expect(section.getByText(/Flights only for now/)).toBeVisible();
  });

  test('draws a globe from data we ship, reaching nobody', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      const { host } = new URL(request.url());
      if (!host.startsWith('127.0.0.1') && !host.startsWith('localhost'))
        external.push(request.url());
    });

    await page.goto(A_SEARCH);
    await expect(page.getByRole('region', { name: 'Where you can go' })).toBeVisible();

    // The canvas is present and the style actually loaded - the failure this
    // guards is a map that renders a background and silently never loads a
    // source, which looks like an empty ocean rather than like a bug.
    const canvas = page.locator('.maplibregl-canvas');
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Made with Natural Earth')).toBeAttached();

    // No tile server, no API key, no third party in the render path.
    expect(external).toEqual([]);
  });

  test('has no accessibility violations across the map panel', async ({ page }) => {
    await page.goto(A_SEARCH);
    await expect(page.getByRole('region', { name: 'Where you can go' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('[aria-labelledby="map-heading"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
