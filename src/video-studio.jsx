import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  CircleDot,
  Download,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Upload,
  Scissors,
  SlidersHorizontal,
} from 'lucide-react';
import {
  CHARACTER_OPTIONS,
  characterForId,
  videoFiltersForCharacter,
  frameSrc,
  poseVariantForCharacter,
  sheetForPose,
} from './domain/character';
import {
  loadVideoProjectDraft,
  parseVideoProject,
  saveVideoProjectDraft,
  serializeVideoProject,
  VIDEO_BACKGROUNDS as BACKGROUNDS,
  VIDEO_TRACK_EFFECTS as TRACK_EFFECTS,
  VIDEO_TRANSITIONS as TRANSITIONS,
} from './domain/video-project';
import { useAnimationFrame } from './hooks/use-animation-frame';
import { clamp } from './lib/math';

const VIDEO_CANVAS_WIDTH = 1080;
const VIDEO_CANVAS_HEIGHT = 1920;
const FRAME_RATE = 30;
const DEFAULT_DURATION = 12;
const DRAG_EPSILON = 2;
const KEYFRAME_TIME_EPSILON = 0.0008;

const STAGE_DRAG_TOOLS = [
  { id: 'face', label: 'Face' },
  { id: 'move', label: 'Move' },
  { id: 'rotate', label: 'Rotate' },
];
const STAGE_DRAG_TOOL_HINTS = {
  face: 'Face mode: hold and trace around the character to change facing. Ctrl/Cmd moves; Alt rotates.',
  move: 'Move mode: hold and drag to reposition. Shift adds a key pin.',
  rotate: 'Rotate mode: hold and arc around the character to rotate the whole cutout.',
};

function resolvePoseShortcut(poses, key) {
  const normalized = String(key ?? '').toLowerCase().trim();

  if (!Array.isArray(poses) || poses.length === 0) return null;
  if (/^[1-9]$/.test(normalized)) {
    return poses[(Number(normalized) - 1) % poses.length] ?? null;
  }

  return poses.find((pose) => pose.shortcut === normalized || pose.id === normalized) ?? null;
}

function clampPercent(value, min, max) {
  return clamp(Number(value), min, max);
}

function normalizeRotation(value) {
  return ((Number(value) + 180) % 360 + 360) % 360 - 180;
}

function interpolateAngle(left, right, progress) {
  const delta = normalizeRotation(right - left);
  return normalizeRotation(left + delta * progress);
}

function makeId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);
  return `${prefix}-${uuid}`;
}

function makeTrackId() {
  return makeId('track');
}

function makeKeyframeId() {
  return makeId('key');
}

function isNearTime(left, right) {
  return Math.abs(Number(left) - Number(right)) <= KEYFRAME_TIME_EPSILON;
}

function findKeyframeIndex(keyframes, candidate) {
  if (candidate == null) return -1;
  if (typeof candidate === 'number') {
    return keyframes.findIndex((keyframe) => isNearTime(keyframe.time, candidate));
  }
  if (candidate.id) {
    const byId = keyframes.findIndex((keyframe) => keyframe.id === candidate.id);
    if (byId >= 0) return byId;
  }
  return keyframes.findIndex((keyframe) => isNearTime(keyframe.time, candidate.time));
}

function defaultPoseForCharacter(characterId) {
  const character = characterForId(characterId);
  return character.defaultPoseVariant ?? character.poseVariants?.[0]?.id ?? '';
}

function poseStretchXForTrack({ characterId = 'reimu', poseVariant = '' }) {
  if (characterId === 'reimu' && (poseVariant === 'y' || poseVariant === 't')) return 1;
  return 1;
}

function makeDefaultTrack(overrides = {}) {
  const characterId = overrides.characterId ?? 'reimu';
  const poseVariant = defaultPoseForCharacter(characterId);
  const character = characterForId(characterId);
  const defaultVideoFilter = videoFiltersForCharacter(character)?.[0]?.id ?? 'none';
  const x = clampPercent(overrides.x ?? (0.31 + Math.random() * 0.37), 0.1, 0.9);
  const y = clampPercent(overrides.y ?? (0.52 + Math.random() * 0.22), 0.28, 0.95);
  const scale = clampPercent(overrides.scale ?? (0.55 + Math.random() * 0.22), 0.28, 1.15);
  const rotation = clampPercent(overrides.rotation ?? (Math.random() * 20 - 10), -180, 180);
  const facing = normalizeRotation(overrides.facing ?? 0);
  const pitch = clampPercent(overrides.pitch ?? 0, -60, 60);

  return {
    id: makeTrackId(),
    characterId,
    poseVariant,
    x,
    y,
    scale,
    facing,
    rotation,
    pitch,
    filterPreset: defaultVideoFilter,
    visible: true,
    effect: 'none',
    transition: 'fade',
    z: overrides.z ?? 0,
    keyframes: [
      {
        id: makeKeyframeId(),
        time: 0,
        x,
        y,
        scale,
        facing,
        rotation,
        pitch,
        poseVariant,
        filterPreset: defaultVideoFilter,
        effect: 'none',
        transition: 'fade',
        visible: true,
      },
    ],
  };
}

function toSortedKeyframes(keyframes = []) {
  const normalized = keyframes.map((item) => ({
    ...item,
    time: clampPercent(item.time ?? 0, 0, Number.MAX_SAFE_INTEGER),
  }));
  const unique = new Map();

  for (const frame of normalized) {
    const key = frame.time.toFixed(4);
    unique.set(key, frame);
  }

  return [...unique.values()].sort((left, right) => left.time - right.time);
}

function mergeFrameState(frame, keyframe) {
  return {
    x: clampPercent(keyframe?.x ?? frame.x, 0, 1),
    y: clampPercent(keyframe?.y ?? frame.y, 0, 1.02),
    scale: clampPercent(keyframe?.scale ?? frame.scale, 0.2, 1.6),
    facing: normalizeRotation(keyframe?.facing ?? frame.facing ?? 0),
    rotation: Number(keyframe?.rotation ?? frame.rotation),
    pitch: Number(keyframe?.pitch ?? frame.pitch),
    poseVariant: keyframe?.poseVariant ?? frame.poseVariant,
    filterPreset: keyframe?.filterPreset ?? frame.filterPreset,
    effect: keyframe?.effect ?? frame.effect,
    transition: keyframe?.transition ?? frame.transition,
    visible: keyframe?.visible ?? frame.visible,
  };
}

function applyDefaultKeyframes(track, duration) {
  const fallback = {
    x: track.x,
    y: track.y,
    scale: track.scale,
    facing: track.facing ?? 0,
    rotation: track.rotation,
    pitch: track.pitch,
    filterPreset: track.filterPreset,
    poseVariant: track.poseVariant,
    effect: track.effect,
    transition: track.transition,
    visible: true,
    time: 0,
  };

  const sorted = toSortedKeyframes(track.keyframes ?? []);
  if (sorted.length === 0) return [{ ...fallback, time: 0 }];
  if (sorted[0].time > 0) sorted.unshift({ ...fallback, time: 0 });
  if (sorted.at(-1)?.time < duration) sorted.push({ ...fallback, time: duration });

  return sorted;
}

