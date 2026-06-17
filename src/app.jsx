import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  AudioLines,
  Boxes,
  Bug,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Gauge,
  Github,
  Maximize2,
  Mic,
  MicOff,
  MousePointer2,
  Palette,
  Pause,
  Play,
  Radio,
  Video,
  Settings2,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { AudioLevelEngine, smoothAudioEnvelope } from './domain/audio-engine';
import {
  allFrames,
  assetManifest,
  characterForId,
  CHARACTER_OPTIONS,
  frameSrc,
  mouthFromLevel,
  MOUTH_STATES,
  pointerToTarget,
  poseVariantForCharacter,
  sheetForPose,
  targetToCell,
} from './domain/character';
import { makeBuiltInSyncAudit, makeLipSyncSnapshot } from './domain/lip-sync-diagnostics';
import { useAnimationFrame } from './hooks/use-animation-frame';
import { useAvatarTintOverlay } from './hooks/use-avatar-tint-overlay';
import { usePersistentState } from './hooks/use-persistent-state';
import { clamp, lerp } from './lib/math';
import { RoomView } from './room';
import { VideoStudio } from './video-studio';

const MODES = [
  { id: 'talk', label: 'Talk', icon: AudioLines, path: 'talk.html' },
  { id: 'gaze', label: 'Gaze', icon: MousePointer2, path: 'guruguru.html' },
  { id: 'room', label: 'Room', icon: Radio, path: 'room.html' },
  { id: 'video', label: 'Video', icon: Video, path: 'video.html' },
  { id: 'assets', label: 'Assets', icon: Boxes, path: 'index.html#assets' },
];

const DEFAULT_TUNING = {
  followRange: 340,
  smoothing: 0.3,
  avatarSize: 64,
  background: '#F5F2EC',
  micGain: 1.6,
  thresholdHalf: 0.07,
  thresholdFull: 0.2,
  release: 0.12,
  autoBlink: true,
  showDebug: false,
  characterId: 'tomari',
  poseVariant: 'plain',
  hairColor: '#6D5BD0',
  hairTint: 0,
  eyeColor: '#2BA7E8',
  eyeTint: 0,
  colorFilter: 'shade',
};

const BACKGROUNDS = [
  '#F5F2EC',
  '#F8FAFC',
  '#ECFDF3',
  '#FDF2F8',
  '#171717',
];

const HAIR_COLORS = [
  '#303235',
  '#6D5BD0',
  '#0F766E',
  '#A85555',
  '#B7791F',
];

const EYE_COLORS = [
  '#F2B705',
  '#2BA7E8',
  '#22A06B',
  '#A855F7',
  '#E35D75',
];

const COLOR_FILTERS = [
  { id: 'shade', label: 'Shade' },
  { id: 'smooth', label: 'Smooth' },
  { id: 'glaze', label: 'Glaze' },
  { id: 'natural', label: 'Natural' },
  { id: 'silk', label: 'Silk' },
  { id: 'grade', label: 'Grade' },
  { id: 'soft', label: 'Soft' },
  { id: 'paint', label: 'Paint' },
];

function detectInitialMode() {
  const bodyMode = document.body.dataset.initialMode;
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();

  if (hash === '#assets') return 'assets';
  if (hash === '#video') return 'video';
  if (path.endsWith('/room.html')) return 'room';
  if (path.endsWith('/guruguru.html')) return 'gaze';
  if (path.endsWith('/talk.html')) return 'talk';
  if (path.endsWith('/video.html')) return 'video';
  if (MODES.some((mode) => mode.id === bodyMode)) return bodyMode;
  return 'talk';
}

function pathForMode(mode) {
  const target = MODES.find((item) => item.id === mode);
  return target?.path ?? 'talk.html';
}

function pathWithCurrentSearch(path) {
  const [basePath, hash = ''] = path.split('#');
  return `${basePath}${window.location.search}${hash ? `#${hash}` : ''}`;
}

