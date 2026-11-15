import { expect, type Page } from '@playwright/test';

/**
 * The primary navigation and the account links live behind a "Menu" button
 * below 1024px, in a sheet. From there up they are in the header.
 *
 * Returns whether the sheet had to be opened, so a caller can tell which
 * layout it is looking at.
 *
 * The sheet is a Radix dialog, so its trigger does nothing until the page has
 * hydrated - and nothing on the page says when that is. The press is therefore
 * repeated until the sheet is actually open, which is waiting for the thing
 * itself (and never pressing a trigger that has already worked, which would
 * close it again).
 */
export async function openMenuIfPhone(page: Page): Promise<boolean> {
  const trigger = page.getByRole('button', { name: 'Menu' });
  if (!(await trigger.isVisible())) return false;

  const sheet = page.getByRole('dialog', { name: 'Menu' });
  await expect(async () => {
    if (!(await sheet.isVisible())) await trigger.click();
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass();

  return true;
}
