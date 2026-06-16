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
  Settings2,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { AudioLevelEngine } from './domain/audio-engine';
import {
  allFrames,
  assetManifest,
  frameSrc,
  mouthFromLevel,
  MOUTH_STATES,
  pointerToTarget,
  sheetForPose,
  targetToCell,
} from './domain/character';
import { useAnimationFrame } from './hooks/use-animation-frame';
import { useAvatarTintOverlay } from './hooks/use-avatar-tint-overlay';
import { usePersistentState } from './hooks/use-persistent-state';
import { clamp, lerp } from './lib/math';
import { RoomView } from './room';

const MODES = [
  { id: 'talk', label: 'Talk', icon: AudioLines, path: 'talk.html' },
  { id: 'gaze', label: 'Gaze', icon: MousePointer2, path: 'guruguru.html' },
  { id: 'room', label: 'Room', icon: Radio, path: 'room.html' },
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
  hairColor: '#6D5BD0',
  hairTint: 0,
  eyeColor: '#2BA7E8',
  eyeTint: 0,
  colorFilter: 'grade',
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
  { id: 'grade', label: 'Grade' },
  { id: 'soft', label: 'Soft' },
  { id: 'paint', label: 'Paint' },
];

function detectInitialMode() {
  const bodyMode = document.body.dataset.initialMode;
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();

  if (hash === '#assets') return 'assets';
  if (path.endsWith('/room.html')) return 'room';
  if (path.endsWith('/guruguru.html')) return 'gaze';
  if (path.endsWith('/talk.html')) return 'talk';
  if (MODES.some((mode) => mode.id === bodyMode)) return bodyMode;
  return 'talk';
}

function pathForMode(mode) {
  const target = MODES.find((item) => item.id === mode);
  return target?.path ?? 'talk.html';
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
  if (['grade', 'smooth', 'natural', 'luma', 'preserve'].includes(normalized)) return 'grade';
  return '';
}

function readTuningParams(search = window.location.search) {
  const params = new URLSearchParams(search);
  const patch = {};
  const hairColor = normalizeColorParam(params.get('hair') ?? params.get('hairColor'));
  const eyeColor = normalizeColorParam(params.get('eyes') ?? params.get('eyeColor'));
  const colorFilter = normalizeColorFilter(params.get('filter') ?? params.get('colorFilter'));
  const hairTint = Number(params.get('hairMix') ?? params.get('hairTint'));
  const eyeTint = Number(params.get('eyeMix') ?? params.get('eyeTint'));

  if (hairColor) patch.hairColor = hairColor;
  if (eyeColor) patch.eyeColor = eyeColor;
  if (colorFilter) patch.colorFilter = colorFilter;
  if (Number.isFinite(hairTint)) patch.hairTint = clamp(hairTint, 0, 0.85);
  if (Number.isFinite(eyeTint)) patch.eyeTint = clamp(eyeTint, 0, 0.95);

  return patch;
}

function useModeRouter(initialMode) {
  const [mode, setModeState] = useState(initialMode);

  const setMode = useCallback((nextMode) => {
    setModeState(nextMode);
    const nextPath = pathForMode(nextMode);
    if (window.location.pathname.split('/').pop() + window.location.hash !== nextPath) {
      window.history.pushState({ mode: nextMode }, '', nextPath);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setModeState(detectInitialMode());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const labels = { talk: 'Talk', gaze: 'Gaze', room: 'Room', assets: 'Assets' };
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
  const frames = useMemo(() => allFrames(), []);
  const avatarTint = useMemo(() => ({
    filterMode: tuning.colorFilter,
    hairColor: tuning.hairColor,
    hairStrength: tuning.hairTint,
    eyeColor: tuning.eyeColor,
    eyeStrength: tuning.eyeTint,
  }), [tuning.colorFilter, tuning.eyeColor, tuning.eyeTint, tuning.hairColor, tuning.hairTint]);
  const activeSheet = sheetForPose({
    blink,
    mouth: mode === 'talk' ? mouth : 0,
  });

  useEffect(() => () => engine.dispose(), [engine]);

  useEffect(() => {
    const tuningParams = readTuningParams();
    if (Object.keys(tuningParams).length > 0) patchTuning(tuningParams);
  }, [patchTuning]);

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

    const raw = modeRef.current === 'talk' ? engine.level() * settings.micGain : 0;
    const envelope = envelopeRef.current;
    envelopeRef.current = raw > envelope
      ? envelope + (raw - envelope) * 0.6
      : envelope + (raw - envelope) * settings.release;

    const nextMouth = modeRef.current === 'talk'
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

  const toggleMic = useCallback(async () => {
    setAudioError('');
    setMode('talk');

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

  const handleAudioFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file || !audioElRef.current) return;

    setMode('talk');
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

  const handleDemoSync = useCallback(async () => {
    setMode('talk');
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
    >
      {!stageOnly && (
        <AppHeader mode={mode} setMode={setMode} onStageOnly={() => setStageOnly(true)} />
      )}

      <main className="studio__workspace">
        {!stageOnly && (
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
            tuning={tuning}
          />
        ) : mode === 'assets' && !stageOnly ? (
          <AssetInventory onModeChange={setMode} />
        ) : (
          <AvatarStage
            activeSheet={activeSheet}
            audioLevel={audioLevel}
            cell={cell}
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

        {!stageOnly && mode !== 'room' && (
          <TuningPanel
            tuning={tuning}
            patchTuning={patchTuning}
            resetTuning={() => setTuning(DEFAULT_TUNING)}
            mode={mode}
            cell={cell}
            mouth={activeMouth}
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
  const activeFrameSrc = frameSrc(activeSheet, cell.row, cell.col);
  const tintOverlaySrc = useAvatarTintOverlay(activeFrameSrc, tint);

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
        {frames.map((frame) => (
          <img
            key={`${frame.sheet}-${frame.row}-${frame.col}`}
            alt=""
            aria-hidden="true"
            className="avatar__frame"
            draggable="false"
            decoding="async"
            src={frame.src}
            style={{
              opacity: frame.sheet === activeSheet
                && frame.row === cell.row
                && frame.col === cell.col
                ? 1
                : 0,
            }}
          />
        ))}
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
          <strong>{activeSheet} / r{cell.row} c{cell.col}</strong>
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

function TuningPanel({ tuning, patchTuning, resetTuning, mode, cell, mouth }) {
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
  const manifest = useMemo(() => assetManifest(), []);

  return (
    <section className="asset-board" aria-label="Asset inventory">
      <div className="asset-board__header">
        <div>
          <p className="eyebrow">Character frames</p>
          <h1>6 sheets / 150 exported poses</h1>
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
              <small>{item.frameCount} frames</small>
            </div>
            <span className="status-dot">
              <Check size={13} aria-hidden="true" />
            </span>
          </article>
        ))}
      </div>

      <div className="asset-strip">
        {Array.from({ length: 5 }, (_, row) => (
          <img key={row} src={frameSrc('A', row, 2)} alt="" draggable="false" />
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
