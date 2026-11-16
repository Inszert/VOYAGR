import { describe, expect, it } from 'vitest';
import { isConnectionDrop } from './postgres';

describe('isConnectionDrop', () => {
  it('recognises a socket reset by the server', () => {
    expect(
      isConnectionDrop(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })),
    ).toBe(true);
  });

  it('recognises a pool client that was terminated', () => {
    expect(isConnectionDrop(new Error('Connection terminated unexpectedly'))).toBe(true);
  });

  it('finds the drop inside a wrapped error', () => {
    const wrapped = Object.assign(new Error('Database query failed'), {
      cause: new Error('read ECONNRESET'),
    });
    expect(isConnectionDrop(wrapped)).toBe(true);
  });

  it('does not retry a genuine query error', () => {
    expect(isConnectionDrop(new Error('duplicate key value violates unique constraint'))).toBe(
      false,
    );
    expect(isConnectionDrop(undefined)).toBe(false);
  });
});
