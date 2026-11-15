/**
 * The layout for sign-in, sign-up and the two password pages.
 *
 * Its own route group because these pages are the one place the content wants
 * the whole width - a form beside a picture - rather than the reading column
 * `(column)` gives everything else. The URLs are unchanged.
 *
 * It carries the same night sky the column layout does, so the move from a
 * column page to one of these is not a change of site.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate">
      <div
        aria-hidden="true"
        className="voyagr-sky pointer-events-none absolute inset-0 -z-10"
        style={{ '--sky-x': '30%', '--sky-y': '0%' } as React.CSSProperties}
      />
      {children}
    </div>
  );
}
