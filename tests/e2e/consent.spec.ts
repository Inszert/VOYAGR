import { expect, test, type Page } from '@playwright/test';
import { axeFindings, waitForEntranceMotion } from './support/axe';

/**
 * Cookie consent gates the one third-party script.
 *
 * The e2e build never contacts the real Drive host (`ALLOW_MOCK_IN_PRODUCTION`),
 * so with `DRIVE_TEST_STUB` an accepted visitor gets a same-origin stand-in at
 * `/api/test/drive-stub`. What is proved here is the gating - the tag, the
 * request and the CSP all appear only after Accept - and that the real vendor's
 * host is never contacted in any state.
 *
 * Requests are read from resource timing rather than `page.on('request')`: the
 * service worker answers some fetches itself and hides them from Playwright.
 *
 * These tests start with no cookies at all, so the banner is showing.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const STUB = '/api/test/drive-stub';

async function driveFootprint(page: Page) {
  return page.evaluate((stub) => {
    const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    const requests = performance.getEntriesByType('resource').map((entry) => entry.name);
    return {
      scriptTags: scripts.filter((src) => src?.includes(stub) || src?.includes('emrldco')).length,
      stubRequests: requests.filter((name) => name.includes(stub)).length,
      vendorRequests: requests.filter((name) => name.includes('emrldco')).length,
      stubRan: (window as unknown as { __voyagrDriveStub?: boolean }).__voyagrDriveStub === true,
    };
  }, STUB);
}

const banner = (page: Page) => page.getByRole('region', { name: 'Cookies', exact: true });

test.describe('before any choice', () => {
  test('shows the banner, loads nothing third-party and does not name the host in the CSP', async ({
    page,
  }) => {
    const response = await page.goto('/');

    await expect(banner(page)).toBeVisible();
    await expect(banner(page).getByRole('button', { name: 'Accept' })).toBeVisible();
    await expect(banner(page).getByRole('button', { name: 'Decline' })).toBeVisible();
    await expect(banner(page).getByRole('link')).toHaveAttribute('href', '/privacy#cookies');

    expect(await driveFootprint(page)).toEqual({
      scriptTags: 0,
      stubRequests: 0,
      vendorRequests: 0,
      stubRan: false,
    });
    expect(response?.headers()['content-security-policy']).not.toContain('emrldco');
  });

  test('is not modal: the page behind it stays reachable', async ({ page }) => {
    await page.goto('/privacy');

    await expect(banner(page)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Focus was not taken: the first Tab still lands on the skip link.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  });

  test('has no accessibility violations with the banner showing', async ({ page }) => {
    await page.goto('/');
    await expect(banner(page)).toBeVisible();
    await waitForEntranceMotion(page);

    expect(await axeFindings(page)).toEqual([]);
  });

  test('does not cover the search bar on a phone', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'The bar is pinned to the bottom only on a phone.');

    await page.goto('/');
    await expect(banner(page)).toBeVisible();
    await waitForEntranceMotion(page);

    const bannerBox = await banner(page).boundingBox();
    const barBox = await page
      .getByRole('button', { name: /Search trips/ })
      .first()
      .boundingBox();
    expect(bannerBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(bannerBox!.y + 1);
  });
});

test.describe('declining', () => {
  test('loads nothing, remembers the choice, and lets it be changed', async ({ page }) => {
    await page.goto('/');
    await banner(page).getByRole('button', { name: 'Decline' }).click();

    await expect(banner(page)).toHaveCount(0);
    const cookie = (await page.context().cookies()).find((c) => c.name === 'voyagr-consent');
    expect(cookie).toMatchObject({ value: 'declined', sameSite: 'Lax', httpOnly: false });

    // Persists across navigation and a reload.
    await page.goto('/privacy');
    await expect(banner(page)).toHaveCount(0);
    await page.reload();
    await expect(banner(page)).toHaveCount(0);

    expect(await driveFootprint(page)).toEqual({
      scriptTags: 0,
      stubRequests: 0,
      vendorRequests: 0,
      stubRan: false,
    });
  });
});

test.describe('accepting', () => {
  test('loads the script only afterwards, and withdrawing stops it', async ({ page }) => {
    await page.goto('/privacy');
    expect((await driveFootprint(page)).scriptTags).toBe(0);

    await banner(page).getByRole('button', { name: 'Accept' }).click();
    await expect(banner(page)).toHaveCount(0);

    // The page reloads under a policy that allows it.
    await expect
      .poll(async () => (await driveFootprint(page).catch(() => null))?.stubRan)
      .toBe(true);
    const accepted = await driveFootprint(page);
    expect(accepted.scriptTags).toBe(1);
    expect(accepted.stubRequests).toBe(1);
    expect(accepted.vendorRequests).toBe(0);

    // Persists across navigation.
    await page.goto('/terms');
    await expect(banner(page)).toHaveCount(0);
    expect((await driveFootprint(page)).scriptTags).toBe(1);

    // The footer reopens the choice; declining removes the script.
    await page.getByRole('button', { name: 'Cookie settings' }).click();
    await expect(banner(page)).toBeVisible();
    await banner(page).getByRole('button', { name: 'Decline' }).click();
    await expect(banner(page)).toHaveCount(0);
    await expect
      .poll(async () => (await driveFootprint(page).catch(() => null))?.scriptTags)
      .toBe(0);
    expect((await driveFootprint(page)).stubRan).toBe(false);
  });

  test('the stub is not reachable by a forged cookie from a different path', async ({
    page,
    context,
    baseURL,
  }) => {
    // A forged value other than the exact word is no consent.
    await context.addCookies([{ name: 'voyagr-consent', value: 'yes', url: baseURL! }]);
    await page.goto('/');

    await expect(banner(page)).toBeVisible();
    expect((await driveFootprint(page)).scriptTags).toBe(0);
  });
});

test.describe('the privacy notice', () => {
  test('lists every cookie in a Cookies section', async ({ page }) => {
    await page.goto('/privacy#cookies');

    const section = page.locator('#cookies');
    await expect(section).toContainText('voyagr-consent');
    await expect(section).toContainText('voyagr_session');
    await expect(section).toContainText('voyagr-data-source');
    await expect(section).toContainText('tpk.lv');
  });
});
