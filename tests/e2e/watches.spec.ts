import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Saved searches and Travel Watches end to end.
 *
 * The claim under test is Phase 1.5's: a saved watch persists and appears with
 * its next scheduled run.
 */

const A_SEARCH =
  '/?origins=VIE&destinations=AYT%2C+CHQ&earliestDeparture=2026-06-01' +
  '&latestReturn=2026-06-30&minNights=4&maxNights=7&passengers=2&currency=EUR' +
  '&targetBudget=650&maxBudget=850&travelStyle=balanced&optimisationMode=best_value';

function newAccount() {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { email: `watcher-${id}@example.invalid`, password: 'correct-horse-battery-staple' };
}

async function signUp(page: Page) {
  const { email, password } = newAccount();
  await page.goto('/sign-up');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  return { email, password };
}

async function saveASearch(page: Page, name?: string) {
  await page.goto(A_SEARCH);
  if (name) await page.getByRole('textbox', { name: /Name this search/ }).fill(name);
  await page.getByRole('button', { name: 'Watch this trip' }).click();
  await expect(page.getByRole('heading', { name: 'We are watching this trip' })).toBeVisible();
}

test.describe('travel watches', () => {
  test('invites an anonymous visitor to sign in rather than silently doing nothing', async ({
    page,
  }) => {
    await page.goto(A_SEARCH);

    const panel = page.getByRole('region', { name: 'Keep looking for this trip' });
    await expect(panel.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Watch this trip' })).toHaveCount(0);
  });

  test('saves a search and shows it with its next scheduled run', async ({ page }) => {
    await signUp(page);
    await saveASearch(page, 'Greek islands in June');

    await page.goto('/watches');

    const row = page.getByRole('article', { name: 'Greek islands in June' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Status: Watching')).toBeVisible();
    // The question a watch exists to answer.
    await expect(row.getByText('Next check')).toBeVisible();
    await expect(row.getByText(/Due now|In about/)).toBeVisible();
    await expect(row.getByText('AYT, CHQ')).toBeVisible();
  });

  test('suggests a name drawn from the search itself', async ({ page }) => {
    await signUp(page);
    await page.goto(A_SEARCH);

    await expect(page.getByRole('textbox', { name: /Name this search/ })).toHaveValue(
      'AYT, CHQ in 2026-06',
    );
  });

  test('pauses and resumes a watch', async ({ page }) => {
    await signUp(page);
    await saveASearch(page, 'Pause me');

    await page.goto('/watches');
    const row = page.getByRole('article', { name: 'Pause me' });

    await row.getByRole('button', { name: 'Pause' }).click();
    await expect(row.getByText('Status: Paused')).toBeVisible();
    await expect(row.getByText('Not scheduled while paused')).toBeVisible();

    await row.getByRole('button', { name: 'Resume' }).click();
    await expect(row.getByText('Status: Watching')).toBeVisible();
  });

  test('enforces the plan limit and says what to do about it', async ({ page }) => {
    await signUp(page);

    // The free plan allows three active watches.
    for (const month of ['06', '07', '08']) {
      await page.goto(
        A_SEARCH.replace(/2026-06-01/, `2026-${month}-01`).replace(
          /2026-06-30/,
          `2026-${month}-28`,
        ),
      );
      await page.getByRole('button', { name: 'Watch this trip' }).click();
      await expect(page.getByRole('heading', { name: 'We are watching this trip' })).toBeVisible();
    }

    await page.goto(
      A_SEARCH.replace(/2026-06-01/, '2026-09-01').replace(/2026-06-30/, '2026-09-28'),
    );
    await page.getByRole('button', { name: 'Watch this trip' }).click();

    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toContainText(
      'watches 3 trips at once',
    );
  });

  test('shows the count against the plan and an honest empty state', async ({ page }) => {
    await signUp(page);
    await page.goto('/watches');

    await expect(page.getByText('0 of 3 watches active')).toBeVisible();
    await expect(page.getByText('No watches yet.')).toBeVisible();
    // Nothing runs them yet, and the page says so rather than implying it does.
    await expect(
      page.getByRole('heading', { name: 'Background checking is not switched on here' }),
    ).toBeVisible();
  });

  test('re-runs a saved search with its hard constraints intact', async ({ page }) => {
    await signUp(page);

    // A search with requirements that a partial replay link would have dropped.
    await page.goto(`${A_SEARCH}&requireDirectFlights=on&requireFreeCancellation=on`);
    await page.getByRole('textbox', { name: /Name this search/ }).fill('Fussy search');
    await page.getByRole('button', { name: 'Watch this trip' }).click();
    await expect(page.getByRole('heading', { name: 'We are watching this trip' })).toBeVisible();

    await page.goto('/watches');
    await page
      .getByRole('article', { name: 'Fussy search' })
      .getByRole('link', { name: 'Run this search now' })
      .click();

    // The re-run is the search that was saved, not a looser one.
    await expect(page.getByRole('checkbox', { name: 'Direct flights only' })).toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: 'Hotel must be free to cancel' }),
    ).toBeChecked();
  });

  test('sends anonymous visitors to sign in', async ({ page }) => {
    await page.goto('/watches');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await signUp(page);
    await saveASearch(page, 'Accessible watch');
    await page.goto('/watches');

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
