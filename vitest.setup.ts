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
