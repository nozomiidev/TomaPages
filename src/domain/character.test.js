import { describe, expect, it } from 'vitest';
import {
  allFrames,
  assetManifest,
  avatarFrameDisplayKey,
  avatarFrameKey,
  avatarFrameRenderQueue,
  CHARACTER_OPTIONS,
  characterForId,
  frameSrc,
  videoFiltersForCharacter,
  mouthFromLevel,
  poseVariantForCharacter,
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

  it('registers the Reimu plush character as WebP frames', () => {
    expect(CHARACTER_OPTIONS.map((character) => character.id)).toEqual(['tomari', 'reimu', 'cirno']);
    expect(allFrames({ characterId: 'reimu' })).toHaveLength(225);
    expect(assetManifest('reimu')).toHaveLength(9);
    expect(assetManifest('reimu').every((item) => item.frameCount === 25)).toBe(true);
    expect(frameSrc('pl_01', 2, 2, 'reimu')).toContain('characters/reimu/pl_01/r2c2.webp');
    expect(frameSrc('py_01', 0, 4, 'reimu')).toContain('characters/reimu/py_01/r0c4.webp');
  });

  it('renders the active Reimu frame first before preloading pose frames', () => {
    const frames = allFrames({ characterId: 'reimu' });
    const active = { activeSheet: 'py_01', col: 4, row: 4 };
    const initialQueue = avatarFrameRenderQueue({
      ...active,
      frames,
      preloadRemainingFrames: false,
    });
    const preloadQueue = avatarFrameRenderQueue({
      ...active,
      frames,
      preloadRemainingFrames: true,
    });

    expect(initialQueue).toEqual([
      expect.objectContaining({
        sheet: 'py_01',
        row: 4,
        col: 4,
        src: expect.stringContaining('characters/reimu/py_01/r4c4.webp'),
      }),
    ]);
    expect(preloadQueue).toHaveLength(225);
    expect(preloadQueue[0]).toMatchObject({ sheet: 'py_01', row: 4, col: 4 });
    expect(new Set(preloadQueue.map((frame) => frame.src)).size).toBe(225);
  });

  it('keeps a loaded fallback frame visible until a new active pose frame is loaded', () => {
    const previousKey = avatarFrameKey({
      characterId: 'reimu',
      sheet: 'pl_01',
      row: 2,
      col: 2,
    });
    const nextKey = avatarFrameKey({
      characterId: 'reimu',
      sheet: 'py_01',
      row: 4,
      col: 4,
    });

    expect(avatarFrameDisplayKey({
      activeFrameKey: nextKey,
      fallbackFrameKey: previousKey,
      loadedFrameKeys: [previousKey],
    })).toBe(previousKey);
    expect(avatarFrameDisplayKey({
      activeFrameKey: nextKey,
      fallbackFrameKey: previousKey,
      loadedFrameKeys: [previousKey, nextKey],
    })).toBe(nextKey);
  });

  it('maps Reimu talk, blink, and arm pose variants onto the plush sheet set', () => {
    const reimu = characterForId('reimu');
    expect(poseVariantForCharacter(reimu, 'missing')).toMatchObject({ id: 'plain', label: 'Plain' });
    expect(sheetForPose({ blink: false, characterId: 'reimu', mouth: 0 })).toBe('pl_01');
    expect(sheetForPose({ blink: false, characterId: 'reimu', mouth: 1 })).toBe('om_01');
    expect(sheetForPose({ blink: false, characterId: 'reimu', mouth: 2 })).toBe('om_01');
    expect(sheetForPose({ blink: true, characterId: 'reimu', mouth: 0 })).toBe('ce_01');
    expect(sheetForPose({ blink: true, characterId: 'reimu', mouth: 2 })).toBe('ce_01');
    expect(sheetForPose({
      blink: false,
      characterId: 'reimu',
      mouth: 0,
      poseVariant: 't',
    })).toBe('pt_01');
    expect(sheetForPose({
      blink: false,
      characterId: 'reimu',
      mouth: 2,
      poseVariant: 'y',
    })).toBe('oy_01');
    expect(sheetForPose({
      blink: true,
      characterId: 'reimu',
      mouth: 0,
      poseVariant: 'y',
    })).toBe('cy_01');
  });

  it('registers the Cirno plush character as multiple pose sets', () => {
    expect(allFrames({ characterId: 'cirno' })).toHaveLength(300);
    expect(assetManifest('cirno')).toHaveLength(12);
    expect(assetManifest('cirno').every((item) => item.frameCount === 25)).toBe(true);
    expect(frameSrc('pl_01', 1, 1, 'cirno')).toContain('characters/cirno/pl_01/r1c1.webp');
    expect(sheetForPose({
      blink: false,
      characterId: 'cirno',
      mouth: 0,
      poseVariant: '2',
    })).toBe('pl_02');
    expect(sheetForPose({
      blink: false,
      characterId: 'cirno',
      mouth: 1,
      poseVariant: '3',
    })).toBe('om_03');
    expect(sheetForPose({
      blink: true,
      characterId: 'cirno',
      mouth: 0,
      poseVariant: '4',
    })).toBe('ce_04');
    expect(poseVariantForCharacter(characterForId('cirno'), '2')).toMatchObject({ id: '2' });
  });

  it('provides per-character video filter presets for plush characters', () => {
    const reimuFilters = videoFiltersForCharacter('reimu');
    const cirnoFilters = videoFiltersForCharacter('cirno');
    expect(reimuFilters.length).toBeGreaterThan(cirnoFilters.length - 1);
    expect(reimuFilters.map((item) => item.id)).toContain('vivid');
    expect(cirnoFilters.map((item) => item.id)).toContain('icy');
  });

  it('uses the original half/open mouth thresholds', () => {
    const tuning = { thresholdHalf: 0.07, thresholdFull: 0.2 };
    expect(mouthFromLevel(0.01, tuning)).toBe(0);
    expect(mouthFromLevel(0.071, tuning)).toBe(1);
    expect(mouthFromLevel(0.21, tuning)).toBe(2);
  });
});
