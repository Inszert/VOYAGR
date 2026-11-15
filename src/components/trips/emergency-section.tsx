import { Button, Field, Icon } from '@/components/ui';
import { addContactAction, removeContactAction } from '@/app/actions/trips';
import { ActionForm } from '@/components/trips/action-form';
import type { EmergencyContactRecord } from '@/db/repository';
import type { EmergencyInfo } from '@/trip-hub/emergency';

/**
 * The Emergency tab.
 *
 * Numbers come from a dated open dataset and are shown with where they came
 * from and when they were retrieved. A country with no entry says so plainly: a
 * guessed 112 shown with confidence is the one thing this section must never
 * do. The numbers are large and each one is a `tel:` link, because this is the
 * page somebody opens with a phone in one hand and not much patience.
 */

function telHref(number: string): string {
  return `tel:${number.replace(/[^+\d]/g, '')}`;
}

export function EmergencySection({
  tripId,
  countryName,
  info,
  contacts,
}: {
  readonly tripId: string;
  readonly countryName: string | null;
  readonly info: EmergencyInfo | null;
  readonly contacts: readonly EmergencyContactRecord[];
}) {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-14">
      <div className="flex min-w-0 flex-col gap-12">
        <section aria-labelledby="emergency-heading" className="flex flex-col gap-5">
          <h2 id="emergency-heading" className="font-display text-display-sm text-ink">
            {countryName ? `Emergency numbers in ${countryName}` : 'Emergency numbers'}
          </h2>

          {info ? (
            <>
              <ul aria-label="Emergency numbers" className="grid gap-3 sm:grid-cols-2">
                {info.numbers.map((number) => (
                  <li key={number}>
                    <a
                      href={telHref(number)}
                      className="border-border-strong bg-surface-raised hover:bg-surface-sunken ease-standard duration-quick flex min-h-20 items-center justify-between gap-4 rounded-(--radius-card) border px-5 py-4 transition-colors"
                    >
                      <span className="text-ink text-[2.25rem] leading-none font-semibold tabular-nums">
                        {number}
                      </span>
                      <span className="text-ink-muted inline-flex items-center gap-1.5 text-sm">
                        <Icon name="phone" size={1.1} />
                        Call
                      </span>
                    </a>
                  </li>
                ))}
              </ul>

              <p className="text-ink-muted max-w-[60ch] text-sm leading-relaxed">
                Numbers listed as emergency numbers for this country. The list does not say which
                service each one reaches. Source:{' '}
                <a
                  href={info.source.url}
                  className="text-brand-ink underline underline-offset-4"
                  rel="noopener noreferrer"
                >
                  {info.source.name}
                </a>{' '}
                ({info.source.license}), retrieved{' '}
                <time dateTime={info.source.retrievedOn}>{info.source.retrievedOn}</time>.
              </p>
            </>
          ) : (
            <p className="border-border-strong text-ink-muted max-w-[60ch] rounded-(--radius-card) border border-dashed px-6 py-8 text-sm leading-relaxed">
              {countryName
                ? `No verified number on file for ${countryName}.`
                : 'No verified number on file. Choose a destination country on the trip to see one.'}
            </p>
          )}
        </section>

        <section aria-labelledby="contacts-heading" className="flex flex-col gap-4">
          <div>
            <h2 id="contacts-heading" className="font-display text-display-sm text-ink">
              Your emergency contacts
            </h2>
            <p className="text-ink-muted mt-2 max-w-[60ch] text-sm leading-relaxed">
              Only you see these. They are stored against your account, not against the trip, and
              are included in your data export and removed when you delete your account.
            </p>
          </div>

          {contacts.length === 0 ? (
            <p className="text-ink-muted text-sm">None saved yet.</p>
          ) : (
            <ul className="divide-border border-border divide-y border-y">
              {contacts.map((contact) => (
                <li key={contact.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-ink text-base font-medium">{contact.name}</p>
                    <p className="text-ink-muted text-sm">{contact.relation}</p>
                  </div>
                  <a
                    href={telHref(contact.phone)}
                    className="text-ink inline-flex min-h-11 items-center gap-2 text-lg tabular-nums underline underline-offset-4"
                  >
                    <Icon name="phone" size={1} className="text-ink-muted" />
                    {contact.phone}
                  </a>
                  <form action={removeContactAction}>
                    <input type="hidden" name="contactId" value={contact.id} />
                    <Button type="submit" variant="ghost" size="md">
                      Remove<span className="sr-only"> {contact.name}</span>
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside
        aria-labelledby="add-contact-heading"
        className="border-border bg-surface-raised h-fit rounded-(--radius-card) border p-5 lg:sticky lg:top-24"
      >
        <h3 id="add-contact-heading" className="text-ink mb-4 text-lg font-medium">
          Add a contact
        </h3>
        <ActionForm
          action={addContactAction}
          submitLabel="Add contact"
          pendingLabel="Saving…"
          savedMessage="Saved."
          hidden={{ tripId }}
        >
          <Field label="Name" name="name" required maxLength={80} autoComplete="off" />
          <Field
            label="Phone"
            name="phone"
            type="tel"
            required
            hint="With the country code, such as +44 20 7946 0000."
            autoComplete="off"
          />
          <Field
            label="Relation"
            name="relation"
            required
            maxLength={80}
            hint="For example parent, partner, friend."
            autoComplete="off"
          />
        </ActionForm>
      </aside>
    </div>
  );
}
