import { describe, expect, it } from 'vitest';
import {
  allFrames,
  assetManifest,
  mouthFromLevel,
  sheetForPose,
  targetToCell,
} from './character';

describe('character domain', () => {
  it('generates all six 5x5 sheets for talk mode', () => {
    expect(allFrames()).toHaveLength(150);
    expect(assetManifest()).toHaveLength(6);
    expect(assetManifest().every((item) => item.frameCount === 25)).toBe(true);
  });

  it('maps smoothed pointer targets to the original 25 direction grid', () => {
    expect(targetToCell({ x: -1, y: -1 })).toEqual({ row: 0, col: 0 });
    expect(targetToCell({ x: 0, y: 0 })).toEqual({ row: 2, col: 2 });
    expect(targetToCell({ x: 1, y: 1 })).toEqual({ row: 4, col: 4 });
  });

  it('keeps the original six pose sheet model', () => {
    expect(sheetForPose({ blink: false, mouth: 0 })).toBe('A');
    expect(sheetForPose({ blink: false, mouth: 1 })).toBe('B');
    expect(sheetForPose({ blink: false, mouth: 2 })).toBe('C');
    expect(sheetForPose({ blink: true, mouth: 0 })).toBe('D');
    expect(sheetForPose({ blink: true, mouth: 1 })).toBe('E');
    expect(sheetForPose({ blink: true, mouth: 2 })).toBe('F');
  });

  it('uses the original half/open mouth thresholds', () => {
    const tuning = { thresholdHalf: 0.07, thresholdFull: 0.2 };
    expect(mouthFromLevel(0.01, tuning)).toBe(0);
    expect(mouthFromLevel(0.071, tuning)).toBe(1);
    expect(mouthFromLevel(0.21, tuning)).toBe(2);
  });
});
