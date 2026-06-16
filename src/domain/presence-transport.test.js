import { describe, expect, it } from 'vitest';
import {
  createTabPeerIdSession,
  createOperatorName,
  createPresenceTransport,
  makeRandomRoomId,
  makeRoomUrl,
  readDisplayName,
  readRoomId,
} from './presence-transport';

const flushMicrotasks = () => new Promise((resolve) => {
  queueMicrotask(resolve);
});

function createStatusSink(initial = { local: 'ready', p2p: 'starting' }) {
  const snapshots = [initial];

  return {
    onStatus(patch) {
      const current = snapshots.at(-1);
      snapshots.push(typeof patch === 'function' ? patch(current) : { ...current, ...patch });
    },
    snapshots,
  };
}

function createMemoryChannelFactory() {
  const channelsByRoom = new Map();

  return (roomId, onMessage) => {
    if (!channelsByRoom.has(roomId)) channelsByRoom.set(roomId, new Set());
    const channel = { onMessage };
    const channels = channelsByRoom.get(roomId);
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

function createFakeTrystero() {
  const fake = {
    action: null,
    room: null,
    sent: [],
  };

  fake.loadTrystero = async () => ({
    joinRoom() {
      fake.action = {
        onMessage: null,
        send(data, options) {
          fake.sent.push({ data, options });
          return Promise.resolve();
        },
      };
      fake.room = {
        onPeerJoin: null,
        onPeerLeave: null,
        makeAction: () => fake.action,
        leave: () => {
          fake.left = true;
        },
      };
      return fake.room;
    },
  });

  return fake;
}

describe('presence transport helpers', () => {
  it('sanitizes room ids for URLs and transport channel names', () => {
    expect(readRoomId('?room=Codec Lobby!!')).toBe('codec-lobby');
    expect(readRoomId('?room=')).toBe('public-lobby');
  });

  it('reads a display name or falls back to a stable operator label', () => {
    expect(readDisplayName({
      search: '?name=Nozomi%20Dev',
      fallbackId: 'abcd-1234',
    })).toBe('Nozomi Dev');
    expect(readDisplayName({
      search: '?name=',
      fallbackId: 'abcd-1234',
    })).toBe('Operator ABCD');
  });

  it('builds portable room links with sanitized parameters', () => {
    expect(makeRoomUrl({
      baseUrl: 'https://example.test/TomaPages/talk.html',
      roomId: 'Cool Room',
      name: 'Operator Alpha',
    })).toBe('https://example.test/TomaPages/room.html?room=cool-room&name=Operator+Alpha');
  });

  it('generates readable room ids without relying on a server', () => {
    const values = [0.01, 0.32, 0.75];
    const random = () => values.shift() ?? 0;

    expect(makeRandomRoomId(random)).toBe('codec-orbit-bff');
  });

  it('creates a short operator label from peer ids', () => {
    expect(createOperatorName('7f3a-9999')).toBe('Operator 7F3A');
  });

  it('keeps page-lifetime peer ids without reusing copied session storage', () => {
    const writes = [];
    const storage = {
      getItem: () => {
        throw new Error('copied session ids must not be reused');
      },
      setItem: (key, value) => writes.push([key, value]),
    };
    const readPeerId = createTabPeerIdSession({ randomId: () => `peer-${writes.length + 1}` });

    expect(readPeerId({ storage })).toBe('peer-1');
    expect(readPeerId({ storage })).toBe('peer-1');
    expect(writes).toEqual([['tomari-studio:room-peer-id', 'peer-1']]);
  });

  it('exchanges local presence across two same-room transports', async () => {
    const channelFactory = createMemoryChannelFactory();
    const peersA = [];
    const peersB = [];
    const leavesA = [];
    const leavesB = [];
    const statusA = createStatusSink();
    const statusB = createStatusSink();

    const transportA = createPresenceTransport({
      channelFactory,
      loadTrystero: null,
      now: () => 1000,
      onPeer: (peer) => peersA.push(peer),
      onPeerLeave: (peerId) => leavesA.push(peerId),
      onStatus: statusA.onStatus,
      roomId: 'room-a',
      selfId: 'peer-a',
    });
    const transportB = createPresenceTransport({
      channelFactory,
      loadTrystero: null,
      now: () => 1005,
      onPeer: (peer) => peersB.push(peer),
      onPeerLeave: (peerId) => leavesB.push(peerId),
      onStatus: statusB.onStatus,
      roomId: 'room-a',
      selfId: 'peer-b',
    });

    transportA.publish({ id: 'peer-a', name: 'Alpha' });
    transportB.publish({ id: 'peer-b', name: 'Beta' });
    await flushMicrotasks();

    expect(peersA).toMatchObject([{ id: 'peer-b', name: 'Beta', source: 'tab', receivedAt: 1000 }]);
    expect(peersB).toMatchObject([{ id: 'peer-a', name: 'Alpha', source: 'tab', receivedAt: 1005 }]);
    expect(statusA.snapshots.at(-1).p2p).toBe('disabled');
    expect(statusB.snapshots.at(-1).p2p).toBe('disabled');

    transportA.leave();
    await flushMicrotasks();

    expect(leavesB).toEqual(['peer-a']);
    expect(leavesA).toEqual([]);
    transportB.leave();
  });

  it('ignores local presence from other rooms and from itself', async () => {
    const channelFactory = createMemoryChannelFactory();
    const peersA = [];
    const peersOtherRoom = [];

    const transportA = createPresenceTransport({
      channelFactory,
      loadTrystero: null,
      onPeer: (peer) => peersA.push(peer),
      onPeerLeave: () => {},
      onStatus: createStatusSink().onStatus,
      roomId: 'room-a',
      selfId: 'peer-a',
    });
    const transportOtherRoom = createPresenceTransport({
      channelFactory,
      loadTrystero: null,
      onPeer: (peer) => peersOtherRoom.push(peer),
      onPeerLeave: () => {},
      onStatus: createStatusSink().onStatus,
      roomId: 'room-b',
      selfId: 'peer-b',
    });

    transportA.publish({ id: 'peer-a', name: 'Alpha' });
    transportOtherRoom.publish({ id: 'peer-b', name: 'Beta' });
    await flushMicrotasks();

    expect(peersA).toEqual([]);
    expect(peersOtherRoom).toEqual([]);
    transportA.leave();
    transportOtherRoom.leave();
  });

  it('wires Trystero action messages and targeted join replies', async () => {
    const fakeTrystero = createFakeTrystero();
    const peers = [];
    const leaves = [];
    const status = createStatusSink();

    const transport = createPresenceTransport({
      channelFactory: createMemoryChannelFactory(),
      loadTrystero: fakeTrystero.loadTrystero,
      now: () => 2048,
      onPeer: (peer) => peers.push(peer),
      onPeerLeave: (peerId) => leaves.push(peerId),
      onStatus: status.onStatus,
      roomId: 'room-a',
      selfId: 'peer-a',
    });
    await flushMicrotasks();

    transport.publish({ id: 'peer-a', name: 'Alpha' });
    fakeTrystero.room.onPeerJoin('trystero-b');

    expect(fakeTrystero.sent).toMatchObject([
      { data: { id: 'peer-a', name: 'Alpha', lastSeen: 2048, roomId: 'room-a' } },
      { data: { id: 'peer-a', name: 'Alpha', lastSeen: 2048, roomId: 'room-a' }, options: { target: 'trystero-b' } },
    ]);
    expect(status.snapshots.at(-1).p2p).toBe('connected');

    fakeTrystero.action.onMessage({ id: 'peer-b', name: 'Beta' }, { peerId: 'trystero-b' });

    expect(peers).toMatchObject([{ id: 'peer-b', name: 'Beta', source: 'p2p', receivedAt: 2048 }]);

    fakeTrystero.room.onPeerLeave('trystero-b');

    expect(leaves).toEqual(['peer-b']);
    transport.leave();
    expect(fakeTrystero.left).toBe(true);
  });
});
