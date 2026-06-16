import { sanitizeDisplayName, sanitizeRoomId } from './presence-transport';

export const AGENT_BRIDGE_PROTOCOL = 'tomari-agent-bridge.v1';
export const AGENT_BRIDGE_PREFIX = 'tomari-studio:agent-bridge';
export const AGENT_BRIDGE_PRESENCE_TYPE = 'agent-presence';
export const AGENT_BRIDGE_LEAVE_TYPE = 'agent-leave';
export const AGENT_BRIDGE_READY_TYPE = 'agent-bridge-ready';
export const AGENT_PEER_TTL_MS = 22000;

const DEFAULT_HAIR_COLOR = '#0F766E';
const DEFAULT_EYE_COLOR = '#A855F7';

const safeNow = () => Date.now();
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clamp01 = (value) => clamp(Number.isFinite(value) ? value : 0, 0, 1);

function safeWindow() {
  return typeof window === 'undefined' ? null : window;
}

function sanitizeAgentId(value) {
  const cleaned = String(value || 'agent')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'agent';

  return cleaned.startsWith('agent:') ? cleaned : `agent:${cleaned}`;
}

function normalizeHexColor(value, fallback) {
  const normalized = String(value || '').trim().replace(/^#/, '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((item) => `${item}${item}`).join('')
    : normalized;

  if (!/^[0-9a-f]{6}$/i.test(expanded)) return fallback;
  return `#${expanded.toUpperCase()}`;
}

function normalizeFilter(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['shade', 'shaded', 'tonal', 'detail', 'texture'].includes(normalized)) return 'shade';
  if (['smooth', 'dye', 'perceptual'].includes(normalized)) return 'smooth';
  if (['glaze', 'blend', 'chroma', 'color'].includes(normalized)) return 'glaze';
  if (normalized === 'natural') return 'natural';
  if (normalized === 'paint') return 'paint';
  if (normalized === 'soft') return 'soft';
  if (normalized === 'grade') return 'grade';
  if (normalized === 'silk') return 'silk';
  return 'shade';
}

function normalizeCell(cell = {}) {
  return {
    row: clamp(Math.round(Number(cell.row) || 2), 0, 4),
    col: clamp(Math.round(Number(cell.col) || 2), 0, 4),
  };
}

function makeAgentChannel(channelName, onMessage) {
  if (typeof BroadcastChannel === 'undefined') return null;

  const channel = new BroadcastChannel(channelName);
  channel.onmessage = (event) => onMessage(event.data);
  return {
    post: (message) => channel.postMessage(message),
    close: () => channel.close(),
  };
}

export function makeAgentBridgeChannelName(roomId) {
  return `${AGENT_BRIDGE_PREFIX}:${sanitizeRoomId(roomId)}`;
}

export function makeAgentBridgeReadyMessage({ channelName, now = safeNow, roomId } = {}) {
  const safeRoomId = sanitizeRoomId(roomId);

  return {
    protocol: AGENT_BRIDGE_PROTOCOL,
    type: AGENT_BRIDGE_READY_TYPE,
    roomId: safeRoomId,
    channelName: channelName || makeAgentBridgeChannelName(safeRoomId),
    ttlMs: AGENT_PEER_TTL_MS,
    timestamp: now(),
  };
}

export function makeAgentBridgeManifest({ channelName, roomId, status = 'starting' } = {}) {
  const safeRoomId = sanitizeRoomId(roomId);

  return {
    protocol: AGENT_BRIDGE_PROTOCOL,
    version: 1,
    status: status === 'ready' ? 'ready' : 'starting',
    roomId: safeRoomId,
    channelName: channelName || makeAgentBridgeChannelName(safeRoomId),
    ttlMs: AGENT_PEER_TTL_MS,
    helper: 'window.tomariAgentBridge',
    customEvent: 'tomari-agent-bridge',
    messageTypes: {
      ping: 'agent-ping',
      ready: AGENT_BRIDGE_READY_TYPE,
      presence: AGENT_BRIDGE_PRESENCE_TYPE,
      leave: AGENT_BRIDGE_LEAVE_TYPE,
    },
    transports: [
      'BroadcastChannel',
      'window.postMessage',
      'CustomEvent',
      'page-helper',
    ],
    peerFields: [
      'id',
      'name',
      'role',
      'cell',
      'mouth',
      'audioLevel',
      'hair|hairColor',
      'hairMix|hairTint',
      'eyes|eyeColor',
      'eyeMix|eyeTint',
      'filter|colorFilter',
    ],
  };
}

