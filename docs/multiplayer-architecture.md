# Multiplayer Studio Direction

This is the working architecture for the planned multi-user PNGTuber room.

## Direction

- Use Trystero for WebRTC room discovery and data-channel messaging. It gives the app room-level peer discovery without building a signaling server first.
- Keep avatar rendering deterministic and local: each peer sends compact presence state, not image frames.
- Presence payload: peer id, display name, selected colors, pose cell, mouth state, audio level, pointer target, speaking flag, and last-seen timestamp.
- Room diagnostics expose the same per-peer payload as compact `data-room-peer-states`, `data-room-speaking-peer-ids`, `data-room-speaking-label`, and `data-room-open-mouth-peer-ids` attributes so browser checks can verify mouth/audio propagation without scraping canvas pixels.
- Presence is sent on state changes and on a lightweight heartbeat so late joiners can discover already-open tabs without waiting for the current user to move or speak.
- Same-browser BroadcastChannel peers are labeled as `tab`, not `local`, so local fallback tests do not look like duplicate self cards.
- The Room toolbar includes an `Open peer` self-test that opens the same room with `demo=0&testPeer=1`, letting the app verify a real extra tab peer without relying on demo participants.
- Render the room as a canvas-backed scene with live DOM overlays only for focused/hovered cards. Ambient cards can be rendered from HTML to canvas snapshots when they are not interactive.
- Use html2canvas only for card snapshotting. The live, hovered card should remain DOM so pointer tracking, focus states, and accessibility do not get flattened. Hover state is single-owner: moving into another card clears the previous hover cell, and leaving the canvas returns the room to snapshot-only rendering.
- Snapshot capture is best effort per card. A failed html2canvas render keeps any previous snapshot, does not block other cards, and is exposed through `data-room-snapshot-ready`, `data-room-snapshot-failed`, and `data-room-snapshot-total`.
- Compute card layout in a pure domain helper. The scene should scale cards and column counts to the canvas size so crowded mobile rooms do not clip participant cards.
- Expose a browser-side Agent Bridge for local MCP adapters and automation tools. Static GitHub Pages cannot host a long-running MCP server, so the page provides `BroadcastChannel`, `postMessage`, `data-*`, and `window.tomariAgentBridge` ingress points.

## First Implementation Slice

1. Add a `room.html` route with a polished communications-console layout.
2. Add a local multi-card simulator before real networking, so the canvas and hover-follow behavior can be verified without signaling flakiness.
3. Add Trystero room presence behind a small `presenceTransport` boundary.
4. Keep a `localStorage` fallback transport for same-browser testing and for offline demos.
5. Add shareable room links with `room` and `name` query parameters.
6. Add Playwright/browser checks for two tabs: peer cards appear, hovered card follows the pointer, mouth state updates propagate.
7. Add an agent bridge so AI peers can join the same room state model without a server process.

## References

- Trystero: <https://github.com/dmotz/trystero>
- PeerJS: <https://peerjs.com/>
- y-webrtc: <https://github.com/yjs/y-webrtc>
- WebRTC peer connections: <https://webrtc.org/getting-started/peer-connections>
- html2canvas: <https://html2canvas.hertzen.com/>
