import { describe, expect, it } from 'vitest';
import { createMcpClient, CIRCUIT_OPEN_MESSAGE, type McpClientOptions } from './client';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { FakeMcpTransport, scriptedTransport, type FakeBehaviour } from './fake-transport';

/** Nothing waits for real: sleeps are instant, jitter is zero, the clock is ours. */
function harness(script: FakeBehaviour[], extra: Partial<McpClientOptions> = {}) {
  const clock = { t: Date.UTC(2026, 11, 1) };
  const transport = scriptedTransport(script);
  const client = createMcpClient({
    transportFactory: transport.factory,
    sleep: async (ms) => {
      clock.t += ms;
    },
    random: () => 0,
    now: () => clock.t,
    minIntervalMs: 0,
    ...extra,
  });
  return { client, clock, transport };
}

const OK: FakeBehaviour = { text: '{"ok":true}' };

describe('createMcpClient', () => {
  it('returns the text of a tool answer', async () => {
    const { client } = harness([OK]);
    const result = await client.callTool('search-flight', { flyFrom: 'VIE' });
    expect(result).toEqual({ ok: true, value: { text: '{"ok":true}' } });
    await client.close();
  });

  it('times out on the injected timer without waiting, and says so', async () => {
    const { client, transport } = harness([{ hang: true }], {
      maxRetries: 0,
      timer: {
        setTimeout: (fn) => {
          void Promise.resolve().then(fn);
          return 1;
        },
        clearTimeout: () => undefined,
      },
    });
    const result = await client.callTool('search-flight', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_TIMEOUT');
    expect(transport.calls()).toBe(1);
  });

  it('retries a 5xx and then succeeds', async () => {
    const { client, transport } = harness([{ http: 503 }, { http: 502 }, OK]);
    const result = await client.callTool('search-flight', {});
    expect(result.ok).toBe(true);
    expect(transport.calls()).toBe(3);
  });

  it('retries a 429 twice at most, then fails as rate limited', async () => {
    const { client, transport } = harness([{ http: 429 }]);
    const result = await client.callTool('search-flight', {});
    expect(transport.calls()).toBe(3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RATE_LIMITED');
  });

  it('backs off exponentially between retries', async () => {
    const waited: number[] = [];
    const transport = scriptedTransport([{ http: 500 }]);
    const client = createMcpClient({
      transportFactory: transport.factory,
      sleep: async (ms) => {
        waited.push(ms);
      },
      random: () => 0,
      minIntervalMs: 0,
      backoffBaseMs: 100,
    });
    await client.callTool('search-flight', {});
    expect(waited).toEqual([100, 200]);
  });

  it('does not retry a request the server will never accept', async () => {
    const { client, transport } = harness([{ http: 400 }]);
    const result = await client.callTool('search-flight', {});
    expect(result.ok).toBe(false);
    expect(transport.calls()).toBe(1);
  });

  it('does not retry a tool error, and does not echo its message', async () => {
    const { client, transport } = harness([{ toolError: true }]);
    const result = await client.callTool('search-flight', {});
    expect(transport.calls()).toBe(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).not.toContain('bad input');
  });

  it('opens the circuit after three failures in a row, refuses for 60 seconds, then tries again', async () => {
    const { client, clock, transport } = harness([{ http: 500 }], { maxRetries: 0 });
    for (let i = 0; i < 3; i += 1) await client.callTool('search-flight', {});
    expect(transport.calls()).toBe(3);

    const refused = await client.callTool('search-flight', {});
    expect(transport.calls()).toBe(3);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toBe(CIRCUIT_OPEN_MESSAGE);

    clock.t += 61_000;
    await client.callTool('search-flight', {});
    expect(transport.calls()).toBe(4);
  });

  it('a success resets the failure count', async () => {
    const { client, transport } = harness([{ http: 500 }, { http: 500 }, OK, { http: 500 }], {
      maxRetries: 0,
    });
    for (let i = 0; i < 4; i += 1) await client.callTool('search-flight', {});
    const fifth = await client.callTool('search-flight', {});
    expect(transport.calls()).toBe(5);
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) expect(fifth.error.message).not.toBe(CIRCUIT_OPEN_MESSAGE);
  });

  it('stops at the daily budget, counting attempts, and starts again the next day', async () => {
    const { client, clock, transport } = harness([OK], { dailyBudget: 2 });
    await client.callTool('search-flight', {});
    await client.callTool('search-flight', {});
    const third = await client.callTool('search-flight', {});
    expect(transport.calls()).toBe(2);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe('RATE_LIMITED');

    clock.t += 24 * 3600 * 1000;
    const next = await client.callTool('search-flight', {});
    expect(next.ok).toBe(true);
  });

  it('never has more than the allowed calls in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    class Tracking extends FakeMcpTransport {
      override async send(message: JSONRPCMessage): Promise<void> {
        const isCall = 'method' in message && message.method === 'tools/call';
        if (isCall) {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await super.send(message);
        if (isCall) inFlight -= 1;
      }
    }
    const client = createMcpClient({
      transportFactory: () => new Tracking(() => OK),
      sleep: async () => undefined,
      random: () => 0,
      minIntervalMs: 0,
      maxConcurrent: 2,
    });
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map(() => client.callTool('search-flight', {})),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(peak).toBe(2);
  });
});
