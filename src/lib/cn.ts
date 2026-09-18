import { twMerge } from 'tailwind-merge';

type ClassValue = string | number | null | undefined | false | ClassValue[];

function flatten(value: ClassValue): string[] {
  if (value === null || value === undefined || value === false || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(flatten);
  return [String(value)];
}

/**
 * Merge Tailwind class names, letting later classes win over conflicting earlier
 * ones. Keeps component `className` overrides predictable.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(inputs.flatMap(flatten).join(' '));
}
