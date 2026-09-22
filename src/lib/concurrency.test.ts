import { describe, expect, it } from 'vitest';
import { createLimiter, createLimiterPool } from './concurrency';

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

describe('createLimiterPool', () => {
  it('gives each key its own bound, so one provider cannot throttle another', async () => {
    const pool = createLimiterPool(4);

    const slow = pool.for('slow', 1);
    const fast = pool.for('fast', 3);

    let slowRunning = 0;
    let fastPeak = 0;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    // One task occupies the slow provider's only slot.
    const blocked = slow.run(async () => {
      slowRunning += 1;
      await held;
      slowRunning -= 1;
    });

    // The fast provider runs regardless, which is the whole point.
    await Promise.all(
      Array.from({ length: 3 }, () =>
        fast.run(async () => {
          fastPeak = Math.max(fastPeak, fast.inFlight);
        }),
      ),
    );

    expect(fastPeak).toBe(3);
    expect(slowRunning).toBe(1);

    release();
    await blocked;
  });

  it('hands back the same limiter for a key, so a bound cannot be raised later', () => {
    const pool = createLimiterPool(4);

    const first = pool.for('flights', 2);
    const second = pool.for('flights', 99);

    expect(second).toBe(first);
    expect(second.limit).toBe(2);
  });

  it('uses the fallback for a key that names no limit of its own', () => {
    expect(createLimiterPool(5).for('hotels').limit).toBe(5);
  });

  it('reports every limiter it handed out, so the bounds can be proven', () => {
    const pool = createLimiterPool(4);
    pool.for('flights', 2);
    pool.for('hotels', 3);

    expect([...pool.limiters.keys()].sort()).toEqual(['flights', 'hotels']);
  });
});
