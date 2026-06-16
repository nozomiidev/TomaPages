import { describe, expect, it } from 'vitest';
import {
  formatHoverCell,
  isPointerInsideRect,
  makeRoomHoverSnapshot,
  nextSingleHoverCells,
  pointerToRoomCardCell,
} from './room-hover';

const layout = {
  height: 184,
  width: 286,
  x: 40,
  y: 30,
};
const canvasRect = {
  left: 10,
  top: 20,
};

describe('room hover helpers', () => {
  it('maps pointer positions inside a room card to the 5x5 avatar direction grid', () => {
    expect(pointerToRoomCardCell({
      canvasRect,
      clientX: canvasRect.left + layout.x + layout.width * 0.5,
      clientY: canvasRect.top + layout.y + layout.height * 0.48,
      layout,
    })).toEqual({ col: 2, row: 2 });

    expect(pointerToRoomCardCell({
      canvasRect,
      clientX: canvasRect.left + layout.x,
      clientY: canvasRect.top + layout.y,
      layout,
    })).toEqual({ col: 0, row: 0 });

    expect(pointerToRoomCardCell({
      canvasRect,
      clientX: canvasRect.left + layout.x + layout.width,
      clientY: canvasRect.top + layout.y + layout.height,
      layout,
    })).toEqual({ col: 4, row: 4 });
  });

  it('keeps only the currently hovered peer in hover cell state', () => {
    const initial = {
      alpha: { col: 1, row: 2 },
      beta: { col: 3, row: 2 },
    };

    expect(nextSingleHoverCells(initial, {
      cell: { col: 4, row: 0 },
      peerId: 'beta',
    })).toEqual({
      beta: { col: 4, row: 0 },
    });
    expect(nextSingleHoverCells(initial)).toEqual({});
  });

  it('detects whether a pointer is still inside the canvas scene rect', () => {
    const rect = {
      height: 200,
      left: 40,
      top: 30,
      width: 320,
    };

    expect(isPointerInsideRect({ clientX: 60, clientY: 50, rect })).toBe(true);
    expect(isPointerInsideRect({ clientX: 20, clientY: 50, rect })).toBe(false);
    expect(isPointerInsideRect({ clientX: 60, clientY: 260, rect })).toBe(false);
  });

  it('returns the same object when the single hover cell has not changed', () => {
    const current = {
      alpha: { col: 2, row: 3 },
    };

    expect(nextSingleHoverCells(current, {
      cell: { col: 2, row: 3 },
      peerId: 'alpha',
    })).toBe(current);
  });

  it('formats hover diagnostics for browser checks', () => {
    expect(formatHoverCell({ col: 3, row: 1 })).toBe('1:3');
    expect(makeRoomHoverSnapshot({
      hoverCell: { col: 3, row: 1 },
      hoveredPeer: { id: 'demo-otacon', name: 'Otacon', source: 'demo' },
    })).toEqual({
      cell: '1:3',
      liveLayer: 'active',
      name: 'Otacon',
      peerId: 'demo-otacon',
      source: 'demo',
    });
    expect(makeRoomHoverSnapshot()).toMatchObject({
      cell: '',
      liveLayer: 'idle',
      peerId: '',
    });
  });
});
