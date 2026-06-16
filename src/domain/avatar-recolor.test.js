import { describe, expect, it } from 'vitest';
import { classifyAvatarPixel, parseHexColor, writeAvatarTintOverlay } from './avatar-recolor';

const basePixel = {
  a: 255,
  width: 1200,
  height: 1200,
};

function luma([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function renderHairPixel([r, g, b], filterMode = 'soft') {
  const source = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([r, g, b, 255]),
  };
  const target = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray(4),
  };

  writeAvatarTintOverlay(source, target, {
    filterMode,
    hairColor: '#0F766E',
    hairStrength: 1,
    eyeColor: '#A855F7',
    eyeStrength: 0,
  });

  return Array.from(target.data);
}

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

  it('soft filter keeps source shading instead of producing a flat fill', () => {
    const darkHair = renderHairPixel([58, 60, 58]);
    const lightHair = renderHairPixel([112, 116, 112]);

    expect(darkHair[3]).toBe(255);
    expect(lightHair[3]).toBe(255);
    expect(luma(lightHair)).toBeGreaterThan(luma(darkHair));
  });

  it('paint filter remains available as a translucent color overlay', () => {
    const paintedHair = renderHairPixel([58, 60, 58], 'paint');

    expect(paintedHair[3]).toBeLessThan(255);
    expect(paintedHair[1]).toBeGreaterThan(paintedHair[0]);
  });
});
