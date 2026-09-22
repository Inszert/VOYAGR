import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Component test setup.
 *
 * Unmounts between tests so a leaked component cannot make the next test pass
 * for the wrong reason.
 */
afterEach(() => {
  cleanup();
});

/*
 * Observers jsdom does not implement.
 *
 * Radix measures its own parts - the slider reads its track width to work out
 * where a thumb sits, and the popover watches its trigger to stay anchored -
 * through `ResizeObserver`. jsdom has no layout, so it ships neither this nor
 * `DOMRect.fromRect`, and a component that uses one throws on mount rather
 * than rendering without it.
 *
 * Stubbed rather than faked: these report nothing, because there is nothing
 * to report in a test environment with no layout. They exist so the component
 * mounts and its markup - labels, roles, values - can be asserted, which is
 * what these suites are for. Anything that depends on a real measurement
 * belongs in the Playwright suite, which runs in a browser that has one.
 */
class NoLayoutResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= NoLayoutResizeObserver;

globalThis.DOMRect ??= class DOMRectStub {
  constructor(
    readonly x = 0,
    readonly y = 0,
    readonly width = 0,
    readonly height = 0,
  ) {}
  readonly top = 0;
  readonly left = 0;
  readonly right = 0;
  readonly bottom = 0;
  toJSON() {
    return this;
  }
  static fromRect() {
    return new DOMRectStub();
  }
} as unknown as typeof DOMRect;