function normalizeColorParam(value) {
  if (!value) return '';

  const normalized = value.trim().replace(/^#/, '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((item) => `${item}${item}`).join('')
    : normalized;

  if (!/^[0-9a-f]{6}$/i.test(expanded)) return '';
  return `#${expanded.toUpperCase()}`;
}

function normalizeColorFilter(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['paint', 'overlay', 'tint'].includes(normalized)) return 'paint';
  if (['soft', 'tone'].includes(normalized)) return 'soft';
  if (['shade', 'shaded', 'tonal', 'detail', 'texture'].includes(normalized)) return 'shade';
  if (['smooth', 'dye', 'perceptual'].includes(normalized)) return 'smooth';
  if (['glaze', 'blend', 'chroma', 'color'].includes(normalized)) return 'glaze';
  if (normalized === 'natural') return 'natural';
  if (normalized === 'silk') return 'silk';
  if (['grade', 'luma', 'preserve'].includes(normalized)) return 'grade';
  return '';
}

function normalizeCharacterId(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return CHARACTER_OPTIONS.some((character) => character.id === normalized) ? normalized : '';
}

function normalizePoseVariant(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function isEditableShortcutTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
}

function poseVariantForShortcut(key, variants) {
  const normalized = key.toLowerCase();
  if (/^[1-9]$/.test(normalized)) return variants[Number(normalized) - 1] ?? null;

  return variants.find((variant) => variant.shortcut === normalized || variant.id === normalized) ?? null;
}

function readTuningParams(search = window.location.search) {
  const params = new URLSearchParams(search);
  const patch = {};
  const characterId = normalizeCharacterId(params.get('character') ?? params.get('avatar'));
  const poseVariant = normalizePoseVariant(params.get('pose') ?? params.get('arms') ?? params.get('variant'));
  const hairColor = normalizeColorParam(params.get('hair') ?? params.get('hairColor'));
  const eyeColor = normalizeColorParam(params.get('eyes') ?? params.get('eyeColor'));
  const hasFilterOverride = params.has('filter') || params.has('colorFilter');
  const colorFilter = normalizeColorFilter(params.get('filter') ?? params.get('colorFilter'));
  const hairTint = Number(params.get('hairMix') ?? params.get('hairTint'));
  const eyeTint = Number(params.get('eyeMix') ?? params.get('eyeTint'));
  const hasColorOverride = Boolean(hairColor || eyeColor || Number.isFinite(hairTint) || Number.isFinite(eyeTint));

  if (characterId) patch.characterId = characterId;
  if (poseVariant) patch.poseVariant = poseVariant;
  if (hairColor) patch.hairColor = hairColor;
  if (eyeColor) patch.eyeColor = eyeColor;
  if (colorFilter) patch.colorFilter = colorFilter;
  if (!colorFilter && !hasFilterOverride && hasColorOverride) patch.colorFilter = 'shade';
  if (Number.isFinite(hairTint)) patch.hairTint = clamp(hairTint, 0, 0.85);
  if (Number.isFinite(eyeTint)) patch.eyeTint = clamp(eyeTint, 0, 0.95);

  return patch;
}

