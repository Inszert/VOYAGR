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

    await expect(top.getByRole('heading', { name: 'Why it ranks here' })).toBeVisible();

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
