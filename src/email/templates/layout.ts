import { getEnv } from '@/lib/env';
import { assertSafeUrl, escapeHtml, singleLine } from './escape';

/**
 * The one email layout.
 *
 * Voyagr sends email for exactly three things - a welcome that carries the
 * verification link, a password reset, and an email-change confirmation - and
 * every one is something the person just asked for. There is no marketing or
 * alert mail, so there is no unsubscribe link or `List-Unsubscribe` header; if
 * a non-transactional message is ever added, those come back with it.
 *
 * Table-based and inline-styled because that is what mail clients render
 * reliably: no remote fonts, no images needed to understand the message, one
 * primary button. The same content model produces the plain-text alternative,
 * so the two cannot drift.
 *
 * Nothing in here computes a number. A price arrives already formatted by
 * `src/core/money.ts`.
 */

export const EMAIL_COLOURS = {
  background: '#0B1020',
  card: '#121A2E',
  border: '#23304D',
  text: '#E8ECF5',
  muted: '#9AA6BF',
  accent: '#F2B84B',
  onAccent: '#0B1020',
} as const;

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Shown when `EMAIL_POSTAL_ADDRESS` is unset, so a missing address is visible rather than silently absent. */
export const POSTAL_PLACEHOLDER = '[Postal address not configured]';

export type EmailBlock =
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'note'; readonly text: string }
  | {
      readonly type: 'list';
      readonly items: readonly {
        readonly title: string;
        readonly detail?: string;
        /** Already formatted by the Money helpers. */
        readonly price?: string;
        readonly url?: string;
      }[];
    };

export interface EmailSpec {
  readonly subject: string;
  readonly preheader: string;
  readonly heading: string;
  readonly blocks: readonly EmailBlock[];
  /** The one primary action. */
  readonly button: { readonly label: string; readonly url: string };
  /** Why this person is getting it, in one sentence. */
  readonly reason: string;
  readonly postalAddress?: string | null;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

function renderBlockHtml(block: EmailBlock): string {
  switch (block.type) {
    case 'paragraph':
      return `<p style="margin:0 0 16px 0;font:16px/24px ${SANS};color:${EMAIL_COLOURS.text};">${escapeHtml(block.text)}</p>`;
    case 'note':
      return `<p style="margin:0 0 16px 0;font:14px/20px ${SANS};color:${EMAIL_COLOURS.muted};">${escapeHtml(block.text)}</p>`;
    case 'list': {
      const rows = block.items
        .map((item) => {
          const title = item.url
            ? `<a href="${escapeHtml(assertSafeUrl(item.url))}" style="color:${EMAIL_COLOURS.text};text-decoration:underline;">${escapeHtml(item.title)}</a>`
            : escapeHtml(item.title);
          const detail = item.detail
            ? `<br><span style="font:14px/20px ${SANS};color:${EMAIL_COLOURS.muted};">${escapeHtml(item.detail)}</span>`
            : '';
          const price = item.price
            ? `<td align="right" style="padding:12px 0 12px 12px;border-top:1px solid ${EMAIL_COLOURS.border};font:600 16px/24px ${SANS};color:${EMAIL_COLOURS.accent};white-space:nowrap;">${escapeHtml(item.price)}</td>`
            : '';

          return `<tr><td style="padding:12px 0;border-top:1px solid ${EMAIL_COLOURS.border};font:16px/24px ${SANS};color:${EMAIL_COLOURS.text};">${title}${detail}</td>${price}</tr>`;
        })
        .join('');

      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;border-collapse:collapse;">${rows}</table>`;
    }
  }
}

function renderBlockText(block: EmailBlock): string {
  switch (block.type) {
    case 'paragraph':
    case 'note':
      return block.text;
    case 'list':
      return block.items
        .map((item) =>
          [
            `- ${item.title}${item.price ? ` - ${item.price}` : ''}`,
            item.detail ? `  ${item.detail}` : null,
            item.url ? `  ${item.url}` : null,
          ]
            .filter((line) => line !== null)
            .join('\n'),
        )
        .join('\n');
  }
}

export function renderEmail(spec: EmailSpec): RenderedEmail {
  const postal = spec.postalAddress ?? getEnv().EMAIL_POSTAL_ADDRESS ?? POSTAL_PLACEHOLDER;
  const subject = singleLine(spec.subject);
  const buttonUrl = assertSafeUrl(spec.button.url);

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(subject)}</title>
<style>
@media only screen and (max-width: 480px) {
  .px { padding-left: 16px !important; padding-right: 16px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLOURS.background};color:${EMAIL_COLOURS.text};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${EMAIL_COLOURS.background};">${escapeHtml(spec.preheader)}${'&nbsp;&zwnj;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_COLOURS.background}" style="background-color:${EMAIL_COLOURS.background};">
<tr><td align="center" class="px" style="padding:24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td style="padding:0 0 16px 0;font:600 16px/24px ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_COLOURS.accent};">Voyagr</td></tr>
<tr><td bgcolor="${EMAIL_COLOURS.card}" class="px" style="background-color:${EMAIL_COLOURS.card};border:1px solid ${EMAIL_COLOURS.border};border-radius:12px;padding:24px;">
<h1 style="margin:0 0 16px 0;font:400 28px/34px ${SERIF};color:${EMAIL_COLOURS.text};">${escapeHtml(spec.heading)}</h1>
${spec.blocks.map(renderBlockHtml).join('\n')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px 0;"><tr><td bgcolor="${EMAIL_COLOURS.accent}" style="background-color:${EMAIL_COLOURS.accent};border-radius:12px;"><a href="${escapeHtml(buttonUrl)}" style="display:inline-block;min-height:44px;padding:14px 24px;box-sizing:border-box;font:600 16px/16px ${SANS};color:${EMAIL_COLOURS.onAccent};text-decoration:none;border-radius:12px;">${escapeHtml(spec.button.label)}</a></td></tr></table>
<p style="margin:0;font:14px/20px ${SANS};color:${EMAIL_COLOURS.muted};">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(buttonUrl)}" style="color:${EMAIL_COLOURS.accent};word-break:break-all;">${escapeHtml(buttonUrl)}</a></p>
</td></tr>
<tr><td class="px" style="padding:16px 0 0 0;font:14px/20px ${SANS};color:${EMAIL_COLOURS.muted};">
<p style="margin:0 0 8px 0;">${escapeHtml(spec.reason)}</p>
<p style="margin:0;">${escapeHtml(postal)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    spec.heading,
    '',
    ...spec.blocks.flatMap((block) => [renderBlockText(block), '']),
    `${spec.button.label}: ${buttonUrl}`,
    '',
    '--',
    spec.reason,
    postal,
  ].join('\n');

  return { subject, html, text };
}
