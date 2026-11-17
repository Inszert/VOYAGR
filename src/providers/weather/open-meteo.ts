import { z } from 'zod';
import type { IsoDate, WeatherOutlook } from '@/core/trip/types';
import { FORECAST_HORIZON_DAYS } from '@/core/trip/weather-window';
import { addDays, addMonths, daysBetween, datesBetween } from '@/core/dates';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok, type Result } from '@/lib/result';
import { resolveAirport } from '../reference/airports';
import type { FetchLike } from '../http/types';
import { redactUrl } from '../http/redact';
import type {
  ProviderHealth,
  ProviderRequestOptions,
  ProviderResult,
  WeatherProvider,
  WeatherQuery,
} from '../types';

/**
 * Open-Meteo, behind the weather adapter interface.
 *
 * Free, no API key, no account - https://open-meteo.com/en/pricing documents
 * the non-commercial tier as 600 requests/minute, 5,000/hour, 10,000/day,
 * with no card and no automatic billing. Data is CC BY 4.0. **Read before
 * this earns the product any revenue**: the free tier's own wording is "for
 * non-commercial use" and Open-Meteo does not define that boundary anywhere
 * public, so whether a monetised Voyagr still qualifies is a question for
 * the vendor, not an assumption to make here.
 *
 * No API key means nothing here is a secret - `redactUrl` is used anyway,
 * for consistency with every other adapter's logging, not because this one
 * needs it.
 *
 * **Two different questions, two different endpoints, two different
 * trust levels:**
 *
 * - Within the free forecast horizon (today plus {@link FORECAST_HORIZON_DAYS}
 *   days), `/v1/forecast` answers with an actual meteorological forecast for
 *   the requested dates. Confidence decays with lead time, same shape as the
 *   mock it replaces.
 * - Beyond that horizon there is no forecast to ask for, by construction -
 *   nobody's forecast reaches that far and pretending otherwise is the exact
 *   dishonesty `core/freshness.ts` and this module's provenance exist to
 *   prevent. What *is* real is history: the archive API at
 *   `archive-api.open-meteo.com` serves actual recorded daily weather for any
 *   past date. Averaging the same calendar month across
 *   {@link CLIMATOLOGY_YEARS_SAMPLED} recent years reconstructs a genuine
 *   seasonal normal - at month resolution, the same resolution the mock's own
 *   `monthlyHighC` profile used, so this is not a precision regression - from
 *   real recordings rather than a hand-entered guess.
 *
 * **What this adapter does not attempt:** a sea-surface temperature. Open-
 * Meteo's Marine API can answer that, but only honestly for a coordinate
 * that is actually at the coast, and nothing in the airport reference data
 * says whether a destination is one. Calling it unconditionally would show a
 * confident-looking sea temperature for Vienna. `seaTemperatureC` is `null`
 * for every outlook this adapter produces until that signal exists - the
 * same "unknown gets its own branch" rule the rest of the domain follows,
 * not an oversight.
 *
 * **A date this adapter cannot speak to is omitted, never invented.** If an
 * airport code has no reference position, the whole call fails loudly
 * (`VALIDATION_ERROR`) rather than guessing coordinates. If climatology for
 * a requested month could not be reconstructed from any sampled year, that
 * date is simply absent from the returned list - `WeatherOutlook` has no
 * "unavailable" case to carry the reason, which the mock never needed
 * because it never fails. A caller reading a shorter outlook than it asked
 * for is reading an honest answer, not a bug.
 */

const log = getLogger('providers.open-meteo');

const FORECAST_BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_BASE_URL = 'https://archive-api.open-meteo.com/v1/archive';

/** Past years averaged into a climatology normal. Bounded: more years is more HTTP calls. */
const CLIMATOLOGY_YEARS_SAMPLED = 3;

/** A day counts as "rain" for the climatology rain-fraction at or above this many millimetres. */
const RAIN_DAY_THRESHOLD_MM = 1;

const CLIMATOLOGY_CONFIDENCE = 0.3;

function confidenceForLeadDays(leadDays: number): number {
  const FORECAST_DAY_ZERO_CONFIDENCE = 0.9;
  const FORECAST_HORIZON_CONFIDENCE = 0.55;

  if (leadDays <= 0) return FORECAST_DAY_ZERO_CONFIDENCE;
  if (leadDays >= FORECAST_HORIZON_DAYS) return FORECAST_HORIZON_CONFIDENCE;

  const decayed =
    FORECAST_DAY_ZERO_CONFIDENCE -
    (leadDays / FORECAST_HORIZON_DAYS) *
      (FORECAST_DAY_ZERO_CONFIDENCE - FORECAST_HORIZON_CONFIDENCE);
  return Math.round(decayed * 100) / 100;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

const forecastResponseSchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    // Every figure is nullable: the real API answers `null` for
    // `precipitation_probability_max` on the last day or two of the 16-day
    // horizon (recorded in forecast-vienna-horizon-nulls.json). A day with
    // any null is dropped below, not defaulted, and not a reason to reject
    // the whole response.
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_probability_max: z.array(z.number().nullable()),
    wind_speed_10m_max: z.array(z.number().nullable()),
  }),
});

const archiveResponseSchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_sum: z.array(z.number().nullable()),
    wind_speed_10m_max: z.array(z.number().nullable()),
  }),
});

const errorResponseSchema = z.object({ error: z.literal(true), reason: z.string() });

export interface OpenMeteoOptions {
  readonly fetchImpl?: FetchLike;
  /** Injectable so a test can assert lead-time confidence without a real clock. */
  readonly now?: () => Date;
}

export class OpenMeteoWeatherProvider implements WeatherProvider {
  readonly metadata = {
    id: 'open-meteo',
    kind: 'weather',
    displayName: 'Open-Meteo',
    isMock: false,
    rateLimitPerMinute: 600,
  } as const;

  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  constructor(options: OpenMeteoOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => new Date());
  }

  async checkHealth(options?: ProviderRequestOptions): Promise<ProviderHealth> {
    const startedAt = Date.now();
    const url = `${FORECAST_BASE_URL}?latitude=0&longitude=0&daily=temperature_2m_max&forecast_days=1`;

    try {
      const response = await this.fetchImpl(
        url,
        options?.signal ? { signal: options.signal } : undefined,
      );
      return {
        status: response.ok ? 'healthy' : 'degraded',
        checkedAt: this.now().toISOString(),
        latencyMs: Date.now() - startedAt,
        ...(response.ok ? {} : { message: `Responded with ${response.status}.` }),
      };
    } catch (error) {
      return {
        status: 'unavailable',
        checkedAt: this.now().toISOString(),
        latencyMs: null,
        message: error instanceof Error ? error.message : 'Health check failed.',
      };
    }
  }

  async getOutlook(
    query: WeatherQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly WeatherOutlook[]>> {
    const airport = resolveAirport(query.destination);
    if (!airport) {
      return err(
        new AppError(
          'VALIDATION_ERROR',
          `No airport reference data for "${query.destination}"; cannot resolve a location to ask Open-Meteo about.`,
        ),
      );
    }

    const allDates = datesBetween(query.startDate, query.endDate);
    if (allDates.length === 0) return ok([]);

    const [longitude, latitude] = airport.position;
    const today = this.now().toISOString().slice(0, 10) as IsoDate;

    const isWithinForecastHorizon = (date: IsoDate) => {
      const lead = daysBetween(today, date);
      return lead >= 0 && lead <= FORECAST_HORIZON_DAYS;
    };

    const forecastDates = allDates.filter(isWithinForecastHorizon);
    const climatologyDates = allDates.filter((date) => !isWithinForecastHorizon(date));

    const byDate = new Map<IsoDate, WeatherOutlook>();

    if (forecastDates.length > 0) {
      const result = await this.fetchForecast(latitude, longitude, forecastDates, today, options);
      if (!result.ok) return result;
      for (const outlook of result.value) byDate.set(outlook.date, outlook);
    }

    if (climatologyDates.length > 0) {
      const result = await this.fetchClimatology(latitude, longitude, climatologyDates, options);
      if (!result.ok) return result;
      for (const outlook of result.value) byDate.set(outlook.date, outlook);
    }

    // In request order, and only the dates an answer actually exists for -
    // see the module comment on why a gap here is correct, not a bug.
    return ok(allDates.flatMap((date) => (byDate.has(date) ? [byDate.get(date)!] : [])));
  }

  private async fetchForecast(
    latitude: number,
    longitude: number,
    dates: readonly IsoDate[],
    today: IsoDate,
    options?: ProviderRequestOptions,
  ): Promise<Result<readonly WeatherOutlook[], AppError>> {
    const start = dates[0] as string;
    const end = dates[dates.length - 1] as string;
    const url =
      `${FORECAST_BASE_URL}?latitude=${latitude}&longitude=${longitude}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max` +
      `&timezone=auto&start_date=${start}&end_date=${end}`;

    const response = await this.request(url, options);
    if (!response.ok) return response;

    const parsed = forecastResponseSchema.safeParse(response.value);
    if (!parsed.success) {
      log.warn(
        { url: redactUrl(url), issues: parsed.error.issues },
        'open-meteo forecast shape unrecognised',
      );
      return err(
        new AppError('PROVIDER_ERROR', 'Open-Meteo returned an unrecognised forecast response.'),
      );
    }

    const {
      time,
      temperature_2m_max,
      temperature_2m_min,
      precipitation_probability_max,
      wind_speed_10m_max,
    } = parsed.data.daily;

    const requested = new Set<string>(dates);
    const outlook: WeatherOutlook[] = [];

    time.forEach((date, index) => {
      if (!requested.has(date)) return;

      const maxC = temperature_2m_max[index];
      const minC = temperature_2m_min[index];
      const rainPercent = precipitation_probability_max[index];
      const wind = wind_speed_10m_max[index];
      // The vendor did not state a figure for this day (typically the rain
      // probability at the far end of the horizon). `WeatherOutlook` has no
      // unknown case, so the day is omitted rather than given a made-up 0.
      if (maxC == null || minC == null || rainPercent == null || wind == null) return;

      outlook.push({
        date: date as IsoDate,
        basis: 'forecast',
        temperatureMaxC: maxC,
        temperatureMinC: minC,
        precipitationProbability: rainPercent / 100,
        windKph: Math.round(wind),
        seaTemperatureC: null,
        confidence: confidenceForLeadDays(daysBetween(today, date as IsoDate)),
      });
    });

    return ok(outlook);
  }

  private async fetchClimatology(
    latitude: number,
    longitude: number,
    dates: readonly IsoDate[],
    options?: ProviderRequestOptions,
  ): Promise<Result<readonly WeatherOutlook[], AppError>> {
    const currentYear = this.now().getUTCFullYear();
    const months = [...new Set(dates.map((date) => date.slice(5, 7)))];

    const byMonth = new Map<
      string,
      {
        readonly maxC: number;
        readonly minC: number;
        readonly windKph: number;
        readonly rainFraction: number;
      }
    >();

    for (const month of months) {
      const samples: { maxC: number; minC: number; windKph: number; rain: boolean }[] = [];

      for (let yearsAgo = 1; yearsAgo <= CLIMATOLOGY_YEARS_SAMPLED; yearsAgo += 1) {
        const year = currentYear - yearsAgo;
        const monthStart = `${year}-${month}-01` as IsoDate;
        const monthEnd = addDays(addMonths(monthStart, 1), -1);
        const url =
          `${ARCHIVE_BASE_URL}?latitude=${latitude}&longitude=${longitude}` +
          `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max` +
          `&timezone=auto&start_date=${monthStart}&end_date=${monthEnd}`;

        const response = await this.request(url, options);
        // One missing year of history is tolerated - a vendor outage on one
        // call must not fail a normal built from three. All three missing
        // for this month is handled below, once every year has been tried.
        if (!response.ok) continue;

        const parsed = archiveResponseSchema.safeParse(response.value);
        if (!parsed.success) {
          log.warn(
            { url: redactUrl(url), issues: parsed.error.issues },
            'open-meteo archive shape unrecognised',
          );
          continue;
        }

        const { temperature_2m_max, temperature_2m_min, precipitation_sum, wind_speed_10m_max } =
          parsed.data.daily;

        temperature_2m_max.forEach((maxC, index) => {
          const minC = temperature_2m_min[index];
          const wind = wind_speed_10m_max[index];
          // The vendor itself has gaps in its historical record on some
          // days; a day it did not record contributes nothing rather than a
          // fabricated figure. `== null` deliberately: a missing index and an
          // explicit `null` from the vendor both mean "no figure".
          if (maxC == null || minC == null || wind == null) return;

          samples.push({
            maxC,
            minC,
            windKph: wind,
            rain: (precipitation_sum[index] ?? 0) >= RAIN_DAY_THRESHOLD_MM,
          });
        });
      }

      if (samples.length === 0) continue;

      byMonth.set(month, {
        maxC: round1(average(samples.map((s) => s.maxC))),
        minC: round1(average(samples.map((s) => s.minC))),
        windKph: Math.round(average(samples.map((s) => s.windKph))),
        rainFraction:
          Math.round((samples.filter((s) => s.rain).length / samples.length) * 100) / 100,
      });
    }

    const outlook: WeatherOutlook[] = [];
    for (const date of dates) {
      const monthly = byMonth.get(date.slice(5, 7));
      if (!monthly) continue;

      outlook.push({
        date,
        basis: 'climatology',
        temperatureMaxC: monthly.maxC,
        temperatureMinC: monthly.minC,
        precipitationProbability: monthly.rainFraction,
        windKph: monthly.windKph,
        seaTemperatureC: null,
        confidence: CLIMATOLOGY_CONFIDENCE,
      });
    }

    return ok(outlook);
  }

  /** One fetch attempt, mapped to a `Result`. No retry here - that is `policy.ts`'s job upstream. */
  private async request(
    url: string,
    options?: ProviderRequestOptions,
  ): Promise<Result<unknown, AppError>> {
    try {
      const response = await this.fetchImpl(
        url,
        options?.signal ? { signal: options.signal } : undefined,
      );
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        const reason = errorResponseSchema.safeParse(json);
        log.warn(
          {
            status: response.status,
            url: redactUrl(url),
            reason: reason.success ? reason.data.reason : undefined,
          },
          'open-meteo responded with an error status',
        );

        return err(
          new AppError(
            response.status === 429 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
            `Open-Meteo responded with ${response.status}.`,
          ),
        );
      }

      if (json === null) {
        return err(new AppError('PROVIDER_ERROR', 'Open-Meteo returned an unparsable response.'));
      }

      return ok(json);
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      log.warn({ err: error, url: redactUrl(url) }, 'open-meteo request failed');

      return err(
        new AppError(
          aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
          aborted ? 'Open-Meteo did not answer in time.' : 'Open-Meteo could not be reached.',
        ),
      );
    }
  }
}

export function createOpenMeteoWeatherProvider(options?: OpenMeteoOptions): WeatherProvider {
  return new OpenMeteoWeatherProvider(options);
}
