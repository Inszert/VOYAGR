import { stalenessLine } from '@/liteapi-snapshot/staleness';
import type { SnapshotStatus } from '@/liteapi-snapshot/read';

/**
 * How current the stored hotel prices are, in words.
 *
 * Reads a status the server already worked out from our own database; it decides nothing. The
 * wording is `stalenessLine`'s, so the page and its tests cannot drift:
 *
 * - fresh:   "Updated N hours ago"
 * - aging:   "Prices last checked N hours ago"
 * - missing: "Hotel prices are not loaded for these dates yet." (the page then shows no price)
 * - unknown: no age claim at all
 *
 * While the data is the provider's sandbox it also carries a "Test prices" note, in words and
 * not only in colour: a sandbox figure is not a price anyone can book.
 */
export function SnapshotStatusLine({ status }: { status: SnapshotStatus }) {
  const line = stalenessLine({
    state: status.state,
    observedAt: status.observedAt,
    ageHours: status.ageHours,
  });
  const showTest = status.testPrices && status.state !== 'missing';

  if (!line && !showTest) return null;

  return (
    <div className="flex flex-col gap-1" data-testid="snapshot-status">
      {line ? <p className="text-ink-muted text-sm">{line}</p> : null}
      {showTest ? (
        <p className="text-caution-ink text-sm">
          <strong className="font-medium">Test prices.</strong> These come from the provider&rsquo;s
          test environment, so they are not real offers.
        </p>
      ) : null}
    </div>
  );
}
