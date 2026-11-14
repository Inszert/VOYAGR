import { cn } from '@/lib/cn';

export const AFFILIATE_DISCLOSURE =
  'Some links are partner links. If you book through them Voyagr may earn a commission, at no cost to you.';

/**
 * Said wherever a partner link appears, in words rather than a symbol: a
 * disclosure only a sighted reader can find is not one.
 */
export function AffiliateDisclosure({ className }: { className?: string }) {
  return (
    <p className={cn('text-ink-muted max-w-2xl text-sm', className)}>{AFFILIATE_DISCLOSURE}</p>
  );
}