function interpolateTrack(track, time, duration) {
  const sorted = applyDefaultKeyframes(track, duration);
  const safeTime = clampPercent(time, 0, duration);
  let left = sorted[0];
  let right = sorted[sorted.length - 1];

  for (let index = 1; index < sorted.length; index += 1) {
    if (safeTime <= sorted[index].time) {
      left = sorted[index - 1];
      right = sorted[index];
      break;
    }
  }

  if (!left || !right || left.time === right.time) {
    return mergeFrameState(track, right ?? left);
  }

  const localT = (safeTime - left.time) / (right.time - left.time);
  const progress = clampPercent(localT, 0, 1);

  const nextTransition = right.transition ?? left.transition;
  const transitionBlend = localT;

  return {
    x: left.x + (right.x - left.x) * transitionBlend,
    y: left.y + (right.y - left.y) * transitionBlend,
    scale: left.scale + (right.scale - left.scale) * transitionBlend,
    facing: interpolateAngle(left.facing ?? 0, right.facing ?? 0, transitionBlend),
    rotation: left.rotation + (right.rotation - left.rotation) * transitionBlend,
    pitch: left.pitch + (right.pitch - left.pitch) * transitionBlend,
    poseVariant: progress > 0.5 ? right.poseVariant : left.poseVariant,
    filterPreset: progress > 0.5 ? right.filterPreset : left.filterPreset,
    effect: progress > 0.5 ? right.effect : left.effect,
    transition: nextTransition,
    visible: progress > 0.5 ? right.visible : left.visible,
  };
}

function mapAngleToCell(angle, pitch = 0) {
  const normalized = ((angle % 360) + 360) % 360;
  const columnStep = 72;
  const col = Math.round(normalized / columnStep) % 5;
  const row = clamp(Math.round(((-pitch / 60) * 2) + 2), 0, 4);
  return { row, col };
}

function resolvePosePose(track, angle) {
  const character = characterForId(track.characterId);
  const variant = poseVariantForCharacter(character, track.poseVariant);
  const key = sheetForPose({
    blink: false,
    characterId: track.characterId,
    mouth: 0,
    poseVariant: variant?.id,
  });
  const direction = mapAngleToCell(angle, track.pitch ?? 0);
  const row = clamp(direction.row, 0, 4);
  const col = clamp(direction.col, 0, 4);
  return {
    key,
    src: frameSrc(key, row, col, track.characterId),
    row,
    col,
  };
}

function resolveTransitionState(track, safeTime, transitionLength = 0.42) {
  const sorted = toSortedKeyframes(track.keyframes ?? []);
  if (sorted.length <= 1) {
    return { alpha: 1, driftX: 0, driftY: 0, zoom: 1, rotationOffset: 0, transitionProgress: 0 };
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (safeTime < previous.time || safeTime > current.time || current.time <= previous.time) continue;

    const raw = (safeTime - previous.time) / (current.time - previous.time);
    if (raw > transitionLength) continue;

    const transition = current.transition ?? previous.transition;
    const progress = clamp(raw / transitionLength, 0, 1);

    if (transition === 'fade') {
      return {
        alpha: clamp(0.2 + progress * 0.8, 0.2, 1),
        driftX: 0,
        driftY: 0,
        zoom: 1,
        rotationOffset: 0,
        transitionProgress: progress,
      };
    }

    if (transition === 'slide') {
      return {
        alpha: 1,
        driftX: (1 - progress) * 36,
        driftY: 0,
        zoom: 1,
        rotationOffset: 0,
        transitionProgress: progress,
      };
    }

    if (transition === 'zoom') {
      return {
        alpha: 1,
        driftX: 0,
        driftY: 0,
        zoom: 0.92 + 0.18 * progress,
        rotationOffset: 0,
        transitionProgress: progress,
      };
    }

    if (transition === 'reveal') {
      return {
        alpha: 1,
        driftX: 0,
        driftY: 0,
        zoom: 1,
        rotationOffset: 0,
        wipe: 1 - progress,
        transitionProgress: progress,
      };
    }

    if (transition === 'spin') {
      return {
        alpha: 1,
        driftX: 0,
        driftY: 0,
        zoom: 1 + progress * 0.05,
        rotationOffset: (progress - 0.5) * 26,
        transitionProgress: progress,
      };
    }
  }

  return {
    alpha: 1,
    driftX: 0,
    driftY: 0,
    zoom: 1,
    rotationOffset: 0,
    wipe: 0,
    transitionProgress: 0,
  };
}

function getCharacterFilterPreset(characterId, filterId) {
  return videoFiltersForCharacter(characterId).find((item) => item.id === filterId)?.filter;
}

function makeContextFilter({
  effect,
  filterPreset = 'none',
  characterId = 'reimu',
  transitionType,
  transitionProgress = 0,
  timeSeconds = 0,
}) {
  const filters = [];
  if (effect === 'float') {
    const blurAmount = Math.abs(0.16 * Math.sin(timeSeconds * 1.9));
    filters.push(`blur(${blurAmount.toFixed(3)}px)`);
  }

  if (effect === 'wobble') {
    const wobble = 1 + 0.06 * Math.sin(timeSeconds * 2.6);
    filters.push(`saturate(${wobble.toFixed(3)})`);
  }

  if (effect === 'sway') {
    const amount = 1 + 0.03 * Math.sin(timeSeconds * 1.4);
    filters.push(`saturate(${amount.toFixed(3)})`);
  }

  if (effect === 'shake') {
    const amount = Math.min(1.17, Math.max(0.9, 1 + 0.1 * Math.sin(timeSeconds * 32)));
    filters.push(`contrast(${amount.toFixed(3)})`);
  }

  const preset = getCharacterFilterPreset(characterId, filterPreset);
  if (preset) {
    filters.push(preset);
  }

  if (transitionType === 'fade' && transitionProgress < 1) {
    filters.push(`brightness(${Math.max(0.78, 0.28 + transitionProgress * 0.72).toFixed(3)})`);
  }

  return filters.join(' ') || 'none';
}

function getCachedImage(cache, src) {
  const existing = cache.get(src);
  if (existing) return existing;

  const image = new Image();
  const item = {
    image,
    loaded: false,
    errored: false,
  };

  image.decoding = 'async';
  image.src = src;
  image.onload = () => {
    item.loaded = true;
  };
  image.onerror = () => {
    item.errored = true;
  };
  cache.set(src, item);
  return item;
}

function pickBackgroundStyle(background, backgroundImage) {
  if (background.type === 'solid') return background.value;
  if (backgroundImage) return `url(${backgroundImage}) center / cover`;
  return background.value;
}