export function normalizeAgentPeer(input, { now = safeNow } = {}) {
  const rawPeer = input?.peer ?? input ?? {};
  const id = sanitizeAgentId(rawPeer.id ?? rawPeer.agentId ?? rawPeer.name);
  const name = sanitizeDisplayName(rawPeer.name ?? rawPeer.label) || 'Agent';
  const role = sanitizeDisplayName(rawPeer.role ?? rawPeer.kind) || 'AI agent';
  const timestamp = now();

  return {
    id,
    name,
    role,
    source: 'agent',
    cell: normalizeCell(rawPeer.cell),
    mouth: clamp(Math.round(Number(rawPeer.mouth) || 0), 0, 2),
    audioLevel: clamp01(Number(rawPeer.audioLevel)),
    hairColor: normalizeHexColor(rawPeer.hairColor ?? rawPeer.hair, DEFAULT_HAIR_COLOR),
    hairTint: clamp01(Number(rawPeer.hairTint ?? rawPeer.hairMix ?? 0.42)),
    eyeColor: normalizeHexColor(rawPeer.eyeColor ?? rawPeer.eyes, DEFAULT_EYE_COLOR),
    eyeTint: clamp01(Number(rawPeer.eyeTint ?? rawPeer.eyeMix ?? 0.72)),
    colorFilter: normalizeFilter(rawPeer.colorFilter ?? rawPeer.filter),
    lastSeen: timestamp,
    receivedAt: timestamp,
  };
}

export function makeAgentPresenceMessage({ peer, roomId } = {}) {
  const safeRoomId = sanitizeRoomId(roomId);
  const payloadPeer = normalizeAgentPeer(peer, { now: () => 0 });
  delete payloadPeer.lastSeen;
  delete payloadPeer.receivedAt;
  delete payloadPeer.source;

  return {
    protocol: AGENT_BRIDGE_PROTOCOL,
    type: AGENT_BRIDGE_PRESENCE_TYPE,
    roomId: safeRoomId,
    peer: payloadPeer,
  };
}

export function makeAgentLeaveMessage({ peerId, roomId } = {}) {
  return {
    protocol: AGENT_BRIDGE_PROTOCOL,
    type: AGENT_BRIDGE_LEAVE_TYPE,
    roomId: sanitizeRoomId(roomId),
    peerId: sanitizeAgentId(peerId),
  };
}

export function createAgentBridge({
  channelFactory = makeAgentChannel,
  now = safeNow,
  onPeer,
  onPeerLeave,
  roomId,
  windowRef = safeWindow(),
}) {
  const safeRoomId = sanitizeRoomId(roomId);
  const channelName = makeAgentBridgeChannelName(safeRoomId);
  let disposed = false;
  let channel = null;

  const ping = () => {
    const message = makeAgentBridgeReadyMessage({ channelName, now, roomId: safeRoomId });
    channel?.post(message);
    return message;
  };

  const receiveMessage = (message) => {
    if (disposed || !message || typeof message !== 'object') return;
    const messageRoom = message.roomId ? sanitizeRoomId(message.roomId) : safeRoomId;
    if (messageRoom !== safeRoomId) return;

    if (message.protocol && message.protocol !== AGENT_BRIDGE_PROTOCOL) return;

    if (['agent-ping', 'agent:ping', 'ping'].includes(message.type)) {
      ping();
      return;
    }

    if ([AGENT_BRIDGE_LEAVE_TYPE, 'leave'].includes(message.type)) {
      onPeerLeave(sanitizeAgentId(message.peerId ?? message.id));
      return;
    }

    if ([AGENT_BRIDGE_PRESENCE_TYPE, 'agent:update', 'presence'].includes(message.type)) {
      onPeer(normalizeAgentPeer(message.peer ?? message, { now }));
    }
  };

  channel = channelFactory?.(channelName, receiveMessage);

  const publish = (peer) => {
    const message = makeAgentPresenceMessage({ peer, roomId: safeRoomId });
    receiveMessage(message);
    channel?.post(message);
  };

  const leave = (peerId) => {
    const message = makeAgentLeaveMessage({ peerId, roomId: safeRoomId });
    receiveMessage(message);
    channel?.post(message);
  };

  const onWindowMessage = (event) => receiveMessage(event.data);
  const onCustomEvent = (event) => receiveMessage(event.detail);

  if (windowRef?.addEventListener) {
    windowRef.addEventListener('message', onWindowMessage);
    windowRef.addEventListener('tomari-agent-bridge', onCustomEvent);
    windowRef.tomariAgentBridge = {
      channelName,
      leave,
      makeLeave: (peerId) => makeAgentLeaveMessage({ peerId, roomId: safeRoomId }),
      makePresence: (peer) => makeAgentPresenceMessage({ peer, roomId: safeRoomId }),
      ping,
      protocol: AGENT_BRIDGE_PROTOCOL,
      publish,
      roomId: safeRoomId,
    };
  }

  return {
    channelName,
    leave,
    ping,
    publish,
    close() {
      disposed = true;
      channel?.close();
      if (windowRef?.removeEventListener) {
        windowRef.removeEventListener('message', onWindowMessage);
        windowRef.removeEventListener('tomari-agent-bridge', onCustomEvent);
      }
      if (windowRef?.tomariAgentBridge?.channelName === channelName) {
        delete windowRef.tomariAgentBridge;
      }
    },
  };
}
