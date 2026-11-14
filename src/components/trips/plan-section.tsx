import { OUTBOUND_LINK_REL } from '@/booking/handoff';
import { isAllowedPartnerUrl } from '@/booking/partners';
import { AffiliateDisclosure } from '@/components/partners';
import { Badge, Button, Card, Disclosure } from '@/components/ui';
import type { BadgeTone } from '@/components/ui';
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
import { PLAN_KIND_LABELS, PLAN_STATUS_LABELS } from '@/trip-hub/types';

/**
 * The Plan section: items grouped by date, with add, edit, remove and "mark booked".
 *
 * A price here is the figure the traveller typed, and is labelled that way. It
 * is never summed into anything: the plan is a list, and the only totals in the
 * hub are the ones `src/core/expenses` computes.
 */

const STATUS_TONE: Record<PlanItemRecord['status'], BadgeTone> = {
  idea: 'neutral',
  planned: 'brand',
  booked: 'positive',
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
  const hasLinks = items.some((item) => item.outboundUrl);

  return (
    <section aria-labelledby="plan-heading" className="flex flex-col gap-5">
      <h2 id="plan-heading" className="font-display text-display-sm text-ink">
        Plan
      </h2>

      {groups.length === 0 ? (
        <p className="text-ink-muted">Nothing in the plan yet. Add a flight, a stay or an idea.</p>
      ) : (
        groups.map(([date, list]) => (
          <div key={date ?? 'undated'} className="flex flex-col gap-3">
            <h3 className="text-ink text-base font-medium">
              {date ? weekdayDate(date) : 'No date yet'}
            </h3>
            <ul className="flex flex-col gap-3">
              {list.map((item) => (
                <li key={item.id}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-ink font-medium">{item.title}</p>
                        <p className="text-ink-muted mt-1 text-sm">
                          {PLAN_KIND_LABELS[item.kind]}
                          {item.startsAt ? ` · ${item.startsAt.slice(11, 16)} local time` : ''}
                          {item.price ? ` · ${format(item.price)} (your figure)` : ''}
                        </p>
                      </div>
                      <Badge tone={STATUS_TONE[item.status]} srPrefix="Status">
                        {PLAN_STATUS_LABELS[item.status]}
                      </Badge>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      {item.status !== 'booked' ? (
                        <form action={setPlanItemStatusAction}>
                          <input type="hidden" name="tripId" value={tripId} />
                          <input type="hidden" name="itemId" value={item.id} />
                          <input type="hidden" name="status" value="booked" />
                          <Button type="submit" variant="secondary" size="md">
                            I have booked this
                            <span className="sr-only">: {item.title}</span>
                          </Button>
                        </form>
                      ) : null}
                      {item.outboundUrl && isAllowedPartnerUrl(item.outboundUrl) ? (
                        <a
                          href={item.outboundUrl}
                          rel={OUTBOUND_LINK_REL}
                          target="_blank"
                          className="text-ink text-sm underline underline-offset-4"
                        >
                          Open the partner page
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

                    <Disclosure summary={`Edit ${item.title}`} className="mt-4">
                      <ActionForm
                        action={updatePlanItemAction}
                        submitLabel="Save changes"
                        hidden={{ tripId, itemId: item.id }}
                        resetOnSave={false}
                      >
                        <PlanItemFields item={item} exponentFor={minorUnitExponent} />
                      </ActionForm>
                    </Disclosure>
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {hasLinks ? <AffiliateDisclosure /> : null}

      <Card as="section" aria-labelledby="add-item-heading">
        <h3 id="add-item-heading" className="text-ink mb-4 text-lg font-medium">
          Add to the plan
        </h3>
        <ActionForm
          action={addPlanItemAction}
          submitLabel="Add item"
          savedMessage="Added to the plan."
          hidden={{ tripId }}
        >
          <PlanItemFields />
        </ActionForm>
      </Card>
    </section>
  );
}
