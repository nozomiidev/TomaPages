import { clamp } from '../lib/math';
import { demoEnvelope, smoothAudioEnvelope } from './audio-engine';
import { mouthFromLevel } from './character';

const BUILT_IN_SYNC_TEST = 'Built-in sync test';
const DEFAULT_MOUTH_LABELS = ['Closed', 'Half open', 'Open'];
const DEFAULT_SYNC_AUDIT_DURATION = 4.9;
const DEFAULT_SYNC_AUDIT_STEP = 1 / 60;

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

export function makeBuiltInSyncAudit({
  duration = DEFAULT_SYNC_AUDIT_DURATION,
  micGain = 1.6,
  release = 0.12,
  step = DEFAULT_SYNC_AUDIT_STEP,
  thresholdFull = 0.2,
  thresholdHalf = 0.07,
} = {}) {
  const counts = [0, 0, 0];
  const safeStep = Math.max(1 / 240, Number(step) || DEFAULT_SYNC_AUDIT_STEP);
  const safeDuration = Math.max(safeStep, Number(duration) || DEFAULT_SYNC_AUDIT_DURATION);
  let envelope = 0;
  let lastMouth = 0;
  let peakLevel = 0;
  let previousMouth = null;
  let sampleCount = 0;
  let transitions = 0;

  for (let elapsed = 0; elapsed <= safeDuration; elapsed += safeStep) {
    const raw = demoEnvelope(elapsed) * micGain;
    envelope = smoothAudioEnvelope(envelope, raw, { release });
    const mouth = mouthFromLevel(envelope, { thresholdFull, thresholdHalf });

    counts[mouth] += 1;
    peakLevel = Math.max(peakLevel, envelope);
    if (previousMouth !== null && previousMouth !== mouth) transitions += 1;
    previousMouth = mouth;
    lastMouth = mouth;
    sampleCount += 1;
  }

  const status = counts[0] > 0
    && counts[1] > 0
    && counts[2] > 0
    && transitions >= 8
    && lastMouth === 0
    ? 'pass'
    : 'fail';

  return {
    status,
    sampleCount,
    transitions,
    closedFrames: counts[0],
    halfFrames: counts[1],
    openFrames: counts[2],
    lastMouth: String(lastMouth),
    peakLevel: peakLevel.toFixed(3),
    coverage: `closed:${counts[0]},half:${counts[1]},open:${counts[2]}`,
  };
}
