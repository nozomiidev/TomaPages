function safeCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

function readyRatio(ready, total) {
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, ready / total));
}

export function makeRoomSessionStatus({
  agentBridgeStatus = 'starting',
  presenceSummary = {},
  roomActivity = {},
  snapshotHealth = {},
  transportStatus = {},
} = {}) {
  const total = safeCount(presenceSummary.total);
  const live = safeCount(presenceSummary.live);
  const p2p = safeCount(presenceSummary.p2p);
  const tab = safeCount(presenceSummary.tab);
  const agent = safeCount(presenceSummary.agent);
  const speaking = safeCount(presenceSummary.speaking);
  const snapshotReady = safeCount(snapshotHealth.ready);
  const snapshotFailed = safeCount(snapshotHealth.failed);
  const snapshotTotal = Math.max(total, snapshotReady + snapshotFailed);
  const snapshotRatio = readyRatio(snapshotReady, snapshotTotal);
  const p2pState = String(transportStatus.p2p || 'starting');
  const agentState = String(agentBridgeStatus || 'starting');
  const hasRemoteMesh = live > 1 || p2p > 0 || tab > 0;
  const state = hasRemoteMesh || agent > 0
    ? 'live'
    : p2pState === 'connected'
      ? 'armed'
      : 'solo';

  return {
    agentLabel: agent > 0 ? `${agent} agent${agent === 1 ? '' : 's'}` : `Agent ${agentState}`,
    meshLabel: p2p > 0 ? `${p2p} P2P` : tab > 0 ? `${tab} tab` : p2pState,
    snapshotHealth: snapshotFailed > 0
      ? `${snapshotReady}/${snapshotTotal} ready, ${snapshotFailed} failed`
      : `${snapshotReady}/${snapshotTotal} ready`,
    snapshotRatio,
    speakingLabel: roomActivity.speakingLabel || (speaking > 0 ? `${speaking} speaking` : 'Quiet'),
    state,
    stateLabel: state === 'live' ? 'Live mesh' : state === 'armed' ? 'Ready mesh' : 'Solo room',
  };
}
