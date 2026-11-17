/**
 * Write the transactional emails to HTML files so they can be opened in a browser.
 *
 * The templates are the real ones in src/email/templates/transactional.ts, rendered
 * with sample values only. Nothing is sent: this script never touches a mail
 * transport, the database or .env.
 *
 * Usage:
 *   npx tsx scripts/preview-emails.mjs [outputFolder]
 *
 * outputFolder defaults to .email-previews/ at the repository root (gitignored).
 * It writes three emails plus an index.html that links them; open the index.html
 * inside outputFolder to browse the three emails.
 *
 * Run with tsx, not node: the templates are TypeScript.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  welcomeTemplate,
  passwordResetTemplate,
  emailChangeTemplate,
} from '../src/email/templates/transactional.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(process.argv[2] ?? join(REPO_ROOT, '.email-previews'));

const SAMPLE_LINK = 'https://www.voyagrfind.com/verify?token=sample';
const SAMPLE_ADDRESS = 'preview@example.com';
const SAMPLE_POSTAL = 'Voyagr, 1 Example Street, Sample City';

const emails = [
  {
    file: 'welcome.html',
    label: 'Welcome (confirm email)',
    rendered: welcomeTemplate({ link: SAMPLE_LINK, postalAddress: SAMPLE_POSTAL }),
  },
  {
    file: 'password-reset.html',
    label: 'Password reset',
    rendered: passwordResetTemplate({ link: SAMPLE_LINK, postalAddress: SAMPLE_POSTAL }),
  },
  {
    file: 'email-change.html',
    label: 'Email change',
    rendered: emailChangeTemplate({
      link: SAMPLE_LINK,
      newEmail: SAMPLE_ADDRESS,
      postalAddress: SAMPLE_POSTAL,
    }),
  },
];

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function indexHtml() {
  const items = emails
    .map(
      ({ file, label, rendered }) => `    <li>
      <a href="${escapeHtml(file)}">${escapeHtml(label)}</a>
      <span class="subject">Subject: ${escapeHtml(rendered.subject)}</span>
    </li>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Voyagr email previews</title>
    <style>
      body { margin: 0; padding: 32px 16px; font: 16px/1.5 system-ui, sans-serif; color: #1b1f24; background: #f4f5f7; }
      main { max-width: 640px; margin: 0 auto; }
      h1 { font-size: 22px; margin: 0 0 8px; }
      p { margin: 0 0 24px; color: #4a5260; }
      ul { list-style: none; margin: 0; padding: 0; }
      li { background: #fff; border: 1px solid #d8dce3; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
      a { color: #1c4f7c; font-weight: 600; }
      a:focus-visible { outline: 3px solid #1c4f7c; outline-offset: 2px; }
      .subject { display: block; margin-top: 4px; font-size: 14px; color: #4a5260; }
    </style>
  </head>
  <body>
    <main>
      <h1>Voyagr email previews</h1>
      <p>Rendered from the real templates with sample values. Nothing has been sent.</p>
      <ul>
${items}
      </ul>
    </main>
  </body>
</html>
`;
}

mkdirSync(outputDir, { recursive: true });

for (const { file, rendered } of emails) {
  writeFileSync(join(outputDir, file), rendered.html, 'utf8');
}
writeFileSync(join(outputDir, 'index.html'), indexHtml(), 'utf8');

console.log(`Wrote ${emails.length + 1} files to ${outputDir}`);
for (const { file } of emails) {
  console.log(`  ${join(outputDir, file)}`);
}
console.log(`  ${join(outputDir, 'index.html')}`);
