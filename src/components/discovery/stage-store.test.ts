// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  getStageSnapshot,
  publishStageData,
  registerStageSlot,
  releaseStageSlot,
  setStagePending,
  subscribeStage,
  type StageData,
} from './stage-store';

const DATA = { chips: [] } as unknown as StageData;

describe('the stage store', () => {
  it('ends a pending navigation when the next page publishes its data', () => {
    setStagePending(true);
    expect(getStageSnapshot().pending).toBe(true);

    publishStageData({ ...DATA });
    expect(getStageSnapshot().pending).toBe(false);
  });

  it('keeps the slot until the page that owned it is the one releasing it', () => {
    const home = document.createElement('div');
    const explorer = document.createElement('div');

    registerStageSlot(home, 'stage');
    registerStageSlot(explorer, 'explorer');

    // The home page unmounting after the explorer has registered must not
    // take the explorer's box away.
    releaseStageSlot(home);
    expect(getStageSnapshot().slot).toBe(explorer);
    expect(getStageSnapshot().variant).toBe('explorer');

    releaseStageSlot(explorer);
    expect(getStageSnapshot().slot).toBeNull();
  });

  it('tells subscribers once per real change, not per call', () => {
    const listener = vi.fn();
    const stop = subscribeStage(listener);

    setStagePending(true);
    setStagePending(true);
    setStagePending(false);

    stop();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
