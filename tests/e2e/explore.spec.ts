import { expect, test } from '@playwright/test';
import { axeFindings, waitForEntranceMotion } from './support/axe';
import { openMenuIfPhone } from './support/menu';
import { watchRequests } from './support/requests';

/**
 * The explorer, end to end.
 *
 * The globe on its own page. The claim under test is that it is the same
 * globe over the same data as the front page - same rail, same prices, same
 * provenance, same controls - and that it still reaches nobody.
 */

test.describe('the explorer', () => {
  test('shows the world, priced, with the rail beside it', async ({ page }) => {
    await page.goto('/explore');

    await expect(page.getByRole('heading', { level: 1, name: /Explore the world/ })).toBeVisible();

    const rail = page.getByRole('region', { name: /destinations, ranked by/ });
    await expect(rail).toBeVisible();
    expect(await rail.getByRole('listitem').count()).toBeGreaterThan(1);
    // D20: no provenance chip - the price says "from", and the page says how
    // old the figures are.
    await expect(rail.getByText(/from €\d/).first()).toBeVisible();
    await expect(rail.getByText('Demo data')).toHaveCount(0);
    await expect(page.getByText(/^Updated .+ ago$|^Updated just now$/).first()).toBeVisible();
  });

  test('puts the pointer on the planet, not on the box it sits in', async ({ page }) => {
    // The globe is mounted once, above the page, and the page's slot for it is
    // laid out after it, so left opaque to the pointer the slot would take
    // every press meant for the planet: the drag, the wheel, a country, a price
    // chip. Hit-testing the middle of the page's slot - the box the planet is
    // drawn in - is the direct question. (On a phone the search form is stacked
    // over the top of the full-page canvas, so the canvas's own middle is the
    // form's; the slot is where the planet is on every width.)
    await page.goto('/explore');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-stage-slot]').scrollIntoViewIfNeeded();

    const hit = await page.evaluate(() => {
      const slot = document.querySelector('[data-stage-slot]');
      if (!slot) return 'no slot';
      const box = slot.getBoundingClientRect();
      const x = box.x + box.width / 2;
      const y = Math.min(box.y + box.height / 2, window.innerHeight - 1);
      const element = document.elementFromPoint(x, y);

      return element?.closest('[data-stage-host]') ? 'the globe' : (element?.tagName ?? 'nothing');
    });

    expect(hit).toBe('the globe');
  });

  test('is reachable from the primary navigation', async ({ page }) => {
    await page.goto('/');

    // Below 1024px the navigation lives behind the Menu button.
    await openMenuIfPhone(page);
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Explore' })
      .click();

    await expect(page).toHaveURL(/\/explore$/);
    await expect(page.getByRole('heading', { level: 1, name: /Explore the world/ })).toBeVisible();
  });

  test('draws the globe from data we ship, reaching nobody', async ({ page }) => {
    const requests = watchRequests(page);

    await page.goto('/explore');

    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('a[data-destination]').locator('visible=true').first()).toBeVisible({
      timeout: 15_000,
    });

    expect(requests.external).toEqual([]);
  });

  test('keeps the ranking and the country in the URL', async ({ page }) => {
    await page.goto('/explore');

    await page.getByRole('link', { name: 'Cheapest' }).click();
    await expect(page).toHaveURL(/\/explore\?.*mapMode=cheapest/);

    await page.getByRole('combobox', { name: 'Explore a country' }).selectOption('GEO');
    await page.getByRole('button', { name: 'Go' }).click();

    await expect(page).toHaveURL(/country=GEO/);
    await expect(page).toHaveURL(/mapMode=cheapest/);
    await expect(page.getByRole('region', { name: /\d+ places? priced in Georgia/ })).toBeVisible();
  });
  /**
   * Whether anything under `/geo/` matching this shape was asked for.
   *
   * Matched on shape, not on the exact filename. These files carry a version
   * in the name and the service worker caches them on it, so the version has
   * to change whenever the data does - and a spec that spells the current one
   * out fails every legitimate rebuild while proving nothing about the thing
   * under test, which is which file is fetched and when.
   */
  const asked = (urls: string[], pattern: RegExp) => urls.some((url) => pattern.test(url));

  const COARSE = /^\/geo\/countries-110m\.v\d+\.json$/;
  const FINE = /^\/geo\/countries-50m\.v\d+\.json$/;

  test('fetches the finer coastlines only once somebody zooms in', async ({ page }) => {
    // A megabyte of coastline is not something to send to everybody looking
    // at a globe of the whole world. Watched at the context, because MapLibre
    // fetches its sources on a worker - see `support/requests`.
    const requests = watchRequests(page);

    await page.goto('/explore');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

    await expect.poll(() => asked(requests.geo, COARSE)).toBe(true);
    expect(asked(requests.geo, FINE)).toBe(false);

    // Enough to clear the threshold from the zoom a phone-width globe opens
    // at, which is lower than a desktop one because the sphere is smaller.
    for (let step = 0; step < 5; step += 1) {
      await page.getByRole('button', { name: 'Zoom in' }).click();
      await page.waitForTimeout(600);
    }

    await expect.poll(() => asked(requests.geo, FINE)).toBe(true);
  });

  test('draws the regions of an open country, from our own origin', async ({ page }) => {
    const requests = watchRequests(page);

    await page.goto('/explore?country=ESP');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

    // Matched on shape rather than on the exact version, because importing
    // `regionsUrl` pulls the generated country JSON into Playwright's loader.
    await expect.poll(() => asked(requests.geo, /^\/geo\/regions\/ESP\.v\d+\.json$/)).toBe(true);
    // The land the sphere is drawn from, and the lights on its night side,
    // both off our own origin. There is no glyph server because there is no
    // text on the globe at all, and no third party in the render path.
    expect(asked(requests.geo, /^\/geo\/land-50m\.v\d+\.json$/)).toBe(true);
    expect(asked(requests.geo, /^\/geo\/city-lights\.v\d+\.json$/)).toBe(true);
    expect(requests.external).toEqual([]);
  });

  test('says what it knows about an open country, and what it does not', async ({ page }) => {
    await page.goto('/explore?country=ESP');

    const rail = page.getByRole('region', { name: /priced in Spain/ });
    await expect(rail.getByText('Southern Europe, Europe')).toBeVisible();
    // Geometry is not knowledge about a place, and the rail says so.
    await expect(rail.getByText('52 regions, drawn as outlines')).toBeVisible();
    // However many airports the catalogue has in Spain today, the rail says so.
    await expect(rail.getByText(/^\d+ airports?$/)).toBeVisible();
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await page.goto('/explore');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    // Judged on the settled page, after the entrance motion has finished.
    await waitForEntranceMotion(page);

    expect(await axeFindings(page)).toEqual([]);
  });
});
