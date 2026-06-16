import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { AudioLines, Bot, Check, Copy, Mic, MicOff, Radio, Shuffle, Signal, Upload, Users } from 'lucide-react';
import { frameSrc, sheetForPose, targetToCell } from './domain/character';
import {
  AGENT_BRIDGE_PROTOCOL,
  AGENT_BRIDGE_READY_TYPE,
  AGENT_PEER_TTL_MS,
  createAgentBridge,
} from './domain/agent-bridge';
import {
  createPresenceTransport,
  getTabPeerId,
  makeRandomRoomId,
  makeRoomUrl,
  readDisplayName,
  readRoomId,
} from './domain/presence-transport';
import { readDemoPeerPreference, shouldIncludeDemoPeers } from './domain/room-peers';
import { getPeerFreshness, summarizeRoomPresence } from './domain/room-presence';
import { useAvatarTintOverlay } from './hooks/use-avatar-tint-overlay';
import { clamp } from './lib/math';

const ROOM_NAME = 'Codec Lobby';
const CARD_WIDTH = 286;
const CARD_HEIGHT = 184;
const CARD_GAP = 18;
const SOURCE_LABELS = {
  agent: 'AI',
  demo: 'SIM',
  local: 'YOU',
  p2p: 'P2P',
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
    colorFilter: 'silk',
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
    colorFilter: 'silk',
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
    colorFilter: 'silk',
  },
];

function createLocalPeerId() {
  return getTabPeerId();
}

function peerSort(left, right) {
  const rank = { local: 0, p2p: 1, agent: 2, demo: 3 };
  const leftRank = rank[left.source] ?? 9;
  const rightRank = rank[right.source] ?? 9;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.name.localeCompare(right.name);
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] ?? String(source || 'PEER').slice(0, 4).toUpperCase();
}

function rosterMetaLabel(source, freshness) {
  if (source === 'local') return 'you';
  if (source === 'demo') return 'sim';
  return `${sourceLabel(source)} · ${freshness.label}`;
}

function computeLayouts(width, height, count) {
  const cols = width > 1020 ? 3 : width > 660 ? 2 : 1;
  const rows = Math.ceil(count / cols);
  const totalWidth = cols * CARD_WIDTH + (cols - 1) * CARD_GAP;
  const totalHeight = rows * CARD_HEIGHT + (rows - 1) * CARD_GAP;
  const startX = Math.max(20, (width - totalWidth) / 2);
  const startY = Math.max(22, (height - totalHeight) / 2);

  return Array.from({ length: count }, (_, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      x: startX + col * (CARD_WIDTH + CARD_GAP),
      y: startY + row * (CARD_HEIGHT + CARD_GAP),
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    };
  });
}

function pointerToCardCell(event, layout, canvas) {
  const rect = canvas.getBoundingClientRect();
  const localX = event.clientX - rect.left - layout.x;
  const localY = event.clientY - rect.top - layout.y;
  const centerX = layout.width * 0.5;
  const centerY = layout.height * 0.48;

  return targetToCell({
    x: clamp((localX - centerX) / (layout.width * 0.38), -1, 1),
    y: clamp((localY - centerY) / (layout.height * 0.32), -1, 1),
  });
}

function usePresenceRoom({ localPeer, roomId }) {
  const [remotePeers, setRemotePeers] = useState({});
  const [transportStatus, setTransportStatus] = useState({
    local: 'ready',
    p2p: 'starting',
  });
  const localPeerRef = useRef(localPeer);
  const transportRef = useRef(null);

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
    remotePeers: Object.values(remotePeers),
    transportStatus,
  };
}

