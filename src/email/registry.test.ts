import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { buildEmailProvider } from './registry';

function build(source: Record<string, string>) {
  // Production needs a public site address (see src/lib/env.ts); give the tests one.
  return buildEmailProvider(parseEnv({ NEXT_PUBLIC_APP_URL: 'https://www.voyagrfind.com', ...source }));
}

describe('buildEmailProvider', () => {
  it('uses the console provider outside production', () => {
    expect(build({ NODE_ENV: 'development' }).id).toBe('console');
    expect(build({ NODE_ENV: 'test' }).id).toBe('console');
  });

  it('does not throw for the console provider in production: every send fails instead', async () => {
    const provider = build({ NODE_ENV: 'production' });

    expect(provider.id).toBe('unconfigured');
    expect(provider.sendsRealEmail).toBe(false);

    const result = await provider.send({ to: 'a@example.com', subject: 's', text: 't' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AppError);
      expect(result.error.code).toBe('CONFIGURATION_ERROR');
    }
  });

  it('lets production opt in to the console provider by name, for the e2e suite', () => {
    const provider = build({ NODE_ENV: 'production', ALLOW_MOCK_IN_PRODUCTION: 'true' });
    expect(provider.id).toBe('console');
  });

  it('builds Resend when it has a key', () => {
    const provider = build({
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_x',
    });

    expect(provider.id).toBe('resend');
    expect(provider.sendsRealEmail).toBe(true);
  });

  it('fails every send for Resend with no key, without throwing', async () => {
    const provider = build({ EMAIL_PROVIDER: 'resend' });

    expect(provider.id).toBe('unconfigured');
    const result = await provider.send({ to: 'a@example.com', subject: 's', text: 't' });
    expect(result.ok).toBe(false);
  });

  it('defaults the sender to the Voyagr address', () => {
    expect(parseEnv({}).EMAIL_FROM).toBe('Voyagr <hello@voyagrfind.com>');
  });
});
