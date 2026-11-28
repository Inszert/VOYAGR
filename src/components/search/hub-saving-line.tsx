import { format, money } from '@/core/money';
import type { HubSaving } from '@/search/hub-saving';

/** One quiet line, shown only when the caller found a material saving. Figures arrive as minor units. */
export function HubSavingLine({ saving }: { saving: HubSaving | null }) {
  if (!saving) return null;
  const whole = (minor: number) => format(money(minor, saving.currency));
  return (
    <p className="text-ink text-sm">
      <span className="font-semibold">Cheaper from {saving.code}:</span> save{' '}
      {whole(saving.savingMinor)} including a {whole(saving.transferMinor)} transfer (estimate)
    </p>
  );
}