function useModeRouter(initialMode) {
  const [mode, setModeState] = useState(initialMode);

  const setMode = useCallback((nextMode) => {
    setModeState(nextMode);
    const nextPath = pathForMode(nextMode);
    const nextUrl = pathWithCurrentSearch(nextPath);
    if (window.location.pathname.split('/').pop() + window.location.hash !== nextPath) {
      window.history.pushState({ mode: nextMode }, '', nextUrl);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setModeState(detectInitialMode());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const labels = {
      assets: 'Assets',
      gaze: 'Gaze',
      room: 'Room',
      talk: 'Talk',
      video: 'Video',
    };
    document.title = `Tomari Studio - ${labels[mode] ?? 'Talk'}`;
  }, [mode]);

  return [mode, setMode];
}

export function StudioApp({ initialMode = detectInitialMode() }) {
  const [mode, setMode] = useModeRouter(initialMode);
  const [tuning, patchTuning, setTuning] = usePersistentState(
    'pngtuber-studio:tuning',
    DEFAULT_TUNING,
  );
  const [stageOnly, setStageOnly] = useState(false);
  const [cell, setCell] = useState({ row: 2, col: 2 });
  const [mouth, setMouth] = useState(0);
  const [blink, setBlink] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [fileName, setFileName] = useState('');
  const [audioError, setAudioError] = useState('');
  const [pressed, setPressed] = useState(false);

  const avatarRef = useRef(null);
  const audioElRef = useRef(null);
  const demoTimerRef = useRef(0);
  const objectUrlRef = useRef('');
  const targetRef = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });
  const envelopeRef = useRef(0);
  const lastMouthRef = useRef({ state: 0, at: 0 });
  const lastUiUpdateRef = useRef(0);
  const modeRef = useRef(mode);
  const tuningRef = useRef(tuning);

  modeRef.current = mode;
  tuningRef.current = tuning;

  const engine = useMemo(() => new AudioLevelEngine(), []);
  const activeCharacter = characterForId(tuning.characterId);
  const activePoseVariant = poseVariantForCharacter(activeCharacter, tuning.poseVariant);
  const frames = useMemo(() => allFrames({
    characterId: activeCharacter.id,
  }), [activeCharacter.id]);
  const avatarTint = useMemo(() => ({
    filterMode: tuning.colorFilter,
    hairColor: tuning.hairColor,
    hairStrength: activeCharacter.supportsTint ? tuning.hairTint : 0,
    eyeColor: tuning.eyeColor,
    eyeStrength: activeCharacter.supportsTint ? tuning.eyeTint : 0,
  }), [activeCharacter.supportsTint, tuning.colorFilter, tuning.eyeColor, tuning.eyeTint, tuning.hairColor, tuning.hairTint]);
  const activeSheet = sheetForPose({
    blink,
    characterId: activeCharacter.id,
    mouth: mode === 'talk' ? mouth : 0,
    poseVariant: activePoseVariant?.id,
  });

  useEffect(() => () => engine.dispose(), [engine]);

  useEffect(() => {
    const tuningParams = readTuningParams();
    if (Object.keys(tuningParams).length > 0) patchTuning(tuningParams);
  }, [patchTuning]);

  useEffect(() => {
    const variants = activeCharacter.poseVariants ?? [];
    if (variants.length === 0) return undefined;

    const onKeyDown = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      if (isEditableShortcutTarget(event.target)) return;

      const variant = poseVariantForShortcut(event.key, variants);
      if (!variant) return;

      event.preventDefault();
      patchTuning({ poseVariant: variant.id });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeCharacter.poseVariants, patchTuning]);

  useEffect(() => {
    const onPointerMove = (event) => {
      const element = avatarRef.current;
      if (!element) return;
      targetRef.current = pointerToTarget({
        clientX: event.clientX,
        clientY: event.clientY,
        element,
        range: tuningRef.current.followRange,
      });
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerdown', onPointerMove);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerMove);
    };
  }, []);

  useEffect(() => {
    if (!tuning.autoBlink) {
      setBlink(false);
      return undefined;
    }

    let alive = true;
    let timerId;
    const randomBetween = (min, max) => min + Math.random() * (max - min);

    const schedule = () => {
      if (!alive) return;
      const roll = Math.random();
      const delay = roll < 0.12
        ? randomBetween(700, 1500)
        : roll < 0.82
          ? randomBetween(1800, 4500)
          : randomBetween(4500, 9000);
      timerId = window.setTimeout(blinkOnce, delay);
    };

    const closeThenOpen = (duration, after) => {
      setBlink(true);
      timerId = window.setTimeout(() => {
        if (!alive) return;
        setBlink(false);
        timerId = window.setTimeout(after, randomBetween(120, 220));
      }, duration);
    };

    const blinkOnce = () => {
      if (!alive) return;
      const roll = Math.random();
      if (roll < 0.22) {
        closeThenOpen(randomBetween(80, 120), () => {
          if (alive) closeThenOpen(randomBetween(70, 110), schedule);
        });
      } else if (roll < 0.28) {
        closeThenOpen(randomBetween(260, 420), schedule);
      } else {
        closeThenOpen(randomBetween(90, 150), schedule);
      }
    };

    schedule();
    return () => {
      alive = false;
      window.clearTimeout(timerId);
    };
  }, [tuning.autoBlink]);

  useAnimationFrame((time) => {
    const settings = tuningRef.current;
    currentRef.current = {
      x: lerp(currentRef.current.x, targetRef.current.x, settings.smoothing),
      y: lerp(currentRef.current.y, targetRef.current.y, settings.smoothing),
    };

    const nextCell = targetToCell(currentRef.current);
    setCell((previous) => (
      previous.row === nextCell.row && previous.col === nextCell.col
        ? previous
        : nextCell
    ));

    const isAudioMode = modeRef.current === 'talk' || modeRef.current === 'room';
    const raw = isAudioMode ? engine.level() * settings.micGain : 0;
    envelopeRef.current = smoothAudioEnvelope(envelopeRef.current, raw, {
      release: settings.release,
    });

    const nextMouth = isAudioMode
      ? mouthFromLevel(envelopeRef.current, settings)
      : 0;
    if (
      nextMouth !== lastMouthRef.current.state
      && time - lastMouthRef.current.at > 70
    ) {
      lastMouthRef.current = { state: nextMouth, at: time };
      setMouth(nextMouth);
    }

    if (time - lastUiUpdateRef.current > 54) {
      lastUiUpdateRef.current = time;
      setAudioLevel(clamp(envelopeRef.current / 0.4, 0, 1));
    }
  });

  const toggleMic = useCallback(async (options = {}) => {
    setAudioError('');
    if (!options.keepMode) setMode('talk');

    if (micOn) {
      engine.stopMic();
      setMicOn(false);
      return;
    }

    try {
      engine.stopDemoSignal();
      await engine.startMic();
      setMicOn(true);
    } catch (error) {
      setMicOn(false);
      setAudioError(error instanceof Error ? error.message : 'Microphone could not start.');
    }
  }, [engine, micOn, setMode]);

  const handleAudioFile = useCallback(async (event, options = {}) => {
    const file = event.target.files?.[0];
    if (!file || !audioElRef.current) return;

    if (!options.keepMode) setMode('talk');
    setAudioError('');

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = '';
    }

    try {
      engine.stopDemoSignal();
      engine.attachAudioElement(audioElRef.current);
      await engine.resume();
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      audioElRef.current.src = url;
      setFileName(file.name);
      await audioElRef.current.play();
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : 'Audio file could not play.');
    } finally {
      event.target.value = '';
    }
  }, [engine, setMode]);

  const handleDemoSync = useCallback(async (options = {}) => {
    if (!options.keepMode) setMode('talk');
    setAudioError('');
    setMicOn(false);

    if (demoTimerRef.current) {
      window.clearTimeout(demoTimerRef.current);
      demoTimerRef.current = 0;
    }

    try {
      engine.stopMic();
      await engine.startDemoSignal();
      setFileName('Built-in sync test');
      demoTimerRef.current = window.setTimeout(() => {
        setFileName((current) => (current === 'Built-in sync test' ? '' : current));
        demoTimerRef.current = 0;
      }, 5400);
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : 'Demo sync signal could not start.');
    }
  }, [engine, setMode]);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    if (demoTimerRef.current) window.clearTimeout(demoTimerRef.current);
  }, []);

  const activeMouth = MOUTH_STATES[mouth] ?? MOUTH_STATES[0];
  const lipSyncSnapshot = useMemo(() => makeLipSyncSnapshot({
    activeMouth,
    audioLevel,
    fileName,
    micOn,
    mode,
    mouth,
  }), [activeMouth, audioLevel, fileName, micOn, mode, mouth]);
  const builtInSyncAudit = useMemo(() => makeBuiltInSyncAudit({
    micGain: tuning.micGain,
    release: tuning.release,
    thresholdFull: tuning.thresholdFull,
    thresholdHalf: tuning.thresholdHalf,
  }), [tuning.micGain, tuning.release, tuning.thresholdFull, tuning.thresholdHalf]);
  const isDarkStage = tuning.background === '#171717';

  return (
    <div
      className={[
        'studio',
        stageOnly ? 'studio--stage-only' : '',
        isDarkStage ? 'studio--dark-stage' : '',
      ].filter(Boolean).join(' ')}
      style={{
        '--avatar-size': `${tuning.avatarSize * 1.32}vmin`,
        '--stage-background': tuning.background,
      }}
      data-lip-sync-level={lipSyncSnapshot.level}
      data-lip-sync-level-percent={lipSyncSnapshot.levelPercent}
      data-lip-sync-mode={lipSyncSnapshot.mode}
      data-lip-sync-mouth={lipSyncSnapshot.mouth}
      data-lip-sync-mouth-label={lipSyncSnapshot.mouthLabel}
      data-lip-sync-source={lipSyncSnapshot.source}
      data-lip-sync-demo-audit={builtInSyncAudit.status}
      data-lip-sync-demo-coverage={builtInSyncAudit.coverage}
      data-lip-sync-demo-last-mouth={builtInSyncAudit.lastMouth}
      data-lip-sync-demo-open-frames={builtInSyncAudit.openFrames}
      data-lip-sync-demo-peak={builtInSyncAudit.peakLevel}
      data-lip-sync-demo-samples={builtInSyncAudit.sampleCount}
      data-lip-sync-demo-transitions={builtInSyncAudit.transitions}
      data-character-id={activeCharacter.id}
      data-pose-variant={activePoseVariant?.id ?? ''}
      data-avatar-filter={tuning.colorFilter}
    >
      {!stageOnly && (
        <AppHeader mode={mode} setMode={setMode} onStageOnly={() => setStageOnly(true)} />
      )}

      <main className={['room', 'video'].includes(mode) && !stageOnly ? 'studio__workspace studio__workspace--room' : 'studio__workspace'}>
        {!stageOnly && !['room', 'video'].includes(mode) && (
          <InputPanel
            mode={mode}
            micOn={micOn}
            audioLevel={audioLevel}
            audioError={audioError}
            fileName={fileName}
            activeMouth={activeMouth}
            onMicToggle={toggleMic}
            onAudioFile={handleAudioFile}
            onDemoSync={handleDemoSync}
            onModeChange={setMode}
          />
        )}

        {mode === 'room' && !stageOnly ? (
          <RoomView
            localState={{
              audioLevel,
              cell,
              mouth,
            }}
            liveControls={{
              activeMouth,
              audioError,
              audioLevel,
              fileName,
              micOn,
              onAudioFile: (event) => handleAudioFile(event, { keepMode: true }),
              onDemoSync: () => handleDemoSync({ keepMode: true }),
              onMicToggle: () => toggleMic({ keepMode: true }),
            }}
            tuning={tuning}
          />
        ) : mode === 'assets' && !stageOnly ? (
          <AssetInventory onModeChange={setMode} />
        ) : mode === 'video' ? (
          <VideoStudio />
        ) : (
          <AvatarStage
            activeSheet={activeSheet}
            audioLevel={audioLevel}
            cell={cell}
            character={activeCharacter}
            frames={frames}
            isTalkMode={mode === 'talk'}
            mouth={mouth}
            pressed={pressed}
            ref={avatarRef}
            setPressed={setPressed}
            showDebug={tuning.showDebug}
            stageOnly={stageOnly}
            tint={avatarTint}
            onExitStage={() => setStageOnly(false)}
          />
        )}

        {!stageOnly && !['room', 'video'].includes(mode) && (
          <TuningPanel
            tuning={tuning}
            patchTuning={patchTuning}
            resetTuning={() => setTuning(DEFAULT_TUNING)}
            mode={mode}
            cell={cell}
            character={activeCharacter}
            mouth={activeMouth}
            poseVariant={activePoseVariant}
          />
        )}
      </main>

      <audio ref={audioElRef} controls className={fileName ? 'audio-player is-visible' : 'audio-player'} />
    </div>
  );
}

