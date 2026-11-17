/** A weight, in words: the slider's value is read out as a sentence, not a number. */
export function weightWord(weight: number): string {
  if (weight <= 0) return 'ignored';
  if (weight < 1) return 'less';
  if (weight === 1) return 'normal';
  if (weight < 2) return 'more';
  return 'most';
}
