const SPEAKING_THRESHOLD = 0.2;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function encodePeerToken(value) {
  return encodeURIComponent(String(value || 'peer')).replace(/%20/g, '+');
}

function displayNameForPeer(peer = {}) {
  return String(peer.name || peer.id || 'Peer').trim() || 'Peer';
}

function summarizeNamedPeers(peers = [], { limit = 2 } = {}) {
  if (!peers.length) {
    return {
      count: 0,
      label: '0',
      names: '',
    };
  }

  const names = peers.map(displayNameForPeer);
  const visibleNames = names.slice(0, limit);
  const remaining = names.length - visibleNames.length;

  return {
    count: names.length,
    label: remaining > 0
      ? `${visibleNames.join(', ')} +${remaining}`
      : visibleNames.join(', '),
    names: names.join(', '),
  };
}

export function formatRoomPeerCell(cell = {}) {
  const row = clamp(Math.round(normalizeNumber(cell.row, 2)), 0, 4);
  const col = clamp(Math.round(normalizeNumber(cell.col, 2)), 0, 4);
  return `${row}:${col}`;
}

export function normalizeRoomPeerState(peer = {}) {
  const audioLevel = clamp(normalizeNumber(peer.audioLevel, 0), 0, 1);

  return {
    audioLevel: audioLevel.toFixed(3),
    audioPercent: String(Math.round(audioLevel * 100)),
    cell: formatRoomPeerCell(peer.cell),
    id: String(peer.id || 'peer'),
    mouth: String(clamp(Math.round(normalizeNumber(peer.mouth, 0)), 0, 2)),
    source: String(peer.source || 'peer'),
    speaking: audioLevel > SPEAKING_THRESHOLD,
  };
}

export function summarizeRoomPeerStates(peers = []) {
  const states = peers.map(normalizeRoomPeerState);

  return {
    ids: states.map((peer) => encodePeerToken(peer.id)).join(' '),
    openMouthIds: states
      .filter((peer) => peer.mouth === '2')
      .map((peer) => encodePeerToken(peer.id))
      .join(' '),
    speakingIds: states
      .filter((peer) => peer.speaking)
      .map((peer) => encodePeerToken(peer.id))
      .join(' '),
    states: states
      .map((peer) => [
        encodePeerToken(peer.id),
        peer.source,
        peer.cell,
        `m${peer.mouth}`,
        `a${peer.audioPercent}`,
      ].join(','))
      .join('|'),
  };
}

export function summarizeRoomActivity(peers = []) {
  const speakingPeers = peers.filter((peer) => normalizeRoomPeerState(peer).speaking);
  const openMouthPeers = peers.filter((peer) => normalizeRoomPeerState(peer).mouth === '2');
  const speaking = summarizeNamedPeers(speakingPeers);
  const openMouth = summarizeNamedPeers(openMouthPeers);

  return {
    openMouthCount: openMouth.count,
    openMouthLabel: openMouth.label,
    openMouthNames: openMouth.names,
    speakingCount: speaking.count,
    speakingLabel: speaking.label,
    speakingNames: speaking.names,
  };
}

export function summarizeRoomPresence(peers = []) {
  return peers.reduce((summary, peer) => {
    const source = peer?.source || 'peer';
    const isDemo = source === 'demo';
    const isAgent = source === 'agent';
    const isSpeaking = normalizeRoomPeerState(peer).speaking;

    summary.total += 1;
    if (isDemo) summary.demo += 1;
    else summary.live += 1;
    if (isAgent) summary.agent += 1;
    if (source === 'p2p') summary.p2p += 1;
    if (source === 'tab') summary.tab += 1;
    if (source === 'local') summary.local += 1;
    if (isSpeaking) summary.speaking += 1;

    return summary;
  }, {
    agent: 0,
    demo: 0,
    live: 0,
    local: 0,
    p2p: 0,
    speaking: 0,
    tab: 0,
    total: 0,
  });
}

export function getPeerFreshness(peer = {}, { now = Date.now(), staleMs = 12000 } = {}) {
  const source = peer.source || 'peer';
  if (source === 'local') return { label: 'you', state: 'local' };
  if (source === 'demo') return { label: 'sim', state: 'static' };

  const seenAt = Number(peer.receivedAt ?? peer.lastSeen);
  if (!Number.isFinite(seenAt)) return { label: 'live', state: 'unknown' };

  const ageMs = Math.max(0, now - seenAt);
  const label = ageMs < 4000
    ? 'now'
    : ageMs < 60000
      ? `${Math.round(ageMs / 1000)}s`
      : `${Math.round(ageMs / 60000)}m`;

  return {
    label,
    state: ageMs > staleMs ? 'stale' : 'fresh',
  };
}
