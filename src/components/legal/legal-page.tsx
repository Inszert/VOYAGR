import type * as React from 'react';

/**
 * The frame the privacy notice and the terms share.
 *
 * A readable measure, a display title, and sections a reader can jump
 * between. Its own component because two pages need exactly this and nothing
 * in the design system is a long-form document.
 *
 * **These documents describe the software, not a company.** Every statement
 * in them is checked against what the code does - which cookies it sets, what
 * it stores, who it talks to. What the code cannot know - who operates this
 * deployment, where to write to them, which law applies - is stated as
 * missing rather than invented, in the notice at the top.
 */

export interface LegalSection {
  readonly id: string;
  readonly title: string;
  readonly body: React.ReactNode;
}

export interface LegalPageProps {
  readonly title: string;
  /** A `YYYY-MM-DD` date: when the text last changed. */
  readonly updated: string;
  readonly summary: React.ReactNode;
  readonly sections: readonly LegalSection[];
}

export function LegalPage({ title, updated, summary, sections }: LegalPageProps) {
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-10">
      <header className="flex flex-col gap-4">
        <h1 className="font-display text-display-md text-ink text-balance">{title}</h1>
        <p className="text-ink-muted text-sm">
          Last updated <time dateTime={updated}>{updated}</time>
        </p>
        <div className="text-ink-muted max-w-prose text-base leading-relaxed">{summary}</div>

        <aside
          aria-label="Before this is published"
          className="border-caution-500/30 bg-caution-500/10 rounded-(--radius-card) border p-4 text-sm"
        >
          <p className="text-caution-ink font-medium">Draft for review</p>
          <p className="text-ink mt-1">
            This text describes what the Voyagr software does with data. The legal name and contact
            address of whoever operates this service, and the law that governs it, still have to be
            added, and the whole document reviewed by someone qualified, before it is relied on.
          </p>
        </aside>
      </header>

      <nav aria-label="On this page" className="border-border border-y py-4">
        <ol className="text-ink-muted grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="hover:text-ink underline-offset-4 transition-colors hover:underline"
              >
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          aria-labelledby={`${section.id}-heading`}
          className="flex scroll-mt-24 flex-col gap-3"
        >
          <h2 id={`${section.id}-heading`} className="font-display text-ink text-2xl">
            {section.title}
          </h2>
          <div className="text-ink-muted [&_strong]:text-ink flex max-w-prose flex-col gap-3 text-[15px] leading-relaxed [&_li]:pl-1 [&_strong]:font-medium [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5">
            {section.body}
          </div>
        </section>
      ))}
    </article>
  );
}