export function VideoStudio() {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const imageCacheRef = useRef(new Map());
  const projectInputRef = useRef(null);
  const resolvedStateRef = useRef([]);
  const dragPatchRef = useRef(null);
  const exportRef = useRef({
    active: false,
    chunks: [],
    recorder: null,
  });
  const timelineBarRefs = useRef(new Map());
  const dpr = useMemo(() => window.devicePixelRatio || 1, []);
  const lastAnimationRef = useRef(0);
  const restoredProject = useMemo(() => loadVideoProjectDraft(), []);

  const [videoDuration, setVideoDuration] = useState(() => restoredProject?.videoDuration ?? DEFAULT_DURATION);
  const [currentTime, setCurrentTime] = useState(() => restoredProject?.currentTime ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [exportMessage, setExportMessage] = useState(() => (
    restoredProject ? `Restored local draft: ${restoredProject.tracks.length} tracks.` : ''
  ));
  const [autosaveMessage, setAutosaveMessage] = useState(() => (
    restoredProject ? 'Local draft restored.' : ''
  ));
  const [tracks, setTracks] = useState(() => restoredProject?.tracks ?? [
    makeDefaultTrack({ characterId: 'reimu', x: 0.36, y: 0.62, scale: 0.78, z: 0 }),
    makeDefaultTrack({ characterId: 'cirno', x: 0.62, y: 0.65, scale: 0.67, z: 1 }),
  ]);
  const [selectedTrackId, setSelectedTrackId] = useState(() => restoredProject?.tracks[0]?.id ?? '');
  const [backgroundKind, setBackgroundKind] = useState(() => restoredProject?.backgroundKind ?? BACKGROUNDS[0].id);
  const [backgroundImage, setBackgroundImage] = useState(() => restoredProject?.backgroundImage ?? '');
  const [pinOnRelease, setPinOnRelease] = useState(true);
  const [stageDragTool, setStageDragTool] = useState('face');
  const canvasSize = useMemo(() => ({
    width: VIDEO_CANVAS_WIDTH,
    height: VIDEO_CANVAS_HEIGHT,
  }), []);
  const [dragState, setDragState] = useState({
    active: false,
    trackId: '',
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    angleStart: 0,
    rotationStart: 0,
    mode: 'move',
    totalDelta: 0,
  });
  const [pinDragState, setPinDragState] = useState({
    active: false,
    trackId: '',
    keyframeId: '',
    time: 0,
    startX: 0,
    pointerId: -1,
  });

  const background = useMemo(
    () => BACKGROUNDS.find((item) => item.id === backgroundKind) ?? BACKGROUNDS[0],
    [backgroundKind],
  );

  useEffect(() => {
    if (!selectedTrackId && tracks.length > 0) {
      setSelectedTrackId(tracks[0].id);
    }
  }, [selectedTrackId, tracks]);

  useEffect(() => {
    if (isPlaying) return undefined;

    const handle = window.setTimeout(() => {
      const result = saveVideoProjectDraft({
        backgroundImage,
        backgroundKind,
        currentTime,
        tracks,
        videoDuration,
      });

      if (result.ok) {
        setAutosaveMessage('Draft autosaved locally.');
      } else if (result.reason === 'too-large') {
        setAutosaveMessage('Draft is too large for local autosave. Use Save project.');
      } else {
        setAutosaveMessage('Local autosave is unavailable.');
      }
    }, 700);

    return () => window.clearTimeout(handle);
  }, [backgroundImage, backgroundKind, currentTime, isPlaying, tracks, videoDuration]);

  const trackById = useMemo(() => {
    const map = new Map();
    tracks.forEach((track) => map.set(track.id, track));
    return map;
  }, [tracks]);

  const normalizedTracks = useMemo(() => {
    const width = Math.max(240, canvasSize.width);
    const height = Math.max(240, canvasSize.height);
    const baseImageHeight = Math.min(width, height) * 0.9;
    const safeTime = clampPercent(currentTime, 0, videoDuration);
    const sortedTracks = [...tracks].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

    return sortedTracks.map((track) => {
      const base = interpolateTrack(track, safeTime, videoDuration);
      const transition = resolveTransitionState(track, safeTime);
      const sheetInfo = resolvePosePose({ ...track, ...base }, base.facing ?? 0);
      const effect = base.effect || 'none';
      const filterPreset = base.filterPreset ?? track.filterPreset ?? 'none';
      const transitionAlpha = transition.alpha;
      const driftX = transition.driftX;
      const driftY = transition.driftY;
      const zoom = transition.zoom;

      const poseScale = effect === 'pulse'
        ? (1 + 0.04 * Math.sin((safeTime) * 2))
        : 1;
      const size = clampPercent(baseImageHeight * base.scale * zoom * poseScale, 140, Math.min(width, height) * 1.02);
      const baseX = clampPercent(base.x * width, size * 0.15, width - size * 0.15);
      const baseY = clampPercent(base.y * height, size * 0.16, height - size * 0.09);

      const floatOffset = effect === 'float'
        ? Math.sin((safeTime + (track.id.length % 7) * 0.15) * 2.6) * (size * 0.025)
        : 0;
      const bounceOffset = effect === 'bounce'
        ? Math.sin((safeTime + (track.id.length % 11) * 0.2) * 2.8) * (size * 0.032)
        : 0;
      const x = clampPercent(baseX + driftX, size * 0.1, width - size * 0.1);
      const y = clampPercent(baseY + floatOffset + bounceOffset + driftY, size * 0.06, height - size * 0.1);

      return {
        ...track,
        ...base,
        xPx: x,
        yPx: y,
        sizePx: size,
        sheet: sheetInfo.key,
        src: sheetInfo.src,
        row: sheetInfo.row,
        col: sheetInfo.col,
        filterPreset,
        transitionAlpha,
        transitionProgress: transition.transitionProgress,
        transitionDriftX: driftX,
        transitionDriftY: driftY,
        transitionZoom: zoom,
      };
    });
  }, [canvasSize.height, canvasSize.width, currentTime, tracks, videoDuration]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const width = Math.max(1, canvasSize.width);
    const height = Math.max(1, canvasSize.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    resolvedStateRef.current = [];
    return undefined;
  }, [canvasSize.height, canvasSize.width, dpr]);

  const drawFrame = useCallback((frameTimestampSeconds) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const width = Math.max(240, canvasSize.width);
    const height = Math.max(240, canvasSize.height);
    const baseBaseY = height * 0.56;
    const safeBackground = pickBackgroundStyle(background, backgroundImage);

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    if (backgroundImage && background.type === 'image') {
      const backgroundImageElement = getCachedImage(imageCacheRef.current, backgroundImage).image;
      if (backgroundImageElement?.complete) {
        context.drawImage(backgroundImageElement, 0, 0, width, height);
      } else {
        context.fillStyle = '#F3F0E8';
        context.fillRect(0, 0, width, height);
      }
    } else if (background.type === 'gradient' || background.type === 'solid') {
      if (background.type === 'gradient' && safeBackground.includes('linear-gradient')) {
        const grd = context.createLinearGradient(0, 0, 0, height);
        const toneStart = '#FFF7EA';
        const toneMid = '#F5F2EC';
        const toneEnd = '#E8DEF4';
        grd.addColorStop(0, toneStart);
        grd.addColorStop(0.52, toneMid);
        grd.addColorStop(1, toneEnd);
        context.fillStyle = background.value.includes('FFF7EA') ? grd : safeBackground;
        context.fillRect(0, 0, width, height);
      } else {
        context.fillStyle = safeBackground;
        context.fillRect(0, 0, width, height);
      }
    } else {
      context.fillStyle = '#F5F2EC';
      context.fillRect(0, 0, width, height);
    }

    const stageGround = '#0a0a0c';

    const nextResolvedStates = [];
    for (const item of normalizedTracks) {
      if (!item.visible) continue;
      const image = getCachedImage(imageCacheRef.current, item.src);
      const poseScale = item.sizePx;
      const anchorX = item.xPx;
      const anchorY = item.yPx;
      const shadowSize = poseScale * 0.41;
      const jitter = item.effect === 'wobble'
        ? Math.sin(frameTimestampSeconds * 2 + item.x) * 1.3
        : 0;

      context.save();
      context.globalAlpha = clampPercent(item.transitionAlpha, 0.25, 1) * (item.visible ? 1 : 0);
      context.fillStyle = `rgba(4, 6, 10, ${clampPercent(0.16 + jitter * 0.01, 0.08, 0.36)})`;
      context.beginPath();
      context.ellipse(anchorX + item.transitionDriftX, anchorY + shadowSize * 0.34 + item.transitionDriftY, shadowSize, shadowSize * 0.31, 0, 0, Math.PI * 2);
      context.fill();

      if (image.loaded && !image.errored) {
        const size = poseScale * item.transitionZoom;
        const poseSpreadX = poseStretchXForTrack({
          characterId: item.characterId,
          poseVariant: item.poseVariant ?? trackById.get(item.id)?.poseVariant ?? 'plain',
        });
        context.translate(anchorX + item.transitionDriftX, anchorY + item.transitionDriftY);
        context.rotate((item.rotation * Math.PI) / 180);
        context.scale(item.transitionZoom, item.transitionZoom);
        context.filter = makeContextFilter({
          effect: item.effect,
          filterPreset: item.filterPreset,
          characterId: item.characterId,
          transitionType: item.transition,
          transitionProgress: item.transitionProgress,
          timeSeconds: frameTimestampSeconds / 1000,
        });
        context.globalAlpha = clampPercent(item.transitionAlpha, 0.12, 1);
        context.drawImage(
          image.image,
          -size * 0.5 * poseSpreadX,
          -size * 0.74,
          size * poseSpreadX,
          size,
        );
      }
      context.restore();
      if (selectedTrackId && item.id === selectedTrackId) {
        context.save();
        context.strokeStyle = '#0F766E';
        context.lineWidth = 2.2;
        context.setLineDash([7, 7]);
        context.beginPath();
        context.arc(item.xPx, item.yPx, Math.max(42, item.sizePx * 0.34), 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }

      context.filter = 'none';
      context.globalAlpha = 1;
      nextResolvedStates.push(item);
    }

    context.strokeStyle = 'rgba(10, 11, 14, 0.24)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(width / 2, 0);
    context.lineTo(width / 2, height);
    context.stroke();

    context.fillStyle = stageGround;
    context.globalAlpha = 0.08;
    context.fillRect(0, baseBaseY, width, baseBaseY * 0.04);
    context.globalAlpha = 1;

    resolvedStateRef.current = nextResolvedStates;
  }, [background, backgroundImage, canvasSize.height, canvasSize.width, dpr, selectedTrackId, trackById, normalizedTracks]);

  const selectedTrack = trackById.get(selectedTrackId);
  const activeDragLabel = STAGE_DRAG_TOOLS.find((tool) => tool.id === stageDragTool)?.label ?? 'Face';
  const activeDragHint = STAGE_DRAG_TOOL_HINTS[stageDragTool] ?? STAGE_DRAG_TOOL_HINTS.face;

  const selectedPoseOptions = useMemo(() => {
    const character = characterForId(selectedTrack?.characterId ?? 'reimu');
    return character.poseVariants ?? [];
  }, [selectedTrack?.characterId]);

  const selectedTrackFilters = useMemo(() => {
    const character = characterForId(selectedTrack?.characterId ?? 'reimu');
    return videoFiltersForCharacter(character);
  }, [selectedTrack?.characterId]);

  const pointerToCanvasPoint = useCallback((clientX, clientY, rect) => {
    const x = clampPercent((clientX - rect.left) / rect.width, 0, 1);
    const y = clampPercent((clientY - rect.top) / rect.height, 0, 1);

    return {
      x,
      y,
      px: x * canvasSize.width,
      py: y * canvasSize.height,
    };
  }, [canvasSize.height, canvasSize.width]);

  const addTrackKeyframe = useCallback((trackId, overrides = {}) => {
    setTracks((current) => current.map((track) => {
      if (track.id !== trackId) return track;

      const currentState = resolvedStateRef.current.find((item) => item.id === trackId);
      const state = currentState ? {
        x: currentState.x,
        y: currentState.y,
        scale: currentState.scale,
        facing: currentState.facing ?? track.facing ?? 0,
        rotation: currentState.rotation,
        pitch: currentState.pitch,
        poseVariant: currentState.poseVariant ?? track.poseVariant,
        filterPreset: currentState.filterPreset ?? track.filterPreset,
        effect: currentState.effect ?? track.effect,
        transition: currentState.transition ?? track.transition,
      } : {
        x: track.x,
        y: track.y,
        scale: track.scale,
        facing: track.facing ?? 0,
        rotation: track.rotation,
        pitch: track.pitch,
        poseVariant: track.poseVariant,
        filterPreset: track.filterPreset,
        effect: track.effect,
        transition: track.transition,
      };

      const merged = {
        time: clampPercent(currentTime, 0, videoDuration),
        ...state,
        ...overrides,
      };
      const existing = toSortedKeyframes(track.keyframes ?? []);
      const replaced = existing.find((item) => isNearTime(item.time, merged.time));
      const next = existing.filter((item) => !isNearTime(item.time, merged.time));
      next.push({
        id: overrides.id ?? replaced?.id ?? makeKeyframeId(),
        time: clampPercent(merged.time, 0, videoDuration),
        x: clampPercent(merged.x, 0, 1),
        y: clampPercent(merged.y, 0, 1),
        scale: clampPercent(merged.scale, 0.2, 1.6),
        facing: normalizeRotation(merged.facing ?? 0),
        rotation: Number(merged.rotation),
        pitch: Number(merged.pitch),
        filterPreset: merged.filterPreset,
        poseVariant: merged.poseVariant,
        effect: merged.effect,
        transition: merged.transition,
        visible: true,
      });
      next.sort((left, right) => left.time - right.time);
      return {
        ...track,
        x: merged.x,
        y: merged.y,
        scale: merged.scale,
        facing: normalizeRotation(merged.facing ?? 0),
        rotation: merged.rotation,
        pitch: merged.pitch,
        filterPreset: merged.filterPreset,
        poseVariant: merged.poseVariant,
        effect: merged.effect,
        transition: merged.transition,
        keyframes: next,
      };
    }));
  }, [currentTime, videoDuration]);

  const setTrackValues = useCallback((trackId, patch) => {
    setTracks((current) => current.map((track) => {
      if (track.id !== trackId) return track;

      const keyframes = toSortedKeyframes(track.keyframes ?? []);
      const keyIndex = keyframes.findIndex((keyframe) => isNearTime(keyframe.time, currentTime));
      if (keyIndex < 0) return { ...track, ...patch };

      const nextKeyframes = keyframes.slice();
      nextKeyframes[keyIndex] = {
        ...nextKeyframes[keyIndex],
        id: nextKeyframes[keyIndex].id ?? makeKeyframeId(),
        ...patch,
        time: nextKeyframes[keyIndex].time,
      };

      return {
        ...track,
        ...patch,
        keyframes: toSortedKeyframes(nextKeyframes),
      };
    }));
  }, [currentTime]);

  const removeTrack = useCallback((trackId) => {
    setTracks((current) => {
      const next = current.filter((track) => track.id !== trackId);
      if (next.length === 0) {
        next.push(makeDefaultTrack({ characterId: 'reimu', x: 0.4, y: 0.62, scale: 0.72, z: 0 }));
      }
      return next;
    });
    setSelectedTrackId((current) => {
      if (current !== trackId) return current;
      return '';
    });
  }, []);

  const addCharacterTrack = useCallback(() => {
    const candidateCharacter = tracks.length % 2 === 0 ? 'cirno' : 'reimu';
    const offsets = [
      0.28,
      0.62,
      0.8,
    ];
    const characterTrack = makeDefaultTrack({
      characterId: candidateCharacter,
      x: clampPercent(offsets[tracks.length % offsets.length], 0.13, 0.87),
      y: clampPercent(0.58 + (tracks.length % 3) * 0.06, 0.34, 0.92),
      scale: clampPercent(0.58 - tracks.length * 0.03, 0.44, 0.84),
      z: tracks.length,
    });
    setTracks((current) => [...current, characterTrack]);
    setSelectedTrackId(characterTrack.id);
  }, [tracks]);

  const shiftTrackZ = useCallback((trackId, direction) => {
    setTracks((current) => {
      const next = [...current];
      const index = next.findIndex((track) => track.id === trackId);
      if (index < 0) return next;
      const offset = direction === 'front' ? 1 : -1;
      const target = clamp(index + offset, 0, next.length - 1);
      if (target === index) return next;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((track, position) => ({ ...track, z: position }));
    });
  }, []);

  const clearSelection = () => {
    setSelectedTrackId('');
  };

  const beginDrag = useCallback((event, trackId) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;

    dragPatchRef.current = null;
    const candidate = resolvedStateRef.current.find((item) => item.id === trackId);
    if (!candidate) return;

    const point = pointerToCanvasPoint(event.clientX, event.clientY, rect);
    const pointerDistance = Math.hypot(point.px - candidate.xPx, point.py - candidate.yPx);
    const rotateHandleDistance = Math.max(58, candidate.sizePx * 0.62);
    const dragMode = (event.altKey || pointerDistance > rotateHandleDistance)
      ? 'rotate'
      : (event.ctrlKey || event.metaKey)
        ? 'move'
        : stageDragTool;
    const angleStart = normalizeRotation(
      (Math.atan2(point.py - candidate.yPx, point.px - candidate.xPx) * 180) / Math.PI,
    );
    setDragState({
      active: true,
      trackId,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      angleStart,
      rotationStart: candidate.rotation,
      mode: dragMode,
      totalDelta: 0,
    });
    setSelectedTrackId(trackId);
    stageRef.current?.setPointerCapture?.(event.pointerId);

    if (event.shiftKey) {
      addTrackKeyframe(trackId);
    }
  }, [addTrackKeyframe, pointerToCanvasPoint, stageDragTool]);

  const updateDrag = useCallback((event) => {
    if (!dragState.active || !dragState.trackId) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;

    const point = pointerToCanvasPoint(event.clientX, event.clientY, rect);
    const lastPx = dragState.lastX * rect.width;
    const lastPy = dragState.lastY * rect.height;
    const prevPx = lastPx + rect.left;
    const prevPy = lastPy + rect.top;
    const delta = Math.hypot(event.clientX - prevPx, event.clientY - prevPy);
    const currentPose = resolvedStateRef.current.find((item) => item.id === dragState.trackId);
    if (!currentPose) return;
    const localAngle = normalizeRotation((Math.atan2(point.py - currentPose.yPx, point.px - currentPose.xPx) * 180) / Math.PI);

    setDragState((current) => ({
      ...current,
      lastX: point.x,
      lastY: point.y,
      totalDelta: current.totalDelta + delta,
    }));

    setTracks((current) => current.map((track) => {
      if (track.id !== dragState.trackId) return track;
      const nextRotation = dragState.mode === 'rotate'
        ? normalizeRotation(dragState.rotationStart + (localAngle - dragState.angleStart))
        : track.rotation;
      const nextFacing = dragState.mode === 'face'
        ? normalizeRotation(localAngle)
        : track.facing;
      const nextX = dragState.mode === 'move' ? point.x : track.x;
      const nextY = dragState.mode === 'move' ? point.y : track.y;
      const patch = {
        facing: nextFacing,
        rotation: nextRotation,
        x: nextX,
        y: nextY,
      };
      dragPatchRef.current = {
        patch,
        trackId: track.id,
      };
      return {
        ...track,
        ...patch,
      };
    }));
  }, [dragState, pointerToCanvasPoint]);

  const endDrag = useCallback((event) => {
    if (!dragState.active) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) {
      dragPatchRef.current = null;
      setDragState({
        active: false,
        trackId: '',
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        angleStart: 0,
        rotationStart: 0,
        mode: 'move',
        totalDelta: 0,
      });
      return;
    }

    const movedEnough = dragState.totalDelta > DRAG_EPSILON;
    if (pinOnRelease && movedEnough && dragState.trackId) {
      const dragPatch = dragPatchRef.current?.trackId === dragState.trackId
        ? dragPatchRef.current.patch
        : {};
      addTrackKeyframe(dragState.trackId, dragPatch);
    }
    dragPatchRef.current = null;
    setDragState({
      active: false,
      trackId: '',
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      angleStart: 0,
      rotationStart: 0,
      mode: 'move',
      totalDelta: 0,
    });
    stageRef.current?.releasePointerCapture?.(event.pointerId);
  }, [addTrackKeyframe, dragState.totalDelta, dragState.active, dragState.trackId, pinOnRelease]);

  const startPinDrag = useCallback((event, trackId, keyframe) => {
    const bar = timelineBarRefs.current.get(trackId);
    if (!bar) return;
    const target = toSortedKeyframes(trackById.get(trackId)?.keyframes ?? []);
    const exactMatch = findKeyframeIndex(target, keyframe);
    if (exactMatch < 0) return;
    const matchedKeyframe = target[exactMatch];

    setPinDragState({
      active: true,
      trackId,
      keyframeId: matchedKeyframe.id ?? '',
      time: matchedKeyframe.time,
      startX: event.clientX,
      pointerId: event.pointerId,
    });
    bar.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    setSelectedTrackId(trackId);
  }, [trackById]);

  const movePinDrag = useCallback((event) => {
    if (!pinDragState.active || !pinDragState.trackId) return;
    const bar = timelineBarRefs.current.get(pinDragState.trackId);
    if (!bar) return;

    const rect = bar.getBoundingClientRect();
    if (!rect.width) return;
    const nextTime = clampPercent(((event.clientX - rect.left) / rect.width) * videoDuration, 0, videoDuration);

    setTracks((current) => current.map((track) => {
      if (track.id !== pinDragState.trackId) return track;
      const next = toSortedKeyframes(track.keyframes ?? []);
      const keyIndex = findKeyframeIndex(next, {
        id: pinDragState.keyframeId,
        time: pinDragState.time,
      });
      if (keyIndex < 0) return track;
      const movedKeyframe = {
        ...next[keyIndex],
        id: next[keyIndex].id ?? pinDragState.keyframeId ?? makeKeyframeId(),
        time: nextTime,
      };
      const withoutMoved = next
        .filter((_, index) => index !== keyIndex)
        .filter((item) => !isNearTime(item.time, nextTime));

      return { ...track, keyframes: toSortedKeyframes([...withoutMoved, movedKeyframe]) };
    }));

    setCurrentTime(nextTime);
    setPinDragState((current) => (
      current.active && current.trackId === pinDragState.trackId
        ? { ...current, time: nextTime }
        : current
    ));
  }, [pinDragState.active, pinDragState.keyframeId, pinDragState.trackId, pinDragState.time, videoDuration]);

  const endPinDrag = useCallback((event) => {
    if (!pinDragState.active || !pinDragState.trackId) return;
    const bar = timelineBarRefs.current.get(pinDragState.trackId);
    bar?.releasePointerCapture?.(event.pointerId ?? pinDragState.pointerId);
    setPinDragState({
      active: false,
      trackId: '',
      keyframeId: '',
      time: 0,
      startX: 0,
      pointerId: -1,
    });
  }, [pinDragState.active, pinDragState.trackId, pinDragState.pointerId]);

  const removeTrackKeyframe = useCallback((trackId, keyframe) => {
    setTracks((current) => current.map((track) => {
      if (track.id !== trackId) return track;
      const next = (track.keyframes ?? []).filter((item) => (
        keyframe?.id
          ? item.id !== keyframe.id
          : !isNearTime(item.time, keyframe?.time)
      ));
      return { ...track, keyframes: next.length === 0 ? [{
        id: makeKeyframeId(),
        time: 0,
        x: track.x,
        y: track.y,
        scale: track.scale,
        facing: track.facing ?? 0,
        rotation: track.rotation,
        pitch: track.pitch,
        poseVariant: track.poseVariant,
        filterPreset: track.filterPreset,
        effect: track.effect,
        transition: track.transition,
        visible: true,
      }] : toSortedKeyframes(next) };
    }));
  }, []);

  const pickTrackAtPoint = useCallback((clientX, clientY) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const point = pointerToCanvasPoint(clientX, clientY, rect);
    const hit = [...resolvedStateRef.current]
      .sort((left, right) => (right.z ?? 0) - (left.z ?? 0))
      .find((item) => {
        const radius = Math.max(54, item.sizePx * 0.3);
        return (point.px - item.xPx) ** 2 + (point.py - item.yPx) ** 2 <= radius ** 2;
      });
    return hit ?? null;
  }, [pointerToCanvasPoint]);

  const handlePointerDown = useCallback((event) => {
    const hit = pickTrackAtPoint(event.clientX, event.clientY);
    if (event.button !== 0 || !hit) {
      clearSelection();
      return;
    }
    beginDrag(event, hit.id);
  }, [beginDrag, pickTrackAtPoint]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!selectedTrack) return;

      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLElement) {
        if (event.target.isContentEditable) return;
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
      }

      const pose = resolvePoseShortcut(selectedPoseOptions, event.key);
      if (!pose) return;

      setTrackValues(selectedTrack.id, { poseVariant: pose.id });
      setCurrentTime((current) => current);
      setExportMessage(`Pose: ${pose.label}`);
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedPoseOptions, selectedTrack, setCurrentTime, setExportMessage, setTrackValues]);

  useEffect(() => {
    const onMouseMove = (event) => {
      if (dragState.active) {
        updateDrag(event);
      }
      if (pinDragState.active) {
        movePinDrag(event);
      }
    };

    const onMouseUp = (event) => {
      if (dragState.active) {
        endDrag(event);
      }
      if (pinDragState.active) {
        endPinDrag(event);
      }
    };

    window.addEventListener('pointermove', onMouseMove);
    window.addEventListener('pointerup', onMouseUp);
    return () => {
      window.removeEventListener('pointermove', onMouseMove);
      window.removeEventListener('pointerup', onMouseUp);
    };
  }, [dragState.active, pinDragState.active, endDrag, endPinDrag, movePinDrag, updateDrag]);

  useAnimationFrame((time) => {
    if (!lastAnimationRef.current) {
      lastAnimationRef.current = time;
    }

    drawFrame(time);

    if (isScrubbing) {
      lastAnimationRef.current = time;
      return;
    }

    if (isPlaying) {
      const dt = (time - lastAnimationRef.current) / 1000;
      const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / FRAME_RATE;
      lastAnimationRef.current = time;
      setCurrentTime((previous) => {
        const next = previous + safeDt;
        if (next >= videoDuration) {
          const rounded = clampPercent(videoDuration, 0, videoDuration);
          if (exportRef.current.active) {
            const exporter = exportRef.current;
            if (exporter.recorder && exporter.recorder.state === 'recording') {
              exporter.recorder.stop();
            }
            exporter.active = false;
            setExportMessage('Finalizing video...');
          }
          setIsPlaying(false);
          return rounded;
        }
        return clampPercent(next, 0, videoDuration);
      });
    }
  }, true);

  const seekTo = useCallback((time) => {
    setIsPlaying(false);
    setCurrentTime(clampPercent(time, 0, videoDuration));
  }, [videoDuration]);

  const startExport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (exportRef.current.active) {
      setExportMessage('Export is already recording.');
      return;
    }
    const supportsCapture = typeof canvas.captureStream === 'function';
    const recorderSupported = typeof MediaRecorder !== 'undefined';
    if (!supportsCapture || !recorderSupported) {
      setExportMessage('WebM export is not supported in this browser.');
      return;
    }

    setExportMessage('Preparing WebM...');
    const stream = canvas.captureStream(FRAME_RATE);
    const mimeCandidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const selectedMime = mimeCandidates.find((mime) => MediaRecorder.isTypeSupported?.(mime)) ?? 'video/webm';
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: selectedMime });
    exportRef.current = {
      ...exportRef.current,
      active: true,
      recorder,
      chunks,
    };

    recorder.ondataavailable = (event) => {
      if (event.data?.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: selectedMime });
      stream.getTracks().forEach((track) => track.stop());
      exportRef.current.active = false;
      exportRef.current.chunks = [];
      exportRef.current.recorder = null;
      if (!blob.size) {
        setExportMessage('No video data was recorded.');
        return;
      }
      const fileUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = fileUrl;
      anchor.download = `tomari-studio-${Date.now()}.webm`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
      setExportMessage('Export complete.');
    };
    recorder.start();
    setCurrentTime(0);
    setIsScrubbing(false);
    setIsPlaying(true);
    setExportMessage('Recording...');
  }, []);

  const exportFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) {
        setExportMessage('Frame export failed.');
        return;
      }
      const linkUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = linkUrl;
      anchor.download = `tomari-frame-${Date.now()}.png`;
      anchor.click();
      URL.revokeObjectURL(linkUrl);
      setExportMessage('Frame saved.');
    }, 'image/png');
  }, []);

  const saveProject = useCallback(() => {
    const projectJson = serializeVideoProject({
      backgroundImage,
      backgroundKind,
      currentTime,
      tracks,
      videoDuration,
    });
    const blob = new Blob([projectJson], { type: 'application/json' });
    const fileUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = fileUrl;
    anchor.download = `tomari-project-${Date.now()}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
    setExportMessage('Project saved.');
  }, [backgroundImage, backgroundKind, currentTime, tracks, videoDuration]);

  const loadProjectFile = useCallback((event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const project = parseVideoProject(String(reader.result ?? ''));
        setVideoDuration(project.videoDuration);
        setCurrentTime(project.currentTime);
        setBackgroundKind(project.backgroundKind);
        setBackgroundImage(project.backgroundImage);
        setTracks(project.tracks);
        setSelectedTrackId(project.tracks[0]?.id ?? '');
        setIsPlaying(false);
        setIsScrubbing(false);
        setAutosaveMessage('Loaded project will autosave locally.');
        setExportMessage(`Project loaded: ${project.tracks.length} tracks.`);
      } catch {
        setExportMessage('Project file could not be loaded.');
      } finally {
        input.value = '';
      }
    };
    reader.onerror = () => {
      input.value = '';
      setExportMessage('Project file could not be read.');
    };
    reader.readAsText(file);
  }, []);

  const onBackgroundImagePick = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setBackgroundImage(String(reader.result ?? ''));
      setBackgroundKind('custom');
    };
    reader.readAsDataURL(file);
  }, []);

  const formatTime = (seconds) => {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const rem = Math.floor(safe % 60);
    const tenths = Math.floor((safe - Math.floor(safe)) * 10);
    return `${String(minutes).padStart(2, '0')}:${String(rem).padStart(2, '0')}.${tenths}`;
  };

  return (
    <section className="video-studio panel">
      <header className="video-studio__header">
        <PanelTitle icon={Activity} title="Vertical video stage" />
        <div className="video-studio__header-actions">
          <button type="button" className="text-button" onClick={() => setIsPlaying((current) => !current)}>
            {isPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setCurrentTime(0);
              setIsPlaying(false);
            }}
          >
            <CircleDot size={15} aria-hidden="true" />
            <span>Reset</span>
          </button>
          <input
            ref={projectInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={loadProjectFile}
          />
          <button
            type="button"
            className="text-button"
            onClick={() => projectInputRef.current?.click()}
          >
            <Upload size={15} aria-hidden="true" />
            <span>Load project</span>
          </button>
          <button
            type="button"
            className="text-button"
            onClick={saveProject}
          >
            <Download size={15} aria-hidden="true" />
            <span>Save project</span>
          </button>
          <button
            type="button"
            className="text-button"
            onClick={exportFrame}
          >
            <Download size={15} aria-hidden="true" />
            <span>Export frame</span>
          </button>
          <button
            type="button"
            className="text-button"
            onClick={startExport}
          >
            <Scissors size={15} aria-hidden="true" />
            <span>Export video</span>
          </button>
        </div>
      </header>

      <div className="video-studio__toolbar panel">
        <div className="video-studio__timeline">
          <span>{formatTime(currentTime)} / {formatTime(videoDuration)}</span>
          <label className="video-timeline-range">
            <span>Time</span>
            <input
              type="range"
              min={0}
              max={videoDuration}
              step={0.1}
              value={currentTime}
              onMouseDown={() => setIsScrubbing(true)}
              onMouseUp={() => setIsScrubbing(false)}
              onTouchStart={() => setIsScrubbing(true)}
              onTouchEnd={() => setIsScrubbing(false)}
              onChange={(event) => seekTo(Number(event.target.value))}
            />
          </label>
          <label className="video-control">
            <span>Duration</span>
            <input
              type="range"
              min={4}
              max={30}
              step={1}
              value={videoDuration}
              onChange={(event) => {
                const value = Number(event.target.value);
                setVideoDuration(value);
                setCurrentTime((current) => clampPercent(current, 0, value));
              }}
            />
          </label>

          <label className="video-control">
            <span>Background</span>
            <select
              className="video-select"
              value={backgroundKind}
              onChange={(event) => setBackgroundKind(event.target.value)}
            >
              {BACKGROUNDS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
              <option value="custom">Custom image</option>
            </select>
          </label>

          {backgroundKind === 'custom' && (
            <label className="video-select">
              <input type="file" accept="image/*" onChange={onBackgroundImagePick} />
            </label>
          )}
        </div>

        <div className="video-studio__meta">
          <p>{tracks.length} tracks. Stage drag: {activeDragLabel}. Pin on release is {pinOnRelease ? 'on' : 'off'}.</p>
          {autosaveMessage && <p>{autosaveMessage}</p>}
          {exportMessage && <p className="video-message">{exportMessage}</p>}
        </div>
      </div>

      <div className="video-studio__layout">
        <div
          className={dragState.active ? 'video-studio__stage panel is-dragging' : 'video-studio__stage panel'}
          data-drag-tool={stageDragTool}
          ref={stageRef}
          onPointerDown={handlePointerDown}
        >
          <canvas
            ref={canvasRef}
            className="video-studio__canvas"
            width={VIDEO_CANVAS_WIDTH}
            height={VIDEO_CANVAS_HEIGHT}
            aria-label="Video composition stage"
          />
          <div className="video-studio__hint">
            <span>{activeDragHint}</span>
            <strong>{selectedTrack ? 'Shift+drag pins this moment.' : 'Select a track to edit.'}</strong>
          </div>
        </div>

        <aside className="video-studio__panel">
          <div className="video-control-panel__section">
            <PanelTitle icon={SlidersHorizontal} title="Tracks" />
            <div className="video-lane-list">
              {tracks.map((track, index) => {
                const character = characterForId(track.characterId);
                const pose = poseVariantForCharacter(character, track.poseVariant)?.label ?? 'Pose';
                const isSelected = track.id === selectedTrackId;
                const keyframes = (track.keyframes ?? []).length;
                return (
                  <button
                    key={track.id}
                    type="button"
                    className={isSelected ? 'video-lane-list__item is-active' : 'video-lane-list__item'}
                    onClick={() => setSelectedTrackId(track.id)}
                  >
                    <span className="video-lane-list__index">{index + 1}</span>
                    <span>{character.label}</span>
                    <strong>{pose}</strong>
                    <span>{keyframes} pins</span>
                  </button>
                );
              })}
            </div>

            <div className="video-studio__track-actions">
              <button type="button" className="text-button" onClick={addCharacterTrack}>
                <Plus size={15} aria-hidden="true" />
                <span>Add character track</span>
              </button>
              <button type="button" className="text-button" onClick={() => shiftTrackZ(selectedTrackId, 'front')}>
                <RotateCw size={15} aria-hidden="true" />
                <span>Bring front</span>
              </button>
              <button type="button" className="text-button" onClick={() => shiftTrackZ(selectedTrackId, 'back')}>
                <RotateCcw size={15} aria-hidden="true" />
                <span>Send back</span>
              </button>
            </div>
          </div>

          {selectedTrack ? (
            <>
              <div className="video-control-panel__section">
                <PanelTitle icon={SlidersHorizontal} title="Track: transform" />
                <label className="video-select">
                  <span>Character</span>
                  <select
                    value={selectedTrack.characterId}
                    onChange={(event) => {
                      const nextCharacterId = event.target.value;
                      const character = characterForId(nextCharacterId);
                      const pose = character.poseVariants?.[0]?.id ?? '';
                      const filter = videoFiltersForCharacter(character)?.[0]?.id ?? 'none';
                      setSelectedTrackId(selectedTrack.id);
                      setTrackValues(selectedTrack.id, {
                        characterId: nextCharacterId,
                        poseVariant: pose,
                        filterPreset: filter,
                      });
                    }}
                  >
                    {CHARACTER_OPTIONS.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </label>

                <label className="video-select">
                  <span>Pose / Arms</span>
                  <select
                    value={selectedTrack.poseVariant}
                    onChange={(event) => setTrackValues(selectedTrack.id, { poseVariant: event.target.value })}
                  >
                    {selectedPoseOptions.map((pose) => (
                      <option key={pose.id} value={pose.id}>{pose.label}</option>
                    ))}
                  </select>
                </label>

                <label className="video-select">
                  <span>Filter</span>
                  <select
                    value={selectedTrack.filterPreset}
                    onChange={(event) => setTrackValues(selectedTrack.id, { filterPreset: event.target.value })}
                  >
                    {selectedTrackFilters.map((filter) => (
                      <option key={filter.id} value={filter.id}>
                        {filter.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="segmented-control">
                  <span>Effect</span>
                  <div className="segmented-control__options">
                    {TRACK_EFFECTS.map((effect) => (
                      <button
                        key={effect.id}
                        type="button"
                        className={selectedTrack.effect === effect.id ? 'is-active' : ''}
                        title={effect.description}
                        onClick={() => setTrackValues(selectedTrack.id, { effect: effect.id })}
                      >
                        {effect.label}
                      </button>
                    ))}
                  </div>
                </label>

                <label className="segmented-control">
                  <span>Transition</span>
                  <div className="segmented-control__options">
                    {TRANSITIONS.map((transition) => (
                      <button
                        key={transition.id}
                        type="button"
                        className={selectedTrack.transition === transition.id ? 'is-active' : ''}
                        title={transition.description}
                        onClick={() => setTrackValues(selectedTrack.id, { transition: transition.id })}
                      >
                        {transition.label}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="segmented-control">
                  <span>Stage drag</span>
                  <div className="segmented-control__options">
                    {STAGE_DRAG_TOOLS.map((tool) => (
                      <button
                        key={tool.id}
                        type="button"
                        className={stageDragTool === tool.id ? 'is-active' : ''}
                        onClick={() => setStageDragTool(tool.id)}
                      >
                        {tool.label}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="checkbox-control">
                  <input
                    type="checkbox"
                    checked={pinOnRelease}
                    onChange={(event) => setPinOnRelease(event.target.checked)}
                  />
                  <span>Pin on drag end</span>
                </label>
                <RangeControl
                  label="Scale"
                  value={selectedTrack.scale}
                  min={0.3}
                  max={1.35}
                  step={0.01}
                  onChange={(scale) => setTrackValues(selectedTrack.id, { scale })}
                />
                <RangeControl
                  label="X"
                  value={selectedTrack.x}
                  min={0}
                  max={1}
                  step={0.001}
                  onChange={(value) => setTrackValues(selectedTrack.id, { x: value })}
                />
                <RangeControl
                  label="Y"
                  value={selectedTrack.y}
                  min={0.1}
                  max={1}
                  step={0.001}
                  onChange={(value) => setTrackValues(selectedTrack.id, { y: value })}
                />
                <RangeControl
                  label="Facing"
                  value={selectedTrack.facing ?? 0}
                  min={-180}
                  max={180}
                  step={1}
                  onChange={(value) => setTrackValues(selectedTrack.id, { facing: value })}
                />
                <RangeControl
                  label="Rotate"
                  value={selectedTrack.rotation}
                  min={-180}
                  max={180}
                  step={1}
                  onChange={(value) => setTrackValues(selectedTrack.id, { rotation: value })}
                />
                <RangeControl
                  label="Pitch"
                  value={selectedTrack.pitch}
                  min={-60}
                  max={60}
                  step={1}
                  onChange={(value) => setTrackValues(selectedTrack.id, { pitch: value })}
                />

                <div className="video-studio__key-controls">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => addTrackKeyframe(selectedTrack.id)}
                  >
                    <Plus size={15} aria-hidden="true" />
                    <span>Add pin at {formatTime(currentTime)}</span>
                  </button>
                  <button
                    type="button"
                    className="text-button text-button--danger"
                    onClick={() => removeTrack(selectedTrack.id)}
                  >
                    <Minus size={15} aria-hidden="true" />
                    <span>Remove character</span>
                  </button>
                </div>
              </div>

              <div className="video-control-panel__section">
                <PanelTitle icon={SlidersHorizontal} title="Pose pins" />
                {(selectedTrack.keyframes && selectedTrack.keyframes.length > 0) ? (
                  [...selectedTrack.keyframes]
                    .sort((left, right) => left.time - right.time)
                    .map((keyframe) => (
                      <div className="pin-row" key={`${selectedTrack.id}-${keyframe.id ?? keyframe.time}`}>
                        <span>{formatTime(keyframe.time)}</span>
                        <strong>{keyframe.poseVariant || selectedTrack.poseVariant}</strong>
                        <button
                          type="button"
                          className="text-button text-button--compact"
                          onClick={() => {
                            setCurrentTime(keyframe.time);
                            setIsPlaying(false);
                          }}
                        >
                          Go
                        </button>
                        <button
                          type="button"
                          className="text-button text-button--compact text-button--danger"
                          onClick={() => {
                            removeTrackKeyframe(selectedTrack.id, keyframe);
                            setExportMessage('Keyframe removed.');
                          }}
                        >
                          Del
                        </button>
                      </div>
                    ))
                ) : (
                  <p className="inline-alert">No pins yet. Click+drag in stage to create one.</p>
                )}
              </div>
            </>
          ) : (
            <p className="inline-alert">Select a character to edit a track.</p>
          )}
        </aside>
      </div>

      <section className="video-timeline">
        <h3>Timeline lanes</h3>
        {tracks.map((track) => {
            const items = (track.keyframes ?? []).slice().sort((left, right) => left.time - right.time);
            return (
              <div className="video-timeline__lane" key={track.id}>
                <strong>{characterForId(track.characterId).label}</strong>
                <div
                  className="video-timeline__bar"
                  ref={(node) => {
                    if (node) {
                      timelineBarRefs.current.set(track.id, node);
                    } else {
                      timelineBarRefs.current.delete(track.id);
                    }
                  }}
                >
                  {items.map((item) => (
                    <button
                      type="button"
                      key={`${track.id}-${item.id ?? item.time}`}
                      className="video-timeline__pin"
                      style={{ left: `${(item.time / Math.max(videoDuration, 0.001)) * 100}%` }}
                      onClick={() => seekTo(item.time)}
                      onPointerDown={(event) => startPinDrag(event, track.id, item)}
                      title={`Pin at ${formatTime(item.time)}`}
                      aria-label={`Seek to pin at ${formatTime(item.time)}`}
                    >
                      {Math.round(item.time * 10) / 10}
                    </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </section>
  );
}

function PanelTitle({ icon: Icon, title }) {
  return (
    <div className="panel-title">
      <Icon size={16} aria-hidden="true" />
      <h2>{title}</h2>
    </div>
  );
}

function RangeControl({ label, value, min, max, step, onChange }) {
  return (
    <label className="range-control">
      <span>
        <span>{label}</span>
        <strong>{typeof value === 'number' ? value.toFixed(3) : value}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
