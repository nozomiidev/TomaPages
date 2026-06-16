import { describe, expect, it } from 'vitest';
import {
  formatRoomPeerCell,
  normalizeRoomPeerState,
  summarizeRoomPeerStates,
  summarizeRoomPresence,
  getPeerFreshness,
} from './room-presence';

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

  it('normalizes per-peer cell, mouth, and audio state for diagnostics', () => {
    expect(formatRoomPeerCell({ row: 9, col: -2 })).toBe('4:0');
    expect(normalizeRoomPeerState({
      audioLevel: 1.6,
      cell: { row: 1.2, col: 3.7 },
      id: 'agent:codex one',
      mouth: 4,
      source: 'agent',
    })).toEqual({
      audioLevel: '1.000',
      audioPercent: '100',
      cell: '1:4',
      id: 'agent:codex one',
      mouth: '2',
      source: 'agent',
      speaking: true,
    });
  });

  it('serializes room peer states into compact data attributes', () => {
    expect(summarizeRoomPeerStates([
      {
        audioLevel: 0.05,
        cell: { row: 2, col: 2 },
        id: 'local peer',
        mouth: 0,
        source: 'local',
      },
      {
        audioLevel: 0.42,
        cell: { row: 3, col: 4 },
        id: 'agent:codex',
        mouth: 2,
        source: 'agent',
      },
    ])).toEqual({
      ids: 'local+peer agent%3Acodex',
      openMouthIds: 'agent%3Acodex',
      speakingIds: 'agent%3Acodex',
      states: 'local+peer,local,2:2,m0,a5|agent%3Acodex,agent,3:4,m2,a42',
    });
  });
});
