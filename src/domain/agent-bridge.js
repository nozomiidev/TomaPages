import { sanitizeDisplayName, sanitizeRoomId } from './presence-transport';

export const AGENT_BRIDGE_PROTOCOL = 'tomari-agent-bridge.v1';
export const AGENT_BRIDGE_PREFIX = 'tomari-studio:agent-bridge';
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
  if (normalized === 'paint') return 'paint';
  if (normalized === 'soft') return 'soft';
  if (normalized === 'grade') return 'grade';
  return 'silk';
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

  const receiveMessage = (message) => {
    if (disposed || !message || typeof message !== 'object') return;
    const messageRoom = message.roomId ? sanitizeRoomId(message.roomId) : safeRoomId;
    if (messageRoom !== safeRoomId) return;

    if (message.protocol && message.protocol !== AGENT_BRIDGE_PROTOCOL) return;

    if (['agent-leave', 'leave'].includes(message.type)) {
      onPeerLeave(sanitizeAgentId(message.peerId ?? message.id));
      return;
    }

    if (['agent-presence', 'agent:update', 'presence'].includes(message.type)) {
      onPeer(normalizeAgentPeer(message.peer ?? message, { now }));
    }
  };

  const channel = channelFactory?.(channelName, receiveMessage);

  const publish = (peer) => {
    const message = {
      protocol: AGENT_BRIDGE_PROTOCOL,
      type: 'agent-presence',
      roomId: safeRoomId,
      peer,
    };
    receiveMessage(message);
    channel?.post(message);
  };

  const leave = (peerId) => {
    const message = {
      protocol: AGENT_BRIDGE_PROTOCOL,
      type: 'agent-leave',
      roomId: safeRoomId,
      peerId,
    };
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
      protocol: AGENT_BRIDGE_PROTOCOL,
      publish,
      roomId: safeRoomId,
    };
  }

  return {
    channelName,
    leave,
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
