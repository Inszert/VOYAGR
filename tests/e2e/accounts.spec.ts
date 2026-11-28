import { expect, test } from '@playwright/test';
import { axeFindings } from './support/axe';
import { openSearch, hydrated } from './support/searches';

/**
 * Accounts end to end.
 *
 * The claim under test is Phase 1.3's: a user can sign in, and preferences
 * survive a restart. "Survive a restart" cannot be shown against the in-memory
 * backend, so what is proven here is the next best thing - preferences survive
 * a sign-out, a fresh browser context and signing back in, which is the same
 * round trip through the repository.
 */

/** Unique per run, so a repeat run is not blocked by its own earlier account. */
function newAccount() {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { email: `traveller-${id}@example.invalid`, password: 'correct-horse-battery-staple' };
}

/** The live region that actually has something in it. */
function formError(page: import('@playwright/test').Page) {
  return page.getByRole('alert').filter({ hasText: /\S/ });
}

async function signUp(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/sign-up');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password').fill(password);
  await hydrated(page.getByRole('button', { name: 'Create account' }));
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
}

test.describe('accounts', () => {
  test('creates an account and lands on it', async ({ page }) => {
    const { email, password } = newAccount();
    await signUp(page, email, password);

    // In the page itself: the header repeats it, and drops it on a phone.
    await expect(page.getByRole('main').getByText(email).first()).toBeVisible();
    // Entitlements are shown resolved from the plan, not written into the page.
    await expect(page.getByRole('heading', { name: 'Your plan' })).toBeVisible();
    await expect(page.getByText('Trips you can watch at once')).toBeVisible();
  });

  test('signs out and back in', async ({ page }) => {
    const { email, password } = newAccount();
    await signUp(page, email, password);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: /See where you can go/ }),
    ).toBeVisible();

    await page.goto('/sign-in');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  });

  test('keeps preferences across a sign-out and a new browser context', async ({ page }) => {
    const { email, password } = newAccount();
    await signUp(page, email, password);

    await page.getByRole('textbox', { name: /Home airports/ }).fill('BTS, VIE');
    await page.getByRole('combobox', { name: 'Travel style' }).selectOption('beach');
    await page.getByRole('checkbox', { name: 'Usually need checked baggage' }).check();
    await page.getByRole('button', { name: 'Save preferences' }).click();

    await expect(page.getByText('Preferences saved.')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.context().clearCookies();

    await page.goto('/sign-in');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('textbox', { name: /Home airports/ })).toHaveValue('BTS, VIE');
    await expect(page.getByRole('combobox', { name: 'Travel style' })).toHaveValue('beach');
    await expect(
      page.getByRole('checkbox', { name: 'Usually need checked baggage' }),
    ).toBeChecked();
  });

  test('shows what it has inferred, even when that is nothing', async ({ page }) => {
    // Section 31.7: the user must be able to see what the system believes about
    // them. "Nothing yet" is an honest answer; silence is not.
    const { email, password } = newAccount();
    await signUp(page, email, password);

    await expect(page.getByRole('heading', { name: 'What we have worked out' })).toBeVisible();
    await expect(page.getByText(/We have not drawn any conclusions/)).toBeVisible();
  });

  test('refuses a duplicate email and keeps what was typed', async ({ page }) => {
    const { email, password } = newAccount();
    await signUp(page, email, password);
    await page.getByRole('button', { name: 'Sign out' }).click();

    await page.goto('/sign-up');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();

    // Every Field mounts its own live region, so the alerts are filtered to the
    // one actually carrying a message rather than picked by position.
    await expect(formError(page)).toContainText('already exists');
    await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue(email);
  });

  test('gives the same answer for a wrong password and an unknown address', async ({ page }) => {
    // The cheap oracle an attacker wants is "is this address registered?".
    const { email, password } = newAccount();
    await signUp(page, email, password);
    await page.getByRole('button', { name: 'Sign out' }).click();

    await page.goto('/sign-in');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const wrongPassword = await formError(page).textContent();

    await page.goto('/sign-in');
    await page.getByRole('textbox', { name: 'Email' }).fill('nobody-at-all@example.invalid');
    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const unknownEmail = await formError(page).textContent();

    expect(unknownEmail).toBe(wrongPassword);
  });

  test('offers alerts without ever asking for permission unprompted', async ({ page }) => {
    // A permission prompt nobody invited is how a site gets its notifications
    // blocked permanently, and that block is not reversible from our side.
    const { email, password } = newAccount();
    await signUp(page, email, password);

    const permissionAsked = await page.evaluate(() => Notification.permission);
    expect(permissionAsked).toBe('default');

    await expect(page.getByRole('heading', { name: 'Alerts on this device' })).toBeVisible();
    // No VAPID key is configured for the hermetic e2e server, and the page says
    // so rather than showing a button that could not work.
    await expect(page.getByText('not configured on this server yet')).toBeVisible();
  });

  test('sends anonymous visitors to sign in', async ({ page }) => {
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    const { email, password } = newAccount();
    await signUp(page, email, password);

    expect(await axeFindings(page)).toEqual([]);
  });
});

