import { describe, expect, it } from 'vitest';
import { getPeerFreshness, summarizeRoomPresence } from './room-presence';

describe('room presence helpers', () => {
  it('summarizes live, agent, demo, and speaking peers', () => {
    expect(summarizeRoomPresence([
      { id: 'local', source: 'local', audioLevel: 0.05 },
      { id: 'remote', source: 'p2p', audioLevel: 0.35 },
      { id: 'tab', source: 'tab', audioLevel: 0.18 },
      { id: 'agent', source: 'agent', audioLevel: 0.1 },
      { id: 'demo', source: 'demo', audioLevel: 0.5 },
    ])).toEqual({
      agent: 1,
      demo: 1,
      live: 4,
      local: 1,
      p2p: 1,
      tab: 1,
      speaking: 2,
      total: 5,
    });
  });

  it('formats peer heartbeat freshness for roster badges', () => {
    expect(getPeerFreshness({ source: 'local' }, { now: 10000 })).toEqual({ label: 'you', state: 'local' });
    expect(getPeerFreshness({ source: 'demo' }, { now: 10000 })).toEqual({ label: 'sim', state: 'static' });
    expect(getPeerFreshness({ source: 'p2p', receivedAt: 9000 }, { now: 10000 })).toEqual({ label: 'now', state: 'fresh' });
    expect(getPeerFreshness({ source: 'tab', receivedAt: 9000 }, { now: 10000 })).toEqual({ label: 'now', state: 'fresh' });
    expect(getPeerFreshness({ source: 'agent', receivedAt: 1000 }, { now: 10000 })).toEqual({ label: '9s', state: 'fresh' });
    expect(getPeerFreshness({ source: 'p2p', receivedAt: 1000 }, { now: 20000 })).toEqual({ label: '19s', state: 'stale' });
  });
});
