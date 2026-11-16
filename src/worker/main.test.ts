import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOB_NAMES } from '@/queue/types';
import { MemoryQueueDriver } from '@/queue/memory';
import { startWorker } from './main';

describe('startWorker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

    expect([...registered].sort()).toEqual([...JOB_NAMES].sort());
  });
});
