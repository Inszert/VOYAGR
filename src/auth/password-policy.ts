/**
 * Password policy constants.
 *
 * Deliberately in their own module with no imports. `password.ts` needs
 * `node:crypto`, which cannot be bundled into a client component, so a form
 * that only wants to tell the user "at least twelve characters" must not have
 * to reach for the hashing module to find out what the number is.
 */

/** Minimum length. Length beats composition rules; no character-class theatre. */
export const MIN_PASSWORD_LENGTH = 12;

/** An upper bound, so a megabyte-long password cannot be a denial of service. */
export const MAX_PASSWORD_LENGTH = 200;
