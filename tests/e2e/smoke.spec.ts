import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Foundation smoke test.
 *
 * Deliberately narrow. It proves the things the bootstrap actually claims: the
 * app builds and serves, the health endpoint reports honestly, the PWA manifest
 * and service worker are reachable, security headers are applied, and the page
 * has no automatically-detectable accessibility violations.
 *
 * It asserts nothing about travel search, because no travel search exists yet.
 */

test.describe('application shell', () => {
  test('serves the home page with its main landmark', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Voyagr');
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('exposes a working skip link as the first tab stop', async ({ page }) => {
    await page.goto('/');

    await page.keyboard.press('Tab');

    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main-content$/);
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await page.goto('/');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    // Report the rule *and the offending element* on failure. A bare rule id
    // means someone has to reproduce the run locally to find the node.
    const findings = results.violations.flatMap((violation) =>
      violation.nodes.map(
        (node) => `${violation.id} at ${node.target.join(' ')} — ${node.failureSummary?.trim()}`,
      ),
    );

    expect(findings).toEqual([]);
  });

  test('renders a 404 for an unknown route', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});

test.describe('health endpoint', () => {
  test('reports status and capabilities', async ({ request }) => {
    const response = await request.get('/api/health');

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('voyagr');

    // With no external services configured, everything should be mocked.
    expect(body.capabilities.providersFullyMocked).toBe(true);
    expect(body.capabilities.database).toBe(false);
    expect(body.capabilities.ai).toBe('mock');
  });

  test('never leaks configuration values', async ({ request }) => {
    // A health endpoint is a favourite reconnaissance target.
    const body = await (await request.get('/api/health')).text();

    expect(body).not.toMatch(/postgresql:\/\//);
    expect(body).not.toMatch(/redis:\/\//);
    expect(body).not.toMatch(/sk-[a-zA-Z0-9]/);
  });

  test('is not cached', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.headers()['cache-control']).toContain('no-store');
  });
});

test.describe('PWA foundation', () => {
  test('serves a valid manifest with installable icons', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.status()).toBe(200);

    const manifest = await response.json();
    expect(manifest.name).toContain('Voyagr');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');

    // Installability needs a 192 and a 512 icon, plus a maskable one.
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(
      true,
    );
  });

  test('serves every icon the manifest declares', async ({ request }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json();

    for (const icon of manifest.icons as Array<{ src: string; type: string }>) {
      const response = await request.get(icon.src);

      expect(response.status(), `${icon.src} should be served`).toBe(200);
      expect(response.headers()['content-type']).toContain('image/png');
    }
  });

  test('serves the service worker with a no-cache policy', async ({ request }) => {
    const response = await request.get('/sw.js');

    expect(response.status()).toBe(200);
    // A cached service worker can strand clients on an old app shell.
    expect(response.headers()['cache-control']).toContain('must-revalidate');
  });

  test('serves the offline fallback page', async ({ page }) => {
    await page.goto('/offline');
    await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();
  });
});

test.describe('security headers', () => {
  test('applies the baseline response headers', async ({ request }) => {
    const headers = (await request.get('/')).headers();

    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
  });

  test('does not advertise the framework', async ({ request }) => {
    const headers = (await request.get('/')).headers();
    expect(headers['x-powered-by']).toBeUndefined();
  });
});
