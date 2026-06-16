export function summarizeRoomPresence(peers = []) {
  return peers.reduce((summary, peer) => {
    const source = peer?.source || 'peer';
    const isDemo = source === 'demo';
    const isAgent = source === 'agent';
    const isSpeaking = Number(peer?.audioLevel) > 0.2;

    summary.total += 1;
    if (isDemo) summary.demo += 1;
    else summary.live += 1;
    if (isAgent) summary.agent += 1;
    if (source === 'p2p') summary.p2p += 1;
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
