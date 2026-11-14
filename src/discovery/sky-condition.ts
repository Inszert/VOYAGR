import type { DateWeather } from '@/search/date-options';

/**
 * What the sky is expected to do at a destination during the searched dates.
 *
 * A word for a place on the globe, derived from the weather figures the search
 * already produced (`DateWeather`) and nothing else. It never invents a
 * reading: a destination with no outlook has no condition, rather than a
 * pleasant default.
 *
 * Order matters and is the whole of the rule: snow first (cold enough that
 * whatever falls is snow), then rain, then dry, and "mild" for everything in
 * between. A destination is called one thing, the most notable one.
 */
export type SkyCondition = 'snowy' | 'rainy' | 'dry' | 'mild';

/** At or below this the warmest part of the stay is cold enough for snow to settle. */
export const SNOW_MAX_C = 4;
/** Some chance of precipitation is needed for cold to mean snow rather than just cold. */
export const SNOW_MIN_CHANCE = 0.3;
/**
 * The highest daily chance of rain at which the stay is called rainy.
 *
 * Above even odds on purpose: `rainChance` is the worst day of the stay, so
 * at 0.5 and below almost everywhere qualified and the word said nothing. The
 * figures the search returns today sit between about 0.25 and 0.57, and these
 * two cut that range into three groups that each mean something.
 */
export const RAINY_CHANCE = 0.55;
/** At or below this the stay is called dry. */
export const DRY_CHANCE = 0.4;

export function skyConditionOf(weather: DateWeather | null): SkyCondition | null {
  if (!weather) return null;

  if (weather.maxC <= SNOW_MAX_C && weather.rainChance >= SNOW_MIN_CHANCE) return 'snowy';
  if (weather.rainChance >= RAINY_CHANCE) return 'rainy';
  if (weather.rainChance <= DRY_CHANCE) return 'dry';

  return 'mild';
}

/** The words shown beside the place. Colour alone never carries this. */
export const SKY_LABEL: Readonly<Record<SkyCondition, string>> = {
  snowy: 'Snowy',
  rainy: 'Rainy',
  dry: 'Dry',
  mild: 'Mild',
};
