import { describe, expect, it } from 'vitest';
import {
  ROOM_CARD_BASE_HEIGHT,
  ROOM_CARD_BASE_WIDTH,
  computeRoomSceneLayout,
  isPointInLayout,
} from './room-layout';

function assertFits(scene, width, height) {
  for (const layout of scene.layouts) {
    expect(layout.x).toBeGreaterThanOrEqual(0);
    expect(layout.y).toBeGreaterThanOrEqual(0);
    expect(layout.x + layout.width).toBeLessThanOrEqual(width);
    expect(layout.y + layout.height).toBeLessThanOrEqual(height);
  }
}

describe('room layout', () => {
  it('returns an empty scene when the canvas is not measurable', () => {
    expect(computeRoomSceneLayout(0, 480, 4)).toMatchObject({
      cols: 0,
      layouts: [],
      rows: 0,
      scale: 0,
    });
  });

  it('keeps normal desktop rooms near the base card size', () => {
    const scene = computeRoomSceneLayout(1180, 620, 4);

    expect(scene.cols).toBeGreaterThanOrEqual(2);
    expect(scene.rows).toBeLessThanOrEqual(2);
    expect(scene.cardWidth).toBe(ROOM_CARD_BASE_WIDTH);
    expect(scene.cardHeight).toBe(ROOM_CARD_BASE_HEIGHT);
    expect(scene.scale).toBe(1);
    assertFits(scene, 1180, 620);
  });

  it('adapts crowded mobile rooms without clipping participant cards', () => {
    const scene = computeRoomSceneLayout(347, 490, 6);

    expect(scene.layouts).toHaveLength(6);
    expect(scene.cols).toBe(2);
    expect(scene.scale).toBeLessThan(1);
    assertFits(scene, 347, 490);
  });

  it('detects whether a pointer is inside a computed card layout', () => {
    const scene = computeRoomSceneLayout(900, 520, 3);
    const layout = scene.layouts[1];

    expect(isPointInLayout({
      x: layout.x + layout.width * 0.5,
      y: layout.y + layout.height * 0.5,
    }, layout)).toBe(true);
    expect(isPointInLayout({
      x: layout.x + layout.width + 4,
      y: layout.y + layout.height * 0.5,
    }, layout)).toBe(false);
  });
});
