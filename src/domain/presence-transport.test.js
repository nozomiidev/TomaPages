import { describe, expect, it } from 'vitest';
import {
  createOperatorName,
  makeRandomRoomId,
  makeRoomUrl,
  readDisplayName,
  readRoomId,
} from './presence-transport';

describe('presence transport helpers', () => {
  it('sanitizes room ids for URLs and transport channel names', () => {
    expect(readRoomId('?room=Codec Lobby!!')).toBe('codec-lobby');
    expect(readRoomId('?room=')).toBe('public-lobby');
  });

  it('reads a display name or falls back to a stable operator label', () => {
    expect(readDisplayName({
      search: '?name=Nozomi%20Dev',
      fallbackId: 'abcd-1234',
    })).toBe('Nozomi Dev');
    expect(readDisplayName({
      search: '?name=',
      fallbackId: 'abcd-1234',
    })).toBe('Operator ABCD');
  });

  it('builds portable room links with sanitized parameters', () => {
    expect(makeRoomUrl({
      baseUrl: 'https://example.test/TomaPages/talk.html',
      roomId: 'Cool Room',
      name: 'Operator Alpha',
    })).toBe('https://example.test/TomaPages/room.html?room=cool-room&name=Operator+Alpha');
  });

  it('generates readable room ids without relying on a server', () => {
    const values = [0.01, 0.32, 0.75];
    const random = () => values.shift() ?? 0;

    expect(makeRandomRoomId(random)).toBe('codec-orbit-bff');
  });

  it('creates a short operator label from peer ids', () => {
    expect(createOperatorName('7f3a-9999')).toBe('Operator 7F3A');
  });
});
