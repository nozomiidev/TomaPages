# Agent Bridge

Tomari Studio is hosted as static GitHub Pages, so it cannot keep an MCP server process alive by itself. The Agent Bridge is the browser-side ingress that lets a local MCP server, extension, automation tab, or another same-origin page make an AI agent appear as a room peer.

## Transports

- `BroadcastChannel`: `tomari-studio:agent-bridge:<room-id>`
- `window.postMessage`: same payload shape as the channel
- `window.tomariAgentBridge.publish(peer)`: page-local helper exposed by `room.html`
- `window.tomariAgentBridge.leave(peerId)`: page-local leave helper
- `window.tomariAgentBridge.ping()`: returns and broadcasts bridge readiness metadata
- `window.tomariAgentBridge.makePresence(peer)`: returns a sanitized `agent-presence` message without publishing it
- `window.tomariAgentBridge.makeLeave(peerId)`: returns a sanitized `agent-leave` message without publishing it
- `#tomari-agent-bridge-manifest`: machine-readable JSON for adapters that can inspect DOM but cannot access page globals

The room id is sanitized the same way as normal room links. For `room.html?room=Codec Lobby`, the channel is `tomari-studio:agent-bridge:codec-lobby`.

`room.html` also exposes machine-readable metadata on the root room element:

```html
<section
  data-agent-bridge-channel="tomari-studio:agent-bridge:codec-lobby"
  data-agent-bridge-helper="window.tomariAgentBridge"
  data-agent-bridge-manifest="tomari-agent-bridge-manifest"
  data-agent-bridge-presence-type="agent-presence"
  data-agent-bridge-leave-type="agent-leave"
  data-agent-bridge-protocol="tomari-agent-bridge.v1"
  data-agent-bridge-ready-type="agent-bridge-ready"
  data-agent-bridge-status="ready"
  data-agent-bridge-ttl-ms="22000"
>
```

The JSON manifest mirrors the attributes and adds the supported message types, ingress methods, TTL, and peer fields:

```js
const manifest = JSON.parse(
  document.getElementById('tomari-agent-bridge-manifest').textContent
);
console.log(manifest.channelName);
console.log(manifest.messageTypes.presence);
```

## Ready / Ping

A local MCP adapter can verify that the browser room is open before publishing an agent peer:

```js
const channel = new BroadcastChannel('tomari-studio:agent-bridge:codec-lobby');
channel.onmessage = (event) => {
  if (event.data?.type === 'agent-bridge-ready') {
    console.log(event.data.channelName, event.data.ttlMs);
  }
};

channel.postMessage({
  protocol: 'tomari-agent-bridge.v1',
  type: 'agent-ping',
  roomId: 'codec-lobby'
});
```

The page replies with:

```js
{
  protocol: 'tomari-agent-bridge.v1',
  type: 'agent-bridge-ready',
  roomId: 'codec-lobby',
  channelName: 'tomari-studio:agent-bridge:codec-lobby',
  ttlMs: 22000,
  timestamp: 8192
}
```

## Page Helper

When an MCP adapter controls the already-open browser page, it can use the page-local helper instead of hand-building the envelope:

```js
const bridge = window.tomariAgentBridge;
const ready = bridge.ping();

bridge.publish({
  id: 'codex',
  name: 'Codex',
  role: 'MCP pilot',
  cell: { row: 2, col: 3 },
  mouth: 1,
  audioLevel: 0.42,
  hair: '0F766E',
  hairMix: 0.65,
  eyes: 'A855F7',
  eyeMix: 0.85,
  filter: 'smooth'
});

console.log(ready.channelName);
console.log(bridge.makePresence({ id: 'codex', name: 'Codex' }));
```

The helper sanitizes the peer id, display strings, pose cell, mouth state, audio level, and appearance fields through the same code path as incoming channel messages.

## Built-in Pilot

The `Agent pilot` button in `room.html` publishes a local `Codex Agent` peer through the same `window.tomariAgentBridge.publish(peer)` path that external MCP adapters use. It cycles pose, mouth, and audio level so `data-room-agent-peers`, `data-room-peer-states`, and `data-room-speaking-label` can be checked without running a separate adapter process.

## Presence Payload

```js
{
  protocol: 'tomari-agent-bridge.v1',
  type: 'agent-presence',
  roomId: 'codec-lobby',
  peer: {
    id: 'codex',
    name: 'Codex',
    role: 'MCP pilot',
    cell: { row: 2, col: 3 },
    mouth: 1,
    audioLevel: 0.42,
    hair: '0F766E',
    hairMix: 0.65,
    eyes: 'A855F7',
    eyeMix: 0.85,
    filter: 'smooth'
  }
}
```

`id`, `name`, and `role` are sanitized before rendering. `cell.row` and `cell.col` are clamped to the 5x5 pose grid, `mouth` is clamped to `0..2`, and audio/color strengths are clamped to `0..1`.

## Leave Payload

```js
{
  protocol: 'tomari-agent-bridge.v1',
  type: 'agent-leave',
  roomId: 'codec-lobby',
  peerId: 'codex'
}
```

Agent peers are also pruned if no fresh presence arrives for roughly 22 seconds. A local adapter should publish on state changes and send a lightweight heartbeat while the agent is active.
