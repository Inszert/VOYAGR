import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * Contrast is judged on the settled page.
 *
 * Entrance motion fades content in, and a card sampled mid-fade reads as low
 * contrast without being so once it has arrived. Two kinds of animation are
 * not "entrance motion" and are never waited for:
 *
 *  - an ambient loop (the weather drifting over the page) never finishes by
 *    design;
 *  - a scroll-driven animation (`animation-timeline: view()`) is tied to the
 *    scroll position rather than the clock, so on a page nobody has scrolled
 *    it is never "finished". Waiting for it would wait forever.
 */
export async function waitForEntranceMotion(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => {
      const timing = animation.effect?.getComputedTiming();
      if (timing && timing.iterations === Infinity) return true;
      if (animation.timeline && !(animation.timeline instanceof DocumentTimeline)) return true;

      return animation.playState === 'finished';
    }),
  );
}

/** Every WCAG 2.x A/AA finding on the page, one readable line each. */
export async function axeFindings(
  page: Page,
  options: { include?: string | string[] } = {},
): Promise<string[]> {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  for (const selector of [options.include ?? []].flat()) builder.include(selector);
  const results = await builder.analyze();

  // The rule *and the offending element*: a bare rule id means someone has to
  // reproduce the run locally to find the node.
  return results.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) => `${violation.id} at ${node.target.join(' ')} — ${node.failureSummary?.trim()}`,
    ),
  );
}
