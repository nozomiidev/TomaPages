import { clamp } from '../lib/math';

const BUILT_IN_SYNC_TEST = 'Built-in sync test';
const DEFAULT_MOUTH_LABELS = ['Closed', 'Half open', 'Open'];

function safeMouthId(mouth) {
  const numeric = Number(mouth);
  if (!Number.isFinite(numeric)) return 0;
  return clamp(Math.round(numeric), 0, 2);
}

export function classifyLipSyncSource({ fileName = '', micOn = false } = {}) {
  if (micOn) return 'mic';
  if (fileName === BUILT_IN_SYNC_TEST) return 'demo';
  if (fileName) return 'file';
  return 'idle';
}

export function lipSyncMode(mode) {
  if (mode === 'talk' || mode === 'room') return mode;
  return 'off';
}

export function makeLipSyncSnapshot({
  activeMouth,
  audioLevel = 0,
  fileName = '',
  micOn = false,
  mode = 'talk',
  mouth = 0,
} = {}) {
  const level = clamp(Number(audioLevel) || 0, 0, 1);
  const mouthId = safeMouthId(mouth);

  return {
    level: level.toFixed(3),
    levelPercent: String(Math.round(level * 100)),
    mode: lipSyncMode(mode),
    mouth: String(mouthId),
    mouthLabel: activeMouth?.label ?? DEFAULT_MOUTH_LABELS[mouthId],
    source: classifyLipSyncSource({ fileName, micOn }),
  };
}
