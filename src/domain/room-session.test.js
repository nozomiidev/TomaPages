import { describe, expect, it } from 'vitest';
import { makeRoomSessionStatus } from './room-session';

describe('room session status', () => {
  it('summarizes a solo room without overstating remote connectivity', () => {
    expect(makeRoomSessionStatus({
      agentBridgeStatus: 'ready',
      presenceSummary: {
        agent: 0,
        live: 1,
        p2p: 0,
        speaking: 0,
        tab: 0,
        total: 4,
      },
      roomActivity: {
        speakingLabel: 'Quiet',
      },
      snapshotHealth: {
        failed: 0,
        ready: 4,
      },
      transportStatus: {
        p2p: 'connected',
      },
    })).toMatchObject({
      agentLabel: 'Agent ready',
      meshLabel: 'connected',
      snapshotHealth: '4/4 ready',
      snapshotRatio: 1,
      speakingLabel: 'Quiet',
      state: 'armed',
      stateLabel: 'Ready mesh',
    });
  });

  it('promotes the session when browser peers, p2p peers, or agents are active', () => {
    expect(makeRoomSessionStatus({
      agentBridgeStatus: 'ready',
      presenceSummary: {
        agent: 1,
        live: 3,
        p2p: 2,
        speaking: 2,
        tab: 1,
        total: 3,
      },
      roomActivity: {
        speakingLabel: 'Codex, Meryl',
      },
      snapshotHealth: {
        failed: 1,
        ready: 2,
      },
      transportStatus: {
        p2p: 'connected',
      },
    })).toMatchObject({
      agentLabel: '1 agent',
      meshLabel: '2 P2P',
      snapshotHealth: '2/3 ready, 1 failed',
      snapshotRatio: 2 / 3,
      speakingLabel: 'Codex, Meryl',
      state: 'live',
      stateLabel: 'Live mesh',
    });
  });

  it('uses same-browser peers as the mesh label before demo-only peers', () => {
    expect(makeRoomSessionStatus({
      presenceSummary: {
        agent: 0,
        live: 2,
        p2p: 0,
        tab: 1,
        total: 4,
      },
      snapshotHealth: {
        failed: 0,
        ready: 3,
      },
      transportStatus: {
        p2p: 'starting',
      },
    })).toMatchObject({
      meshLabel: '1 tab',
      snapshotHealth: '3/4 ready',
      state: 'live',
    });
  });

  it('marks limited and offline mesh states as retryable without warning on normal listening', () => {
    expect(makeRoomSessionStatus({
      transportStatus: { p2p: 'limited' },
    })).toMatchObject({
      meshRetryable: true,
      meshState: 'limited',
    });
    expect(makeRoomSessionStatus({
      transportStatus: { p2p: 'offline' },
    })).toMatchObject({
      meshRetryable: true,
      meshState: 'offline',
    });
    expect(makeRoomSessionStatus({
      transportStatus: { p2p: 'listening' },
    })).toMatchObject({
      meshRetryable: false,
      meshState: 'listening',
    });
  });
});
