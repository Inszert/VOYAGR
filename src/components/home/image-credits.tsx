import { Container, Disclosure } from '@/components/ui';
import type { HomeCard } from './card-data';

/**
 * Who made each picture on the page, in full, in one tidy place.
 *
 * A licence obligation is not met by a line in a footer that names the source
 * and not the photographer, and it is not met by a tooltip - so this lists
 * every place whose picture is on the page. A photograph names its
 * photographer and licence. A generated picture is listed as what it is, an
 * illustration, never as a photograph of the place.
 */

export interface ImageCreditsProps {
  cards: readonly HomeCard[];
}

export function ImageCredits({ cards }: ImageCreditsProps) {
  const illustrated = cards.filter((card) => card.image?.kind === 'local');
  const photographed = cards.flatMap((card) =>
    card.image?.kind === 'remote' ? [{ card, credit: card.image.credit }] : [],
  );

  if (illustrated.length === 0 && photographed.length === 0) return null;

  return (
    <Container size="wide" className="home-scope pb-10 lg:pb-12">
      <Disclosure summary="Photograph and illustration credits" className="text-sm">
        <div className="text-ink-muted flex flex-col gap-5">
          {illustrated.length > 0 ? (
            <div>
              <p className="text-ink font-medium">AI-generated illustrations</p>
              <p className="mt-1">
                These are illustrations, not photographs of the place:{' '}
                {illustrated.map((card) => card.name).join(', ')}.
              </p>
            </div>
          ) : null}

          {photographed.length > 0 ? (
            <div>
              <p className="text-ink font-medium">Photographs</p>
              <ul className="mt-1 flex flex-col gap-1">
                {photographed.map(({ card, credit }) => (
                  <li key={card.code}>
                    {card.name}:{' '}
                    <a
                      href={credit.pageUrl}
                      rel="noopener noreferrer nofollow"
                      target="_blank"
                      className="text-ink underline underline-offset-4"
                    >
                      {credit.author ?? 'photographer not stated'}
                    </a>
                    {credit.licence ? `, ${credit.licence}` : ''}
                    {', via Wikimedia'}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Disclosure>
    </Container>
  );
}
