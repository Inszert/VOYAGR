import { expect, test, type Page } from '@playwright/test';

/**
 * One globe for the life of the visit.
 *
 * The complaint was that updating the requirements rebuilt the whole planet.
 * The cause was that the front page and the explorer each rendered their own
 * globe and a search was a full document load between them. The globe now
 * lives in the `(stage)` layout, so the claim under test is identity: the same
 * MapLibre object and the same canvas element, before and after each kind of
 * navigation, in a document that was never reloaded.
 */

interface Held {
  __voyagrMap?: { getCanvas(): HTMLCanvasElement };
  __held?: { map: unknown; canvas: HTMLCanvasElement; document: string };
}

async function hold(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as Held).__voyagrMap), null, {
    timeout: 30_000,
  });
  await page.evaluate(() => {
    const w = window as unknown as Held;
    const map = w.__voyagrMap!;
    w.__held = { map, canvas: map.getCanvas(), document: 'first' };
    (document.documentElement as HTMLElement).dataset.firstDocument = 'true';
  });
}

/** The same map object, the same canvas, still attached, in the same document. */
async function expectSameGlobe(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = window as unknown as Held;
          const held = w.__held;
          if (!held || !w.__voyagrMap) return 'no map';
          if (w.__voyagrMap !== held.map) return 'a different map object';
          if (w.__voyagrMap.getCanvas() !== held.canvas) return 'a different canvas';
          if (!held.canvas.isConnected) return 'canvas detached';
          if (document.documentElement.dataset.firstDocument !== 'true') return 'document reloaded';
          return 'same';
        }),
      { timeout: 20_000 },
    )
    .toBe('same');
}

function weekendOnOrAfter(earliest: string): { friday: string; sunday: string } {
  const day = Date.UTC(
    Number(earliest.slice(0, 4)),
    Number(earliest.slice(5, 7)) - 1,
    Number(earliest.slice(8, 10)),
  );
  const friday = day + ((((5 - new Date(day).getUTCDay()) % 7) + 7) % 7) * 86_400_000;
  const iso = (value: number) => new Date(value).toISOString().slice(0, 10);

  return { friday: iso(friday), sunday: iso(friday + 2 * 86_400_000) };
}

test.describe('the persistent globe', () => {
  test('is the same map and canvas through a search and a change of dates', async ({ page }) => {
    await page.goto('/');
    await hold(page);

    // 1. A search from the front page lands on the explorer.
    await page.getByRole('button', { name: 'Search trips' }).click();
    await expect(page).toHaveURL(/\/explore\?/);
    await expect(page.getByRole('heading', { name: /trips? match/ })).toBeVisible();
    await expectSameGlobe(page);

    // 2. Narrowing to one set of dates, on the explorer itself.
    const dates = page.getByRole('region', { name: 'Pick your dates' });
    await expect(dates).toBeVisible();
    await dates.locator('dl a').first().click();
    await expect(page).toHaveURL(/fDates=/);
    await expectSameGlobe(page);

    // 3. Changing the requirements: back to the form, new dates, search again.
    await page.getByRole('link', { name: 'Change search' }).click();
    await expect(page).toHaveURL(/edit=1/);

    const leaving = page.getByLabel('Leaving');
    const back = page.getByLabel('Back', { exact: true });
    // On a phone the fields are folded behind the bar's "Edit" toggle.
    if (!(await leaving.isVisible())) await page.getByText('Edit', { exact: true }).click();
    const earliest = (await back.getAttribute('min')) ?? (await leaving.getAttribute('min'));
    expect(earliest).toBeTruthy();
    const { friday, sunday } = weekendOnOrAfter(earliest!);
    await leaving.fill(friday);
    await back.fill(sunday);
    await page.getByRole('button', { name: 'Search trips' }).click();

    // The two dates typed arrive as the search's own; the window around them is derived.
    await expect(page).toHaveURL(
      new RegExp(`/explore\\?.*departureDate=${friday}.*returnDate=${sunday}`),
    );
    await expect(page.getByRole('heading', { name: /trips? match/ })).toBeVisible();
    await expectSameGlobe(page);
  });

  test('survives a lens and the primary navigation between the two pages', async ({ page }) => {
    await page.goto('/');
    await hold(page);

    const primary = page.getByRole('navigation', { name: 'Primary' });
    if (!(await primary.isVisible())) await page.getByRole('button', { name: 'Menu' }).click();
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Explore' })
      .click();
    await expect(page).toHaveURL(/\/explore$/);
    await expectSameGlobe(page);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expectSameGlobe(page);
  });
});
