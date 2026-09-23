import { Container, DemoDataNotice, Icon, type IconName } from '@/components/ui';
import type { DataProvenance, SourceAttribution } from '@/core/trip/provenance';

/**
 * Three sentences that earn the globe.
 *
 * The stage makes a large claim - here is the world, priced - and this is
 * where the claim is qualified in the same breath: what a total actually
 * contains, what a watch does, and, while the providers are fixtures, that
 * none of it is a real offer. The notice is the same one the results carry,
 * not a softer one for the front page.
 */

export interface TrustStripProps {
  provenance: DataProvenance;
  /** Named in the notice, so it can say which parts are demo data. */
  sources?: readonly SourceAttribution[];
  /** True when the results list already carries the notice, so it is not shown twice. */
  noticeShown?: boolean;
}

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

export function TrustStrip({ provenance, sources = [], noticeShown = false }: TrustStripProps) {
  return (
    <Container size="wide" as="section" aria-labelledby="trust-heading" className="pb-16">
      <h2 id="trust-heading" className="sr-only">
        How Voyagr works
      </h2>

      {provenance === 'mock' && !noticeShown ? (
        <DemoDataNotice sources={sources} className="mb-8" />
      ) : null}

      <ul className="grid gap-6 sm:grid-cols-3">
        {ITEMS.map((item) => (
          <li key={item.title} className="border-border flex flex-col gap-3 border-t pt-5">
            <span
              aria-hidden="true"
              className="voyagr-tile text-stage-accent grid size-9 place-items-center rounded-(--radius-control)"
            >
              <Icon name={item.icon} size={1.05} />
            </span>
            <h3 className="text-ink text-base font-semibold">{item.title}</h3>
            <p className="text-ink-muted text-sm">{item.body}</p>
          </li>
        ))}
      </ul>
    </Container>
  );
}
