import { expect, test, type Page } from '@playwright/test';
import { axeFindings, waitForEntranceMotion } from './support/axe';
import { hydrated } from './support/searches';

/**
 * The trip hub, end to end: a trip, its plan, what the group spent and who
 * owes whom, and the emergency numbers.
 *
 * The arithmetic is `src/core/expenses` and has its own unit tests. What this
 * proves is that the page prints what the core computed and nothing else:
 * Alex pays 90.00 and Blake pays 30.00 for something shared equally, so the
 * group spent 120.00, each owes 60.00, and Blake owes Alex 30.00 - one
 * payment, and the figures are exact rather than close.
 */

function newAccount() {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { email: `tripper-${id}@example.invalid`, password: 'correct-horse-battery-staple' };
}

async function signUp(page: Page): Promise<void> {
  const { email, password } = newAccount();
  await page.goto('/sign-up');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password').fill(password);
  await hydrated(page.getByRole('button', { name: 'Create account' }));
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Open a tab by pressing it.
 *
 * The tabs are a Radix widget, so a press before the page has hydrated does
 * nothing and nothing on the page says when it has. The press is repeated until
 * the tab is selected, which waits for the thing itself rather than for a delay.
 */
async function openTab(page: Page, name: 'Plan' | 'Money' | 'Emergency'): Promise<void> {
  const tab = page.getByRole('tab', { name });
  await expect(async () => {
    if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
  }).toPass();
}

/** Create the trip and land on it. */
async function createTrip(page: Page): Promise<void> {
  await page.goto('/trips');
  await page.getByRole('textbox', { name: /^Trip name/ }).fill('Vienna long weekend');
  await page.getByRole('textbox', { name: /^Destination/ }).fill('Vienna');
  await page
    .getByRole('combobox', { name: 'Destination country' })
    .selectOption({ label: 'Austria' });
  await page.getByRole('textbox', { name: /^Your name on this trip/ }).fill('Alex');
  await page.getByLabel('Start date').fill(isoDay(30));
  await page.getByLabel('End date').fill(isoDay(33));
  await hydrated(page.getByRole('button', { name: 'Create trip' }));
  await page.getByRole('button', { name: 'Create trip' }).click();

  await expect(page).toHaveURL(/\/trips\/[^/?]+/);
  await expect(page.getByRole('heading', { level: 1, name: 'Vienna long weekend' })).toBeVisible();
}

test.describe('the trip hub', () => {
  test('keeps a plan, splits what a group spent exactly, and knows the emergency numbers', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await signUp(page);

    // --- The list of trips, empty to begin with.
    await page.goto('/trips');
    await expect(page.getByRole('heading', { level: 1, name: 'Your trips' })).toBeVisible();
    await expect(page.getByText('You have no trips yet.')).toBeVisible();
    await waitForEntranceMotion(page);
    expect(await axeFindings(page), '/trips').toEqual([]);

    await createTrip(page);

    // --- The plan. Nothing is marked as booked unless the traveller says so.
    await expect(page.getByText('Nothing in the plan yet')).toBeVisible();
    await page.getByRole('textbox', { name: /^Title/ }).fill('Train to Salzburg');
    await page.getByLabel('Date', { exact: true }).fill(isoDay(31));
    await hydrated(page.getByRole('button', { name: 'Add item' }));
    await page.getByRole('button', { name: 'Add item' }).click();

    await expect(page.getByText('Added to the plan.')).toBeVisible();
    await expect(page.getByRole('list').getByText('Train to Salzburg').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /I have booked this/ })).toBeVisible();

    // --- A second person on the trip, then two expenses between the two.
    await openTab(page, 'Money');
    await expect(page.getByText('No expenses yet.')).toBeVisible();

    await page.getByText('Add a person').click();
    await page.getByRole('textbox', { name: /^Name/ }).fill('Blake');
    await hydrated(page.getByRole('button', { name: 'Add person' }));
    await page.getByRole('button', { name: 'Add person' }).click();
    await expect(page.getByRole('list').getByText('Blake').first()).toBeVisible();

    const addExpense = page.getByRole('complementary', { name: 'Add an expense' });

    await addExpense.getByRole('textbox', { name: /^What for/ }).fill('Dinner');
    await addExpense.getByRole('textbox', { name: /^Amount/ }).fill('90.00');
    await addExpense.getByRole('combobox', { name: 'Paid by' }).selectOption({ label: 'Alex' });
    await hydrated(addExpense.getByRole('button', { name: 'Add expense' }));
    await addExpense.getByRole('button', { name: 'Add expense' }).click();
    await expect(page.getByRole('region', { name: 'Balances in EUR' })).toBeVisible();

    await addExpense.getByRole('textbox', { name: /^What for/ }).fill('Taxi');
    await addExpense.getByRole('textbox', { name: /^Amount/ }).fill('30.00');
    await addExpense.getByRole('combobox', { name: 'Paid by' }).selectOption({ label: 'Blake' });
    await hydrated(addExpense.getByRole('button', { name: 'Add expense' }));
    await addExpense.getByRole('button', { name: 'Add expense' }).click();

    // Both are in the list, with what they cost and who paid.
    const dinner = page
      .getByRole('listitem')
      .filter({ hasText: 'Dinner' })
      .filter({ hasText: 'paid by Alex' });
    await expect(dinner.getByText('€90.00')).toBeVisible();
    const taxi = page
      .getByRole('listitem')
      .filter({ hasText: 'Taxi' })
      .filter({ hasText: 'paid by Blake' });
    await expect(taxi.getByText('€30.00')).toBeVisible();

    // --- The balances, to the cent. 120.00 between two is 60.00 each.
    const balances = page.getByRole('region', { name: 'Balances in EUR' });
    const alex = balances.getByRole('row', { name: /^Alex/ });
    const blake = balances.getByRole('row', { name: /^Blake/ });
    await expect(alex).toContainText('Is owed');
    await expect(alex.getByRole('cell').last()).toHaveText('€30.00');
    await expect(blake).toContainText('Owes');
    await expect(blake.getByRole('cell').last()).toHaveText(/^[-−]€30\.00$/);

    // --- Settle up: the one payment that clears it, in the same figures.
    const settle = page.getByRole('region', { name: 'Settle up' });
    await expect(settle).toBeVisible();
    const payments = settle.getByRole('list', { name: 'Payments in EUR' });
    await expect(payments.getByRole('listitem')).toHaveCount(1);
    await expect(payments).toContainText('Blake pays Alex');
    await expect(payments).toContainText('€30.00');

    await waitForEntranceMotion(page);
    expect(await axeFindings(page), 'the trip, on Money').toEqual([]);

    // --- Emergency numbers for the country that was chosen, with where they
    // come from, and none that were guessed.
    await openTab(page, 'Emergency');
    await expect(page.getByRole('heading', { name: 'Emergency numbers in Austria' })).toBeVisible();
    const numbers = page.getByRole('list', { name: 'Emergency numbers' });
    await expect(numbers.getByRole('link', { name: /112/ })).toHaveAttribute('href', 'tel:112');
    await expect(numbers.getByRole('link', { name: /144/ })).toHaveAttribute('href', 'tel:144');
    await expect(page.getByRole('link', { name: 'Wikidata' })).toBeVisible();
    await expect(page.getByText(/retrieved\s+2026-11-14/)).toBeVisible();

    expect(await axeFindings(page), 'the trip, on Emergency').toEqual([]);
    expect(errors).toEqual([]);
  });

  test('says so when a country has no number on file, rather than guessing one', async ({
    page,
  }) => {
    await signUp(page);
    await page.goto('/trips');
    await page.getByRole('textbox', { name: /^Trip name/ }).fill('Somewhere');
    await page.getByRole('textbox', { name: /^Destination/ }).fill('Somewhere');
    await page.getByRole('textbox', { name: /^Your name on this trip/ }).fill('Alex');
    await hydrated(page.getByRole('button', { name: 'Create trip' }));
    await page.getByRole('button', { name: 'Create trip' }).click();
    await expect(page).toHaveURL(/\/trips\/[^/?]+/);

    await openTab(page, 'Emergency');
    await expect(page.getByText(/No verified number on file/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Emergency numbers' })).toHaveCount(0);
  });

  test('sends anonymous visitors to sign in', async ({ page }) => {
    await page.goto('/trips');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
