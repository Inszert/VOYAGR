/**
 * Which of the palette's five tints belongs to a place.
 *
 * Decoration, and deterministic: the same key always gets the same tint, on
 * the server and in the browser, on every page. Keyed by country where there
 * is one, so every place in a country shares a colour and moving between two
 * of them does not change the page's mood for no reason.
 *
 * The values themselves live in `globals.css` under `[data-tint]`. This only
 * chooses a name; it never produces a colour, and nothing that means anything
 * - a price, a status, a warning - is ever tinted.
 */

export const TINTS = ['leather', 'sand', 'sage', 'harbour', 'clay'] as const;

export type Tint = (typeof TINTS)[number];

export function tintFor(key: string | null | undefined): Tint {
  if (!key) return 'leather';

  const sum = [...key.trim().toUpperCase()].reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );

  return TINTS[sum % TINTS.length]!;
}
