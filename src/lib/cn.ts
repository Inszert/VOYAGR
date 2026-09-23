import { extendTailwindMerge } from 'tailwind-merge';

/*
 * The merge, told about our own type scale.
 *
 * `text-display-sm/md/lg` are font sizes defined in `globals.css`. Unknown to
 * tailwind-merge, they were read as text colours - so `text-display-md` beside
 * `text-white` was one colour too many and the heading silently lost its size.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display-sm', 'display-md', 'display-lg'] }],
    },
  },
});

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
