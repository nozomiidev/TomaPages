const APP_ID = 'io.github.nozomiidev.tomapages';
const P2P_ROOM_PREFIX = 'tomari-studio';
const ROOM_WORDS = ['codec', 'signal', 'orbit', 'relay', 'uplink', 'vector', 'beacon', 'circuit'];

function safeNow() {
  return Date.now();
}

function currentSearch() {
  return typeof window === 'undefined' ? '' : window.location.search;
}

export function sanitizeRoomId(value) {
  return (value || 'public-lobby')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'public-lobby';
}

export function sanitizeDisplayName(value) {
  return String(value || '')
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28);
}

export function createOperatorName(peerId = '') {
  const suffix = String(peerId).replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase();
  return `Operator ${suffix || Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function makeRandomRoomId(random = Math.random) {
  const left = ROOM_WORDS[Math.floor(random() * ROOM_WORDS.length)] ?? ROOM_WORDS[0];
  const right = ROOM_WORDS[Math.floor(random() * ROOM_WORDS.length)] ?? ROOM_WORDS[1];
  const code = Math.floor(random() * 0xfff).toString(16).padStart(3, '0');
  return sanitizeRoomId(`${left}-${right}-${code}`);
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

function loadDefaultTrystero() {
  return import('trystero');
}

export function readRoomId(search = currentSearch()) {
  const params = new URLSearchParams(search);
  return sanitizeRoomId(params.get('room'));
}

export function readDisplayName({ search = currentSearch(), fallbackId = '' } = {}) {
  const params = new URLSearchParams(search);
  return sanitizeDisplayName(params.get('name')) || createOperatorName(fallbackId);
}

export function makeRoomUrl({ roomId, name, baseUrl } = {}) {
  const safeBase = baseUrl ?? (typeof window === 'undefined' ? 'https://example.test/room.html' : window.location.href);
  const url = new URL('room.html', safeBase);
  url.searchParams.set('room', sanitizeRoomId(roomId));

  const displayName = sanitizeDisplayName(name);
  if (displayName) url.searchParams.set('name', displayName);

  return url.toString();
}

export function getTabPeerId() {
  const key = 'tomari-studio:room-peer-id';
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;

  const id = crypto.randomUUID ? crypto.randomUUID() : `peer-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(key, id);
  return id;
}

export function createPresenceTransport({
  channelFactory = makeBroadcastChannel,
  loadTrystero = loadDefaultTrystero,
  now = safeNow,
  onPeer,
  onPeerLeave,
  onStatus,
  roomId,
  selfId,
}) {
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
      receivedAt: now(),
    });
  };

  const localChannel = channelFactory(roomId, (message) => {
    if (!message || message.roomId !== roomId) return;
    if (message.type === 'presence') receivePeer(message.peer, 'local');
    if (message.type === 'leave' && message.peerId !== selfId) onPeerLeave(message.peerId);
  });

  async function startP2p() {
    if (!loadTrystero) {
      setStatus({ p2p: 'disabled' });
      return;
    }

    try {
      const { joinRoom } = await loadTrystero();
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
        lastSeen: now(),
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
