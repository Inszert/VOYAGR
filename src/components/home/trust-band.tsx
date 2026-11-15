import { Container, Icon, type IconName } from '@/components/ui';

/**
 * Three promises, as a quiet strip above the footer.
 *
 * What a total holds, what a watch does, and that a ranking explains itself.
 * Nothing here is a number, and there is deliberately no provenance badge:
 * honesty about prices is carried by "from" on every price, the "Updated N
 * minutes ago" line, and the footer's sentence that prices are observed and
 * can change.
 */

const ITEMS: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'shield',
    title: 'Whole trips, not fares',
    body: 'Flights, a hotel and the ride from the airport, priced together. Every line is marked quoted, estimated or excluded, and nothing is quietly dropped.',
  },
  {
    icon: 'bell',
    title: 'It keeps looking',
    body: 'Save a search as a Travel Watch and it is re-priced in the background. You hear from it only when a materially better trip appears.',
  },
  {
    icon: 'clock',
    title: 'Every ranking explains itself',
    body: 'A trip says why it ranks where it does, in words, before any score - and the score is one disclosure away for anyone who wants it.',
  },
];

export function TrustBand() {
  return (
    <section aria-labelledby="trust-heading" className="home-scope bg-surface">
      <h2 id="trust-heading" className="sr-only">
        How Voyagr works
      </h2>

      <Container size="wide" className="pb-10 lg:pb-16">
        <ul className="border-border divide-border grid divide-y border-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {ITEMS.map((item) => (
            <li
              key={item.title}
              className="flex flex-col gap-2.5 py-6 sm:px-7 sm:first:pl-0 sm:last:pr-0"
            >
              <span className="flex items-center gap-2.5">
                <Icon
                  name={item.icon}
                  size={1}
                  className="text-brand-ink size-[18px]"
                  aria-hidden
                />
                <h3 className="text-ink text-[0.9375rem] font-semibold">{item.title}</h3>
              </span>
              <p className="text-ink-muted max-w-[34ch] text-sm leading-relaxed">{item.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
