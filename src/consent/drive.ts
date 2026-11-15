import type { ConsentChoice } from './cookie';

/**
 * Where the Travelpayouts Drive script comes from, and when it may load.
 *
 * Pure and free of the env module so the proxy (which must not import it) and
 * the layout can ask the same question and get the same answer. The CSP and
 * the `<script>` tag are both derived from `driveScriptSrc`, so they cannot
 * disagree about whether the third party is allowed.
 *
 * The id in the URL is the public site id from the Travelpayouts dashboard,
 * not a secret.
 */

export const DRIVE_ORIGIN = 'https://emrldco.com';
export const DRIVE_SRC = `${DRIVE_ORIGIN}/NTc2Nzgx.js?t=576781`;

/**
 * The stand-in served from our own origin when `DRIVE_TEST_STUB` is set. It is
 * what lets the end-to-end suite prove the gating without ever contacting the
 * real host.
 */
export const DRIVE_STUB_SRC = '/api/test/drive-stub';

export interface DriveInputs {
  readonly nodeEnv: string;
  readonly allowMockInProduction: boolean;
  /** `DRIVE_TEST_STUB`. Honoured only where mock data is also allowed. */
  readonly testStub: boolean;
  readonly consent: ConsentChoice | null;
}

/**
 * The script to load for this request, or null for none.
 *
 *  - No consent, no script. `declined` and "never asked" are the same here.
 *  - The stub is honoured only when `ALLOW_MOCK_IN_PRODUCTION` is also set,
 *    which a real deployment refuses to start with. A stray `DRIVE_TEST_STUB`
 *    on a live site therefore does nothing: it cannot swap the real script for
 *    a different one, nor switch the real one off by accident.
 *  - The real script loads in real production only: not in development, not in
 *    tests, not in the e2e production build.
 */
export function driveScriptSrc(input: DriveInputs): string | null {
  if (input.consent !== 'accepted') return null;
  if (input.testStub && input.allowMockInProduction) return DRIVE_STUB_SRC;
  if (input.nodeEnv === 'production' && !input.allowMockInProduction) return DRIVE_SRC;
  return null;
}

/** The third-party origin the CSP must name for this request, or null. */
export function driveCspOrigin(input: DriveInputs): string | null {
  return driveScriptSrc(input) === DRIVE_SRC ? DRIVE_ORIGIN : null;
}
