import { describe, expect, it } from 'vitest';
import {
  AGENT_PILOT_ID,
  AGENT_PILOT_ROOM_ID,
  makeAgentPilotPeer,
} from './agent-pilot';

describe('agent pilot', () => {
  it('creates a stable page-local agent payload for bridge self-checks', () => {
    expect(makeAgentPilotPeer()).toEqual({
      id: AGENT_PILOT_ID,
      name: 'Codex Agent',
      role: 'MCP pilot',
      audioLevel: 0.46,
      cell: { row: 2, col: 3 },
      mouth: 2,
      hair: '0F766E',
      hairMix: 0.65,
      eyes: 'A855F7',
      eyeMix: 0.85,
      filter: 'shade',
    });
    expect(AGENT_PILOT_ROOM_ID).toBe('agent:codex-agent');
  });

  it('cycles mouth, audio, and cell state so the room can show agent activity', () => {
    expect([
      makeAgentPilotPeer({ tick: 0 }),
      makeAgentPilotPeer({ tick: 1 }),
      makeAgentPilotPeer({ tick: 2 }),
      makeAgentPilotPeer({ tick: 3 }),
      makeAgentPilotPeer({ tick: 4 }),
    ].map((peer) => `${peer.cell.row}:${peer.cell.col},m${peer.mouth},a${Math.round(peer.audioLevel * 100)}`)).toEqual([
      '2:3,m2,a46',
      '1:3,m1,a24',
      '2:2,m1,a34',
      '3:3,m0,a12',
      '2:3,m2,a46',
    ]);
  });
});
