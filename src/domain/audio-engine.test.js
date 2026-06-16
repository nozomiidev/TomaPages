import { describe, expect, it } from 'vitest';
import { demoEnvelope, rmsLevel, smoothAudioEnvelope } from './audio-engine';
import { mouthFromLevel } from './character';

function simulateDemoMouthStates({
  duration = 4.9,
  micGain = 1.6,
  release = 0.12,
  step = 1 / 60,
  thresholdFull = 0.2,
  thresholdHalf = 0.07,
} = {}) {
  let envelope = 0;
  const states = [];

  for (let elapsed = 0; elapsed <= duration; elapsed += step) {
    const raw = demoEnvelope(elapsed) * micGain;
    envelope = smoothAudioEnvelope(envelope, raw, { release });
    states.push(mouthFromLevel(envelope, { thresholdFull, thresholdHalf }));
  }

  return states;
}

describe('audio engine domain', () => {
  it('computes RMS from AnalyserNode time-domain samples', () => {
    const analyser = {
      fftSize: 4,
      getFloatTimeDomainData(buffer) {
        buffer.set([0, 0.5, -0.5, 1]);
      },
    };
    const bufferRef = { current: null };

    expect(rmsLevel(analyser, bufferRef)).toBeCloseTo(Math.sqrt(1.5 / 4), 5);
    expect(bufferRef.current).toBeInstanceOf(Float32Array);
    expect(bufferRef.current).toHaveLength(4);
  });

  it('smooths attacks faster than releases for readable lip sync', () => {
    const attack = smoothAudioEnvelope(0.1, 0.5, { release: 0.12 });
    const release = smoothAudioEnvelope(0.5, 0.1, { release: 0.12 });

    expect(attack).toBeCloseTo(0.34, 5);
    expect(release).toBeCloseTo(0.452, 5);
  });

  it('keeps the built-in sync test crossing closed, half, and open mouth states', () => {
    const states = simulateDemoMouthStates();

    expect(states).toContain(0);
    expect(states).toContain(1);
    expect(states).toContain(2);
    expect(states.at(-1)).toBe(0);
  });
});