test.describe('preferences and the search form', () => {
  test('a saved preference becomes a search default without becoming a filter', async ({
    page,
  }) => {
    // The account page promises these pre-fill a search. This is that promise.
    const { email, password } = newAccount();
    await signUp(page, email, password);

    await page.getByRole('textbox', { name: /Home airports/ }).fill('BTS');
    await page.getByRole('textbox', { name: /Preferred currency/ }).fill('GBP');
    await page.getByRole('combobox', { name: 'Travel style' }).selectOption('beach');
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByText('Preferences saved.')).toBeVisible();

    await page.goto('/');

    // Under 1024px the fields are folded behind the bar's "Edit".
    await openSearch(page);
    await expect(page.getByRole('combobox', { name: /^From/ })).toHaveValue('BTS');
    // Currency and style sit behind "More options"; opening it is what a
    // person does to check them, and hidden controls are not in the tree.
    await page.locator('summary', { hasText: 'More options' }).click();
    await expect(page.getByRole('textbox', { name: /^Currency/ })).toHaveValue('GBP');
    // "More options" asks the style as a group of radios, not a dropdown.
    await expect(
      page.getByRole('group', { name: 'Travel style' }).getByRole('radio', { checked: true }),
    ).toHaveValue('beach');
  });

  test('what the user types still beats what they saved', async ({ page }) => {
    const { email, password } = newAccount();
    await signUp(page, email, password);

    await page.getByRole('textbox', { name: /Home airports/ }).fill('BTS');
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByText('Preferences saved.')).toBeVisible();

    await page.goto('/');
    await openSearch(page);
    await page.getByRole('combobox', { name: /^From/ }).fill('VIE');
    await page.getByRole('button', { name: 'Search trips' }).click();

    // The search that ran is the one in front of the user, not the saved one:
    // in the address, and in the form "Change search" opens.
    await expect(page).toHaveURL(/origins=VIE/);
    await page.getByRole('link', { name: 'Change search' }).click();
    await openSearch(page);
    await expect(page.getByRole('combobox', { name: /^From/ })).toHaveValue('VIE');
  });

  test('changing a password signs every session out', async ({ page }) => {
    const { email, password } = newAccount();
    await signUp(page, email, password);

    // Scoped to its own card: the account page also has a "Change your email
    // address" form with its own "Current password" field now, and an
    // unscoped getByLabel resolves to both.
    const passwordCard = page.getByRole('region', { name: 'Change your password' });
    await passwordCard.getByLabel('Current password').fill(password);
    await passwordCard.getByLabel('New password').fill('an-entirely-different-passphrase');
    await passwordCard.getByRole('button', { name: 'Change password' }).click();

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // The old password no longer works.
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(formError(page)).toBeVisible();

    // Reloaded rather than refilled in place: the form re-renders when the
    // action returns its error, and typing into it mid-render is a race the
    // test would lose intermittently.
    await page.goto('/sign-in');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password').fill('an-entirely-different-passphrase');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  });

  test('ending every session signs this device out too, with its own password intact', async ({
    page,
  }) => {
    const { email, password } = newAccount();
    await signUp(page, email, password);

    await page.getByRole('button', { name: 'End every session' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('Signed out of every device.')).toBeVisible();

    // Unlike a password change, the password itself did not change.
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  });
});
