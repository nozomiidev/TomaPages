import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { AudioLines, Bot, Check, Copy, Mic, MicOff, Radio, Shuffle, Signal, Upload, Users } from 'lucide-react';
import { frameSrc, sheetForPose } from './domain/character';
import {
  AGENT_BRIDGE_PROTOCOL,
  AGENT_BRIDGE_READY_TYPE,
  AGENT_PEER_TTL_MS,
  createAgentBridge,
} from './domain/agent-bridge';
import { AGENT_PILOT_ID, AGENT_PILOT_ROOM_ID, makeAgentPilotPeer } from './domain/agent-pilot';
import {
  createPresenceTransport,
  getTabPeerId,
  makeRandomRoomId,
  makeRoomUrl,
  readDisplayName,
  readRoomId,
} from './domain/presence-transport';
import {
  ROOM_CARD_BASE_HEIGHT,
  ROOM_CARD_BASE_WIDTH,
  computeRoomSceneLayout,
  isPointInLayout,
} from './domain/room-layout';
import {
  isPointerInsideRect,
  makeRoomHoverSnapshot,
  nextSingleHoverCells,
  pointerToRoomCardCell,
} from './domain/room-hover';
import { readDemoPeerPreference, shouldIncludeDemoPeers } from './domain/room-peers';
import {
  getPeerFreshness,
  normalizeRoomPeerState,
  summarizeRoomActivity,
  summarizeRoomPeerStates,
  summarizeRoomPresence,
} from './domain/room-presence';
import { makeRoomSessionStatus } from './domain/room-session';
import { useAvatarTintOverlay } from './hooks/use-avatar-tint-overlay';

const ROOM_NAME = 'Codec Lobby';
const SOURCE_LABELS = {
  agent: 'AI',
  demo: 'SIM',
  local: 'YOU',
  p2p: 'P2P',
  tab: 'TAB',
};

const DEMO_PEERS = [
  {
    id: 'demo-meryl',
    name: 'Meryl',
    role: 'Signal Scout',
    source: 'demo',
    cell: { row: 2, col: 1 },
    mouth: 1,
    audioLevel: 0.34,
    hairColor: '#854D0E',
    hairTint: 0.38,
    eyeColor: '#E35D75',
    eyeTint: 0.62,
    colorFilter: 'natural',
  },
  {
    id: 'demo-otacon',
    name: 'Otacon',
    role: 'Support Feed',
    source: 'demo',
    cell: { row: 1, col: 3 },
    mouth: 0,
    audioLevel: 0.08,
    hairColor: '#0F766E',
    hairTint: 0.52,
    eyeColor: '#2BA7E8',
    eyeTint: 0.72,
    colorFilter: 'natural',
  },
  {
    id: 'demo-naomi',
    name: 'Naomi',
    role: 'Bio Link',
    source: 'demo',
    cell: { row: 3, col: 2 },
    mouth: 2,
    audioLevel: 0.56,
    hairColor: '#6D5BD0',
    hairTint: 0.46,
    eyeColor: '#A855F7',
    eyeTint: 0.66,
    colorFilter: 'natural',
  },
];

function createLocalPeerId() {
  return getTabPeerId();
}

function peerSort(left, right) {
  const rank = { local: 0, p2p: 1, tab: 2, agent: 3, demo: 4 };
  const leftRank = rank[left.source] ?? 9;
  const rightRank = rank[right.source] ?? 9;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.name.localeCompare(right.name);
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] ?? String(source || 'PEER').slice(0, 4).toUpperCase();
}

function sourceAccent(source) {
  if (source === 'local' || source === 'p2p') return '#0f766e';
  if (source === 'tab') return '#2563eb';
  if (source === 'agent') return '#8b5cf6';
  return '#aeb5bc';
}

function rosterMetaLabel(source, freshness) {
  if (source === 'local') return 'you';
  if (source === 'demo') return 'sim';
  return `${sourceLabel(source)} / ${freshness.label}`;
}

function drawRoundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(x, y, width, height, radius);
    return;
  }

  const r = Math.min(radius, width / 2, height / 2);
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
}

