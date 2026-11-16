import { Container, Icon } from '@/components/ui';
import { DestinationPicture } from '@/components/search/destination-picture';
import { localDestinationImage } from '@/lib/destination-media';
import type { DestinationImage } from '@/providers/imagery/types';
import { imageryUrlFor } from '@/providers/imagery/url';
import '@/components/search/explore.css';
import { DestinationSlideshow } from './destination-slideshow';
import type { SlideFrame } from './slideshow-frames';
import './destination.css';

/**
 * The top of a destination's page: thirty seconds of the place, edge to edge.
 *
 * With three or more real photographs it is the slideshow (the illustration,
 * then photographs of the places listed below, each credited); with fewer it is
 * the one illustration, still. Either way it tucks under the site header, which
 * is transparent on this page, carries the `view-transition-name` of the card
 * that was clicked to get here, and has a scrim under the type so the name and
 * the dates read whatever the picture is.
 *
 * Every figure is passed in already formatted by the page; nothing is computed
 * here. The page's one `h1` is the place's name. The price is not here: it lives
 * in the sticky section bar and the plan panel, where it can be acted on.
 */

export interface DestinationHeroProps {
  code: string;
  name: string;
  /** The country in full. */
  country: string | null;
  /** The provider's photograph, used only when no shipped illustration exists. */
  image: DestinationImage | null;
  /** The outlook in one line, or null when the page was opened without dates. */
  weather: string | null;
  /** The dates this page describes, formatted. */
  dates: string | null;
  /**
   * The frames of the slideshow, or null when there are fewer than three real
   * photographs: the hero is then the one illustration, still.
   */
  frames?: readonly SlideFrame[] | null;
}

function HeroText({
  code,
  name,
  country,
  weather,
  dates,
}: Pick<DestinationHeroProps, 'code' | 'name' | 'country' | 'weather' | 'dates'>) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs font-semibold tracking-[0.2em] text-white/85 uppercase">
        {country ? `${country} · ` : ''}
        <span className="sr-only">airport </span>
        {code.toUpperCase()}
      </p>
      <h1
        id="destination-heading"
        className="font-display text-display-md sm:text-display-lg lg:text-display-xl text-balance text-white max-sm:text-[2.75rem] max-sm:leading-none"
      >
        {name}
      </h1>
      <p className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-white/85">
        {dates ? (
          <span className="flex items-center gap-2 tabular-nums">
            <Icon name="calendar" size={0.95} aria-hidden="true" />
            {dates}
          </span>
        ) : null}
        {weather ? (
          <span className="flex items-center gap-2 tabular-nums">
            <Icon name="sun" size={0.95} aria-hidden="true" />
            <span className="sr-only">Weather: </span>
            {weather}
          </span>
        ) : null}
      </p>
    </div>
  );
}

export function DestinationHero({
  code,
  name,
  country,
  image,
  weather,
  dates,
  frames = null,
}: DestinationHeroProps) {
  const shipped = localDestinationImage(code) !== null;
  const text = (
    <HeroText code={code} name={name} country={country} weather={weather} dates={dates} />
  );

  if (frames && frames.length >= 3) {
    return (
      <section
        id="overview"
        aria-labelledby="destination-heading"
        className="voyagr-anchor -mt-[var(--voyagr-header-h,4.5rem)]"
      >
        <DestinationSlideshow
          frames={frames}
          name={name}
          washCode={code}
          transitionName={`dest-${code.toUpperCase()}`}
        >
          {text}
        </DestinationSlideshow>
      </section>
    );
  }

  return (
    <section
      id="overview"
      aria-labelledby="destination-heading"
      className="stage-scope bg-stage text-stage-ink voyagr-anchor relative -mt-[var(--voyagr-header-h,4.5rem)]"
    >
      <DestinationPicture
        code={code}
        providerUrl={image ? imageryUrlFor(code) : null}
        alt={`${shipped ? 'Illustration' : 'Photograph'} of ${name}${country ? `, ${country}` : ''}`}
        priority
        sizes="100vw"
        transitionName={`dest-${code.toUpperCase()}`}
        className="flex min-h-[60dvh] flex-col justify-end md:min-h-[72vh]"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-t from-black/90 via-black/40 to-black/35"
        />

        <Container size="wide" className="pt-32 pb-8 md:pb-12">
          {text}

          <p className="mt-6 text-xs text-white/75">
            {image && !shipped ? (
              <>
                Photograph of {name} by{' '}
                <a
                  href={image.credit.pageUrl}
                  rel="noopener noreferrer nofollow"
                  target="_blank"
                  className="inline-flex min-h-6 items-center underline underline-offset-4"
                >
                  {image.credit.author ?? 'photographer not stated'}
                </a>
                {image.credit.licence ? `, ${image.credit.licence}` : ''}, via Wikimedia.
              </>
            ) : shipped ? (
              `AI-generated illustration of ${name}.`
            ) : null}
          </p>
        </Container>
      </DestinationPicture>
    </section>
  );
}
