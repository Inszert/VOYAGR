import { StageHost } from '@/components/discovery/stage-host';

/**
 * One globe for the life of the visit.
 *
 * `/` and `/explore` share this layout, so a navigation between them - a
 * search, a lens, a change of dates - re-renders the pages and leaves
 * everything here alone. The globe is mounted once, by `StageHost`, and moves
 * to whichever box the current page offers; the pages publish what it should
 * show instead of rendering it. See `stage-host.tsx`.
 *
 * `loading.tsx` files below this layout cover a page's own content only. They
 * can never replace the globe, because the globe is not inside them.
 *
 * The host comes first in the tree and the pages' own backgrounds are
 * transparent over it: it sits above the sky and the ruled field (both
 * negative layers) and below every hero's copy (`z-10`), and the sections
 * after the hero still paint over whatever of the planet overflows into them.
 */
export default function StageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <StageHost />
      {children}
    </div>
  );
}
