import {
  characterForId,
  poseVariantForCharacter,
  videoFiltersForCharacter,
} from './character';

export const VIDEO_PROJECT_SCHEMA_VERSION = 1;
export const VIDEO_PROJECT_AUTOSAVE_KEY = 'tomari-studio-video-project-v1';
export const VIDEO_PROJECT_AUTOSAVE_MAX_CHARS = 1_500_000;
export const VIDEO_PROJECT_DURATION_RANGE = {
  max: 30,
  min: 4,
};

export const VIDEO_BACKGROUNDS = [
  { id: 'light', label: 'Light', type: 'solid', value: '#F5F2EC' },
  { id: 'dark', label: 'Dark', type: 'solid', value: '#13151A' },
  { id: 'warm', label: 'Warm', type: 'gradient', value: 'linear-gradient(180deg,#FFF7EA 0%,#F4C2C2 56%, #EEE3FF 100%)' },
  { id: 'cold', label: 'Cold', type: 'gradient', value: 'linear-gradient(180deg,#E8F2FF 0%,#DCEBFF 55%, #D6E5F7 100%)' },
  { id: 'paper', label: 'Paper', type: 'solid', value: '#fffaf4' },
  { id: 'custom', label: 'Custom', type: 'image', value: '' },
];

export const VIDEO_TRACK_EFFECTS = [
  { id: 'none', label: 'None', description: 'No deformation.' },
  { id: 'bounce', label: 'Bounce', description: 'Small lift/drop motion.' },
  { id: 'float', label: 'Float', description: 'Gentle up-down rhythm.' },
  { id: 'wobble', label: 'Wobble', description: 'Slight jittering.' },
  { id: 'pulse', label: 'Pulse', description: 'Subtle scale breathing.' },
  { id: 'sway', label: 'Sway', description: 'Slow side-to-side drift.' },
  { id: 'shake', label: 'Shake', description: 'Quick subtle micro movement.' },
];

export const VIDEO_TRANSITIONS = [
  { id: 'none', label: 'None', description: 'Instant pose handoff.' },
  { id: 'fade', label: 'Fade', description: 'Cross-fade between nearby pins.' },
  { id: 'slide', label: 'Slide', description: 'Tiny drift at pin boundary.' },
  { id: 'zoom', label: 'Zoom', description: 'Scale pop through the transition.' },
  { id: 'reveal', label: 'Reveal', description: 'Reveal through horizontal wipe.' },
  { id: 'spin', label: 'Spin', description: 'Rotate briefly at transition boundaries.' },
];

function makePortableId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);
  return `${prefix}-${uuid}`;
}

