import { describe, expect, it } from 'vitest';
import { readDemoPeerPreference, shouldIncludeDemoPeers } from './room-peers';

describe('room peer helpers', () => {
  it('reads demo peer display preferences from room URLs', () => {
    expect(readDemoPeerPreference('?demo=1')).toBe('show');
    expect(readDemoPeerPreference('?demo=false')).toBe('hide');
    expect(readDemoPeerPreference('?room=codec')).toBe('auto');
  });

  it('keeps simulated peers only while the room is otherwise empty by default', () => {
    expect(shouldIncludeDemoPeers({ preference: 'auto', remoteCount: 0, agentCount: 0 })).toBe(true);
    expect(shouldIncludeDemoPeers({ preference: 'auto', remoteCount: 1, agentCount: 0 })).toBe(false);
    expect(shouldIncludeDemoPeers({ preference: 'auto', remoteCount: 0, agentCount: 1 })).toBe(false);
    expect(shouldIncludeDemoPeers({ preference: 'show', remoteCount: 1, agentCount: 1 })).toBe(true);
    expect(shouldIncludeDemoPeers({ preference: 'hide', remoteCount: 0, agentCount: 0 })).toBe(false);
  });
});
