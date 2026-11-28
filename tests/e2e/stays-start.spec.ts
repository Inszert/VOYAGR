import { expect, test } from '@playwright/test';
import { IMAGE_HOSTS } from '@/consent/csp';
import { axeFindings, waitForEntranceMotion } from './support/axe';
import { watchRequests } from './support/requests';

/**
 * The stays start screen: nothing searched, so search comes first and the
 * stored hotels and covered cities follow. It must reach no origin but ours
 * (plus the one image CDN the CSP names) and must be readable at every width.
 */

test.describe('stays start screen', () => {
  test('the destination field is the first control after the tabs', async ({ page }) => {
    await page.goto('/stays');

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    // On a phone the form folds shut behind "Change search" once the page
    // hydrates, so it is opened first, as a person would: the claim is about
    // the form's own order, not about whether it is folded.
    const toggle = page.locator('summary', { hasText: 'Change search' });
    if (await toggle.isVisible()) {
      await page.waitForLoadState('networkidle');
      await expect(async () => {
        if (
          !(await page
            .getByLabel(/destination|where/i)
            .first()
            .isVisible())
        ) {
          await toggle.click();
        }
        await expect(page.getByLabel(/destination|where/i).first()).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 10_000 });
    }

    const order = await page.evaluate(() => {
      const tabs = document.querySelector('nav[aria-label="What are you looking for?"]');
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          'main a[href], main button, main input, main select',
        ),
      ].filter((el) => el.offsetParent !== null);
      const after = controls.filter(
        (el) => !tabs?.contains(el) && tabs && tabs.compareDocumentPosition(el) & 4,
      );
      const first = after[0];
      return {
        tag: first?.tagName ?? null,
        label: first?.getAttribute('aria-label') ?? first?.id ?? null,
      };
    });
    expect(order.tag).toBe('INPUT');

    const field = page.getByLabel(/destination|where/i).first();
    await expect(field).toBeVisible();
  });

  for (const width of [390, 1440]) {
    test(`axe passes at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/stays');
      await page.waitForLoadState('networkidle');
      await waitForEntranceMotion(page);
      expect(await axeFindings(page)).toEqual([]);
    });
  }

  for (const width of [320, 390]) {
    test(`no horizontal overflow at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/stays');
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('images are same-origin or an allowed https host, and no vendor is called', async ({
    page,
  }) => {
    const log = watchRequests(page);
    await page.goto('/stays');
    await page.waitForLoadState('networkidle');

    const sources = await page.evaluate(() =>
      [...document.querySelectorAll('img')].map((img) => img.currentSrc || img.src),
    );
    for (const src of sources) {
      const url = new URL(src, page.url());
      if (url.origin === new URL(page.url()).origin) continue;
      expect(url.protocol).toBe('https:');
      expect(IMAGE_HOSTS).toContain(url.hostname);
    }

    // Anything not served by us may only be an image host, never a vendor API.
    const vendors = log.external.filter((u) => !IMAGE_HOSTS.includes(new URL(u).hostname));
    expect(vendors).toEqual([]);
  });
});
