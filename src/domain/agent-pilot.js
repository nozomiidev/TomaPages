export const AGENT_PILOT_ID = 'codex-agent';
export const AGENT_PILOT_ROOM_ID = 'agent:codex-agent';

const PILOT_FRAMES = [
  { audioLevel: 0.46, cell: { row: 2, col: 3 }, mouth: 2 },
  { audioLevel: 0.24, cell: { row: 1, col: 3 }, mouth: 1 },
  { audioLevel: 0.34, cell: { row: 2, col: 2 }, mouth: 1 },
  { audioLevel: 0.12, cell: { row: 3, col: 3 }, mouth: 0 },
];

export function makeAgentPilotPeer({ tick = 0 } = {}) {
  const frame = PILOT_FRAMES[Math.abs(Math.round(tick)) % PILOT_FRAMES.length];

  return {
    id: AGENT_PILOT_ID,
    name: 'Codex Agent',
    role: 'MCP pilot',
    audioLevel: frame.audioLevel,
    cell: frame.cell,
    mouth: frame.mouth,
    hair: '0F766E',
    hairMix: 0.65,
    eyes: 'A855F7',
    eyeMix: 0.85,
    filter: 'smooth',
  };
}