function drawFallbackCard(context, layout, peer) {
  const source = peer.source || 'peer';
  const accent = sourceAccent(source);
  const scale = layout.scale || 1;
  const padding = Math.max(8, 12 * scale);
  const badgeHeight = Math.max(18, 24 * scale);
  const avatarRadius = Math.max(22, 44 * scale);
  const avatarX = layout.x + layout.width / 2;
  const avatarY = layout.y + layout.height * 0.47;

  context.save();
  drawRoundedRect(context, layout.x, layout.y, layout.width, layout.height, Math.max(6, 8 * scale));
  context.fillStyle = 'rgba(255, 255, 255, 0.96)';
  context.fill();
  context.strokeStyle = 'rgba(29, 31, 34, 0.12)';
  context.stroke();

  context.fillStyle = accent;
  context.fillRect(layout.x, layout.y, layout.width, Math.max(2, 3 * scale));

  drawRoundedRect(context, layout.x + padding, layout.y + padding, Math.max(34, 44 * scale), badgeHeight, 6 * scale);
  context.fillStyle = source === 'demo' ? 'rgba(246, 247, 248, 0.92)' : 'rgba(239, 250, 247, 0.92)';
  context.fill();
  context.strokeStyle = source === 'demo' ? 'rgba(105, 112, 119, 0.18)' : 'rgba(15, 118, 110, 0.18)';
  context.stroke();
  context.fillStyle = source === 'demo' ? '#56606a' : accent;
  context.font = `800 ${Math.max(9, 10 * scale)}px Inter, system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(sourceLabel(source), layout.x + padding + Math.max(17, 22 * scale), layout.y + padding + badgeHeight / 2);

  context.beginPath();
  context.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
  context.fillStyle = 'rgba(240, 245, 243, 0.82)';
  context.fill();
  context.strokeStyle = 'rgba(15, 118, 110, 0.12)';
  context.stroke();

  context.beginPath();
  context.arc(avatarX, avatarY, Math.max(10, 18 * scale), 0, Math.PI * 2);
  context.fillStyle = 'rgba(15, 118, 110, 0.16)';
  context.fill();

  context.textAlign = 'left';
  context.fillStyle = '#202124';
  context.font = `760 ${Math.max(11, 14 * scale)}px Inter, system-ui, sans-serif`;
  context.fillText(peer.name || 'Peer', layout.x + padding, layout.y + layout.height - Math.max(22, 28 * scale));
  context.fillStyle = '#697077';
  context.font = `720 ${Math.max(9, 11 * scale)}px Inter, system-ui, sans-serif`;
  context.fillText('syncing snapshot', layout.x + padding, layout.y + layout.height - Math.max(9, 12 * scale));
  context.restore();
}

function usePresenceRoom({ localPeer, roomId }) {
  const [remotePeers, setRemotePeers] = useState({});
  const [transportStatus, setTransportStatus] = useState({
    local: 'ready',
    p2p: 'starting',
  });
  const localPeerRef = useRef(localPeer);
  const transportRef = useRef(null);
  const remotePeerList = useMemo(() => Object.values(remotePeers), [remotePeers]);

  useEffect(() => {
    const transport = createPresenceTransport({
      roomId,
      selfId: localPeer.id,
      onPeer: (peer) => {
        setRemotePeers((current) => ({
          ...current,
          [peer.id]: peer,
        }));
      },
      onPeerLeave: (peerId) => {
        setRemotePeers((current) => {
          const next = { ...current };
          delete next[peerId];
          return next;
        });
      },
      onStatus: setTransportStatus,
    });
    transportRef.current = transport;
    return () => {
      transport.leave();
      transportRef.current = null;
    };
  }, [localPeer.id, roomId]);

  useEffect(() => {
    localPeerRef.current = localPeer;
    transportRef.current?.publish(localPeer);
  }, [localPeer]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      transportRef.current?.publish(localPeerRef.current);
    }, 2200);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      setRemotePeers((current) => Object.fromEntries(
        Object.entries(current).filter(([, peer]) => now - peer.receivedAt < 18000),
      ));
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, []);

  return {
    remotePeers: remotePeerList,
    transportStatus,
  };
}

function useAgentBridgeRoom({ roomId }) {
  const [agentPeers, setAgentPeers] = useState({});
  const [channelName, setChannelName] = useState('');
  const bridgeRef = useRef(null);
  const agentPeerList = useMemo(() => Object.values(agentPeers), [agentPeers]);

  useEffect(() => {
    const bridge = createAgentBridge({
      roomId,
      onPeer: (peer) => {
        setAgentPeers((current) => ({
          ...current,
          [peer.id]: peer,
        }));
      },
      onPeerLeave: (peerId) => {
        setAgentPeers((current) => {
          const next = { ...current };
          delete next[peerId];
          return next;
        });
      },
    });
    bridgeRef.current = bridge;
    setChannelName(bridge.channelName);
    return () => {
      bridge.close();
      bridgeRef.current = null;
    };
  }, [roomId]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      setAgentPeers((current) => Object.fromEntries(
        Object.entries(current).filter(([, peer]) => now - peer.receivedAt < AGENT_PEER_TTL_MS),
      ));
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, []);

  const publishAgentPeer = useCallback((peer) => {
    bridgeRef.current?.publish(peer);
  }, []);
  const leaveAgentPeer = useCallback((peerId) => {
    bridgeRef.current?.leave(peerId);
  }, []);

  return {
    agentBridge: {
      channelName,
      status: channelName ? 'ready' : 'starting',
    },
    agentPeers: agentPeerList,
    leaveAgentPeer,
    publishAgentPeer,
  };
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection-based copy path below.
    }
  }

  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  document.body.append(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  return copied;
}

function waitForImage(image) {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => resolve();
    const timeoutId = window.setTimeout(done, 900);
    const finish = () => {
      window.clearTimeout(timeoutId);
      done();
    };

    image.addEventListener('load', finish, { once: true });
    image.addEventListener('error', finish, { once: true });
  });
}

async function waitForImages(node) {
  await Promise.all(Array.from(node.querySelectorAll('img'), waitForImage));
}

function RoomAvatar({ peer }) {
  const activeSheet = sheetForPose({ blink: false, mouth: peer.mouth ?? 0 });
  const src = frameSrc(activeSheet, peer.cell?.row ?? 2, peer.cell?.col ?? 2);
  const overlay = useAvatarTintOverlay(src, {
    filterMode: peer.colorFilter,
    hairColor: peer.hairColor,
    hairStrength: peer.hairTint,
    eyeColor: peer.eyeColor,
    eyeStrength: peer.eyeTint,
  });

  return (
    <div className="room-avatar">
      <img alt="" draggable="false" src={src} />
      {overlay && <img alt="" className="room-avatar__tint" draggable="false" src={overlay} />}
    </div>
  );
}

function RoomCard({ peer, live = false }) {
  const source = peer.source || 'peer';
  const peerState = normalizeRoomPeerState(peer);
  const isSpeaking = peerState.speaking;
  const className = [
    'room-card',
    live ? 'room-card--live' : '',
    `room-card--source-${source}`,
    isSpeaking ? 'room-card--speaking' : '',
  ].filter(Boolean).join(' ');

  return (
    <article
      className={className}
      data-room-card-cell={peerState.cell}
      data-room-card-audio={peerState.audioLevel}
      data-room-card-audio-percent={peerState.audioPercent}
      data-room-card-live={live ? 'true' : 'false'}
      data-room-card-mouth={peerState.mouth}
      data-room-card-peer-id={peer.id}
      data-room-card-speaking={peerState.speaking ? 'true' : 'false'}
      data-room-card-source={source}
    >
      <div className="room-card__signal">
        <span className={`room-card__badge room-card__badge--${source}`}>
          {sourceLabel(source)}
        </span>
        <i style={{ width: `${Math.round((peer.audioLevel ?? 0) * 100)}%` }} />
      </div>
      <RoomAvatar peer={peer} />
      <div className="room-card__copy">
        <strong>{peer.name}</strong>
        <span>{peer.role}</span>
      </div>
    </article>
  );
}

function RoomLiveControls({ controls }) {
  if (!controls) return null;

  const {
    activeMouth,
    audioError,
    audioLevel,
    fileName,
    micOn,
    onAudioFile,
    onDemoSync,
    onMicToggle,
  } = controls;

  return (
    <div className="room-live-controls">
      <button
        className={micOn ? 'room-live-controls__button is-live' : 'room-live-controls__button'}
        type="button"
        onClick={onMicToggle}
      >
        {micOn ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
        <span>{micOn ? 'Stop mic' : 'Start mic'}</span>
      </button>
      <button className="room-live-controls__button" type="button" onClick={onDemoSync}>
        <AudioLines size={15} aria-hidden="true" />
        <span>Test sync</span>
      </button>
      <label className="room-live-controls__button">
        <Upload size={15} aria-hidden="true" />
        <span>Audio file</span>
        <input type="file" accept="audio/*" onChange={onAudioFile} />
      </label>
      <div className="room-live-meter" aria-label="Local audio level">
        <span>{fileName || activeMouth?.label || 'Closed'}</span>
        <i>
          <b style={{ width: `${Math.round((audioLevel ?? 0) * 100)}%` }} />
        </i>
      </div>
      {audioError && <p className="room-live-error" role="alert">{audioError}</p>}
    </div>
  );
}

function RoomRoster({ activePeerId, now, peers }) {
  return (
    <div className="room-roster" aria-label="Room participants">
      {peers.map((peer) => {
        const source = peer.source || 'peer';
        const freshness = getPeerFreshness(peer, { now });
        const className = [
          'room-roster__peer',
          `room-roster__peer--${source}`,
          activePeerId === peer.id ? 'is-active' : '',
          (peer.audioLevel ?? 0) > 0.2 ? 'is-speaking' : '',
          freshness.state === 'stale' ? 'is-stale' : '',
        ].filter(Boolean).join(' ');

        return (
          <div
            key={peer.id}
            className={className}
            title={`${peer.name} / ${sourceLabel(source)} / ${freshness.label}`}
          >
            <span>{peer.name}</span>
            <small>{rosterMetaLabel(source, freshness)}</small>
            <i aria-hidden="true">
              <b style={{ width: `${Math.round((peer.audioLevel ?? 0) * 100)}%` }} />
            </i>
          </div>
        );
      })}
    </div>
  );
}

function RoomSessionStrip({ presenceSummary, roomActivity, sessionStatus }) {
  return (
    <div className="room-session-strip" aria-label="Room session status">
      <span className="room-session-strip__state" data-state={sessionStatus.state}>
        <Radio size={15} aria-hidden="true" />
        <b>{sessionStatus.stateLabel}</b>
      </span>
      <span>
        <Users size={15} aria-hidden="true" />
        <b>{presenceSummary.live}/{presenceSummary.total}</b>
        <small>Peers</small>
      </span>
      <span>
        <Signal size={15} aria-hidden="true" />
        <b>{sessionStatus.meshLabel}</b>
        <small>Mesh</small>
      </span>
      <span title={roomActivity.speakingNames || 'Quiet'}>
        <AudioLines size={15} aria-hidden="true" />
        <b>{sessionStatus.speakingLabel}</b>
        <small>Voice</small>
      </span>
      <span>
        <Check size={15} aria-hidden="true" />
        <b>{sessionStatus.snapshotHealth}</b>
        <small>Canvas</small>
      </span>
      <span>
        <Bot size={15} aria-hidden="true" />
        <b>{sessionStatus.agentLabel}</b>
        <small>MCP</small>
      </span>
    </div>
  );
}

export function RoomView({ liveControls, localState, tuning }) {
  const roomId = useMemo(() => readRoomId(), []);
  const demoPeerPreference = useMemo(() => readDemoPeerPreference(window.location.search), []);
  const localPeerId = useMemo(createLocalPeerId, []);
  const localPeerName = useMemo(() => readDisplayName({ fallbackId: localPeerId }), [localPeerId]);
  const canvasRef = useRef(null);
  const snapshotNodesRef = useRef(new Map());
  const snapshotsRef = useRef(new Map());
  const layoutsRef = useRef(new Map());
  const [snapshotVersion, setSnapshotVersion] = useState(0);
  const [snapshotHealth, setSnapshotHealth] = useState({
    failed: 0,
    ready: 0,
  });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [hoveredPeerId, setHoveredPeerId] = useState('');
  const [hoverCells, setHoverCells] = useState({});
  const [agentPilotEnabled, setAgentPilotEnabled] = useState(false);
  const [copyState, setCopyState] = useState('idle');
  const [roomClock, setRoomClock] = useState(() => Date.now());
  const roomUrl = useMemo(() => makeRoomUrl({
    roomId,
    name: localPeerName,
  }), [localPeerName, roomId]);

  const localPeer = useMemo(() => ({
    id: localPeerId,
    name: localPeerName,
    role: 'Live uplink',
    source: 'local',
    cell: hoverCells[localPeerId] ?? localState.cell,
    mouth: localState.mouth,
    audioLevel: localState.audioLevel,
    hairColor: tuning.hairColor,
    hairTint: tuning.hairTint,
    eyeColor: tuning.eyeColor,
    eyeTint: tuning.eyeTint,
    colorFilter: tuning.colorFilter,
  }), [hoverCells, localPeerId, localPeerName, localState.audioLevel, localState.cell, localState.mouth, tuning.colorFilter, tuning.eyeColor, tuning.eyeTint, tuning.hairColor, tuning.hairTint]);

  const { remotePeers, transportStatus } = usePresenceRoom({ localPeer, roomId });
  const {
    agentBridge,
    agentPeers,
    leaveAgentPeer,
    publishAgentPeer,
  } = useAgentBridgeRoom({ roomId });
  const agentPilotPresent = agentPeers.some((peer) => peer.id === AGENT_PILOT_ROOM_ID);
  const demoPeers = useMemo(() => (
    shouldIncludeDemoPeers({
      agentCount: agentPeers.length,
      preference: demoPeerPreference,
      remoteCount: remotePeers.length,
    }) ? DEMO_PEERS : []
  ), [agentPeers.length, demoPeerPreference, remotePeers.length]);
  const peers = useMemo(() => (
    [localPeer, ...remotePeers, ...agentPeers, ...demoPeers]
      .map((peer) => ({
        ...peer,
        cell: hoverCells[peer.id] ?? peer.cell,
      }))
      .sort(peerSort)
  ), [agentPeers, demoPeers, hoverCells, localPeer, remotePeers]);
  const roomActivity = useMemo(() => summarizeRoomActivity(peers), [peers]);
  const peerDiagnostics = useMemo(() => summarizeRoomPeerStates(peers), [peers]);
  const presenceSummary = useMemo(() => summarizeRoomPresence(peers), [peers]);
  const sessionStatus = useMemo(() => makeRoomSessionStatus({
    agentBridgeStatus: agentBridge.status,
    presenceSummary,
    roomActivity,
    snapshotHealth,
    transportStatus,
  }), [agentBridge.status, presenceSummary, roomActivity, snapshotHealth, transportStatus]);
  const hoveredPeer = peers.find((peer) => peer.id === hoveredPeerId);
  const hoveredCell = hoveredPeerId ? hoverCells[hoveredPeerId] : null;
  const hoverSnapshot = useMemo(() => makeRoomHoverSnapshot({
    hoverCell: hoveredCell,
    hoveredPeer,
  }), [hoveredCell, hoveredPeer]);
  const roomScene = useMemo(() => (
    computeRoomSceneLayout(canvasSize.width, canvasSize.height, peers.length)
  ), [canvasSize.height, canvasSize.width, peers.length]);
  const peerSnapshotKey = peers.map((peer) => [
    peer.id,
    peer.cell?.row,
    peer.cell?.col,
    peer.mouth,
    peer.hairColor,
    peer.hairTint,
    peer.eyeColor,
    peer.eyeTint,
    peer.colorFilter,
  ].join(':')).join('|');

  const setSnapshotNode = useCallback((peerId, node) => {
    if (node) snapshotNodesRef.current.set(peerId, node);
    else snapshotNodesRef.current.delete(peerId);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => setRoomClock(Date.now()), 3000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      setCanvasSize({
        width: rect.width,
        height: rect.height,
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const captureSnapshots = async () => {
      const peerIds = new Set(peers.map((peer) => peer.id));
      const prunedSnapshots = new Map(
        Array.from(snapshotsRef.current.entries()).filter(([peerId]) => peerIds.has(peerId)),
      );
      if (prunedSnapshots.size !== snapshotsRef.current.size) {
        snapshotsRef.current = prunedSnapshots;
      }

      let failed = 0;
      const prioritizedPeers = [...peers].sort((left, right) => (
        Number(snapshotsRef.current.has(left.id)) - Number(snapshotsRef.current.has(right.id))
      ));

      for (const peer of prioritizedPeers) {
        const node = snapshotNodesRef.current.get(peer.id);
        if (!node) continue;
        if (cancelled) return;

        try {
          await waitForImages(node);
          if (cancelled) return;
          const snapshot = await html2canvas(node, {
            backgroundColor: null,
            logging: false,
            scale: 2,
            useCORS: true,
          });
          if (cancelled) return;
          snapshotsRef.current = new Map(snapshotsRef.current).set(peer.id, snapshot);
          setSnapshotHealth({
            failed,
            ready: snapshotsRef.current.size,
          });
          setSnapshotVersion((value) => value + 1);
        } catch {
          failed += 1;
          if (!cancelled) {
            setSnapshotHealth({
              failed,
              ready: snapshotsRef.current.size,
            });
          }
        }
      }
    };
    const timerIds = [
      window.setTimeout(captureSnapshots, 260),
      window.setTimeout(captureSnapshots, 1200),
    ];

    return () => {
      cancelled = true;
      timerIds.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [peerSnapshotKey, peers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width === 0 || canvasSize.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvasSize.width * dpr);
    canvas.height = Math.round(canvasSize.height * dpr);
    const context = canvas.getContext('2d');
    if (!context) return;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, canvasSize.width, canvasSize.height);
    const background = context.createLinearGradient(0, 0, canvasSize.width, canvasSize.height);
    background.addColorStop(0, '#faf8f2');
    background.addColorStop(0.52, '#f7faf8');
    background.addColorStop(1, '#f3f5f8');
    context.fillStyle = background;
    context.fillRect(0, 0, canvasSize.width, canvasSize.height);

    context.save();
    context.strokeStyle = 'rgba(32, 37, 41, 0.045)';
    context.lineWidth = 1;
    for (let x = 24; x < canvasSize.width; x += 48) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvasSize.height);
      context.stroke();
    }
    for (let y = 24; y < canvasSize.height; y += 48) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvasSize.width, y);
      context.stroke();
    }
    context.restore();

    const layouts = roomScene.layouts;
    const nextLayoutMap = new Map();

    context.save();
    context.strokeStyle = 'rgba(15, 118, 110, 0.14)';
    context.lineWidth = 1;
    context.setLineDash([8, 10]);
    layouts.forEach((layout, index) => {
      if (index === 0) return;
      const origin = layouts[0];
      const originX = origin.x + origin.width / 2;
      const originY = origin.y + origin.height / 2;
      const targetX = layout.x + layout.width / 2;
      const targetY = layout.y + layout.height / 2;
      const controlY = (originY + targetY) / 2;
      context.beginPath();
      context.moveTo(originX, originY);
      context.bezierCurveTo(originX, controlY, targetX, controlY, targetX, targetY);
      context.stroke();
    });
    context.setLineDash([]);
    layouts.forEach((layout, index) => {
      const centerX = layout.x + layout.width / 2;
      const centerY = layout.y + layout.height / 2;
      context.beginPath();
      context.fillStyle = index === 0 ? 'rgba(15, 118, 110, 0.18)' : 'rgba(255, 255, 255, 0.72)';
      context.arc(centerX, centerY, index === 0 ? 5 : 4, 0, Math.PI * 2);
      context.fill();
    });
    context.restore();

    peers.forEach((peer, index) => {
      const layout = layouts[index];
      nextLayoutMap.set(peer.id, layout);
      const snapshot = snapshotsRef.current.get(peer.id);

      context.save();
      context.shadowColor = 'rgba(32, 37, 41, 0.14)';
      context.shadowBlur = hoveredPeerId === peer.id ? 24 : 16;
      context.shadowOffsetY = 10;
      if (snapshot) {
        context.drawImage(snapshot, layout.x, layout.y, layout.width, layout.height);
      } else {
        drawFallbackCard(context, layout, peer);
      }
      context.restore();

      if (hoveredPeerId === peer.id) {
        context.strokeStyle = '#0f766e';
        context.lineWidth = 2;
        context.strokeRect(layout.x + 1, layout.y + 1, layout.width - 2, layout.height - 2);
      }
    });

    layoutsRef.current = nextLayoutMap;
  }, [canvasSize.height, canvasSize.width, hoveredPeerId, peers, roomScene.layouts, snapshotVersion]);

  const updateHover = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const match = [...layoutsRef.current.entries()].find(([, layout]) => isPointInLayout({ x, y }, layout));

    const nextPeerId = match?.[0] ?? '';
    setHoveredPeerId(nextPeerId);

    if (!match) {
      setHoverCells((current) => (Object.keys(current).length ? {} : current));
      return;
    }

    const [peerId, layout] = match;
    const nextCell = pointerToRoomCardCell({
      canvasRect: rect,
      clientX: event.clientX,
      clientY: event.clientY,
      layout,
    });
    setHoverCells((current) => nextSingleHoverCells(current, {
      cell: nextCell,
      peerId,
    }));
  }, []);

  const clearHover = useCallback(() => {
    setHoveredPeerId('');
    setHoverCells((current) => (Object.keys(current).length ? {} : current));
  }, []);

  useEffect(() => {
    if (!agentPilotEnabled || agentBridge.status !== 'ready') return undefined;

    let tick = 0;
    publishAgentPeer(makeAgentPilotPeer({ tick }));
    const intervalId = window.setInterval(() => {
      tick += 1;
      publishAgentPeer(makeAgentPilotPeer({ tick }));
    }, 1600);

    return () => window.clearInterval(intervalId);
  }, [agentBridge.status, agentPilotEnabled, publishAgentPeer]);

  useEffect(() => {
    if (!hoveredPeerId) return undefined;

    const clearWhenOutsideCanvas = (event) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        clearHover();
        return;
      }

      if (!isPointerInsideRect({
        clientX: event.clientX,
        clientY: event.clientY,
        rect: canvas.getBoundingClientRect(),
      })) {
        clearHover();
      }
    };

    window.addEventListener('pointermove', clearWhenOutsideCanvas);
    window.addEventListener('blur', clearHover);
    return () => {
      window.removeEventListener('pointermove', clearWhenOutsideCanvas);
      window.removeEventListener('blur', clearHover);
    };
  }, [clearHover, hoveredPeerId]);

  const hoveredLayout = hoveredPeerId ? layoutsRef.current.get(hoveredPeerId) : null;
  const handleCopyRoom = useCallback(async () => {
    setCopyState('copying');
    const didCopy = await copyText(roomUrl).catch(() => false);
    setCopyState(didCopy ? 'copied' : 'failed');
    window.setTimeout(() => setCopyState('idle'), 1800);
  }, [roomUrl]);
  const handleNewRoom = useCallback(() => {
    window.location.assign(makeRoomUrl({
      roomId: makeRandomRoomId(),
      name: localPeerName,
    }));
  }, [localPeerName]);
  const handleAgentPilotToggle = useCallback(() => {
    if (agentPilotEnabled || agentPilotPresent) {
      leaveAgentPeer(AGENT_PILOT_ID);
      setAgentPilotEnabled(false);
      return;
    }

    setAgentPilotEnabled(true);
    publishAgentPeer(makeAgentPilotPeer());
  }, [agentPilotEnabled, agentPilotPresent, leaveAgentPeer, publishAgentPeer]);

  return (
    <section
      className="room-shell"
      aria-label="Codec room"
      data-agent-bridge-channel={agentBridge.channelName}
      data-agent-bridge-protocol={AGENT_BRIDGE_PROTOCOL}
      data-agent-bridge-ready-type={AGENT_BRIDGE_READY_TYPE}
      data-agent-bridge-status={agentBridge.status}
      data-agent-bridge-ttl-ms={AGENT_PEER_TTL_MS}
      data-agent-pilot-peer={AGENT_PILOT_ROOM_ID}
      data-agent-pilot-status={agentPilotEnabled || agentPilotPresent ? 'active' : 'idle'}
      data-room-agent-peers={presenceSummary.agent}
      data-room-demo-peers={presenceSummary.demo}
      data-room-hover-cell={hoverSnapshot.cell}
      data-room-hover-live-layer={hoverSnapshot.liveLayer}
      data-room-hover-peer={hoverSnapshot.peerId}
      data-room-hover-peer-name={hoverSnapshot.name}
      data-room-hover-source={hoverSnapshot.source}
      data-room-live-peers={presenceSummary.live}
      data-room-local-peers={presenceSummary.local}
      data-room-open-mouth-peer-ids={peerDiagnostics.openMouthIds}
      data-room-open-mouth-label={roomActivity.openMouthLabel}
      data-room-peer-ids={peerDiagnostics.ids}
      data-room-peer-states={peerDiagnostics.states}
      data-room-p2p-peers={presenceSummary.p2p}
      data-room-speaking-peer-ids={peerDiagnostics.speakingIds}
      data-room-speaking-label={roomActivity.speakingLabel}
      data-room-speaking-peers={presenceSummary.speaking}
      data-room-snapshot-failed={snapshotHealth.failed}
      data-room-snapshot-ready={snapshotHealth.ready}
      data-room-snapshot-total={peers.length}
      data-room-session-agent-label={sessionStatus.agentLabel}
      data-room-session-label={sessionStatus.stateLabel}
      data-room-session-mesh-label={sessionStatus.meshLabel}
      data-room-session-snapshot-health={sessionStatus.snapshotHealth}
      data-room-session-state={sessionStatus.state}
      data-room-tab-peers={presenceSummary.tab}
      data-room-total-peers={presenceSummary.total}
      data-room-layout-cols={roomScene.cols}
      data-room-layout-rows={roomScene.rows}
      data-room-layout-scale={roomScene.scale.toFixed(3)}
    >
      <div className="room-toolbar">
        <div className="room-toolbar__identity">
          <p className="eyebrow">Room / {roomId}</p>
          <h1>{ROOM_NAME}</h1>
        </div>
        <div className="room-toolbar__meta">
          <RoomLiveControls controls={liveControls} />
          <div className="room-toolbar__secondary">
            <div className="room-actions">
              <button
                type="button"
                title="Copy room link"
                aria-label="Copy room link"
                onClick={handleCopyRoom}
              >
                {copyState === 'copied' ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                <span>{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy link'}</span>
              </button>
              <button
                type="button"
                title="New room"
                aria-label="New room"
                onClick={handleNewRoom}
              >
                <Shuffle size={15} aria-hidden="true" />
                <span>New room</span>
              </button>
              <button
                type="button"
                title={agentPilotEnabled || agentPilotPresent ? 'Leave agent pilot' : 'Join as agent pilot'}
                aria-label={agentPilotEnabled || agentPilotPresent ? 'Leave agent pilot' : 'Join as agent pilot'}
                disabled={agentBridge.status !== 'ready'}
                onClick={handleAgentPilotToggle}
              >
                <Bot size={15} aria-hidden="true" />
                <span>{agentPilotEnabled || agentPilotPresent ? 'Agent leave' : 'Agent pilot'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <RoomSessionStrip
        presenceSummary={presenceSummary}
        roomActivity={roomActivity}
        sessionStatus={sessionStatus}
      />

      <RoomRoster activePeerId={hoveredPeerId} now={roomClock} peers={peers} />

      <div className="room-stage">
        <canvas
          ref={canvasRef}
          className="room-canvas"
          aria-label="Peer communication canvas"
          onPointerMove={updateHover}
          onPointerLeave={clearHover}
        />
        {hoveredPeer && hoveredLayout && (
          <div
            className="room-live-layer"
            style={{
              left: hoveredLayout.x,
              top: hoveredLayout.y,
              transform: `scale(${hoveredLayout.scale})`,
              width: ROOM_CARD_BASE_WIDTH,
              height: ROOM_CARD_BASE_HEIGHT,
            }}
          >
            <RoomCard peer={hoveredPeer} live />
          </div>
        )}
      </div>

      <div className="room-snapshot-source" aria-hidden="true">
        {peers.map((peer) => (
          <div
            key={peer.id}
            ref={(node) => setSnapshotNode(peer.id, node)}
            className="room-snapshot-card"
          >
            <RoomCard peer={peer} />
          </div>
        ))}
      </div>
    </section>
  );
}
