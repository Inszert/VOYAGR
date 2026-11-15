import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openMenuIfPhone } from './support/menu';

/**
 * The runtime data-source switch.
 *
 * What matters about this control is not that it toggles. It is that it
 * cannot lie: whatever it is set to, the state it shows is the state the page
 * is actually in. A switch that says API over fixture prices would be worse
 * than no switch at all.
 *
 * This suite runs with every provider forced to a fixture (see
 * `playwright.config.ts`), which is exactly the case where asking for the API
 * cannot be honoured - so it is the case worth asserting.
 *
 * Where the control is depends on the width. From 1024px it sits in the header;
 * below that it is in the menu sheet, so each test opens the menu first when
 * there is one (`openMenuIfPhone`) and reads the control from wherever it is.
 */

test.describe('data source switch', () => {
  test('offers both sources, named and reachable', async ({ page }) => {
    await page.goto('/');
    await openMenuIfPhone(page);

    const control = page.getByRole('form', { name: 'Data source' });
    await expect(control.getByRole('button', { name: /^API/ })).toBeVisible();
    await expect(control.getByRole('button', { name: /^MOCK/ })).toBeVisible();
  });

  test('shows the source that is actually serving the page', async ({ page }) => {
    await page.goto('/');
    await openMenuIfPhone(page);

    const control = page.getByRole('form', { name: 'Data source' });

    // Nothing real is configured here, so the page is on fixtures and the
    // control says so through its pressed state, not only through colour.
    await expect(control.getByRole('button', { name: /^MOCK/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(control.getByRole('button', { name: /^API/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('refuses to claim API when no API provider is configured', async ({ page }) => {
    await page.goto('/');
    await openMenuIfPhone(page);

    const control = page.getByRole('form', { name: 'Data source' });
    await control.getByRole('button', { name: /^API/ }).click();

    // It says why rather than flipping and showing fixtures under an API label.
    await openMenuIfPhone(page);
    await expect(control.getByText('No API provider is configured')).toBeVisible();
    await expect(control.getByRole('button', { name: /^MOCK/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // And the page still says what the data is.
    await expect(page.getByText(/demo data/i).first()).toBeVisible();
  });

  test('keeps the choice across a navigation', async ({ page }) => {
    await page.goto('/');
    await openMenuIfPhone(page);
    await page
      .getByRole('form', { name: 'Data source' })
      .getByRole('button', { name: /^MOCK/ })
      .click();

    await page.goto('/stays?destination=Barcelona');
    await openMenuIfPhone(page);

    await expect(
      page.getByRole('form', { name: 'Data source' }).getByRole('button', { name: /^MOCK/ }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('works without JavaScript', async ({ browser }) => {
    // A form and two submit buttons, so the control is a control before any
    // script has run. Everything else on this site holds to that.
    // A fixed desktop width, so the control is in the header. Below 1024px it
    // lives in the menu sheet, which is a script-driven dialog and cannot open
    // without JavaScript; that is a property of the sheet, not of this form.
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    await page.goto('/');
    await page
      .getByRole('form', { name: 'Data source' })
      .getByRole('button', { name: /^MOCK/ })
      .click();
    await expect(
      page.getByRole('form', { name: 'Data source' }).getByRole('button', { name: /^MOCK/ }),
    ).toHaveAttribute('aria-pressed', 'true');

    await context.close();
  });

  test('adds no accessibility violations to the header', async ({ page }) => {
    await page.goto('/');
    const inMenu = await openMenuIfPhone(page);
    await expect(page.getByRole('form', { name: 'Data source' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include(inMenu ? '[role="dialog"]' : 'header')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations.map((v) => `${v.id} at ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
  });
});
