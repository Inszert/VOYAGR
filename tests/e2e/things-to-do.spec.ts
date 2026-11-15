import { expect, test } from '@playwright/test';
import { axeFindings, waitForEntranceMotion } from './support/axe';
import { watchRequests } from './support/requests';

/**
 * "Things to do" on a destination page.
 *
 * The suite runs on the mock places provider, so these places are samples and
 * the page says so; what is under test is the section's structure, its filter
 * links, its honesty about what it is, and that none of it breaks the page's
 * accessibility or reaches a third party. The live source is covered by the
 * adapter's recorded-response tests, never by a browser test.
 */

const ANTALYA = '/destinations/ayt';

test.describe('things to do', () => {
  test('is a section with a count, filter links and cards', async ({ page }) => {
    await page.goto(ANTALYA);

    const section = page.getByRole('region', { name: 'Things to do in Antalya' });
    await expect(section).toBeVisible();
    await expect(section.getByText(/^\d+ places?/)).toBeVisible();
    await expect(section.getByText(/samples for demonstration/)).toBeVisible();

    const filters = section.getByRole('navigation', { name: 'Filter things to do by kind' });
    await expect(filters.getByRole('link', { name: 'All' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(await section.getByRole('heading', { level: 3 }).count()).toBeGreaterThan(0);
    await expect(
      section.getByText(
        'Places from Wikidata (CC0); photographs from Wikimedia Commons, credited below.',
      ),
    ).toBeVisible();
  });

  test('filters by kind with a plain link, server-rendered, and marks the current one', async ({
    page,
  }) => {
    await page.goto(ANTALYA);

    const section = page.getByRole('region', { name: 'Things to do in Antalya' });
    await section
      .getByRole('navigation', { name: 'Filter things to do by kind' })
      .getByRole('link', { name: /^Museums/ })
      .click();

    await expect(page).toHaveURL(/[?&]kind=museums/);
    const filtered = page.getByRole('region', { name: 'Things to do in Antalya' });
    await expect(filtered.getByRole('link', { name: /^Museums/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(filtered.getByRole('link', { name: 'All' })).not.toHaveAttribute(
      'aria-current',
      'true',
    );
    for (const eyebrow of await filtered.getByText(/^Museums$/).all()) {
      await expect(eyebrow).toBeVisible();
    }
    await expect(filtered.getByText(/^Sights$/)).toHaveCount(0);
  });

  test('ignores a kind it does not know rather than showing nothing', async ({ page }) => {
    await page.goto(`${ANTALYA}?kind=nightlife`);

    const section = page.getByRole('region', { name: 'Things to do in Antalya' });
    await expect(section.getByRole('link', { name: 'All' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('shows no score, rating or price on a place', async ({ page }) => {
    await page.goto(ANTALYA);

    const section = page.getByRole('region', { name: 'Things to do in Antalya' });
    await expect(section).toBeVisible();
    await expect(section.getByText(/rated|stars?\b|reviews?|[€$£]/i)).toHaveCount(0);
  });

  test('has no accessibility violations, in a filtered view too, and reaches no third party', async ({
    page,
  }) => {
    const requests = watchRequests(page);

    for (const path of [ANTALYA, `${ANTALYA}?kind=museums`]) {
      await page.goto(path);
      await expect(page.getByRole('region', { name: 'Things to do in Antalya' })).toBeVisible();
      await waitForEntranceMotion(page);

      expect(await axeFindings(page), path).toEqual([]);
    }

    expect(requests.external).toEqual([]);
  });
});
