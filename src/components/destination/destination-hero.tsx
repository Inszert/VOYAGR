import { Container, Icon } from '@/components/ui';
import { DestinationPicture } from '@/components/search/destination-picture';
import { localDestinationImage } from '@/lib/destination-media';
import type { DestinationImage } from '@/providers/imagery/types';
import { imageryUrlFor } from '@/providers/imagery/url';
import '@/components/search/explore.css';

/**
 * The top of a destination's page: the place, edge to edge.
 *
 * The picture fills the width at 60vh on a desktop and 44vh on a phone, with a
 * scrim under the type so the name, the price and the weather read whatever
 * the picture is. It tucks under the site header, which is transparent on
 * this page, and carries the same `view-transition-name` as the card that was
 * clicked to get here, so the card's picture becomes this one.
 *
 * Every figure is passed in already formatted by the page; nothing is
 * computed here. The page's one `h1` is the place's name.
 */

export interface DestinationHeroProps {
  code: string;
  name: string;
  /** The country in full. */
  country: string | null;
  /** The provider's photograph, used only when no shipped illustration exists. */
  image: DestinationImage | null;
  /** "from €412" and what it covers, or null when no price was read. */
  price: { readonly amount: string; readonly covers: string } | null;
  /** The outlook in one line, or null when the page was opened without dates. */
  weather: string | null;
  /** The dates this page describes, formatted. */
  dates: string | null;
}

export function DestinationHero({
  code,
  name,
  country,
  image,
  price,
  weather,
  dates,
}: DestinationHeroProps) {
  const shipped = localDestinationImage(code) !== null;

  return (
    <section
      aria-labelledby="destination-heading"
      className="stage-scope bg-stage text-stage-ink relative -mt-[var(--voyagr-header-h,4.5rem)]"
    >
      <DestinationPicture
        code={code}
        providerUrl={image ? imageryUrlFor(code) : null}
        alt={`${shipped ? 'Illustration' : 'Photograph'} of ${name}${country ? `, ${country}` : ''}`}
        priority
        sizes="100vw"
        transitionName={`dest-${code.toUpperCase()}`}
        className="flex min-h-[44vh] flex-col justify-end md:min-h-[60vh]"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-t from-black/90 via-black/40 to-black/35"
        />

        <Container size="wide" className="pt-32 pb-8 md:pb-12">
          <div className="grid items-end gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex min-w-0 flex-col gap-3">
              <p className="text-xs font-semibold tracking-[0.2em] text-white/85 uppercase">
                {country ? `${country} · ` : ''}
                <span className="sr-only">airport </span>
                {code.toUpperCase()}
              </p>
              <h1
                id="destination-heading"
                className="font-display text-display-md sm:text-display-lg text-balance text-white"
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

            {price ? (
              <div className="flex flex-col lg:items-end lg:text-right">
                <p className="text-sm text-white/80">{price.covers}</p>
                <p className="flex items-baseline gap-2 tabular-nums lg:justify-end">
                  <span className="text-sm text-white/80">from</span>
                  <span className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                    {price.amount}
                  </span>
                </p>
              </div>
            ) : null}
          </div>

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
