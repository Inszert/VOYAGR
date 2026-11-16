import { describe, expect, it } from 'vitest';
import { reportedStatus, summariseProviderHealth, type ProbedProvider } from './health-summary';

const live = (kind: ProbedProvider['kind'], status: ProbedProvider['status'] = 'healthy') =>
  ({ kind, status, mode: 'live' }) satisfies ProbedProvider;
const absent = (kind: ProbedProvider['kind']) =>
  ({ kind, status: 'unavailable', mode: 'absent' }) satisfies ProbedProvider;

describe('summariseProviderHealth', () => {
  it('is healthy when every configured provider is healthy, whatever is absent', () => {
    const summary = summariseProviderHealth([
      live('flights'),
      live('weather'),
      live('places'),
      absent('hotels'),
      absent('transfers'),
    ]);

    expect(summary.healthy).toBe(true);
    expect(summary.absent).toEqual(['hotels', 'transfers']);
    expect(summary.failing).toEqual([]);
  });

  it('is healthy when every slot is absent, because nothing configured is failing', () => {
    expect(summariseProviderHealth([absent('hotels')]).healthy).toBe(true);
  });

  it('is degraded when a configured provider is unavailable', () => {
    const summary = summariseProviderHealth([live('flights', 'unavailable'), absent('hotels')]);

    expect(summary.healthy).toBe(false);
    expect(summary.failing).toEqual(['flights']);
  });

  it('is degraded when a configured provider is degraded', () => {
    expect(summariseProviderHealth([live('weather', 'degraded')]).healthy).toBe(false);
  });

  it('treats a provider with no stated mode as configured', () => {
    expect(summariseProviderHealth([{ kind: 'flights', status: 'unavailable' }]).healthy).toBe(
      false,
    );
  });

  it('is healthy with nothing to probe', () => {
    expect(summariseProviderHealth([]).healthy).toBe(true);
  });
});

describe('reportedStatus', () => {
  it('says absent for an absent slot and passes every other status through', () => {
    expect(reportedStatus(absent('hotels'))).toBe('absent');
    expect(reportedStatus(live('flights', 'degraded'))).toBe('degraded');
    expect(reportedStatus(live('flights'))).toBe('healthy');
  });
});
