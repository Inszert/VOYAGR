import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { buildEmailProvider } from './registry';

function build(source: Record<string, string>) {
  return buildEmailProvider(parseEnv(source));
}

describe('buildEmailProvider', () => {
  it('uses the console provider outside production', () => {
    expect(build({ NODE_ENV: 'development' }).id).toBe('console');
    expect(build({ NODE_ENV: 'test' }).id).toBe('console');
  });

  it('refuses the console provider in production with a configuration error', () => {
    let thrown: unknown;
    try {
      build({ NODE_ENV: 'production' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('CONFIGURATION_ERROR');
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

  it('refuses Resend with no key rather than failing on the first send', () => {
    expect(() => build({ EMAIL_PROVIDER: 'resend' })).toThrow(AppError);
  });

  it('defaults the sender to the Voyagr address', () => {
    expect(parseEnv({}).EMAIL_FROM).toBe('Voyagr <hello@voyagrfind.com>');
  });
});
