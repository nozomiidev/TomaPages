const APP_ID = 'io.github.nozomiidev.tomapages';
const P2P_ROOM_PREFIX = 'tomari-studio';

function safeNow() {
  return Date.now();
}

function makeBroadcastChannel(roomId, onMessage) {
  const channelName = `${P2P_ROOM_PREFIX}:${roomId}`;

  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(channelName);
    channel.onmessage = (event) => onMessage(event.data);
    return {
      post: (message) => channel.postMessage(message),
      close: () => channel.close(),
    };
  }

  const storageKey = `${channelName}:message`;
  const onStorage = (event) => {
    if (event.key !== storageKey || !event.newValue) return;
    try {
      onMessage(JSON.parse(event.newValue));
    } catch {
      // Ignore malformed cross-tab payloads from old builds or manual edits.
    }
  };
  window.addEventListener('storage', onStorage);

  return {
    post: (message) => {
      window.localStorage.setItem(storageKey, JSON.stringify({
        ...message,
        postedAt: safeNow(),
      }));
    },
    close: () => window.removeEventListener('storage', onStorage),
  };
}

export function readRoomId(search = window.location.search) {
  const params = new URLSearchParams(search);
  return (params.get('room') || 'public-lobby')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .slice(0, 48) || 'public-lobby';
}

export function getTabPeerId() {
  const key = 'tomari-studio:room-peer-id';
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;

  const id = crypto.randomUUID ? crypto.randomUUID() : `peer-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(key, id);
  return id;
}

export function createPresenceTransport({ roomId, selfId, onPeer, onPeerLeave, onStatus }) {
  let currentPeer = null;
  let disposed = false;
  let trysteroRoom = null;
  let presenceAction = null;
  const trysteroPeerIds = new Map();

  const setStatus = (patch) => onStatus((current) => ({
    ...current,
    ...patch,
  }));

  const receivePeer = (peer, source) => {
    if (!peer || peer.id === selfId) return;
    onPeer({
      ...peer,
      source,
      receivedAt: safeNow(),
    });
  };

  const localChannel = makeBroadcastChannel(roomId, (message) => {
    if (!message || message.roomId !== roomId) return;
    if (message.type === 'presence') receivePeer(message.peer, 'local');
    if (message.type === 'leave' && message.peerId !== selfId) onPeerLeave(message.peerId);
  });

  async function startP2p() {
    try {
      const { joinRoom } = await import('trystero');
      if (disposed) return;

      trysteroRoom = joinRoom({
        appId: APP_ID,
        password: roomId,
      }, `${P2P_ROOM_PREFIX}-${roomId}`, {
        onJoinError: () => setStatus({ p2p: 'limited' }),
      });
      presenceAction = trysteroRoom.makeAction('presence');

      presenceAction.onMessage = (peer, { peerId }) => {
        trysteroPeerIds.set(peerId, peer.id);
        receivePeer(peer, 'p2p');
      };

      trysteroRoom.onPeerJoin = (peerId) => {
        setStatus({ p2p: 'connected' });
        if (currentPeer) {
          void presenceAction.send(currentPeer, { target: peerId });
        }
      };

      trysteroRoom.onPeerLeave = (peerId) => {
        const appPeerId = trysteroPeerIds.get(peerId);
        trysteroPeerIds.delete(peerId);
        if (appPeerId) onPeerLeave(appPeerId);
      };

      setStatus({ p2p: 'listening' });
      if (currentPeer) {
        void presenceAction.send(currentPeer);
      }
    } catch {
      setStatus({ p2p: 'offline' });
    }
  }

  void startP2p();

  return {
    publish(peer) {
      currentPeer = {
        ...peer,
        lastSeen: safeNow(),
        roomId,
      };
      localChannel.post({
        type: 'presence',
        roomId,
        peer: currentPeer,
      });

      if (presenceAction) {
        void presenceAction.send(currentPeer);
      }
    },
    leave() {
      disposed = true;
      localChannel.post({
        type: 'leave',
        roomId,
        peerId: selfId,
      });
      localChannel.close();
      trysteroRoom?.leave();
      trysteroRoom = null;
      presenceAction = null;
    },
  };
}
