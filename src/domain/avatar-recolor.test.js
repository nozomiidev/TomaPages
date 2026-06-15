import { describe, expect, it } from 'vitest';
import { classifyAvatarPixel, parseHexColor } from './avatar-recolor';

const basePixel = {
  a: 255,
  width: 1200,
  height: 1200,
};

describe('avatar recolor domain', () => {
  it('parses hex colors with long and short notation', () => {
    expect(parseHexColor('#2BA7E8')).toEqual({ r: 43, g: 167, b: 232 });
    expect(parseHexColor('#0f6')).toEqual({ r: 0, g: 255, b: 102 });
  });

  it('keeps invalid colors on the provided fallback', () => {
    expect(parseHexColor('not-a-color', { r: 1, g: 2, b: 3 })).toEqual({ r: 1, g: 2, b: 3 });
  });

  it('classifies golden pixels by color range instead of frame coordinates', () => {
    expect(classifyAvatarPixel({
      ...basePixel,
      r: 242,
      g: 183,
      b: 5,
      x: 1040,
      y: 980,
    })).toBe('eye');
  });

  it('classifies dark neutral pixels by color range instead of frame coordinates', () => {
    expect(classifyAvatarPixel({
      ...basePixel,
      r: 58,
      g: 60,
      b: 58,
      x: 1040,
      y: 980,
    })).toBe('hair');
  });

  it('does not recolor skin or transparent pixels', () => {
    expect(classifyAvatarPixel({
      ...basePixel,
      r: 246,
      g: 212,
      b: 180,
      x: 600,
      y: 600,
    })).toBeNull();
    expect(classifyAvatarPixel({
      ...basePixel,
      r: 58,
      g: 60,
      b: 58,
      a: 0,
      x: 360,
      y: 320,
    })).toBeNull();
    expect(classifyAvatarPixel({
      ...basePixel,
      r: 58,
      g: 60,
      b: 58,
      a: 96,
      x: 360,
      y: 320,
    })).toBeNull();
  });
});
