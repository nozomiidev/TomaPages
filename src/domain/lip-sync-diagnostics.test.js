import { describe, expect, it } from 'vitest';
import {
  classifyLipSyncSource,
  lipSyncMode,
  makeBuiltInSyncAudit,
  makeLipSyncSnapshot,
} from './lip-sync-diagnostics';

describe('lip sync diagnostics', () => {
  it('classifies the active audio source for browser verification', () => {
    expect(classifyLipSyncSource()).toBe('idle');
    expect(classifyLipSyncSource({ fileName: 'voice.wav' })).toBe('file');
    expect(classifyLipSyncSource({ fileName: 'Built-in sync test' })).toBe('demo');
    expect(classifyLipSyncSource({ fileName: 'voice.wav', micOn: true })).toBe('mic');
  });

  it('limits mode reporting to views that can drive mouth motion', () => {
    expect(lipSyncMode('talk')).toBe('talk');
    expect(lipSyncMode('room')).toBe('room');
    expect(lipSyncMode('gaze')).toBe('off');
    expect(lipSyncMode('assets')).toBe('off');
  });

  it('normalizes mouth and level values for stable data attributes', () => {
    expect(makeLipSyncSnapshot({
      activeMouth: { label: 'Open' },
      audioLevel: 1.4,
      fileName: 'Built-in sync test',
      mode: 'talk',
      mouth: 2,
    })).toEqual({
      level: '1.000',
      levelPercent: '100',
      mode: 'talk',
      mouth: '2',
      mouthLabel: 'Open',
      source: 'demo',
    });

    expect(makeLipSyncSnapshot({
      audioLevel: -0.5,
      mode: 'gaze',
      mouth: Number.NaN,
    })).toMatchObject({
      level: '0.000',
      levelPercent: '0',
      mode: 'off',
      mouth: '0',
      mouthLabel: 'Closed',
      source: 'idle',
    });
  });

  it('audits the built-in sync test for readable mouth coverage', () => {
    expect(makeBuiltInSyncAudit()).toEqual({
      status: 'pass',
      sampleCount: 295,
      transitions: 22,
      closedFrames: 72,
      halfFrames: 141,
      openFrames: 82,
      lastMouth: '0',
      peakLevel: '0.320',
      coverage: 'closed:72,half:141,open:82',
    });
  });

  it('fails the built-in sync audit when thresholds prevent open-mouth frames', () => {
    expect(makeBuiltInSyncAudit({
      thresholdFull: 0.95,
    })).toMatchObject({
      status: 'fail',
      openFrames: 0,
    });
  });
});
