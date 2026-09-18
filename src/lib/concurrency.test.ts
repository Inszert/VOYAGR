import { describe, expect, it } from 'vitest';
import { createLimiter } from './concurrency';

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createLimiter', () => {
  it('never runs more than the limit at once', async () => {
    const limiter = createLimiter(3);

    await Promise.all(
      Array.from({ length: 25 }, () =>
        limiter.run(async () => {
          expect(limiter.inFlight).toBeLessThanOrEqual(3);
          await settle(1);
        }),
      ),
    );

    expect(limiter.peakInFlight).toBe(3);
    expect(limiter.inFlight).toBe(0);
  });

  it('holds the limit across a nested fan-out', async () => {
    // The exact shape that produced the defect this limiter replaced: a
    // fan-out inside a fan-out, where passing the same number to both bounds
    // permitted its square. Only the leaf calls take a slot, which is the rule
    // the limiter documents - a task holding a slot while queueing for another
    // would deadlock once every slot were held by a waiter.
    const limiter = createLimiter(4);
    let leavesRunning = 0;
    let peakLeaves = 0;

    await Promise.all(
      Array.from({ length: 6 }, async () => {
        await limiter.run(() => settle(1));

        await Promise.all(
          Array.from({ length: 6 }, () =>
            limiter.run(async () => {
              leavesRunning += 1;
              peakLeaves = Math.max(peakLeaves, leavesRunning);
              await settle(1);
              leavesRunning -= 1;
            }),
          ),
        );
      }),
    );

    expect(peakLeaves).toBeLessThanOrEqual(4);
    expect(limiter.peakInFlight).toBe(4);
  });

  it('does not hand the same slot to two callers', async () => {
    // A limiter that decremented before waking a waiter would let a new caller
    // take a slot already promised, briefly running limit + 1 tasks.
    const limiter = createLimiter(1);
    const order: string[] = [];

    const first = limiter.run(async () => {
      order.push('first');
      await settle(5);
    });
    const queued = limiter.run(async () => {
      order.push('queued');
    });

    await settle(6);
    const late = limiter.run(async () => {
      order.push('late');
    });

    await Promise.all([first, queued, late]);

    expect(limiter.peakInFlight).toBe(1);
    expect(order).toEqual(['first', 'queued', 'late']);
  });

  it('returns each task its own value', async () => {
    const limiter = createLimiter(2);

    const values = await Promise.all([1, 2, 3, 4].map((n) => limiter.run(async () => n * 10)));

    expect(values).toEqual([10, 20, 30, 40]);
  });

  it('frees the slot when a task rejects', async () => {
    const limiter = createLimiter(1);

    await expect(
      limiter.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // A leaked slot would deadlock every later call.
    expect(limiter.inFlight).toBe(0);
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('rejects a nonsensical limit', () => {
    expect(() => createLimiter(0)).toThrow(RangeError);
    expect(() => createLimiter(1.5)).toThrow(RangeError);
  });
});
