'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui';
import { createInviteAction, revokeInvitesAction, type InviteFormState } from '@/app/actions/trips';

/**
 * The owner's "Invite someone". Makes a link and shows it once.
 *
 * The page it sits on never learns the token: it arrives in this action's
 * response, lives in this component's state and is gone on reload. What the
 * server keeps is a hash, so there is nothing to show later, only "make
 * another" or "switch them all off".
 */
export function InviteControl({
  tripId,
  activeCount,
}: {
  readonly tripId: string;
  readonly activeCount: number;
}) {
  const [state, formAction, pending] = useActionState<InviteFormState, FormData>(
    createInviteAction,
    {},
  );
  const [copied, setCopied] = useState(false);
  const link = state.path ? `${window.location.origin}${state.path}` : null;

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-labelledby="invite-heading" className="flex max-w-3xl flex-col gap-3">
      <h2 id="invite-heading" className="text-ink text-base font-medium">
        Invite someone
      </h2>
      <p className="text-ink-muted max-w-[60ch] text-sm leading-relaxed">
        Anyone with the link who signs in joins this trip. It works for 14 days and up to 10 people.
        You see it once, so copy it now.
      </p>

      <form action={formAction} onSubmit={() => setCopied(false)} className="flex flex-col gap-3">
        <input type="hidden" name="tripId" value={tripId} />
        <p
          role="alert"
          className="border-critical-500/30 bg-critical-500/10 text-critical-ink rounded-(--radius-control) border px-3.5 py-2.5 text-sm empty:hidden"
        >
          {state.error}
        </p>
        <div>
          <Button type="submit" variant="secondary" loading={pending}>
            {pending ? 'Making link…' : 'Create invite link'}
          </Button>
        </div>
      </form>

      {link ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="invite-link" className="text-ink text-sm">
            Invite link
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="invite-link"
              readOnly
              value={link}
              onFocus={(event) => event.currentTarget.select()}
              className="border-border bg-surface text-ink min-h-11 min-w-0 flex-1 rounded-(--radius-control) border px-3 text-sm"
            />
            <Button type="button" variant="primary" onClick={copy}>
              Copy link
            </Button>
          </div>
          <p role="status" className="text-positive-ink text-sm empty:hidden">
            {copied ? 'Link copied.' : null}
          </p>
        </div>
      ) : null}

      {activeCount > 0 ? (
        <form action={revokeInvitesAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="tripId" value={tripId} />
          <p className="text-ink-muted text-sm">
            {activeCount === 1 ? '1 invite link is live.' : `${activeCount} invite links are live.`}
          </p>
          <Button type="submit" variant="ghost">
            Revoke all links
          </Button>
        </form>
      ) : null}
    </section>
  );
}
