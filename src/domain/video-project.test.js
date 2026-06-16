import { describe, expect, it } from 'vitest';
import {
  loadVideoProjectDraft,
  normalizeVideoProject,
  parseVideoProject,
  saveVideoProjectDraft,
  serializeVideoProject,
  VIDEO_PROJECT_AUTOSAVE_KEY,
  VIDEO_PROJECT_SCHEMA_VERSION,
} from './video-project';

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
}

describe('video project persistence', () => {
  it('serializes portable vertical-video project data', () => {
    const json = serializeVideoProject({
      backgroundKind: 'custom',
      backgroundImage: 'data:image/png;base64,abc',
      currentTime: 3.25,
      videoDuration: 14,
      tracks: [
        {
          id: 'track-reimu',
          characterId: 'reimu',
          poseVariant: 'y',
          filterPreset: 'vivid',
          effect: 'bounce',
          transition: 'spin',
          x: 0.42,
          y: 0.7,
          scale: 0.81,
          facing: 91,
          rotation: -12,
          pitch: 6,
          keyframes: [
            {
              id: 'key-1',
              time: 2,
              poseVariant: 't',
              filterPreset: 'vivid',
              effect: 'sway',
              transition: 'zoom',
              x: 0.5,
              y: 0.64,
              scale: 0.92,
              facing: -45,
              rotation: 4,
              pitch: 0,
            },
          ],
        },
      ],
    });

    const project = JSON.parse(json);
    expect(project).toMatchObject({
      schema: 'tomari-studio-video',
      version: VIDEO_PROJECT_SCHEMA_VERSION,
      backgroundKind: 'custom',
      videoDuration: 14,
      tracks: [
        {
          characterId: 'reimu',
          poseVariant: 'y',
          keyframes: [{ poseVariant: 't', transition: 'zoom' }],
        },
      ],
    });
  });

  it('normalizes invalid imported values into safe editor state', () => {
    const project = normalizeVideoProject({
      backgroundKind: 'missing',
      currentTime: 99,
      videoDuration: 99,
      tracks: [
        {
          characterId: 'cirno',
          poseVariant: 'missing',
          filterPreset: 'vivid',
          effect: 'unknown',
          transition: 'unknown',
          x: -4,
          y: 9,
          scale: 99,
          facing: 540,
          rotation: -999,
          pitch: 999,
          keyframes: [
            { time: 500, x: 2, y: -1, scale: 0.01 },
            { time: 500, x: 0.4, y: 0.5, scale: 0.6 },
          ],
        },
      ],
    });

    expect(project.backgroundKind).toBe('light');
    expect(project.videoDuration).toBe(30);
    expect(project.currentTime).toBe(30);
    expect(project.tracks).toHaveLength(1);
    expect(project.tracks[0]).toMatchObject({
      characterId: 'cirno',
      poseVariant: '1',
      filterPreset: 'none',
      effect: 'none',
      transition: 'fade',
      x: 0,
      y: 1.02,
      scale: 1.6,
      rotation: -180,
      pitch: 60,
    });
    expect(project.tracks[0].keyframes).toHaveLength(1);
    expect(project.tracks[0].keyframes[0]).toMatchObject({
      time: 30,
      x: 0.4,
      y: 0.5,
      scale: 0.6,
      poseVariant: '1',
      filterPreset: 'none',
    });
  });

  it('parses a saved project roundtrip', () => {
    const source = serializeVideoProject({
      backgroundKind: 'dark',
      currentTime: 1,
      videoDuration: 8,
      tracks: [
        { id: 'a', characterId: 'reimu', poseVariant: 'plain', x: 0.2, y: 0.7 },
        { id: 'b', characterId: 'cirno', poseVariant: '3', x: 0.75, y: 0.72 },
      ],
    });

    const parsed = parseVideoProject(source);
    expect(parsed.backgroundKind).toBe('dark');
    expect(parsed.videoDuration).toBe(8);
    expect(parsed.tracks.map((track) => track.characterId)).toEqual(['reimu', 'cirno']);
    expect(parsed.tracks.map((track) => track.z)).toEqual([0, 1]);
  });

  it('stores and restores local video project drafts through the same schema', () => {
    const storage = makeStorage();
    const saved = saveVideoProjectDraft({
      backgroundKind: 'paper',
      currentTime: 2,
      videoDuration: 9,
      tracks: [
        { id: 'draft-track', characterId: 'reimu', poseVariant: 'y', x: 0.3, y: 0.62 },
      ],
    }, storage);

    expect(saved).toMatchObject({ ok: true, reason: 'saved' });
    expect(storage.getItem(VIDEO_PROJECT_AUTOSAVE_KEY)).toContain('"schema": "tomari-studio-video"');
    expect(loadVideoProjectDraft(storage)).toMatchObject({
      backgroundKind: 'paper',
      currentTime: 2,
      tracks: [{ characterId: 'reimu', poseVariant: 'y' }],
    });
  });

  it('reports local draft storage failures without throwing', () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };

    expect(loadVideoProjectDraft(throwingStorage)).toBeNull();
    expect(saveVideoProjectDraft({ tracks: [] }, throwingStorage)).toMatchObject({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('refuses oversized local drafts so explicit JSON export remains the fallback', () => {
    const storage = makeStorage();
    const result = saveVideoProjectDraft({
      backgroundImage: 'x'.repeat(120),
      tracks: [{ characterId: 'reimu' }],
    }, storage, 80);

    expect(result).toMatchObject({ ok: false, reason: 'too-large' });
    expect(storage.getItem(VIDEO_PROJECT_AUTOSAVE_KEY)).toBeNull();
  });
});
