import { targetToCell } from './character';
import { clamp } from '../lib/math';

export function pointerToRoomCardCell({ canvasRect, clientX, clientY, layout }) {
  if (!canvasRect || !layout) return { row: 2, col: 2 };

  const localX = Number(clientX) - Number(canvasRect.left) - layout.x;
  const localY = Number(clientY) - Number(canvasRect.top) - layout.y;
  const centerX = layout.width * 0.5;
  const centerY = layout.height * 0.48;

  return targetToCell({
    x: clamp((localX - centerX) / (layout.width * 0.38), -1, 1),
    y: clamp((localY - centerY) / (layout.height * 0.32), -1, 1),
  });
}

export function isPointerInsideRect({ clientX, clientY, rect } = {}) {
  if (!rect) return false;

  return clientX >= rect.left
    && clientX <= rect.left + rect.width
    && clientY >= rect.top
    && clientY <= rect.top + rect.height;
}

export function nextSingleHoverCells(current = {}, { cell, peerId } = {}) {
  if (!peerId || !cell) return {};

  const previous = current[peerId];
  const isOnlyPeer = Object.keys(current).length === 1 && previous;
  if (isOnlyPeer && previous.row === cell.row && previous.col === cell.col) {
    return current;
  }

  return {
    [peerId]: {
      col: cell.col,
      row: cell.row,
    },
  };
}

export function formatHoverCell(cell) {
  return cell ? `${cell.row}:${cell.col}` : '';
}

export function makeRoomHoverSnapshot({ hoverCell, hoveredPeer } = {}) {
  return {
    cell: formatHoverCell(hoverCell),
    liveLayer: hoveredPeer ? 'active' : 'idle',
    name: hoveredPeer?.name ?? '',
    peerId: hoveredPeer?.id ?? '',
    source: hoveredPeer?.source ?? '',
  };
}
