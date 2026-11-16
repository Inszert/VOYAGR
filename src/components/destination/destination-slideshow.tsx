'use client';

import * as React from 'react';
import { Container, Icon } from '@/components/ui';
import { cn } from '@/lib/cn';
import { washFor } from '@/components/ui';
import { FRAME_SECONDS, type SlideFrame } from './slideshow-frames';
import { useReducedMotion } from './use-media';
import './destination.css';

/**
 * "30 seconds of {place}": six frames, five seconds each.
 *
 * The clock is the progress segment's own animation: when the current segment
 * has filled, the next frame shows. That keeps what is drawn and what happens
 * the same thing, and means pausing is only pausing an animation. It pauses
 * when the slideshow is offscreen, when the pointer rests on it, when keyboard
 * focus is inside it and when the tab is hidden.
 *
 * Under `prefers-reduced-motion` there is no clock at all: no auto-advance and
 * no zoom, a manual carousel with previous and next. Every control is a real
 * button; arrow keys, Home and End move between frames; touch swipes.
 *
 * The first frame is rendered on the server and is the page's LCP; the others
 * are only given an `<img>` when they are next, so a visitor who never looks
 * at the fourth frame never downloads it.
 */

export interface DestinationSlideshowProps {
  frames: readonly SlideFrame[];
  /** The place's name, for the labels. */
  name: string;
  /**
   * `hero` fills the top of the destination page and carries its overlay as
   * children; `band` is the 21:9 (4:5 on a phone) section the explore page mounts.
   */
  variant?: 'hero' | 'band';
  /** Names the picture for the view transition into the page. */
  transitionName?: string;
  /** The place's wash, painted under the pictures, so nothing flashes grey. */
  washCode?: string;
  /** Hero only: what is laid over the lower third. */
  children?: React.ReactNode;
  className?: string;
}

function PlayGlyph({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" aria-hidden="true" fill="currentColor">
      {playing ? (
        <>
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </>
      ) : (
        <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
      )}
    </svg>
  );
}

const CONTROL =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur-sm hover:bg-black/60 active:scale-[0.97] motion-reduce:active:scale-100';

