'use client';

import * as React from 'react';
import { Button, Container, Icon } from '@/components/ui';
import './destination.css';

/**
 * The sticky section bar: where you are on a long page, and a way to jump.
 *
 * Sits under the site header at a measured offset (`--voyagr-header-h`, which
 * `HeaderOffset` publishes) and never at a number written down. The section you
 * are reading is marked `aria-current="true"` and underlined; the underline
 * slides between items. Links are real anchors, so they work without script;
 * with it they scroll smoothly (instantly under reduced motion). On a phone the
 * list scrolls sideways with an edge fade and the price button stays at the
 * right.
 *
 * A section that is not on the page (places that did not load, a plan that had
 * too few places) has no entry: `late` items appear only once their element
 * exists, because those sections arrive after the rest of the page has painted.
 */

export interface SectionBarItem {
  readonly id: string;
  readonly label: string;
  /** Arrives later than first paint, so its entry waits until the section is in the page. */
  readonly late?: boolean;
}

export function SectionBar({
  items,
  action,
}: {
  items: readonly SectionBarItem[];
  action: {
    readonly href: string;
    readonly label: string;
    /** "from €412", already formatted, or null. */
    readonly price: string | null;
  };
}) {
  const [present, setPresent] = React.useState<ReadonlySet<string>>(
    () => new Set(items.filter((item) => !item.late).map((item) => item.id)),
  );
  const [active, setActive] = React.useState(items[0]?.id ?? '');
  const [line, setLine] = React.useState<{ left: number; width: number } | null>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const barRef = React.useRef<HTMLDivElement>(null);

  // Which late sections have arrived.
  React.useEffect(() => {
    const read = () => {
      const next = new Set(
        items
          .filter((item) => item.id === 'overview' || document.getElementById(item.id))
          .map((item) => item.id),
      );
      setPresent((previous) =>
        previous.size === next.size && [...next].every((id) => previous.has(id)) ? previous : next,
      );
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [items]);

  // Which section is being read: the last whose top has passed under the bars.
  React.useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      // The section whose box contains a line 30% down the viewport; in a gap
      // between sections, the last one whose top is above that line.
      const lineY = window.innerHeight * 0.3;
      let current = items[0]?.id ?? '';
      for (const item of items) {
        const element = document.getElementById(item.id);
        if (!element) continue;
        const box = element.getBoundingClientRect();
        if (box.top <= lineY) current = item.id;
        if (box.top <= lineY && box.bottom > lineY) {
          current = item.id;
          break;
        }
      }
      // At the very bottom the last section wins even if it is short.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        const last = [...items].reverse().find((item) => document.getElementById(item.id));
        if (last) current = last.id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // Sections stream in after first paint and move everything below them.
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);

    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [items, present]);

  // The underline follows the current item, and the list keeps it in view.
  React.useLayoutEffect(() => {
    const list = listRef.current;
    const link = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !link) {
      setLine(null);
      return;
    }
    setLine({ left: link.offsetLeft, width: link.offsetWidth });
    const left = link.offsetLeft - (list.clientWidth - link.offsetWidth) / 2;
    list.scrollTo?.({ left: Math.max(0, left), behavior: 'auto' });
  }, [active, present]);

  const go = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth';
    if (id === 'overview') window.scrollTo({ top: 0, behavior });
    else target.scrollIntoView({ behavior, block: 'start' });
    window.history.replaceState(window.history.state, '', `#${id}`);
    // Keyboard users land on the section, not on the link they just used.
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };

  const shown = items.filter((item) => present.has(item.id));

  return (
    <div
      ref={barRef}
      className="voyagr-secbar border-border bg-surface-overlay h-14 border-b backdrop-blur-md"
    >
      <Container size="wide" className="flex h-full items-center gap-3">
        <nav aria-label="On this page" className="relative min-w-0 flex-1">
          <ul
            ref={listRef}
            className="voyagr-secbar-scroll relative flex h-14 items-stretch gap-1 overflow-x-auto"
          >
            {shown.map((item) => (
              <li key={item.id} className="shrink-0">
                <a
                  href={`#${item.id}`}
                  onClick={(event) => go(event, item.id)}
                  aria-current={item.id === active ? 'true' : undefined}
                  className="text-ink-muted hover:text-ink aria-[current=true]:text-ink ease-standard duration-quick inline-flex h-full min-h-11 items-center px-3 text-sm font-medium whitespace-nowrap transition-colors aria-[current=true]:font-semibold"
                >
                  {item.label}
                </a>
              </li>
            ))}
            {line ? (
              <li
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-full"
              >
                <span
                  className="voyagr-secbar-line bg-brand-ink absolute bottom-0 left-0 block h-0.5 origin-left"
                  style={{ width: line.width, transform: `translateX(${line.left}px)` }}
                />
              </li>
            ) : null}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          {action.price ? (
            <p className="text-ink hidden text-sm tabular-nums md:block">
              <span className="text-ink-muted">from </span>
              <span className="font-semibold">{action.price}</span>
            </p>
          ) : null}
          <Button
            asChild
            variant="cta"
            size="md"
            className="active:scale-[0.97] motion-reduce:active:scale-100"
          >
            <a href={action.href}>
              {action.label}
              <Icon name="arrow-right" size={1} aria-hidden="true" />
            </a>
          </Button>
        </div>
      </Container>
    </div>
  );
}
