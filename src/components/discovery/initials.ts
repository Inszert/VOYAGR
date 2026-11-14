/**
 * The letters on a destination tile that has no picture.
 *
 * A place with no photograph gets a plain tile with its country's initials,
 * not a decorative gradient: a gradient looks like an image that is about to
 * load, and says nothing about where this is. "Georgia" is GE, "Solomon
 * Islands" is SI, "Czech Republic" is CR.
 */
export function initials(country: string): string {
  const words = country
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[\s-]+/)
    .filter(
      (word) =>
        /^[A-Za-z]/.test(word) && word.toLowerCase() !== 'of' && word.toLowerCase() !== 'the',
    );

  if (words.length === 0) return '';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();

  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