function AppHeader({ mode, setMode, onStageOnly }) {
  return (
    <header className="app-header">
      <a className="brand" href="talk.html" onClick={(event) => {
        event.preventDefault();
        setMode('talk');
      }}>
        <span className="brand__mark" aria-hidden="true">T</span>
        <span>
          <span className="brand__name">Tomari Studio</span>
          <span className="brand__sub">PNG avatar console</span>
        </span>
      </a>

      <nav className="mode-tabs" aria-label="Studio modes">
        {MODES.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={mode === item.id ? 'mode-tabs__item is-active' : 'mode-tabs__item'}
              onClick={() => setMode(item.id)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="header-actions">
        <a
          className="icon-link"
          href="https://github.com/rotejin/tomari-guruguru"
          rel="noreferrer"
          target="_blank"
          title="Original repository"
          aria-label="Original repository"
        >
          <Github size={18} aria-hidden="true" />
        </a>
        <button
          className="icon-button"
          type="button"
          title="Stage view"
          aria-label="Stage view"
          onClick={onStageOnly}
        >
          <Maximize2 size={18} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function InputPanel({
  mode,
  micOn,
  audioLevel,
  audioError,
  fileName,
  activeMouth,
  onMicToggle,
  onAudioFile,
  onDemoSync,
  onModeChange,
}) {
  return (
    <aside className="panel input-panel" aria-label="Live input">
      <PanelTitle icon={Activity} title="Live Input" />

      <div className="metric">
          <span className="metric__label">Mode</span>
          <strong>{mode === 'talk' ? 'Audio lip sync' : mode === 'gaze' ? 'Pointer tracking' : mode === 'room' ? 'Room presence' : 'Asset check'}</strong>
        </div>

      <button
        className={micOn ? 'command-button command-button--danger' : 'command-button'}
        type="button"
        onClick={onMicToggle}
      >
        {micOn ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
        <span>{micOn ? 'Stop mic' : 'Start mic'}</span>
      </button>

      <label className="command-button command-button--secondary">
        <Upload size={18} aria-hidden="true" />
        <span>Audio file</span>
        <input type="file" accept="audio/*" onChange={onAudioFile} />
      </label>

      <button className="command-button command-button--secondary" type="button" onClick={onDemoSync}>
        <AudioLines size={18} aria-hidden="true" />
        <span>Test sync</span>
      </button>

      <div className="meter" aria-label="Audio level">
        <div className="meter__header">
          <span>Audio level</span>
          <strong>{activeMouth.label}</strong>
        </div>
        <div className="meter__track">
          <span className="meter__bar" style={{ width: `${audioLevel * 100}%` }} />
        </div>
      </div>

      {fileName && (
        <div className="file-pill">
          <AudioLines size={14} aria-hidden="true" />
          <span>{fileName}</span>
        </div>
      )}

      {audioError && (
        <p className="inline-alert" role="alert">{audioError}</p>
      )}

      <div className="mini-actions">
        <button type="button" onClick={() => onModeChange('talk')}>
          <Play size={15} aria-hidden="true" />
          Talk
        </button>
        <button type="button" onClick={() => onModeChange('gaze')}>
          <MousePointer2 size={15} aria-hidden="true" />
          Gaze
        </button>
      </div>
    </aside>
  );
}

const AvatarStage = React.forwardRef(function AvatarStage(
  {
    activeSheet,
    audioLevel,
    cell,
    character,
    frames,
    isTalkMode,
    mouth,
    pressed,
    setPressed,
    showDebug,
    stageOnly,
    onExitStage,
    tint,
  },
  avatarRef,
) {
  const activeFrameSrc = frameSrc(activeSheet, cell.row, cell.col, character.id);
  const tintOverlaySrc = useAvatarTintOverlay(activeFrameSrc, tint);
  const orderedFrames = useMemo(() => {
    const activeIndex = frames.findIndex((frame) => frame.sheet === activeSheet
      && frame.row === cell.row
      && frame.col === cell.col);
    if (activeIndex <= 0) return frames;

    const activeFrame = frames[activeIndex];
    return [
      activeFrame,
      ...frames.slice(0, activeIndex),
      ...frames.slice(activeIndex + 1),
    ];
  }, [activeSheet, cell.col, cell.row, frames]);

  return (
    <section className="stage" aria-label="Avatar stage">
      {stageOnly && (
        <button className="stage-exit" type="button" onClick={onExitStage}>
          <Pause size={16} aria-hidden="true" />
          Exit stage
        </button>
      )}

      <div
        className={pressed ? 'avatar is-pressed' : 'avatar'}
        ref={avatarRef}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
      >
        {orderedFrames.map((frame) => {
          const isActiveFrame = frame.sheet === activeSheet
            && frame.row === cell.row
            && frame.col === cell.col;

          return (
            <img
              key={`${frame.sheet}-${frame.row}-${frame.col}`}
              alt=""
              aria-hidden="true"
              className="avatar__frame"
              draggable="false"
              decoding={isActiveFrame ? 'sync' : 'async'}
              fetchPriority={isActiveFrame ? 'high' : 'low'}
              loading={isActiveFrame ? 'eager' : 'lazy'}
              src={frame.src}
              style={{ opacity: isActiveFrame ? 1 : 0 }}
            />
          );
        })}
        {tintOverlaySrc && (
          <img
            alt=""
            aria-hidden="true"
            className="avatar__tint-layer"
            draggable="false"
            decoding="async"
            src={tintOverlaySrc}
          />
        )}
      </div>

      {!stageOnly && (
        <div className="stage-hud">
          <span>{isTalkMode ? 'Talk pose' : 'Gaze pose'}</span>
          <strong>{character.label} / {activeSheet} / r{cell.row} c{cell.col}</strong>
          {isTalkMode && <span>{Math.round(audioLevel * 100)}% / mouth {mouth}</span>}
        </div>
      )}

      {showDebug && !stageOnly && (
        <DebugGrid row={cell.row} col={cell.col} />
      )}
    </section>
  );
});

function DebugGrid({ row, col }) {
  return (
    <div className="debug-grid" aria-label="Current direction cell">
      {Array.from({ length: 25 }, (_, index) => {
        const currentRow = Math.floor(index / 5);
        const currentCol = index % 5;
        return (
          <span
            key={`${currentRow}-${currentCol}`}
            className={currentRow === row && currentCol === col ? 'is-active' : ''}
          />
        );
      })}
    </div>
  );
}

function TuningPanel({
  tuning,
  patchTuning,
  resetTuning,
  mode,
  cell,
  character,
  mouth,
  poseVariant,
}) {
  return (
    <aside className="panel tuning-panel" aria-label="Tuning">
      <PanelTitle icon={SlidersHorizontal} title="Tuning" />

      <ControlGroup title="Motion" icon={MousePointer2}>
        <RangeControl
          label="Follow range"
          value={tuning.followRange}
          min={120}
          max={1200}
          step={10}
          unit="px"
          onChange={(followRange) => patchTuning({ followRange })}
        />
        <RangeControl
          label="Smoothing"
          value={tuning.smoothing}
          min={0.04}
          max={0.5}
          step={0.01}
          onChange={(smoothing) => patchTuning({ smoothing })}
        />
        <RangeControl
          label="Avatar size"
          value={tuning.avatarSize}
          min={30}
          max={92}
          step={1}
          unit="vmin"
          onChange={(avatarSize) => patchTuning({ avatarSize })}
        />
      </ControlGroup>

      {mode === 'talk' && (
        <ControlGroup title="Lip sync" icon={Gauge}>
          <RangeControl
            label="Mic gain"
            value={tuning.micGain}
            min={0.3}
            max={5}
            step={0.1}
            onChange={(micGain) => patchTuning({ micGain })}
          />
          <RangeControl
            label="Half mouth"
            value={tuning.thresholdHalf}
            min={0.01}
            max={0.3}
            step={0.005}
            onChange={(thresholdHalf) => patchTuning({ thresholdHalf })}
          />
          <RangeControl
            label="Open mouth"
            value={tuning.thresholdFull}
            min={0.05}
            max={0.4}
            step={0.005}
            onChange={(thresholdFull) => patchTuning({ thresholdFull })}
          />
          <RangeControl
            label="Release"
            value={tuning.release}
            min={0.03}
            max={0.4}
            step={0.01}
            onChange={(release) => patchTuning({ release })}
          />
        </ControlGroup>
      )}

      <ControlGroup title="Appearance" icon={Palette}>
        <SegmentedControl
          label="Character"
          value={character.id}
          options={CHARACTER_OPTIONS}
          onChange={(characterId) => patchTuning({ characterId })}
        />
        {character.poseVariants?.length > 0 && poseVariant && (
          <SegmentedControl
            label="Arm pose"
            value={poseVariant.id}
            options={character.poseVariants}
            onChange={(nextPoseVariant) => patchTuning({ poseVariant: nextPoseVariant })}
          />
        )}
        {character.supportsTint && (
          <>
            <SegmentedControl
              label="Filter"
              value={tuning.colorFilter}
              options={COLOR_FILTERS}
              onChange={(colorFilter) => patchTuning({ colorFilter })}
            />
            <ColorSwatches
              label="Hair"
              value={tuning.hairColor}
              options={HAIR_COLORS}
              onChange={(hairColor) => patchTuning({ hairColor })}
            />
            <RangeControl
              label="Hair mix"
              value={tuning.hairTint}
              min={0}
              max={0.85}
              step={0.05}
              onChange={(hairTint) => patchTuning({ hairTint })}
            />
            <ColorSwatches
              label="Eyes"
              value={tuning.eyeColor}
              options={EYE_COLORS}
              onChange={(eyeColor) => patchTuning({ eyeColor })}
            />
            <RangeControl
              label="Eye mix"
              value={tuning.eyeTint}
              min={0}
              max={0.95}
              step={0.05}
              onChange={(eyeTint) => patchTuning({ eyeTint })}
            />
          </>
        )}
      </ControlGroup>

      <ControlGroup title="Stage" icon={Settings2}>
        <ColorSwatches
          label="Background"
          value={tuning.background}
          options={BACKGROUNDS}
          onChange={(background) => patchTuning({ background })}
        />
        <SwitchControl
          label="Auto blink"
          value={tuning.autoBlink}
          onChange={(autoBlink) => patchTuning({ autoBlink })}
          iconOn={Eye}
          iconOff={EyeOff}
        />
        <SwitchControl
          label="Debug grid"
          value={tuning.showDebug}
          onChange={(showDebug) => patchTuning({ showDebug })}
          iconOn={Bug}
          iconOff={Bug}
        />
      </ControlGroup>

      <div className="state-readout">
        <span>State</span>
        <strong>r{cell.row} c{cell.col} / {mouth.shortLabel}</strong>
      </div>

      <button className="text-button" type="button" onClick={resetTuning}>
        Reset tuning
      </button>
    </aside>
  );
}

function AssetInventory({ onModeChange }) {
  const manifest = useMemo(() => (
    CHARACTER_OPTIONS.flatMap((character) => assetManifest(character.id))
  ), []);
  const sampleStrip = useMemo(() => (
    manifest.filter((item, index, list) => (
      index === list.findIndex((entry) => entry.characterId === item.characterId)
    ))
  ), [manifest]);

  return (
    <section className="asset-board" aria-label="Asset inventory">
      <div className="asset-board__header">
        <div>
          <p className="eyebrow">Character frames</p>
          <h1>{manifest.length} sheets / {manifest.reduce((total, item) => total + item.frameCount, 0)} exported poses</h1>
        </div>
        <button className="command-button command-button--compact" type="button" onClick={() => onModeChange('talk')}>
          <ChevronRight size={17} aria-hidden="true" />
          Back to studio
        </button>
      </div>

      <div className="asset-grid">
        {manifest.map((item) => (
          <article className="asset-tile" key={item.sheet}>
            <img src={item.preview} alt="" draggable="false" />
            <div>
              <span className="asset-tile__sheet">{item.sheet}</span>
              <strong>{item.name}</strong>
              <small>{item.character} · {item.frameCount} frames</small>
            </div>
            <span className="status-dot">
              <Check size={13} aria-hidden="true" />
            </span>
          </article>
        ))}
      </div>

      <div className="asset-strip">
        {sampleStrip.flatMap((item) => (
          Array.from({ length: 5 }, (_, row) => (
            <img
              key={`${item.characterId}-${row}`}
              src={frameSrc(item.sheet, row, 2, item.characterId)}
              alt=""
              draggable="false"
            />
          ))
        ))}
      </div>
    </section>
  );
}

function PanelTitle({ icon: Icon, title }) {
  return (
    <div className="panel-title">
      <Icon size={18} aria-hidden="true" />
      <h2>{title}</h2>
    </div>
  );
}

function ControlGroup({ title, icon: Icon, children }) {
  return (
    <section className="control-group">
      <div className="control-group__title">
        <Icon size={15} aria-hidden="true" />
        <span>{title}</span>
      </div>
      {children}
    </section>
  );
}

function RangeControl({ label, value, min, max, step, unit = '', onChange }) {
  return (
    <label className="range-control">
      <span>
        <span>{label}</span>
        <strong>{value}{unit}</strong>
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

function SwitchControl({ label, value, onChange, iconOn: IconOn, iconOff: IconOff }) {
  const Icon = value ? IconOn : IconOff;
  return (
    <button
      className={value ? 'switch-control is-on' : 'switch-control'}
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
    >
      <Icon size={15} aria-hidden="true" />
      <span>{label}</span>
      <i aria-hidden="true" />
    </button>
  );
}

function SegmentedControl({ label, value, options, onChange }) {
  return (
    <div className="segmented-control">
      <span>{label}</span>
      <div className="segmented-control__options">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={option.id === value ? 'is-active' : ''}
            aria-pressed={option.id === value}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorSwatches({ label, value, options, onChange }) {
  return (
    <div className="color-control">
      <span>{label}</span>
      <div className="color-control__options">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={option === value ? 'is-active' : ''}
            style={{ background: option }}
            title={option}
            aria-label={`${label} ${option}`}
            onClick={() => onChange(option)}
          />
        ))}
      </div>
    </div>
  );
}
