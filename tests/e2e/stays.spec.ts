import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * The stay search, end to end, through the UI a user actually has.
 *
 * Written because the backend passing its own tests proved nothing about
 * whether anybody could reach it: the flow worked perfectly and had no link
 * to it from anywhere on the site.
 */

const SEARCH = '/stays?destination=Barcelona';

test.describe('stays', () => {
  test('is offered on the front page rather than hidden', async ({ page }) => {
    await page.goto('/');

    // The first question, asked before any field.
    await expect(page.getByText('What are you looking for?')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Hotels', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Flights + Hotels' })).toBeVisible();
    // And in the navigation, like every other first-class search.
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Stays' })).toBeVisible();
  });

  test('shows what the dates cost before showing any hotel', async ({ page }) => {
    await page.goto(SEARCH);

    // Dates first: choosing a hotel and then finding out the week was the
    // expensive one is the wrong order to learn things in.
    await expect(page.getByRole('heading', { name: /Which dates are cheaper/ })).toBeVisible();
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
    await page.getByRole('link', { name: 'Compare from this rate' }).first().click();
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

  test('labels demo data as demo data, never as live', async ({ page }) => {
    await page.goto(SEARCH);

    const tags = page.locator('.voyagr-source');
    expect(await tags.count()).toBeGreaterThan(0);
    await expect(tags.first()).toContainText('Demo data');
    await expect(page.getByText('Live price')).toHaveCount(0);
  });

  test('keeps hotel dates independent of flight dates', async ({ page }) => {
    await page.goto('/stays?destination=Barcelona&with=flights');

    await expect(page.getByRole('heading', { name: 'Flights', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Stay', exact: true })).toBeVisible();

    const flightDate = await page.getByLabel('Leaving').inputValue();

    await page.getByLabel('Check-in').fill('2026-11-02');
    await page.getByLabel('Check-out').fill('2026-11-05');
    await page.getByRole('button', { name: /Search stays|Update search/ }).click();

    // The hotel moved and the flight did not. Changing one set of dates must
    // never silently move the other.
    await expect(page.getByLabel('Check-in')).toHaveValue('2026-11-02');
    await expect(page.getByLabel('Leaving')).toHaveValue(flightDate);
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
