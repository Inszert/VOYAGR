import { OUTBOUND_LINK_REL } from '@/booking/handoff';
import { isAllowedPartnerUrl } from '@/booking/partners';
import { AffiliateDisclosure } from '@/components/partners';
import { Button, Disclosure, Icon, StatusChip } from '@/components/ui';
import type { IconName } from '@/components/ui';
import {
  addPlanItemAction,
  removePlanItemAction,
  setPlanItemStatusAction,
  updatePlanItemAction,
} from '@/app/actions/trips';
import { ActionForm } from '@/components/trips/action-form';
import { PlanItemFields } from '@/components/trips/plan-item-fields';
import { format, minorUnitExponent } from '@/core/money';
import type { PlanItemRecord } from '@/db/repository';
import { weekdayDate } from '@/lib/display-date';
import { PLACE_LINK_REL, isPlaceSourceUrl } from '@/trip-hub/place-url';
import { PLAN_KIND_LABELS, PLAN_STATUS_LABELS, type PlanItemKind } from '@/trip-hub/types';

/**
 * The Plan tab: items grouped by day, as a timeline.
 *
 * A price here is the figure the traveller typed, and is labelled that way. It
 * is never summed into anything: the plan is a list, and the only totals in the
 * hub are the ones `src/core/expenses` computes.
 *
 * Each item has a kind (an icon, and the word beside it) and a status (a chip
 * with a shape and a word). Nothing is shown as booked unless the traveller
 * said so.
 */

const KIND_ICON: Record<PlanItemKind, IconName> = {
  flight: 'plane',
  stay: 'bed',
  transfer: 'car',
  activity: 'pin',
  esim: 'wifi',
  insurance: 'shield',
  other: 'tag',
};

function groupByDate(items: readonly PlanItemRecord[]): [string | null, PlanItemRecord[]][] {
  const groups = new Map<string | null, PlanItemRecord[]>();
  for (const item of items) {
    const list = groups.get(item.date) ?? [];
    list.push(item);
    groups.set(item.date, list);
  }

  const dated = [...groups.keys()]
    .filter((key): key is string => key !== null)
    .sort()
    .map((key): [string | null, PlanItemRecord[]] => [
      key,
      (groups.get(key) ?? []).sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? '')),
    ]);

  const undated = groups.get(null);
  return undated ? [...dated, [null, undated]] : dated;
}

