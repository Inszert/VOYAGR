import type * as React from 'react';
import { PageHeader } from '@/components/ui';

/**
 * The frame the privacy notice and the terms share.
 *
 * A reading measure (65 characters), the same page header as everywhere else,
 * a short contents list and sections a reader can jump between. From 1024px
 * the contents sit beside the text and follow it; on a phone they are a list
 * above it. Its own component because two pages need exactly this and nothing
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
    <div className="flex flex-col gap-10 lg:gap-14">
      <PageHeader
        eyebrow="Legal"
        title={title}
        description={
          <>
            Last updated <time dateTime={updated}>{updated}</time>
          </>
        }
      />

      <div className="grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
        <nav aria-label="Contents" className="lg:order-first">
          <p className="text-dim text-[0.6875rem] font-medium tracking-[0.18em] uppercase">
            Contents
          </p>
          <ol className="sticky top-24 mt-3 flex flex-col text-sm">
            {sections.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="text-ink-muted hover:text-ink ease-standard duration-quick -mx-2 flex min-h-11 items-center gap-3 rounded-(--radius-control) px-2 py-1.5 leading-snug transition-colors lg:min-h-9"
                >
                  <span aria-hidden="true" className="text-dim w-5 shrink-0 tabular-nums">
                    {index + 1}
                  </span>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="flex max-w-prose min-w-0 flex-col gap-10">
          <div className="text-ink-muted text-base leading-relaxed">{summary}</div>

          <aside
            aria-label="Before this is published"
            className="border-border bg-surface-sunken rounded-(--radius-card) border p-4 text-sm"
          >
            <p className="text-ink font-medium">Draft for review</p>
            <p className="text-ink-muted mt-1 leading-relaxed">
              This text describes what the Voyagr software does with data. The legal name and
              contact address of whoever operates this service, and the law that governs it, still
              have to be added, and the whole document reviewed by someone qualified, before it is
              relied on.
            </p>
          </aside>

          {sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-heading`}
              className="flex scroll-mt-24 flex-col gap-3"
            >
              <h2 id={`${section.id}-heading`} className="font-display text-ink text-[1.75rem]">
                {section.title}
              </h2>
              <div className="text-ink-muted [&_a]:text-brand-ink [&_strong]:text-ink flex flex-col gap-3 text-[15px] leading-[1.7] [&_a]:underline [&_a]:underline-offset-4 [&_li]:pl-1 [&_strong]:font-medium [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5">
                {section.body}
              </div>
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}
