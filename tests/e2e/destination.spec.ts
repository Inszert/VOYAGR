import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { watchRequests } from './support/requests';

/**
 * A destination, end to end (1.10.1 section 18).
 *
 * The claim under test is that the page describes a real place from real
 * adapters and is honest about the rest. Section 18 asks for imagery, events,
 * national holidays, travel warnings and hidden places; none of those have a
 * data source, and silence about a travel warning is the dangerous reading.
 */

const ANTALYA = '/destinations/ayt';
const WITH_DATES = `${ANTALYA}?startDate=2026-06-10&endDate=2026-06-14&passengers=2&currency=EUR`;

test.describe('a destination page', () => {
  test('opens on the globe, framed on the country the place is in', async ({ page }) => {
    // Arriving here should read as zooming further into the map rather than
    // as leaving it for a different website.
    const requests = watchRequests(page);

    await page.goto(ANTALYA);

    await expect(page.getByRole('heading', { level: 1, name: 'Antalya' })).toBeVisible();
    await expect(page.getByText('Turkey · airport AYT')).toBeVisible();
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

    // The place is marked, with no price on it: this page knows where Antalya
    // is, not what a trip there costs.
    const chip = page.locator('a[data-destination="AYT"]');
    await expect(chip).toContainText('Antalya');
    await expect(chip).not.toContainText('€');
    await expect(chip).not.toContainText('Demo data');

    expect(requests.external).toEqual([]);
  });

  test('names the place and what is around it', async ({ page }) => {
    await page.goto(ANTALYA);

    await expect(page.getByRole('heading', { level: 1, name: 'Antalya' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Eating' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Getting in from the airport' })).toBeVisible();
  });

  test('shows no outlook without dates, and one with them', async ({ page }) => {
    await page.goto(ANTALYA);
    await expect(page.getByRole('region', { name: 'While you are there' })).toBeHidden();

    await page.goto(WITH_DATES);
    await expect(page.getByRole('region', { name: 'While you are there' })).toBeVisible();
  });

  test('names what it cannot tell you rather than staying quiet', async ({ page }) => {
    await page.goto(ANTALYA);

    const gaps = page.getByRole('region', { name: 'What this page cannot tell you yet' });
    await expect(gaps.getByText('Travel warnings')).toBeVisible();
    await expect(gaps.getByText('Events')).toBeVisible();
    await expect(gaps.getByText('Photographs')).toBeVisible();
  });

  test('says plainly that the data is not real', async ({ page }) => {
    await page.goto(ANTALYA);

    await expect(page.getByRole('note')).toContainText('not real');
  });

  test('has no empty section for something the place does not have', async ({ page }) => {
    // Tbilisi is landlocked; an empty "Beaches" heading is a promise the page
    // cannot keep.
    await page.goto('/destinations/tbs');

    await expect(page.getByRole('heading', { level: 1, name: 'Tbilisi' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Beaches' })).toBeHidden();
  });

  test('is reachable from the discovery map', async ({ page }) => {
    await page.goto(
      '/?origins=VIE&destinations=AYT%2C+CHQ%2C+SPU&earliestDeparture=2026-06-01' +
        '&latestReturn=2026-06-30&minNights=4&maxNights=7&passengers=2&currency=EUR' +
        '&targetBudget=650&maxBudget=850&travelStyle=balanced&optimisationMode=best_value',
    );

    const map = page.getByRole('region', { name: /destinations, ranked by/ });
    await map
      .getByRole('link', { name: /^About / })
      .first()
      .click();

    await expect(page).toHaveURL(/\/destinations\/[a-z]{3}/);
    // The dates the search priced come with it, so the outlook is for those.
    await expect(page.getByRole('region', { name: 'While you are there' })).toBeVisible();
  });

  test('404s on a code that is not a destination', async ({ page }) => {
    const response = await page.goto('/destinations/qqq');

    expect(response?.status()).toBe(404);
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await page.goto(WITH_DATES);
    await expect(page.getByRole('heading', { level: 1, name: 'Antalya' })).toBeVisible();

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
