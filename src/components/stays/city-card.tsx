import type { CoveredCity } from '@/search/stays/start-cities';

/** A covered city, linking to its hotel list. The photo is our own file, never a remote one. */

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function CityCard({ city }: { readonly city: CoveredCity }) {
  const href = `/stays?destination=${encodeURIComponent(city.code)}`;

  return (
    <a
      href={href}
      className="border-border bg-surface flex flex-col overflow-hidden rounded-lg border"
    >
      {city.photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- local illustration, fixed file
        <img
          src={city.photo}
          alt={`${city.name}, illustration`}
          width={city.width ?? 768}
          height={city.height ?? 512}
          loading="lazy"
          decoding="async"
          className="aspect-[3/2] w-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="bg-surface-sunken font-display text-ink-muted grid aspect-[3/2] w-full place-items-center text-3xl tracking-[0.04em]"
        >
          {initials(city.name)}
        </span>
      )}
      <span className="text-ink font-display p-3 text-base">{city.name}</span>
    </a>
  );
}
