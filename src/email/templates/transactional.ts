import { renderEmail, type RenderedEmail } from './layout';

/**
 * Mail the account cannot work without. Someone asked for each of these a
 * moment ago, so none carries an unsubscribe link.
 */

export interface LinkEmailInput {
  /** The one-time link. Never logged, never shown anywhere but the message. */
  readonly link: string;
  readonly postalAddress?: string | null;
}

/** The welcome mail: the first thing a new account receives, and it carries the verification link. */
export function welcomeTemplate(input: LinkEmailInput): RenderedEmail {
  return renderEmail({
    subject: 'Welcome to Voyagr - confirm your email',
    preheader: 'Confirm your email to start using Voyagr. The link works once and lasts 24 hours.',
    heading: 'Welcome to Voyagr',
    blocks: [
      {
        type: 'paragraph',
        text: 'Your account is ready. Confirm your email so we can reach you if you ever forget your password.',
      },
      {
        type: 'note',
        text: 'The link works once and expires in 24 hours. Did not sign up? You can ignore this email.',
      },
    ],
    button: { label: 'Confirm my email', url: input.link },
    reason: 'You got this because someone signed up for Voyagr with this address.',
    postalAddress: input.postalAddress,
  });
}

export function passwordResetTemplate(input: LinkEmailInput): RenderedEmail {
  return renderEmail({
    subject: 'Reset your Voyagr password',
    preheader: 'Choose a new password. The link works once and lasts 1 hour.',
    heading: 'Choose a new password',
    blocks: [
      { type: 'paragraph', text: 'We got a request to reset the password on your Voyagr account. Use the button to choose a new one.' },
      {
        type: 'note',
        text: 'The link works once and expires in 1 hour. Did not ask for this? Ignore this email. Your password has not changed.',
      },
    ],
    button: { label: 'Choose a new password', url: input.link },
    reason: 'You got this because a password reset was requested for your account.',
    postalAddress: input.postalAddress,
  });
}

export interface EmailChangeInput extends LinkEmailInput {
  /** The address the account is moving to; user-supplied, so it is escaped like any other text. */
  readonly newEmail: string;
}

export function emailChangeTemplate(input: EmailChangeInput): RenderedEmail {
  return renderEmail({
    subject: 'Confirm your new email for Voyagr',
    preheader: 'Confirm this address to move your Voyagr account to it.',
    heading: 'Confirm your new email',
    blocks: [
      {
        type: 'paragraph',
        text: `Please confirm that ${input.newEmail} is the address you want on your Voyagr account.`,
      },
      {
        type: 'note',
        text: 'The link works once and expires in 1 hour. Did not ask for this? Ignore this email. Your email has not changed.',
      },
    ],
    button: { label: 'Confirm new email', url: input.link },
    reason: 'You got this because this address was entered as a new account email.',
    postalAddress: input.postalAddress,
  });
}
