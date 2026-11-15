import { Button, Icon } from '@/components/ui';
import { Container } from '@/components/ui';
import type { HomeCard } from './card-data';
import { HomePicture, HomePrice, HomeWeather } from './destination-card';
import './home.css';

/**
 * One destination, edge to edge.
 *
 * Eighty percent of the viewport of a single place: its picture the full
 * width of the screen, and what it costs set in the lower third where the
 * picture is darkest. It replaces three unrelated closing panels with one
 * thing to look at and one thing to do.
 *
 * Every figure is the card's own - the price the server formatted, the
 * weather the provider gave, the score the engine produced. A fact the data
 * does not have (savings, today) is not drawn rather than drawn as a blank.
 *
 * The three facts reveal one after another as the section scrolls in; see
 * `home.css`. Where scroll-driven animation is unsupported, or motion is
 * reduced, they are simply there.
 */

export interface DestinationMomentProps {
  card: HomeCard;
  /** What the section says it is: only "best value" when it is the one the engine ranked first. */
  eyebrow: string;
}

export function DestinationMoment({ card, eyebrow }: DestinationMomentProps) {
  const facts: { key: string; label: string; body: React.ReactNode }[] = [
    {
      key: 'price',
      label: 'Whole trip',
      body: <HomePrice label={card.label} className="[&>span:last-child]:text-[1.75rem]" />,
    },
    ...(card.savings
      ? [
          {
            key: 'savings',
            label: 'Against the usual',
            body: <span className="text-positive-ink text-base font-medium">{card.savings}</span>,
          },
        ]
      : []),
    ...(card.weather
      ? [
          {
            key: 'weather',
            label: 'Weather',
            body: <HomeWeather weather={card.weather} className="text-lg" />,
          },
        ]
      : []),
    ...(card.bestScore !== null
      ? [
          {
            key: 'score',
            label: 'Value score',
            body: (
              <span className="text-lg font-medium tabular-nums">{card.bestScore} out of 100</span>
            ),
          },
        ]
      : []),
  ].slice(0, 3);

  return (
    <section
      aria-labelledby="moment-heading"
      className="home-scope home-moment text-ink bg-surface"
    >
      <div className="home-moment__media">
        <HomePicture card={card} sizes="100vw" />
      </div>
      <div aria-hidden="true" className="home-moment__shade" />
      <div aria-hidden="true" className="home-moment__scrim" />

      <Container
        size="wide"
        className="flex min-h-[80vh] flex-col justify-end pt-24 pb-12 lg:pb-20"
        style={{ minHeight: '80svh' }}
      >
        <p className="text-ink text-[0.6875rem] font-medium tracking-[0.16em] uppercase">
          {eyebrow}
        </p>

        <h2
          id="moment-heading"
          className="font-display text-display-md lg:text-display-lg mt-3 max-w-[14ch] text-balance"
        >
          {card.name}
        </h2>
        <p className="text-ink mt-1.5 text-base opacity-90">{card.country}</p>

        <dl className="mt-7 flex flex-wrap items-end gap-x-10 gap-y-5">
          {facts.map((fact, index) => (
            <div key={fact.key} data-step={index + 1} className="home-fact flex flex-col gap-1.5">
              <dt className="text-ink text-[0.6875rem] tracking-[0.14em] uppercase">
                {fact.label}
              </dt>
              <dd>{fact.body}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Button asChild variant="cta" shape="pill" size="lg">
            <a href={card.href}>
              {card.actionLabel} {card.name}
              <Icon name="arrow-right" size={0.95} />
            </a>
          </Button>

          <a
            href={card.aboutHref}
            className="text-ink hover:text-ink-muted ease-standard duration-quick inline-flex min-h-11 items-center gap-1.5 text-sm font-medium transition-colors"
          >
            About {card.name}
            <Icon name="arrow-right" size={1} className="size-[14px]" />
          </a>
        </div>

        <span className="sr-only">{card.reason}</span>
      </Container>
    </section>
  );
}