export function PlanSection({
  tripId,
  items,
}: {
  readonly tripId: string;
  readonly items: readonly PlanItemRecord[];
}) {
  const groups = groupByDate(items);
  const hasLinks = items.some((item) => item.outboundUrl && isAllowedPartnerUrl(item.outboundUrl));

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-14">
      <section aria-labelledby="plan-heading" className="flex min-w-0 flex-col gap-8">
        <h2 id="plan-heading" className="font-display text-display-sm text-ink">
          Plan
        </h2>

        {groups.length === 0 ? (
          <div className="border-border-strong text-ink-muted rounded-(--radius-card) border border-dashed px-6 py-10 text-center">
            <p className="text-ink text-base font-medium">Nothing in the plan yet</p>
            <p className="mx-auto mt-1.5 max-w-[40ch] text-sm leading-relaxed">
              Add a flight, a stay or an idea on the right, and it appears here by day.
            </p>
          </div>
        ) : (
          groups.map(([date, list]) => {
            const headingId = `day-${date ?? 'undated'}`;

            return (
              <section
                key={date ?? 'undated'}
                aria-labelledby={headingId}
                className="flex flex-col gap-4"
              >
                <h3
                  id={headingId}
                  className="text-ink text-[0.6875rem] font-medium tracking-[0.18em] uppercase"
                >
                  {date ? weekdayDate(date) : 'No date yet'}
                </h3>

                <ol className="border-border-strong ml-4 flex flex-col gap-6 border-l">
                  {list.map((item) => (
                    <li key={item.id} className="relative pl-8">
                      <span
                        aria-hidden="true"
                        className="border-border-strong bg-surface-raised text-ink-muted absolute top-0 -left-4 grid size-8 place-items-center rounded-full border"
                      >
                        <Icon name={KIND_ICON[item.kind]} size={1} />
                      </span>

                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          <p className="text-ink text-base leading-snug font-medium">
                            {item.title}
                          </p>
                          <p className="text-ink-muted mt-1 text-sm">
                            {PLAN_KIND_LABELS[item.kind]}
                            {item.startsAt ? (
                              <>
                                {' '}
                                &middot;{' '}
                                <span className="tabular-nums">
                                  {item.startsAt.slice(11, 16)} local time
                                </span>
                              </>
                            ) : null}
                            {item.price ? (
                              <>
                                {' '}
                                &middot; <span className="tabular-nums">
                                  {format(item.price)}
                                </span>{' '}
                                (your figure)
                              </>
                            ) : null}
                          </p>
                        </div>
                        <StatusChip kind={item.status}>
                          {PLAN_STATUS_LABELS[item.status]}
                        </StatusChip>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                        {item.status !== 'booked' ? (
                          <form action={setPlanItemStatusAction}>
                            <input type="hidden" name="tripId" value={tripId} />
                            <input type="hidden" name="itemId" value={item.id} />
                            <input type="hidden" name="status" value="booked" />
                            <Button type="submit" variant="secondary" size="md">
                              <Icon name="check" size={1} />I have booked this
                              <span className="sr-only">: {item.title}</span>
                            </Button>
                          </form>
                        ) : null}
                        {item.outboundUrl && isAllowedPartnerUrl(item.outboundUrl) ? (
                          <a
                            href={item.outboundUrl}
                            rel={OUTBOUND_LINK_REL}
                            target="_blank"
                            className="text-brand-ink inline-flex min-h-11 items-center text-sm underline underline-offset-4"
                          >
                            Open the partner page
                            <span className="sr-only"> for {item.title} (opens in a new tab)</span>
                          </a>
                        ) : item.outboundUrl && isPlaceSourceUrl(item.outboundUrl) ? (
                          // A place added from "Things to do" keeps its Wikipedia or
                          // Wikidata page. Editorial, so not marked sponsored and not
                          // counted towards the affiliate disclosure.
                          <a
                            href={item.outboundUrl}
                            rel={PLACE_LINK_REL}
                            target="_blank"
                            className="text-brand-ink inline-flex min-h-11 items-center text-sm underline underline-offset-4"
                          >
                            Read about this place
                            <span className="sr-only"> for {item.title} (opens in a new tab)</span>
                          </a>
                        ) : null}
                        <form action={removePlanItemAction}>
                          <input type="hidden" name="tripId" value={tripId} />
                          <input type="hidden" name="itemId" value={item.id} />
                          <Button type="submit" variant="ghost" size="md">
                            Remove<span className="sr-only"> {item.title}</span>
                          </Button>
                        </form>
                      </div>

                      <Disclosure summary={`Edit ${item.title}`} className="mt-2">
                        <ActionForm
                          action={updatePlanItemAction}
                          submitLabel="Save changes"
                          hidden={{ tripId, itemId: item.id }}
                          resetOnSave={false}
                        >
                          <PlanItemFields item={item} exponentFor={minorUnitExponent} />
                        </ActionForm>
                      </Disclosure>
                    </li>
                  ))}
                </ol>
              </section>
            );
          })
        )}

        {hasLinks ? <AffiliateDisclosure /> : null}
      </section>

      <aside
        aria-labelledby="add-item-heading"
        className="border-border bg-surface-raised h-fit rounded-(--radius-card) border p-5 lg:sticky lg:top-24"
      >
        <h3 id="add-item-heading" className="text-ink mb-4 text-lg font-medium">
          Add to the plan
        </h3>
        <ActionForm
          action={addPlanItemAction}
          submitLabel="Add item"
          pendingLabel="Adding…"
          savedMessage="Added to the plan."
          hidden={{ tripId }}
        >
          <PlanItemFields compact />
        </ActionForm>
      </aside>
    </div>
  );
}
