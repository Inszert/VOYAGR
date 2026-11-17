import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOB_NAMES } from '@/queue/types';
import { MemoryQueueDriver } from '@/queue/memory';
import { resetEnvCache } from '@/lib/env';
import { startWorker } from './main';

describe('startWorker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it('registers a handler for every declared job name, so none is a dead declaration', async () => {
    const registered: string[] = [];
    const register = MemoryQueueDriver.prototype.register;
    vi.spyOn(MemoryQueueDriver.prototype, 'register').mockImplementation(function (
      this: MemoryQueueDriver,
      name,
      handler,
    ) {
      registered.push(name);
      return register.call(this, name, handler);
    });

    const worker = await startWorker({ sweepOnStart: false });
    await worker.stop();

    // The flights job is registered only with LITEAPI_SNAPSHOT_ENABLED; every other name always is.
    expect([...registered].sort()).toEqual(
      JOB_NAMES.filter((name) => name !== 'liteapi.flights.refresh').sort(),
    );
  });

  it('registers the flights job too once the snapshot flag is on', async () => {
    vi.stubEnv('LITEAPI_SNAPSHOT_ENABLED', 'true');
    resetEnvCache();
    const registered: string[] = [];
    const register = MemoryQueueDriver.prototype.register;
    vi.spyOn(MemoryQueueDriver.prototype, 'register').mockImplementation(function (
      this: MemoryQueueDriver,
      name,
      handler,
    ) {
      registered.push(name);
      return register.call(this, name, handler);
    });

    const worker = await startWorker({ sweepOnStart: false });
    await worker.stop();

    expect([...registered].sort()).toEqual([...JOB_NAMES].sort());
  });

  it('starts no LiteAPI snapshot scheduler and makes no fetch while the flag is off, key or not', async () => {
    vi.stubEnv('LITEAPI_API_KEY', 'sand_key_for_tests');
    resetEnvCache();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const worker = await startWorker({ sweepOnStart: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await worker.stop();

    expect(worker.liteapiSnapshot).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('starts the scheduler only when the flag is on and a key is set', async () => {
    // Anything that does reach the network is refused, so this can never spend a call.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('blocked in test'));

    vi.stubEnv('LITEAPI_SNAPSHOT_ENABLED', 'true');
    resetEnvCache();
    const withoutKey = await startWorker({ sweepOnStart: false });
    await withoutKey.stop();
    expect(withoutKey.liteapiSnapshot).toBeNull();

    vi.stubEnv('LITEAPI_API_KEY', 'sand_key_for_tests');
    resetEnvCache();
    const withKey = await startWorker({ sweepOnStart: false });
    await withKey.stop();
    expect(withKey.liteapiSnapshot).not.toBeNull();
  });
});
