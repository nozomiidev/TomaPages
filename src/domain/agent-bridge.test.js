import { describe, expect, it } from 'vitest';
import {
  AGENT_BRIDGE_PROTOCOL,
  createAgentBridge,
  makeAgentBridgeChannelName,
  normalizeAgentPeer,
} from './agent-bridge';

const flushMicrotasks = () => new Promise((resolve) => {
  queueMicrotask(resolve);
});

function createMemoryChannelFactory() {
  const channelsByName = new Map();

  return (channelName, onMessage) => {
    if (!channelsByName.has(channelName)) channelsByName.set(channelName, new Set());
    const channel = { onMessage };
    const channels = channelsByName.get(channelName);
    channels.add(channel);

    return {
      post(message) {
        channels.forEach((target) => {
          if (target !== channel) queueMicrotask(() => target.onMessage(message));
        });
      },
      close() {
        channels.delete(channel);
      },
    };
  };
}

describe('agent bridge', () => {
  it('creates room-scoped channel names with sanitized room ids', () => {
    expect(makeAgentBridgeChannelName('Codec Lobby!!')).toBe('tomari-studio:agent-bridge:codec-lobby');
  });

  it('normalizes agent payloads into room peer state', () => {
    expect(normalizeAgentPeer({
      id: 'Codex 01',
      name: 'Codex Agent',
      role: 'MCP pilot',
      cell: { row: 9, col: -2 },
      mouth: 4,
      audioLevel: 1.6,
      hair: '0f766e',
      hairMix: 0.65,
      eyes: 'a855f7',
      eyeMix: 0.85,
      filter: 'smooth',
    }, { now: () => 4096 })).toEqual({
      id: 'agent:codex-01',
      name: 'Codex Agent',
      role: 'MCP pilot',
      source: 'agent',
      cell: { row: 4, col: 0 },
      mouth: 2,
      audioLevel: 1,
      hairColor: '#0F766E',
      hairTint: 0.65,
      eyeColor: '#A855F7',
      eyeTint: 0.85,
      colorFilter: 'silk',
      lastSeen: 4096,
      receivedAt: 4096,
    });
  });

  it('exchanges agent presence and leave messages through a static browser channel', async () => {
    const channelFactory = createMemoryChannelFactory();
    const peersA = [];
    const peersB = [];
    const leavesA = [];
    const leavesB = [];

    const bridgeA = createAgentBridge({
      channelFactory,
      now: () => 1000,
      onPeer: (peer) => peersA.push(peer),
      onPeerLeave: (peerId) => leavesA.push(peerId),
      roomId: 'codec-lobby',
      windowRef: null,
    });
    const bridgeB = createAgentBridge({
      channelFactory,
      now: () => 1005,
      onPeer: (peer) => peersB.push(peer),
      onPeerLeave: (peerId) => leavesB.push(peerId),
      roomId: 'codec-lobby',
      windowRef: null,
    });

    bridgeA.publish({
      id: 'codex',
      name: 'Codex',
      audioLevel: 0.42,
      mouth: 1,
    });
    await flushMicrotasks();

    expect(peersA).toMatchObject([{ id: 'agent:codex', source: 'agent', receivedAt: 1000 }]);
    expect(peersB).toMatchObject([{ id: 'agent:codex', source: 'agent', receivedAt: 1005 }]);

    bridgeB.leave('codex');
    await flushMicrotasks();

    expect(leavesA).toEqual(['agent:codex']);
    expect(leavesB).toEqual(['agent:codex']);

    bridgeA.close();
    bridgeB.close();
  });

  it('ignores messages for other rooms and unknown bridge protocol versions', async () => {
    const channelFactory = createMemoryChannelFactory();
    const peers = [];
    const bridge = createAgentBridge({
      channelFactory,
      onPeer: (peer) => peers.push(peer),
      onPeerLeave: () => {},
      roomId: 'codec-lobby',
      windowRef: null,
    });

    channelFactory(makeAgentBridgeChannelName('codec-lobby'), () => {}).post({
      protocol: AGENT_BRIDGE_PROTOCOL,
      type: 'agent-presence',
      roomId: 'other-room',
      peer: { id: 'outside' },
    });
    channelFactory(makeAgentBridgeChannelName('codec-lobby'), () => {}).post({
      protocol: 'future-protocol',
      type: 'agent-presence',
      roomId: 'codec-lobby',
      peer: { id: 'future' },
    });
    await flushMicrotasks();

    expect(peers).toEqual([]);
    bridge.close();
  });
});
