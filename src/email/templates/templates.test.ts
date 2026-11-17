import { describe, expect, it } from 'vitest';
import {
  emailChangeTemplate,
  passwordResetTemplate,
  welcomeTemplate,
  POSTAL_PLACEHOLDER,
} from './index';
import { assertSafeUrl, escapeHtml, singleLine } from './escape';

const LINK = 'https://voyagrfind.com/api/verify-email?token=abc123';
const POSTAL = '1 Example Street, Exampleville';

const templates = {
  welcome: () => welcomeTemplate({ link: LINK, postalAddress: POSTAL }),
  reset: () => passwordResetTemplate({ link: LINK, postalAddress: POSTAL }),
  change: () =>
    emailChangeTemplate({ link: LINK, newEmail: 'new@example.invalid', postalAddress: POSTAL }),
};

describe.each(Object.entries(templates))('%s mail', (_name, build) => {
  const mail = build();

  it('puts the one-time link in the button and in the text alternative', () => {
    expect(mail.html).toContain(`href="${LINK}"`);
    expect(mail.text).toContain(LINK);
  });

  it('carries a text alternative that stands on its own', () => {
    expect(mail.text.length).toBeGreaterThan(40);
    expect(mail.text).not.toMatch(/<[a-z][^>]*>/i);
    expect(mail.text).toContain(POSTAL);
  });

  it('has exactly one primary button, at least 44px tall', () => {
    expect(mail.html.match(/background-color:#A0633A;border-radius:12px;"><a /g)).toHaveLength(1);
    expect(mail.html).toContain('min-height:44px');
  });

  it('is table-based, inline-styled, and needs no remote font or image', () => {
    expect(mail.html).toContain('role="presentation"');
    expect(mail.html).not.toMatch(/<img\b/i);
    expect(mail.html).not.toMatch(/@import|<link\b|url\(/i);
    expect(mail.html).toContain('max-width:600px');
    expect(mail.html).toContain('padding:24px');
    expect(mail.html).toContain('max-width: 480px');
    expect(mail.html).toContain('padding-left: 16px');
  });

  it('uses the night palette, a copper button, and the Georgia wordmark and heading', () => {
    for (const colour of [
      '#05070E',
      '#0C101B',
      '#232836',
      '#FFFFFF',
      '#98A0B0',
      '#A0633A',
      '#F2C46A',
    ]) {
      expect(mail.html).toContain(colour);
    }
    expect(mail.html).toMatch(/font:400 28px\/34px Georgia/);
    expect(mail.html).toMatch(/font:400 30px\/36px Georgia[^>]*>Voyagr<\/td>/);
    expect(mail.html).toContain('16px/24px');
  });

  it('has a hidden preheader and a one-line subject', () => {
    expect(mail.html).toContain('display:none');
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject.length).toBeGreaterThan(0);
  });

  it('is transactional: no unsubscribe link and no list headers', () => {
    expect(mail.html).not.toMatch(/unsubscribe/i);
    expect(mail.text).not.toMatch(/unsubscribe/i);
    expect(mail).not.toHaveProperty('headers');
  });
});

describe('welcome mail', () => {
  it('welcomes the person and still asks them to confirm', () => {
    const mail = templates.welcome();

    expect(mail.subject).toMatch(/welcome/i);
    expect(mail.subject).toMatch(/confirm your email/i);
    expect(mail.html).toContain('Confirm my email');
  });
});

describe('escaping', () => {
  const INJECTION = `<script>alert(1)</script>"><img src=x onerror=alert(2)>`;

  it('escapes a user-supplied new email address', () => {
    const mail = emailChangeTemplate({ link: LINK, newEmail: INJECTION, postalAddress: POSTAL });

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('escapes the postal address', () => {
    const mail = welcomeTemplate({ link: LINK, postalAddress: '<b>x</b> & co' });
    expect(mail.html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; co');
  });

  it('cannot break out of an href through a quote in the link', () => {
    const mail = welcomeTemplate({ link: 'https://voyagrfind.com/a?x="onmouseover="alert(1)' });

    expect(mail.html).not.toContain('"onmouseover="');
  });

  it('refuses a javascript: or relative link rather than rendering it', () => {
    expect(() => welcomeTemplate({ link: 'javascript:alert(1)' })).toThrow();
    expect(() => welcomeTemplate({ link: '/relative' })).toThrow();
    expect(() => assertSafeUrl('data:text/html,hi')).toThrow();
  });

  it('escapeHtml covers all five characters and leaves plain text alone', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(escapeHtml('plain text')).toBe('plain text');
  });

  it('keeps a newline out of a subject line, so it cannot add a header', () => {
    expect(singleLine('Hello\r\nBcc: attacker@example.invalid')).not.toMatch(/[\r\n]/);
  });
});

describe('footer', () => {
  it('carries the support line in both parts', () => {
    const mail = welcomeTemplate({ link: LINK, postalAddress: POSTAL });
    expect(mail.html).toContain('href="mailto:support@voyagrfind.com"');
    expect(mail.text).toContain('support@voyagrfind.com');
  });

  it('shows a visible placeholder when no postal address is configured', () => {
    expect(welcomeTemplate({ link: LINK }).text).toContain(POSTAL_PLACEHOLDER);
  });
});
