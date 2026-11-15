import { expect, test, type Page } from '@playwright/test';
import { axeFindings, waitForEntranceMotion } from './support/axe';
import { hydrated } from './support/searches';

/**
 * Every surface, in both viewports: no accessibility violations and no
 * hydration failure.
 *
 * The second half matters as much as the first. A hydration mismatch is
 * silent to the eye - React discards the server HTML and renders it again - but
 * it replaces every DOM node on the page, so a click that lands before it is
 * undone (a `<details>` snaps shut) and the page flashes. It surfaced as a
 * `<p>` nested in a `<p>`, which the HTML parser quietly rewrites on the server.
 * React reports it as an uncaught error, so one listener catches the class.
 */

const RESULTS =
  '/explore?origins=VIE&destinations=AYT%2C+CHQ%2C+SPU&earliestDeparture=2026-12-01' +
  '&latestReturn=2026-12-30&minNights=4&maxNights=7&passengers=2&currency=EUR' +
  '&targetBudget=650&maxBudget=850&travelStyle=balanced&optimisationMode=best_value';

function watchForPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  return errors;
}

const PUBLIC: Array<{ name: string; path: string; ready: (page: Page) => Promise<void> }> = [
  {
    name: 'the front page',
    path: '/',
    ready: async (page) =>
      expect(page.getByRole('heading', { level: 1, name: /See where you can go/ })).toBeVisible(),
  },
  {
    name: 'the explorer',
    path: '/explore',
    ready: async (page) =>
      expect(page.getByRole('heading', { level: 1, name: /Explore the world/ })).toBeVisible(),
  },
  {
    name: 'a search with results',
    path: RESULTS,
    ready: async (page) =>
      expect(page.getByRole('heading', { name: /trips? match/ })).toBeVisible(),
  },
  {
    name: 'a destination',
    path: '/destinations/ayt',
    ready: async (page) =>
      expect(page.getByRole('heading', { level: 1, name: 'Antalya' })).toBeVisible(),
  },
  {
    name: 'stays',
    path: '/stays',
    ready: async (page) => expect(page.getByRole('heading', { level: 1 })).toBeVisible(),
  },
  {
    name: 'sign in',
    path: '/sign-in',
    ready: async (page) => expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible(),
  },
  {
    name: 'sign up',
    path: '/sign-up',
    ready: async (page) =>
      expect(page.getByRole('button', { name: 'Create account' })).toBeVisible(),
  },
  {
    name: 'forgot password',
    path: '/forgot-password',
    ready: async (page) => expect(page.getByRole('heading', { level: 1 })).toBeVisible(),
  },
  {
    name: 'status',
    path: '/status',
    ready: async (page) => expect(page.getByRole('heading', { level: 1 })).toBeVisible(),
  },
  {
    name: 'privacy',
    path: '/privacy',
    ready: async (page) => expect(page.getByRole('heading', { level: 1 })).toBeVisible(),
  },
  {
    name: 'terms',
    path: '/terms',
    ready: async (page) => expect(page.getByRole('heading', { level: 1 })).toBeVisible(),
  },
];

test.describe('every public surface', () => {
  for (const surface of PUBLIC) {
    test(`${surface.name} hydrates cleanly and has no accessibility violations`, async ({
      page,
    }) => {
      const errors = watchForPageErrors(page);

      await page.goto(surface.path);
      await surface.ready(page);
      await waitForEntranceMotion(page);

      expect(await axeFindings(page)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('every signed-in surface', () => {
  test('hydrate cleanly and have no accessibility violations', async ({ page }) => {
    const errors = watchForPageErrors(page);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await page.goto('/sign-up');
    await page.getByRole('textbox', { name: 'Email' }).fill(`sweep-${id}@example.invalid`);
    await page.getByLabel('Password').fill('correct-horse-battery-staple');
    await hydrated(page.getByRole('button', { name: 'Create account' }));
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
    expect(await axeFindings(page), '/account').toEqual([]);

    for (const path of ['/trips', '/watches']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await waitForEntranceMotion(page);
      expect(await axeFindings(page), path).toEqual([]);
    }

    expect(errors).toEqual([]);
  });
});

test.describe('the front page', () => {
  test('does not move the search bar when the page hydrates', async ({ page }) => {
    // The hero measures where it starts and writes `--hero-top`; until it has,
    // the CSS uses a fallback. A fallback that differs from the measurement
    // moves the search bar under a thumb already on its way to it - on a phone
    // it was 56px, and a tap on "Edit" in that window went to the wrong place.
    //
    // Measured in layout (`offsetTop` up the chain), not on screen: the bar
    // also rises into place as an entrance, a transform, which is meant to move.
    await page.goto('/', { waitUntil: 'commit' });

    const bar = page.getByRole('button', { name: 'Search trips' });
    await expect(bar).toBeAttached();
    const layoutTop = () =>
      bar.evaluate((element) => {
        let top = 0;
        for (let node: HTMLElement | null = element as HTMLElement; node;) {
          top += node.offsetTop;
          node = node.offsetParent as HTMLElement | null;
        }
        return top;
      });

    const before = await layoutTop();
    await page.waitForFunction(
      () => document.documentElement.style.getPropertyValue('--hero-top') !== '',
    );
    const after = await layoutTop();

    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });
});

test.describe('the globe controls', () => {
  test('leave the Globe and Map switch where a finger can reach it', async ({ page }) => {
    // The search bar is pinned to the bottom of the hero below 1024px, and the
    // switch used to sit under it: present in the page, unreachable on screen.
    await page.goto('/');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    await waitForEntranceMotion(page);

    const width = page.viewportSize()?.width ?? 1280;
    const group = page.getByRole('group', { name: 'Projection' });

    for (const name of ['Globe', 'Map']) {
      const button = group.getByRole('button', { name });
      await expect(button).toBeVisible();

      const box = await button.boundingBox();
      expect(box, `${name} has a box`).not.toBeNull();
      // 44px is the size of a touch target; a wide screen keeps its compact switch.
      if (width < 1024) expect(box!.height).toBeGreaterThanOrEqual(44);

      // The element at the centre of the button is the button: nothing is on top of it.
      const covered = await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return hit !== element && !element.contains(hit);
      });
      expect(covered, `${name} is under something`).toBe(false);
    }
  });
});
