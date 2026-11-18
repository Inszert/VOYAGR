import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openMenuIfPhone } from './support/menu';
import { openSearch } from './support/searches';

/**
 * The stay search, end to end, through the UI a user actually has.
 *
 * Written because the backend passing its own tests proved nothing about
 * whether anybody could reach it: the flow worked perfectly and had no link
 * to it from anywhere on the site.
 */

const SEARCH = '/stays?destination=Barcelona';

/** On a phone the search form folds away behind "Change search". */
async function openChangeSearch(page: Page) {
  const toggle = page.locator('summary', { hasText: 'Change search' });
  if (!(await toggle.isVisible())) return;
  await page.waitForLoadState('networkidle');
  // The form folds shut once the page hydrates, so open it until it stays open.
  await expect(async () => {
    if (!(await page.getByLabel('Check-in').isVisible())) await toggle.click();
    await expect(page.getByLabel('Check-in')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

test.describe('stays', () => {
  test('is offered on the front page rather than hidden', async ({ page }) => {
    await page.goto('/');

    // The first question, asked before any field, one fold into the search.
    await openSearch(page);
    await expect(page.getByText('What are you looking for?')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Hotels', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Flights + Hotels' })).toBeVisible();

    // And in the navigation, like every other first-class search. Below
    // 1024px the navigation is in the menu.
    await openMenuIfPhone(page);
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Stays' }),
    ).toBeVisible();
  });

  test('nothing searched shows the form and one h1', async ({ page }) => {
    await page.goto('/stays');

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Find a place to stay' }),
    ).toBeVisible();
    await openChangeSearch(page);
    await expect(page.getByLabel('Check-in')).toBeVisible();
  });

  test('a result with no stored price says so and shows no figure', async ({ page }) => {
    await page.goto(`${SEARCH}&checkIn=2026-12-20&checkOut=2026-12-24&dates=confirmed`);

    const unpriced = page.getByRole('article').filter({ hasText: 'No stored price' }).first();
    await expect(unpriced).toBeVisible();
    await expect(unpriced.getByText(/[€$£]s?[d.,]+/)).toHaveCount(0);
  });

  test('the hotel page has exactly one h1, the hotel name', async ({ page }) => {
    await page.goto(SEARCH);
    await page.locator('a[href*="dates=confirmed"]').first().click();
    const row = page.getByRole('article').first();
    const name = (await row.getByRole('heading').first().innerText()).trim();
    await row.getByRole('link', { name: /^View / }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
  });

  test('shows what the dates cost before showing any hotel', async ({ page }) => {
    await page.goto(SEARCH);

    // Dates first: choosing a hotel and then finding out the week was the
    // expensive one is the wrong order to learn things in.
    await expect(
      page.getByRole('heading', { level: 1, name: 'Which dates are cheaper in Barcelona?' }),
    ).toBeVisible();
    await expect(page.getByText(/date ranges were priced/)).toBeVisible();

    // No hotel list yet.
    await expect(page.getByRole('heading', { name: /places for/ })).toHaveCount(0);
  });

  test('walks from dates to hotels to one hotel', async ({ page }) => {
    await page.goto(SEARCH);

    await page.locator('a[href*="dates=confirmed"]').first().click();
    await expect(page.getByRole('heading', { name: /places for \d+ nights/ })).toBeVisible();

    const cards = page.getByRole('article');
    expect(await cards.count()).toBeGreaterThan(0);

    await cards.first().getByRole('link').first().click();
    await expect(page.getByRole('heading', { name: 'Compare prices' })).toBeVisible();
  });

  test('compares rates from whichever one is selected', async ({ page }) => {
    await page.goto(SEARCH);
    await page.locator('a[href*="dates=confirmed"]').first().click();
    await page.getByRole('article').first().getByRole('link').first().click();

    await expect(page.getByText('Your selected rate')).toBeVisible();
    // An amount and a percentage, both measured from the selected rate.
    await expect(
      page.getByText(/€[\d.,]+ · [\d.]+% (cheaper|more expensive)/).first(),
    ).toBeVisible();

    // Re-anchoring on another rate moves the reference rather than being
    // fixed to one provider.
    const before = await page.getByText('Your selected rate').locator('..').innerText();
    await page.getByRole('link', { name: 'Choose this room' }).first().click();
    await expect(page.getByText('Your selected rate')).toBeVisible();
    expect(await page.getByText('Your selected rate').locator('..').innerText()).not.toBe(before);
  });

  test('says when two rates are not the same offer', async ({ page }) => {
    await page.goto(SEARCH);
    await page.locator('a[href*="dates=confirmed"]').first().click();
    await page.getByRole('article').first().getByRole('link').first().click();

    // A cheaper non-refundable room without breakfast is not simply cheaper.
    await expect(page.getByText(/Not the same offer:/)).toBeVisible();
    await expect(
      page.getByText(/different cancellation terms|different meals included/),
    ).toBeVisible();
  });

  test('shows no provenance chips, and still says what a price is', async ({ page }) => {
    await page.goto(`${SEARCH}&checkIn=2026-10-20&checkOut=2026-10-24&dates=confirmed`);

    // Honesty is carried by wording on the figure, not by a badge on the card.
    await expect(page.locator('.voyagr-source')).toHaveCount(0);
    await expect(page.getByText('Demo data')).toHaveCount(0);
    await expect(page.getByText('Live price')).toHaveCount(0);
    await expect(page.getByText(/total · \d+ nights/).first()).toBeVisible();
  });

  test('keeps hotel dates independent of flight dates', async ({ page }) => {
    await page.goto('/stays?destination=Barcelona&with=flights');

    await expect(page.getByRole('heading', { name: 'Flights', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Stay', exact: true })).toBeVisible();

    const flightDate = await page.getByLabel('Leaving').inputValue();

    await expect(async () => {
      await openChangeSearch(page);
      await page.getByLabel('Check-in').fill('2026-11-02', { timeout: 1000 });
      await page.getByLabel('Check-out').fill('2026-11-05', { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await page.getByRole('button', { name: /Search stays|Update search/ }).click();

    // The hotel moved and the flight did not. Changing one set of dates must
    // never silently move the other.
    await expect(page.getByLabel('Check-in')).toHaveValue('2026-11-02');
    await expect(page.getByLabel('Leaving')).toHaveValue(flightDate);
  });

  test("puts the city's hotels on a map, credits OpenStreetMap, and opens a card per pin", async ({
    page,
  }) => {
    await page.goto(`${SEARCH}&checkIn=2026-12-20&checkOut=2026-12-24&dates=confirmed`);

    await expect(
      page.getByRole('list', { name: /places to stay in Barcelona/i }).first(),
    ).toBeVisible();
    await expect(page.getByText('© OpenStreetMap contributors').first()).toBeVisible();
    // A listed hotel nobody priced never shows a figure.
    await expect(
      page
        .getByText('No stored price')
        .or(page.getByRole('link', { name: /^See price on / }))
        .first(),
    ).toBeVisible();

    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    const scope = wide ? page : page.getByRole('dialog');
    if (!wide) await page.getByRole('button', { name: 'Map', exact: true }).click();

    const pin = scope.locator('.voyagr-stay-pin:not([hidden])').first();
    await expect(pin).toBeVisible({ timeout: 15_000 });
    await expect(pin).toHaveAccessibleName(/from the centre/);

    if (wide) {
      // Focus opens the pin's card; Escape closes it.
      await pin.focus();
      const card = page.locator('.voyagr-stay-card');
      await expect(card).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(card).toBeHidden();
    } else {
      // On a phone the map sheet shows the chosen stay in its own card.
      await pin.click();
      await expect(scope.getByText(/km from the centre/).first()).toBeVisible();
    }
  });

  test('has no detectable accessibility violations across the flow', async ({ page }) => {
    for (const url of [
      SEARCH,
      `${SEARCH}&checkIn=2026-10-20&checkOut=2026-10-24&dates=confirmed`,
      '/stays?destination=Barcelona&with=flights',
    ]) {
      await page.goto(url);
      await expect(page.getByRole('heading').first()).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(results.violations.map((v) => `${v.id} at ${v.nodes[0]?.target.join(' ')}`)).toEqual(
        [],
      );
    }
  });
});
