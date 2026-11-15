import * as React from 'react';
import { PlacePicture } from '@/components/ui';
import { placePictureForCode } from '@/lib/place-image';

/**
 * The frame the four account-entry pages share.
 *
 * From 1024px, the form on the left and, on the right, one destination filling
 * the column edge to edge with a short line and its credit. Below that it is
 * the form alone: a picture beside a phone-width form is a picture nobody asked
 * for between them and the field.
 *
 * The illustration is decoration with a real `alt`, and the credit says what it
 * is - "AI-generated illustration" - in words on the page, not only in the alt.
 * The line over it promises nothing about a price or a trip.
 */

export interface AuthScene {
  /** An airport code that has a picture under `public/img/destinations`. */
  readonly code: string;
  readonly line: string;
}

export function AuthShell({ scene, children }: { scene: AuthScene; children: React.ReactNode }) {
  const picture = placePictureForCode(scene.code);

  return (
    <div className="grid min-h-[calc(100svh-4rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex items-center justify-center px-5 py-10 md:px-12 lg:py-16">
        <div className="w-full max-w-md">{children}</div>
      </div>

      {picture ? (
        <aside
          aria-label={`${picture.label}, illustrated`}
          className="relative isolate hidden overflow-hidden lg:block"
        >
          <PlacePicture
            picture={picture}
            initials=""
            priority
            sizes="(min-width: 1024px) 52vw, 0px"
            className="absolute inset-0"
          />
          <div
            aria-hidden="true"
            className="from-bg via-bg/40 absolute inset-0 bg-gradient-to-t to-transparent"
          />
          <div
            aria-hidden="true"
            className="from-bg/60 absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r to-transparent"
          />

          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-10 xl:p-14">
            <p className="font-display text-ink max-w-[22ch] text-[1.75rem] leading-[1.15] text-balance">
              {scene.line}
            </p>
            <p className="text-ink-muted text-[0.8125rem]">
              {picture.label} <span aria-hidden="true">&middot;</span> AI-generated illustration
            </p>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
