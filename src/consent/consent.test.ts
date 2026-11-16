import { describe, expect, it } from 'vitest';
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  consentCookieOptions,
  parseConsent,
} from './cookie';
import { DRIVE_ORIGIN, DRIVE_SRC, DRIVE_STUB_SRC, driveCspOrigin, driveScriptSrc } from './drive';
import { buildContentSecurityPolicy } from './csp';

const prod = { nodeEnv: 'production', allowMockInProduction: false, testStub: false } as const;

describe('parseConsent', () => {
  it('accepts exactly the two values we write', () => {
    expect(parseConsent('accepted')).toBe('accepted');
    expect(parseConsent('declined')).toBe('declined');
  });

  it.each([undefined, null, '', 'Accepted', 'true', 'yes', 'accepted ', 'accepted;x=1'])(
    'treats %j as no choice',
    (value) => {
      expect(parseConsent(value)).toBeNull();
    },
  );
});

describe('consentCookieOptions', () => {
  it('is readable by the banner, lax, for twelve months, with no personal data', () => {
    const options = consentCookieOptions(true);
    expect(CONSENT_COOKIE).toBe('voyagr-consent');
    expect(options).toMatchObject({
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      secure: true,
      maxAge: CONSENT_MAX_AGE_SECONDS,
    });
    expect(CONSENT_MAX_AGE_SECONDS).toBe(31_536_000);
  });

  it('is not Secure over plain-HTTP development', () => {
    expect(consentCookieOptions(false)).not.toHaveProperty('secure');
  });
});

describe('driveScriptSrc', () => {
  it('loads the real script only for an accepted visitor in real production', () => {
    expect(driveScriptSrc({ ...prod, consent: 'accepted' })).toBe(DRIVE_SRC);
    expect(driveCspOrigin({ ...prod, consent: 'accepted' })).toBe(DRIVE_ORIGIN);
  });

  it.each([null, 'declined'] as const)('loads nothing when consent is %s', (consent) => {
    expect(driveScriptSrc({ ...prod, consent })).toBeNull();
    expect(driveCspOrigin({ ...prod, consent })).toBeNull();
  });

  it('loads nothing outside production, accepted or not', () => {
    expect(driveScriptSrc({ ...prod, nodeEnv: 'development', consent: 'accepted' })).toBeNull();
    expect(driveScriptSrc({ ...prod, nodeEnv: 'test', consent: 'accepted' })).toBeNull();
  });

  it('loads nothing in the mock-in-production build', () => {
    expect(
      driveScriptSrc({ ...prod, allowMockInProduction: true, consent: 'accepted' }),
    ).toBeNull();
  });

  it('serves a same-origin stub only where mock data is allowed and only after consent', () => {
    const stub = { ...prod, allowMockInProduction: true, testStub: true };
    expect(driveScriptSrc({ ...stub, consent: 'accepted' })).toBe(DRIVE_STUB_SRC);
    expect(driveScriptSrc({ ...stub, consent: 'declined' })).toBeNull();
    expect(driveScriptSrc({ ...stub, consent: null })).toBeNull();
    // The stub is same-origin, so it never widens the CSP.
    expect(driveCspOrigin({ ...stub, consent: 'accepted' })).toBeNull();
  });

  it('cannot be redirected to the stub on a real deployment', () => {
    expect(driveScriptSrc({ ...prod, testStub: true, consent: 'accepted' })).toBe(DRIVE_SRC);
  });
});

describe('buildContentSecurityPolicy', () => {
  const base = { nonce: 'abc', isDev: false };

  it('names the Drive origin for an accepted visitor', () => {
    const csp = buildContentSecurityPolicy({ ...base, driveOrigin: DRIVE_ORIGIN });
    expect(csp).toContain(`script-src 'self' 'nonce-abc' ${DRIVE_ORIGIN}`);
    expect(csp).toContain(`connect-src 'self' ${DRIVE_ORIGIN}`);
  });

  it('widens worker, style and connect for an accepted visitor, and only those', () => {
    const csp = buildContentSecurityPolicy({ ...base, driveOrigin: DRIVE_ORIGIN });
    expect(csp).toContain("worker-src 'self' blob:;");
    expect(csp).toContain(`style-src 'self' 'unsafe-inline' ${DRIVE_ORIGIN};`);
    expect(csp).toContain(`connect-src 'self' ${DRIVE_ORIGIN} https://www.travelpayouts.com;`);
    // No wildcards anywhere in the widened directives.
    expect(csp).not.toMatch(/(worker|style|connect)-src[^;]*\*/);
  });

  it('does not name it for anyone else', () => {
    const csp = buildContentSecurityPolicy({ ...base, driveOrigin: null });
    expect(csp).not.toContain('emrldco');
    expect(csp).toContain("script-src 'self' 'nonce-abc';");
  });

  it('does not widen worker, style or connect for a declined or unanswered visitor', () => {
    const csp = buildContentSecurityPolicy({ ...base, driveOrigin: null });
    expect(csp).toContain("worker-src 'self';");
    expect(csp).toContain("style-src 'self' 'unsafe-inline';");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).not.toContain('blob:;');
    expect(csp).not.toContain('travelpayouts');
  });

  it('keeps the baseline either way', () => {
    for (const driveOrigin of [null, DRIVE_ORIGIN]) {
      const csp = buildContentSecurityPolicy({ ...base, driveOrigin });
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("default-src 'self'");
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    }
  });

  it('allows eval only in development', () => {
    expect(buildContentSecurityPolicy({ nonce: 'n', isDev: true, driveOrigin: null })).toContain(
      "'unsafe-eval'",
    );
  });
});