function useAgentBridgeRoom({ roomId }) {
  const [agentPeers, setAgentPeers] = useState({});
  const [channelName, setChannelName] = useState('');

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
    setChannelName(bridge.channelName);
    return () => bridge.close();
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

  return {
    agentBridge: {
      channelName,
      status: channelName ? 'ready' : 'starting',
    },
    agentPeers: Object.values(agentPeers),
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
  const isSpeaking = (peer.audioLevel ?? 0) > 0.2;
  const className = [
    'room-card',
    live ? 'room-card--live' : '',
    `room-card--source-${source}`,
    isSpeaking ? 'room-card--speaking' : '',
  ].filter(Boolean).join(' ');

  return (
    <article className={className}>
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
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [hoveredPeerId, setHoveredPeerId] = useState('');
  const [hoverCells, setHoverCells] = useState({});
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
  const { agentBridge, agentPeers } = useAgentBridgeRoom({ roomId });
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
  const presenceSummary = useMemo(() => summarizeRoomPresence(peers), [peers]);
  const hoveredPeer = peers.find((peer) => peer.id === hoveredPeerId);
  const peerSnapshotKey = peers.map((peer) => [
    peer.id,
    peer.cell?.row,
    peer.cell?.col,
    peer.mouth,
    peer.audioLevel,
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
      const nextSnapshots = new Map();
      for (const peer of peers) {
        const node = snapshotNodesRef.current.get(peer.id);
        if (!node) continue;
        await waitForImages(node);
        if (cancelled) return;
        const snapshot = await html2canvas(node, {
          backgroundColor: null,
          logging: false,
          scale: 2,
          useCORS: true,
        });
        nextSnapshots.set(peer.id, snapshot);
      }

      if (!cancelled) {
        snapshotsRef.current = nextSnapshots;
        setSnapshotVersion((value) => value + 1);
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

    const layouts = computeLayouts(canvasSize.width, canvasSize.height, peers.length);
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
        context.fillStyle = '#ffffff';
        context.fillRect(layout.x, layout.y, layout.width, layout.height);
      }
      context.restore();

      if (hoveredPeerId === peer.id) {
        context.strokeStyle = '#0f766e';
        context.lineWidth = 2;
        context.strokeRect(layout.x + 1, layout.y + 1, layout.width - 2, layout.height - 2);
      }
    });

    layoutsRef.current = nextLayoutMap;
  }, [canvasSize.height, canvasSize.width, hoveredPeerId, peers, snapshotVersion]);

  const updateHover = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const match = [...layoutsRef.current.entries()].find(([, layout]) => (
      x >= layout.x
      && x <= layout.x + layout.width
      && y >= layout.y
      && y <= layout.y + layout.height
    ));

    const nextPeerId = match?.[0] ?? '';
    setHoveredPeerId(nextPeerId);

    if (match) {
      const [peerId, layout] = match;
      const nextCell = pointerToCardCell(event, layout, canvas);
      setHoverCells((current) => {
        const previous = current[peerId];
        if (previous?.row === nextCell.row && previous?.col === nextCell.col) return current;
        return {
          ...current,
          [peerId]: nextCell,
        };
      });
    }
  }, []);

  const clearHover = useCallback(() => setHoveredPeerId(''), []);
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

  return (
    <section
      className="room-shell"
      aria-label="Codec room"
      data-agent-bridge-channel={agentBridge.channelName}
      data-agent-bridge-protocol={AGENT_BRIDGE_PROTOCOL}
      data-agent-bridge-ready-type={AGENT_BRIDGE_READY_TYPE}
      data-agent-bridge-status={agentBridge.status}
      data-agent-bridge-ttl-ms={AGENT_PEER_TTL_MS}
      data-room-agent-peers={presenceSummary.agent}
      data-room-demo-peers={presenceSummary.demo}
      data-room-live-peers={presenceSummary.live}
      data-room-p2p-peers={presenceSummary.p2p}
      data-room-speaking-peers={presenceSummary.speaking}
      data-room-total-peers={presenceSummary.total}
    >
      <div className="room-toolbar">
        <div className="room-toolbar__identity">
          <p className="eyebrow">Room / {roomId}</p>
          <h1>{ROOM_NAME}</h1>
        </div>
        <div className="room-toolbar__meta">
          <RoomLiveControls controls={liveControls} />
          <div className="room-toolbar__secondary">
            <div className="room-status">
              <span data-state={transportStatus.p2p}><Signal size={15} aria-hidden="true" /> {transportStatus.p2p}</span>
              <span title="Live / total peers"><Users size={15} aria-hidden="true" /> {presenceSummary.live}/{presenceSummary.total}</span>
              <span title="Speaking peers"><AudioLines size={15} aria-hidden="true" /> {presenceSummary.speaking}</span>
              <span title={agentBridge.channelName} data-state={agentBridge.status}><Bot size={15} aria-hidden="true" /> Agent {agentBridge.status}</span>
              <span><Radio size={15} aria-hidden="true" /> canvas</span>
            </div>
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
            </div>
          </div>
        </div>
      </div>

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
              width: hoveredLayout.width,
              height: hoveredLayout.height,
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
