import { describe, expect, it } from 'vitest';
import { ConsoleEmailProvider } from './console';

describe('ConsoleEmailProvider', () => {
  it('declares honestly that it sends no real email', () => {
    expect(new ConsoleEmailProvider().sendsRealEmail).toBe(false);
  });

  it('always succeeds - there is no real delivery to fail', async () => {
    const provider = new ConsoleEmailProvider();
    const result = await provider.send({
      to: 'someone@example.invalid',
      subject: 'Confirm your email',
      text: 'Click https://example.invalid/verify?token=abc',
    });

    expect(result.ok).toBe(true);
  });
});
