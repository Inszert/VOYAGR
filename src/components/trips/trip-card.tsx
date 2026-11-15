import Link from 'next/link';
import { Icon, PlacePicture } from '@/components/ui';
import { initials } from '@/components/discovery/initials';
import type { PlacePictureData } from '@/lib/place-image';
import { MemberAvatars } from './member-avatars';

/**
 * One trip in the list: the place first, then what it is called and when.
 *
 * Built like the home page's destination card - the picture fills a 3:2 frame,
 * a scrim in the page colour carries the text, one link covers the whole card -
 * so a trip looks like the place it is to. With no picture for the place it is
 * a quiet tile with the country's initials; nothing is invented.
 *
 * The whole card is one link, named in full, and the picture inside keeps its
 * own `alt`. Nothing here is a figure: dates and names are the traveller's own.
 */

export interface TripCardProps {
  readonly id: string;
  readonly name: string;
  readonly destination: string;
  readonly country: string | null;
  readonly dates: string | null;
  readonly nights: string | null;
  readonly sharedWithYou: boolean;
  readonly members: readonly string[];
  readonly picture: PlacePictureData | null;
  readonly priority?: boolean;
}

export function TripCard({
  id,
  name,
  destination,
  country,
  dates,
  nights,
  sharedWithYou,
  members,
  picture,
  priority = false,
}: TripCardProps) {
  const place = country ? `${destination}, ${country}` : destination;

  return (
    <li className="group relative isolate flex min-w-0 flex-col overflow-hidden rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) transition-transform duration-(--duration-quick) ease-(--ease-out-quart) active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100">
      <div className="@container relative aspect-[3/2] overflow-hidden bg-(--color-surface-sunken)">
        <PlacePicture
          picture={picture}
          initials={initials(country ?? destination)}
          sizes="(min-width: 1280px) 384px, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"
          priority={priority}
          className="absolute inset-0 transition-transform duration-[420ms] ease-(--ease-out-quart) motion-reduce:transition-none [@media(hover:hover)]:group-hover:scale-[1.04]"
        />

        <div
          aria-hidden="true"
          className="from-bg/90 pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t to-transparent"
        />

        {sharedWithYou ? (
          <span className="border-border-strong bg-bg/70 text-ink absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur-sm">
            <Icon name="users" size={0.95} />
            Shared with you
          </span>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-4">
          <h2 className="font-display text-ink text-[1.5rem] leading-tight text-balance [text-shadow:0_1px_12px_var(--color-bg)]">
            {name}
          </h2>
          <p className="text-ink text-[0.8125rem] [text-shadow:0_1px_8px_var(--color-bg)]">
            {place}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0 text-sm">
          {dates ? (
            <p className="text-ink font-medium tabular-nums">
              {dates}
              {nights ? (
                <span className="text-ink-muted font-normal"> &middot; {nights}</span>
              ) : null}
            </p>
          ) : (
            <p className="text-ink-muted">Dates not set</p>
          )}
        </div>
        <MemberAvatars names={members} size="sm" />
      </div>

      <Link
        href={`/trips/${id}`}
        aria-label={`Open ${name}, ${place}${dates ? `, ${dates}` : ''}`}
        className="absolute inset-0 z-10 rounded-[inherit]"
      />
    </li>
  );
}
