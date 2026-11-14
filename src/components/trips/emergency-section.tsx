import { Button, Card, Field } from '@/components/ui';
import { addContactAction, removeContactAction } from '@/app/actions/trips';
import { ActionForm } from '@/components/trips/action-form';
import type { EmergencyContactRecord } from '@/db/repository';
import type { EmergencyInfo } from '@/trip-hub/emergency';

/**
 * The Emergency section.
 *
 * Numbers come from a dated open dataset and are shown with where they came
 * from. A country with no entry says so plainly: a guessed 112 shown with
 * confidence is the one thing this section must never do.
 */

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
    <section aria-labelledby="emergency-heading" className="flex flex-col gap-5">
      <h2 id="emergency-heading" className="font-display text-display-sm text-ink">
        Emergency
      </h2>

      <div>
        <h3 className="text-ink mb-2 text-base font-medium">
          {countryName ? `Emergency numbers in ${countryName}` : 'Emergency numbers'}
        </h3>
        {info ? (
          <>
            <ul aria-label="Emergency numbers" className="flex flex-wrap gap-3">
              {info.numbers.map((number) => (
                <li key={number}>
                  <a
                    href={`tel:${number.replace(/[^+\d]/g, '')}`}
                    className="text-ink border-border-strong inline-block rounded-(--radius-control) border px-4 py-2 text-lg tabular-nums"
                  >
                    {number}
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-ink-muted mt-3 max-w-2xl text-sm">
              Numbers listed as emergency numbers for this country. The list does not say which
              service each one reaches. Source:{' '}
              <a href={info.source.url} className="underline underline-offset-4">
                {info.source.name}
              </a>{' '}
              ({info.source.license}), retrieved {info.source.retrievedOn}.
            </p>
          </>
        ) : (
          <p className="text-ink-muted">
            {countryName
              ? `No verified number on file for ${countryName}.`
              : 'No verified number on file. Choose a destination country on the trip to see one.'}
          </p>
        )}
      </div>

      <div>
        <h3 className="text-ink mb-2 text-base font-medium">Your emergency contacts</h3>
        <p className="text-ink-muted mb-3 max-w-2xl text-sm">
          Only you see these. They are stored against your account, not against the trip, and are
          included in your data export and removed when you delete your account.
        </p>
        {contacts.length === 0 ? (
          <p className="text-ink-muted">None saved yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {contacts.map((contact) => (
              <li key={contact.id} className="flex flex-wrap items-center gap-3">
                <span className="text-ink">
                  {contact.name} ({contact.relation}) ·{' '}
                  <a
                    href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`}
                    className="underline underline-offset-4"
                  >
                    {contact.phone}
                  </a>
                </span>
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
      </div>

      <Card as="section" aria-labelledby="add-contact-heading">
        <h3 id="add-contact-heading" className="text-ink mb-4 text-lg font-medium">
          Add a contact
        </h3>
        <ActionForm
          action={addContactAction}
          submitLabel="Add contact"
          savedMessage="Saved."
          hidden={{ tripId }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
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
          </div>
        </ActionForm>
      </Card>
    </section>
  );
}
