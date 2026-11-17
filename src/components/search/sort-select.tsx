'use client';

import { Select } from '@/components/ui';
import { RESULT_SORTS, type ResultSort } from '@/search/filters';

/**
 * How the trips are ordered, as a native select.
 *
 * A GET form, so the choice is part of the address like every other filter and
 * the page works before JavaScript. With JavaScript the form submits as soon as
 * the choice changes; without it, the button beside it does.
 *
 * `hidden` is the rest of the search, carried through so changing the order
 * does not start a different search.
 */
export function SortSelect({
  value,
  hidden,
  action,
}: {
  value: ResultSort;
  hidden: Readonly<Record<string, string>>;
  action: string;
}) {
  return (
    <form method="get" action={action} className="flex items-end gap-2">
      {Object.entries(hidden).map(([name, v]) => (
        <input key={name} type="hidden" name={name} value={v} />
      ))}
      <Select
        label="Sort by"
        name="fSort"
        defaultValue={value}
        options={RESULT_SORTS}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      />
      <noscript>
        <button
          type="submit"
          className="text-ink border-border rounded-md border px-3 py-2 text-sm"
        >
          Apply
        </button>
      </noscript>
    </form>
  );
}
