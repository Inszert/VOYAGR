import { Container } from '@/components/ui';

/**
 * The column layout.
 *
 * Every page that is a column of content - account, watches, sign-in, the
 * status page - lives in this route group and gets the measure the root layout
 * used to give everything. The homepage and the explorer are outside it,
 * because a globe does not want a column.
 *
 * It carries the same sky those two hang their planet in. The product is one
 * night from the hero to the footer, and a column of forms on flat black was
 * the one place that still looked like a different website - the same reason
 * the results band was moved onto the stage's palette rather than left to
 * turn to parchment below the fold.
 */
export default function ColumnLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate">
      <div
        aria-hidden="true"
        className="voyagr-sky pointer-events-none absolute inset-0 -z-10"
        style={{ '--sky-x': '50%', '--sky-y': '0%' } as React.CSSProperties}
      />
      <div aria-hidden="true" className="voyagr-grid pointer-events-none absolute inset-0 -z-10" />

      <Container className="py-12">{children}</Container>
    </div>
  );
}
