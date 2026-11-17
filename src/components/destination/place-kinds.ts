import type { IconName } from '@/components/ui';
import type { Tint } from '@/lib/tint';
import type { ThingKind } from '@/providers/types';

/**
 * The words for each kind. The same as `KIND_LABELS` in `src/discovery/things-to-do.ts`,
 * which cannot be imported into a client component (it reads the cache and the
 * provider registry); a test holds the two together.
 */
export const KIND_WORDS: Readonly<Record<ThingKind, string>> = {
  sights: 'Sights',
  museums: 'Museums',
  beaches: 'Beaches',
  outdoors: 'Outdoors',
  neighbourhoods: 'Neighbourhoods',
  food: 'Food & markets',
  culture: 'Culture',
};

/** The mark and the colour of each kind of place, shared by the list, the plan and the sheet. */
export const KIND_ICON: Record<ThingKind, IconName> = {
  sights: 'pin',
  museums: 'sparkle',
  beaches: 'sun',
  outdoors: 'sun',
  neighbourhoods: 'map',
  food: 'utensils',
  culture: 'star',
};

export const KIND_TINT: Record<ThingKind, Tint> = {
  sights: 'harbour',
  museums: 'leather',
  beaches: 'harbour',
  outdoors: 'sage',
  neighbourhoods: 'sand',
  food: 'clay',
  culture: 'harbour',
};

/** "mosque in Turkey" starts a card; the source writes it as a phrase. */
export function sentenceCase(text: string): string {
  const trimmed = text.trim().replace(/\.$/, '');

  return trimmed.charAt(0).toLocaleUpperCase('en') + trimmed.slice(1);
}
