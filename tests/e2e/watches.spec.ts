import { expect, test, type Page } from '@playwright/test';
import { axeFindings } from './support/axe';
import { aSearch, hydrated, openSearch } from './support/searches';

/**
 * Saved searches and Travel Watches end to end.
 *
 * The claim under test is Phase 1.5's: a saved watch persists and appears with
 * its next scheduled run.
 */

// Dates relative to the day the suite runs - see `support/searches`.
const SEARCH = aSearch('AYT, CHQ');
const A_SEARCH = SEARCH.path;

function newAccount() {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { email: `watcher-${id}@example.invalid`, password: 'correct-horse-battery-staple' };
}

async function signUp(page: Page) {
  const { email, password } = newAccount();
  await page.goto('/sign-up');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password').fill(password);
  await hydrated(page.getByRole('button', { name: 'Create account' }));
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  return { email, password };
}

async function saveASearch(page: Page, name?: string) {
  await page.goto(A_SEARCH);
  if (name) await page.getByRole('textbox', { name: /Name this search/ }).fill(name);
  await hydrated(page.getByRole('button', { name: 'Watch this trip' }));
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
      `AYT, CHQ in ${SEARCH.month}`,
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
    for (const shift of [0, 40, 80]) {
      await page.goto(aSearch('AYT, CHQ', '/explore', shift).path);
      await hydrated(page.getByRole('button', { name: 'Watch this trip' }));
      await page.getByRole('button', { name: 'Watch this trip' }).click();
      await expect(page.getByRole('heading', { name: 'We are watching this trip' })).toBeVisible();
    }

    await page.goto(aSearch('AYT, CHQ', '/explore', 120).path);
    await hydrated(page.getByRole('button', { name: 'Watch this trip' }));
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
    await hydrated(page.getByRole('button', { name: 'Watch this trip' }));
    await page.getByRole('button', { name: 'Watch this trip' }).click();
    await expect(page.getByRole('heading', { name: 'We are watching this trip' })).toBeVisible();

    await page.goto('/watches');
    await page
      .getByRole('article', { name: 'Fussy search' })
      .getByRole('link', { name: 'Run this search now' })
      .click();

    // The re-run is the search that was saved, not a looser one. Results have
    // no form of their own; "Change search" opens it filled in with the search
    // that ran, and the hard requirements sit behind "More options" there.
    await page.getByRole('link', { name: 'Change search' }).click();
    await openSearch(page);
    await page.locator('summary', { hasText: 'More options' }).click();
    await expect(page.getByRole('checkbox', { name: 'Direct flights only' })).toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: 'Hotel must be free to cancel' }),
    ).toBeChecked();
  });

  test('is honest about having recorded no prices yet', async ({ page }) => {
    // Nothing has run this watch, so "best seen so far" has no evidence behind
    // it and the page says so rather than showing a number.
    await signUp(page);
    await saveASearch(page, 'Nothing recorded yet');

    await page.goto('/watches');
    const row = page.getByRole('article', { name: 'Nothing recorded yet' });

    await expect(row.getByText('Nothing yet')).toBeVisible();
    await expect(row.getByText('Prices recorded')).toBeVisible();
  });

  test('sends anonymous visitors to sign in', async ({ page }) => {
    await page.goto('/watches');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await signUp(page);
    await saveASearch(page, 'Accessible watch');
    await page.goto('/watches');

    expect(await axeFindings(page)).toEqual([]);
  });
});