export function DestinationSlideshow({
  frames,
  name,
  variant = 'hero',
  transitionName,
  washCode,
  children,
  className,
}: DestinationSlideshowProps) {
  const count = frames.length;
  const reduced = useReducedMotion();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [index, setIndex] = React.useState(0);
  const [autoplay, setAutoplay] = React.useState(true);
  const [hovered, setHovered] = React.useState(false);
  const [keyboardFocus, setKeyboardFocus] = React.useState(false);
  const [visible, setVisible] = React.useState(true);
  const [tabVisible, setTabVisible] = React.useState(true);
  const [rendered, setRendered] = React.useState<ReadonlySet<number>>(() => new Set([0, 1]));
  const swipe = React.useRef<{ x: number; y: number } | null>(null);

  // Known only after mount: until then the first frame is simply a still picture.
  const motion = reduced === false;
  const running = motion && autoplay && !hovered && !keyboardFocus && visible && tabVisible;

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? true),
      { threshold: 0.25 },
    );
    observer.observe(root);

    const onVisibility = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // The next frame is fetched as the current one shows; the rest only if they are visited.
  const wanted = [index, (index + 1) % count];
  if (wanted.some((position) => !rendered.has(position))) {
    setRendered(new Set([...rendered, ...wanted]));
  }

  const go = React.useCallback((to: number) => setIndex(((to % count) + count) % count), [count]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    // Arrow keys belong to a focused control that uses them; none here do.
    if (target.closest('a[href]') && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
      return;

    if (event.key === 'ArrowRight') go(index + 1);
    else if (event.key === 'ArrowLeft') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(count - 1);
    else return;

    event.preventDefault();
  };

  const hero = variant === 'hero';
  const active = frames[index]!;

  const controls = (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-8',
        hero ? 'mt-6' : 'absolute inset-x-0 bottom-0 p-4 sm:p-6',
      )}
    >
      <div className="flex w-full items-center gap-2 sm:max-w-md">
        {reduced === false ? (
          <button
            type="button"
            className={CONTROL}
            aria-label={autoplay ? 'Pause slideshow' : 'Play slideshow'}
            onClick={() => {
              setAutoplay((value) => !value);
              // Pressing play with the keyboard must not be undone by the focus it came with.
              setKeyboardFocus(false);
            }}
          >
            <PlayGlyph playing={autoplay} />
          </button>
        ) : null}
        {reduced === true ? (
          <button
            type="button"
            className={CONTROL}
            aria-label="Previous picture"
            onClick={() => go(index - 1)}
          >
            <Icon name="chevron-left" size={1.1} />
          </button>
        ) : null}

        <ol
          className="flex min-w-0 flex-1 items-center rounded-full bg-black/40 px-2 backdrop-blur-sm"
          aria-label="Pictures"
        >
          {frames.map((frame, position) => {
            const current = position === index;

            return (
              <li key={frame.id} className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => go(position)}
                  aria-current={current ? 'true' : undefined}
                  aria-label={`${frame.caption}, ${position + 1} of ${count}`}
                  className="group flex h-11 w-full items-center px-[3px]"
                >
                  <span className="relative block h-[3px] w-full overflow-hidden rounded-full bg-white/40 group-hover:bg-white/60">
                    <span
                      aria-hidden="true"
                      data-active={current ? 'true' : 'false'}
                      data-state={position < index ? 'done' : position > index ? 'todo' : 'now'}
                      onAnimationEnd={(event) => {
                        if (current && event.target === event.currentTarget) go(index + 1);
                      }}
                      className="voyagr-ss-fill absolute inset-0 block rounded-full bg-white"
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {reduced === true ? (
          <button
            type="button"
            className={CONTROL}
            aria-label="Next picture"
            onClick={() => go(index + 1)}
          >
            <Icon name="chevron-right" size={1.1} />
          </button>
        ) : null}
      </div>

      {/* One caption per frame, stacked, so they cross-fade with the pictures. */}
      <p className="grid text-xs text-white/85 sm:max-w-sm sm:text-right">
        {frames.map((frame, position) => (
          <span
            key={frame.id}
            data-active={position === index ? 'true' : 'false'}
            aria-hidden={position === index ? undefined : true}
            className="voyagr-ss-caption col-start-1 row-start-1"
          >
            <span className="font-medium text-white">{frame.caption}</span>
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, </span>
            {frame.credit.href ? (
              <a
                href={frame.credit.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-6 items-center underline underline-offset-4"
              >
                {frame.credit.text}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              frame.credit.text
            )}
          </span>
        ))}
      </p>
    </div>
  );

  return (
    <div
      ref={rootRef}
      role="group"
      aria-roledescription="carousel"
      aria-label={`Pictures of ${name}`}
      data-motion={motion ? 'on' : 'off'}
      data-paused={running ? 'false' : 'true'}
      onKeyDown={onKeyDown}
      onPointerEnter={(event) => event.pointerType === 'mouse' && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={(event) => setKeyboardFocus(event.target.matches(':focus-visible'))}
      onBlurCapture={() => setKeyboardFocus(false)}
      style={
        transitionName ? ({ viewTransitionName: transitionName } as React.CSSProperties) : undefined
      }
      className={cn(
        'voyagr-ss stage-scope bg-stage text-stage-ink relative isolate overflow-hidden',
        hero
          ? 'flex min-h-[60dvh] flex-col justify-end md:min-h-[72vh]'
          : 'aspect-[4/5] rounded-(--radius-surface) md:aspect-[21/9]',
        className,
      )}
    >
      {washCode ? (
        <div aria-hidden="true" style={washFor(washCode)} className="absolute inset-0 -z-20" />
      ) : null}

      {/* The pictures. A swipe is a drag across them; vertical scrolling is left to the page. */}
      <div
        aria-live={running ? 'off' : 'polite'}
        onPointerDown={(event) => {
          swipe.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start || event.pointerType === 'mouse') return;
          const dx = event.clientX - start.x;
          if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(event.clientY - start.y)) {
            go(dx < 0 ? index + 1 : index - 1);
          }
        }}
        className="absolute inset-0 -z-10 touch-pan-y"
      >
        {frames.map((frame, position) => (
          <div
            key={frame.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${position + 1} of ${count}`}
            aria-hidden={position === index ? undefined : true}
            data-active={position === index ? 'true' : 'false'}
            className="voyagr-ss-frame absolute inset-0"
          >
            {rendered.has(position) || position === 0 ? (
              frame.kind === 'illustration' ? (
                <picture>
                  <source type="image/avif" srcSet={frame.avif} sizes="100vw" />
                  <source type="image/webp" srcSet={frame.webp} sizes="100vw" />
                  <img
                    src={frame.src}
                    alt={position === index ? frame.alt : ''}
                    width={frame.width}
                    height={frame.height}
                    loading="eager"
                    decoding="async"
                    {...(position === 0 ? { fetchPriority: 'high' as const } : {})}
                    className="voyagr-ss-img absolute inset-0 size-full object-cover"
                  />
                </picture>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- our own proxy route, sized by width
                <img
                  src={frame.src}
                  srcSet={frame.srcSet}
                  sizes="100vw"
                  alt={position === index ? frame.alt : ''}
                  loading={position === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                  {...(position === 0 ? { fetchPriority: 'high' as const } : {})}
                  className="voyagr-ss-img absolute inset-0 size-full object-cover"
                />
              )
            ) : null}
          </div>
        ))}
      </div>

      {/* A scrim under the type, whatever the picture, so a caption and a name always read. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-t from-black/90 via-black/35 to-black/30"
      />

      {hero ? (
        <Container size="wide" className="pt-32 pb-6 md:pb-8">
          {children}
          {controls}
        </Container>
      ) : (
        controls
      )}
      <span className="sr-only">Showing {active.caption}.</span>
    </div>
  );
}

export { FRAME_SECONDS };
