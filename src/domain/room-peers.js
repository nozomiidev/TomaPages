export function readDemoPeerPreference(search = '') {
  const params = new URLSearchParams(search);
  const value = String(params.get('demo') ?? '').trim().toLowerCase();

  if (['1', 'on', 'show', 'true', 'yes'].includes(value)) return 'show';
  if (['0', 'hide', 'false', 'no', 'off'].includes(value)) return 'hide';
  return 'auto';
}

export function shouldIncludeDemoPeers({ agentCount = 0, preference = 'auto', remoteCount = 0 } = {}) {
  if (preference === 'show') return true;
  if (preference === 'hide') return false;
  return agentCount + remoteCount === 0;
}