function isKnownId(options, candidate) {
  return options.some((item) => item.id === candidate);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeRotation(value) {
  return ((Number(value) + 180) % 360 + 360) % 360 - 180;
}

function normalizeText(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function normalizePose(character, poseVariant) {
  if (!character.poseVariants?.length) return '';
  return poseVariantForCharacter(character, poseVariant)?.id
    ?? character.defaultPoseVariant
    ?? character.poseVariants[0].id;
}

function normalizeFilter(character, filterPreset) {
  const filters = videoFiltersForCharacter(character);
  return filters.some((filter) => filter.id === filterPreset)
    ? filterPreset
    : filters[0]?.id ?? 'none';
}

function normalizeEffect(effect) {
  return isKnownId(VIDEO_TRACK_EFFECTS, effect) ? effect : 'none';
}

function normalizeTransition(transition) {
  return isKnownId(VIDEO_TRANSITIONS, transition) ? transition : 'fade';
}

function normalizeKeyframe(keyframe, fallback, duration, character) {
  const poseVariant = normalizePose(character, keyframe?.poseVariant ?? fallback.poseVariant);
  const filterPreset = normalizeFilter(character, keyframe?.filterPreset ?? fallback.filterPreset);

  return {
    id: normalizeText(keyframe?.id, makePortableId('key')),
    time: clampNumber(keyframe?.time, 0, duration, fallback.time ?? 0),
    x: clampNumber(keyframe?.x, 0, 1, fallback.x),
    y: clampNumber(keyframe?.y, 0, 1.02, fallback.y),
    scale: clampNumber(keyframe?.scale, 0.2, 1.6, fallback.scale),
    facing: normalizeRotation(keyframe?.facing ?? fallback.facing ?? 0),
    rotation: clampNumber(keyframe?.rotation, -180, 180, fallback.rotation),
    pitch: clampNumber(keyframe?.pitch, -60, 60, fallback.pitch),
    poseVariant,
    filterPreset,
    effect: normalizeEffect(keyframe?.effect ?? fallback.effect),
    transition: normalizeTransition(keyframe?.transition ?? fallback.transition),
    visible: keyframe?.visible === undefined ? fallback.visible : keyframe.visible !== false,
  };
}

export function normalizeVideoTrack(track, { duration, index = 0 } = {}) {
  const character = characterForId(track?.characterId ?? 'reimu');
  const poseVariant = normalizePose(character, track?.poseVariant);
  const filterPreset = normalizeFilter(character, track?.filterPreset);
  const fallback = {
    effect: normalizeEffect(track?.effect),
    facing: normalizeRotation(track?.facing ?? 0),
    filterPreset,
    pitch: clampNumber(track?.pitch, -60, 60, 0),
    poseVariant,
    rotation: clampNumber(track?.rotation, -180, 180, 0),
    scale: clampNumber(track?.scale, 0.2, 1.6, 0.7),
    time: 0,
    transition: normalizeTransition(track?.transition),
    visible: track?.visible !== false,
    x: clampNumber(track?.x, 0, 1, 0.36 + index * 0.14),
    y: clampNumber(track?.y, 0, 1.02, 0.62),
  };
  const normalizedDuration = clampNumber(
    duration,
    VIDEO_PROJECT_DURATION_RANGE.min,
    VIDEO_PROJECT_DURATION_RANGE.max,
    12,
  );
  const sourceKeyframes = Array.isArray(track?.keyframes) ? track.keyframes : [];
  const keyframes = sourceKeyframes.length
    ? sourceKeyframes.map((keyframe) => normalizeKeyframe(keyframe, fallback, normalizedDuration, character))
    : [normalizeKeyframe({ time: 0 }, fallback, normalizedDuration, character)];

  const uniqueKeyframes = new Map();
  for (const keyframe of keyframes) {
    uniqueKeyframes.set(keyframe.time.toFixed(4), keyframe);
  }

  return {
    id: normalizeText(track?.id, makePortableId('track')),
    characterId: character.id,
    poseVariant,
    x: fallback.x,
    y: fallback.y,
    scale: fallback.scale,
    facing: fallback.facing,
    rotation: fallback.rotation,
    pitch: fallback.pitch,
    filterPreset,
    visible: fallback.visible,
    effect: fallback.effect,
    transition: fallback.transition,
    z: clampNumber(track?.z, -999, 999, index),
    keyframes: [...uniqueKeyframes.values()].sort((left, right) => left.time - right.time),
  };
}

export function normalizeVideoProject(project = {}) {
  const videoDuration = clampNumber(
    project.videoDuration ?? project.duration,
    VIDEO_PROJECT_DURATION_RANGE.min,
    VIDEO_PROJECT_DURATION_RANGE.max,
    12,
  );
  const backgroundKind = isKnownId(VIDEO_BACKGROUNDS, project.backgroundKind)
    ? project.backgroundKind
    : 'light';
  const tracks = Array.isArray(project.tracks) && project.tracks.length
    ? project.tracks.map((track, index) => normalizeVideoTrack(track, { duration: videoDuration, index }))
    : [
      normalizeVideoTrack({ characterId: 'reimu', x: 0.36, y: 0.62, z: 0 }, { duration: videoDuration, index: 0 }),
      normalizeVideoTrack({ characterId: 'cirno', x: 0.62, y: 0.65, z: 1 }, { duration: videoDuration, index: 1 }),
    ];

  return {
    schema: 'tomari-studio-video',
    version: VIDEO_PROJECT_SCHEMA_VERSION,
    videoDuration,
    currentTime: clampNumber(project.currentTime, 0, videoDuration, 0),
    backgroundKind,
    backgroundImage: typeof project.backgroundImage === 'string' ? project.backgroundImage : '',
    tracks: tracks.map((track, index) => ({ ...track, z: index })),
  };
}

export function serializeVideoProject(project) {
  return `${JSON.stringify(normalizeVideoProject(project), null, 2)}\n`;
}

export function parseVideoProject(source) {
  const parsed = JSON.parse(source);
  return normalizeVideoProject(parsed);
}

export function loadVideoProjectDraft(storage = globalThis.localStorage) {
  try {
    const source = storage?.getItem?.(VIDEO_PROJECT_AUTOSAVE_KEY);
    return source ? parseVideoProject(source) : null;
  } catch {
    return null;
  }
}

export function saveVideoProjectDraft(
  project,
  storage = globalThis.localStorage,
  maxChars = VIDEO_PROJECT_AUTOSAVE_MAX_CHARS,
) {
  try {
    const source = serializeVideoProject(project);
    if (source.length > maxChars) {
      return { ok: false, reason: 'too-large', size: source.length };
    }

    storage?.setItem?.(VIDEO_PROJECT_AUTOSAVE_KEY, source);
    return { ok: true, reason: 'saved', size: source.length };
  } catch {
    return { ok: false, reason: 'unavailable', size: 0 };
  }
}
